"""The MediNova pharmacy: catalog, orders, prescriptions and delivery.

Three audiences, one set of tables, and the split between them is the design:

* **Patients** browse, order for themselves, and see only their own orders —
  the patient id comes from the session, never from a request.
* **Doctors** see one thing: requests to approve medicine, addressed to them, from
  patients they treat.
* **Administrators** run the shop — stock, prices, orders, delivery — and check
  the prescription photos patients send with an order.

Every write is audited. Order metadata in the trail carries numbers, statuses
and amounts — never the medicines, which say what somebody is being treated for.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select

from app.api.deps import CurrentAuth, DbSession, client_ip, require_permission
from app.api.responses import Page, ok, pagination
from app.core.config import settings
from app.core.errors import bad_request, conflict, forbidden, not_found
from app.core.ratelimit import limit
from app.db.base import new_id, utcnow
from app.db.enums import (
    AuditAction,
    PharmacyOrderStatus,
    PharmacyPaymentMethod,
    Role,
    RxRoute,
    RxStatus,
)
from app.db.models import (
    Doctor,
    Invoice,
    Patient,
    PharmacyOrder,
    PharmacyProduct,
    Prescription,
    User,
)
from app.modules.audit.service import AuditEntry, record_audit
from app.modules.auth.rbac import Permission
from app.modules.pharmacy import catalog, dashboard, orders
from app.services import storage
from app.services.files import FileRejectedError, inspect_upload

router = APIRouter(prefix="/pharmacy", tags=["pharmacy"])

RequireBrowse = Annotated[object, Depends(require_permission(Permission.PHARMACY_BROWSE))]
RequireOrder = Annotated[object, Depends(require_permission(Permission.PHARMACY_ORDER_OWN))]
RequireApprove = Annotated[object, Depends(require_permission(Permission.PHARMACY_RX_APPROVE))]
RequireManage = Annotated[object, Depends(require_permission(Permission.PHARMACY_MANAGE))]

#: Placing orders is cheap to ask for and reserves stock, so it is limited the
#: way any action that holds a shared resource should be.
OrderRateLimit = Annotated[None, Depends(limit(times=10, seconds=60, scope="pharmacy-order"))]
UploadRateLimit = Annotated[None, Depends(limit(times=10, seconds=60, scope="pharmacy-upload"))]

#: What a prescription photo may be. A PDF too: clinics in Pakistan increasingly
#: print prescriptions, and the patient may have been sent one.
RX_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp", "application/pdf"})
MAX_RX_BYTES = 10 * 1024 * 1024
MAX_CSV_BYTES = 2 * 1024 * 1024


async def _audit(
    request: Request,
    db: DbSession,
    auth: CurrentAuth,
    action: AuditAction,
    *,
    entity_type: str,
    entity_id: str,
    patient_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    await record_audit(
        db,
        AuditEntry(
            action=action,
            user_id=auth.user_id,
            actor_role=auth.role,
            patient_id=patient_id,
            entity_type=entity_type,
            entity_id=entity_id,
            ip_address=client_ip(request),
            user_agent=request.headers.get("user-agent"),
            request_id=getattr(request.state, "request_id", None),
            metadata=metadata,
        ),
    )


def _own_patient(auth: CurrentAuth) -> str:
    if auth.role != Role.PATIENT or not auth.patient_id:
        raise forbidden("Only patients can order from the pharmacy.")
    return auth.patient_id


# ---------------------------------------------------------------------------
# The shop window
# ---------------------------------------------------------------------------


@router.get("/info")
async def store_info(auth: CurrentAuth, db: DbSession, _: RequireBrowse) -> dict[str, Any]:
    """Delivery terms and the shelf layout, for the storefront and checkout."""
    row = await orders.load_settings(db)
    return ok(
        {
            "settings": orders.serialize_settings(row),
            "categories": await catalog.categories(db),
        }
    )


@router.get("/products")
async def list_products(
    auth: CurrentAuth,
    db: DbSession,
    page: Annotated[Page, Depends(pagination)],
    _: RequireBrowse,
    search: Annotated[str | None, Query(max_length=100)] = None,
    category: Annotated[str | None, Query(max_length=60)] = None,
    rx_only: Annotated[bool | None, Query(alias="rxRequired")] = None,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
    low_stock: Annotated[bool, Query(alias="lowStock")] = False,
    unreviewed: Annotated[bool, Query(alias="unreviewedPrice")] = False,
) -> dict[str, Any]:
    """The catalog, searchable by brand, generic name or manufacturer.

    Patients and doctors see what is on sale. Administrators can also see what
    is not, and the numbers behind each line.
    """
    admin = auth.has(Permission.PHARMACY_MANAGE)
    filters = catalog.search_filters(
        search=search,
        category=category,
        rx_only=rx_only,
        include_inactive=include_inactive and admin,
    )
    if admin and low_stock:
        filters.append(PharmacyProduct.stock <= PharmacyProduct.low_stock_threshold)
    if admin and unreviewed:
        filters.append(PharmacyProduct.price_reviewed.is_(False))

    total = (
        await db.execute(select(func.count(PharmacyProduct.id)).where(*filters))
    ).scalar_one()
    # In stock first: a patient scrolling for paracetamol should not wade
    # through what they cannot have before reaching what they can.
    rows = (
        (
            await db.execute(
                select(PharmacyProduct)
                .where(*filters)
                .order_by(
                    (PharmacyProduct.stock > 0).desc(),
                    PharmacyProduct.name,
                    PharmacyProduct.strength,
                )
                .limit(page.limit)
                .offset(page.offset)
            )
        )
        .scalars()
        .all()
    )
    return ok([catalog.serialize_product(p, admin=admin) for p in rows], page.meta(total))


@router.get("/products/{product_id}")
async def get_product(
    product_id: str, auth: CurrentAuth, db: DbSession, _: RequireBrowse
) -> dict[str, Any]:
    admin = auth.has(Permission.PHARMACY_MANAGE)
    product = await catalog.get_product(db, product_id)
    if not product.active and not admin:
        raise not_found("Product")
    return ok(catalog.serialize_product(product, admin=admin))


# ---------------------------------------------------------------------------
# Running the catalog
# ---------------------------------------------------------------------------


class StockChange(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    change: Annotated[int, Field(ge=-100_000, le=100_000)]
    reason: Annotated[str, Field(min_length=2, max_length=200)]


Money = Annotated[Decimal, Field(ge=0, le=10_000_000, decimal_places=2)]
City = Annotated[str, Field(min_length=2, max_length=80)]


class SettingsUpdate(BaseModel):
    """Only what is sent changes. ``null`` clears an optional limit — "no free
    delivery", "no cash limit" — which is why absent and null differ here."""

    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    delivery_fee: Money | None = Field(default=None, alias="deliveryFee")
    free_delivery_above: Money | None = Field(default=None, alias="freeDeliveryAbove")
    cod_enabled: bool | None = Field(default=None, alias="codEnabled")
    cod_max_amount: Money | None = Field(default=None, alias="codMaxAmount")
    cities: Annotated[list[City], Field(max_length=200)] | None = None
    pharmacy_name: Annotated[str, Field(min_length=2, max_length=120)] | None = Field(
        default=None, alias="pharmacyName"
    )
    license_number: Annotated[str, Field(max_length=80)] | None = Field(
        default=None, alias="licenseNumber"
    )
    address: Annotated[str, Field(max_length=300)] | None = None
    phone: Annotated[str, Field(max_length=40)] | None = None


@router.post("/products", status_code=201)
async def create_product(
    payload: catalog.ProductInput,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireManage,
) -> dict[str, Any]:
    """Add a medicine. It starts with no stock — receive some to sell it."""
    product = await catalog.create_product(db, payload)
    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_CATALOG_CHANGED,
        entity_type="PharmacyProduct",
        entity_id=product.id,
        metadata={"operation": "create", "price": str(product.price)},
    )
    return ok(catalog.serialize_product(product, admin=True))


@router.patch("/products/{product_id}")
async def update_product(
    product_id: str,
    payload: catalog.ProductUpdate,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireManage,
) -> dict[str, Any]:
    product = await catalog.get_product(db, product_id)
    before = str(product.price)
    changed = await catalog.update_product(db, product, payload)
    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_CATALOG_CHANGED,
        entity_type="PharmacyProduct",
        entity_id=product.id,
        metadata={
            "operation": "update",
            "fields": sorted(changed),
            # A price change is the one edit a reconciliation will ask about.
            **({"priceBefore": before, "priceAfter": str(product.price)} if "price" in changed else {}),
        },
    )
    return ok(catalog.serialize_product(product, admin=True))


@router.post("/products/{product_id}/stock")
async def adjust_stock(
    product_id: str,
    payload: StockChange,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireManage,
) -> dict[str, Any]:
    """Book a delivery in (positive) or write stock off (negative), with a reason."""
    product = await catalog.get_product(db, product_id)
    count = await catalog.adjust_stock(db, product, payload.change)
    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_CATALOG_CHANGED,
        entity_type="PharmacyProduct",
        entity_id=product.id,
        metadata={
            "operation": "stock",
            "change": payload.change,
            "stock": count,
            "reason": payload.reason,
        },
    )
    return ok(catalog.serialize_product(product, admin=True))


@router.post("/products/import")
async def import_products(
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireManage,
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    """Add or update products from a CSV.

    A row naming a product that exists updates it, and a ``stock`` column adds
    to the shelf rather than replacing the count. Rows that cannot be read are
    reported by line and skipped.
    """
    content = await file.read(MAX_CSV_BYTES + 1)
    if len(content) > MAX_CSV_BYTES:
        raise bad_request("That file is too large. Split it into files under 2 MB.")
    result = await catalog.import_csv(db, content)
    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_CATALOG_CHANGED,
        entity_type="PharmacyProduct",
        entity_id="import",
        metadata={
            "operation": "import",
            "created": result.created,
            "updated": result.updated,
            "rejected": len(result.errors or []),
        },
    )
    return ok(
        {"created": result.created, "updated": result.updated, "errors": result.errors or []}
    )


@router.post("/products/starter")
async def load_starter_catalog(
    request: Request, auth: CurrentAuth, db: DbSession, _: RequireManage
) -> dict[str, Any]:
    """Stock the shelves with the starter catalog. Existing products are untouched."""
    result = await catalog.load_starter(db)
    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_CATALOG_CHANGED,
        entity_type="PharmacyProduct",
        entity_id="starter",
        metadata={"operation": "starter", "created": result.created},
    )
    return ok({"created": result.created})


@router.get("/settings")
async def read_settings(auth: CurrentAuth, db: DbSession, _: RequireManage) -> dict[str, Any]:
    return ok(orders.serialize_settings(await orders.load_settings(db), admin=True))


@router.put("/settings")
async def update_settings(
    payload: SettingsUpdate,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireManage,
) -> dict[str, Any]:
    """Change delivery terms or the pharmacy's identity."""
    row = await orders.load_settings(db)
    before = orders.serialize_settings(row)
    sent = payload.model_dump(exclude_unset=True)

    if "delivery_fee" in sent:
        if sent["delivery_fee"] is None:
            raise bad_request("Set a delivery fee, or 0 for free delivery on every order.")
        row.delivery_fee = sent["delivery_fee"]
    if "free_delivery_above" in sent:
        row.free_delivery_above = sent["free_delivery_above"]
    if "cod_max_amount" in sent:
        if sent["cod_max_amount"] is not None and sent["cod_max_amount"] <= 0:
            raise bad_request("A cash on delivery limit must be more than zero. Clear it for none.")
        row.cod_max_amount = sent["cod_max_amount"]
    if sent.get("cod_enabled") is not None:
        row.cod_enabled = bool(sent["cod_enabled"])
    if "cities" in sent and sent["cities"] is not None:
        # De-duplicated case-insensitively, keeping the administrator's spelling.
        seen: dict[str, str] = {}
        for city in sent["cities"]:
            seen.setdefault(city.strip().lower(), city.strip())
        row.cities = sorted(seen.values())
    for key in ("pharmacy_name", "license_number", "address", "phone"):
        if key in sent:
            value = sent[key]
            if key == "pharmacy_name" and not value:
                raise bad_request("The pharmacy needs a name.")
            setattr(row, key, value or None)
    row.updated_at = utcnow()
    row.updated_by_id = auth.user_id
    await db.flush()

    await _audit(
        request,
        db,
        auth,
        AuditAction.CONFIG_CHANGED,
        entity_type="PharmacySettings",
        entity_id=row.id,
        metadata={"before": before, "after": orders.serialize_settings(row)},
    )
    return ok(orders.serialize_settings(row, admin=True))


# ---------------------------------------------------------------------------
# A patient's side
# ---------------------------------------------------------------------------


@router.get("/my-prescriptions")
async def my_prescriptions(
    auth: CurrentAuth, db: DbSession, _: RequireOrder
) -> dict[str, Any]:
    """The patient's current MediNova prescriptions, each matched to the shelf.

    What makes "Order these medicines" one press: every prescription that can
    still buy medicine, with the products it covers. A prescription with no
    match is still listed, so the patient can see it was read and not stocked.
    """
    patient_id = _own_patient(auth)
    prescriptions = await orders.valid_prescriptions(db, patient_id)
    if not prescriptions:
        return ok([])

    doctors: dict[str, str] = dict(
        (
            await db.execute(
                select(Doctor.id, User.name)
                .join(User, User.id == Doctor.user_id)
                .where(Doctor.id.in_({p.doctor_id for p in prescriptions}))
            )
        )
        .tuples()
        .all()
    )
    products = (
        (await db.execute(select(PharmacyProduct).where(PharmacyProduct.active.is_(True))))
        .scalars()
        .all()
    )
    return ok(
        [
            {
                "prescriptionId": p.id,
                "medication": p.medication,
                "dosage": p.dosage,
                "frequency": p.frequency,
                "duration": p.duration,
                "doctorName": doctors.get(p.doctor_id),
                "prescribedAt": p.created_at.isoformat() + "Z",
                "products": [
                    catalog.serialize_product(product)
                    for product in products
                    if catalog.prescribes(p, product)
                ][:6],
            }
            for p in prescriptions
        ]
    )


@router.get("/my-doctors")
async def my_doctors(auth: CurrentAuth, db: DbSession, _: RequireOrder) -> dict[str, Any]:
    """Doctors who could approve this patient's prescription-only medicine."""
    return ok(await orders.approving_doctors(db, _own_patient(auth)))


@router.post("/orders/quote")
async def quote(
    payload: orders.QuoteRequest, auth: CurrentAuth, db: DbSession, _: RequireOrder
) -> dict[str, Any]:
    """Price a cart without placing it — totals, stock and what needs a prescription."""
    patient_id = _own_patient(auth)
    row = await orders.load_settings(db)
    result = await orders.price(db, patient_id, payload.items, row)
    return ok(orders.serialize_quote(result, row))


@router.post("/orders", status_code=201)
async def place_order(
    payload: orders.CheckoutRequest,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireOrder,
    __: OrderRateLimit,
) -> dict[str, Any]:
    """Place an order. The server prices it; the cart only says what and how many."""
    patient_id = _own_patient(auth)
    order = await orders.place(db, patient_id, payload)

    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_ORDER_PLACED,
        entity_type="PharmacyOrder",
        entity_id=order.id,
        patient_id=patient_id,
        metadata={
            "orderNumber": order.order_number,
            "status": str(order.status),
            "total": str(order.total),
            "lines": len(order.items),
            "paymentMethod": str(order.payment_method),
            "rxRoute": str(order.rx_route) if order.rx_route else None,
        },
    )

    amount = f"{order.currency} {order.total}"
    if order.status == PharmacyOrderStatus.PENDING_RX:
        waiting_for = (
            "your doctor's approval."
            if order.rx_route == RxRoute.DOCTOR
            else "your prescription to be checked."
        )
        body = f"Order {order.order_number} is waiting for {waiting_for}"
    elif order.status == PharmacyOrderStatus.AWAITING_PAYMENT:
        body = f"Order {order.order_number} is reserved for you. Pay {amount} to confirm it."
    else:
        body = f"Order {order.order_number} is confirmed. Pay {amount} in cash on delivery."
    await orders.tell_patient(db, order, title="Order placed", body=body)
    await orders.tell_admins(
        db,
        order,
        title=f"New order {order.order_number}",
        body=f"{order.currency} {order.total} · {order.payment_method!s} · {order.city}",
    )
    if order.rx_route == RxRoute.DOCTOR:
        await orders.tell_doctor(db, order)

    return ok(await _detail(db, order, admin=False))


async def _detail(db: DbSession, order: PharmacyOrder, *, admin: bool) -> dict[str, Any]:
    invoice = await db.get(Invoice, order.invoice_id) if order.invoice_id else None
    awaiting = await orders._awaiting_review(db, invoice.id) if invoice is not None else False
    doctor_name = None
    if order.rx_doctor_id:
        doctor_name = (
            await db.execute(
                select(User.name)
                .join(Doctor, Doctor.user_id == User.id)
                .where(Doctor.id == order.rx_doctor_id)
            )
        ).scalar_one_or_none()
    patient_name = None
    if admin and order.patient_id:
        patient_name = (
            await db.execute(
                select(User.name)
                .join(Patient, Patient.user_id == User.id)
                .where(Patient.id == order.patient_id)
            )
        ).scalar_one_or_none()
    return orders.serialize_order(
        order,
        admin=admin,
        invoice=invoice,
        awaiting_review=awaiting,
        patient_name=patient_name,
        doctor_name=doctor_name,
    )


async def _visible_order(
    db: DbSession, auth: CurrentAuth, order_id: str, *, lock: bool = False
) -> PharmacyOrder:
    """An order the caller may see. Someone else's is a 404, not a 403."""
    order = await orders.load(db, order_id, lock=lock)
    if auth.has(Permission.PHARMACY_MANAGE):
        return order
    if auth.role == Role.PATIENT and auth.patient_id and order.patient_id == auth.patient_id:
        return order
    raise not_found("Order")


@router.get("/orders")
async def list_orders(
    auth: CurrentAuth,
    db: DbSession,
    page: Annotated[Page, Depends(pagination)],
    status: PharmacyOrderStatus | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    queue: Annotated[
        Literal["rx-review", "refunds", "open"] | None, Query()
    ] = None,
) -> dict[str, Any]:
    """A patient's own orders, or — for the pharmacy — everyone's."""
    admin = auth.has(Permission.PHARMACY_MANAGE)
    filters: list[Any] = []
    if not admin:
        filters.append(PharmacyOrder.patient_id == _own_patient(auth))
    if status:
        filters.append(PharmacyOrder.status == status)
    if admin and search:
        term = f"%{search.strip()}%"
        filters.append(
            or_(
                PharmacyOrder.order_number.ilike(term),
                PharmacyOrder.recipient_name.ilike(term),
                PharmacyOrder.phone.ilike(term),
                PharmacyOrder.city.ilike(term),
            )
        )
    if queue == "rx-review":
        filters += [
            PharmacyOrder.status == PharmacyOrderStatus.PENDING_RX,
            PharmacyOrder.rx_route == RxRoute.UPLOAD,
            PharmacyOrder.rx_upload_path.is_not(None),
        ]
    elif queue == "refunds":
        filters.append(PharmacyOrder.refund_due.is_(True))
    elif queue == "open":
        filters.append(PharmacyOrder.status.in_(orders.OPEN))

    total = (await db.execute(select(func.count(PharmacyOrder.id)).where(*filters))).scalar_one()
    rows = (
        (
            await db.execute(
                select(PharmacyOrder)
                .where(*filters)
                .order_by(PharmacyOrder.created_at.desc())
                .limit(page.limit)
                .offset(page.offset)
            )
        )
        .scalars()
        .all()
    )
    names: dict[str, str] = {}
    if admin and rows:
        names = dict(
            (
                await db.execute(
                    select(Patient.id, User.name)
                    .join(User, User.id == Patient.user_id)
                    .where(Patient.id.in_({o.patient_id for o in rows if o.patient_id}))
                )
            )
            .tuples()
            .all()
        )
    return ok(
        [
            orders.serialize_order(o, admin=admin, patient_name=names.get(o.patient_id or ""))
            for o in rows
        ],
        page.meta(total),
    )


@router.get("/orders/{order_id}")
async def get_order(order_id: str, auth: CurrentAuth, db: DbSession) -> dict[str, Any]:
    order = await _visible_order(db, auth, order_id)
    return ok(await _detail(db, order, admin=auth.has(Permission.PHARMACY_MANAGE)))


class CancelRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    reason: Annotated[str, Field(max_length=300)] | None = None


@router.post("/orders/{order_id}/cancel")
async def cancel_order(
    order_id: str,
    payload: CancelRequest,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
) -> dict[str, Any]:
    """Cancel before the parcel leaves. The medicine goes back on the shelf."""
    order = await _visible_order(db, auth, order_id, lock=True)
    by_patient = auth.role == Role.PATIENT
    reason = payload.reason or ("Cancelled by the patient" if by_patient else "Cancelled by the pharmacy")
    outcome = await orders.cancel(db, order, by=auth.user_id, reason=reason)

    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_ORDER_UPDATED,
        entity_type="PharmacyOrder",
        entity_id=order.id,
        patient_id=order.patient_id,
        metadata={
            "orderNumber": order.order_number,
            "operation": "cancel",
            "byPatient": by_patient,
            "invoice": outcome,
        },
    )
    if by_patient:
        await orders.tell_admins(
            db, order, title=f"Cancelled by the patient: {order.order_number}", body=reason
        )
    else:
        await orders.tell_patient(
            db,
            order,
            title="Order cancelled",
            body=f"Order {order.order_number} was cancelled by the pharmacy. {reason}",
        )
    return ok(await _detail(db, order, admin=not by_patient))


@router.post("/orders/{order_id}/prescription")
async def upload_prescription(
    order_id: str,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireOrder,
    __: UploadRateLimit,
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    """Attach the prescription photo the pharmacy will check.

    Allowed while the order waits for it, and replaceable until it has been
    checked — a blurry first photo should not cost the patient their order.
    """
    patient_id = _own_patient(auth)
    order = await _visible_order(db, auth, order_id, lock=True)
    if order.patient_id != patient_id:
        raise not_found("Order")
    if (
        order.status != PharmacyOrderStatus.PENDING_RX
        or order.rx_route != RxRoute.UPLOAD
        or order.rx_status != RxStatus.PENDING
    ):
        raise conflict("This order is not waiting for a prescription photo.")

    content = await file.read(MAX_RX_BYTES + 1)
    try:
        inspected = inspect_upload(
            content,
            declared_mime=file.content_type,
            original_name=file.filename,
            max_bytes=MAX_RX_BYTES,
        )
    except FileRejectedError as exc:
        raise bad_request(str(exc)) from exc
    if inspected.detected_mime not in RX_MIME_TYPES:
        raise bad_request("Upload the prescription as a photo (JPEG, PNG, WebP) or a PDF.")

    bucket = settings.SUPABASE_PHARMACY_RX_BUCKET
    path = f"rx/{patient_id}/{order.id}/{new_id()}{inspected.extension}"
    await storage.upload(bucket, path, content, inspected.detected_mime)
    previous = order.rx_upload_path
    order.rx_upload_path = path
    try:
        await db.flush()
    except Exception:
        await storage.remove(bucket, path)
        raise
    if previous:
        await storage.remove(bucket, previous)

    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_ORDER_UPDATED,
        entity_type="PharmacyOrder",
        entity_id=order.id,
        patient_id=patient_id,
        metadata={
            "orderNumber": order.order_number,
            "operation": "prescription_uploaded",
            "replaced": bool(previous),
        },
    )
    await orders.tell_admins(
        db,
        order,
        title=f"Prescription to check: {order.order_number}",
        body="A patient has uploaded a prescription for prescription-only medicine.",
    )
    return ok(await _detail(db, order, admin=False))


@router.get("/orders/{order_id}/prescription")
async def view_prescription(
    order_id: str, request: Request, auth: CurrentAuth, db: DbSession
) -> dict[str, Any]:
    """A short-lived link to the uploaded prescription, for its patient and the pharmacy."""
    order = await _visible_order(db, auth, order_id)
    if not order.rx_upload_path:
        raise not_found("Prescription")
    url = await storage.signed_url(settings.SUPABASE_PHARMACY_RX_BUCKET, order.rx_upload_path)
    if auth.role != Role.PATIENT:
        # Somebody other than the patient looked at a prescription. That is
        # their job, and the trail is how "who has seen it" stays answerable.
        await _audit(
            request,
            db,
            auth,
            AuditAction.DOCUMENT_VIEWED,
            entity_type="PharmacyOrder",
            entity_id=order.id,
            patient_id=order.patient_id,
            metadata={"orderNumber": order.order_number, "operation": "prescription_viewed"},
        )
    return ok({"url": url, "expiresIn": settings.SUPABASE_SIGNED_URL_TTL_SECONDS})


# ---------------------------------------------------------------------------
# The pharmacy's side
# ---------------------------------------------------------------------------


class RxDecision(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    decision: Literal["APPROVE", "REJECT"]
    note: Annotated[str, Field(max_length=300)] | None = None


class Advance(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    status: Literal["PACKED", "DISPATCHED", "DELIVERED"]
    courier: Annotated[str, Field(min_length=2, max_length=60)] | None = None
    tracking_number: Annotated[str, Field(min_length=2, max_length=80)] | None = Field(
        default=None, alias="trackingNumber"
    )


class RefundRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    reason: Annotated[str, Field(min_length=3, max_length=300)]


async def _rx_decided(
    request: Request,
    db: DbSession,
    auth: CurrentAuth,
    order: PharmacyOrder,
    decision: RxDecision,
    *,
    by: str,
) -> None:
    """Apply a prescription decision, whoever made it, and tell the patient."""
    if decision.decision == "REJECT":
        if not decision.note:
            raise bad_request("Say why, so the patient knows what to do next.")
        await orders.refuse_prescription(db, order, reviewer_id=auth.user_id, note=decision.note)
        await orders.tell_patient(
            db,
            order,
            title="Prescription not accepted",
            body=f"Order {order.order_number} was cancelled: {decision.note}",
        )
    else:
        await orders.clear_prescription(db, order, reviewer_id=auth.user_id, note=decision.note)
        await orders.tell_patient(
            db,
            order,
            title="Prescription approved",
            body=(
                f"Order {order.order_number} is approved. Pay {order.currency} {order.total} to confirm it."
                if order.status == PharmacyOrderStatus.AWAITING_PAYMENT
                else f"Order {order.order_number} is approved and will be packed."
            ),
        )
    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_RX_REVIEWED,
        entity_type="PharmacyOrder",
        entity_id=order.id,
        patient_id=order.patient_id,
        metadata={
            "orderNumber": order.order_number,
            "decision": decision.decision,
            "route": str(order.rx_route),
            "by": by,
        },
    )


@router.post("/orders/{order_id}/rx-review")
async def review_upload(
    order_id: str,
    payload: RxDecision,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireManage,
) -> dict[str, Any]:
    """Accept or refuse the prescription a patient uploaded."""
    order = await orders.load(db, order_id, lock=True)
    if order.rx_route != RxRoute.UPLOAD or order.status != PharmacyOrderStatus.PENDING_RX:
        raise conflict("This order is not waiting for a prescription check.")
    if not order.rx_upload_path:
        raise conflict("The patient has not uploaded a prescription yet.")
    await _rx_decided(request, db, auth, order, payload, by="pharmacy")
    return ok(await _detail(db, order, admin=True))


@router.post("/orders/{order_id}/advance")
async def advance_order(
    order_id: str,
    payload: Advance,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireManage,
) -> dict[str, Any]:
    """Pack, dispatch, deliver — one step at a time, in that order."""
    order = await orders.load(db, order_id, lock=True)
    now = utcnow()
    target = PharmacyOrderStatus(payload.status)
    allowed_from = {
        PharmacyOrderStatus.PACKED: PharmacyOrderStatus.CONFIRMED,
        PharmacyOrderStatus.DISPATCHED: PharmacyOrderStatus.PACKED,
        PharmacyOrderStatus.DELIVERED: PharmacyOrderStatus.DISPATCHED,
    }[target]
    if order.status != allowed_from:
        raise conflict(
            f"An order that is {str(order.status).lower().replace('_', ' ')} cannot be marked "
            f"{str(target).lower()}."
        )

    message: str
    if target == PharmacyOrderStatus.PACKED:
        order.packed_at = now
        message = f"Order {order.order_number} is packed and waiting for the rider."
    elif target == PharmacyOrderStatus.DISPATCHED:
        if not payload.courier:
            raise bad_request("Name the courier the parcel went with.")
        order.courier = payload.courier
        order.tracking_number = payload.tracking_number
        order.dispatched_at = now
        if order.payment_method == PharmacyPaymentMethod.COD:
            # The bill travels with the parcel.
            await orders.issue_invoice(db, order)
        tracking = f" Tracking number {order.tracking_number}." if order.tracking_number else ""
        cash = (
            f" Keep {order.currency} {order.total} ready in cash."
            if order.payment_method == PharmacyPaymentMethod.COD
            else ""
        )
        message = f"Order {order.order_number} is on its way with {order.courier}.{tracking}{cash}"
    else:
        order.delivered_at = now
        if order.payment_method == PharmacyPaymentMethod.COD:
            await orders.record_cash(db, order, reviewer_id=auth.user_id)
        message = f"Order {order.order_number} has been delivered. Get well soon."
    order.status = target
    await db.flush()

    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_ORDER_UPDATED,
        entity_type="PharmacyOrder",
        entity_id=order.id,
        patient_id=order.patient_id,
        metadata={
            "orderNumber": order.order_number,
            "from": str(allowed_from),
            "to": str(target),
            **({"courier": order.courier} if target == PharmacyOrderStatus.DISPATCHED else {}),
        },
    )
    await orders.tell_patient(
        db,
        order,
        title={
            PharmacyOrderStatus.PACKED: "Order packed",
            PharmacyOrderStatus.DISPATCHED: "Order dispatched",
            PharmacyOrderStatus.DELIVERED: "Order delivered",
        }[target],
        body=message,
        # Packed is worth a line in the portal, not a message in an inbox.
        email=False if target == PharmacyOrderStatus.PACKED else None,
    )
    return ok(await _detail(db, order, admin=True))


@router.post("/orders/{order_id}/refund")
async def refund_order(
    order_id: str,
    payload: RefundRequest,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireManage,
) -> dict[str, Any]:
    """Record that a cancelled order's money has been sent back."""
    order = await orders.load(db, order_id, lock=True)
    note = await orders.refund(db, order, payload.reason)
    await _audit(
        request,
        db,
        auth,
        AuditAction.PHARMACY_ORDER_UPDATED,
        entity_type="PharmacyOrder",
        entity_id=order.id,
        patient_id=order.patient_id,
        metadata={
            "orderNumber": order.order_number,
            "operation": "refund",
            "creditNote": note.invoice_number,
            "amount": str(order.total),
        },
    )
    await orders.tell_patient(
        db,
        order,
        title="Refund sent",
        body=f"{order.currency} {order.total} for order {order.order_number} has been refunded.",
    )
    return ok(await _detail(db, order, admin=True))


@router.get("/dashboard")
async def pharmacy_dashboard(auth: CurrentAuth, db: DbSession, _: RequireManage) -> dict[str, Any]:
    return ok(await dashboard.summary(db))


# ---------------------------------------------------------------------------
# A doctor's side
# ---------------------------------------------------------------------------


@router.get("/approvals")
async def list_approvals(
    auth: CurrentAuth,
    db: DbSession,
    page: Annotated[Page, Depends(pagination)],
    _: RequireApprove,
    pending: bool = True,
) -> dict[str, Any]:
    """Requests from this doctor's patients to approve medicine.

    Each comes with what a doctor needs to decide safely — the patient's
    allergies, conditions and what they are already taking — and nothing else
    from the chart.
    """
    if auth.role != Role.DOCTOR or not auth.doctor_id:
        raise forbidden("This is for doctors.")
    filters = [
        PharmacyOrder.rx_route == RxRoute.DOCTOR,
        PharmacyOrder.rx_doctor_id == auth.doctor_id,
    ]
    if pending:
        filters += [
            PharmacyOrder.status == PharmacyOrderStatus.PENDING_RX,
            PharmacyOrder.rx_status == RxStatus.PENDING,
        ]

    total = (await db.execute(select(func.count(PharmacyOrder.id)).where(*filters))).scalar_one()
    rows = (
        (
            await db.execute(
                select(PharmacyOrder)
                .where(*filters)
                .order_by(PharmacyOrder.created_at.desc())
                .limit(page.limit)
                .offset(page.offset)
            )
        )
        .scalars()
        .all()
    )
    patient_ids = {o.patient_id for o in rows if o.patient_id}
    patients = {
        pid: (name, allergies, conditions)
        for pid, name, allergies, conditions in (
            await db.execute(
                select(Patient.id, User.name, Patient.allergies, Patient.chronic_conditions)
                .join(User, User.id == Patient.user_id)
                .where(Patient.id.in_(patient_ids))
            )
        ).all()
    }
    taking: dict[str, list[str]] = {}
    for pid, medication, dosage in (
        await db.execute(
            select(Prescription.patient_id, Prescription.medication, Prescription.dosage).where(
                Prescription.patient_id.in_(patient_ids), Prescription.active.is_(True)
            )
        )
    ).all():
        taking.setdefault(pid, []).append(f"{medication} {dosage}".strip())

    items = []
    for order in rows:
        name, allergies, conditions = patients.get(order.patient_id or "", (None, None, None))
        body = orders.serialize_order(order)
        # The delivery address is the pharmacy's business, not the approver's.
        for key in ("phone", "addressLine", "deliveryNotes", "recipientName"):
            body.pop(key, None)
        body["patient"] = {
            "id": order.patient_id,
            "name": name,
            "allergies": allergies,
            "chronicConditions": conditions,
            "currentMedications": taking.get(order.patient_id or "", []),
        }
        items.append(body)
    return ok(items, page.meta(total))


@router.post("/approvals/{order_id}")
async def decide_approval(
    order_id: str,
    payload: RxDecision,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    _: RequireApprove,
) -> dict[str, Any]:
    """Approve or decline a patient's request for prescription-only medicine.

    The care relationship is checked again here rather than trusted from when
    the order was placed: a doctor whose assignment has since ended should not
    be signing off on that patient's medicine.
    """
    if auth.role != Role.DOCTOR or not auth.doctor_id:
        raise forbidden("This is for doctors.")
    order = await orders.load(db, order_id, lock=True)
    if order.rx_route != RxRoute.DOCTOR or order.rx_doctor_id != auth.doctor_id:
        raise not_found("Request")
    if order.status != PharmacyOrderStatus.PENDING_RX or order.rx_status != RxStatus.PENDING:
        raise conflict("This request has already been answered.")
    if order.patient_id is None or not await orders.may_approve(db, auth.doctor_id, order.patient_id):
        raise forbidden("You no longer have a care relationship with this patient.")

    await _rx_decided(request, db, auth, order, payload, by="doctor")
    body = orders.serialize_order(order)
    for key in ("phone", "addressLine", "deliveryNotes", "recipientName"):
        body.pop(key, None)
    return ok(body)
