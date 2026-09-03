# Service emails — WorkTrackr ↔ Sweetbyte Studio

Single source of truth for the contract between **WorkTrackr** (`worktrackr.cloud`,
the caller) and **Sweetbyte Studio** (the source). Both sides reference this file
in their code comments. If you change the contract, change it here first.

Related but separate, do not confuse:

| Integration | Secret | What it is |
|---|---|---|
| Studio → IDYQ admin embed | `IDYQ_BRIDGE_SECRET` | signed-ticket iframe login |
| WorkTrackr → IDYQ data pull | `WORKTRACKR_BRIDGE_SECRET` | quotes + catalogue (see `WORKTRACKR_IDYQ_INTEGRATION.md`) |
| **WorkTrackr → Studio service emails** | **`WORKTRACKR_SERVICE_EMAIL_SECRET`** | **this document** |

Three relationships, three secrets. Never reuse one for another.

---

## Status

| Endpoint | WorkTrackr | Studio | Notes |
|---|---|---|---|
| `GET /catalogue` | built | **built** | live |
| `POST /send` | built | **501** | needs SES send + undo window + follow-up |
| `POST /cancel` | built | **501** | undo within 10s |
| `GET /status` | built | **501** | reconciliation |
| `POST /cancel-followups` | built | **501** | called when a company goes dead/customer |

Studio deliberately returns **501 Not Implemented** for the unbuilt endpoints
rather than a stubbed `200`. A fake success would make WorkTrackr write a row
into `service_email_sends` and a note onto the company timeline for an email
that never left, and the salesperson would believe a prospect had been emailed.
An honest error is recoverable; a false record is not.

---

## Environment variables

**On WorkTrackr:**

- `WORKTRACKR_SERVICE_EMAIL_SECRET` — long random hex. Must match Studio.
- `SWEETBYTE_BASE_URL` — Studio's origin, no trailing slash.

**On Studio:**

- `WORKTRACKR_SERVICE_EMAIL_SECRET` — the same value.

If either is missing on WorkTrackr, `callStudio()` throws before making any
network call, and `/api/service-emails/catalogue` returns **500** with
"Could not load services". If they are set but Studio can't be reached, the same
route returns **502** instead. That difference is the fastest way to tell a
configuration problem from a connectivity one.

If the secret is missing on Studio, every endpoint returns **503**, not 500 —
an unconfigured service is a deployment state, not a crash.

> ⚠️ `SWEETBYTE_BASE_URL` must point at the **Sweetbyte** service. Note that the
> Sweetbyte service still answers on `thegreenagents-studio.onrender.com`: the
> Render rename on 2026-09-02 changed the display name only, not the URL or the
> service slug. TGA Studio now lives on a different service entirely. Pointing
> this at the wrong one sends Sweetbyte's cold-call contacts into TGA's database.

---

## Signing

Every request from WorkTrackr carries an HMAC signature:

```
payload = "<expiryUnixSeconds>.<nonce>.<METHOD>.<PATH>"
sig     = HMAC-SHA256(WORKTRACKR_SERVICE_EMAIL_SECRET, payload)   // hex
header  = X-WT-Signature: <expiry>.<nonce>.<sig>
```

- `PATH` is the path **within the mount** — `/catalogue`, not
  `/api/service-emails/catalogue`.
- Method and path are inside the signature, so a captured signature for a
  harmless `GET /catalogue` cannot be replayed against `POST /send`.
- WorkTrackr signs 120 seconds out. Studio allows 30 seconds of clock skew on
  top, because two Render services will not have identical clocks and a
  three-second drift should not produce an intermittent failure.
- Studio rejects an expiry more than 600 seconds in the future, which would
  otherwise widen the replay window indefinitely.
- Comparison is constant-time.

Studio returns **401** for a missing, malformed, expired or mismatched
signature, and logs the method and path — never the signature itself.

---

## `GET /catalogue`

Returns the services WorkTrackr renders as tappable chips.

```json
{ "services": [ { "key": "service-01", "label": "IT Support", "description": null } ] }
```

`key` and `label` are both required by WorkTrackr's `ServiceEmailPanel.jsx`.

**`key` is permanent.** WorkTrackr stores it against every send in its local
`service_email_sends` mirror and uses it to grey out services already sent to an
address. Renaming a `label` is safe and expected. **Changing a `key` silently
breaks that history**, because past sends still reference the old string and no
error is raised — the chip simply stops showing as already sent. Treat a key as
permanent from the moment a service is first used.

Inactive services are **omitted**, not flagged, because WorkTrackr renders every
row it receives. Withholding a row is what "turn this service off" means.

Ordering is Studio's (`sort_order`, then label) and WorkTrackr honours it.

WorkTrackr caches the response for 5 minutes, process-local, and will serve a
stale cache rather than an empty grid if Studio is briefly unreachable. A newly
added service therefore appears within 5 minutes without a redeploy.

Studio ships **12 placeholder services** (`service-01` … `service-12`) so the
panel has something to render before the real names are decided. Rename the
labels; leave the keys.

---

## Still to build on Studio

In rough order:

1. **Settings screen** — rename labels, set order, activate/deactivate, and map
   each service to an email list.
2. **`POST /send`** — send through SES from the Sweetbyte domain, honouring a
   **10-second undo window** before the message actually leaves, and returning
   `{ id, services, skipped, sendAfter }`. Must return **409** with an `already`
   payload when a service has already gone to that address, since WorkTrackr
   passes that through to the salesperson as an answer rather than an error.
3. **`POST /cancel`** — cancel within the undo window. Studio is the authority:
   if the email has gone, return an error and let WorkTrackr keep saying so.
   Silently accepting would leave the salesperson believing an email was pulled
   back when it wasn't.
4. **7-day follow-up** — scheduled from the moment the first email is *sent*,
   not from when it was queued.
5. **Suppression** — an address that unsubscribes or hard-bounces must never
   receive another service email.
6. **`GET /status`** and **`POST /cancel-followups`**.

**Open question:** when the follow-up fires, should the contact also be added to
a campaign list, or does the flow stay purely transactional? Not yet decided.

**Deliverability note:** `sweetbyte.co.uk` is a young sending domain with a small
list and very little history. Cold-call addresses, typed by ear, are exactly the
input that produces hard bounces, and hard bounces on a young domain are
expensive. Worth an approval step before addresses reach a sending list, and
worth starting at low volume.
