"""Medicine orders, from the cart to the door.

    cart ── quote ── place ─┬─ needs a prescription ── PENDING_RX ──┐
                            │                                       │ cleared
                            ├─ online payment ── AWAITING_PAYMENT ◄─┤
                            │                         │ paid        │
                            └─ cash on delivery ──────┴─► CONFIRMED ◄┘
                                                             │
                                   PACKED ── DISPATCHED ── DELIVERED

Four rules carry this module.

**The server prices the order.** The browser's cart says which products and how
many — nothing else is read from it. Prices, the delivery fee and the total are
computed here from the catalog as it stands, so a cart edited in developer tools
buys nothing cheaper.

**Stock is taken when the order is placed**, with a guarded UPDATE per line, and
given back if the order is cancelled. The last strip of something cannot be sold
twice, and an order waiting on a prescription keeps its medicine rather than
discovering at approval that somebody else bought it.

**Prescriptions are cleared before money is asked for.** An order holding
prescription-only medicine that no MediNova doctor prescribed waits in
``PENDING_RX`` with no invoice at all. A refused prescription therefore never
needs a refund — nothing was ever paid.

**A prescription-only line is covered by exactly three things**: the patient's
own current prescription from a MediNova doctor, a prescription photo the
pharmacy has checked, or the approval of a MediNova doctor who actually treats
this patient. "I need it" is not on the list.
"""

from __future__ import annotations

import re
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, text, union, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import bad_request, conflict, not_found
from app.db.base import new_id, utcnow
from app.db.enums import (
    ENCOUNTER_STATUSES,
    InvoiceKind,
    InvoiceStatus,
    NotificationType,
    PaymentMethod,
    PaymentStatus,
    PharmacyOrderStatus,
    PharmacyPaymentMethod,
    RxRoute,
    RxStatus,
    UserStatus,
)
from app.db.models import (
    Appointment,
    Doctor,
    DoctorPatientAssignment,
    Invoice,
    Patient,
    Payment,
    PharmacyOrder,
    PharmacyOrderItem,
    PharmacyProduct,
    PharmacySettings,
    Prescription,
    User,
)
from app.modules.billing import service as billing
from app.modules.notifications.service import notify
from app.modules.pharmacy.catalog import prescribes, serialize_product

#: How long an order may wait for its online payment before the medicine goes
#: back on the shelf. Two days covers a weekend's wait for a wallet transfer
#: and is short enough that reserved stock does not rot in somebody's cart.
PAYMENT_WINDOW = timedelta(hours=48)

#: How long an order may wait for its prescription to be cleared.
RX_WINDOW = timedelta(hours=72)

#: A prescription older than this does not buy medicine, however long its
#: course. Six months is the common rule for a repeat at a Pakistani pharmacy,
#: and a two-year-old antibiotic prescription is not a prescription.
PRESCRIPTION_VALID_FOR = timedelta(days=180)

MAX_LINES = 25
MAX_QUANTITY = 20

#: Statuses an order can still be cancelled from. Once the rider has it, it is
#: delivered or refused at the door.
CANCELLABLE = (
    PharmacyOrderStatus.PENDING_RX,
    PharmacyOrderStatus.AWAITING_PAYMENT,
    PharmacyOrderStatus.CONFIRMED,
    PharmacyOrderStatus.PACKED,
)

#: Still going somewhere. Used for "my open orders" and the dashboard.
OPEN = (*CANCELLABLE, PharmacyOrderStatus.DISPATCHED)


def normalize_phone(value: str) -> str:
    """A Pakistani mobile number in its local form, ``03XXXXXXXXX``.

    Riders call from a phone, and the number on the parcel has to be one the
    courier's system dials. ``+92 300 1234567``, ``0300-1234567`` and
    ``923001234567`` are all the same number and all become ``03001234567``.
    """
    digits = re.sub(r"\D", "", value)
    if digits.startswith("92") and len(digits) == 12:
        digits = "0" + digits[2:]
    elif digits.startswith("3") and len(digits) == 10:
        digits = "0" + digits
    if not re.fullmatch(r"03\d{9}", digits):
        raise ValueError("enter a Pakistani mobile number, e.g. 0300 1234567")
    return digits


class CartLine(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    product_id: Annotated[str, Field(min_length=1, max_length=64)] = Field(alias="productId")
    quantity: Annotated[int, Field(ge=1, le=MAX_QUANTITY)] = 1
    #: The patient's own prescription this line is bought against, when they
    #: chose it. Checked, never trusted — see ``price``.
    prescription_id: Annotated[str, Field(max_length=64)] | None = Field(
        default=None, alias="prescriptionId"
    )


class QuoteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    items: Annotated[list[CartLine], Field(min_length=1, max_length=MAX_LINES)]
    payment_method: PharmacyPaymentMethod | None = Field(default=None, alias="paymentMethod")


class CheckoutRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    items: Annotated[list[CartLine], Field(min_length=1, max_length=MAX_LINES)]
    payment_method: PharmacyPaymentMethod = Field(alias="paymentMethod")
    recipient_name: Annotated[str, Field(min_length=2, max_length=120)] = Field(alias="recipientName")
    phone: Annotated[str, Field(min_length=10, max_length=20)]
    address_line: Annotated[str, Field(min_length=8, max_length=300)] = Field(alias="addressLine")
    city: Annotated[str, Field(min_length=2, max_length=80)]
    delivery_notes: Annotated[str, Field(max_length=300)] | None = Field(
        default=None, alias="deliveryNotes"
    )
    #: How uncovered prescription-only medicine will be cleared. Ignored when
    #: nothing in the cart needs it.
    rx_route: RxRoute | None = Field(default=None, alias="rxRoute")
    rx_doctor_id: Annotated[str, Field(max_length=64)] | None = Field(
        default=None, alias="rxDoctorId"
    )

    _phone = field_validator("phone")(normalize_phone)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


async def load_settings(db: AsyncSession) -> PharmacySettings:
    """The delivery rules in force, created on first read if they are missing.

    The migration seeds the row; this covers a database restored without it.
    The insert is ``ON CONFLICT DO NOTHING`` because two pages asking at once
    is the normal case — a storefront and a checkout opening together both
    find nothing, and a plain insert made the second one fail.
    """
    row = await db.get(PharmacySettings, PharmacySettings.SINGLETON)
    if row is None:
        await db.execute(
            pg_insert(PharmacySettings)
            .values(
                id=PharmacySettings.SINGLETON,
                delivery_fee=Decimal("150"),
                free_delivery_above=Decimal("3000"),
                cod_enabled=True,
                cod_max_amount=Decimal("25000"),
                cities=[],
                pharmacy_name="MediNova Pharmacy",
                updated_at=utcnow(),
            )
            .on_conflict_do_nothing(index_elements=["id"])
        )
        row = await db.get(PharmacySettings, PharmacySettings.SINGLETON, populate_existing=True)
        assert row is not None  # inserted above, or by whoever got there first
    return row


def serialize_settings(row: PharmacySettings, *, admin: bool = False) -> dict[str, Any]:
    body: dict[str, Any] = {
        "pharmacyName": row.pharmacy_name,
        "deliveryFee": str(row.delivery_fee),
        "freeDeliveryAbove": str(row.free_delivery_above)
        if row.free_delivery_above is not None
        else None,
        "codEnabled": row.cod_enabled,
        "codMaxAmount": str(row.cod_max_amount) if row.cod_max_amount is not None else None,
        "cities": list(row.cities or []),
        "licenseNumber": row.license_number,
        "phone": row.phone,
        "address": row.address,
        "currency": settings.INVOICE_CURRENCY,
        "paymentWindowHours": int(PAYMENT_WINDOW.total_seconds() // 3600),
    }
    if admin:
        body["updatedAt"] = row.updated_at.isoformat() + "Z" if row.updated_at else None
    return body


def delivery_fee_for(subtotal: Decimal, row: PharmacySettings) -> Decimal:
    if row.free_delivery_above is not None and subtotal >= row.free_delivery_above:
        return Decimal("0.00")
    return Decimal(row.delivery_fee)


# ---------------------------------------------------------------------------
# Who may approve
# ---------------------------------------------------------------------------


def _care_doctor_ids(patient_id: str) -> Any:
    """Doctors with a real care relationship to this patient, as a subquery.

    The same two relationships that open a chart: a standing assignment, or a
    consultation they took. A doctor the patient has never seen cannot approve
    their medicine, however convenient that would be for both of them.
    """
    assigned = select(DoctorPatientAssignment.doctor_id).where(
        DoctorPatientAssignment.patient_id == patient_id,
        DoctorPatientAssignment.ended_at.is_(None),
    )
    treating = select(Appointment.doctor_id).where(
        Appointment.patient_id == patient_id,
        Appointment.status.in_(ENCOUNTER_STATUSES),
    )
    return union(assigned, treating).subquery()


async def approving_doctors(db: AsyncSession, patient_id: str) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(Doctor.id, User.name, Doctor.specialization)
            .join(User, User.id == Doctor.user_id)
            .where(
                Doctor.id.in_(select(_care_doctor_ids(patient_id))),
                User.status == UserStatus.ACTIVE,
            )
            .order_by(User.name)
        )
    ).all()
    return [
        {"id": doctor_id, "name": name, "specialization": speciality}
        for doctor_id, name, speciality in rows
    ]


async def may_approve(db: AsyncSession, doctor_id: str, patient_id: str) -> bool:
    return (
        await db.execute(
            select(Doctor.id).where(
                Doctor.id == doctor_id,
                Doctor.id.in_(select(_care_doctor_ids(patient_id))),
            )
        )
    ).first() is not None


# ---------------------------------------------------------------------------
# Pricing
# ---------------------------------------------------------------------------


async def valid_prescriptions(db: AsyncSession, patient_id: str) -> list[Prescription]:
    """The patient's prescriptions that can still buy medicine.

    Active, inside their course if it has an end, and written within
    ``PRESCRIPTION_VALID_FOR``. A discontinued medicine is not a repeat.
    """
    now = utcnow()
    return list(
        (
            await db.execute(
                select(Prescription)
                .where(
                    Prescription.patient_id == patient_id,
                    Prescription.active.is_(True),
                    Prescription.created_at >= now - PRESCRIPTION_VALID_FOR,
                    (Prescription.end_date.is_(None)) | (Prescription.end_date >= now),
                )
                .order_by(Prescription.created_at.desc())
            )
        )
        .scalars()
        .all()
    )


@dataclass
class PricedLine:
    product: PharmacyProduct
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    #: The patient's own prescription that covers it, if it needs one.
    prescription: Prescription | None = None
    problem: str | None = None

    @property
    def needs_rx(self) -> bool:
        """Prescription-only and not covered by one of the patient's own."""
        return self.product.rx_required and self.prescription is None


@dataclass
class Quote:
    lines: list[PricedLine]
    subtotal: Decimal
    delivery_fee: Decimal
    total: Decimal
    problems: list[str] = field(default_factory=list)

    @property
    def needs_rx(self) -> bool:
        return any(line.needs_rx for line in self.lines)

    @property
    def has_rx_items(self) -> bool:
        return any(line.product.rx_required for line in self.lines)


def _merge(items: list[CartLine]) -> list[CartLine]:
    """One line per product. Two lines of the same strip is one line of two."""
    merged: OrderedDict[str, CartLine] = OrderedDict()
    for item in items:
        if item.product_id in merged:
            existing = merged[item.product_id]
            existing.quantity = min(existing.quantity + item.quantity, MAX_QUANTITY)
            existing.prescription_id = existing.prescription_id or item.prescription_id
        else:
            merged[item.product_id] = item.model_copy()
    return list(merged.values())


def _label(product: PharmacyProduct) -> str:
    return " ".join(filter(None, (product.name, product.strength)))


async def price(
    db: AsyncSession, patient_id: str, items: list[CartLine], row: PharmacySettings
) -> Quote:
    """What this cart costs and what stands in its way, from the catalog alone."""
    items = _merge(items)
    ids = [item.product_id for item in items]
    products = {
        p.id: p
        for p in (
            await db.execute(select(PharmacyProduct).where(PharmacyProduct.id.in_(ids)))
        )
        .scalars()
        .all()
    }
    prescriptions = await valid_prescriptions(db, patient_id)
    by_id = {p.id: p for p in prescriptions}

    lines: list[PricedLine] = []
    problems: list[str] = []
    for item in items:
        product = products.get(item.product_id)
        if product is None or not product.active:
            problems.append("A medicine in your cart is no longer sold. Remove it to continue.")
            continue

        unit = Decimal(product.price)
        line = PricedLine(
            product=product,
            quantity=item.quantity,
            unit_price=unit,
            line_total=unit * item.quantity,
        )
        if product.stock < item.quantity:
            line.problem = (
                f"{_label(product)} is out of stock."
                if product.stock <= 0
                else f"Only {product.stock} of {_label(product)} left."
            )
            problems.append(line.problem)

        if product.rx_required:
            if item.prescription_id:
                chosen = by_id.get(item.prescription_id)
                if chosen is None or not prescribes(chosen, product):
                    # Not "invalid id": the patient picked a prescription from
                    # a list, and what they need to know is that it does not
                    # count for this medicine.
                    line.problem = (
                        f"The prescription you chose does not cover {_label(product)}."
                    )
                    problems.append(line.problem)
                else:
                    line.prescription = chosen
            else:
                line.prescription = next(
                    (p for p in prescriptions if prescribes(p, product)), None
                )
        lines.append(line)

    subtotal = sum((line.line_total for line in lines), Decimal("0.00"))
    fee = delivery_fee_for(subtotal, row) if lines else Decimal("0.00")
    return Quote(
        lines=lines,
        subtotal=subtotal,
        delivery_fee=fee,
        total=subtotal + fee,
        problems=problems,
    )


def cod_refusal(total: Decimal, row: PharmacySettings) -> str | None:
    """Why cash on delivery is not available for this total, if it is not."""
    if not row.cod_enabled:
        return "Cash on delivery is not available at the moment. Pay online instead."
    if row.cod_max_amount is not None and total > row.cod_max_amount:
        return (
            f"Cash on delivery is available for orders up to {settings.INVOICE_CURRENCY} "
            f"{row.cod_max_amount}. Pay online for this one."
        )
    return None


def city_refusal(city: str, row: PharmacySettings) -> str | None:
    served = [c.strip().lower() for c in row.cities or [] if c.strip()]
    if served and city.strip().lower() not in served:
        return "We do not deliver to that city yet."
    return None


def serialize_quote(quote: Quote, row: PharmacySettings) -> dict[str, Any]:
    return {
        "lines": [
            {
                "product": serialize_product(line.product),
                "quantity": line.quantity,
                "unitPrice": str(line.unit_price),
                "lineTotal": str(line.line_total),
                "rxRequired": line.product.rx_required,
                "coveredBy": (
                    {
                        "prescriptionId": line.prescription.id,
                        "medication": line.prescription.medication,
                        "dosage": line.prescription.dosage,
                    }
                    if line.prescription is not None
                    else None
                ),
                "needsPrescription": line.needs_rx,
                "problem": line.problem,
            }
            for line in quote.lines
        ],
        "subtotal": str(quote.subtotal),
        "deliveryFee": str(quote.delivery_fee),
        "total": str(quote.total),
        "currency": settings.INVOICE_CURRENCY,
        "needsPrescription": quote.needs_rx,
        "problems": quote.problems,
        "codAvailable": cod_refusal(quote.total, row) is None,
        "codRefusal": cod_refusal(quote.total, row),
        "freeDeliveryAbove": str(row.free_delivery_above)
        if row.free_delivery_above is not None
        else None,
    }


# ---------------------------------------------------------------------------
# Placing
# ---------------------------------------------------------------------------


async def next_order_number(db: AsyncSession) -> str:
    value = (await db.execute(text("SELECT nextval('pharmacy_order_number_seq')"))).scalar_one()
    return f"ORD-{utcnow().year}-{value:06d}"


async def _reserve(db: AsyncSession, line: PricedLine) -> None:
    """Take this line's stock, or refuse if somebody got there first."""
    taken = (
        await db.execute(
            update(PharmacyProduct)
            .where(
                PharmacyProduct.id == line.product.id,
                PharmacyProduct.active.is_(True),
                PharmacyProduct.stock >= line.quantity,
            )
            .values(stock=PharmacyProduct.stock - line.quantity, updated_at=utcnow())
            .returning(PharmacyProduct.stock)
        )
    ).scalar_one_or_none()
    if taken is None:
        raise conflict(f"{_label(line.product)} has just gone out of stock.")


async def release_stock(db: AsyncSession, order: PharmacyOrder) -> None:
    """Put a cancelled order's medicine back on the shelf."""
    for item in order.items:
        if item.product_id is None:
            continue  # the product itself was deleted; there is no shelf
        await db.execute(
            update(PharmacyProduct)
            .where(PharmacyProduct.id == item.product_id)
            .values(stock=PharmacyProduct.stock + item.quantity, updated_at=utcnow())
        )


async def place(db: AsyncSession, patient_id: str, request: CheckoutRequest) -> PharmacyOrder:
    row = await load_settings(db)

    refusal = city_refusal(request.city, row)
    if refusal:
        raise bad_request(refusal)

    quote = await price(db, patient_id, request.items, row)
    if quote.problems:
        raise conflict(quote.problems[0])

    if request.payment_method == PharmacyPaymentMethod.COD:
        refusal = cod_refusal(quote.total, row)
        if refusal:
            raise bad_request(refusal)

    route: RxRoute | None = None
    if quote.needs_rx:
        if request.rx_route not in (RxRoute.UPLOAD, RxRoute.DOCTOR):
            raise bad_request(
                "Some of these medicines need a prescription. Upload a photo of one, "
                "or ask a MediNova doctor you have seen to approve them."
            )
        route = request.rx_route
        if route == RxRoute.DOCTOR and (
            not request.rx_doctor_id
            or not await may_approve(db, request.rx_doctor_id, patient_id)
        ):
            raise bad_request(
                "Choose a doctor who has treated you on MediNova to approve this order."
            )
    elif quote.has_rx_items:
        route = RxRoute.PRESCRIBED

    for line in quote.lines:
        await _reserve(db, line)

    if quote.needs_rx:
        status = PharmacyOrderStatus.PENDING_RX
    elif request.payment_method == PharmacyPaymentMethod.ONLINE:
        status = PharmacyOrderStatus.AWAITING_PAYMENT
    else:
        status = PharmacyOrderStatus.CONFIRMED

    now = utcnow()
    order = PharmacyOrder(
        id=new_id(),
        order_number=await next_order_number(db),
        patient_id=patient_id,
        status=status,
        payment_method=request.payment_method,
        recipient_name=request.recipient_name,
        phone=request.phone,
        address_line=request.address_line,
        city=request.city.strip(),
        delivery_notes=request.delivery_notes or None,
        subtotal=quote.subtotal,
        delivery_fee=quote.delivery_fee,
        total=quote.total,
        currency=settings.INVOICE_CURRENCY,
        rx_status=(
            RxStatus.PENDING
            if quote.needs_rx
            else RxStatus.APPROVED
            if quote.has_rx_items
            else RxStatus.NOT_REQUIRED
        ),
        rx_route=route,
        rx_doctor_id=request.rx_doctor_id if route == RxRoute.DOCTOR else None,
        confirmed_at=now if status == PharmacyOrderStatus.CONFIRMED else None,
        items=[
            PharmacyOrderItem(
                id=new_id(),
                product_id=line.product.id,
                product_name=line.product.name,
                generic_name=line.product.generic_name,
                strength=line.product.strength,
                form=str(line.product.form),
                pack_size=line.product.pack_size,
                unit_price=line.unit_price,
                unit_cost=line.product.cost_price,
                quantity=line.quantity,
                line_total=line.line_total,
                rx_required=line.product.rx_required,
                prescription_id=line.prescription.id if line.prescription else None,
            )
            for line in quote.lines
        ],
    )
    db.add(order)
    await db.flush()

    if status == PharmacyOrderStatus.AWAITING_PAYMENT:
        await issue_invoice(db, order)
    return order


# ---------------------------------------------------------------------------
# Money
# ---------------------------------------------------------------------------


async def issue_invoice(db: AsyncSession, order: PharmacyOrder) -> Invoice:
    """The order's bill, once there is something to pay.

    For online payment that is as soon as nothing stands in the way; for cash
    on delivery, at dispatch, so the parcel can carry it. One per order, ever.

    No tax line: medicines are exempt from sales tax in Pakistan, and a tax
    charged in error is a refund owed to every customer. Should that change,
    it belongs in pharmacy settings rather than in a constant here.
    """
    if order.invoice_id is not None:
        existing = await db.get(Invoice, order.invoice_id)
        if existing is not None:
            return existing

    online = order.payment_method == PharmacyPaymentMethod.ONLINE
    lines = [
        {
            "description": " ".join(
                filter(None, (item.product_name, item.strength, f"({item.pack_size})"))
            ),
            "quantity": item.quantity,
            "unitPrice": str(item.unit_price),
            "amount": str(item.line_total),
        }
        for item in order.items
    ]
    lines.append(
        {
            "description": "Home delivery",
            "quantity": 1,
            "unitPrice": str(order.delivery_fee),
            "amount": str(order.delivery_fee),
        }
    )

    invoice = Invoice(
        id=new_id(),
        patient_id=order.patient_id,
        appointment_id=None,
        kind=InvoiceKind.PHARMACY,
        invoice_number=await billing.next_invoice_number(db),
        amount=order.total,
        tax_amount=Decimal("0"),
        total_amount=order.total,
        platform_fee=Decimal("0"),
        tax_percent=Decimal("0"),
        late_fee=Decimal("0"),
        currency=order.currency,
        status=InvoiceStatus.ISSUED,
        line_items=lines,
        notes=f"Medicine order {order.order_number}",
        issued_at=utcnow(),
        # Online: the order is released if this passes unpaid. Cash: due at the
        # door, which is not a date anybody can put on a bill in advance.
        due_at=utcnow() + PAYMENT_WINDOW if online else None,
    )
    db.add(invoice)
    await db.flush()
    order.invoice_id = invoice.id
    await db.flush()
    return invoice


async def _awaiting_review(db: AsyncSession, invoice_id: str) -> bool:
    return (
        await db.execute(
            select(Payment.id)
            .where(Payment.invoice_id == invoice_id, Payment.status == PaymentStatus.SUBMITTED)
            .limit(1)
        )
    ).first() is not None


async def on_invoice_paid(db: AsyncSession, invoice: Invoice) -> None:
    """A pharmacy bill was settled: move its order along.

    Called from ``billing.settle``, whichever way the money came in. A payment
    that lands on an order already cancelled — the patient paid, then changed
    their mind before the review — is money the pharmacy now owes back, and the
    order says so rather than silently keeping it.
    """
    if invoice.kind != InvoiceKind.PHARMACY:
        return
    order = (
        await db.execute(select(PharmacyOrder).where(PharmacyOrder.invoice_id == invoice.id))
    ).scalar_one_or_none()
    if order is None:
        return

    if order.status == PharmacyOrderStatus.AWAITING_PAYMENT:
        order.status = PharmacyOrderStatus.CONFIRMED
        order.confirmed_at = utcnow()
        await db.flush()
        await tell_admins(
            db,
            order,
            title=f"Paid: {order.order_number}",
            body=f"{order.currency} {order.total} received. Ready to pack.",
        )
    elif order.status == PharmacyOrderStatus.CANCELLED:
        order.refund_due = True
        await db.flush()
        await tell_admins(
            db,
            order,
            title=f"Refund due: {order.order_number}",
            body="A payment was confirmed for an order that had already been cancelled.",
        )


async def record_cash(db: AsyncSession, order: PharmacyOrder, *, reviewer_id: str) -> Invoice:
    """The rider is back with the cash: the bill is paid.

    Recorded as a payment in the same ledger as wallet transfers, marked as
    cash on delivery and as confirmed by the person who counted it — so the
    day's takings reconcile against one list, not two.
    """
    invoice = await issue_invoice(db, order)
    if invoice.status == InvoiceStatus.PAID:
        return invoice
    db.add(
        Payment(
            id=new_id(),
            invoice_id=invoice.id,
            amount=invoice.total_amount,
            currency=invoice.currency,
            method=PaymentMethod.CASH_ON_DELIVERY,
            status=PaymentStatus.SUCCEEDED,
            reference=order.tracking_number or order.order_number,
            reviewed_by_id=reviewer_id,
            reviewed_at=utcnow(),
        )
    )
    billing.mark_paid(invoice)
    await db.flush()
    await billing.settle(db, invoice, currency=invoice.currency, amount=invoice.total_amount)
    return invoice


# ---------------------------------------------------------------------------
# Moving an order along
# ---------------------------------------------------------------------------


async def load(db: AsyncSession, order_id: str, *, lock: bool = False) -> PharmacyOrder:
    """One order, locked for the rest of the transaction when it is about to move.

    The lock is what stops two administrators — or an administrator and the
    expiry sweep — moving the same order two ways at once: the second waits,
    then sees the first one's result.
    """
    query = select(PharmacyOrder).where(PharmacyOrder.id == order_id)
    if lock:
        query = query.with_for_update()
    order = (await db.execute(query)).scalar_one_or_none()
    if order is None:
        raise not_found("Order")
    return order


async def clear_prescription(
    db: AsyncSession, order: PharmacyOrder, *, reviewer_id: str, note: str | None
) -> None:
    """The prescription is accepted: the order goes on to payment or packing."""
    order.rx_status = RxStatus.APPROVED
    order.rx_reviewed_by_id = reviewer_id
    order.rx_reviewed_at = utcnow()
    order.rx_note = note
    if order.payment_method == PharmacyPaymentMethod.ONLINE:
        order.status = PharmacyOrderStatus.AWAITING_PAYMENT
        await db.flush()
        await issue_invoice(db, order)
    else:
        order.status = PharmacyOrderStatus.CONFIRMED
        order.confirmed_at = utcnow()
        await db.flush()


async def refuse_prescription(
    db: AsyncSession, order: PharmacyOrder, *, reviewer_id: str, note: str
) -> None:
    order.rx_status = RxStatus.REJECTED
    order.rx_reviewed_by_id = reviewer_id
    order.rx_reviewed_at = utcnow()
    order.rx_note = note
    await cancel(db, order, by=reviewer_id, reason=f"Prescription not accepted: {note}")


async def cancel(
    db: AsyncSession, order: PharmacyOrder, *, by: str | None, reason: str
) -> str | None:
    """Stop an order before it leaves. Returns what happened to its bill.

    The medicine goes back on the shelf. The bill follows the rule consultations
    use: unpaid is voided, paid is flagged for a refund and stays on the
    administrator's list until it is made, and one with a payment awaiting
    review is left for the reviewer.
    """
    if order.status not in CANCELLABLE:
        raise conflict(
            "This order has already left the pharmacy and can no longer be cancelled."
            if order.status == PharmacyOrderStatus.DISPATCHED
            else "This order can no longer be cancelled."
        )

    order.status = PharmacyOrderStatus.CANCELLED
    order.cancelled_at = utcnow()
    order.cancelled_by = by
    order.cancel_reason = reason[:300]
    await release_stock(db, order)

    outcome: str | None = None
    if order.invoice_id:
        invoice = await db.get(Invoice, order.invoice_id)
        if invoice is not None and invoice.status in (InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE):
            if await _awaiting_review(db, invoice.id):
                outcome = "review_pending"
                await tell_admins(
                    db,
                    order,
                    title=f"Cancelled with a payment in review: {order.order_number}",
                    body="If you confirm the payment, the order will be marked for a refund.",
                )
            else:
                billing.void(invoice, f"Order {order.order_number} cancelled")
                outcome = "voided"
        elif invoice is not None and invoice.status == InvoiceStatus.PAID:
            order.refund_due = True
            outcome = "refund_due"
            await tell_admins(
                db,
                order,
                title=f"Refund due: {order.order_number}",
                body=f"A paid order was cancelled. {order.currency} {order.total} is owed back.",
            )
    await db.flush()
    return outcome


async def refund(db: AsyncSession, order: PharmacyOrder, reason: str) -> Invoice:
    """Record that a cancelled order's money went back, with a credit note."""
    if not order.refund_due or order.invoice_id is None:
        raise conflict("This order has no refund outstanding.")
    invoice = await db.get(Invoice, order.invoice_id)
    if invoice is None:
        raise conflict("This order's invoice no longer exists.")
    note = await billing.credit_note(db, invoice, reason)
    order.refund_due = False
    await db.flush()
    return note


# ---------------------------------------------------------------------------
# Telling people
# ---------------------------------------------------------------------------


async def tell_patient(
    db: AsyncSession, order: PharmacyOrder, *, title: str, body: str, email: bool | None = None
) -> None:
    """Order news for the patient. Never the medicines' names: a notification
    reaches a lock screen, and what somebody is being treated for is not the
    lock screen's business."""
    if order.patient_id is None:
        return
    user_id = (
        await db.execute(select(Patient.user_id).where(Patient.id == order.patient_id))
    ).scalar_one_or_none()
    await notify(
        db,
        user_id=user_id,
        notification_type=NotificationType.PHARMACY_ORDER,
        title=title,
        body=body,
        link=f"/patient/pharmacy/orders/{order.id}",
        metadata={"orderId": order.id},
        email=email,
    )


async def tell_admins(db: AsyncSession, order: PharmacyOrder, *, title: str, body: str) -> None:
    await billing.notify_admins(
        db,
        title=title,
        body=body,
        link=f"/admin/pharmacy/orders/{order.id}",
        metadata={"orderId": order.id},
        notification_type=NotificationType.PHARMACY_ORDER,
    )


async def tell_doctor(db: AsyncSession, order: PharmacyOrder) -> None:
    """Ask the chosen doctor to approve."""
    if order.rx_doctor_id is None:
        return
    user_id = (
        await db.execute(select(Doctor.user_id).where(Doctor.id == order.rx_doctor_id))
    ).scalar_one_or_none()
    await notify(
        db,
        user_id=user_id,
        notification_type=NotificationType.PHARMACY_ORDER,
        title="A patient asks you to approve medicine",
        body=f"Order {order.order_number} is waiting for your approval.",
        link="/doctor/approvals",
        metadata={"orderId": order.id},
    )


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() + "Z" if value else None


def timeline(order: PharmacyOrder) -> list[dict[str, Any]]:
    """The steps an order has taken and has still to take, for a tracker."""
    steps: list[dict[str, Any]] = [
        {"key": "PLACED", "at": _iso(order.created_at), "done": True},
    ]
    if order.rx_route in (RxRoute.UPLOAD, RxRoute.DOCTOR):
        steps.append(
            {
                "key": "PRESCRIPTION",
                "at": _iso(order.rx_reviewed_at),
                "done": order.rx_status == RxStatus.APPROVED,
                "failed": order.rx_status == RxStatus.REJECTED,
            }
        )
    if order.payment_method == PharmacyPaymentMethod.ONLINE:
        steps.append({"key": "PAID", "at": _iso(order.confirmed_at), "done": order.confirmed_at is not None})
    else:
        steps.append(
            {"key": "CONFIRMED", "at": _iso(order.confirmed_at), "done": order.confirmed_at is not None}
        )
    steps += [
        {"key": "PACKED", "at": _iso(order.packed_at), "done": order.packed_at is not None},
        {"key": "DISPATCHED", "at": _iso(order.dispatched_at), "done": order.dispatched_at is not None},
        {"key": "DELIVERED", "at": _iso(order.delivered_at), "done": order.delivered_at is not None},
    ]
    if order.status == PharmacyOrderStatus.CANCELLED:
        steps.append({"key": "CANCELLED", "at": _iso(order.cancelled_at), "done": True})
    return steps


def serialize_order(
    order: PharmacyOrder,
    *,
    admin: bool = False,
    invoice: Invoice | None = None,
    awaiting_review: bool = False,
    patient_name: str | None = None,
    doctor_name: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": order.id,
        "orderNumber": order.order_number,
        "status": str(order.status),
        "paymentMethod": str(order.payment_method),
        "recipientName": order.recipient_name,
        "phone": order.phone,
        "addressLine": order.address_line,
        "city": order.city,
        "deliveryNotes": order.delivery_notes,
        "subtotal": str(order.subtotal),
        "deliveryFee": str(order.delivery_fee),
        "total": str(order.total),
        "currency": order.currency,
        "rxStatus": str(order.rx_status),
        "rxRoute": str(order.rx_route) if order.rx_route else None,
        "rxNote": order.rx_note,
        "hasRxUpload": order.rx_upload_path is not None,
        "rxDoctorId": order.rx_doctor_id,
        "rxDoctorName": doctor_name,
        "courier": order.courier,
        "trackingNumber": order.tracking_number,
        "cancelReason": order.cancel_reason,
        "refundDue": order.refund_due,
        "canCancel": order.status in CANCELLABLE,
        "createdAt": _iso(order.created_at),
        "confirmedAt": _iso(order.confirmed_at),
        "dispatchedAt": _iso(order.dispatched_at),
        "deliveredAt": _iso(order.delivered_at),
        "cancelledAt": _iso(order.cancelled_at),
        "timeline": timeline(order),
        "items": [
            {
                "id": item.id,
                "productId": item.product_id,
                "productName": item.product_name,
                "genericName": item.generic_name,
                "strength": item.strength,
                "form": item.form,
                "packSize": item.pack_size,
                "unitPrice": str(item.unit_price),
                "quantity": item.quantity,
                "lineTotal": str(item.line_total),
                "rxRequired": item.rx_required,
                "coveredByPrescription": item.prescription_id is not None,
            }
            for item in order.items
        ],
        "invoice": (
            billing.serialize(invoice, awaiting_review=awaiting_review)
            if invoice is not None
            else None
        ),
    }
    if admin:
        body["patientId"] = order.patient_id
        body["patientName"] = patient_name
    return body
