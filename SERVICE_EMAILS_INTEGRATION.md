# WorkTrackr ↔ Sweetbyte Studio — service emails

Sits alongside `WORKTRACKR_IDYQ_INTEGRATION.md` and follows the same conventions.
Single source of truth for the contract; both sides should be changed together.

**Phase 1 (this document, built): Sweetbyte side.**
**Phase 2 (not yet built): WorkTrackr side.**

---

## What this does

After a cold call, the salesperson types the address they were just given into
the company record, taps one or more services, and taps Send. WorkTrackr hands
the details to Studio; Studio sends the email and, 7 days later, sends a
follow-up about the same services without anyone touching it.

Multi-select produces **one merged email**, not one per service — each service
contributes a block, blocks render in canonical order, with a single greeting
and sign-off.

---

## Security model

Same shape as the Studio↔IDYQ bridge, **different secret**.

```
payload = "<expiryUnixSeconds>.<nonce>.<METHOD>.<PATH>"
sig     = HMAC-SHA256(WORKTRACKR_SERVICE_EMAIL_SECRET, payload)   // hex
header  = X-WT-Signature: <expiry>.<nonce>.<sig>
```

- `PATH` is the route path within the mount, e.g. `/send` — **not** the full URL
  and not `/api/service-emails/send`. Signing the route path keeps the contract
  stable if the mount point ever moves.
- `expiry` ≈ 120s out. Studio rejects anything already past.
- Constant-time compare; mismatch or expiry → `401`.
- Nonces are **not** tracked, matching the existing bridge. A replayed `/send`
  inside the window is caught by the dedupe rule instead — the second attempt
  finds the service already sent to that address and gets `409 already_sent`.

Do not reuse `IDYQ_BRIDGE_SECRET` or `WORKTRACKR_BRIDGE_SECRET`. Different
relationship, different secret.

---

## API — Studio exposes, WorkTrackr calls

Base: `https://<studio-host>/api/service-emails`

### `GET /catalogue`
Returns the service list. WorkTrackr renders its chips from this rather than
hardcoding a second copy, so adding a service is a one-app change.

```json
{ "services": [ { "key": "it_support", "label": "IT support packages", "order": 2 } ] }
```

Keys are permanent — the dedupe rule is keyed on them, so renaming one orphans
every historical send.

| key | label |
|---|---|
| `about_sweetbyte` | About Sweetbyte |
| `it_support` | IT support packages |
| `cyber_security` | Cyber security solutions |
| `voip_telephony` | VoIP telephony |
| `internet_wifi` | Internet lines & Wi-Fi |
| `backup_solutions` | Backup solutions |
| `office_365` | Office 365 |
| `domains_websites` | Domain names & websites |
| `automation_services` | Automation services |
| `custom_app_development` | Custom app development |
| `marketing_services` | Marketing services |
| `password_document_protection` | Password & document protection |

Keys match the "Service ID" values in *Sweetbyte Post Call Email Templates*.

**Selection order is meaningful.** The source document says to keep the
customer's highest-interest service first, so the order the chips are tapped is
preserved through to the rendered email. `normaliseServiceKeys` deliberately
does not sort.

**Headings appear only on merged emails.** One service reads as a letter and
needs no heading; two or more run together as one wall of prose without them.

### `POST /send`
```json
{ "externalCompanyId": "<WorkTrackr contacts.id>",
  "companyName": "Acme Ltd", "contactName": "Dave Smith",
  "toEmail": "dave@acme.co.uk", "services": ["it_support","voip_telephony"] }
```
→ `200 { id, services, skipped, sendAfter }`

Queues rather than sends — the row waits out the 10-second undo window. `services`
is what will actually go out; `skipped` is anything dropped as already sent.

→ `409 { error }` where error is one of `suppressed`, `already_sent`,
`no_services`, `invalid_services`, `no_email`, `no_company`. **These are not
retryable** — each one is something the salesperson needs to see.

### `POST /cancel`
```json
{ "id": "<id from /send>" }
```
→ `200 { ok: true }` · `409 { error: "too_late" }`

The undo button. Once a worker has claimed the row the email is with SES and
cannot be recalled — hence the window.

### `POST /cancel-followups`
```json
{ "externalCompanyId": "…", "reason": "moved to dead stage" }
```
→ `200 { ok: true, cancelled: <n> }`

Call from WorkTrackr's contacts PUT whenever a company moves to `dead` or
`customer`. Fire-and-forget: log failures, never block the stage change.

### `GET /status?externalCompanyId=…&email=…`
→ `{ history: [...], sentServices: ["it_support"], suppressed: false }`

Authoritative view. WorkTrackr keeps its own mirror table for render speed;
this is for reconciliation and for the timeline entry.

### `GET /unsubscribe?e=…&t=…` — **public, no auth**
The recipient's opt-out link. Token is an HMAC of the address so the link can't
be edited to opt out a third party. Auth on this router is applied **per route,
not router-wide**, precisely so this stays reachable.

---

## Behaviour

**Dedupe.** Uniqueness is `(company, address, service)`. Same service to a
different address is allowed; a different service to the same address is
allowed; the exact combination is not. Follow-ups are excluded from the check —
a follow-up isn't a new offer.

**Undo.** Rows are created `queued` with `send_after = now + 10s`. A `setTimeout`
fires the send; the ticker sweeps anything whose timeout was lost to a restart.
Both paths claim the row with a conditional `UPDATE … WHERE status='queued'`, so
it can only send once.

**Follow-up.** Booked when the initial send succeeds, dated 7 days from the
actual send rather than from the queue time, so an email delayed by an outage
doesn't get a follow-up hard on its heels.

**Suppression.** Re-checked at send time, not queue time — 7 days is plenty of
time to opt out between the two emails. An address counts as suppressed if it's
in `service_email_unsubscribes` **or** in `contact_unsubscribed_all` under any
email_client. Set `SWEETBYTE_EMAIL_CLIENT_ID` to mirror service-email opt-outs
back into the campaign side so one opt-out stops everything.

**Copy is the approved brochure wording.** Service blocks come from *Sweetbyte
Post Call Email Templates*, adapted from the Services A5 Brochure 2026. The
day-7 follow-up reuses the same approved blocks and changes only the opening
paragraph — no second set of service claims has been invented. Give a service a
`followupHtml` to override that.

**No open/click tracking.** Every message is CC'd, so a tracking pixel fires
from the CC's client and records an "open" the prospect never made. Worse than
no data. The unsubscribe link is a plain URL and needs no tracking wrapper.

---

## Environment

| Var | Required | Default |
|---|---|---|
| `WORKTRACKR_SERVICE_EMAIL_SECRET` | **yes** | — |
| `PUBLIC_URL` | strongly advised | onrender.com host |
| `SERVICE_EMAIL_FROM` | no | `billy@sweetbyte.co.uk` |
| `SERVICE_EMAIL_FROM_NAME` | no | `Billy at Sweetbyte` |
| `SERVICE_EMAIL_SENDER_NAME` | no | `Billy` |
| `SERVICE_EMAIL_CC` | no | `westley@sweetbyte.co.uk` |
| `SERVICE_EMAIL_UNDO_SECONDS` | no | `10` |
| `SERVICE_EMAIL_FOLLOWUP_DAYS` | no | `7` |
| `SWEETBYTE_EMAIL_CLIENT_ID` | no | unset (no campaign-side mirror) |

`SERVICE_EMAIL_FROM_NAME` **must be ASCII.** `buildRawEmail()` RFC 2047-encodes
the Subject but writes the From display name raw, so an em dash or accent there
produces a malformed header.

---

## Schema

Declared in `server/services/service-email-sender.js`, not `server/db.js`. Deliberate:
db.js is 2,100 lines shared by every feature, so appending to it means reissuing
the whole file for a two-table change. Same `CREATE TABLE IF NOT EXISTS`
at-import pattern, smaller blast radius. Fold them in if this feature grows.

- `service_email_sends` — one row per email. Status:
  `queued → sending → sent | cancelled | suppressed | failed`
- `service_email_unsubscribes` — opt-outs, keyed by lowercased address

---

## Known gaps

1. **A reply does not cancel the follow-up.** `imap-poller.js` auto-unsubscribes
   on reply, but only for rows matched to a campaign *subscriber*. Service-email
   recipients aren't subscribers, so nothing matches and the follow-up still
   goes. Fixable by having the poller check `service_email_sends` by recipient
   address on unmatched replies. Not built.
2. **SQLite durability.** Follow-ups live on the Render disk for 7 days. They
   survive restarts and deploys, not disk loss.
3. **DNS.** Until the Sweetbyte domain points at Render, unsubscribe links use
   the onrender.com host. Set `PUBLIC_URL` now and change it when DNS lands;
   links are built at send time, so nothing stored goes stale — the only oddity
   is an initial and follow-up email carrying different link hosts if the switch
   happens mid-window.

---

## Phase 2 — WorkTrackr (not built)

1. `service_email_sends` mirror table in Postgres for chip state without a
   round-trip.
2. `web/routes/service-emails.js` — signs and proxies to Studio; writes a
   `contact_notes` row with `kind='email'` so the send lands on the company
   timeline.
3. Panel in `CompanyProfile.jsx`, Overview column: address input prefilled from
   `contacts.email`, chip grid from `/catalogue`, one Send button, toast with a
   10-second Undo. Chips for services already sent to that address render ticked
   and disabled.
4. Hook the contacts PUT route: on stage change to `dead` or `customer`, call
   `/cancel-followups`.

**Sub-component rule applies** — every piece of the panel must be defined at
module level, never inside `CompanyProfile`'s function body, or the address
input loses focus on every keystroke.
