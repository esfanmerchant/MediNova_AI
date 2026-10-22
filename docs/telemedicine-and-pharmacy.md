# Online consultations and the MediNova pharmacy

Two features, built on what the platform already has rather than beside it: the
appointment and slot engine, invoices and the payment-proof review queue, the
doctor's prescription, the audit trail, notifications and account removal.

## Decisions taken with the owner

| Question | Decision |
|---|---|
| Video provider | Zoom **Video SDK for Web**, embedded in the site. Patients install nothing. |
| Consultation length | 30 minutes. |
| Online payment | The existing wallet transfer (EasyPaisa / NayaPay) with a screenshot, confirmed by an administrator. No payment gateway. |
| Pharmacy payment | Cash on delivery, or the same online transfer. |
| Prescription-only medicine not prescribed on MediNova | Either upload a prescription from any doctor (an administrator verifies it), or ask a MediNova doctor the patient has seen to approve it. |
| Who runs the pharmacy | The administrator, from the admin portal. No new role. |
| Catalog | A starter catalog of common medicines sold in Pakistan, editable, with CSV import. **Prices are estimates and must be checked against DRAP's maximum retail prices before selling.** |

---

## Part 1 — Online consultations

### What the patient sees

1. Chooses a doctor. Doctors who consult online show an **Online** badge and their
   online fee.
2. Picks a slot marked *Online*, and books. The booking is *Requested*, as today.
3. The doctor confirms. An invoice is issued at that moment and the patient is
   told to pay. **Nothing is billed before the doctor has accepted**, so a
   declined request never needs a refund.
4. Pays by wallet transfer and uploads the screenshot; an administrator confirms
   it, exactly as for any invoice today.
5. Ten minutes before the start, a reminder arrives with a **Join** link. The
   call page checks the camera and microphone first, then joins.
6. After the call the prescription is in the record, with **Order these
   medicines** beside it.

### What the doctor sees

- In *Availability*, each weekly window has a mode: **Clinic**, **Online** or
  **Both**. Online and Both windows use 30-minute slots — the length the owner
  set for a video consultation. An optional **online fee** overrides the clinic
  fee for online consultations.
- On the day, **Start video call** on the appointment. Joining moves the
  appointment to *In progress*; for an online consultation, joining *is* the
  check-in.
- The call page puts the patient's allergies, current medicines and latest
  vitals beside the video, and the consultation is completed from there.

### Rules the server enforces

| Rule | Why |
|---|---|
| Only the patient and the treating doctor can get a call token, and only for that appointment's room. | The Zoom token is bound to one room name; a token for one consultation opens nothing else. |
| The room opens 10 minutes before the start and closes 15 minutes after the end. | Long enough to sort out a microphone, short enough that an old link is dead. |
| The appointment must be confirmed and its invoice **paid**. | A call that has not been paid for does not start, for either side. |
| The room name is random and unguessable, created at booking. | A name derived from the appointment id could be predicted. |
| The doctor joins as host, the patient as participant. | Zoom gives the host control of the session. |
| **No recording.** | Recording a consultation creates the most sensitive file in the system, and nobody asked for one. |
| Every token issued is written to the audit log. | "Who joined that consultation, and when" must be answerable. |

### Money

The invoice for an online consultation is created when the doctor confirms, not
when the consultation completes (as clinic visits are). It is due at the start
time and carries no late fee. The doctor's share is credited **when the
consultation is completed**, not when the patient pays — so a paid consultation
that is later cancelled is refunded with a credit note and the doctor was never
credited for work that did not happen.

| What happens | Its bill |
|---|---|
| Cancelled before payment | voided |
| Cancelled after payment | kept; administrators told to refund and record a credit note; the patient told it will be refunded |
| Rescheduled | the same bill moves to the new time — a paid call stays paid |
| No-show | kept; administrators decide on any refund |
| Room closed, never confirmed or never paid | cancelled automatically by the dispatcher, bill voided, both told |
| Room closed, paid, never started | administrators told once; nothing is taken or returned automatically |

### Data

- `appointments.mode` — `CLINIC` (default, every existing row) or `ONLINE`.
- `appointments.videoRoom` — the random Zoom session name, online only.
- `doctors.onlineFee` — optional; the clinic fee applies when it is empty.
- Availability windows (JSON) gain `mode`: `CLINIC` (default), `ONLINE`, `BOTH`.

### API

| Method | Path | Who |
|---|---|---|
| `GET` | `/api/appointments/availability` | slots now carry the modes they can be booked in; `?mode=ONLINE` narrows |
| `POST` | `/api/appointments` | accepts `mode` |
| `GET` | `/api/appointments/{id}/video` | patient / treating doctor — can I join, and if not, why not |
| `POST` | `/api/appointments/{id}/video/token` | patient / treating doctor — a Zoom token for this room |
| `GET` | `/api/doctors?onlineOnly=true` | the directory, narrowed to doctors who publish online hours |

### Reminders

The dispatcher (the same cron-driven pass as every other reminder) adds two
jobs: a "your room is open" notice to **both** sides as the room opens, worded
for an unpaid consultation when it is unpaid, and the closing of lapsed
consultations described above.

### Configuration

| Variable | Meaning |
|---|---|
| `ZOOM_VIDEO_SDK_KEY` | From the Zoom Build platform: *Build App → SDK credentials*. |
| `ZOOM_VIDEO_SDK_SECRET` | Same place. Server-side only; it signs tokens and never reaches the browser. |

The site's Content-Security-Policy is widened for Zoom's domains, WebAssembly and
blob workers on the call page's needs. Cross-origin isolation (COOP/COEP) is
**not** enabled: Zoom does not require it for WebRTC video, and it would break
Google Maps and Supabase images elsewhere on the site.

---

## Part 2 — The MediNova pharmacy

### What the patient sees

- **Pharmacy** in the menu: search by brand or generic name, browse by category.
  Each medicine shows its strength, form, pack, price, and a **Prescription
  required** badge where that applies.
- **From your prescriptions**: the medicines a MediNova doctor prescribed,
  matched to the catalog, addable in one press.
- **Checkout**: delivery name, phone, address and city; cash on delivery or
  online transfer; the delivery fee, waived above a threshold.
- If the cart has prescription-only medicine that no MediNova doctor prescribed,
  checkout asks for one of two things:
  1. a photo of a prescription from any doctor — checked by the pharmacy, or
  2. approval from a MediNova doctor the patient has already seen.
- **My orders**: a tracking timeline, the tracking number once dispatched, the
  invoice, and a cancel button until the parcel leaves.

### What the doctor sees

- When prescribing, the medicine field suggests catalog products, so the
  patient's **Order these medicines** button finds the exact product.
- **Medicine approvals**: requests from their own patients, with the patient's
  allergies and current medicines alongside. Approve, or decline with a reason.

### What the administrator sees

- **Pharmacy dashboard**: sales today and this month, orders waiting at each
  stage, low stock, best sellers, and margin where a cost price is recorded.
- **Orders**: verify uploaded prescriptions, pack, dispatch (courier and tracking
  number), mark delivered, record cash collected.
- **Catalog**: add and edit medicines, stock, prices, prescription flag; import a
  CSV; load the starter catalog.
- **Pharmacy settings**: delivery fee, free-delivery threshold, cash-on-delivery
  limit, cities served, pharmacy name and drug sale licence number.

### Order lifecycle

| Status | Meaning | Next |
|---|---|---|
| `PENDING_RX` | Waiting for a prescription to be verified or a doctor to approve. | `AWAITING_PAYMENT`, `CONFIRMED`, `CANCELLED` |
| `AWAITING_PAYMENT` | Online payment chosen; the invoice is issued and waiting. | `CONFIRMED`, `CANCELLED` |
| `CONFIRMED` | Paid, or cash on delivery; ready to pack. | `PACKED`, `CANCELLED` |
| `PACKED` | Packed and waiting for the rider. | `DISPATCHED`, `CANCELLED` |
| `DISPATCHED` | With the courier; tracking number recorded. | `DELIVERED` |
| `DELIVERED` | Handed over. For cash on delivery, the cash is recorded here. | — |
| `CANCELLED` | By the patient before dispatch, by the pharmacy, or because a prescription was refused. Stock goes back on the shelf. | — |

**Prescriptions are checked before money is taken.** An order with unverified
prescription-only medicine cannot be paid for until it is cleared, so a refused
prescription never needs a refund.

### Rules the server enforces

- Prices, totals, delivery fee and stock are computed on the server; the cart in
  the browser is a convenience and is never trusted.
- Stock is reserved when the order is placed and returned if it is cancelled.
- A prescription-only item is covered only by the patient's **own, active**
  prescription for that medicine, or by a verified upload, or by an approval from
  a doctor with a real care relationship to the patient.
- Controlled substances (narcotics, psychotropics) are not in the catalog and
  cannot be added: they cannot lawfully be sold this way.
- Cash on delivery is refused above the configured limit.
- Uploaded prescriptions are stored privately and shown only through short-lived
  signed links, to the patient, the reviewing administrator and the approving
  doctor.

### Money

Each order gets an invoice of kind `PHARMACY` when it becomes payable — at
`AWAITING_PAYMENT` for online payment, at dispatch for cash on delivery. Invoices
gain a `kind` column (`CONSULTATION` for every existing row) so that revenue
reports keep the two businesses apart: pharmacy sales are the platform's own
revenue, never a doctor's share. Medicine carries no tax line (exempt from sales
tax); the order's total is medicines plus delivery, enforced by a check
constraint.

Cash collected at the door is recorded as a payment of method
`CASH_ON_DELIVERY` when the order is marked delivered, in the same ledger as
wallet transfers, so a day's takings reconcile against one list.

### Orders that go quiet

Stock is held from the moment an order is placed, so an abandoned order must
let go of it. The dispatcher cancels — and restocks — an order whose
prescription has not been cleared within **72 hours**, or whose online payment
has not arrived by its due date (**48 hours**) unless a payment is waiting in the
review queue. The patient is told why, and can simply order again.

### Data

| Table | Holds |
|---|---|
| `pharmacy_products` | brand, generic name, strength, form, pack, category, price, optional cost price, stock, prescription flag, active flag |
| `pharmacy_orders` | patient, status, delivery details, totals, payment method, invoice, prescription route and review, courier, timestamps |
| `pharmacy_order_items` | product, quantity, price at the time, and the prescription that covers it |
| `pharmacy_settings` | one row: fees, limits, cities, pharmacy identity |
| `prescriptions.productId` | optional link from a prescribed medicine to the catalog |
| `invoices.kind` | `CONSULTATION` or `PHARMACY` |

### API

| Method | Path | Who |
|---|---|---|
| `GET` | `/api/pharmacy/info` | signed in — delivery terms and categories |
| `GET` | `/api/pharmacy/products` | signed in — search, category; administrators also see stock and cost |
| `GET` | `/api/pharmacy/my-prescriptions` | patient — their current prescriptions matched to the shelf |
| `GET` | `/api/pharmacy/my-doctors` | patient — doctors who can approve their medicine |
| `POST` | `/api/pharmacy/orders/quote` | patient — the server's price for a cart |
| `POST` | `/api/pharmacy/orders` | patient — place an order |
| `GET` | `/api/pharmacy/orders`, `/orders/{id}` | patient (own) · administrator (all, with queues) |
| `POST` | `/api/pharmacy/orders/{id}/prescription` | patient — upload the prescription photo |
| `GET` | `/api/pharmacy/orders/{id}/prescription` | patient · administrator — a short-lived link |
| `POST` | `/api/pharmacy/orders/{id}/cancel` | patient (own, before dispatch) · administrator |
| `POST` | `/api/pharmacy/orders/{id}/rx-review` | administrator — accept or refuse an upload |
| `POST` | `/api/pharmacy/orders/{id}/advance` | administrator — packed → dispatched → delivered |
| `POST` | `/api/pharmacy/orders/{id}/refund` | administrator — record a refund with a credit note |
| `GET` / `POST` | `/api/pharmacy/approvals`, `/approvals/{id}` | doctor — requests from their own patients |
| `POST` / `PATCH` | `/api/pharmacy/products`, `/products/{id}` | administrator |
| `POST` | `/api/pharmacy/products/{id}/stock` | administrator — add or write off, with a reason |
| `POST` | `/api/pharmacy/products/import`, `/products/starter` | administrator — CSV, starter catalog |
| `GET` / `PUT` | `/api/pharmacy/settings` | administrator |
| `GET` | `/api/pharmacy/dashboard` | administrator — sales, queues, low stock, best sellers, margin |

### Removal and export

Removing a patient deletes their unpaid orders and uploaded prescriptions, and
keeps paid orders for the accounts with the name, phone and address scrubbed —
the same rule invoices already follow. A doctor's approvals survive their removal
with the doctor anonymised. Removal is refused while an order is still open, or
while patients are waiting on a doctor's approval. The patient's data export
includes their medicine orders.

### One more thing the migrations do

`0025_close_the_data_api` turns on row-level security for every table and
revokes the `anon` and `authenticated` roles' grants. Supabase had given those
roles full rights on every table a migration created, which left the data
reachable through Supabase's own REST API with the publishable key. The
application connects as `postgres` and is unaffected.

---

## Build plan

The backend is finished and tested before the frontend starts. **Status: all
seven steps done.**

1. **Schema** — one migration: new enums and columns, the four pharmacy tables,
   `invoices.kind`, the private bucket for uploaded prescriptions.
2. **Online consultations (API)** — slot modes, booking with a mode, invoice at
   confirmation, doctor credited at completion, room status and token endpoints,
   the ten-minute reminder, health check, tests.
3. **Pharmacy (API)** — catalog, starter catalog, CSV import, settings, checkout
   with prescription coverage, doctor approvals, upload review, payment and
   delivery steps, cancellation with stock return, notifications, audit,
   removal, the dashboard summary, tests.
4. **Apply** the migration and load the starter catalog.
5. **Online consultations (web)** — mode in the doctor's availability and the
   patient's booking, payment state and **Join** on appointments, the call page
   for both sides, CSP.
6. **Pharmacy (web)** — store, cart, checkout, orders and tracking, doctor
   approvals, prescription autocomplete, the admin pharmacy section, revenue.
7. **Verification** — full test suites, production build, every flow run end to
   end against a running server.

## How it was verified

- **API:** 1,014 fast tests (35 for online consultations, 49 for the pharmacy),
  ruff and mypy clean.
- **End to end against the real database**, inside one transaction rolled back
  at the end so nothing persisted: 63 checks covering booking an online slot,
  billing at confirmation, payment review, the room opening on time, host and
  participant tokens, the doctor credited only at completion, prescribing a
  catalog product, ordering with doctor approval, payment confirming the order,
  pack → dispatch → deliver, cash on delivery, the upload route, cancellation
  restocking the shelf, revenue kept apart, removal and export, and the
  dispatcher closing a lapsed consultation.
- **Web:** type-check, lint and 260 tests clean; production build of every new
  page.
- **Not verifiable here:** a live video call needs the owner's Zoom
  credentials.

## What the owner provides

1. **Zoom Video SDK credentials** — create a Build platform account at
   platform.zoom.us (separate from an ordinary Zoom account), then
   *Build App → SDK credentials*. Put the key and secret in `.env` and in the
   Vercel API project. Everything except a live call works without them.
2. **Pharmacy identity** for invoices — pharmacy name, address, drug sale licence
   number. Entered in *Pharmacy settings*; placeholders until then.
3. **Prices** — checked against DRAP's maximum retail prices before the pharmacy
   sells to the public.

## Not in this release

- A payment gateway (JazzCash, card). The order and invoice model is ready for
  one; the payment step is the only part that would change.
- Courier API integration. Tracking numbers are entered by hand.
- Recording, chat or file sharing inside the call.
