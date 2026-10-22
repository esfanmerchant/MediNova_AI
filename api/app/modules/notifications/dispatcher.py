"""Background delivery and appointment reminders (spec §31-32).

Two jobs on one loop:

* **drain the queue** — take ``PENDING`` email rows and send them;
* **schedule reminders** — notify patients whose appointment is coming up.

**Claiming is done in the database, not in this process.** Rows are taken with
``FOR UPDATE SKIP LOCKED``, so several workers can run this loop and each
message still goes to exactly one of them. An in-process "is it mine" check
would send every email as many times as there are workers.

**Retry is bounded by age, not by a counter.** A transient failure leaves the
row ``PENDING`` so the next pass picks it up; once a row has been waiting longer
than ``GIVE_UP_AFTER`` it is marked ``FAILED`` and left alone. A permanent
failure — a refused mailbox, a rejected login — is marked ``FAILED`` at once,
because retrying it only delays the queue behind it.

**Reminders are idempotent by observation.** Before sending, the loop asks which
appointments already have a reminder notification, and skips those. There is no
"reminded" flag to fall out of step with reality: the notification itself is the
record that the reminder was sent.
"""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import logger
from app.db.base import utcnow
from app.db.enums import (
    AppointmentMode,
    AppointmentStatus,
    AuditAction,
    InvoiceKind,
    InvoiceStatus,
    NotificationChannel,
    NotificationStatus,
    NotificationType,
    PaymentStatus,
    PharmacyOrderStatus,
)
from app.db.models import (
    Appointment,
    Doctor,
    Invoice,
    MedicationReminder,
    Notification,
    Patient,
    Payment,
    PharmacyOrder,
    Prescription,
    PushSubscription,
    User,
)
from app.db.session import SessionFactory
from app.modules.appointments import video
from app.modules.appointments.schedule import clinic_timezone, iso_utc, to_clinic
from app.modules.notifications import templates
from app.modules.notifications.templates import ALWAYS_SENT
from app.services import email as email_service
from app.services import email_templates
from app.services import push as push_service

#: How often the loop wakes. Email is not interactive; a message that goes out
#: within a minute is on time, and a tighter interval would spend connections
#: on an almost always empty queue.
INTERVAL_SECONDS = 60

#: Messages per pass. Bounded so one backlog cannot monopolise the loop and
#: starve reminders behind it.
BATCH_SIZE = 20

#: A message still undelivered after this is abandoned. An appointment reminder
#: that arrives a day late is worse than one that never arrives — it tells
#: someone about a slot they have already missed.
GIVE_UP_AFTER = timedelta(hours=6)

#: How far ahead a reminder is sent, and the width of the window scanned. The
#: window must exceed the interval, or an appointment could pass through the
#: gap between two passes and never be reminded about.
REMIND_BEFORE = timedelta(hours=24)
REMIND_WINDOW = timedelta(hours=2)

#: The "your call is about to start" notice for an online consultation goes out
#: as the room opens, so the link in it works the moment it is tapped.
VIDEO_REMIND_BEFORE = video.OPENS_BEFORE

#: Metadata values that tell the appointment notices apart. The day-before
#: reminder and the room-opening one share a type, and each pass's "have I
#: already said this" must not be answered by the other's message.
VIDEO_REMINDER = "video"
MISSED_CONSULTATION = "missed"


async def claim_pending(db: AsyncSession, limit: int = BATCH_SIZE) -> list[Notification]:
    """Take a batch of email rows, locked against other workers."""
    return list(
        (
            await db.execute(
                select(Notification)
                .where(
                    Notification.channel == NotificationChannel.EMAIL,
                    Notification.status == NotificationStatus.PENDING,
                )
                .order_by(Notification.priority.desc(), Notification.created_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )


async def deliver(db: AsyncSession, notification: Notification) -> bool:
    """Send one queued email and record what happened on its row."""
    address = (
        await db.execute(select(User.email).where(User.id == notification.user_id))
    ).scalar_one_or_none()

    if not address:
        notification.status = NotificationStatus.FAILED
        notification.failed_at = utcnow()
        notification.error = "no address on file"
        return False

    message = templates.render(
        notification.type,
        in_app_body=notification.body,
        link=notification.link,
        metadata=notification.notification_metadata,
    )
    result = await email_service.send(
        to=address,
        subject=message.subject,
        text_body=message.text,
        html_body=message.html,
        # An unsubscribe on everything except the two kinds of notice no
        # preference switches off. Offering to stop a break-glass alert would
        # be an offer this system will not honour, and a header that promises
        # something it will not do is the thing filters check for.
        allow_unsubscribe=notification.type not in ALWAYS_SENT,
    )

    if result.sent:
        notification.status = NotificationStatus.SENT
        notification.sent_at = utcnow()
        notification.error = None
        return True

    notification.error = result.detail
    notification.failed_at = utcnow()

    expired = utcnow() - notification.created_at > GIVE_UP_AFTER
    if result.retryable and not expired:
        # Left PENDING deliberately: the next pass will try again.
        return False

    notification.status = NotificationStatus.FAILED
    if expired and result.retryable:
        notification.error = f"{result.detail}; abandoned after {GIVE_UP_AFTER}"
    return False


async def send_pending() -> int:
    """One delivery pass. Returns how many messages went out."""
    ready, reason = email_service.is_configured()
    if not ready:
        logger.debug("email_dispatch_skipped", reason=reason)
        return 0

    sent = 0
    async with SessionFactory() as db:
        rows = await claim_pending(db)
        for row in rows:
            if await deliver(db, row):
                sent += 1
        await db.commit()

    if sent:
        logger.info("email_batch_sent", count=sent)
    return sent


async def due_for_reminder(db: AsyncSession) -> list[tuple[Appointment, str, str]]:
    """Appointments starting soon that nobody has been reminded about.

    Returns (appointment, patient user id, doctor name).
    """
    now = utcnow()
    window_start = now + REMIND_BEFORE - REMIND_WINDOW
    window_end = now + REMIND_BEFORE

    rows = (
        await db.execute(
            select(Appointment, Patient.user_id, User.name)
            .join(Patient, Patient.id == Appointment.patient_id)
            .join(Doctor, Doctor.id == Appointment.doctor_id)
            .join(User, User.id == Doctor.user_id)
            .where(
                Appointment.start_time >= window_start,
                Appointment.start_time < window_end,
                # Only a confirmed booking is worth reminding about: a request
                # nobody has accepted is not yet an appointment.
                Appointment.status == AppointmentStatus.CONFIRMED,
            )
            .limit(BATCH_SIZE)
        )
    ).all()
    if not rows:
        return []

    appointment_ids = [row[0].id for row in rows]
    already = set(
        (
            await db.execute(
                select(
                    Notification.notification_metadata["appointmentId"].astext
                ).where(
                    Notification.type == NotificationType.APPOINTMENT_REMINDER,
                    Notification.notification_metadata["appointmentId"].astext.in_(
                        appointment_ids
                    ),
                    # The day-before reminder only. A notice that the doctor
                    # has joined, or that the room is open, is a different
                    # message about the same appointment.
                    Notification.notification_metadata["reminder"].astext.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )

    return [(row[0], row[1], row[2]) for row in rows if row[0].id not in already]


async def schedule_reminders() -> int:
    """One reminder pass. Returns how many reminders were created."""
    from app.modules.notifications.service import notify

    created = 0
    async with SessionFactory() as db:
        for appointment, user_id, doctor_name in await due_for_reminder(db):
            local = to_clinic(appointment.start_time)
            online = appointment.mode == AppointmentMode.ONLINE
            await notify(
                db,
                user_id=user_id,
                notification_type=NotificationType.APPOINTMENT_REMINDER,
                title="Online consultation reminder" if online else "Appointment reminder",
                body=(
                    f"You have an {'online consultation' if online else 'appointment'} "
                    f"with {doctor_name} on {local.strftime('%d %b %Y at %H:%M')}."
                    + (" The call opens ten minutes before it starts." if online else "")
                ),
                link="/patient/appointments",
                metadata={"appointmentId": appointment.id},
                priority=1,
            )
            created += 1
        await db.commit()

    if created:
        logger.info("appointment_reminders_created", count=created)
    return created


async def _sent(db: AsyncSession, appointment_ids: list[str], kind: str) -> set[str]:
    """Which of these appointments already had this particular notice."""
    if not appointment_ids:
        return set()
    return set(
        (
            await db.execute(
                select(Notification.notification_metadata["appointmentId"].astext).where(
                    Notification.notification_metadata["reminder"].astext == kind,
                    Notification.notification_metadata["appointmentId"].astext.in_(
                        appointment_ids
                    ),
                )
            )
        )
        .scalars()
        .all()
    )


async def schedule_video_reminders() -> int:
    """Tell both sides of an online consultation that the room is opening.

    Both, unlike the day-before reminder: a video call needs the doctor at a
    screen as much as the patient, and a doctor between clinic patients is
    exactly the person who loses track of a 10:30 call.

    The patient's message depends on whether they have paid, because the room
    will not open for an unpaid consultation and "join now" would be a link to
    a refusal.
    """
    from app.modules.notifications.service import notify

    now = utcnow()
    doctor_user = User.__table__.alias("doctor_user")
    created = 0
    async with SessionFactory() as db:
        rows = (
            await db.execute(
                select(Appointment, Patient.user_id, Doctor.user_id, doctor_user.c.name)
                .join(Patient, Patient.id == Appointment.patient_id)
                .join(Doctor, Doctor.id == Appointment.doctor_id)
                .join(doctor_user, doctor_user.c.id == Doctor.user_id)
                .where(
                    Appointment.mode == AppointmentMode.ONLINE,
                    Appointment.status == AppointmentStatus.CONFIRMED,
                    Appointment.start_time > now,
                    Appointment.start_time <= now + VIDEO_REMIND_BEFORE,
                )
                .limit(BATCH_SIZE)
            )
        ).all()
        if not rows:
            return 0

        already = await _sent(db, [row[0].id for row in rows], VIDEO_REMINDER)
        for appointment, patient_user, doctor_user_id, doctor_name in rows:
            if appointment.id in already:
                continue
            clock = to_clinic(appointment.start_time).strftime("%H:%M")
            invoice, _ = await video.invoice_for(db, appointment.id)
            paid = video.is_settled(invoice)
            link = f"/consult/{appointment.id}"
            meta = {"appointmentId": appointment.id, "reminder": VIDEO_REMINDER}

            await notify(
                db,
                user_id=patient_user,
                notification_type=NotificationType.APPOINTMENT_REMINDER,
                title="Your online consultation is starting" if paid
                else "Pay now to join your consultation",
                body=(
                    f"Your call with {doctor_name} starts at {clock}. The room is open — join now."
                    if paid
                    else f"Your call with {doctor_name} starts at {clock}, but the invoice "
                    "is not paid yet. The room opens once the payment is confirmed."
                ),
                link=link,
                metadata=meta,
                priority=2,
            )
            await notify(
                db,
                user_id=doctor_user_id,
                notification_type=NotificationType.APPOINTMENT_REMINDER,
                title="Online consultation at " + clock,
                body=(
                    "Your next online consultation starts at "
                    f"{clock}. The room is open."
                    if paid
                    else f"Your online consultation at {clock} has not been paid for yet."
                ),
                link=link,
                metadata=meta,
                email=False,
                priority=2,
            )
            created += 1
        await db.commit()

    if created:
        logger.info("video_reminders_created", count=created)
    return created


async def close_lapsed_online_consultations() -> int:
    """Settle online consultations whose room has closed without a call.

    A clinic appointment nobody acts on simply sits in the list; somebody walks
    in, or does not. An online one has a bill attached and a room with a closing
    time, so leaving it would mean an invoice turning overdue for a call that
    never happened. Three cases, each handled once:

    * **Never confirmed** — the request lapsed. Cancelled, and both told.
    * **Confirmed, never paid** — cancelled and its invoice voided. Nothing
      changed hands, so nothing is owed either way.
    * **Paid, never started** — left as it is, and the administrators are told
      once. Somebody did not turn up, the money is the patient's until a person
      decides otherwise, and that decision is not this loop's to make.
    """
    from app.modules.audit.service import AuditEntry, record_audit
    from app.modules.billing import service as billing
    from app.modules.notifications.service import (
        notify,
        user_id_for_doctor,
        user_id_for_patient,
    )

    cutoff = utcnow() - video.CLOSES_AFTER
    handled = 0
    async with SessionFactory() as db:
        rows = (
            (
                await db.execute(
                    select(Appointment)
                    .where(
                        Appointment.mode == AppointmentMode.ONLINE,
                        Appointment.status.in_(
                            (AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED)
                        ),
                        Appointment.end_time < cutoff,
                    )
                    .limit(BATCH_SIZE)
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            return 0

        missed_already = await _sent(db, [a.id for a in rows], MISSED_CONSULTATION)
        for appointment in rows:
            invoice, awaiting = await video.invoice_for(db, appointment.id)
            when = to_clinic(appointment.start_time).strftime("%d %b at %H:%M")

            if appointment.status == AppointmentStatus.CONFIRMED and (
                video.is_settled(invoice) or awaiting
            ):
                if appointment.id in missed_already:
                    continue
                await billing.notify_admins(
                    db,
                    title="A paid online consultation did not take place",
                    body=(
                        f"The consultation on {when} was paid for, but the call was "
                        "never started. Check with the doctor and patient, and refund "
                        "it with a credit note if it is owed."
                    ),
                    link="/admin/appointments",
                    metadata={"appointmentId": appointment.id, "reminder": MISSED_CONSULTATION},
                    notification_type=NotificationType.APPOINTMENT_CANCELLED,
                )
                handled += 1
                continue

            unconfirmed = appointment.status == AppointmentStatus.REQUESTED
            reason = (
                "The doctor did not confirm it in time."
                if unconfirmed
                else "It was not paid for before it was due to start."
            )
            appointment.status = AppointmentStatus.CANCELLED
            appointment.cancelled_at = utcnow()
            appointment.cancel_reason = reason
            # Released like any cancellation, so ``holds_a_slot`` stays the
            # exact complement of a cleared key.
            appointment.slot_key = None
            outcome = await billing.consultation_called_off(db, appointment, reason=reason)

            for user_id, body, link in (
                (
                    await user_id_for_patient(db, appointment.patient_id),
                    f"Your online consultation on {when} was cancelled. {reason}",
                    "/patient/appointments",
                ),
                (
                    await user_id_for_doctor(db, appointment.doctor_id),
                    f"The online consultation on {when} was cancelled. {reason}",
                    "/doctor/appointments",
                ),
            ):
                await notify(
                    db,
                    user_id=user_id,
                    notification_type=NotificationType.APPOINTMENT_CANCELLED,
                    title="Online consultation cancelled",
                    body=body,
                    link=link,
                    metadata={"appointmentId": appointment.id},
                )
            await record_audit(
                db,
                AuditEntry(
                    action=AuditAction.APPOINTMENT_CANCELLED,
                    patient_id=appointment.patient_id,
                    entity_type="Appointment",
                    entity_id=appointment.id,
                    metadata={
                        "doctorId": appointment.doctor_id,
                        "startTime": iso_utc(appointment.start_time),
                        "automatic": True,
                        "reason": "unconfirmed" if unconfirmed else "unpaid",
                        "invoice": outcome,
                    },
                ),
            )
            handled += 1
        await db.commit()

    if handled:
        logger.info("lapsed_online_consultations_closed", count=handled)
    return handled


async def release_lapsed_pharmacy_orders() -> int:
    """Cancel medicine orders that have waited too long, and restock their shelves.

    An order holds its stock from the moment it is placed. That is right while
    somebody is acting on it, and wrong forever after: a cart abandoned at the
    payment step would otherwise keep the last strip of something away from the
    next patient indefinitely. Two clocks, each the one the patient was told:

    * a prescription not cleared within ``RX_WINDOW`` of the order;
    * an online payment not made by the invoice's due date — unless a payment is
      sitting in the review queue, which is the hospital's delay, not theirs.
    """
    from app.modules.audit.service import AuditEntry, record_audit
    from app.modules.pharmacy import orders as pharmacy

    now = utcnow()
    released = 0
    async with SessionFactory() as db:
        rows = (
            (
                await db.execute(
                    select(PharmacyOrder)
                    .outerjoin(Invoice, Invoice.id == PharmacyOrder.invoice_id)
                    .where(
                        (
                            (PharmacyOrder.status == PharmacyOrderStatus.PENDING_RX)
                            & (PharmacyOrder.created_at < now - pharmacy.RX_WINDOW)
                        )
                        | (
                            (PharmacyOrder.status == PharmacyOrderStatus.AWAITING_PAYMENT)
                            & (Invoice.due_at < now)
                            & ~select(Payment.id)
                            .where(
                                Payment.invoice_id == PharmacyOrder.invoice_id,
                                Payment.status == PaymentStatus.SUBMITTED,
                            )
                            .exists()
                        )
                    )
                    .limit(BATCH_SIZE)
                    .with_for_update(of=PharmacyOrder, skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        for order in rows:
            unpaid = order.status == PharmacyOrderStatus.AWAITING_PAYMENT
            reason = (
                "It was not paid for within two days."
                if unpaid
                else "The prescription was not cleared within three days."
            )
            outcome = await pharmacy.cancel(db, order, by=None, reason=reason)
            await pharmacy.tell_patient(
                db,
                order,
                title="Order cancelled",
                body=f"Order {order.order_number} was cancelled. {reason} You can order again at any time.",
            )
            await record_audit(
                db,
                AuditEntry(
                    action=AuditAction.PHARMACY_ORDER_UPDATED,
                    patient_id=order.patient_id,
                    entity_type="PharmacyOrder",
                    entity_id=order.id,
                    metadata={
                        "orderNumber": order.order_number,
                        "operation": "cancel",
                        "automatic": True,
                        "reason": "unpaid" if unpaid else "prescription_not_cleared",
                        "invoice": outcome,
                    },
                ),
            )
            released += 1
        await db.commit()

    if released:
        logger.info("lapsed_pharmacy_orders_released", count=released)
    return released


#: The two moments an unpaid invoice is worth mentioning, and the metadata key
#: that records having mentioned it. Both are held in one place because the
#: idempotence check and the sending loop have to agree on the spelling.
DUE_SOON = "due_soon"
OVERDUE = "overdue"


async def _already_reminded(db: AsyncSession, invoice_ids: list[str], kind: str) -> set[str]:
    """Which of these have had this particular reminder already.

    The notification row *is* the record. There is no "reminded" column to keep
    in step, and a pass that runs every minute must be able to ask "did I
    already say this" cheaply — asking the thing it wrote is the cheapest
    truthful answer available.

    Keyed on the pair, not on the invoice: an invoice that got the day-before
    nudge must still be able to get the overdue notice.
    """
    if not invoice_ids:
        return set()
    return set(
        (
            await db.execute(
                select(Notification.notification_metadata["invoiceId"].astext).where(
                    Notification.type == NotificationType.INVOICE_ISSUED,
                    Notification.notification_metadata["reminder"].astext == kind,
                    Notification.notification_metadata["invoiceId"].astext.in_(invoice_ids),
                )
            )
        )
        .scalars()
        .all()
    )


async def schedule_invoice_reminders() -> int:
    """Nudge before the due date, and report the charge once it has passed.

    Two passes over the same set. An invoice is eligible for the first while its
    due date is within the next day, and for the second once that date is behind
    it — so a bill created with less than a day to run can legitimately get both,
    in order, which is better than silently skipping the warning.

    Only ISSUED invoices, and only ones with nothing awaiting review: chasing
    somebody who has already transferred and is waiting on the hospital's own
    queue is the system blaming them for its own backlog.
    """
    from app.modules.billing import service as billing
    from app.modules.notifications.service import notify

    created = 0
    now = utcnow()

    async with SessionFactory() as db:
        rows = (
            await db.execute(
                select(Invoice, Patient.user_id, User.name, User.email, Appointment.mode)
                .join(Patient, Patient.id == Invoice.patient_id)
                .join(User, User.id == Patient.user_id)
                .outerjoin(Appointment, Appointment.id == Invoice.appointment_id)
                .where(
                    # A pharmacy order has its own timeline — it is cancelled
                    # and its stock released if it goes unpaid — and nagging
                    # about it as a debt would contradict that.
                    Invoice.kind == InvoiceKind.CONSULTATION,
                    Invoice.status == InvoiceStatus.ISSUED,
                    Invoice.due_at.is_not(None),
                    # Nothing older than a week: an invoice nobody has paid in a
                    # month is a debt for a person to chase, not a mail loop.
                    Invoice.due_at > now - timedelta(days=7),
                    Invoice.due_at < now + timedelta(days=1),
                    ~select(Payment.id)
                    .where(
                        Payment.invoice_id == Invoice.id,
                        Payment.status == PaymentStatus.SUBMITTED,
                    )
                    .exists(),
                )
                .limit(BATCH_SIZE)
            )
        ).all()
        if not rows:
            return 0

        ids = [row[0].id for row in rows]
        sent_soon = await _already_reminded(db, ids, DUE_SOON)
        sent_late = await _already_reminded(db, ids, OVERDUE)

        for invoice, user_id, name, address, mode in rows:
            overdue = billing.is_overdue(invoice)
            kind = OVERDUE if overdue else DUE_SOON
            if invoice.id in (sent_late if overdue else sent_soon):
                continue
            if overdue and mode == AppointmentMode.ONLINE:
                # Due at the call's start, so "overdue" means the call has gone.
                # ``close_lapsed_online_consultations`` voids it instead.
                continue

            if overdue:
                message = email_templates.invoice_overdue(
                    name=name,
                    invoice_number=invoice.invoice_number,
                    currency=invoice.currency,
                    late_fee=str(billing.late_fee_applies(invoice)),
                    amount_due=str(billing.amount_due(invoice)),
                )
                body = (
                    f"Invoice {invoice.invoice_number} is overdue. "
                    f"{invoice.currency} {billing.amount_due(invoice)} is now due."
                )
            else:
                message = email_templates.invoice_due_tomorrow(
                    name=name,
                    invoice_number=invoice.invoice_number,
                    currency=invoice.currency,
                    amount=str(invoice.total_amount),
                    late_fee=str(invoice.late_fee),
                )
                body = (
                    f"Invoice {invoice.invoice_number} for {invoice.currency} "
                    f"{invoice.total_amount} is due tomorrow."
                )

            await notify(
                db,
                user_id=user_id,
                notification_type=NotificationType.INVOICE_ISSUED,
                title="Invoice overdue" if overdue else "Invoice due tomorrow",
                body=body,
                link="/patient/billing",
                # The metadata is the idempotence record. Written before the
                # mail goes out, so a crash between the two costs a reminder
                # rather than sending one every minute forever.
                metadata={"invoiceId": invoice.id, "reminder": kind},
                email=False,
            )
            await email_service.send(
                to=address,
                subject=message.subject,
                text_body=message.text,
                html_body=message.html,
            )
            created += 1

        await db.commit()

    if created:
        logger.info("invoice_reminders_sent", count=created)
    return created


#: How late a medication reminder may still be sent. A dose reminder that
#: arrives four hours after the time somebody chose is not a reminder — it is a
#: prompt to take a second dose. Past this the pass skips it, and the next one
#: goes out at the next scheduled time.
MEDICATION_GRACE = timedelta(minutes=30)


async def claim_pending_push(db: AsyncSession, limit: int = BATCH_SIZE) -> list[Notification]:
    """Take a batch of push rows, locked against other workers."""
    return list(
        (
            await db.execute(
                select(Notification)
                .where(
                    Notification.channel == NotificationChannel.PUSH,
                    Notification.status == NotificationStatus.PENDING,
                )
                .order_by(Notification.priority.desc(), Notification.created_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )


async def deliver_push(db: AsyncSession, notification: Notification) -> bool:
    """Fan one queued message out to every device this user has enrolled.

    One row, many devices — so "did it work" needs a definition. It is *any*
    device: somebody with a phone and a laptop has been reminded once the phone
    buzzes, and failing the row because the laptop is asleep would retry a
    message they have already seen.

    Endpoints the push service reports as gone are deleted here rather than
    left to accumulate. This is the only place we ever learn a subscription
    died, because the browser that dropped it cannot tell us.
    """
    rows = (
        (
            await db.execute(
                select(PushSubscription).where(
                    PushSubscription.user_id == notification.user_id,
                    PushSubscription.failed_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )

    if not rows:
        # Every device is gone. Nothing to retry, so this is final rather than
        # left PENDING to expire slowly.
        notification.status = NotificationStatus.FAILED
        notification.failed_at = utcnow()
        notification.error = "no device enrolled"
        return False

    meta = notification.notification_metadata or {}
    results = await asyncio.gather(
        *(
            push_service.send(
                push_service.Subscription(
                    id=row.id, endpoint=row.endpoint, p256dh=row.p256dh, auth=row.auth
                ),
                title=notification.title,
                body=notification.body,
                link=notification.link,
                # Grouped so a phone replaces rather than stacks: three days of
                # the same reminder should be one line on a lock screen.
                tag=f"{notification.type}:{meta.get('reminderId') or notification.id}",
            )
            for row in rows
        )
    )

    delivered = 0
    dead: list[str] = []
    for row, result in zip(rows, results, strict=True):
        if result.ok:
            delivered += 1
            row.last_seen_at = utcnow()
        elif result.gone:
            dead.append(row.id)

    if dead:
        await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(dead)))

    if delivered:
        notification.status = NotificationStatus.SENT
        notification.sent_at = utcnow()
        notification.error = None
        return True

    notification.failed_at = utcnow()
    notification.error = "no device accepted the message"
    if utcnow() - notification.created_at > GIVE_UP_AFTER or len(dead) == len(rows):
        notification.status = NotificationStatus.FAILED
    return False


async def push_pending() -> int:
    """One push pass. Returns how many messages reached at least one device."""
    if not settings.push_enabled:
        return 0

    sent = 0
    async with SessionFactory() as db:
        for row in await claim_pending_push(db):
            if await deliver_push(db, row):
                sent += 1
        await db.commit()

    if sent:
        logger.info("push_batch_sent", count=sent)
    return sent


async def due_medication_reminders(
    db: AsyncSession,
) -> list[tuple[MedicationReminder, str, str, str, str]]:
    """Reminder times that have just come round and have not been sent today.

    Returns (reminder, patient user id, medication, dosage, clinic-local date).

    Two things make this safe to run on a one-minute loop:

    * **The window is one-sided.** Only times between now and
      ``MEDICATION_GRACE`` ago are due, so a reminder set for 20:00 cannot fire
      at 19:00 because a pass ran early.
    * **The date is part of the identity.** "Sent already" is asked per
      reminder *per clinic-local day*, so the same 08:00 goes out tomorrow and
      not twice today — including across a restart, since the answer lives in
      the notification table rather than in this process.
    """
    local = datetime.now(UTC).astimezone(clinic_timezone())
    now_minutes = local.hour * 60 + local.minute
    earliest = now_minutes - int(MEDICATION_GRACE.total_seconds() // 60)
    today = local.date().isoformat()

    rows = (
        (
            await db.execute(
                select(
                    MedicationReminder,
                    Patient.user_id,
                    Prescription.medication,
                    Prescription.dosage,
                )
                .join(Patient, Patient.id == MedicationReminder.patient_id)
                .join(Prescription, Prescription.id == MedicationReminder.prescription_id)
                .where(
                    MedicationReminder.active.is_(True),
                    # A discontinued medicine must stop reminding immediately —
                    # this is the check that makes "stop taking it" stick even
                    # when the reminder rows outlive the decision.
                    Prescription.active.is_(True),
                    MedicationReminder.at_minutes <= now_minutes,
                    MedicationReminder.at_minutes >= earliest,
                )
                .limit(BATCH_SIZE)
            )
        )
        .tuples()
        .all()
    )
    if not rows:
        return []

    ids = [row[0].id for row in rows]
    already = set(
        (
            await db.execute(
                select(Notification.notification_metadata["reminderId"].astext).where(
                    Notification.type == NotificationType.MEDICATION_REMINDER,
                    Notification.notification_metadata["reminderId"].astext.in_(ids),
                    Notification.notification_metadata["on"].astext == today,
                )
            )
        )
        .scalars()
        .all()
    )

    return [
        (reminder, user_id, medication, dosage, today)
        for reminder, user_id, medication, dosage in rows
        if reminder.id not in already
    ]


async def schedule_medication_reminders() -> int:
    """One medication pass. Returns how many reminders were created.

    The wording is deliberately flat — it names the medicine and the dose and
    stops there. A push is read on a lock screen, and anything more would be
    the app giving medical instructions it is not entitled to give.
    """
    from app.modules.notifications.service import notify

    created = 0
    async with SessionFactory() as db:
        for reminder, user_id, medication, dosage, today in await due_medication_reminders(db):
            clock = f"{reminder.at_minutes // 60:02d}:{reminder.at_minutes % 60:02d}"
            await notify(
                db,
                user_id=user_id,
                notification_type=NotificationType.MEDICATION_REMINDER,
                title="Medication reminder",
                body=f"{medication} — {dosage}, scheduled for {clock}.",
                link="/patient/records",
                metadata={
                    "reminderId": reminder.id,
                    "prescriptionId": reminder.prescription_id,
                    "on": today,
                },
                priority=1,
            )
            created += 1
        await db.commit()

    if created:
        logger.info("medication_reminders_created", count=created)
    return created


async def run_once() -> dict[str, int]:
    """One full pass. Separate from the loop so a test can drive it directly."""
    reminders = await schedule_reminders()
    video_calls = await schedule_video_reminders()
    # Before the invoice pass, so a lapsed consultation's bill is voided rather
    # than reported as overdue in the same minute.
    lapsed = await close_lapsed_online_consultations()
    released = await release_lapsed_pharmacy_orders()
    medication = await schedule_medication_reminders()
    invoices = await schedule_invoice_reminders()
    sent = await send_pending()
    pushed = await push_pending()
    return {
        "reminders": reminders,
        "videoReminders": video_calls,
        "lapsedConsultations": lapsed,
        "lapsedOrders": released,
        "medication": medication,
        "invoices": invoices,
        "sent": sent,
        "pushed": pushed,
    }


async def loop() -> None:
    """The background task. Runs until cancelled at shutdown.

    Every pass is wrapped: a failure here must not kill the loop, or one bad
    row would silently stop all delivery until the next restart.
    """
    logger.info("notification_dispatcher_started", interval_seconds=INTERVAL_SECONDS)
    try:
        while True:
            try:
                await run_once()
            except Exception:
                logger.exception("notification_dispatch_failed")
            await asyncio.sleep(INTERVAL_SECONDS)
    except asyncio.CancelledError:
        logger.info("notification_dispatcher_stopped")
        raise


def should_run() -> bool:
    """Whether to start the loop at all.

    Off in tests: a background task making SMTP connections during a test run
    would send real mail and make results depend on timing.

    Either channel is reason enough to run. A deployment with push keys and
    no SMTP still owes its patients their medication reminders.
    """
    return (settings.email_configured or settings.push_enabled) and not settings.is_test


def should_run_loop() -> bool:
    """Whether to start the *background loop*, as opposed to being able to run a pass.

    The two questions are different, and conflating them was tempting enough to
    be worth a name of its own. ``should_run`` asks whether a pass would deliver
    anything — the dispatch endpoint asks that too. This asks whether this
    process is the kind that can hold a loop for an hour.

    On a serverless platform it cannot: the function is frozen between requests,
    so the loop gets one tick and then nothing. Starting it there would spend
    the invocation's remaining time on a pass nobody asked for and still deliver
    on no schedule. ``POST /api/internal/dispatch`` is the answer instead, driven
    by an external scheduler.

    ``VERCEL`` is set by the platform itself, so this needs no configuration and
    cannot be got wrong by a deployment that forgot a variable.
    """
    return should_run() and not os.getenv("VERCEL")


def start() -> Any:
    """Start the dispatcher, returning the task so lifespan can cancel it."""
    return asyncio.create_task(loop())
