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

## What gets sent

**One email, one service.** As of Sep 2026 this sends a single introduction
email — there is no topic selection. The twelve-service catalogue and all the
multi-service combining logic were removed from
`server/services/service-email-templates.js`; recover them from git history if a
second service is ever wanted.

| | |
|---|---|
| Service key | `sweetbyte_intro` (permanent — it is the dedup key) |
| Button label | About Sweetbyte |
| Subject, named contact | `Dave - Sweetbyte Introduction` |
| Subject, no contact name | `Sweetbyte Introduction` |
| Attachment | `server/assets/Sweetbyte-Brochure.pdf`, ~4.2MB |
| Follow-up | **Not written.** `FOLLOWUP_READY = false` |

The subject deliberately drops the name rather than falling back to "there" —
"there - Sweetbyte Introduction" in an inbox looks broken. The body still uses
"Hi there," when no name is known.

### The brochure attachment

Read once at module load in `service-email-sender.js`, not per send: it never
changes between deploys and re-reading 4.2MB per email would be wasteful. A
missing file is logged loudly but is **not** fatal — sending the introduction
without the brochure beats failing the send.

`buildRawEmail()` in `ses.js` takes an optional `attachments` array. With none
passed the message is byte-identical to what it always was (verified by
differential test), so campaign and portal sends are untouched. With
attachments the structure becomes:

```
multipart/mixed
├── multipart/alternative
│   ├── text/plain
│   └── text/html
└── application/pdf
```

Size: the finished message is ~5.8MB, ~7.7MB once base64'd for the SES API
call. SES caps messages at 10MB, so there is headroom but not a lot — **do not
add a second attachment** without re-checking. Note also that a ~5MB attachment
on cold outbound is a real deliverability risk; watch the bounce and complaint
rates after the first batch, and if they climb, host the PDF and link it
instead.

Attachment filenames go out as plain ASCII. RFC 2047 (`=?UTF-8?B?...?=`) is not
valid in a `filename` parameter and spec-following clients display the encoded
string as the attachment name — an early version of this code had that bug.

### Follow-ups

`FOLLOWUP_READY` in the templates file gates scheduling entirely: while it is
false, `processDue()` never writes a step-2 row, so an empty follow-up cannot
reach anyone. Flip it to true in the same commit that fills in
`FOLLOWUP_SUBJECT` and `FOLLOWUP_BODY` — not before. Whether the brochure
should ride along on the follow-up is undecided; it currently would not, since
only step 1 attaches.

Capitalisation is fixed up in `firstNameOrNull()` because the name is typed in a
hurry between calls: "tony" → "Tony", and an ALL-CAPS entry is downcased first
so "TONY" → "Tony" rather than shouting. Anything already mixed case is left
alone, which is what stops "McDonald" becoming "Mcdonald". Hyphens and
apostrophes are handled, so "jo-anne" → "Jo-Anne" and "o'brien" → "O'Brien".
The known limitation: "mcdonald" typed all-lowercase comes out "Mcdonald", and
there is no way to tell that from an ordinary name without a prefix dictionary.

The sign-off is built as a whole clause, not a token in a fixed sentence:
"Thanks again, Dave," with a name, "Thanks again," without. Substituting the
"there" fallback into it produced "Thanks again, there," which reached a real
inbox before it was caught.

The signature block is **hardcoded** to Billy Crockett with his title and
number. It is not driven by `SERVICE_EMAIL_SENDER_NAME`, because a job title
and phone number cannot be derived from a first name. If Joe or Lewis ever send
these, this block needs editing rather than an env var changing.

### The contact name

Three sources, in order of preference:

1. What the caller typed into the **Their name (optional)** box on the panel.
2. The company's `primary_contact` in WorkTrackr.
3. Nothing — the body opens "Hi there," and the subject drops the name.

The typed name is the only field taken from the request body; the company name
is always read from the database, because the client should not be able to put
someone else's company on an email. A mistyped first name is only ever the
sender's own problem, and is worth far more than an empty greeting.

The panel prefills the box from `company.primaryContact` — **camelCase**.
`mapContact()` converts responses, so reading `primary_contact` on the frontend
silently yields undefined and the box is always blank.

Typing a name does **not** write it back to the company record. If that is
wanted later it is a small addition to the contacts PUT route.

### Subscriber list mirror

After a successful send the recipient is inserted into `email_subscribers`
against the list named in `SERVICE_EMAIL_LIST`. The variable accepts a list
**name** or an id — Studio's list screen does not put the id in the URL, so the
name is the practical option. Unset means the feature is off and nothing is
written.

`UNIQUE(list_id, email)` makes a repeat send a no-op rather than a duplicate,
and `email_lists.subscriber_count` is recalculated on any change so the sidebar
figure stays honest. If the configured name matches more than one list the code
refuses to guess and logs an error.

Unsubscribes are mirrored: opting out of the introduction sets the subscriber
row to `unsubscribed`. Leaving them showing as active is how someone later
builds a campaign audience that quietly includes opted-out people.

Worth stating plainly: this list is populated automatically from people who
took a cold call and did not opt in. Sending them the introduction is one
thing; using the list as a marketing audience later is a different question
under PECR, and the automatic population makes it easy to forget how the
addresses got there.

---

## Wiring — which files are live

| Concern | File | Mounted / started in |
|---|---|---|
| Bridge routes | `server/routes/service-email-api.js` | `server/index.js` at `/api/service-emails` |
| Send + follow-up logic, schema | `server/services/service-email-sender.js` | imported by the router |
| Copy, service list | `server/services/service-email-templates.js` | imported by the router |
| Sweeper | `server/services/service-email-ticker.js` | `startServiceEmailTicker()` in `index.js` |

**History, so this doesn't recur.** An early scaffold, `server/routes/service-emails.js`,
was mounted instead of the real router for the first two deploys. It answered
`/catalogue` from a `service_catalogue` SQLite table seeded with twelve
placeholders ("Service 1 — rename me" …) and returned 501 from `/send`,
`/cancel`, `/status` and `/cancel-followups`. WorkTrackr rendered the
placeholders faithfully and Send did nothing. The scaffold has been **deleted**.
If chips ever read "rename me" again, check the import on `index.js` line 13
before looking anywhere else.

The `service_catalogue` table and its seed block in `server/db.js` (§30) are now
**dead** — the catalogue is served from `service-email-templates.js`, which is
the single source of truth. The table is left in place rather than dropped: it
holds no referenced data, and removing it means reissuing db.js. Ignore it.

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
| `it_support` | IT Support |
| `cyber_security` | Cyber Security |
| `business_internet` | Business Internet |
| `managed_wifi` | Managed Wi-Fi |
| `website_design` | Website Design |
| `domain_hosting` | Domain & Hosting |
| `backup_solutions` | Backup Solutions |
| `microsoft_365` | Microsoft 365 |
| `voip_telephony` | VoIP Telephony |
| `custom_apps_automation` | Custom Apps & Automation |
| `email_marketing` | Email Marketing |
| `voice_greetings` | Professional Voice & Greetings |

Source: *Sweetbyte Email Campaigns - 12 Revised*.

**Selection order is meaningful** — the first chip tapped leads the email, so
the customer's main interest comes first. `normaliseServiceKeys` does not sort.

**Subject lines.** One service uses that campaign's own approved subject.
Several use `Information on <services>` — naming them is what gives the reader
a reason to open it. Over 70 characters it falls back to `Information on the
Services We Discussed`, which affects one two-service pair and about 44% of
three-service selections. Follow-ups use `Following Up on <services>`.

**One service reproduces the approved email verbatim.** Several keeps every
approved body, adds a heading to each, and replaces only the connective wording
(opening and close), because the source has no wording for a combined email.

### `POST /send`
```json
{ "externalCompanyId": "<WorkTrackr contacts.id>",
  "companyName": "Acme Ltd", "contactName": "Dave Smith",
  "spokeTo": "someone_else", "referrerName": "Karen",
  "toEmail": "dave@acme.co.uk", "services": ["it_support","voip_telephony"] }
```
→ `200 { id, services, skipped, sendAfter }`

**`spokeTo`** decides the email's opening, closing and unsubscribe reason. It is
chosen from a dropdown by whoever made the call and is one of exactly three
values:

| value | meaning | `referrerName` |
|---|---|---|
| `them` | Spoke to the person receiving the email. | always `null` |
| `someone_else` | Spoke to a colleague at the same company, who gave us this address. | the colleague's name, or `null` if it was never given |
| `nobody` | No conversation happened at all. | always `null` |

`someone_else` with no name is a real and common case — a switchboard hands over
a name and an address without giving its own — and it has its own opening
("I spoke to one of your colleagues earlier"). It is not an error.

The field is optional on the wire. A WorkTrackr instance that predates the
dropdown omits it, and Studio falls back to the rule that preceded it: a
`referrerName` means `someone_else`, no `referrerName` means `them`. That
inference is exactly what `spokeTo` exists to replace — it read a missing
colleague's name as "I spoke to the recipient", and sent a prospect an email
thanking her for a call that never happened — so it applies only when there is
no `spokeTo` to use. An unrecognised value is treated as absent, never trusted.

WorkTrackr guarantees `referrerName` is `null` unless `spokeTo` is
`someone_else`, so Studio does not cross-check the two.

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

## Phase 2 — WorkTrackr (built and deployed)

1. `service_email_sends` mirror table in Postgres for chip state without a
   round-trip.
2. `web/routes/service-emails.js` — signs and proxies to Studio; writes a
   `contact_notes` row with `kind='email'` so the send lands on the company
   timeline. Signer is `web/services/serviceEmailBridge.js`.
3. Panel in `CompanyProfile.jsx`, Overview column
   (`web/client/src/app/src/components/ServiceEmailPanel.jsx`): address input
   prefilled from `contacts.email`, chip grid from `/catalogue`, one Send
   button, toast with a 10-second Undo. Chips for services already sent to that
   address render ticked and disabled.
4. Hook the contacts PUT route: on stage change to `dead` or `customer`, call
   `/cancel-followups`.

The WorkTrackr side needs no change to work against the real router. Both sign
`"<expiry>.<nonce>.<METHOD>.<PATH>"` into `X-WT-Signature`; `requireBridgeAuth`
in `service-email-api.js` verifies exactly that, so swapping the mount is a
Studio-only deploy.

**Sub-component rule applies** — every piece of the panel must be defined at
module level, never inside `CompanyProfile`'s function body, or the address
input loses focus on every keystroke.
