"""Whether CLIENT_ORIGIN is an address a person could actually reach.

Nothing in the application depends on this being right except the links it puts
in other people's mail — which is exactly why it needs a test. A deployment with
a nonsense CLIENT_ORIGIN passes every health check, serves every page, signs
everybody in, and quietly emits verification links nobody can follow. The first
report comes from a stranger who could not finish registering.

The check used to look for `localhost`, because that is the value you leave
behind on a laptop. These cases are led by the one that actually happened on a
real deployment: a placeholder from a setup guide, copied in and never filled.
It is not localhost, so it passed.
"""

from __future__ import annotations

import pytest

from app.main import _is_public_origin


class TestValuesThatShouldBeRefused:
    @pytest.mark.parametrize(
        "origin",
        [
            # The one that shipped. Every email link read
            # "PASTE_CLIENT_URL_HERE/verify-email?token=..." and the old check
            # said nothing, because it only knew about localhost.
            "PASTE_CLIENT_URL_HERE",
            "",
            "   ",
            "example.com",  # no scheme: not a URL, however much it looks like one
            "ftp://example.com",
            "mailto:someone@example.com",
        ],
    )
    def test_a_value_that_is_not_a_reachable_url(self, origin: str) -> None:
        assert not _is_public_origin(origin)

    @pytest.mark.parametrize(
        "origin",
        [
            "http://localhost:3000",
            "https://LOCALHOST",  # the comparison is not case-sensitive
            "http://127.0.0.1:3000",
            "http://[::1]:3000",
            "http://medinova.local",
        ],
    )
    def test_an_address_only_this_machine_can_reach(self, origin: str) -> None:
        # Correct in development and a dead link in real mail, which is the
        # whole reason the check exists.
        assert not _is_public_origin(origin)


class TestValuesThatShouldPass:
    @pytest.mark.parametrize(
        "origin",
        [
            "https://medinova-ai.vercel.app",
            "https://medinova-ai.vercel.app/",  # a trailing slash is stripped downstream
            "https://app.medinova.pk",
            "http://staging.medinova.pk",  # plain http is a choice, not a mistake
            "https://medinova.pk:8443",
        ],
    )
    def test_a_public_address(self, origin: str) -> None:
        assert _is_public_origin(origin)
