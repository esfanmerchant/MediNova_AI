from __future__ import annotations

from datetime import timedelta

from app.core.session_policy import (
    absolute_timeout_seconds,
    access_token_ttl_seconds,
    check_idle,
    idle_timeout_seconds,
)
from app.db.base import utcnow


def seconds_ago(n: int):
    return utcnow() - timedelta(seconds=n)


class TestInactivityTimeout:
    """R8 — enforced server-side, tiered by device class (conflict C3)."""

    def test_shared_terminal_is_exactly_two_minutes(self) -> None:
        assert idle_timeout_seconds("SHARED_TERMINAL") == 120
        assert not check_idle("SHARED_TERMINAL", seconds_ago(119)).expired
        assert check_idle("SHARED_TERMINAL", seconds_ago(121)).expired

    def test_an_unknown_device_class_falls_back_to_the_strictest_tier(self) -> None:
        # A client must not be able to widen its own timeout by sending junk.
        assert idle_timeout_seconds("WHATEVER") == 120
        assert check_idle("WHATEVER", seconds_ago(300)).expired

    def test_a_personal_device_stays_signed_in_for_a_week(self) -> None:
        """The phone in somebody's pocket is not the machine R8 is about.

        R8 exists for an unattended ward terminal, where the next person to
        touch it is a stranger. A personal device has a lock screen in front of
        it and one owner, and holding it to the same window only meant a patient
        signed in again every time they came back to check a dose.

        Seven days rather than forever: a lost phone stops being a way in within
        a week without anybody having to report it.
        """
        week = 60 * 60 * 24 * 7
        assert idle_timeout_seconds("PERSONAL") == week
        assert not check_idle("PERSONAL", seconds_ago(week - 60)).expired
        assert check_idle("PERSONAL", seconds_ago(week + 60)).expired

    def test_the_long_window_does_not_lengthen_the_credential(self) -> None:
        """What lives a week is the right to ask for a token, not the token.

        A session that outlives its access token is the point of having two: the
        access token still dies in fifteen minutes, so one lifted off the wire
        is worth fifteen minutes and not seven days.
        """
        assert access_token_ttl_seconds("PERSONAL") == 15 * 60

    def test_the_hard_ceiling_follows_the_same_rule(self) -> None:
        """Otherwise the twelve-hour cap would end the week on its first night.

        Two timeouts govern a session — inactivity and an absolute ceiling — and
        raising only one of them would have left the other quietly doing the
        same job it did before.
        """
        assert absolute_timeout_seconds("PERSONAL") == 60 * 60 * 24 * 7
        assert absolute_timeout_seconds("SHARED_TERMINAL") == 43_200
        # And junk still lands on the strict tier, as everywhere else here.
        assert absolute_timeout_seconds("WHATEVER") == 43_200

    def test_monitoring_displays_are_exempt(self) -> None:
        # A vitals wall exists to be watched, not touched.
        assert idle_timeout_seconds("MONITOR") is None
        result = check_idle("MONITOR", seconds_ago(86_400))
        assert not result.expired
        assert result.remaining_seconds is None

    def test_reports_remaining_seconds_for_the_client_warning(self) -> None:
        remaining = check_idle("SHARED_TERMINAL", seconds_ago(90)).remaining_seconds
        assert remaining is not None
        assert 29 <= remaining <= 31

    def test_access_token_never_outlives_the_idle_window(self) -> None:
        assert access_token_ttl_seconds("SHARED_TERMINAL") <= 120
        assert access_token_ttl_seconds("PERSONAL") <= 900
