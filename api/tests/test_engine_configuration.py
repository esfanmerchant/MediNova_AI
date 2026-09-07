"""Importing the database module when there is no database.

This is a test about an ``import``, which is why it runs in subprocesses: by the
time any test executes, ``app.db.session`` has long since been imported by
``conftest.py``, and the failure being guarded here happens exactly once, before
any test can observe it.

It guards a real outage. ``create_async_engine`` parses its URL immediately, so
an unset ``DATABASE_URL`` raised at module scope — and because ``conftest.py``
imports that module, the whole suite failed to collect rather than the handful of
tests that actually need a database. Those are already guarded by ``requires_db``.
The result was a CI job that could not run a single API test, on a workflow whose
entire design is that it needs no database.

The other half matters more. Tolerating a missing connection string is right for
a laptop and a test runner and wrong for a production API, which would boot
looking healthy and answer its first real request with a 500. So the same absence
is a fault there, and this file pins both halves — a fix that only made the error
go away would pass the first test and fail the second.
"""

from __future__ import annotations

import os
import subprocess
import sys

#: Long enough to satisfy the settings validator, and obviously not a secret.
FAKE = "x" * 40

#: DATABASE_URL is set to the empty string rather than removed, because the
#: repository's own `.env` would otherwise supply a real one and the subprocess
#: would prove nothing. An explicit environment variable outranks the file.
BASE = {
    "DATABASE_URL": "",
    "DIRECT_URL": "",
    "JWT_SECRET": FAKE,
    "SESSION_SECRET": FAKE,
    "EMAIL_ENABLED": "false",
    "AI_ENABLED": "false",
}


def importing(node_env: str) -> subprocess.CompletedProcess[str]:
    # The real environment with these overlaid, not a bare one: a stripped
    # environment fails to start Python at all on Windows, and CI's environment
    # is an ordinary one that simply holds no connection string.
    return subprocess.run(
        [sys.executable, "-c", "import app.db.session"],
        env={**os.environ, **BASE, "NODE_ENV": node_env},
        capture_output=True,
        text=True,
    )


class TestWithoutADatabase:
    def test_the_module_imports_outside_production(self) -> None:
        """Because the fast tier is meant to run with no database at all.

        Every test that needs one is marked ``requires_db`` and skips. Raising
        here would take the other nine hundred with it.
        """
        result = importing("test")
        assert result.returncode == 0, result.stderr

    def test_production_refuses_to_start(self) -> None:
        """The same absence, and the opposite correct answer.

        A silent fallback would trade a boot failure — visible, attributable to
        the deploy that caused it — for a 500 on somebody's first request.
        """
        result = importing("production")
        assert result.returncode != 0
        assert "DATABASE_URL is not set" in result.stderr

    def test_the_refusal_says_what_to_do_about_it(self) -> None:
        # An operator reading a stack trace at three in the morning needs the
        # cause, not just the symptom.
        assert "Refusing to start" in importing("production").stderr
