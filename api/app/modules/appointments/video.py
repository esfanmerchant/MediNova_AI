"""Online consultations: who may enter a call, and when.

The call itself is Zoom's Video SDK, running in the browser. What this module
owns is the door. A browser cannot join a session without a token signed with
the SDK secret, the secret never leaves this server, and so every rule below is
enforced by refusing to sign — not by a page hiding a button.

* **Two people per room.** The patient on the appointment and the treating
  doctor. An administrator can see that a consultation exists; they cannot sit
  in on it.
* **One room per consultation.** The token names the session it opens, and the
  name is random (see ``new_room_name``), so a token for one consultation is
  useless for any other.
* **Paid before it starts.** A call that has not been paid for does not open,
  for either side — the doctor is not asked to consult on credit.
* **A window, not a link that works forever.** Ten minutes before the start to
  sort out a microphone; fifteen after the end for a consultation that ran
  over. Outside that, there is no room.
* **No recording.** The token asks for none, and nothing here could switch it
  on. A recorded consultation would be the most sensitive file in the system,
  and nobody asked for one.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import StrEnum

import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.base import utcnow
from app.db.enums import AppointmentMode, AppointmentStatus, InvoiceStatus, PaymentStatus
from app.db.models import Appointment, Invoice, Payment

#: How early the room opens — long enough to find the right browser tab and
#: allow the camera, short enough that nobody waits alone for half an hour.
OPENS_BEFORE = timedelta(minutes=10)

#: How long after the booked end the room still admits people. A consultation
#: that started five minutes late is not cut off at the half hour.
CLOSES_AFTER = timedelta(minutes=15)

#: Zoom's own floor on a token's lifetime, from its documentation: ``exp`` must
#: be at least half an hour after ``iat``.
_MIN_TOKEN_LIFETIME = timedelta(minutes=30)

#: Backdated against clock drift. A server running a few seconds fast would
#: otherwise sign tokens Zoom considers issued in the future.
_CLOCK_SKEW = timedelta(seconds=30)


class RoomState(StrEnum):
    """Why a room is or is not open, in an order the patient can act on.

    Payment comes before timing on purpose: "pay to join" is worth knowing the
    day before, and "the room is not open yet" would hide it until it was too
    late to clear.
    """

    OPEN = "OPEN"
    NOT_ONLINE = "NOT_ONLINE"
    CANCELLED = "CANCELLED"
    ENDED = "ENDED"
    NOT_CONFIRMED = "NOT_CONFIRMED"
    UNPAID = "UNPAID"
    PAYMENT_UNDER_REVIEW = "PAYMENT_UNDER_REVIEW"
    TOO_EARLY = "TOO_EARLY"
    NOT_CONFIGURED = "NOT_CONFIGURED"


#: What each state means to the person looking at it. The room page shows these
#: verbatim, so they are written to be read, not logged.
MESSAGES: dict[RoomState, str] = {
    RoomState.OPEN: "The consultation room is open.",
    RoomState.NOT_ONLINE: "This appointment is a clinic visit, not an online consultation.",
    RoomState.CANCELLED: "This consultation was cancelled.",
    RoomState.ENDED: "This consultation has ended.",
    RoomState.NOT_CONFIRMED: "The doctor has not confirmed this consultation yet.",
    RoomState.UNPAID: "This consultation has not been paid for yet. Pay the invoice to join.",
    RoomState.PAYMENT_UNDER_REVIEW: (
        "Your payment is being checked. The room opens as soon as it is confirmed."
    ),
    RoomState.TOO_EARLY: "The room opens ten minutes before the consultation starts.",
    RoomState.NOT_CONFIGURED: (
        "Video calls are not set up on this server yet. Contact the hospital."
    ),
}


def new_room_name() -> str:
    """A session name nobody can work out.

    Thirty hex characters after a short prefix: alphanumeric, which is all Zoom
    accepts in a session name, and long enough that guessing one is not a plan.
    """
    return f"mn{secrets.token_hex(15)}"


def opens_at(appointment: Appointment) -> datetime:
    return appointment.start_time - OPENS_BEFORE


def closes_at(appointment: Appointment) -> datetime:
    return appointment.end_time + CLOSES_AFTER


@dataclass(frozen=True)
class Room:
    state: RoomState
    invoice: Invoice | None
    awaiting_review: bool

    @property
    def is_open(self) -> bool:
        return self.state is RoomState.OPEN

    @property
    def message(self) -> str:
        return MESSAGES[self.state]


async def invoice_for(db: AsyncSession, appointment_id: str) -> tuple[Invoice | None, bool]:
    """The consultation's invoice, and whether a payment for it awaits review."""
    invoice = (
        await db.execute(select(Invoice).where(Invoice.appointment_id == appointment_id))
    ).scalar_one_or_none()
    if invoice is None:
        return None, False
    pending = (
        await db.execute(
            select(Payment.id)
            .where(
                Payment.invoice_id == invoice.id,
                Payment.status == PaymentStatus.SUBMITTED,
            )
            .limit(1)
        )
    ).first()
    return invoice, pending is not None


def is_settled(invoice: Invoice | None) -> bool:
    """Paid — or nothing to pay, for a doctor who consults online for free."""
    if invoice is None:
        return False
    return invoice.status == InvoiceStatus.PAID or (
        invoice.status == InvoiceStatus.ISSUED and invoice.total_amount <= Decimal("0")
    )


async def room_for(
    db: AsyncSession, appointment: Appointment, *, now: datetime | None = None
) -> Room:
    """Whether this consultation's room is open, and if not, why not."""
    now = now or utcnow()
    invoice, awaiting_review = await invoice_for(db, appointment.id)

    def room(state: RoomState) -> Room:
        return Room(state=state, invoice=invoice, awaiting_review=awaiting_review)

    if appointment.mode != AppointmentMode.ONLINE:
        return room(RoomState.NOT_ONLINE)
    if appointment.status in (AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW):
        return room(RoomState.CANCELLED)
    if appointment.status == AppointmentStatus.COMPLETED or now > closes_at(appointment):
        return room(RoomState.ENDED)
    if appointment.status == AppointmentStatus.REQUESTED:
        return room(RoomState.NOT_CONFIRMED)
    if not is_settled(invoice):
        return room(
            RoomState.PAYMENT_UNDER_REVIEW if awaiting_review else RoomState.UNPAID
        )
    if now < opens_at(appointment):
        return room(RoomState.TOO_EARLY)
    if not settings.video_configured:
        return room(RoomState.NOT_CONFIGURED)
    return room(RoomState.OPEN)


@dataclass(frozen=True)
class CallToken:
    token: str
    session_name: str
    expires_at: datetime


def sign_token(
    appointment: Appointment, *, host: bool, now: datetime | None = None
) -> CallToken:
    """A Video SDK token for this consultation's room, and nothing else.

    The claims are the documented minimum — key, role, session, version, and
    the two timestamps. Recording options are deliberately absent, and so is
    anything that would let the token open a different session.

    The lifetime runs to the room's closing time, so a dropped connection can
    rejoin with the same token, and never less than Zoom's thirty-minute floor.
    """
    now = now or utcnow()
    issued = now - _CLOCK_SKEW
    expires = max(issued + _MIN_TOKEN_LIFETIME, closes_at(appointment))

    def epoch(value: datetime) -> int:
        # The columns are naive UTC. ``timestamp()`` on a naive value reads it
        # as the server's local time, which on a machine in Karachi would sign
        # tokens five hours in the past.
        return int(value.replace(tzinfo=UTC).timestamp())

    payload = {
        "app_key": settings.ZOOM_VIDEO_SDK_KEY,
        # 1 is host, 0 participant. The doctor hosts: Zoom gives the host the
        # session's controls, and the consultation is theirs to run.
        "role_type": 1 if host else 0,
        "tpc": appointment.video_room,
        "version": 1,
        "iat": epoch(issued),
        "exp": epoch(expires),
    }
    token = jwt.encode(payload, settings.ZOOM_VIDEO_SDK_SECRET, algorithm="HS256")
    return CallToken(token=token, session_name=appointment.video_room or "", expires_at=expires)
