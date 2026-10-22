"""The pharmacy's catalog: what is sold, at what price, and how much is left.

**One row per pack.** A product is identified by its brand, strength, form and
pack — "Panadol 500 mg tablets, strip of 10" — and that combination is unique in
the database. Loading the starter catalog twice, or importing a spreadsheet that
repeats a line, updates the row it names rather than adding a second one beside
it; a duplicate would split one shelf's stock across two rows and both would
read low.

**Stock moves by difference, never by assignment.** An administrator receiving
a delivery adds fifty; they do not set the count to fifty. Setting it would
silently undo every order placed between the moment the screen loaded and the
moment it was saved — and a pharmacy that sells stock it does not have is a
pharmacy that cancels orders after taking money for them.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import bad_request, conflict, not_found
from app.db.base import new_id, utcnow
from app.db.enums import ProductForm
from app.db.models import PharmacyProduct, Prescription
from app.modules.pharmacy.starter_catalog import CATEGORIES, STARTER_STOCK, starter_products

#: Words that mark a controlled substance. Not a legal schedule — DRAP's is the
#: authority — but a tripwire, so that an import cannot quietly put something on
#: the shelf that this pharmacy cannot lawfully sell over the internet.
CONTROLLED = re.compile(
    r"\b(alprazolam|bromazepam|clonazepam|diazepam|lorazepam|midazolam|nitrazepam|"
    r"zolpidem|codeine|tramadol|morphine|oxycodone|pethidine|fentanyl|buprenorphine|"
    r"nalbuphine|pentazocine|methadone|ketamine|dextropropoxyphene|methylphenidate|"
    r"phenobarbit\w*|pregabalin)\b",
    re.IGNORECASE,
)

#: The most rows one CSV import will take. A whole national formulary in one
#: request is a mistake, not a catalog.
MAX_IMPORT_ROWS = 2000


class ProductInput(BaseModel):
    """A product as an administrator writes it."""

    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    name: Annotated[str, Field(min_length=2, max_length=120)]
    generic_name: Annotated[str, Field(min_length=2, max_length=200)] = Field(alias="genericName")
    strength: Annotated[str, Field(max_length=60)] | None = None
    form: ProductForm
    pack_size: Annotated[str, Field(min_length=1, max_length=80)] = Field(alias="packSize")
    category: Annotated[str, Field(min_length=2, max_length=60)]
    manufacturer: Annotated[str, Field(max_length=120)] | None = None
    description: Annotated[str, Field(max_length=500)] | None = None
    price: Annotated[Decimal, Field(gt=0, le=1_000_000, decimal_places=2)]
    cost_price: Annotated[Decimal, Field(ge=0, le=1_000_000, decimal_places=2)] | None = Field(
        default=None, alias="costPrice"
    )
    low_stock_threshold: Annotated[int, Field(ge=0, le=100_000)] = Field(
        default=10, alias="lowStockThreshold"
    )
    rx_required: bool = Field(default=False, alias="rxRequired")
    active: bool = True

    @field_validator("strength", "manufacturer", "description")
    @classmethod
    def _blank_is_absent(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("name", "generic_name")
    @classmethod
    def _not_controlled(cls, value: str) -> str:
        if CONTROLLED.search(value):
            raise ValueError(
                "controlled substances cannot be sold through the online pharmacy"
            )
        return value


class ProductUpdate(BaseModel):
    """Any subset of a product's fields. Stock is not among them — see the module."""

    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    name: Annotated[str, Field(min_length=2, max_length=120)] | None = None
    generic_name: Annotated[str, Field(min_length=2, max_length=200)] | None = Field(
        default=None, alias="genericName"
    )
    strength: Annotated[str, Field(max_length=60)] | None = None
    form: ProductForm | None = None
    pack_size: Annotated[str, Field(min_length=1, max_length=80)] | None = Field(
        default=None, alias="packSize"
    )
    category: Annotated[str, Field(min_length=2, max_length=60)] | None = None
    manufacturer: Annotated[str, Field(max_length=120)] | None = None
    description: Annotated[str, Field(max_length=500)] | None = None
    price: Annotated[Decimal, Field(gt=0, le=1_000_000, decimal_places=2)] | None = None
    cost_price: Annotated[Decimal, Field(ge=0, le=1_000_000, decimal_places=2)] | None = Field(
        default=None, alias="costPrice"
    )
    low_stock_threshold: Annotated[int, Field(ge=0, le=100_000)] | None = Field(
        default=None, alias="lowStockThreshold"
    )
    rx_required: bool | None = Field(default=None, alias="rxRequired")
    active: bool | None = None

    @field_validator("name", "generic_name")
    @classmethod
    def _not_controlled(cls, value: str | None) -> str | None:
        if value and CONTROLLED.search(value):
            raise ValueError(
                "controlled substances cannot be sold through the online pharmacy"
            )
        return value


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def stock_state(product: PharmacyProduct) -> str:
    """``IN_STOCK``, ``LOW`` or ``OUT``, which is all a patient is told.

    The exact count is the pharmacy's business. A patient deciding whether to
    order needs to know whether they can have it, not how many boxes are on a
    shelf in a warehouse.
    """
    if product.stock <= 0:
        return "OUT"
    if product.stock <= product.low_stock_threshold:
        return "LOW"
    return "IN_STOCK"


def serialize_product(product: PharmacyProduct, *, admin: bool = False) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": product.id,
        "name": product.name,
        "genericName": product.generic_name,
        "strength": product.strength,
        "form": str(product.form),
        "packSize": product.pack_size,
        "category": product.category,
        "manufacturer": product.manufacturer,
        "description": product.description,
        "price": str(product.price),
        "rxRequired": product.rx_required,
        "active": product.active,
        "stockState": stock_state(product),
        "available": product.active and product.stock > 0,
    }
    if admin:
        body |= {
            "stock": product.stock,
            "lowStockThreshold": product.low_stock_threshold,
            "costPrice": str(product.cost_price) if product.cost_price is not None else None,
            "priceReviewed": product.price_reviewed,
            "createdAt": product.created_at.isoformat() + "Z" if product.created_at else None,
            "updatedAt": product.updated_at.isoformat() + "Z" if product.updated_at else None,
        }
    return body


def search_filters(
    *,
    search: str | None,
    category: str | None,
    rx_only: bool | None,
    include_inactive: bool,
) -> list[Any]:
    filters: list[Any] = []
    if not include_inactive:
        filters.append(PharmacyProduct.active.is_(True))
    if category:
        filters.append(func.lower(PharmacyProduct.category) == category.strip().lower())
    if rx_only is not None:
        filters.append(PharmacyProduct.rx_required.is_(rx_only))
    if search:
        term = f"%{search.strip()}%"
        filters.append(
            or_(
                PharmacyProduct.name.ilike(term),
                PharmacyProduct.generic_name.ilike(term),
                PharmacyProduct.manufacturer.ilike(term),
            )
        )
    return filters


async def categories(db: AsyncSession, *, include_inactive: bool = False) -> list[dict[str, Any]]:
    """Categories that actually have something in them, in shelf order.

    The starter catalog's own order comes first, because it is roughly how
    often people look; anything an administrator invented follows,
    alphabetically.
    """
    where = [] if include_inactive else [PharmacyProduct.active.is_(True)]
    rows = (
        await db.execute(
            select(PharmacyProduct.category, func.count(PharmacyProduct.id))
            .where(*where)
            .group_by(PharmacyProduct.category)
        )
    ).all()
    rank = {name: index for index, name in enumerate(CATEGORIES)}
    ordered = sorted(rows, key=lambda row: (rank.get(row[0], len(rank)), row[0]))
    return [{"name": name, "products": count} for name, count in ordered]


async def get_product(db: AsyncSession, product_id: str) -> PharmacyProduct:
    product = await db.get(PharmacyProduct, product_id)
    if product is None:
        raise not_found("Product")
    return product


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


async def find_by_key(
    db: AsyncSession, *, name: str, strength: str | None, form: ProductForm, pack_size: str
) -> PharmacyProduct | None:
    """The product with this brand, strength, form and pack — the same key the
    database's unique index enforces."""
    return (
        await db.execute(
            select(PharmacyProduct).where(
                func.lower(PharmacyProduct.name) == name.lower(),
                func.lower(func.coalesce(PharmacyProduct.strength, "")) == (strength or "").lower(),
                PharmacyProduct.form == form,
                func.lower(PharmacyProduct.pack_size) == pack_size.lower(),
            )
        )
    ).scalar_one_or_none()


async def create_product(db: AsyncSession, data: ProductInput) -> PharmacyProduct:
    if await find_by_key(
        db, name=data.name, strength=data.strength, form=data.form, pack_size=data.pack_size
    ):
        raise conflict("That product is already in the catalog. Edit it instead.")
    product = PharmacyProduct(
        id=new_id(),
        **data.model_dump(),
        stock=0,
        price_reviewed=True,
    )
    db.add(product)
    await db.flush()
    return product


async def update_product(
    db: AsyncSession, product: PharmacyProduct, data: ProductUpdate
) -> list[str]:
    """Apply an edit. Returns the names of the fields that changed."""
    changes = data.model_dump(exclude_unset=True)
    for key in ("name", "generic_name", "form", "pack_size", "category", "price"):
        if key in changes and changes[key] is None:
            raise bad_request(f"{key} cannot be empty.")

    changed = [key for key, value in changes.items() if getattr(product, key) != value]
    for key in changed:
        setattr(product, key, changes[key])
    if "price" in changes:
        # Saving a price is a person vouching for it, even an unchanged one —
        # that is how an estimated starter price becomes a checked one.
        product.price_reviewed = True
    try:
        await db.flush()
    except Exception as exc:  # the unique pack key
        raise conflict("Another product already has that name, strength, form and pack.") from exc
    return changed


async def adjust_stock(db: AsyncSession, product: PharmacyProduct, change: int) -> int:
    """Add or remove units, refusing to go below zero. Returns the new count.

    One guarded UPDATE, so a delivery booked in at the moment an order takes
    the last strip cannot lose either of them.
    """
    if change == 0:
        return product.stock
    result = await db.execute(
        update(PharmacyProduct)
        .where(PharmacyProduct.id == product.id, PharmacyProduct.stock + change >= 0)
        .values(stock=PharmacyProduct.stock + change, updated_at=utcnow())
        .returning(PharmacyProduct.stock)
    )
    count = result.scalar_one_or_none()
    if count is None:
        raise conflict("That would take the stock below zero.")
    await db.refresh(product)
    return int(count)


@dataclass
class ImportResult:
    created: int = 0
    updated: int = 0
    errors: list[dict[str, Any]] | None = None


async def upsert(
    db: AsyncSession, data: ProductInput, *, stock: int = 0, reviewed: bool = True
) -> bool:
    """Insert a product, or update the one with its key. Returns True if created.

    ``stock`` is *added*, never assigned — an import that lists a quantity is
    a delivery arriving, in keeping with the rest of this module.
    """
    existing = await find_by_key(
        db, name=data.name, strength=data.strength, form=data.form, pack_size=data.pack_size
    )
    if existing is None:
        db.add(
            PharmacyProduct(
                id=new_id(),
                **data.model_dump(),
                stock=max(stock, 0),
                price_reviewed=reviewed,
            )
        )
        await db.flush()
        return True

    for key, value in data.model_dump().items():
        setattr(existing, key, value)
    if stock:
        existing.stock = max(existing.stock + stock, 0)
    existing.price_reviewed = existing.price_reviewed or reviewed
    await db.flush()
    return False


async def load_starter(db: AsyncSession) -> ImportResult:
    """Put the starter catalog on the shelves, skipping what is already there.

    Products that exist are left exactly as they are. The administrator may
    already have corrected a starter price, and loading the catalog again must
    not quietly put the estimate back.
    """
    result = ImportResult()
    for row in starter_products():
        data = ProductInput.model_validate(row)
        if await find_by_key(
            db, name=data.name, strength=data.strength, form=data.form, pack_size=data.pack_size
        ):
            continue
        await upsert(db, data, stock=STARTER_STOCK, reviewed=False)
        result.created += 1
    return result


#: The columns a CSV may use, and the field each one fills. Headers are matched
#: case-insensitively and with spaces ignored, so "Generic Name" and
#: "genericName" both work — a spreadsheet exported by a supplier is not going
#: to match anybody's casing.
CSV_COLUMNS = {
    "name": "name",
    "brand": "name",
    "genericname": "genericName",
    "generic": "genericName",
    "strength": "strength",
    "form": "form",
    "packsize": "packSize",
    "pack": "packSize",
    "category": "category",
    "manufacturer": "manufacturer",
    "description": "description",
    "price": "price",
    "mrp": "price",
    "costprice": "costPrice",
    "cost": "costPrice",
    "stock": "stock",
    "quantity": "stock",
    "lowstockthreshold": "lowStockThreshold",
    "rxrequired": "rxRequired",
    "prescription": "rxRequired",
    "active": "active",
}

_TRUE = {"1", "true", "yes", "y", "rx", "required"}
_FALSE = {"0", "false", "no", "n", "otc", ""}

#: How pharmacy stock sheets abbreviate a form, mapped to the catalog's own.
_FORM_ALIASES = {
    "TAB": "TABLET",
    "TABS": "TABLET",
    "TABLETS": "TABLET",
    "CAP": "CAPSULE",
    "CAPS": "CAPSULE",
    "CAPSULES": "CAPSULE",
    "SYP": "SYRUP",
    "SUSP": "SUSPENSION",
    "INJ": "INJECTION",
    "OINT": "OINTMENT",
    "DROP": "DROPS",
    "SACHETS": "SACHET",
    "SOL": "SOLUTION",
    "LOZENGE": "OTHER",
    "LOZENGES": "OTHER",
}


def parse_csv(content: bytes) -> tuple[list[tuple[int, ProductInput, int]], list[dict[str, Any]]]:
    """Read a catalog spreadsheet. Returns (rows, errors).

    Each row is ``(line number, product, stock to add)``. A bad row is reported
    by line and skipped; it does not sink the file, because a supplier's export
    with one malformed line should not cost the other two hundred.
    """
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("cp1252", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise bad_request("The file has no header row.")

    mapping = {
        header: CSV_COLUMNS.get(re.sub(r"[\s_-]", "", header or "").lower())
        for header in reader.fieldnames
    }
    known = set(filter(None, mapping.values()))
    missing = {"name", "genericName", "form", "packSize", "category", "price"} - known
    if missing:
        raise bad_request("The file is missing columns: " + ", ".join(sorted(missing)) + ".")

    rows: list[tuple[int, ProductInput, int]] = []
    errors: list[dict[str, Any]] = []
    for number, raw in enumerate(reader, start=2):
        if number - 1 > MAX_IMPORT_ROWS:
            errors.append({"line": number, "error": f"Only {MAX_IMPORT_ROWS} rows are read per file."})
            break
        record: dict[str, Any] = {}
        for header, value in raw.items():
            field = mapping.get(header)
            if field:
                record[field] = (value or "").strip()
        if not any(record.values()):
            continue

        try:
            stock = int(record.pop("stock", "") or 0)
            if "rxRequired" in record:
                flag = record["rxRequired"].lower()
                if flag not in _TRUE | _FALSE:
                    raise ValueError("rxRequired must be yes or no")
                record["rxRequired"] = flag in _TRUE
            if "active" in record:
                record["active"] = record["active"].lower() not in _FALSE - {""}
            form = re.sub(r"[^A-Z]", "", record.get("form", "").upper())
            record["form"] = _FORM_ALIASES.get(form, form) or "OTHER"
            for money in ("price", "costPrice"):
                if record.get(money):
                    record[money] = Decimal(record[money].replace(",", ""))
                else:
                    record.pop(money, None)
            if record.get("lowStockThreshold"):
                record["lowStockThreshold"] = int(record["lowStockThreshold"])
            else:
                record.pop("lowStockThreshold", None)
            rows.append((number, ProductInput.model_validate(record), stock))
        except (ValueError, InvalidOperation, ValidationError) as exc:
            message = (
                "; ".join(
                    f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in exc.errors()
                )
                if isinstance(exc, ValidationError)
                else str(exc) or "unreadable value"
            )
            errors.append({"line": number, "error": message})
    return rows, errors


async def import_csv(db: AsyncSession, content: bytes) -> ImportResult:
    rows, errors = parse_csv(content)
    result = ImportResult(errors=errors)
    for _, data, stock in rows:
        if await upsert(db, data, stock=stock, reviewed=True):
            result.created += 1
        else:
            result.updated += 1
    return result


# ---------------------------------------------------------------------------
# Prescriptions and products
# ---------------------------------------------------------------------------


def _squash(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


_STRENGTH = re.compile(r"(\d+(?:\.\d+)?)\s*(?:mg|mcg|µg|g|ml|iu|%)", re.IGNORECASE)


def prescribes(prescription: Prescription, product: PharmacyProduct) -> bool:
    """Whether a doctor's prescription names this product.

    Exact when the doctor picked the product from the catalog. Otherwise read
    from what they wrote: the brand or the *whole* generic name must appear in
    it — "Amoxicillin 500 mg" covers Amoxil, but not Augmentin, which is
    amoxicillin with something else — and if a strength was written, it must
    be this product's strength. A prescription for 250 mg does not buy 500.
    """
    if prescription.product_id is not None:
        return prescription.product_id == product.id

    written = f"{prescription.medication} {prescription.dosage}"
    squashed = _squash(written)
    named = bool(squashed) and (
        _squash(product.generic_name) in squashed or _squash(product.name) in squashed
    )
    if not named:
        return False

    wanted = {float(n) for n in _STRENGTH.findall(written)}
    if not wanted or not product.strength:
        return True
    have = _STRENGTH.findall(product.strength)
    return bool(have) and float(have[0]) in wanted
