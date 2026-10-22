"""Close the database to Supabase's public Data API.

Supabase serves the ``public`` schema over its Data API (PostgREST) to anybody
holding the project's publishable key — a key designed to be shipped in
browsers, and therefore one to assume is known. What stands between that key
and the rows is row-level security and table grants. Every table here was
created by a migration, Supabase's default privileges gave the ``anon`` and
``authenticated`` roles every privilege on each one, and row-level security was
off: a valid publishable key could read password hashes and medical records,
rewrite them, or empty the audit log.

Nothing in this application uses that API. The API server connects as
``postgres``, which bypasses row-level security, and the browser talks only to
the API server — never to the database. So this changes nothing the application
does, and removes a door nobody was meant to have:

* row-level security on, with no policies, for every table in ``public``: the
  API roles see no rows and can change none;
* their table and sequence grants revoked, and the default privileges that
  would hand them the next table a migration creates.

The roles exist only on Supabase. On a plain Postgres — a developer's machine,
a test database — the grant changes are skipped and row-level security is still
enabled, which costs nothing there either.

Revision ID: 0025_close_the_data_api
Revises: 0024_telemedicine_pharmacy
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0025_close_the_data_api"
down_revision: str | None = "0024_telemedicine_pharmacy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_API_ROLES_EXIST = (
    "EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') "
    "AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')"
)


def _tables() -> list[str]:
    return list(
        op.get_bind()
        .execute(sa.text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
        .scalars()
    )


def upgrade() -> None:
    for table in _tables():
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')

    op.execute(
        f"""
        DO $$
        BEGIN
            IF {_API_ROLES_EXIST} THEN
                REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
                REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
                ALTER DEFAULT PRIVILEGES IN SCHEMA public
                    REVOKE ALL ON TABLES FROM anon, authenticated;
                ALTER DEFAULT PRIVILEGES IN SCHEMA public
                    REVOKE ALL ON SEQUENCES FROM anon, authenticated;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    # Restores the previous state exactly, which was the unsafe one. Running
    # this reopens every table to the publishable key.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF {_API_ROLES_EXIST} THEN
                GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
                GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
                ALTER DEFAULT PRIVILEGES IN SCHEMA public
                    GRANT ALL ON TABLES TO anon, authenticated;
                ALTER DEFAULT PRIVILEGES IN SCHEMA public
                    GRANT ALL ON SEQUENCES TO anon, authenticated;
            END IF;
        END
        $$;
        """
    )
    for table in _tables():
        op.execute(f'ALTER TABLE public."{table}" DISABLE ROW LEVEL SECURITY')
