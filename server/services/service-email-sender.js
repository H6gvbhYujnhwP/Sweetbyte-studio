/**
 * server/services/service-email-sender.js — WorkTrackr service emails:
 * queue, send, follow up.
 *
 * WorkTrackr hands over an address, a company, and a set of services. This
 * module owns everything after that: the 10-second undo window, the send
 * itself, the 7-day follow-up, dedupe, and suppression.
 *
 * WHY THE SCHEMA LIVES HERE AND NOT IN db.js
 * Every other table in this codebase is declared in server/db.js. These two
 * are declared here instead, deliberately: db.js is 2,100 lines and shared by
 * every feature, so appending to it means reissuing the whole file for a
 * two-table change. The statements are CREATE TABLE IF NOT EXISTS and run once
 * at import, which is exactly what db.js does — same idempotency, smaller blast
 * radius. If this feature grows, folding these into db.js is a clean move.
 *
 * STATE MACHINE
 *   queued    → waiting out the undo window (step 1) or the 7 days (step 2)
 *   sending   → claimed by a worker; exists purely to stop double-sends
 *   sent      → SES accepted it
 *   cancelled → undone, or killed by a stage change / unsubscribe
 *   suppressed→ recipient had opted out by the time we got to it
 *   failed    → SES rejected it
 *
 * The `sending` claim is the important one. Both the setTimeout and the ticker
 * can reach the same row, so a row is claimed with a conditional UPDATE that
 * only succeeds from 'queued'. Whoever wins sends; the loser finds zero rows
 * changed and walks away. Without it, a restart landing on top of a pending
 * timeout would send twice.
 */

import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { sendEmail } from './ses.js';
import {
  renderServiceEmail,
  buildSubject,
  normaliseServiceKeys,
  FOLLOWUP_READY,
} from './service-email-templates.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const FROM_EMAIL = process.env.SERVICE_EMAIL_FROM || 'billy@sweetbyte.co.uk';
const CC_EMAIL   = process.env.SERVICE_EMAIL_CC   || 'westley@sweetbyte.co.uk';

// KEEP THIS ASCII. buildRawEmail() RFC 2047-encodes the Subject but writes the
// From display name raw, so a non-ASCII character here (an em dash, a curly
// apostrophe, an accent) produces a technically malformed header. Some clients
// cope, some render mojibake, and spam filters notice. "Billy at Sweetbyte"
// rather than "Billy — Sweetbyte" for exactly that reason.
const FROM_NAME = process.env.SERVICE_EMAIL_FROM_NAME || 'Billy at Sweetbyte';

// How the sign-off reads inside the body. Free of the ASCII constraint above,
// since the body is base64-encoded UTF-8.
const SENDER_NAME = process.env.SERVICE_EMAIL_SENDER_NAME || 'Billy';

// ── Brochure attachment ──────────────────────────────────────────────────────
// Read once at module load, not per send: it's ~4MB, and re-reading it for every
// email would mean a disk hit and 4MB of garbage per message for a file that
// never changes between deploys.
//
// Deliberately non-fatal if missing. A prospect getting the introduction without
// the brochure is a much better outcome than the send failing outright, so a
// missing file logs loudly and sends anyway.
const BROCHURE_FILENAME = 'Sweetbyte-Brochure.pdf';
const BROCHURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  BROCHURE_FILENAME,
);

let BROCHURE = null;
try {
  const buf = fs.readFileSync(BROCHURE_PATH);
  BROCHURE = {
    filename: BROCHURE_FILENAME,
    contentType: 'application/pdf',
    content: buf,
  };
  console.log(`[service-email] brochure loaded — ${(buf.length / 1024 / 1024).toFixed(2)}MB`);
} catch (err) {
  console.error(
    `[service-email] BROCHURE MISSING at ${BROCHURE_PATH} — emails will send without it:`,
    err.message,
  );
}

// The undo window. Long enough to catch a misclick, short enough that you've
// moved to the next record before it matters.
const UNDO_SECONDS = Number(process.env.SERVICE_EMAIL_UNDO_SECONDS || 10);

// Gap between the initial email and its follow-up.
const FOLLOWUP_DAYS = Number(process.env.SERVICE_EMAIL_FOLLOWUP_DAYS || 7);

// Public origin used to build unsubscribe links. Until the Sweetbyte domain is
// pointed at Render this will fall back to the onrender.com host, which works
// but looks wrong in a cold email — set PUBLIC_URL explicitly and change it
// when DNS lands. Links are built at send time, so nothing stored goes stale.
function publicBaseUrl() {
  return (process.env.PUBLIC_URL || 'https://thegreenagents-studio.onrender.com')
    .replace(/\/+$/, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS service_email_sends (
    id                  TEXT PRIMARY KEY,
    external_company_id TEXT NOT NULL,
    company_name        TEXT,
    contact_name        TEXT,
    to_email            TEXT NOT NULL,
    services_json       TEXT NOT NULL,
    step                INTEGER NOT NULL DEFAULT 1,
    status              TEXT NOT NULL DEFAULT 'queued',
    send_after          TEXT NOT NULL,
    sent_at             TEXT,
    message_id          TEXT,
    error               TEXT,
    parent_id           TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ses_due
    ON service_email_sends(status, send_after);
  CREATE INDEX IF NOT EXISTS idx_ses_company
    ON service_email_sends(external_company_id);
  CREATE INDEX IF NOT EXISTS idx_ses_email
    ON service_email_sends(to_email);

  CREATE TABLE IF NOT EXISTS service_email_unsubscribes (
    email           TEXT PRIMARY KEY,
    unsubscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
    source          TEXT
  );
`);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const normEmail = (e) => String(e || '').trim().toLowerCase();

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function isoPlusSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
}

function parseServices(row) {
  try {
    const parsed = JSON.parse(row.services_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Signed unsubscribe token. The link carries the address in the clear so the
 * landing page can confirm what's being unsubscribed, and an HMAC so nobody
 * can opt out an arbitrary third party by editing the query string.
 */
function unsubToken(email) {
  const secret = process.env.SERVICE_EMAIL_UNSUB_SECRET
    || process.env.WORKTRACKR_SERVICE_EMAIL_SECRET
    || '';
  return crypto.createHmac('sha256', secret).update(normEmail(email)).digest('hex');
}

export function verifyUnsubToken(email, token) {
  const expected = unsubToken(email);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function unsubUrlFor(email) {
  const e = encodeURIComponent(normEmail(email));
  const t = encodeURIComponent(unsubToken(email));
  return `${publicBaseUrl()}/api/service-emails/unsubscribe?e=${e}&t=${t}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suppression
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One opt-out means one opt-out. An address is suppressed if it has
 * unsubscribed from service emails OR from campaign email anywhere in the
 * platform — `contact_unsubscribed_all` is keyed per email_client, and we
 * deliberately ignore that scoping on read. Someone who told one part of the
 * business to stop should not hear from another part of it.
 */
export function isSuppressed(email) {
  const e = normEmail(email);
  if (!e) return false;

  const own = db.prepare(
    'SELECT 1 FROM service_email_unsubscribes WHERE email = ?'
  ).get(e);
  if (own) return true;

  const campaign = db.prepare(
    'SELECT 1 FROM contact_unsubscribed_all WHERE lower(contact_email) = ?'
  ).get(e);
  return !!campaign;
}

/**
 * Record an opt-out and stop anything already in flight for that address.
 *
 * Also mirrors into `contact_unsubscribed_all` when SWEETBYTE_EMAIL_CLIENT_ID
 * is configured, so the campaign side honours it too. Left unset, the opt-out
 * still holds for service emails via our own table — the mirror is what makes
 * it bite on marketing sends as well.
 */
export function unsubscribe(email, source = 'service_email') {
  const e = normEmail(email);
  if (!e) return { ok: false, reason: 'no_email' };

  db.prepare(`
    INSERT INTO service_email_unsubscribes (email, source)
    VALUES (?, ?)
    ON CONFLICT(email) DO UPDATE SET unsubscribed_at = datetime('now')
  `).run(e, source);

  const clientId = process.env.SWEETBYTE_EMAIL_CLIENT_ID;
  if (clientId) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO contact_unsubscribed_all
          (email_client_id, contact_email, source)
        VALUES (?, ?, ?)
      `).run(clientId, e, source);
    } catch (err) {
      console.error('[service-email] campaign-side unsubscribe mirror failed:', err.message);
    }
  }

  const killed = db.prepare(`
    UPDATE service_email_sends
       SET status = 'cancelled', error = 'recipient unsubscribed'
     WHERE lower(to_email) = ? AND status = 'queued'
  `).run(e);

  return { ok: true, cancelled: killed.changes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dedupe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A service counts as already sent to a (company, address) pair once an email
 * containing it has gone out or is queued to go out. Same service to a
 * DIFFERENT address is allowed, and a different service to the same address is
 * allowed — only the exact combination is blocked.
 *
 * Step-2 rows are excluded: a follow-up isn't a new offer, and counting it
 * would make the pair look freshly used every time one goes out.
 */
export function sentServiceKeys(externalCompanyId, email) {
  const rows = db.prepare(`
    SELECT services_json FROM service_email_sends
     WHERE external_company_id = ?
       AND lower(to_email) = ?
       AND step = 1
       AND status IN ('queued', 'sending', 'sent')
  `).all(String(externalCompanyId), normEmail(email));

  const keys = new Set();
  for (const r of rows) for (const k of parseServices(r)) keys.add(k);
  return Array.from(keys);
}

/**
 * Everything ever sent for a company, any address — powers WorkTrackr's chip
 * state and the timeline entry.
 */
export function historyForCompany(externalCompanyId) {
  const rows = db.prepare(`
    SELECT id, to_email, services_json, step, status, send_after, sent_at, created_at
      FROM service_email_sends
     WHERE external_company_id = ?
     ORDER BY created_at DESC
     LIMIT 200
  `).all(String(externalCompanyId));

  return rows.map(r => ({
    id: r.id,
    toEmail: r.to_email,
    services: parseServices(r),
    step: r.step,
    status: r.status,
    sendAfter: r.send_after,
    sentAt: r.sent_at,
    createdAt: r.created_at,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Queueing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queue an initial send. Returns immediately — the actual send happens after
 * the undo window, either from the setTimeout below or from the ticker.
 *
 * Returns one of:
 *   { ok: true,  id, services, sendAfter }
 *   { ok: false, reason: 'suppressed' | 'no_services' | 'already_sent' | 'invalid_services' }
 */
export function queueServiceEmail({
  externalCompanyId,
  companyName,
  contactName,
  toEmail,
  services,
}) {
  const email = normEmail(toEmail);
  if (!email) return { ok: false, reason: 'no_email' };
  if (!externalCompanyId) return { ok: false, reason: 'no_company' };

  const { keys, invalid } = normaliseServiceKeys(services);
  if (invalid.length) return { ok: false, reason: 'invalid_services', invalid };
  if (!keys.length) return { ok: false, reason: 'no_services' };

  if (isSuppressed(email)) return { ok: false, reason: 'suppressed' };

  // Drop anything this address has already had from this company.
  const already = new Set(sentServiceKeys(externalCompanyId, email));
  const fresh = keys.filter(k => !already.has(k));
  if (!fresh.length) return { ok: false, reason: 'already_sent', already: Array.from(already) };

  const id = uuid();
  const sendAfter = isoPlusSeconds(UNDO_SECONDS);

  db.prepare(`
    INSERT INTO service_email_sends
      (id, external_company_id, company_name, contact_name, to_email,
       services_json, step, status, send_after)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'queued', ?)
  `).run(
    id,
    String(externalCompanyId),
    companyName || null,
    contactName || null,
    email,
    JSON.stringify(fresh),
    sendAfter,
  );

  // Fire promptly rather than waiting up to a full ticker interval. The ticker
  // is the safety net if the process restarts inside the window.
  setTimeout(() => {
    processDue().catch(err =>
      console.error('[service-email] post-undo send failed:', err && err.stack || err));
  }, UNDO_SECONDS * 1000 + 500).unref?.();

  return { ok: true, id, services: fresh, sendAfter, skipped: keys.filter(k => already.has(k)) };
}

/**
 * Undo. Only bites while the row is still 'queued' — once a worker has claimed
 * it, the email is with SES and there is nothing to take back.
 */
export function cancelSend(id) {
  const res = db.prepare(`
    UPDATE service_email_sends
       SET status = 'cancelled', error = 'undone by sender'
     WHERE id = ? AND status = 'queued'
  `).run(String(id));

  if (res.changes) {
    // An undone initial email must not leave a follow-up behind.
    db.prepare(`
      UPDATE service_email_sends
         SET status = 'cancelled', error = 'parent undone'
       WHERE parent_id = ? AND status = 'queued'
    `).run(String(id));
    return { ok: true };
  }
  return { ok: false, reason: 'too_late' };
}

/**
 * Cancel pending follow-ups for a company. Called by WorkTrackr when a company
 * moves to the dead or customer stage — in both cases the follow-up has stopped
 * being useful, for opposite reasons.
 *
 * Only touches queued rows: sent email is sent.
 */
export function cancelPendingForCompany(externalCompanyId, reason = 'stage change') {
  const res = db.prepare(`
    UPDATE service_email_sends
       SET status = 'cancelled', error = ?
     WHERE external_company_id = ? AND status = 'queued'
  `).run(String(reason), String(externalCompanyId));
  return { ok: true, cancelled: res.changes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sending
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send every row whose time has come.
 *
 * Safe to call concurrently — the claim UPDATE means a row can only be picked
 * up once. Called by the ticker and by the post-undo timeout.
 */
export async function processDue() {
  const due = db.prepare(`
    SELECT * FROM service_email_sends
     WHERE status = 'queued' AND send_after <= ?
     ORDER BY send_after
     LIMIT 50
  `).all(nowIso());

  const results = { sent: 0, failed: 0, suppressed: 0, skipped: 0 };

  for (const row of due) {
    // Claim it. Zero changes means somebody else got there first.
    const claim = db.prepare(`
      UPDATE service_email_sends SET status = 'sending'
       WHERE id = ? AND status = 'queued'
    `).run(row.id);
    if (!claim.changes) { results.skipped++; continue; }

    // Re-check suppression at send time, not queue time. Seven days is plenty
    // of time for someone to opt out between the two emails.
    if (isSuppressed(row.to_email)) {
      db.prepare(`
        UPDATE service_email_sends
           SET status = 'suppressed', error = 'recipient unsubscribed before send'
         WHERE id = ?
      `).run(row.id);
      results.suppressed++;
      continue;
    }

    const services = parseServices(row);
    if (!services.length) {
      db.prepare(`
        UPDATE service_email_sends SET status = 'failed', error = 'no valid services'
         WHERE id = ?
      `).run(row.id);
      results.failed++;
      continue;
    }

    try {
      const htmlBody = renderServiceEmail({
        serviceKeys: services,
        step: row.step,
        companyName: row.company_name,
        contactName: row.contact_name,
        senderName: SENDER_NAME,
        unsubUrl: unsubUrlFor(row.to_email),
      });

      // No open/click tracking on these, on purpose. Every message is CC'd, so
      // a tracking pixel would fire from the CC's client and record an "open"
      // the prospect never made — worse than no data. The unsubscribe link is
      // a plain URL and needs no tracking wrapper to work.
      const { messageId } = await sendEmail({
        to:        row.to_email,
        toName:    row.contact_name || null,
        cc:        CC_EMAIL || null,
        fromName:  FROM_NAME,
        fromEmail: FROM_EMAIL,
        replyTo:   FROM_EMAIL,
        subject:   buildSubject(services, row.step, {
          companyName: row.company_name,
          contactName: row.contact_name,
          senderName: SENDER_NAME,
        }),
        htmlBody,
        attachments: BROCHURE ? [BROCHURE] : [],
      });

      db.prepare(`
        UPDATE service_email_sends
           SET status = 'sent', sent_at = datetime('now'), message_id = ?
         WHERE id = ?
      `).run(messageId || null, row.id);
      results.sent++;

      if (row.step === 1 && FOLLOWUP_READY) scheduleFollowup(row, services);
    } catch (err) {
      console.error('[service-email] send failed:', row.id, err.message);
      db.prepare(`
        UPDATE service_email_sends SET status = 'failed', error = ? WHERE id = ?
      `).run(String(err.message).slice(0, 500), row.id);
      results.failed++;
    }
  }

  return results;
}

/**
 * Book the follow-up, 7 days after the initial email actually went out —
 * measured from the send, not from when it was queued, so an email delayed by
 * an outage doesn't produce a follow-up hard on its heels.
 *
 * Guarded against duplicates: a row already carrying this parent_id means the
 * follow-up exists, whatever path got us here twice.
 */
function scheduleFollowup(parentRow, services) {
  const existing = db.prepare(
    'SELECT 1 FROM service_email_sends WHERE parent_id = ?'
  ).get(parentRow.id);
  if (existing) return;

  db.prepare(`
    INSERT INTO service_email_sends
      (id, external_company_id, company_name, contact_name, to_email,
       services_json, step, status, send_after, parent_id)
    VALUES (?, ?, ?, ?, ?, ?, 2, 'queued', ?, ?)
  `).run(
    uuid(),
    parentRow.external_company_id,
    parentRow.company_name,
    parentRow.contact_name,
    parentRow.to_email,
    JSON.stringify(services),
    isoPlusSeconds(FOLLOWUP_DAYS * 24 * 60 * 60),
    parentRow.id,
  );
}
