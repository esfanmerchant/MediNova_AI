"""Vercel's entry point for the API.

Vercel's Python runtime looks for a module-level ASGI application in a file
under the project's root, and hands it each request. That is all this file is:
the same `app` the container runs, re-exported where the platform looks.

**It changes nothing about how the API runs anywhere else.** `uvicorn
app.main:app` and `docker run` both still import `app.main` directly; this
module is only ever loaded by Vercel.

**One thing does differ on Vercel, and it is deliberate.** A serverless function
is frozen between requests, so the notification dispatcher's once-a-minute loop
never gets a second tick. Starting it would be worse than not starting it: it
would consume the invocation's remaining time doing a pass nobody asked for, and
still deliver nothing on a schedule. `app/main.py` already declines to start it
when `VERCEL` is set, and `POST /api/internal/dispatch` exists so an external
scheduler can drive the same pass instead — see DEPLOYMENT.md.
"""

from __future__ import annotations

from app.main import app

__all__ = ["app"]
