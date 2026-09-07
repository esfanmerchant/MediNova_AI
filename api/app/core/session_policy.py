"""Session lifetime policy.

R8 asks for a two-minute inactivity logout everywhere. Applied literally it
also logs out the vitals wall display, which exists to be watched and not
touched, and cuts off an elderly patient mid-dictation — the exact user the
voice feature is for. So the strict rule is kept where the threat actually is,
an unattended shared ward terminal, and the other classes are tiered.

See conflict C3 in the requirements triage.

Two clocks govern a session and both are tiered, because raising one without
the other leaves the second quietly enforcing the old rule:

===============  ==========  ==========  =============
Device class     Idle        Absolute    Access token
===============  ==========  ==========  =============
SHARED_TERMINAL  2 minutes   12 hours    2 minutes
PERSONAL         7 days      7 days      15 minutes
MONITOR          exempt      12 hours    15 minutes
===============  ==========  ==========  =============

Anything unrecognised lands on the strict tier, so no client can widen its own
window by inventing a device class.

The access token stays short in every row. What a long session buys is the
right to ask for a new token without a password — never a credential that is
itself good for a week.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum

from app.core.config import settings


class DeviceClass(StrEnum):
    SHARED_TERMINAL = "SHARED_TERMINAL"
    PERSONAL = "PERSONAL"
    MONITOR = "MONITOR"


#: Anything a client sends that is not recognised falls back to the strictest
#: tier, so a caller cannot widen its own timeout by inventing a device class.
DEFAULT_DEVICE_CLASS = DeviceClass.SHARED_TERMINAL

REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7

#: How long a personal device stays signed in — idle and absolute both.
#:
#: A phone with the app installed is not the machine R8 is about. R8 exists for
#: an unattended terminal on a ward, where the next person to touch it is a
#: stranger; a phone in somebody's pocket has a lock screen in front of it and
#: one owner. Holding both to two minutes protected nothing and meant a patient
#: signed in again every time they came back to check a dose.
#:
#: Seven days rather than forever, and the same number as the refresh token, so
#: a lost phone stops being a way in within a week without anybody having to
#: notice. The access token is unaffected: it still expires in fifteen minutes
#: (see ``access_token_ttl_seconds``), so what is long-lived here is the right
#: to ask for a new one, not the credential itself.
#:
#: **None of this is what delivers notifications.** A push subscription belongs
#: to the device and is keyed on the user alone — no session, no token — so
#: reminders arrive whether or not anybody is signed in. This is about not
#: retyping a password, and nothing else.
PERSONAL_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

#: How stale ``lastSeenAt`` may get before it is written again. Without this
#: every authenticated request would issue an UPDATE.
LAST_SEEN_WRITE_THROTTLE_SECONDS = 10


def coerce_device_class(value: str | None) -> DeviceClass:
    try:
        return DeviceClass(value or "")
    except ValueError:
        return DEFAULT_DEVICE_CLASS


def idle_timeout_seconds(device_class: str) -> int | None:
    """Seconds of inactivity allowed, or ``None`` when the class is exempt."""
    match coerce_device_class(device_class):
        case DeviceClass.MONITOR:
            # View-only wall display. Any action taken from it re-authenticates.
            return None
        case DeviceClass.PERSONAL:
            return PERSONAL_SESSION_TTL_SECONDS
        case _:
            return settings.SESSION_IDLE_TIMEOUT_SECONDS


def access_token_ttl_seconds(device_class: str) -> int:
    """Kept at or below the idle window so a stolen token dies quickly."""
    idle = idle_timeout_seconds(device_class)
    return 15 * 60 if idle is None else min(idle, 15 * 60)


def absolute_timeout_seconds(device_class: str = "") -> int:
    """The hard ceiling on a session, however active it stays.

    Device-class aware for the same reason the idle window is: a twelve-hour
    cap on a personal phone would end the week-long window above on its first
    night, which is the wrong half of the rule doing the work.
    """
    if coerce_device_class(device_class) is DeviceClass.PERSONAL:
        return PERSONAL_SESSION_TTL_SECONDS
    return settings.SESSION_ABSOLUTE_TIMEOUT_SECONDS


@dataclass(frozen=True)
class IdleCheck:
    expired: bool
    #: Seconds remaining, or ``None`` when the class is exempt. Drives the
    #: client's countdown warning.
    remaining_seconds: int | None


def check_idle(device_class: str, last_seen_at: datetime, now: datetime | None = None) -> IdleCheck:
    idle = idle_timeout_seconds(device_class)
    if idle is None:
        return IdleCheck(expired=False, remaining_seconds=None)

    now = now or datetime.now(UTC)
    # Postgres `timestamp` columns come back naive; compare in the same frame.
    if last_seen_at.tzinfo is None:
        last_seen_at = last_seen_at.replace(tzinfo=UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)

    elapsed = (now - last_seen_at).total_seconds()
    return IdleCheck(
        expired=elapsed >= idle,
        remaining_seconds=max(0, int(-(-(idle - elapsed) // 1))),
    )
