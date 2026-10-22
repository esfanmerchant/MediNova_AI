"""Online consultations: which slots can be a call, and who may enter the room.

No database. The room's rules are decided from an appointment and its invoice,
so both are built in memory here and the database read is replaced — what is
under test is the decision, not the query.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import jwt
import pytest
from pydantic import ValidationError

from app.core.config import settings
from app.db.enums import AppointmentMode, AppointmentStatus, InvoiceStatus
from app.db.models import Appointment, Invoice
from app.modules.appointments import service, video
from app.modules.appointments.schedule import (
    ONLINE_SLOT_MINUTES,
    AvailabilityWindow,
    WindowMode,
    find_slot,
    offers_online,
    parse_windows,
    slots_for_day,
)
from app.modules.billing.service import build_line_items

MONDAY = date(2026, 9, 7)
NOW = datetime(2026, 9, 7, 9, 0)

KEY = "test-sdk-key"
SECRET = "test-sdk-secret-that-is-long-enough-for-hs256"


@pytest.fixture(autouse=True)
def karachi(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "CLINIC_TIMEZONE", "Asia/Karachi")


@pytest.fixture
def zoom(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_KEY", KEY)
    monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_SECRET", SECRET)


def window(mode: str = "CLINIC", minutes: int = 30) -> AvailabilityWindow:
    return AvailabilityWindow.model_validate(
        {
            "dayOfWeek": 1,
            "startTime": "10:00",
            "endTime": "12:00",
            "slotMinutes": minutes,
            "mode": mode,
        }
    )


def appointment(
    *,
    status: AppointmentStatus = AppointmentStatus.CONFIRMED,
    mode: AppointmentMode = AppointmentMode.ONLINE,
    start: datetime = NOW + timedelta(minutes=5),
) -> Appointment:
    return Appointment(
        id="appt-1",
        patient_id="patient-1",
        doctor_id="doctor-1",
        start_time=start,
        end_time=start + timedelta(minutes=ONLINE_SLOT_MINUTES),
        status=status,
        mode=mode,
        video_room=video.new_room_name(),
    )


def invoice(status: InvoiceStatus = InvoiceStatus.PAID, total: str = "2000") -> Invoice:
    return Invoice(
        id="inv-1",
        invoice_number="INV-2026-000001",
        amount=Decimal(total),
        total_amount=Decimal(total),
        status=status,
    )


def with_invoice(
    monkeypatch: pytest.MonkeyPatch, bill: Invoice | None, *, awaiting: bool = False
) -> None:
    async def fake(_db: object, _appointment_id: str) -> tuple[Invoice | None, bool]:
        return bill, awaiting

    monkeypatch.setattr(video, "invoice_for", fake)


class TestWindowModes:
    def test_a_window_saved_before_online_consultations_is_a_clinic_window(self) -> None:
        # Every doctor's availability predates this feature. It must keep
        # meaning exactly what it meant.
        stored = {"dayOfWeek": 1, "startTime": "09:00", "endTime": "12:00", "slotMinutes": 15}
        (parsed,) = parse_windows([stored])
        assert parsed.mode is WindowMode.CLINIC
        slot = slots_for_day([parsed], MONDAY)[0]
        assert slot.modes == {AppointmentMode.CLINIC}

    def test_the_mode_is_stored(self) -> None:
        assert window("BOTH").as_stored()["mode"] == "BOTH"

    def test_an_online_window_uses_the_consultation_length(self) -> None:
        # A 15-minute "online" slot would be a call that ends as it starts.
        with pytest.raises(ValidationError, match="30-minute"):
            window("ONLINE", minutes=15)
        with pytest.raises(ValidationError, match="30-minute"):
            window("BOTH", minutes=60)

    def test_a_clinic_window_keeps_any_slot_length(self) -> None:
        assert window("CLINIC", minutes=15).slot_minutes == 15

    def test_a_both_window_offers_each_slot_either_way(self) -> None:
        slots = slots_for_day([window("BOTH")], MONDAY)
        assert len(slots) == 4
        assert all(s.modes == {AppointmentMode.CLINIC, AppointmentMode.ONLINE} for s in slots)

    def test_an_online_window_offers_only_calls(self) -> None:
        slot = slots_for_day([window("ONLINE")], MONDAY)[0]
        assert slot.modes == {AppointmentMode.ONLINE}

    def test_booking_resolves_the_slot_with_its_modes(self) -> None:
        # Booking reads the mode off the doctor's own grid, never the client's.
        slot = slots_for_day([window("ONLINE")], MONDAY)[1]
        found = find_slot([window("ONLINE")], slot.start)
        assert found is not None
        assert found.modes == {AppointmentMode.ONLINE}

    def test_a_doctor_offers_online_only_with_an_online_window(self) -> None:
        assert not offers_online([window("CLINIC")])
        assert offers_online([window("CLINIC"), window("BOTH")])

    def test_an_unknown_mode_costs_that_window_not_the_calendar(self) -> None:
        stored = [
            {"dayOfWeek": 1, "startTime": "09:00", "endTime": "10:00", "mode": "TELEPATHY"},
            {"dayOfWeek": 2, "startTime": "09:00", "endTime": "10:00"},
        ]
        assert [w.day_of_week for w in parse_windows(stored)] == [2]


class TestOnlineIsOnlyOfferedWhereCallsCanHappen:
    def test_production_without_zoom_offers_no_online_slots(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Taking money for a call that cannot start is the outcome to prevent.
        monkeypatch.setattr(settings, "NODE_ENV", "production")
        monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_KEY", "")
        slot = slots_for_day([window("BOTH")], MONDAY)[0]
        assert service.online_consultations_available() is False
        assert service.bookable_modes(slot) == {AppointmentMode.CLINIC}

    def test_production_with_zoom_offers_them(
        self, monkeypatch: pytest.MonkeyPatch, zoom: None
    ) -> None:
        monkeypatch.setattr(settings, "NODE_ENV", "production")
        assert service.online_consultations_available() is True

    def test_development_offers_them_without_keys(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # So the booking and payment flow can be built before a Zoom account.
        monkeypatch.setattr(settings, "NODE_ENV", "development")
        monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_KEY", "")
        assert service.online_consultations_available() is True


class TestTheRoom:
    async def room(self, appt: Appointment, now: datetime = NOW) -> video.RoomState:
        return (await video.room_for(None, appt, now=now)).state  # type: ignore[arg-type]

    async def test_it_opens_for_a_paid_confirmed_consultation(
        self, monkeypatch: pytest.MonkeyPatch, zoom: None
    ) -> None:
        with_invoice(monkeypatch, invoice())
        assert await self.room(appointment()) is video.RoomState.OPEN

    async def test_unpaid_says_so_before_anything_about_time(
        self, monkeypatch: pytest.MonkeyPatch, zoom: None
    ) -> None:
        # "Pay to join" is worth knowing the day before; "not open yet" would
        # hide it until it was too late to clear.
        with_invoice(monkeypatch, invoice(InvoiceStatus.ISSUED))
        tomorrow = appointment(start=NOW + timedelta(days=1))
        assert await self.room(tomorrow) is video.RoomState.UNPAID

    async def test_a_payment_in_review_is_not_the_same_as_unpaid(
        self, monkeypatch: pytest.MonkeyPatch, zoom: None
    ) -> None:
        with_invoice(monkeypatch, invoice(InvoiceStatus.ISSUED), awaiting=True)
        assert await self.room(appointment()) is video.RoomState.PAYMENT_UNDER_REVIEW

    async def test_a_free_consultation_needs_no_payment(
        self, monkeypatch: pytest.MonkeyPatch, zoom: None
    ) -> None:
        with_invoice(monkeypatch, invoice(InvoiceStatus.ISSUED, total="0"))
        assert await self.room(appointment()) is video.RoomState.OPEN

    async def test_it_opens_ten_minutes_before(
        self, monkeypatch: pytest.MonkeyPatch, zoom: None
    ) -> None:
        with_invoice(monkeypatch, invoice())
        appt = appointment(start=NOW + timedelta(minutes=30))
        assert await self.room(appt) is video.RoomState.TOO_EARLY
        assert await self.room(appt, NOW + timedelta(minutes=20)) is video.RoomState.OPEN

    async def test_it_closes_fifteen_minutes_after_the_end(
        self, monkeypatch: pytest.MonkeyPatch, zoom: None
    ) -> None:
        with_invoice(monkeypatch, invoice())
        appt = appointment(start=NOW)
        end = appt.end_time
        assert await self.room(appt, end + timedelta(minutes=14)) is video.RoomState.OPEN
        assert await self.room(appt, end + timedelta(minutes=16)) is video.RoomState.ENDED

    @pytest.mark.parametrize(
        ("status", "expected"),
        [
            (AppointmentStatus.REQUESTED, video.RoomState.NOT_CONFIRMED),
            (AppointmentStatus.CANCELLED, video.RoomState.CANCELLED),
            (AppointmentStatus.NO_SHOW, video.RoomState.CANCELLED),
            (AppointmentStatus.COMPLETED, video.RoomState.ENDED),
            (AppointmentStatus.IN_PROGRESS, video.RoomState.OPEN),
        ],
    )
    async def test_the_appointment_status_decides_first(
        self,
        monkeypatch: pytest.MonkeyPatch,
        zoom: None,
        status: AppointmentStatus,
        expected: video.RoomState,
    ) -> None:
        with_invoice(monkeypatch, invoice())
        assert await self.room(appointment(status=status)) is expected

    async def test_a_clinic_visit_has_no_room(
        self, monkeypatch: pytest.MonkeyPatch, zoom: None
    ) -> None:
        with_invoice(monkeypatch, invoice())
        clinic = appointment(mode=AppointmentMode.CLINIC)
        assert await self.room(clinic) is video.RoomState.NOT_ONLINE

    async def test_without_keys_the_room_says_why_it_will_not_open(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_KEY", "")
        with_invoice(monkeypatch, invoice())
        assert await self.room(appointment()) is video.RoomState.NOT_CONFIGURED

    def test_every_state_has_words_for_a_person(self) -> None:
        assert set(video.MESSAGES) == set(video.RoomState)


class TestTheToken:
    def decode(self, token: str) -> dict[str, object]:
        return jwt.decode(token, SECRET, algorithms=["HS256"], options={"verify_exp": False})

    def test_it_opens_this_room_and_no_other(self, zoom: None) -> None:
        appt = appointment()
        claims = self.decode(video.sign_token(appt, host=False, now=NOW).token)
        assert claims["tpc"] == appt.video_room
        assert claims["app_key"] == KEY
        assert claims["version"] == 1

    def test_the_doctor_hosts_and_the_patient_joins(self, zoom: None) -> None:
        appt = appointment()
        assert self.decode(video.sign_token(appt, host=True, now=NOW).token)["role_type"] == 1
        assert self.decode(video.sign_token(appt, host=False, now=NOW).token)["role_type"] == 0

    def test_it_lives_at_least_as_long_as_zoom_requires(self, zoom: None) -> None:
        claims = self.decode(video.sign_token(appointment(), host=True, now=NOW).token)
        assert int(claims["exp"]) - int(claims["iat"]) >= 1800  # type: ignore[call-overload]

    def test_it_lasts_until_the_room_closes(self, zoom: None) -> None:
        # A dropped connection rejoins with the same token.
        appt = appointment(start=NOW)
        claims = self.decode(video.sign_token(appt, host=True, now=NOW).token)
        closes = video.closes_at(appt).replace(tzinfo=UTC).timestamp()
        assert claims["exp"] == int(closes)

    def test_times_are_utc_whatever_the_server_clock_says(self, zoom: None) -> None:
        # The columns are naive UTC; reading one as local time would sign a
        # token hours in the past on a server in Karachi.
        claims = self.decode(video.sign_token(appointment(), host=True, now=NOW).token)
        issued = datetime.fromtimestamp(int(claims["iat"]), tz=UTC).replace(tzinfo=None)  # type: ignore[call-overload]
        assert NOW - timedelta(minutes=1) < issued <= NOW

    def test_it_asks_for_no_recording(self, zoom: None) -> None:
        claims = self.decode(video.sign_token(appointment(), host=True, now=NOW).token)
        assert not any("record" in key for key in claims)

    def test_room_names_are_unguessable_and_zoom_safe(self) -> None:
        names = {video.new_room_name() for _ in range(200)}
        assert len(names) == 200
        assert all(name.isalnum() and len(name) <= 150 for name in names)


class TestTheBill:
    def test_an_online_consultation_says_so_on_the_invoice(self) -> None:
        (line,) = build_line_items(
            doctor_name="Dr Sana Iqbal", specialization="Dermatology", fee=Decimal("2500"), online=True
        )
        assert line["description"].startswith("Online consultation")
        assert line["amount"] == "2500.00"

    def test_a_clinic_visit_reads_as_it_always_did(self) -> None:
        (line,) = build_line_items(
            doctor_name="Dr Sana Iqbal", specialization="Dermatology", fee=Decimal("2500")
        )
        assert line["description"] == "Consultation — Dr Sana Iqbal (Dermatology)"
