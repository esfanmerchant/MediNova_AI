"""Online consultations and the MediNova pharmacy.

**Online consultations** need very little of their own, because they are
appointments: the same slots, the same lifecycle, the same invoice. What is new
is where they happen. ``appointments.mode`` says CLINIC or ONLINE, defaulting to
CLINIC so every existing row stays the clinic visit it always was, and
``appointments.videoRoom`` holds the call's session name. The room name is
unique, structurally: two consultations sharing a room would put two patients in
front of each other's doctor.

``doctors.onlineFee`` is nullable on purpose. Empty means "same as the clinic",
which is what most doctors charge, and the alternative — a required second fee —
would be a number nobody had chosen.

**The pharmacy** is four tables. ``pharmacy_order_items`` copies each line's name
and price instead of reading them through the product: an order is a record of
what was sold and for how much, and a later price change must not rewrite it.

Stock may never go negative, and that is a check constraint rather than a
service rule. Two patients buying the last strip at the same moment must not
both get it; the service decrements with a guarded UPDATE, and the constraint is
what holds if a future code path forgets to.

``invoices.kind`` keeps the two businesses apart. Revenue reporting reads an
invoice's ``amount`` as a doctor's fee, and without this column a patient's
paracetamol would be reported as somebody's consultation earnings. Every
existing invoice is a consultation, which is the default.

Revision ID: 0024_telemedicine_pharmacy
Revises: 0023_remove_account
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0024_telemedicine_pharmacy"
down_revision: str | None = "0023_remove_account"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Created explicitly in `upgrade`, before the columns that use them — see 0014
# for why `create_type=False` is not optional here.
MODE = postgresql.ENUM("CLINIC", "ONLINE", name="AppointmentMode", create_type=False)
INVOICE_KIND = postgresql.ENUM(
    "CONSULTATION", "PHARMACY", name="InvoiceKind", create_type=False
)
FORM = postgresql.ENUM(
    "TABLET", "CAPSULE", "SYRUP", "SUSPENSION", "DROPS", "INJECTION", "CREAM",
    "OINTMENT", "GEL", "LOTION", "INHALER", "SACHET", "SPRAY", "SOLUTION", "OTHER",
    name="ProductForm", create_type=False,
)
ORDER_STATUS = postgresql.ENUM(
    "PENDING_RX", "AWAITING_PAYMENT", "CONFIRMED", "PACKED", "DISPATCHED",
    "DELIVERED", "CANCELLED",
    name="PharmacyOrderStatus", create_type=False,
)
PAYMENT = postgresql.ENUM("COD", "ONLINE", name="PharmacyPaymentMethod", create_type=False)
RX_ROUTE = postgresql.ENUM("PRESCRIBED", "UPLOAD", "DOCTOR", name="RxRoute", create_type=False)
RX_STATUS = postgresql.ENUM(
    "NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED", name="RxStatus", create_type=False
)

NEW_TYPES = (MODE, INVOICE_KIND, FORM, ORDER_STATUS, PAYMENT, RX_ROUTE, RX_STATUS)

AUDIT_ACTIONS = (
    "VIDEO_CONSULT_JOINED",
    "PHARMACY_ORDER_PLACED",
    "PHARMACY_ORDER_UPDATED",
    "PHARMACY_RX_REVIEWED",
    "PHARMACY_CATALOG_CHANGED",
)

SINGLETON = "singleton"


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("createdAt", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updatedAt", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    ]


def upgrade() -> None:
    for enum in NEW_TYPES:
        enum.create(op.get_bind(), checkfirst=True)

    op.execute("ALTER TYPE \"PaymentMethod\" ADD VALUE IF NOT EXISTS 'CASH_ON_DELIVERY'")
    op.execute("ALTER TYPE \"NotificationType\" ADD VALUE IF NOT EXISTS 'PHARMACY_ORDER'")
    for action in AUDIT_ACTIONS:
        op.execute(f"ALTER TYPE \"AuditAction\" ADD VALUE IF NOT EXISTS '{action}'")

    # ---- online consultations ----------------------------------------------
    op.add_column(
        "appointments",
        sa.Column("mode", MODE, nullable=False, server_default="CLINIC"),
    )
    op.add_column("appointments", sa.Column("videoRoom", sa.Text(), nullable=True))
    op.create_index(
        "appointments_videoRoom_key", "appointments", ["videoRoom"], unique=True
    )

    op.add_column("doctors", sa.Column("onlineFee", sa.Numeric(10, 2), nullable=True))
    op.create_check_constraint(
        "ck_doctor_online_fee_positive",
        "doctors",
        '"onlineFee" IS NULL OR "onlineFee" >= 0',
    )

    op.add_column(
        "invoices",
        sa.Column("kind", INVOICE_KIND, nullable=False, server_default="CONSULTATION"),
    )
    op.create_index("invoices_kind_status_idx", "invoices", ["kind", "status"])

    # ---- the catalog ---------------------------------------------------------
    op.create_table(
        "pharmacy_products",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("genericName", sa.Text(), nullable=False),
        sa.Column("strength", sa.Text(), nullable=True),
        sa.Column("form", FORM, nullable=False),
        sa.Column("packSize", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("manufacturer", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price", sa.Numeric(10, 2), nullable=False),
        sa.Column("costPrice", sa.Numeric(10, 2), nullable=True),
        sa.Column("stock", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lowStockThreshold", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("rxRequired", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("priceReviewed", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
        sa.CheckConstraint("price > 0", name="ck_product_price_positive"),
        sa.CheckConstraint(
            '"costPrice" IS NULL OR "costPrice" >= 0', name="ck_product_cost_not_negative"
        ),
        # The last strip cannot be sold twice. See the module docstring.
        sa.CheckConstraint("stock >= 0", name="ck_product_stock_not_negative"),
        sa.CheckConstraint('"lowStockThreshold" >= 0', name="ck_product_threshold_not_negative"),
    )
    # One row per pack. Loading the starter catalog twice, or importing a CSV
    # that repeats a line, must update rather than duplicate — a duplicate
    # product splits its stock across two rows and both look low.
    op.execute(
        "CREATE UNIQUE INDEX pharmacy_products_pack_key ON pharmacy_products "
        '(lower(name), lower(coalesce(strength, \'\')), form, lower("packSize"))'
    )
    # Search is a case-insensitive substring match over a few thousand rows at
    # most, which a sequential scan answers in well under a millisecond. A
    # trigram index would be an extension to install for no measurable gain.
    op.create_index("pharmacy_products_category_idx", "pharmacy_products", ["category"])

    op.add_column("prescriptions", sa.Column("productId", sa.Text(), nullable=True))
    op.create_foreign_key(
        "prescriptions_productId_fkey",
        "prescriptions",
        "pharmacy_products",
        ["productId"],
        ["id"],
        ondelete="SET NULL",
        onupdate="CASCADE",
    )
    op.create_index("prescriptions_productId_idx", "prescriptions", ["productId"])

    # ---- settings: one row, ever -------------------------------------------
    op.create_table(
        "pharmacy_settings",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("deliveryFee", sa.Numeric(10, 2), nullable=False, server_default="150"),
        sa.Column("freeDeliveryAbove", sa.Numeric(10, 2), nullable=True),
        sa.Column("codEnabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("codMaxAmount", sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "cities",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "pharmacyName", sa.Text(), nullable=False, server_default="MediNova Pharmacy"
        ),
        sa.Column("licenseNumber", sa.Text(), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("updatedAt", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updatedById", sa.Text(), nullable=True),
        sa.CheckConstraint(f"id = '{SINGLETON}'", name="ck_pharmacy_settings_singleton"),
        sa.CheckConstraint('"deliveryFee" >= 0', name="ck_pharmacy_delivery_fee_not_negative"),
        sa.CheckConstraint(
            '"freeDeliveryAbove" IS NULL OR "freeDeliveryAbove" >= 0',
            name="ck_pharmacy_free_delivery_not_negative",
        ),
        sa.CheckConstraint(
            '"codMaxAmount" IS NULL OR "codMaxAmount" > 0',
            name="ck_pharmacy_cod_limit_positive",
        ),
    )
    # Starting values for a Pakistani online pharmacy, all of them the
    # administrator's to change: a flat rider fee, free delivery on a basket
    # worth carrying, and no rider sent out to collect more cash than is safe
    # to carry.
    op.execute(
        sa.text(
            'INSERT INTO pharmacy_settings (id, "deliveryFee", "freeDeliveryAbove", '
            '"codMaxAmount") VALUES (:id, 150, 3000, 25000) ON CONFLICT (id) DO NOTHING'
        ).bindparams(id=SINGLETON)
    )

    # ---- orders --------------------------------------------------------------
    # Order numbers from a sequence, for the reason invoice numbers are (0004):
    # a count-plus-one is a race with a unique index at the end of it.
    op.execute("CREATE SEQUENCE IF NOT EXISTS pharmacy_order_number_seq")
    op.create_table(
        "pharmacy_orders",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("orderNumber", sa.Text(), nullable=False),
        sa.Column(
            "patientId",
            sa.Text(),
            sa.ForeignKey("patients.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("status", ORDER_STATUS, nullable=False),
        sa.Column("paymentMethod", PAYMENT, nullable=False),
        sa.Column("recipientName", sa.Text(), nullable=False),
        sa.Column("phone", sa.Text(), nullable=False),
        sa.Column("addressLine", sa.Text(), nullable=False),
        sa.Column("city", sa.Text(), nullable=False),
        sa.Column("deliveryNotes", sa.Text(), nullable=True),
        sa.Column("subtotal", sa.Numeric(10, 2), nullable=False),
        sa.Column("deliveryFee", sa.Numeric(10, 2), nullable=False),
        sa.Column("total", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False, server_default="PKR"),
        sa.Column(
            "invoiceId",
            sa.Text(),
            sa.ForeignKey("invoices.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("rxStatus", RX_STATUS, nullable=False, server_default="NOT_REQUIRED"),
        sa.Column("rxRoute", RX_ROUTE, nullable=True),
        sa.Column("rxUploadPath", sa.Text(), nullable=True),
        sa.Column(
            "rxDoctorId",
            sa.Text(),
            sa.ForeignKey("doctors.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("rxReviewedById", sa.Text(), nullable=True),
        sa.Column("rxReviewedAt", sa.DateTime(), nullable=True),
        sa.Column("rxNote", sa.Text(), nullable=True),
        sa.Column("courier", sa.Text(), nullable=True),
        sa.Column("trackingNumber", sa.Text(), nullable=True),
        sa.Column("confirmedAt", sa.DateTime(), nullable=True),
        sa.Column("packedAt", sa.DateTime(), nullable=True),
        sa.Column("dispatchedAt", sa.DateTime(), nullable=True),
        sa.Column("deliveredAt", sa.DateTime(), nullable=True),
        sa.Column("cancelledAt", sa.DateTime(), nullable=True),
        sa.Column("cancelledBy", sa.Text(), nullable=True),
        sa.Column("cancelReason", sa.Text(), nullable=True),
        sa.Column("refundDue", sa.Boolean(), nullable=False, server_default=sa.false()),
        *_timestamps(),
        sa.CheckConstraint("subtotal >= 0", name="ck_order_subtotal_not_negative"),
        sa.CheckConstraint('"deliveryFee" >= 0', name="ck_order_delivery_fee_not_negative"),
        # The total is the sum of its parts, structurally. A total computed in
        # one place and checked nowhere is a total that can drift.
        sa.CheckConstraint(
            'total = subtotal + "deliveryFee"', name="ck_order_total_adds_up"
        ),
    )
    op.create_index(
        "pharmacy_orders_orderNumber_key", "pharmacy_orders", ["orderNumber"], unique=True
    )
    # One order per invoice: the payment hook finds the order from the invoice
    # it settled, and two orders on one bill would make "which one was paid"
    # unanswerable.
    op.create_index(
        "pharmacy_orders_invoiceId_key", "pharmacy_orders", ["invoiceId"], unique=True
    )
    op.create_index(
        "pharmacy_orders_patient_idx", "pharmacy_orders", ["patientId", "createdAt"]
    )
    op.create_index(
        "pharmacy_orders_status_idx", "pharmacy_orders", ["status", "createdAt"]
    )
    op.create_index(
        "pharmacy_orders_rx_doctor_idx", "pharmacy_orders", ["rxDoctorId", "rxStatus"]
    )

    op.create_table(
        "pharmacy_order_items",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "orderId",
            sa.Text(),
            sa.ForeignKey("pharmacy_orders.id", ondelete="CASCADE", onupdate="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "productId",
            sa.Text(),
            sa.ForeignKey("pharmacy_products.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("productName", sa.Text(), nullable=False),
        sa.Column("genericName", sa.Text(), nullable=False),
        sa.Column("strength", sa.Text(), nullable=True),
        sa.Column("form", sa.Text(), nullable=False),
        sa.Column("packSize", sa.Text(), nullable=False),
        sa.Column("unitPrice", sa.Numeric(10, 2), nullable=False),
        # What the pack cost the pharmacy when it was sold, copied like the
        # price, so last month's margin does not move when this month's
        # supplier invoice does.
        sa.Column("unitCost", sa.Numeric(10, 2), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("lineTotal", sa.Numeric(10, 2), nullable=False),
        sa.Column("rxRequired", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "prescriptionId",
            sa.Text(),
            sa.ForeignKey("prescriptions.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("createdAt", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("quantity > 0", name="ck_order_item_quantity_positive"),
        sa.CheckConstraint('"unitPrice" > 0', name="ck_order_item_price_positive"),
        sa.CheckConstraint(
            '"lineTotal" = "unitPrice" * quantity', name="ck_order_item_total_adds_up"
        ),
    )
    op.create_index("pharmacy_order_items_order_idx", "pharmacy_order_items", ["orderId"])
    op.create_index(
        "pharmacy_order_items_product_idx", "pharmacy_order_items", ["productId"]
    )


def downgrade() -> None:
    op.drop_index("pharmacy_order_items_product_idx", table_name="pharmacy_order_items")
    op.drop_index("pharmacy_order_items_order_idx", table_name="pharmacy_order_items")
    op.drop_table("pharmacy_order_items")

    for name in (
        "pharmacy_orders_rx_doctor_idx",
        "pharmacy_orders_status_idx",
        "pharmacy_orders_patient_idx",
        "pharmacy_orders_invoiceId_key",
        "pharmacy_orders_orderNumber_key",
    ):
        op.drop_index(name, table_name="pharmacy_orders")
    op.drop_table("pharmacy_orders")
    op.execute("DROP SEQUENCE IF EXISTS pharmacy_order_number_seq")

    op.drop_table("pharmacy_settings")

    op.drop_index("prescriptions_productId_idx", table_name="prescriptions")
    op.drop_constraint("prescriptions_productId_fkey", "prescriptions", type_="foreignkey")
    op.drop_column("prescriptions", "productId")

    op.drop_index("pharmacy_products_category_idx", table_name="pharmacy_products")
    op.execute("DROP INDEX IF EXISTS pharmacy_products_pack_key")
    op.drop_table("pharmacy_products")

    op.drop_index("invoices_kind_status_idx", table_name="invoices")
    op.drop_column("invoices", "kind")
    op.drop_constraint("ck_doctor_online_fee_positive", "doctors", type_="check")
    op.drop_column("doctors", "onlineFee")
    op.drop_index("appointments_videoRoom_key", table_name="appointments")
    op.drop_column("appointments", "videoRoom")
    op.drop_column("appointments", "mode")

    for enum in reversed(NEW_TYPES):
        enum.drop(op.get_bind(), checkfirst=True)
    # The values added to PaymentMethod, NotificationType and AuditAction stay.
    # Postgres cannot drop an enum value, and a row that already names one
    # would become unreadable if it could.
