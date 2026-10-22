"""The pharmacy at a glance: what sold, what is waiting, what is running out.

Sales are counted the way the rest of the platform counts revenue — money that
has actually arrived, dated by when it arrived. An order placed is a hope; a
bill paid is a fact.

Margin is reported only over lines that carried a cost price when they were
sold, and says how much of the period's sales that covers. A margin computed
over half the sales and shown as if it were all of them would be the most
flattering number on the screen, and the least true.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.db.enums import InvoiceKind, InvoiceStatus, PharmacyOrderStatus, RxRoute
from app.db.models import Invoice, PharmacyOrder, PharmacyOrderItem, PharmacyProduct
from app.modules.appointments.schedule import to_clinic, to_utc
from app.modules.pharmacy.catalog import serialize_product


def _clinic_midnight(moment: datetime) -> datetime:
    """The UTC instant the clinic's calendar day containing ``moment`` began."""
    local = to_clinic(moment)
    return to_utc(datetime.combine(local.date(), time.min))


async def _sales(db: AsyncSession, since: datetime) -> tuple[Decimal, int]:
    total, count = (
        await db.execute(
            select(func.coalesce(func.sum(Invoice.total_amount), 0), func.count(Invoice.id)).where(
                Invoice.kind == InvoiceKind.PHARMACY,
                Invoice.status == InvoiceStatus.PAID,
                Invoice.paid_at >= since,
            )
        )
    ).one()
    return Decimal(total), int(count)


async def summary(db: AsyncSession) -> dict[str, Any]:
    now = utcnow()
    today = _clinic_midnight(now)
    local = to_clinic(now)
    month = to_utc(datetime.combine(local.date().replace(day=1), time.min))

    sales_today, paid_today = await _sales(db, today)
    sales_month, paid_month = await _sales(db, month)

    by_status: dict[PharmacyOrderStatus, int] = dict(
        (
            await db.execute(
                select(PharmacyOrder.status, func.count(PharmacyOrder.id)).group_by(
                    PharmacyOrder.status
                )
            )
        )
        .tuples()
        .all()
    )

    rx_to_check = (
        await db.execute(
            select(func.count(PharmacyOrder.id)).where(
                PharmacyOrder.status == PharmacyOrderStatus.PENDING_RX,
                PharmacyOrder.rx_route == RxRoute.UPLOAD,
                PharmacyOrder.rx_upload_path.is_not(None),
            )
        )
    ).scalar_one()
    refunds_due = (
        await db.execute(
            select(func.count(PharmacyOrder.id)).where(PharmacyOrder.refund_due.is_(True))
        )
    ).scalar_one()

    low = (
        (
            await db.execute(
                select(PharmacyProduct)
                .where(
                    PharmacyProduct.active.is_(True),
                    PharmacyProduct.stock <= PharmacyProduct.low_stock_threshold,
                )
                .order_by(PharmacyProduct.stock, PharmacyProduct.name)
                .limit(10)
            )
        )
        .scalars()
        .all()
    )
    low_count = (
        await db.execute(
            select(func.count(PharmacyProduct.id)).where(
                PharmacyProduct.active.is_(True),
                PharmacyProduct.stock <= PharmacyProduct.low_stock_threshold,
            )
        )
    ).scalar_one()
    unreviewed = (
        await db.execute(
            select(func.count(PharmacyProduct.id)).where(PharmacyProduct.price_reviewed.is_(False))
        )
    ).scalar_one()

    # Best sellers over thirty days, from orders that did not fall through.
    since = now - timedelta(days=30)
    sold = (
        await db.execute(
            select(
                PharmacyOrderItem.product_id,
                PharmacyOrderItem.product_name,
                PharmacyOrderItem.strength,
                func.sum(PharmacyOrderItem.quantity),
                func.sum(PharmacyOrderItem.line_total),
            )
            .join(PharmacyOrder, PharmacyOrder.id == PharmacyOrderItem.order_id)
            .where(
                PharmacyOrder.created_at >= since,
                PharmacyOrder.status != PharmacyOrderStatus.CANCELLED,
            )
            .group_by(
                PharmacyOrderItem.product_id,
                PharmacyOrderItem.product_name,
                PharmacyOrderItem.strength,
            )
            .order_by(func.sum(PharmacyOrderItem.line_total).desc())
            .limit(8)
        )
    ).all()

    # Margin this month, over the lines whose cost was known at the sale.
    margin_row = (
        await db.execute(
            select(
                func.coalesce(
                    func.sum(
                        (PharmacyOrderItem.unit_price - PharmacyOrderItem.unit_cost)
                        * PharmacyOrderItem.quantity
                    ),
                    0,
                ),
                func.coalesce(func.sum(PharmacyOrderItem.line_total), 0),
            )
            .join(PharmacyOrder, PharmacyOrder.id == PharmacyOrderItem.order_id)
            .where(
                PharmacyOrder.confirmed_at >= month,
                PharmacyOrder.status != PharmacyOrderStatus.CANCELLED,
                PharmacyOrderItem.unit_cost.is_not(None),
            )
        )
    ).one()
    all_lines = (
        await db.execute(
            select(func.coalesce(func.sum(PharmacyOrderItem.line_total), 0))
            .join(PharmacyOrder, PharmacyOrder.id == PharmacyOrderItem.order_id)
            .where(
                PharmacyOrder.confirmed_at >= month,
                PharmacyOrder.status != PharmacyOrderStatus.CANCELLED,
            )
        )
    ).scalar_one()
    margin, costed = Decimal(margin_row[0]), Decimal(margin_row[1])
    coverage = (costed / Decimal(all_lines) * 100) if all_lines else Decimal("0")

    return {
        "salesToday": str(sales_today),
        "paidOrdersToday": paid_today,
        "salesThisMonth": str(sales_month),
        "paidOrdersThisMonth": paid_month,
        "ordersByStatus": {str(status): count for status, count in by_status.items()},
        "openOrders": sum(
            count
            for status, count in by_status.items()
            if status
            not in (PharmacyOrderStatus.DELIVERED, PharmacyOrderStatus.CANCELLED)
        ),
        "prescriptionsToCheck": int(rx_to_check),
        "refundsDue": int(refunds_due),
        "lowStockCount": int(low_count),
        "lowStock": [serialize_product(p, admin=True) for p in low],
        "unreviewedPrices": int(unreviewed),
        "bestSellers": [
            {
                "productId": product_id,
                "name": " ".join(filter(None, (name, strength))),
                "quantity": int(quantity),
                "revenue": str(revenue),
            }
            for product_id, name, strength, quantity, revenue in sold
        ],
        "marginThisMonth": str(margin.quantize(Decimal("0.01"))),
        # How much of this month's sales the margin figure actually covers.
        "marginCoveragePercent": str(coverage.quantize(Decimal("0.1"))),
    }
