/**
 * server/services/bounce-store.js — dead email addresses.
 *
 * WHAT PROBLEM THIS SOLVES
 * SES accepts any well-formed address. If the mailbox does not exist, the
 * rejection arrives minutes LATER as a bounce notification, long after the send
 * was recorded as successful. Studio already receives those notifications —
 * routes/email.js logs every one into `email_sns_events` — but it only ever
 * matched them against CAMPAIGN sends (`email_sends`). A bounce on a service
 * email or a keep-warm email matched nothing and was dropped on the floor, so
 * the address stayed in the keep-warm audience and got mailed again a fortnight
 * later, and the fortnight after that.
 *
 * WHY THIS READS THE EVENT LOG RATHER THAN HOOKING THE WEBHOOK
 * `logSnsEvent` in routes/email.js writes the raw payload of every notification
 * BEFORE anything tries to interpret it, and never prunes. That log is
 * therefore a complete record of every bounce Studio has ever been told about.
 * Reading it here means:
 *   - the live path and the historical backfill are the same code, so a bounce
 *     from six weeks ago is handled by the same lines as one from six seconds
 *     ago and cannot behave differently;
 *   - the existing campaign bounce handling is untouched, so this cannot break
 *     the one part of bounce handling that already worked;
 *   - it is replayable. Reset the cursor and the whole history is re-derived.
 * The cost is up to one ticker interval of lag, which does not matter for a
 * signal that already took minutes to arrive from the mail server.
 *
 * PERMANENT VS TRANSIENT — THE BIT THAT MATTERS
 * Not every bounce means the address is dead. A full mailbox, a server having a
 * bad afternoon, or a greylisting relay all bounce and then work fine next
 * week. Only PERMANENT bounces and spam complaints mark an address dead on the
 * first occurrence. Transient ones are counted quietly and say nothing until an
 * address has failed SOFT_LIMIT times, because deleting live prospects on the
 * strength of one bad afternoon is a worse outcome than mailing a full mailbox
 * twice.
 *
 * WHY THIS TABLE IS KEYED ON THE ADDRESS AND OWNS ITS OWN ROW
 * The keep-warm audience is derived from `service_email_sends`. If deadness
 * were also derived from there, then erasing an address's send history — which
 * the operator explicitly wants to be able to do — would erase the record that
 * the address is dead, and the next introduction email to it would put it
 * straight back into the audience as though it were new. Keeping deadness in
 * its own table, keyed on the address, means the history can be erased
 * completely and the address still stays permanently unmailable.
 *
 * SCHEMA LIVES HERE, NOT IN db.js
 * Same reasoning as service-email-sender.js and keepwarm-store.js: db.js is
 * 2,100 lines shared by every feature, so appending to it means reissuing the
 * whole file for a two-table change. CREATE TABLE IF NOT EXISTS, run once at
 * import — identical idempotency, much smaller blast radius.
 *
 * Env: none.
 */

import db from '../db.js';

// How many transient bounces before an address is treated as dead. Three is
// deliberately unhurried: two failures inside a fortnight is a bad week, three
// across three separate sends is a pattern.
const SOFT_LIMIT = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS email_dead_addresses (
    email               TEXT PRIMARY KEY,
    dead                INTEGER NOT NULL DEFAULT 0,
    reason              TEXT,
    bounce_type         TEXT,
    bounce_subtype      TEXT,
    diagnostic          TEXT,
    soft_count          INTEGER NOT NULL DEFAULT 0,
    source              TEXT,
    company_name        TEXT,
    contact_name        TEXT,
    external_company_id TEXT,
    message_id          TEXT,
    first_seen_at       TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at        TEXT NOT NULL DEFAULT (datetime('now')),
    hidden_at           TEXT,
    erased_at           TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_dead_live ON email_dead_addresses(dead, hidden_at);

  CREATE TABLE IF NOT EXISTS email_bounce_state (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

const CURSOR_KEY = 'snsCursorRowid';

function readCursor() {
  try {
    const row = db.prepare('SELECT value FROM email_bounce_state WHERE key = ?').get(CURSOR_KEY);
    return row ? Number(row.value) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeCursor(rowid) {
  db.prepare(`
    INSERT INTO email_bounce_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(CURSOR_KEY, String(rowid));
}

const normEmail = (e) => String(e || '').trim().toLowerCase();

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this address dead?
 *
 * Consulted by isSuppressed() in service-email-sender.js, which every send path
 * in Studio already runs through — service emails at queue time AND at send
 * time, keep-warm runs per recipient, keep-warm test sends. Hooking in there
 * rather than at four separate call sites is what makes it impossible for a new
 * send path to be added later that forgets to check.
 *
 * `hidden_at` is deliberately NOT consulted. Removing an address from the
 * screen is a tidying-up action; it does not bring the mailbox back to life.
 */
export function isDead(email) {
  const e = normEmail(email);
  if (!e) return false;
  try {
    const row = db.prepare(
      'SELECT 1 FROM email_dead_addresses WHERE email = ? AND dead = 1'
    ).get(e);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Everything on the dead list, newest bounce first.
 *
 * Addresses still accumulating transient bounces are excluded — they are not
 * dead yet, and showing them would invite deleting somebody whose mailbox was
 * merely full on Tuesday.
 */
export function listDead({ q = '', includeHidden = false, limit = 1000 } = {}) {
  const where = includeHidden
    ? 'WHERE dead = 1'
    : 'WHERE dead = 1 AND hidden_at IS NULL';

  const rows = db.prepare(`
    SELECT * FROM email_dead_addresses
    ${where}
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).all(limit);

  const needle = String(q || '').trim().toLowerCase();
  const filtered = needle
    ? rows.filter(r =>
        (r.email || '').toLowerCase().includes(needle) ||
        (r.company_name || '').toLowerCase().includes(needle) ||
        (r.contact_name || '').toLowerCase().includes(needle))
    : rows;

  return filtered.map(r => ({
    email:             r.email,
    reason:            r.reason || 'Rejected',
    bounceType:        r.bounce_type || null,
    diagnostic:        r.diagnostic || null,
    source:            r.source || null,
    companyName:       r.company_name || null,
    contactName:       r.contact_name || null,
    externalCompanyId: r.external_company_id || null,
    firstSeenAt:       r.first_seen_at,
    lastSeenAt:        r.last_seen_at,
    hidden:            !!r.hidden_at,
    erased:            !!r.erased_at,
  }));
}

/**
 * Why this address is dead, in the same words the Dead list shows, or null if
 * it is alive. Used by the keep-warm audience so an excluded row can say
 * "bounced — mailbox does not exist" rather than the bare "unsubscribed" that
 * isSuppressed() would otherwise produce for it.
 */
export function deadReasonFor(email) {
  const e = normEmail(email);
  if (!e) return null;
  try {
    const row = db.prepare(
      'SELECT reason FROM email_dead_addresses WHERE email = ? AND dead = 1'
    ).get(e);
    return row ? (row.reason || 'Rejected') : null;
  } catch {
    return null;
  }
}

export function deadCount() {
  try {
    const row = db.prepare(
      'SELECT COUNT(*) AS n FROM email_dead_addresses WHERE dead = 1 AND hidden_at IS NULL'
    ).get();
    return row?.n || 0;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Attribution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which send did this bounce come from, and who was it?
 *
 * Looked up by SES MessageId AND the address together, never the message id
 * alone. One message id can cover several recipients — a complaint about one of
 * them matched on id alone would take its company name from whichever row that
 * id happened to hit first, and quietly file a bounce against the wrong
 * customer. Found in testing, not in production; the pairing is what stops it.
 *
 * Falls back to the newest service email to that address, because a
 * notification whose message id predates the column being added still tells us
 * the address is dead — it just cannot say which email killed it.
 *
 * Never throws. A bounce that cannot be attributed still records the address;
 * losing the company name is a cosmetic problem, losing the bounce is not.
 */
function attribute(email, messageId) {
  const out = { source: null, companyName: null, contactName: null, externalCompanyId: null };

  try {
    if (messageId) {
      const kw = db.prepare(`
        SELECT company_name, contact_name, external_company_id
          FROM keepwarm_recipients
         WHERE message_id = ? AND lower(email) = ? LIMIT 1
      `).get(messageId, email);
      if (kw) {
        return {
          source: 'keep-warm',
          companyName: kw.company_name || null,
          contactName: kw.contact_name || null,
          externalCompanyId: kw.external_company_id || null,
        };
      }
    }
  } catch { /* table may not exist yet on a fresh database */ }

  try {
    if (messageId) {
      const se = db.prepare(`
        SELECT company_name, contact_name, external_company_id, step
          FROM service_email_sends
         WHERE message_id = ? AND lower(to_email) = ? LIMIT 1
      `).get(messageId, email);
      if (se) {
        return {
          source: se.step === 2 ? 'follow-up' : 'introduction email',
          companyName: se.company_name || null,
          contactName: se.contact_name || null,
          externalCompanyId: se.external_company_id || null,
        };
      }
    }
  } catch { /* ignore */ }

  try {
    if (messageId) {
      const camp = db.prepare('SELECT 1 FROM email_sends WHERE message_id = ? LIMIT 1').get(messageId);
      // Campaign bounces are already handled by routes/email.js against the
      // subscriber record. Recorded here as well because a mailbox that is dead
      // for a campaign is equally dead for keep-warm, and the audience is built
      // from a different table that knows nothing about subscribers.
      if (camp) return { ...out, source: 'campaign' };
    }
  } catch { /* ignore */ }

  try {
    const last = db.prepare(`
      SELECT company_name, contact_name, external_company_id
        FROM service_email_sends
       WHERE lower(to_email) = ?
       ORDER BY created_at DESC LIMIT 1
    `).get(email);
    if (last) {
      return {
        source: null,
        companyName: last.company_name || null,
        contactName: last.contact_name || null,
        externalCompanyId: last.external_company_id || null,
      };
    }
  } catch { /* ignore */ }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plain English
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn an SES bounce subtype and diagnostic code into something readable on a
 * screen. The raw diagnostic ("smtp; 550 5.1.1 user unknown") is kept on the
 * row for anyone who needs it, but it is not what should be shown to somebody
 * deciding whether to delete a prospect.
 */
function describe(bounceType, subType, diagnostic) {
  const d = String(diagnostic || '').toLowerCase();

  if (/no such user|user unknown|unknown user|does not exist|recipient not found|5\.1\.1/.test(d)) {
    return 'Mailbox does not exist';
  }
  if (/domain|5\.1\.2|nxdomain|host or domain name not found/.test(d)) {
    return 'Domain not found';
  }
  if (/mailbox full|over quota|quota exceeded|5\.2\.2/.test(d)) {
    return 'Mailbox full';
  }
  if (/spam|blocked|blacklist|reputation|policy/.test(d)) {
    return 'Rejected as spam';
  }

  if (subType === 'NoEmail')      return 'Mailbox does not exist';
  if (subType === 'Suppressed')   return 'On the SES suppression list';
  if (subType === 'MailboxFull')  return 'Mailbox full';
  if (subType === 'OnAccountSuppressionList') return 'On the SES suppression list';

  return bounceType === 'Permanent' ? 'Permanently rejected' : 'Temporarily rejected';
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record one bounce or complaint against one address.
 *
 * `permanent` decides whether this kills the address immediately or only counts
 * towards SOFT_LIMIT. An address already marked dead stays dead — a later
 * transient bounce cannot resurrect it, because the mailbox not existing is not
 * something that becomes untrue.
 *
 * Attribution is only filled in when the row is created or when it is still
 * empty, so a second bounce years later does not overwrite the company name
 * from the send that actually died.
 */
function record({ email, permanent, reason, bounceType, subType, diagnostic, messageId }) {
  const e = normEmail(email);
  if (!e) return null;

  const existing = db.prepare('SELECT * FROM email_dead_addresses WHERE email = ?').get(e);

  if (!existing) {
    const who = attribute(e, messageId);
    db.prepare(`
      INSERT INTO email_dead_addresses
        (email, dead, reason, bounce_type, bounce_subtype, diagnostic, soft_count,
         source, company_name, contact_name, external_company_id, message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      e,
      permanent ? 1 : 0,
      reason,
      bounceType || null,
      subType || null,
      diagnostic ? String(diagnostic).slice(0, 500) : null,
      permanent ? 0 : 1,
      who.source,
      who.companyName,
      who.contactName,
      who.externalCompanyId,
      messageId || null,
    );
    return { email: e, dead: !!permanent, created: true };
  }

  const softCount = permanent ? existing.soft_count : existing.soft_count + 1;
  const nowDead = existing.dead === 1 || permanent || softCount >= SOFT_LIMIT;

  // An address that dies by accumulation gets its own wording. The last of
  // three temporary failures still describes itself as temporary, and
  // "Temporarily rejected" sitting on a permanently-dead row is the kind of
  // small contradiction that makes an operator distrust the whole screen.
  const shownReason = (!permanent && nowDead && existing.dead === 0)
    ? `Rejected ${softCount} times running`
    : reason;

  db.prepare(`
    UPDATE email_dead_addresses
       SET dead           = ?,
           soft_count     = ?,
           last_seen_at   = datetime('now'),
           reason         = CASE WHEN ? = 1 AND dead = 0 THEN ? ELSE reason END,
           bounce_type    = COALESCE(?, bounce_type),
           bounce_subtype = COALESCE(?, bounce_subtype),
           diagnostic     = COALESCE(?, diagnostic),
           message_id     = COALESCE(message_id, ?)
     WHERE email = ?
  `).run(
    nowDead ? 1 : 0,
    softCount,
    nowDead ? 1 : 0,
    shownReason,
    bounceType || null,
    subType || null,
    diagnostic ? String(diagnostic).slice(0, 500) : null,
    messageId || null,
    e,
  );

  // Attribution left empty on creation (an unmatched message id) is worth a
  // second attempt now — a later send to the same address may have landed a row
  // we can name it from.
  if (!existing.company_name && !existing.contact_name) {
    const who = attribute(e, messageId || existing.message_id);
    if (who.companyName || who.contactName || who.source) {
      db.prepare(`
        UPDATE email_dead_addresses
           SET source              = COALESCE(source, ?),
               company_name        = COALESCE(company_name, ?),
               contact_name        = COALESCE(contact_name, ?),
               external_company_id = COALESCE(external_company_id, ?)
         WHERE email = ?
      `).run(who.source, who.companyName, who.contactName, who.externalCompanyId, e);
    }
  }

  return { email: e, dead: nowDead, created: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read new SNS notifications out of the event log and record what they mean.
 *
 * Uses rowid as the cursor rather than `received_at`: rowid is assigned on
 * insert and strictly increasing, whereas two notifications arriving in the
 * same second share a timestamp and one of them would be skipped forever.
 *
 * `fromStart` replays the entire log. Safe to run repeatedly — recording is
 * idempotent per address for permanent bounces, and the whole point of a replay
 * is to pick up bounces from before this feature existed.
 *
 * Never throws. A malformed payload is skipped rather than stopping the pass,
 * because one bad row must not block every bounce behind it.
 */
export function reconcileBounces({ fromStart = false, limit = 5000 } = {}) {
  const from = fromStart ? 0 : readCursor();
  let rows = [];

  try {
    rows = db.prepare(`
      SELECT rowid, type, payload FROM email_sns_events
       WHERE rowid > ?
       ORDER BY rowid
       LIMIT ?
    `).all(from, limit);
  } catch (err) {
    console.error('[bounce] could not read event log:', err.message);
    return { scanned: 0, dead: 0, soft: 0 };
  }

  let dead = 0;
  let soft = 0;
  let maxRowid = from;

  for (const row of rows) {
    maxRowid = Math.max(maxRowid, row.rowid);

    try {
      const outer = JSON.parse(row.payload);
      if (outer?.Type !== 'Notification' || !outer.Message) continue;

      const msg = JSON.parse(outer.Message);
      const messageId = msg?.mail?.messageId || null;

      if (msg.notificationType === 'Bounce') {
        const bounceType = msg.bounce?.bounceType || null;
        const subType    = msg.bounce?.bounceSubType || null;
        const permanent  = bounceType === 'Permanent';

        for (const r of msg.bounce?.bouncedRecipients || []) {
          const diagnostic = r.diagnosticCode || null;
          const result = record({
            email: r.emailAddress,
            permanent,
            reason: describe(bounceType, subType, diagnostic),
            bounceType,
            subType,
            diagnostic,
            messageId,
          });
          if (result?.dead) dead++;
          else if (result) soft++;
        }
      }

      if (msg.notificationType === 'Complaint') {
        // A complaint is somebody pressing "this is spam". Stronger than a
        // bounce, not weaker: the mailbox works fine and the person does not
        // want to hear from us. Treated as permanent for that reason.
        for (const r of msg.complaint?.complainedRecipients || []) {
          const result = record({
            email: r.emailAddress,
            permanent: true,
            reason: 'Marked it as spam',
            bounceType: 'Complaint',
            subType: msg.complaint?.complaintFeedbackType || null,
            diagnostic: null,
            messageId,
          });
          if (result?.dead) dead++;
        }
      }
    } catch {
      continue;
    }
  }

  if (maxRowid > from) writeCursor(maxRowid);
  if (dead || soft) {
    console.log(`[bounce] reconciled ${rows.length} notification(s) — ${dead} dead, ${soft} soft`);
  }

  return { scanned: rows.length, dead, soft };
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Take an address off the screen. It stays dead and stays unmailable — this is
 * the same pattern as emptying the drafts bin, where the row keeps doing a job
 * after you have stopped looking at it.
 */
export function hideDead(email) {
  const e = normEmail(email);
  const res = db.prepare(`
    UPDATE email_dead_addresses
       SET hidden_at = datetime('now')
     WHERE email = ? AND hidden_at IS NULL
  `).run(e);
  return { ok: !!res.changes };
}

export function hideAllDead() {
  const res = db.prepare(`
    UPDATE email_dead_addresses
       SET hidden_at = datetime('now')
     WHERE dead = 1 AND hidden_at IS NULL
  `).run();
  if (res.changes) console.log(`[bounce] ${res.changes} dead address(es) cleared from the screen`);
  return res.changes;
}

/**
 * Erase an address's send history.
 *
 * WHAT GOES: every `service_email_sends` row for the address, and its mirrored
 * subscriber row. That is what the keep-warm audience is built from, so this is
 * what actually removes the person from Studio.
 *
 * WHAT STAYS, ON PURPOSE:
 *   - the dead row itself, so the address can never be mailed again. Without it
 *     the next introduction email to this address would re-create the send
 *     history and the person would be back in the audience as though new.
 *   - `keepwarm_recipients` rows from runs that have already gone. Those are the
 *     receipts for a send that really happened; deleting them would change the
 *     "40 sent, 2 failed" totals on past runs in the Sent tab, rewriting
 *     history rather than erasing a contact.
 *
 * Irreversible. The count of what went is returned so the screen can say what
 * it did rather than just claiming success.
 */
export function eraseHistory(email) {
  const e = normEmail(email);
  if (!e) return { ok: false, reason: 'no_email' };

  const row = db.prepare('SELECT 1 FROM email_dead_addresses WHERE email = ?').get(e);
  if (!row) return { ok: false, reason: 'not_dead' };

  let sends = 0;
  let subscribers = 0;

  const tx = db.transaction(() => {
    const s = db.prepare('DELETE FROM service_email_sends WHERE lower(to_email) = ?').run(e);
    sends = s.changes;

    try {
      const sub = db.prepare('DELETE FROM email_subscribers WHERE lower(email) = ?').run(e);
      subscribers = sub.changes;
    } catch { /* the list mirror is optional */ }

    db.prepare(`
      UPDATE email_dead_addresses
         SET erased_at = datetime('now'), hidden_at = COALESCE(hidden_at, datetime('now'))
       WHERE email = ?
    `).run(e);
  });

  tx();

  // Subscriber counts on any list this address was mirrored into are now one
  // too high. Recalculated rather than decremented, so a stale count from any
  // earlier cause is corrected at the same time.
  try {
    db.prepare(`
      UPDATE email_lists
         SET subscriber_count = (
           SELECT COUNT(*) FROM email_subscribers
            WHERE list_id = email_lists.id AND status = 'subscribed'
         )
    `).run();
  } catch { /* ignore */ }

  console.log(`[bounce] erased history for ${e} — ${sends} send row(s), ${subscribers} list row(s)`);
  return { ok: true, sends, subscribers };
}
