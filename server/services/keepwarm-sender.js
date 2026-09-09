/**
 * keepwarm-sender.js — Phase 2: actually sending the keep-warm emails.
 *
 * Phase 1 built the audience, the generation and the review screen and stopped
 * dead there, on purpose: no send button, and no route behind one. This file is
 * the send, and it is deliberately shaped so that the dangerous parts are hard
 * to reach by accident.
 *
 * THE MODEL
 * Pressing send does not send. It creates a RUN — one row in keepwarm_runs
 * naming the approved draft, plus one row per recipient in keepwarm_recipients
 * — and dates the run a few seconds into the future. Nothing leaves the
 * building until that moment passes and a worker picks the run up. Undo is
 * therefore not a trick: for those few seconds there is genuinely nothing to
 * take back, because nothing has been sent.
 *
 * WHY ONE ROW PER RECIPIENT
 * Three things fall out of it that are otherwise impossible:
 *   1. Pressing send twice cannot double-send. A row is claimed before its
 *      message goes, so the second pass finds nothing to claim.
 *   2. A restart mid-send resumes rather than restarting. Render redeploys
 *      whenever main moves, and a 1,000-person send takes minutes.
 *   3. The Sent tab can say who the August email actually went to, not who
 *      would qualify today. The audience shifts as WorkTrackr stages change,
 *      so a live recount would quietly rewrite history.
 *
 * WHAT IT REUSES RATHER THAN REBUILDS
 *   - `sendEmail` from ses.js. Its three tracking switches all default to off,
 *     so a keep-warm email carries no pixel and no rewritten links without
 *     anyone having to remember to disable anything. That was the operator's
 *     decision: replies and opt-outs are things a person did on purpose, and an
 *     open rate is mostly Apple Mail loading an image by itself.
 *   - `isSuppressed` and `unsubUrlFor` from service-email-sender.js. One
 *     opt-out list and one signed link cover the cold intro email and every
 *     keep-warm that follows it, which is what a recipient assumes when they
 *     click unsubscribe.
 *   - `renderEmailHtml` from keepwarm-generator.js — the same renderer the
 *     review screen previews with, so what was approved is what is delivered.
 *
 * NO SILENT FALLBACKS
 * A missing from-address, an unapproved draft, an empty audience or an audience
 * larger than the cap all refuse the run with a plain reason. None of them
 * invent a default. The cap exists because an audience that jumps from 140 to
 * 4,000 is a WorkTrackr stage glitch, not a good day.
 */

import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { sendEmail } from './ses.js';
import { isSuppressed, unsubUrlFor } from './service-email-sender.js';
import { buildAudience, getDraft } from './keepwarm-store.js';
import { renderEmailHtml, htmlToText } from './keepwarm-generator.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

// The undo window. Clamped rather than trusted: a zero would remove undo
// altogether and a very large number would leave the operator staring at a
// screen wondering whether they had pressed the button at all.
const UNDO_SECONDS = (() => {
  const raw = Number(process.env.KEEPWARM_UNDO_SECONDS);
  if (!Number.isFinite(raw)) return 10;
  return Math.min(60, Math.max(5, Math.round(raw)));
})();

// How often the fortnightly slot comes round. Env-overridable mainly so it can
// be shortened on a test instance without editing code.
const CADENCE_DAYS = (() => {
  const raw = Number(process.env.KEEPWARM_CADENCE_DAYS);
  if (!Number.isFinite(raw) || raw < 1) return 14;
  return Math.round(raw);
})();

// Refuse rather than send if the audience is bigger than this. Set high enough
// that ordinary growth never trips it — the operator expects to reach four
// figures — and low enough that a runaway is caught before SES sees it.
const MAX_RECIPIENTS = (() => {
  const raw = Number(process.env.KEEPWARM_MAX_RECIPIENTS);
  if (!Number.isFinite(raw) || raw < 1) return 2000;
  return Math.round(raw);
})();

// Pacing. Matches the campaign sender's shape (ten at a time, a short gap
// between batches) because that combination is already proven against this SES
// account's rate limit. A thousand recipients works out at roughly two minutes.
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 800;

// These emails go out over Billy's name and from Billy's address, the same as
// the introduction they follow. Reusing the service-email variables keeps that
// true without a second set of settings to forget to fill in.
const FROM_EMAIL = process.env.KEEPWARM_FROM || process.env.SERVICE_EMAIL_FROM || '';
const FROM_NAME  = process.env.KEEPWARM_FROM_NAME || process.env.SERVICE_EMAIL_FROM_NAME || '';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────
//
// Owned here rather than in db.js or keepwarm-store.js, following the same
// pattern service-email-sender.js uses: the file that writes the rows owns the
// table, so there is one place to look when a column is in question.

db.exec(`
  CREATE TABLE IF NOT EXISTS keepwarm_runs (
    id              TEXT PRIMARY KEY,
    draft_id        TEXT NOT NULL,
    subject         TEXT NOT NULL,
    html_body       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued',
    recipient_count INTEGER NOT NULL DEFAULT 0,
    send_after      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    started_at      TEXT,
    finished_at     TEXT,
    cancelled_by    TEXT,
    error           TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_kw_runs_due
    ON keepwarm_runs(status, send_after);

  CREATE TABLE IF NOT EXISTS keepwarm_recipients (
    id                  TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL,
    external_company_id TEXT,
    company_name        TEXT,
    contact_name        TEXT,
    email               TEXT NOT NULL,
    stage               TEXT,
    status              TEXT NOT NULL DEFAULT 'queued',
    message_id          TEXT,
    error               TEXT,
    sent_at             TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_kw_recip_run
    ON keepwarm_recipients(run_id, status);
  CREATE INDEX IF NOT EXISTS idx_kw_recip_email
    ON keepwarm_recipients(email);
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

// "Dave Smith" → "Dave". The generated copy greets by first name and falls back
// to "there", so a missing or odd name degrades to a normal-sounding greeting
// rather than "Hi Mr D Smith-Jones (Accounts),".
function firstNameOf(contactName) {
  const t = String(contactName || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-z][A-Za-z'’-]{1,}$/.test(t) ? t : null;
}

/**
 * A run that is queued or already sending. Only one at a time is allowed —
 * two overlapping runs would mean two emails landing on the same person within
 * minutes of each other, which reads as a fault whatever the copy says.
 */
export function activeRun() {
  return db.prepare(`
    SELECT * FROM keepwarm_runs
     WHERE status IN ('queued', 'sending')
     ORDER BY created_at ASC
     LIMIT 1
  `).get() || null;
}

export function lastCompletedRun() {
  return db.prepare(`
    SELECT * FROM keepwarm_runs
     WHERE status = 'sent'
     ORDER BY COALESCE(finished_at, created_at) DESC
     LIMIT 1
  `).get() || null;
}

/**
 * When the next fortnightly slot falls due.
 *
 * Counted from the last completed send rather than from a fixed calendar, so a
 * send that slipped by a few days moves the following one with it instead of
 * bunching two together to catch up.
 */
export function nextDueDate() {
  const last = lastCompletedRun();
  const from = last && (last.finished_at || last.created_at);
  if (!from) return null; // nothing sent yet — the first one is due whenever the operator says
  const base = new Date(from.includes('T') ? from : from.replace(' ', 'T') + 'Z');
  base.setUTCDate(base.getUTCDate() + CADENCE_DAYS);
  return base.toISOString().slice(0, 10);
}

export function cadenceConfig() {
  return {
    cadenceDays:   CADENCE_DAYS,
    undoSeconds:   UNDO_SECONDS,
    maxRecipients: MAX_RECIPIENTS,
    fromConfigured: Boolean(FROM_EMAIL && FROM_NAME),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Queueing a send
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Freeze an approved draft and its audience into a run.
 *
 * `only` is an optional array of addresses. When present the run goes to just
 * those people — the operator has unticked the rest for this one send. It is
 * intersected with the live audience rather than trusted: an address that is
 * not currently in the loop, or has unsubscribed since the screen was drawn,
 * must not become sendable by arriving in a request body.
 *
 * Returns { ok: true, runId, recipientCount, sendAfter } or
 * { ok: false, reason } where reason is one of:
 *   not_configured | no_draft | not_approved | already_sent |
 *   run_in_progress | empty_audience | no_match | over_cap
 */
export function queueRun(draftId, { only = null, exclude = null } = {}) {
  if (!FROM_EMAIL || !FROM_NAME) {
    return { ok: false, reason: 'not_configured' };
  }

  const existing = activeRun();
  if (existing) {
    return { ok: false, reason: 'run_in_progress', runId: existing.id };
  }

  const draft = getDraft(draftId);
  if (!draft) return { ok: false, reason: 'no_draft' };
  if (draft.status === 'sent') return { ok: false, reason: 'already_sent' };
  if (draft.status !== 'approved') return { ok: false, reason: 'not_approved' };

  const { included } = buildAudience();
  if (!included.length) return { ok: false, reason: 'empty_audience' };

  // Two ways to hand-pick, because the screen has two shapes of tick. "Select
  // all then untick three" sends an exclude list; "deselect all then tick
  // myself" sends an only list. Sending the resolved list instead would mean
  // the browser deciding who is in the audience, and a stale tab could then
  // mail somebody who went dead an hour ago.
  let recipients = included;
  if (Array.isArray(only) && only.length) {
    const wanted = new Set(only.map(normEmail).filter(Boolean));
    recipients = included.filter(p => wanted.has(normEmail(p.email)));
  } else if (Array.isArray(exclude) && exclude.length) {
    const dropped = new Set(exclude.map(normEmail).filter(Boolean));
    recipients = included.filter(p => !dropped.has(normEmail(p.email)));
  }

  if (!recipients.length) {
    // Either everything was unticked, or every ticked address has dropped out
    // of the audience since the screen was drawn. Refusing is right: falling
    // back to the full list would be the opposite of what the ticks asked for.
    return { ok: false, reason: 'no_match' };
  }

  if (recipients.length > MAX_RECIPIENTS) {
    return { ok: false, reason: 'over_cap', count: recipients.length, cap: MAX_RECIPIENTS };
  }

  const runId = uuid();
  const sendAfter = isoPlusSeconds(UNDO_SECONDS);

  const insertRun = db.prepare(`
    INSERT INTO keepwarm_runs
      (id, draft_id, subject, html_body, status, recipient_count, send_after)
    VALUES (?, ?, ?, ?, 'queued', ?, ?)
  `);
  const insertRecipient = db.prepare(`
    INSERT INTO keepwarm_recipients
      (id, run_id, external_company_id, company_name, contact_name, email, stage, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')
  `);

  // One transaction: a half-written run — the header with no recipients, or
  // recipients with no header — would be picked up by the worker as an empty
  // send and marked complete, quietly skipping a fortnight.
  const write = db.transaction(() => {
    insertRun.run(runId, draft.id, draft.subject, draft.html_body, recipients.length, sendAfter);
    for (const p of recipients) {
      insertRecipient.run(
        uuid(), runId,
        p.externalCompanyId || null,
        p.companyName || null,
        p.contactName || null,
        normEmail(p.email),
        p.stage || null,
      );
    }
  });
  write();

  const partial = recipients.length !== included.length;
  console.log(
    `[keepwarm] run ${runId} queued — ${recipients.length} recipient(s)`
    + (partial ? ` (hand-picked from ${included.length} in the loop)` : '')
    + `, sending after ${sendAfter}`
  );

  // Fire when the window closes rather than waiting for the next tick. The
  // ticker is the safety net if the process restarts inside the window.
  setTimeout(() => {
    processDue().catch(err =>
      console.error('[keepwarm] post-undo send failed:', err && err.stack || err));
  }, UNDO_SECONDS * 1000 + 500).unref?.();

  return {
    ok: true, runId, sendAfter,
    recipientCount: recipients.length,
    audienceCount: included.length,
    partial,
    undoSeconds: UNDO_SECONDS,
  };
}

/**
 * Send one copy of a draft to a single address, immediately.
 *
 * Deliberately NOT a run. It writes nothing to keepwarm_runs, marks no
 * recipients, does not touch the draft's status and never appears in the Sent
 * tab. That matters: the obvious way to test — untick everyone but yourself on
 * a real send — marks the draft sent and it can never go to the other people
 * afterwards. A good email gets burned proving the plumbing works, and nobody
 * notices for a fortnight.
 *
 * The suppression list is still honoured. A test is a real email arriving in a
 * real inbox, and "it was only a test" is not a defence to someone who asked
 * not to be emailed.
 */
export async function sendTest({ draftId, toEmail }) {
  if (!FROM_EMAIL || !FROM_NAME) return { ok: false, reason: 'not_configured' };

  const email = normEmail(toEmail);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, reason: 'bad_email' };
  }

  const draft = getDraft(draftId);
  if (!draft) return { ok: false, reason: 'no_draft' };

  if (isSuppressed(email)) return { ok: false, reason: 'suppressed' };

  const html = renderEmailHtml({
    bodyHtml:  draft.html_body,
    unsubUrl:  unsubUrlFor(email),
    firstName: null,
  });

  try {
    const { messageId } = await sendEmail({
      to:        email,
      fromName:  FROM_NAME,
      fromEmail: FROM_EMAIL,
      replyTo:   FROM_EMAIL,
      // Marked in the subject so a test sitting in the inbox next to the real
      // thing a fortnight later cannot be mistaken for it.
      subject:   `[TEST] ${draft.subject}`,
      htmlBody:  html,
      plainBody: htmlToText(html),
    });
    console.log(`[keepwarm] test of draft ${draftId} sent to ${email}`);
    return { ok: true, messageId: messageId || null };
  } catch (err) {
    const msg = (err && err.message) ? err.message.slice(0, 500) : 'send failed';
    console.error('[keepwarm] test send failed:', msg);
    return { ok: false, reason: 'send_failed', detail: msg };
  }
}

/**
 * Undo. Only bites while the run is still queued — once the worker has claimed
 * it the first messages are with SES and there is nothing to recall.
 */
export function cancelRun(runId, by = 'operator') {
  const res = db.prepare(`
    UPDATE keepwarm_runs
       SET status = 'cancelled', cancelled_by = ?, finished_at = datetime('now')
     WHERE id = ? AND status = 'queued'
  `).run(String(by), String(runId));

  if (!res.changes) return { ok: false, reason: 'too_late' };

  db.prepare(`
    UPDATE keepwarm_recipients
       SET status = 'cancelled'
     WHERE run_id = ? AND status = 'queued'
  `).run(String(runId));

  console.log(`[keepwarm] run ${runId} cancelled during the undo window`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sending
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send everything that is due.
 *
 * Picks up two kinds of run: a queued one whose undo window has closed, and a
 * run left half-sent by a restart. The second is why recipients are claimed
 * individually — resuming means "send the ones still marked queued", which is
 * correct whether the process died after ten of them or after nine hundred.
 */
export async function processDue() {
  const results = { runs: 0, sent: 0, failed: 0, suppressed: 0 };

  const due = db.prepare(`
    SELECT * FROM keepwarm_runs
     WHERE (status = 'queued' AND send_after <= ?)
        OR status = 'sending'
     ORDER BY created_at ASC
  `).all(nowIso());

  for (const run of due) {
    // Claim the run. The WHERE clause is the lock: if a second caller got here
    // first, changes is 0 and this one leaves it alone.
    if (run.status === 'queued') {
      const claimed = db.prepare(`
        UPDATE keepwarm_runs
           SET status = 'sending', started_at = COALESCE(started_at, datetime('now'))
         WHERE id = ? AND status = 'queued'
      `).run(run.id);
      if (!claimed.changes) continue;
    }

    results.runs += 1;
    const runResult = await sendRun(run);
    results.sent       += runResult.sent;
    results.failed     += runResult.failed;
    results.suppressed += runResult.suppressed;
  }

  return results;
}

async function sendRun(run) {
  const out = { sent: 0, failed: 0, suppressed: 0 };

  const pending = db.prepare(`
    SELECT * FROM keepwarm_recipients
     WHERE run_id = ? AND status = 'queued'
     ORDER BY created_at ASC
  `).all(run.id);

  const claim = db.prepare(`
    UPDATE keepwarm_recipients SET status = 'sending'
     WHERE id = ? AND status = 'queued'
  `);
  const markSent = db.prepare(`
    UPDATE keepwarm_recipients
       SET status = 'sent', message_id = ?, sent_at = datetime('now'), error = NULL
     WHERE id = ?
  `);
  const markFailed = db.prepare(`
    UPDATE keepwarm_recipients SET status = 'failed', error = ? WHERE id = ?
  `);
  const markSuppressed = db.prepare(`
    UPDATE keepwarm_recipients SET status = 'suppressed', error = ? WHERE id = ?
  `);

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    // Cancelling mid-send is not offered in the UI, but a row edited by hand or
    // a future stop button should take effect at the next batch rather than
    // after the last message.
    const state = db.prepare('SELECT status FROM keepwarm_runs WHERE id = ?').get(run.id);
    if (!state || state.status !== 'sending') break;

    const batch = pending.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (r) => {
      if (!claim.run(r.id).changes) return; // someone else has it

      // Re-checked here, not just when the run was queued. Somebody can
      // unsubscribe during the undo window or midway through a long send, and
      // the whole point of an opt-out is that it takes effect immediately.
      if (isSuppressed(r.email)) {
        markSuppressed.run('unsubscribed before send', r.id);
        out.suppressed += 1;
        return;
      }

      try {
        const html = renderEmailHtml({
          bodyHtml:  run.html_body,
          unsubUrl:  unsubUrlFor(r.email),
          firstName: firstNameOf(r.contact_name),
        });

        // Tracking flags are left at their defaults, which are all false. No
        // pixel, no rewritten links — the operator's decision, recorded at the
        // top of this file.
        const { messageId } = await sendEmail({
          to:        r.email,
          toName:    r.contact_name || null,
          fromName:  FROM_NAME,
          fromEmail: FROM_EMAIL,
          replyTo:   FROM_EMAIL,
          subject:   run.subject,
          htmlBody:  html,
          plainBody: htmlToText(html),
        });

        markSent.run(messageId || null, r.id);
        out.sent += 1;
      } catch (err) {
        const msg = (err && err.message) ? err.message.slice(0, 500) : 'send failed';
        markFailed.run(msg, r.id);
        out.failed += 1;
        console.error(`[keepwarm] send to ${r.email} failed:`, msg);
      }
    }));

    if (i + BATCH_SIZE < pending.length) await sleep(BATCH_DELAY_MS);
  }

  // Anything still marked sending belongs to a batch that died mid-flight.
  // Put it back so a later sweep retries it rather than leaving it stranded.
  db.prepare(`
    UPDATE keepwarm_recipients SET status = 'queued'
     WHERE run_id = ? AND status = 'sending'
  `).run(run.id);

  const remaining = db.prepare(`
    SELECT COUNT(*) AS n FROM keepwarm_recipients
     WHERE run_id = ? AND status = 'queued'
  `).get(run.id).n;

  if (remaining === 0) {
    db.prepare(`
      UPDATE keepwarm_runs
         SET status = 'sent', finished_at = datetime('now')
       WHERE id = ? AND status = 'sending'
    `).run(run.id);

    // The draft is marked sent only once every message has gone, so a draft can
    // never show as sent while part of its audience is still waiting.
    db.prepare(`
      UPDATE keepwarm_drafts
         SET status = 'sent', sent_at = datetime('now')
       WHERE id = ?
    `).run(run.draft_id);

    console.log(`[keepwarm] run ${run.id} finished — ${out.sent} sent, ${out.failed} failed, ${out.suppressed} suppressed`);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading, for the Schedule and Sent tabs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the Schedule tab shows: the run in flight if there is one, the next due
 * date, and the approved drafts lined up behind it with a projected date each.
 *
 * The counts are explicitly "who qualifies today". The real list is frozen when
 * the operator presses send, and the screen says so — a projection presented as
 * a fact is how somebody ends up surprised by who got an email.
 */
export function schedule(limit = 10) {
  const active = activeRun();
  const due = nextDueDate();
  const { included } = buildAudience();

  const approved = db.prepare(`
    SELECT id, subject, created_at, approved_at
      FROM keepwarm_drafts
     WHERE status = 'approved'
     ORDER BY COALESCE(approved_at, created_at) ASC
     LIMIT ?
  `).all(Math.max(1, Math.min(50, limit)));

  // Slot dates run forward from whichever is later: the next due date, or
  // today. A due date in the past means the slot is open now, not overdue by a
  // fortnight's worth of catching up.
  const startMs = Math.max(
    due ? Date.parse(due + 'T00:00:00Z') : Date.now(),
    Date.now(),
  );

  const slots = approved.map((d, idx) => {
    const when = new Date(startMs);
    when.setUTCDate(when.getUTCDate() + idx * CADENCE_DAYS);
    return {
      draftId:        d.id,
      subject:        d.subject,
      date:           when.toISOString().slice(0, 10),
      dueNow:         idx === 0 && (!due || Date.parse(due + 'T00:00:00Z') <= Date.now()),
      projectedCount: included.length,
    };
  });

  return {
    activeRun: active
      ? {
          id: active.id,
          status: active.status,
          subject: active.subject,
          recipientCount: active.recipient_count,
          sendAfter: active.send_after,
          progress: runProgress(active.id),
        }
      : null,
    nextDueDate: due,
    audienceCount: included.length,
    slots,
    config: cadenceConfig(),
  };
}

function runProgress(runId) {
  const row = db.prepare(`
    SELECT
      COUNT(*)                                                   AS total,
      SUM(CASE WHEN status = 'sent'       THEN 1 ELSE 0 END)     AS sent,
      SUM(CASE WHEN status = 'failed'     THEN 1 ELSE 0 END)     AS failed,
      SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END)     AS suppressed
    FROM keepwarm_recipients WHERE run_id = ?
  `).get(runId);
  return {
    total:      row.total || 0,
    sent:       row.sent || 0,
    failed:     row.failed || 0,
    suppressed: row.suppressed || 0,
  };
}

/**
 * What the Sent tab shows. Opt-outs are counted as unsubscribes recorded after
 * the run went out — the number that says a piece of copy misfired.
 */
export function sentRuns(limit = 20) {
  const runs = db.prepare(`
    SELECT * FROM keepwarm_runs
     WHERE status IN ('sent', 'cancelled')
     ORDER BY COALESCE(finished_at, created_at) DESC
     LIMIT ?
  `).all(Math.max(1, Math.min(100, limit)));

  return runs.map(r => {
    const p = runProgress(r.id);

    // Opt-outs attributable to this send: an address that was on it and
    // unsubscribed after it left. Attribution by time is imperfect — somebody
    // could have opted out from an older email the same afternoon — so the
    // screen calls this "opt-outs since", not "opt-outs caused by".
    const optOuts = db.prepare(`
      SELECT COUNT(*) AS n
        FROM service_email_unsubscribes u
        JOIN keepwarm_recipients kr
          ON kr.email = u.email AND kr.run_id = ?
       WHERE u.unsubscribed_at >= COALESCE(?, ?)
    `).get(r.id, r.started_at, r.created_at).n;

    return {
      id:         r.id,
      subject:    r.subject,
      status:     r.status,
      sentAt:     r.finished_at || r.created_at,
      total:      p.total,
      sent:       p.sent,
      failed:     p.failed,
      suppressed: p.suppressed,
      optOuts,
    };
  });
}

/**
 * The people on one run, for the drill-down. Capped because a thousand rows
 * through the admin API is a slow page nobody reads to the bottom of.
 */
export function runRecipients(runId, limit = 1000) {
  return db.prepare(`
    SELECT company_name, contact_name, email, stage, status, sent_at, error
      FROM keepwarm_recipients
     WHERE run_id = ?
     ORDER BY company_name IS NULL, company_name ASC, email ASC
     LIMIT ?
  `).all(String(runId), Math.max(1, Math.min(2000, limit)));
}
