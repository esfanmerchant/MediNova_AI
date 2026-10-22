"""The pharmacy's rules: what may be sold, what a prescription covers, and what
an order costs.

No database. Pricing, coverage and the catalog's guard rails are decided from
rows in memory, so they are checked here exhaustively rather than one order at
a time through HTTP.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.db.enums import (
    PharmacyOrderStatus,
    PharmacyPaymentMethod,
    ProductForm,
    Role,
    RxRoute,
    RxStatus,
)
from app.db.models import PharmacyOrder, PharmacyProduct, PharmacySettings, Prescription
from app.modules.auth.rbac import Permission, role_has_permission
from app.modules.pharmacy import catalog, orders
from app.modules.pharmacy.starter_catalog import CATEGORIES, starter_products


def product(**overrides: object) -> PharmacyProduct:
    fields: dict[str, object] = {
        "id": "prod-amoxil",
        "name": "Amoxil",
        "generic_name": "Amoxicillin",
        "strength": "500 mg",
        "form": ProductForm.CAPSULE,
        "pack_size": "Pack of 20 capsules",
        "category": "Antibiotics & Infections",
        "price": Decimal("340"),
        "stock": 50,
        "low_stock_threshold": 10,
        "rx_required": True,
        "active": True,
    }
    fields.update(overrides)
    return PharmacyProduct(**fields)


def prescription(medication: str, dosage: str = "1 cap", product_id: str | None = None) -> Prescription:
    return Prescription(
        id="rx-1",
        patient_id="patient-1",
        doctor_id="doctor-1",
        medication=medication,
        dosage=dosage,
        frequency="TID",
        duration="5 days",
        active=True,
        product_id=product_id,
    )


def store(**overrides: object) -> PharmacySettings:
    fields: dict[str, object] = {
        "id": PharmacySettings.SINGLETON,
        "delivery_fee": Decimal("150"),
        "free_delivery_above": Decimal("3000"),
        "cod_enabled": True,
        "cod_max_amount": Decimal("25000"),
        "cities": [],
        "pharmacy_name": "MediNova Pharmacy",
    }
    fields.update(overrides)
    return PharmacySettings(**fields)


class TestTheStarterCatalog:
    def test_every_line_is_a_valid_product(self) -> None:
        for row in starter_products():
            catalog.ProductInput.model_validate(row)

    def test_it_is_a_real_shelf(self) -> None:
        assert len(starter_products()) >= 80

    def test_no_line_appears_twice(self) -> None:
        # The database refuses a second row with the same pack key; the
        # starter list must not be the thing that trips it.
        keys = [
            (r["name"].lower(), (r["strength"] or "").lower(), r["form"], r["pack_size"].lower())
            for r in starter_products()
        ]
        assert len(keys) == len(set(keys))

    def test_it_sells_nothing_controlled(self) -> None:
        for row in starter_products():
            assert not catalog.CONTROLLED.search(row["name"])
            assert not catalog.CONTROLLED.search(row["generic_name"])

    def test_antibiotics_need_a_prescription(self) -> None:
        antibiotics = [r for r in starter_products() if r["category"] == "Antibiotics & Infections"]
        assert antibiotics
        assert all(r["rx_required"] for r in antibiotics)

    def test_everyday_medicines_do_not(self) -> None:
        panadol = next(r for r in starter_products() if r["name"] == "Panadol")
        assert panadol["rx_required"] is False

    def test_every_category_is_a_known_shelf(self) -> None:
        assert {r["category"] for r in starter_products()} <= set(CATEGORIES)


class TestTheCatalogGuards:
    def test_a_controlled_substance_cannot_be_added(self) -> None:
        with pytest.raises(ValidationError, match="controlled"):
            catalog.ProductInput.model_validate(
                {
                    "name": "Xanax",
                    "genericName": "Alprazolam",
                    "form": "TABLET",
                    "packSize": "Strip of 10",
                    "category": "Other",
                    "price": "300",
                }
            )

    def test_a_product_must_cost_something(self) -> None:
        with pytest.raises(ValidationError):
            catalog.ProductInput.model_validate(
                {
                    "name": "Panadol",
                    "genericName": "Paracetamol",
                    "form": "TABLET",
                    "packSize": "Strip of 10",
                    "category": "Pain",
                    "price": "0",
                }
            )

    @pytest.mark.parametrize(
        ("stock", "state"), [(0, "OUT"), (5, "LOW"), (10, "LOW"), (11, "IN_STOCK")]
    )
    def test_a_patient_sees_a_state_not_a_count(self, stock: int, state: str) -> None:
        item = product(stock=stock)
        assert catalog.stock_state(item) == state
        assert "stock" not in catalog.serialize_product(item)
        assert catalog.serialize_product(item, admin=True)["stock"] == stock


class TestCsvImport:
    def test_a_supplier_sheet_with_its_own_headers_is_read(self) -> None:
        sheet = (
            b"Brand,Generic Name,Strength,Form,Pack,Category,MRP,Stock,Prescription\n"
            b"Panadol,Paracetamol,500 mg,Tab,Strip of 10,Pain & Fever,40,200,no\n"
            b"Amoxil,Amoxicillin,500 mg,caps,Pack of 20,Antibiotics,\"1,340\",20,yes\n"
        )
        rows, errors = catalog.parse_csv(sheet)
        assert errors == []
        (_, panadol, panadol_stock), (_, amoxil, _) = rows
        assert panadol.form is ProductForm.TABLET
        assert panadol_stock == 200
        assert panadol.rx_required is False
        assert amoxil.form is ProductForm.CAPSULE
        assert amoxil.price == Decimal("1340")
        assert amoxil.rx_required is True

    def test_a_bad_line_is_reported_and_the_rest_still_load(self) -> None:
        sheet = (
            b"name,genericName,form,packSize,category,price\n"
            b"Panadol,Paracetamol,TABLET,Strip of 10,Pain,40\n"
            b"Broken,Thing,TABLET,Strip of 10,Pain,free\n"
            b"Valium,Diazepam,TABLET,Strip of 10,Other,90\n"
        )
        rows, errors = catalog.parse_csv(sheet)
        assert [data.name for _, data, _ in rows] == ["Panadol"]
        assert [e["line"] for e in errors] == [3, 4]

    def test_a_sheet_missing_a_column_is_refused_outright(self) -> None:
        with pytest.raises(Exception, match="price"):
            catalog.parse_csv(b"name,genericName,form,packSize,category\nA,B,TABLET,1,C\n")


class TestWhatAPrescriptionCovers:
    def test_a_product_picked_by_the_doctor_is_exact(self) -> None:
        amoxil = product()
        assert catalog.prescribes(prescription("anything", product_id=amoxil.id), amoxil)
        assert not catalog.prescribes(prescription("Amoxil 500 mg", product_id="other"), amoxil)

    def test_the_generic_name_covers_the_brand(self) -> None:
        assert catalog.prescribes(prescription("Amoxicillin", "500 mg"), product())

    def test_the_brand_name_covers_itself(self) -> None:
        assert catalog.prescribes(prescription("AMOXIL 500MG"), product())

    def test_one_ingredient_does_not_cover_a_combination(self) -> None:
        # Augmentin is amoxicillin *and* clavulanic acid. A prescription for
        # amoxicillin alone is not a prescription for it.
        augmentin = product(
            id="prod-aug",
            name="Augmentin",
            generic_name="Amoxicillin + Clavulanic acid",
            strength="625 mg",
        )
        assert not catalog.prescribes(prescription("Amoxicillin 500 mg"), augmentin)
        assert catalog.prescribes(prescription("Augmentin 625 mg"), augmentin)

    def test_a_different_strength_is_not_covered(self) -> None:
        assert not catalog.prescribes(prescription("Amoxicillin", "250 mg"), product())

    def test_no_strength_written_is_not_a_mismatch(self) -> None:
        assert catalog.prescribes(prescription("Amoxicillin", "1 cap"), product())

    def test_a_different_medicine_is_not_covered(self) -> None:
        assert not catalog.prescribes(prescription("Metformin 500 mg"), product())


class TestDelivery:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("03001234567", "03001234567"),
            ("0300-1234567", "03001234567"),
            ("+92 300 1234567", "03001234567"),
            ("923001234567", "03001234567"),
            ("3001234567", "03001234567"),
        ],
    )
    def test_a_mobile_number_is_written_the_courier_way(self, value: str, expected: str) -> None:
        assert orders.normalize_phone(value) == expected

    @pytest.mark.parametrize("value", ["0213456789", "12345", "04235761234"])
    def test_a_number_a_rider_cannot_call_is_refused(self, value: str) -> None:
        with pytest.raises(ValueError):
            orders.normalize_phone(value)

    def test_delivery_is_free_above_the_threshold(self) -> None:
        assert orders.delivery_fee_for(Decimal("2999"), store()) == Decimal("150")
        assert orders.delivery_fee_for(Decimal("3000"), store()) == Decimal("0")

    def test_no_threshold_means_never_free(self) -> None:
        assert orders.delivery_fee_for(Decimal("90000"), store(free_delivery_above=None)) == Decimal(
            "150"
        )

    def test_cash_on_delivery_has_a_ceiling(self) -> None:
        assert orders.cod_refusal(Decimal("25000"), store()) is None
        assert "25000" in (orders.cod_refusal(Decimal("25001"), store()) or "")

    def test_cash_on_delivery_can_be_switched_off(self) -> None:
        assert orders.cod_refusal(Decimal("100"), store(cod_enabled=False))

    def test_an_empty_city_list_delivers_everywhere(self) -> None:
        assert orders.city_refusal("Quetta", store()) is None

    def test_a_city_list_is_matched_without_caring_about_case(self) -> None:
        served = store(cities=["Karachi", "Lahore"])
        assert orders.city_refusal("  karachi ", served) is None
        assert orders.city_refusal("Quetta", served)

    def test_checkout_normalises_the_phone(self) -> None:
        request = orders.CheckoutRequest.model_validate(
            {
                "items": [{"productId": "p1", "quantity": 2}],
                "paymentMethod": "COD",
                "recipientName": "Ayesha Khan",
                "phone": "+92 321 7654321",
                "addressLine": "House 12, Street 4, Gulshan-e-Iqbal",
                "city": "Karachi",
            }
        )
        assert request.phone == "03217654321"


class TestTheCart:
    def test_two_lines_of_one_product_are_one_line(self) -> None:
        merged = orders._merge(
            [
                orders.CartLine(productId="a", quantity=2),
                orders.CartLine(productId="b", quantity=1),
                orders.CartLine(productId="a", quantity=3, prescriptionId="rx-9"),
            ]
        )
        assert [(m.product_id, m.quantity) for m in merged] == [("a", 5), ("b", 1)]
        assert merged[0].prescription_id == "rx-9"

    def test_merging_never_exceeds_the_per_line_limit(self) -> None:
        merged = orders._merge(
            [
                orders.CartLine(productId="a", quantity=orders.MAX_QUANTITY),
                orders.CartLine(productId="a", quantity=5),
            ]
        )
        assert merged[0].quantity == orders.MAX_QUANTITY

    def test_a_quantity_past_the_limit_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            orders.CartLine(productId="a", quantity=orders.MAX_QUANTITY + 1)

    def test_only_an_uncovered_prescription_medicine_needs_a_prescription(self) -> None:
        covered = orders.PricedLine(
            product=product(), quantity=1, unit_price=Decimal("340"), line_total=Decimal("340"),
            prescription=prescription("Amoxicillin 500 mg"),
        )
        uncovered = orders.PricedLine(
            product=product(id="p2"), quantity=1, unit_price=Decimal("340"), line_total=Decimal("340"),
        )
        otc = orders.PricedLine(
            product=product(id="p3", rx_required=False), quantity=1,
            unit_price=Decimal("40"), line_total=Decimal("40"),
        )
        assert not covered.needs_rx
        assert uncovered.needs_rx
        assert not otc.needs_rx
        quote = orders.Quote(
            lines=[covered, otc], subtotal=Decimal("380"), delivery_fee=Decimal("150"),
            total=Decimal("530"),
        )
        assert not quote.needs_rx
        assert quote.has_rx_items


class TestTheTracker:
    def order(self, **overrides: object) -> PharmacyOrder:
        fields: dict[str, object] = {
            "id": "o1",
            "order_number": "ORD-2026-000001",
            "status": PharmacyOrderStatus.CONFIRMED,
            "payment_method": PharmacyPaymentMethod.COD,
            "rx_status": RxStatus.NOT_REQUIRED,
            "rx_route": None,
            "created_at": datetime(2026, 10, 1, 9, 0),
            "confirmed_at": datetime(2026, 10, 1, 9, 0),
        }
        fields.update(overrides)
        return PharmacyOrder(**fields)

    def test_a_plain_cash_order_has_no_prescription_step(self) -> None:
        keys = [step["key"] for step in orders.timeline(self.order())]
        assert keys == ["PLACED", "CONFIRMED", "PACKED", "DISPATCHED", "DELIVERED"]

    def test_an_uploaded_prescription_is_a_step_of_its_own(self) -> None:
        steps = orders.timeline(
            self.order(
                status=PharmacyOrderStatus.PENDING_RX,
                payment_method=PharmacyPaymentMethod.ONLINE,
                rx_route=RxRoute.UPLOAD,
                rx_status=RxStatus.PENDING,
                confirmed_at=None,
            )
        )
        assert [s["key"] for s in steps][:3] == ["PLACED", "PRESCRIPTION", "PAID"]
        assert steps[1]["done"] is False

    def test_a_refused_prescription_shows_as_failed(self) -> None:
        steps = orders.timeline(
            self.order(
                status=PharmacyOrderStatus.CANCELLED,
                rx_route=RxRoute.DOCTOR,
                rx_status=RxStatus.REJECTED,
                cancelled_at=datetime(2026, 10, 2),
            )
        )
        assert steps[1]["failed"] is True
        assert steps[-1]["key"] == "CANCELLED"


class TestWhoDoesWhat:
    def test_patients_shop_for_themselves(self) -> None:
        assert role_has_permission(Role.PATIENT, Permission.PHARMACY_ORDER_OWN)
        assert not role_has_permission(Role.PATIENT, Permission.PHARMACY_MANAGE)
        assert not role_has_permission(Role.PATIENT, Permission.PHARMACY_RX_APPROVE)

    def test_doctors_approve_and_do_not_run_the_shop(self) -> None:
        assert role_has_permission(Role.DOCTOR, Permission.PHARMACY_RX_APPROVE)
        assert role_has_permission(Role.DOCTOR, Permission.PHARMACY_BROWSE)
        assert not role_has_permission(Role.DOCTOR, Permission.PHARMACY_MANAGE)

    def test_the_administrator_runs_it_and_approves_no_medicine(self) -> None:
        # Running a shop is not a clinical role. The administrator checks a
        # prescription a patient sent; they do not get to sign one off.
        assert role_has_permission(Role.ADMIN, Permission.PHARMACY_MANAGE)
        assert not role_has_permission(Role.ADMIN, Permission.PHARMACY_RX_APPROVE)
        assert not role_has_permission(Role.ADMIN, Permission.PHARMACY_ORDER_OWN)

    def test_nurses_have_no_part_in_it(self) -> None:
        for permission in (
            Permission.PHARMACY_BROWSE,
            Permission.PHARMACY_ORDER_OWN,
            Permission.PHARMACY_RX_APPROVE,
            Permission.PHARMACY_MANAGE,
        ):
            assert not role_has_permission(Role.NURSE, permission)
