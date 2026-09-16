/**
 * server/services/keepwarm-store.js — keep-warm emails: audience, settings, drafts.
 *
 * WHAT KEEP-WARM IS
 * After Billy's cold call, WorkTrackr asks Studio to send the introduction
 * email (that is service-email-sender.js, a different feature). Keep-warm is
 * what happens afterwards: a short, useful email to those same people every
 * fortnight so Sweetbyte stays in mind while they are still deciding.
 *
 * WHERE THE AUDIENCE COMES FROM
 * Not from WorkTrackr's contact book. The audience is exactly the set of
 * addresses Studio has ALREADY successfully emailed — `service_email_sends`
 * rows with status 'sent'. Studio owns that table, so the address list needs no
 * network call and cannot drift.
 *
 * The one thing Studio cannot know on its own is the current sales stage, and
 * that is the whole point of the filter: a company that has gone dead must stop
 * receiving these. So stages are PULLED from WorkTrackr and cached in
 * `keepwarm_stages`, and the pull refreshes the whole table every time.
 *
 * WHY PULL RATHER THAN LET WORKTRACKR PUSH
 * A push is only ever as good as the last push that arrived. If one is lost to
 * a deploy or a network blip, the stale row stays stale forever and somebody
 * who went dead keeps getting mail. A full pull re-reads every stage each time,
 * so a missed update self-heals on the next refresh. The push hook in
 * WorkTrackr's contacts save still exists and still cancels follow-ups
 * immediately — the pull is the safety net underneath it, not a replacement.
 *
 * WHY THE STAGE FILTER IS A SETTING RATHER THAN A CONSTANT
 * Sending the introduction email does not set a stage in WorkTrackr; whoever
 * made the call ticks one by hand afterwards. That means the population of each
 * stage depends on somebody's habits, not on anything the code controls. If the
 * default rule turns out to exclude almost everybody, that needs to be fixable
 * from the screen in ten seconds rather than by a redeploy. `stageCounts()`
 * exists so the operator can see the consequence of the rule before applying it.
 *
 * SCHEMA LIVES HERE, NOT IN db.js
 * Same reasoning as service-email-sender.js: db.js is 2,100 lines shared by
 * every feature, so appending to it means reissuing the whole file for a
 * four-table change. These are CREATE TABLE IF NOT EXISTS run once at import —
 * identical idempotency, much smaller blast radius.
 *
 * Env: none of its own. Stages arrive over the bridge WorkTrackr already uses
 * for sending, which is authenticated by WORKTRACKR_SERVICE_EMAIL_SECRET — the
 * variable that is already set on both services and already working.
 */

import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { isSuppressed } from './service-email-sender.js';
import { deadReasonFor } from './bounce-store.js';
import { greetingFirstName } from './name-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS keepwarm_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS keepwarm_stages (
    external_company_id TEXT PRIMARY KEY,
    company_name        TEXT,
    primary_contact     TEXT,
    stage               TEXT,
    refreshed_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS keepwarm_batches (
    id          TEXT PRIMARY KEY,
    requested   INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'running',
    error       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS keepwarm_drafts (
    id           TEXT PRIMARY KEY,
    batch_id     TEXT,
    position     INTEGER NOT NULL DEFAULT 1,
    angle        TEXT,
    subject      TEXT NOT NULL,
    html_body    TEXT NOT NULL,
    plain_body   TEXT,
    status       TEXT NOT NULL DEFAULT 'draft',
    edited       INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at  TEXT,
    sent_at      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_kw_drafts_status ON keepwarm_drafts(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_kw_drafts_batch  ON keepwarm_drafts(batch_id, position);
`);

// Emptying the bin does not delete the row.
//
// A rejected draft is still doing a job after you have binned it: `previousSubjects`
// feeds every rejected subject back into the next generation as a do-not-repeat
// list. Delete the rows and the ideas you threw away start coming back a few
// batches later, which reads as the generator getting worse rather than as a
// consequence of tidying up.
//
// So "delete all" stamps deleted_at and the screen stops showing them, while the
// subject line goes on earning its keep.
try {
  const cols = db.prepare(`PRAGMA table_info(keepwarm_drafts)`).all().map(c => c.name);
  if (!cols.includes('deleted_at')) {
    db.exec(`ALTER TABLE keepwarm_drafts ADD COLUMN deleted_at TEXT`);
    console.log('[keepwarm] added deleted_at column');
  }
} catch (err) {
  console.error('[keepwarm] deleted_at migration failed:', err.message);
}

// Addresses put into the loop by hand.
//
// The loop is otherwise derived from service_email_sends: to be in it, Studio
// must have actually sent you an introduction email. That is a good rule and it
// stays — the alternative considered was writing fake 'sent' rows for people
// who were never emailed, which would have been a lie in the send history AND
// would have made Studio refuse to ever send them a real introduction, because
// queueServiceEmail skips anything already sent. Both are worse than a second
// table.
//
// So these rows say only what is true: somebody typed this address in. They
// feed the same audience, resolve their stage from WorkTrackr the same way, and
// the option to send a proper introduction later is untouched.
//
// The address is the primary key. Adding the same one twice is a no-op rather
// than a duplicate, which is what you want when a list gets pasted twice.
db.exec(`
  CREATE TABLE IF NOT EXISTS keepwarm_manual (
    email               TEXT PRIMARY KEY,
    external_company_id TEXT,
    company_name        TEXT,
    contact_name        TEXT,
    added_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Addresses taken out of the loop by hand.
//
// Why this exists rather than deleting the row: an address is in the loop for
// one of two reasons, and they need opposite treatment.
//
// A hand-typed row lives in keepwarm_manual and nothing else refers to it, so
// removing it really is a delete — and it has to be, because the address is
// then free to be pasted back in corrected, which is the whole point.
//
// An address that is in the loop because an introduction was actually sent is
// different: the row IS the send record. Deleting it would erase the email from
// the send history, break the counts on the Sent tab, and make the service
// email sender willing to send that person a SECOND introduction, because that
// sender decides by asking whether a send row already exists. Precisely the
// opposite of what removing somebody is meant to do.
//
// So for those, removal means hiding. The send record is untouched and the
// address is listed here; the audience skips anything in this table. Put them
// back and they rejoin with their history intact and no second introduction.
//
// Not the unsubscribe list, deliberately. Unsubscribes are one-way with no
// undo, and recording the operator tidying up a list as an opt-out would
// quietly inflate the opt-out figure — which is the number read as "the copy is
// landing badly".
db.exec(`
  CREATE TABLE IF NOT EXISTS keepwarm_removed (
    email      TEXT PRIMARY KEY,
    removed_at TEXT NOT NULL DEFAULT (datetime('now')),
    reason     TEXT
  );
`);

// The deliberate order of the approved queue.
//
// Until this existed, the Schedule tab was ordered by the moment you pressed
// Approve, which is not a decision about running order — it is a side effect of
// which draft you happened to read first. schedule_position records an order
// you actually chose.
//
// NULL means "no opinion", and sorts after everything numbered, in approval
// order. That is what every draft approved before this column existed holds,
// and what a newly approved one holds: it joins the back of the queue, which is
// exactly what it did before.
try {
  const cols = db.prepare(`PRAGMA table_info(keepwarm_drafts)`).all().map(c => c.name);
  if (!cols.includes('schedule_position')) {
    db.exec(`ALTER TABLE keepwarm_drafts ADD COLUMN schedule_position INTEGER`);
    console.log('[keepwarm] added schedule_position column');
  }
} catch (err) {
  console.error('[keepwarm] schedule_position migration failed:', err.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The stages that stay in the loop, as agreed with the operator: everyone who
 * has had the introduction email EXCEPT dead, customer, contacted, and anyone
 * with no stage set at all.
 *
 * `customer` is not in the list for a different reason from the other two — a
 * paying customer should be hearing from Sweetbyte through a different channel,
 * not receiving prospect nurture.
 */
export const ALL_STAGES = ['new', 'contacted', 'voicemail', 'prospect', 'hot_prospect', 'customer', 'dead'];

/**
 * Stages that can NEVER be put into the loop, whatever the settings say.
 *
 * `customer` is locked at the operator's instruction. Keep-warm copy is written
 * to win new business — "are you still on a long contract", "when did you last
 * test a restore". Sending that to somebody who has already bought is the worst
 * mistake this screen can make and it would not announce itself; it would come
 * back as a confused reply days later.
 *
 * This is enforced HERE rather than only by greying out the chip, because the
 * chip is one HTTP request away from being bypassed and the settings row
 * outlives any particular version of the screen. Anything already stored is
 * stripped on read as well as on write, so a value saved before this rule
 * existed cannot come back to life.
 *
 * If keep-warm-style emails to existing customers are ever wanted, that is a
 * separate audience with separate copy, not this list with one more tick.
 */
export const LOCKED_STAGES = ['customer'];

/**
 * The words shown on screen for each stage.
 *
 * These must match the column labels on the WorkTrackr pipeline board, not the
 * stored keys. WorkTrackr's phase 7 renamed the `new` column to "Suspect" as a
 * label-only change — the stored value stayed `new` so nothing had to be
 * migrated. Studio receives the key and has to translate it back, otherwise the
 * same 22 people are called "New" here and "Suspect" there.
 */
export const STAGE_LABELS = {
  new:          'Suspect',
  contacted:    'Contacted',
  voicemail:    'Voicemail',
  prospect:     'Prospect',
  hot_prospect: 'Hot prospect',
  customer:     'Customer',
  dead:         'Dead',
};

const DEFAULT_STAGES = ['new', 'voicemail', 'prospect', 'hot_prospect'];

const DEFAULTS = {
  stages: DEFAULT_STAGES,
  includeNoStage: false,
};

function readSetting(key) {
  const row = db.prepare('SELECT value FROM keepwarm_settings WHERE key = ?').get(key);
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

function writeSetting(key, value) {
  db.prepare(`
    INSERT INTO keepwarm_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, JSON.stringify(value));
}

export function getSettings() {
  const stored = readSetting('stages');
  const stages = (Array.isArray(stored)
    ? stored.filter(s => ALL_STAGES.includes(s))
    : DEFAULTS.stages
  ).filter(s => !LOCKED_STAGES.includes(s));

  const includeNoStage = readSetting('includeNoStage');

  return {
    stages,
    includeNoStage: typeof includeNoStage === 'boolean' ? includeNoStage : DEFAULTS.includeNoStage,
  };
}

/**
 * Saving an EMPTY stage list is allowed and means "nobody". That is a valid
 * thing to want — it is how the operator pauses the whole programme without
 * deleting anything — so it is not treated as a mistake and silently replaced
 * with the defaults. The screen shows the resulting count, so an accidental
 * empty list is visible immediately.
 */
export function saveSettings({ stages, includeNoStage }) {
  if (Array.isArray(stages)) {
    writeSetting(
      'stages',
      stages.filter(s => ALL_STAGES.includes(s) && !LOCKED_STAGES.includes(s)),
    );
  }
  if (typeof includeNoStage === 'boolean') {
    writeSetting('includeNoStage', includeNoStage);
  }
  return getSettings();
}

// ─────────────────────────────────────────────────────────────────────────────
// Stages, as pushed to us by WorkTrackr
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WorkTrackr sends stages here; Studio never goes and asks for them.
 *
 * That direction is not an accident and not laziness. WorkTrackr has been
 * calling Studio since the service-email panel shipped — the base URL and the
 * shared secret are configured and proven on that path. A pull would have meant
 * a second connection, pointing the other way, with its own base URL and its
 * own tenancy pin configured on two more services. Every one of those is a
 * thing that can be quietly wrong, and the failure looks identical to "nobody
 * is a prospect".
 *
 * The trade is that Studio cannot ask for a refresh on demand. WorkTrackr
 * pushes on every stage change and reconciles the whole set every half hour, so
 * the freshness is the same; what is lost is a button, and a button that only
 * ever confirms what already happened is not worth a second set of credentials.
 *
 * The write is arriving over the HMAC-signed bridge in routes/service-email-api.js.
 */

const RECEIPT_KEY = 'lastStageReceipt';

/**
 * Apply a batch of stages.
 *
 * `snapshot` is the important flag. A snapshot is WorkTrackr saying "this is
 * every company I have for you" — so anything Studio holds that is NOT in the
 * payload has been deleted over there, and its stage is cleared. Clearing it
 * rather than deleting the row keeps the person visible on the screen as "no
 * stage set", which is excluded by default: a company vanishing from WorkTrackr
 * fails towards not emailing them, which is the only safe direction.
 *
 * A non-snapshot batch is one company that just changed, and says nothing about
 * the companies it omits. Treating it as a snapshot would clear every stage in
 * the table every time somebody edited one record.
 */
export function applyStages({ companies, snapshot = false }) {
  const rows = Array.isArray(companies) ? companies.filter(c => c && c.id) : [];

  const upsert = db.prepare(`
    INSERT INTO keepwarm_stages (external_company_id, company_name, primary_contact, stage, refreshed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(external_company_id) DO UPDATE SET
      company_name    = excluded.company_name,
      primary_contact = excluded.primary_contact,
      stage           = excluded.stage,
      refreshed_at    = datetime('now')
  `);

  let cleared = 0;

  const tx = db.transaction((list) => {
    for (const c of list) {
      upsert.run(String(c.id), c.name || null, c.primaryContact || null, c.stage || null);
    }

    if (snapshot) {
      // Anything not mentioned in a complete payload no longer exists upstream.
      // Done as "not in this id set" rather than "older than this run" because a
      // timestamp comparison would also catch rows the same transaction just
      // wrote if the clock ticked mid-batch.
      const ids = list.map(c => String(c.id));
      if (ids.length === 0) {
        const r = db.prepare(`UPDATE keepwarm_stages SET stage = NULL WHERE stage IS NOT NULL`).run();
        cleared = r.changes;
      } else {
        const placeholders = ids.map(() => '?').join(',');
        const r = db.prepare(`
          UPDATE keepwarm_stages
             SET stage = NULL
           WHERE stage IS NOT NULL
             AND external_company_id NOT IN (${placeholders})
        `).run(...ids);
        cleared = r.changes;
      }
    }
  });
  tx(rows);

  writeSetting(RECEIPT_KEY, {
    at: new Date().toISOString(),
    count: rows.length,
    snapshot: !!snapshot,
  });

  console.log(`[keepwarm] stages received: ${rows.length} company/companies${snapshot ? ` (snapshot, ${cleared} cleared)` : ''}`);
  return { applied: rows.length, cleared, snapshot: !!snapshot };
}

/**
 * When WorkTrackr last told us anything, and how many companies we hold.
 * A null `at` means WorkTrackr has never pushed — which is the difference
 * between "everyone genuinely has no stage" and "the two services have never
 * spoken", and the screen says so in those words.
 */
export function lastStageRefresh() {
  const receipt = readSetting(RECEIPT_KEY) || {};
  const row = db.prepare(`
    SELECT COUNT(*) AS n,
           SUM(CASE WHEN stage IS NOT NULL THEN 1 ELSE 0 END) AS staged
      FROM keepwarm_stages
  `).get();

  return {
    at: receipt.at || null,
    lastCount: receipt.count || 0,
    wasSnapshot: !!receipt.snapshot,
    held: row?.n || 0,
    withStage: row?.staged || 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audience
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everyone Studio has successfully emailed, one row per address, newest send
 * first, with the company's current stage attached.
 *
 * GROUPED BY ADDRESS, NOT BY ROW. `service_email_sends` holds one row per
 * email, so a prospect who got the introduction and a follow-up has two rows.
 * Grouping on the lowercased address is what stops the same person appearing
 * (and later being mailed) twice.
 *
 * MAX(created_at) picks the most recent send; the accompanying company id and
 * name are read back from that same newest row. SQLite's bare-column rule makes
 * this well-defined: in a query with a single MAX() aggregate, the other bare
 * columns come from the row that produced the maximum. It is a SQLite-specific
 * guarantee rather than standard SQL, which is worth knowing before this query
 * is ever ported anywhere else.
 *
 * A LEFT JOIN on the stage cache, not an inner one — an address whose company
 * has no cached stage row at all (deleted in WorkTrackr, or the cache has never
 * been filled) must still be visible on the screen as "no stage" rather than
 * vanishing without explanation.
 */
function rawAudience() {
  // Everyone Studio has actually emailed.
  const sent = db.prepare(`
    SELECT
      lower(s.to_email)        AS email,
      MAX(s.created_at)        AS last_sent_at,
      s.external_company_id    AS external_company_id,
      s.company_name           AS sent_company_name,
      s.contact_name           AS contact_name,
      s.referrer_name          AS referrer_name,
      k.company_name           AS live_company_name,
      k.primary_contact        AS primary_contact,
      k.stage                  AS stage
    FROM service_email_sends s
    LEFT JOIN keepwarm_stages k
      ON k.external_company_id = s.external_company_id
    WHERE s.status = 'sent'
      AND s.to_email IS NOT NULL
      AND trim(s.to_email) != ''
    GROUP BY lower(s.to_email)
  `).all();

  // Everyone typed in by hand. Same shape, same stage lookup, so project() and
  // everything downstream cannot tell the difference except where it matters.
  const manual = db.prepare(`
    SELECT
      lower(m.email)           AS email,
      NULL                     AS last_sent_at,
      m.added_at               AS added_at,
      m.external_company_id    AS external_company_id,
      m.company_name           AS sent_company_name,
      m.contact_name           AS contact_name,
      NULL                     AS referrer_name,
      k.company_name           AS live_company_name,
      -- Deliberately NOT k.primary_contact.
      --
      -- For somebody Studio has emailed, falling back to WorkTrackr's live
      -- contact name is reasonable: there was a conversation, and the name on
      -- the record is probably the person who had it.
      --
      -- For a hand-typed address it is actively dangerous, and it went wrong
      -- immediately. Eltham Welding has three addresses in the notes —
      -- debbie@, sales@ and timo@ — and WorkTrackr's primary contact for the
      -- company is Timo Simpson. So all three greeted as "Hi Timo,", including
      -- Debbie's own address and a shared sales mailbox. Across the 192
      -- addresses added from the notes, 142 would have greeted the wrong
      -- person.
      --
      -- An address written in a note belongs to whoever it belongs to, and the
      -- company's main contact is not evidence about that. So a hand-typed row
      -- greets using the name typed in beside it and nothing else. No name
      -- means "Hi there," — which is the correct thing to say to sales@ anyway.
      NULL                     AS primary_contact,
      k.stage                  AS stage
    FROM keepwarm_manual m
    LEFT JOIN keepwarm_stages k
      ON k.external_company_id = m.external_company_id
  `).all();

  // A real send wins over a hand-typed row for the same address. That happens
  // the day somebody added by hand is finally sent a proper introduction: from
  // then on the send record is the truth about them, and the row stops being
  // marked as added by hand.
  const byEmail = new Map();
  for (const row of manual) byEmail.set(row.email, row);
  for (const row of sent)   byEmail.set(row.email, { ...(byEmail.get(row.email) || {}), ...row });

  return [...byEmail.values()].sort((a, b) =>
    String(b.last_sent_at || b.added_at || '').localeCompare(String(a.last_sent_at || a.added_at || '')));
}

function project(row) {
  return {
    email:             row.email,
    contactName:       row.contact_name || row.primary_contact || null,
    referrerName:      row.referrer_name || null,
    // What the email will actually say. Resolved once, here, so the list on
    // screen and the email that goes out can never disagree about it.
    greeting:          greetingFirstName(
                         row.contact_name || row.primary_contact || null,
                         row.referrer_name || null,
                       ),
    companyName:       row.live_company_name || row.sent_company_name || null,
    externalCompanyId: row.external_company_id || null,
    stage:             row.stage || null,
    stageLabel:        row.stage ? (STAGE_LABELS[row.stage] || row.stage) : 'No stage',
    lastSentAt:        row.last_sent_at || null,
    // Never emailed by Studio, so there is no send history behind them. Shown
    // on screen because "why has this person had nothing from us?" is a fair
    // question to be able to answer from the list.
    addedByHand:       !row.last_sent_at,
    addedAt:           row.added_at || null,
  };
}

/**
 * How many emailed addresses sit at each stage. This is the number the operator
 * looks at before committing to a stage rule — the point of showing it is that
 * "contacted: 340, prospect: 6" is an immediately obvious problem, whereas a
 * bare audience total of 6 looks like a bug.
 *
 * Suppressed addresses are excluded from these counts as well as from the
 * audience, because a count that includes people who can never be mailed would
 * make the rule look more generous than it is.
 */
export function stageCounts() {
  const counts = {};
  for (const s of ALL_STAGES) counts[s] = 0;
  counts.__none = 0;
  let suppressed = 0;
  let dead = 0;
  let removed = 0;

  for (const row of rawAudience()) {
    // Dead is checked first because isSuppressed() now returns true for a dead
    // address as well as an opted-out one. Checked the other way round, every
    // bounced address would be counted as an unsubscribe, and the opt-out
    // figure is one the operator reads as "the copy is landing badly".
    if (deadReasonFor(row.email)) { dead++; continue; }
    if (isSuppressed(row.email)) { suppressed++; continue; }
    // Taken out by hand. Counted separately rather than against a stage,
    // because the stage chips are there to answer "how generous is my rule",
    // and somebody deliberately taken out is not evidence about that.
    if (isRemovedFromLoop(row.email)) { removed++; continue; }
    const key = row.stage && ALL_STAGES.includes(row.stage) ? row.stage : '__none';
    counts[key] = (counts[key] || 0) + 1;
  }

  return { counts, suppressed, dead, removed };
}

/**
 * The people who would actually receive the next keep-warm email under the
 * current rule.
 *
 * Suppression is checked here rather than joined in SQL because `isSuppressed`
 * spans two tables with different keying rules and deliberately ignores the
 * per-client scoping on one of them. Reimplementing that as a join would give
 * two subtly different definitions of "opted out", and the one that quietly
 * disagreed would be the one that mailed somebody who had asked us not to.
 */
export function buildAudience() {
  const { stages, includeNoStage } = getSettings();
  const allowed = new Set(stages);

  const included = [];
  const excluded = [];

  for (const row of rawAudience()) {
    const p = project(row);

    // Same ordering rule as stageCounts: a dead address is also suppressed, so
    // asking the wrong question first would label every bounce "unsubscribed".
    const deadWhy = deadReasonFor(p.email);
    if (deadWhy) {
      excluded.push({ ...p, reason: `bounced — ${deadWhy.toLowerCase()}`, dead: true });
      continue;
    }
    if (isSuppressed(p.email)) {
      excluded.push({ ...p, reason: 'unsubscribed' });
      continue;
    }
    // Checked after bounced and unsubscribed on purpose. Somebody who bounced
    // and was also taken out by hand should read as bounced, because putting
    // them back would not make them mailable and a Put back link that appears
    // to do nothing is worse than no link.
    if (isRemovedFromLoop(p.email)) {
      excluded.push({ ...p, reason: 'removed by hand', removedByHand: true });
      continue;
    }
    if (!p.stage) {
      if (includeNoStage) included.push(p);
      else excluded.push({ ...p, reason: 'no stage set' });
      continue;
    }
    if (!allowed.has(p.stage)) {
      excluded.push({ ...p, reason: `stage is ${p.stageLabel.toLowerCase()}` });
      continue;
    }
    included.push(p);
  }

  return { included, excluded };
}

// ─────────────────────────────────────────────────────────────────────────────
// Drafts
// ─────────────────────────────────────────────────────────────────────────────

export function createBatch(requested) {
  const id = uuid();
  db.prepare('INSERT INTO keepwarm_batches (id, requested) VALUES (?, ?)').run(id, requested);
  return id;
}

export function finishBatch(id, error = null) {
  db.prepare(`
    UPDATE keepwarm_batches
       SET status = ?, error = ?, finished_at = datetime('now')
     WHERE id = ?
  `).run(error ? 'failed' : 'done', error ? String(error).slice(0, 500) : null, id);
}

export function insertDrafts(batchId, drafts) {
  const stmt = db.prepare(`
    INSERT INTO keepwarm_drafts (id, batch_id, position, angle, subject, html_body, plain_body)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    rows.forEach((d, i) => {
      stmt.run(uuid(), batchId, i + 1, d.angle || null, d.subject, d.html, d.plain || null);
    });
  });
  tx(drafts);
  return drafts.length;
}

export function listDrafts({ status = null, limit = 100 } = {}) {
  // deleted_at IS NULL is not optional here — an emptied bin must stay empty on
  // every filter, including "all".
  const where = status
    ? 'WHERE deleted_at IS NULL AND status = ?'
    : 'WHERE deleted_at IS NULL';
  const params = status ? [status, limit] : [limit];
  return db.prepare(`
    SELECT id, batch_id, position, angle, subject, html_body, plain_body,
           status, edited, created_at, approved_at, sent_at
      FROM keepwarm_drafts
      ${where}
     ORDER BY created_at DESC, position ASC
     LIMIT ?
  `).all(...params);
}

/**
 * Empty the bin. Returns how many were cleared.
 *
 * Only ever touches rejected drafts. A draft that is merely unreviewed is not
 * rubbish — it is work nobody has looked at yet — and approved or sent ones are
 * obviously off limits.
 */
export function emptyBin() {
  const res = db.prepare(`
    UPDATE keepwarm_drafts
       SET deleted_at = datetime('now')
     WHERE status = 'rejected' AND deleted_at IS NULL
  `).run();
  if (res.changes) console.log(`[keepwarm] bin emptied — ${res.changes} draft(s) cleared`);
  return res.changes;
}

export function getDraft(id) {
  return db.prepare('SELECT * FROM keepwarm_drafts WHERE id = ?').get(id);
}

/**
 * Editing a draft clears any approval it already had. Approving is a statement
 * about a specific piece of text; once the text changes the statement no longer
 * refers to anything, and silently keeping the tick would mean an email could
 * go out in wording nobody ever read.
 */
export function updateDraft(id, { subject, html }) {
  const row = getDraft(id);
  if (!row) return null;
  if (row.status === 'sent') return { error: 'already_sent' };

  db.prepare(`
    UPDATE keepwarm_drafts
       SET subject     = COALESCE(?, subject),
           html_body   = COALESCE(?, html_body),
           edited      = 1,
           status      = CASE WHEN status = 'approved' THEN 'draft' ELSE status END,
           approved_at = NULL
     WHERE id = ?
  `).run(subject ?? null, html ?? null, id);

  return getDraft(id);
}

/**
 * Parse a pasted block into rows, and say what could not be read.
 *
 * The paste is deliberately forgiving about column order, because the realistic
 * input is a copy out of a spreadsheet or a list typed by hand, and a format
 * that has to be exactly right is a format that gets pasted wrongly.
 *
 * Per line: the token containing an @ is the address, a token shaped like a
 * WorkTrackr id is the company id, and whatever is left over is read as company
 * name then contact name. Tabs, commas and runs of spaces all separate.
 *
 * An address on its own is accepted. It goes in with no company id, which means
 * no sales stage — and no stage means excluded from the loop unless the "No
 * stage set" chip is ticked. Refusing the line outright would be unhelpful, and
 * accepting it silently would leave somebody wondering where they went, so the
 * count comes back separately for the screen to warn about.
 */
export function parseManualPaste(text) {
  const UUIDISH  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const EMAILISH = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const rows = [];
  const unreadable = [];

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // Tabs, commas, semicolons and runs of two or more spaces are treated as
    // column separators, which covers a paste out of a spreadsheet and a list
    // typed by hand.
    const columns = line.split(/\t|,|;|\s{2,}/).map(t => t.trim()).filter(Boolean);

    // A line with no separators at all — "Anna Smith anna@sentek.co.uk". The
    // address is still findable, but which of the loose words is a company and
    // which is a person is a guess, and guessing wrong means greeting somebody
    // as "Hi Leigh," when Leigh is half the company name. So an undelimited
    // line gives up its addresses and nothing else.
    const delimited = columns.length > 1;
    const tokens = delimited ? columns : line.split(/\s+/);

    const emails = tokens.filter(t => EMAILISH.test(t)).map(t => t.toLowerCase());
    if (!emails.length) { unreadable.push(line.slice(0, 120)); continue; }

    const companyId = tokens.find(t => UUIDISH.test(t)) || null;
    const words = delimited
      ? tokens.filter(t => !EMAILISH.test(t) && !UUIDISH.test(t))
      : [];

    // More than one address on a line is read as several people at the same
    // company, which is what it means in practice when two addresses get
    // written down side by side.
    for (const email of emails) {
      rows.push({
        email,
        companyId,
        companyName: words[0] || null,
        contactName: words[1] || null,
      });
    }
  }
  return { rows, unreadable };
}

/**
 * Add addresses to the loop by hand.
 *
 * Every reason for skipping is reported rather than counted, because "23 added,
 * 9 skipped" invites the question which nine, and the answer matters: already
 * in the loop is fine, unsubscribed is a legal position, and bounced means the
 * address is dead and the row would have been pointless.
 *
 * Checked against Studio's own records, not against whatever list the paste
 * came from. That is the whole point of doing it here.
 */
export function addManualToLoop(text) {
  const { rows, unreadable } = parseManualPaste(text);

  const hasSend = db.prepare(`
    SELECT 1 FROM service_email_sends
     WHERE lower(to_email) = ? AND status = 'sent' LIMIT 1
  `);
  const hasManual = db.prepare('SELECT 1 FROM keepwarm_manual WHERE email = ?');
  const isHidden = db.prepare('SELECT 1 FROM keepwarm_removed WHERE email = ?');
  const unhide = db.prepare('DELETE FROM keepwarm_removed WHERE email = ?');
  const insert = db.prepare(`
    INSERT INTO keepwarm_manual (email, external_company_id, company_name, contact_name)
    VALUES (?, ?, ?, ?)
  `);

  const added = [];
  const restored = [];
  const skipped = [];
  const seen = new Set();

  const run = db.transaction(() => {
    for (const r of rows) {
      if (seen.has(r.email)) { skipped.push({ ...r, reason: 'listed twice in the paste' }); continue; }
      seen.add(r.email);

      const deadWhy = deadReasonFor(r.email);
      if (deadWhy)                  { skipped.push({ ...r, reason: `bounced — ${deadWhy.toLowerCase()}` }); continue; }
      if (isSuppressed(r.email))    { skipped.push({ ...r, reason: 'unsubscribed' }); continue; }

      // Somebody taken out of the loop by hand, being pasted back in. Pasting
      // is how you put a corrected line in, so it has to be how you put a
      // person back too — otherwise removing a sent contact is a one-way door
      // and the paste just says "already in the loop" for ever.
      if (isHidden.get(r.email)) {
        unhide.run(r.email);
        if (!hasSend.get(r.email) && !hasManual.get(r.email)) {
          insert.run(r.email, r.companyId, r.companyName, r.contactName);
        }
        restored.push(r);
        continue;
      }

      if (hasSend.get(r.email))     { skipped.push({ ...r, reason: 'already in the loop' }); continue; }
      if (hasManual.get(r.email))   { skipped.push({ ...r, reason: 'already added by hand' }); continue; }

      insert.run(r.email, r.companyId, r.companyName, r.contactName);
      added.push(r);
    }
  });
  run();

  return {
    added:      added.length,
    restored:   restored.length,
    skipped,
    unreadable,
    // Added, but with no company id, so no sales stage. The screen warns about
    // these because they will not appear in the loop by default.
    noCompanyId: added.filter(r => !r.companyId).length,
  };
}

/** Remove a hand-typed address. Nothing else is touched. */
export function removeManual(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return { error: 'no_email' };
  const res = db.prepare('DELETE FROM keepwarm_manual WHERE email = ?').run(e);
  return { ok: true, removed: res.changes };
}

/**
 * Remove every hand-typed address at once.
 *
 * Exists because the first paste put 192 of them in and the greeting on 142 was
 * wrong. Taking those out one row at a time is not a realistic thing to ask.
 */
export function removeAllManual() {
  const res = db.prepare('DELETE FROM keepwarm_manual').run();
  return { ok: true, removed: res.changes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Taking somebody out of the loop
// ─────────────────────────────────────────────────────────────────────────────

/** Is this address currently hidden from the loop by hand? */
export function isRemovedFromLoop(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  return !!db.prepare('SELECT 1 FROM keepwarm_removed WHERE email = ?').get(e);
}

/**
 * What the confirmation box needs to say before anything is removed.
 *
 * The point of asking is not to slow the operator down — it is that the two
 * kinds of removal have genuinely different consequences, and which one applies
 * is not visible on the row. A row that says "added by hand" is a clean delete;
 * a row that looks identical but has a send behind it is not. The box has to
 * say which, in words, before the button is pressed.
 */
export function loopRemovalInfo(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return { error: 'no_email' };

  const intro = db.prepare(`
    SELECT MIN(sent_at) AS first_sent_at, COUNT(*) AS n
      FROM service_email_sends
     WHERE lower(to_email) = ? AND status = 'sent'
  `).get(e);

  const keepWarm = db.prepare(`
    SELECT COUNT(*) AS n, MAX(sent_at) AS last_sent_at
      FROM keepwarm_recipients
     WHERE lower(email) = ? AND status = 'sent'
  `).get(e);

  const manual = db.prepare(`
    SELECT company_name, contact_name FROM keepwarm_manual WHERE email = ?
  `).get(e);

  const row = rawAudience().find(r => r.email === e);
  const p = row ? project(row) : null;

  const introCount = intro?.n || 0;

  return {
    email:          e,
    contactName:    p?.contactName || manual?.contact_name || null,
    companyName:    p?.companyName || manual?.company_name || null,
    addedByHand:    !!manual,
    introSent:      introCount > 0,
    introSentAt:    intro?.first_sent_at || null,
    introCount,
    keepWarmSent:   keepWarm?.n || 0,
    keepWarmLastAt: keepWarm?.last_sent_at || null,
    alreadyRemoved: isRemovedFromLoop(e),
    // What pressing the button will actually do. Decided here rather than on
    // the screen, so the wording in the box and the behaviour behind it cannot
    // drift apart.
    action:         introCount > 0 ? 'hide' : 'delete',
  };
}

/**
 * Take an address out of the loop.
 *
 * Two behaviours under one button, chosen by whether anything was ever sent:
 *
 *   nothing sent — the row only exists because it was typed in, so it is
 *     deleted outright and the address is free to be pasted back in corrected.
 *
 *   an introduction was sent — the send record stays exactly where it is and
 *     the address is hidden instead. The history is intact, the Sent tab is
 *     unchanged, and the service email sender still refuses to introduce them
 *     a second time. Put them back and they rejoin with no new introduction.
 *
 * The hand-typed row is deleted in both cases. Where there is a send behind it
 * the manual row was never the thing keeping them in the loop anyway, and
 * leaving it would mean the address stayed blocked from a corrected paste.
 */
export function removeFromLoop(email, reason = null) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return { error: 'no_email' };

  const info = loopRemovalInfo(e);

  const run = db.transaction(() => {
    const manual = db.prepare('DELETE FROM keepwarm_manual WHERE email = ?').run(e);
    let hidden = 0;
    if (info.introSent) {
      hidden = db.prepare(`
        INSERT INTO keepwarm_removed (email, reason) VALUES (?, ?)
        ON CONFLICT(email) DO UPDATE SET removed_at = datetime('now'), reason = excluded.reason
      `).run(e, reason).changes;
    }
    return { manualDeleted: manual.changes, hidden };
  });

  const res = run();
  return { ok: true, action: info.action, ...res, info };
}

/**
 * Put a hidden address back into the loop.
 *
 * Only ever undoes a hide. There is nothing to undo for a deleted hand-typed
 * row — that address is free, and putting it back means pasting it again, which
 * is the same thing the operator would do to correct it.
 */
export function restoreToLoop(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return { error: 'no_email' };
  const res = db.prepare('DELETE FROM keepwarm_removed WHERE email = ?').run(e);
  return { ok: true, restored: res.changes };
}

/** Everyone added by hand, newest first, for the "By hand" list. */
export function listManual() {
  const rows = db.prepare(`
    SELECT lower(m.email) AS email, m.company_name AS sent_company_name,
           m.contact_name, m.added_at, m.external_company_id,
           k.company_name AS live_company_name,
           -- Same reason as in rawAudience: never the company's primary
           -- contact. The list on screen has to show the greeting the email
           -- will actually use, or checking it is pointless.
           NULL AS primary_contact, k.stage,
           NULL AS last_sent_at, NULL AS referrer_name
      FROM keepwarm_manual m
      LEFT JOIN keepwarm_stages k ON k.external_company_id = m.external_company_id
     ORDER BY m.added_at DESC, m.email ASC
  `).all();
  return rows.map(project);
}

/**
 * How the approved queue is ordered, everywhere.
 *
 * Exported as a string rather than written out twice because the Schedule tab
 * and the up/down arrows have to agree about what "the one above" means. Two
 * copies of an ORDER BY is how an arrow moves a draft past the wrong neighbour.
 */
export const SCHEDULE_ORDER =
  'COALESCE(schedule_position, 1000000) ASC, COALESCE(approved_at, created_at) ASC';

/**
 * Move an approved draft one place up or down the schedule.
 *
 * Every row in the queue is renumbered on every move, not just the two that
 * swapped. It is a handful of rows and it means the queue is always fully
 * numbered afterwards — never a mix of numbered rows and NULLs, which is the
 * state that makes the next move behave unpredictably.
 *
 * The order is read back from the database rather than trusted from the
 * browser. The screen may have been drawn before a draft was approved, sent or
 * un-approved somewhere else, and an arrow press is a request to move this
 * draft relative to what is actually in the queue now.
 */
export function moveDraftInSchedule(id, direction) {
  if (!['up', 'down'].includes(direction)) return { error: 'bad_direction' };

  const ids = db.prepare(`
    SELECT id FROM keepwarm_drafts
     WHERE status = 'approved'
     ORDER BY ${SCHEDULE_ORDER}
  `).all().map(r => r.id);

  const from = ids.indexOf(id);
  if (from < 0) return { error: 'not_in_schedule' };

  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return { error: 'at_end' };

  [ids[from], ids[to]] = [ids[to], ids[from]];

  const upd = db.prepare('UPDATE keepwarm_drafts SET schedule_position = ? WHERE id = ?');
  db.transaction(() => ids.forEach((rowId, idx) => upd.run(idx + 1, rowId)))();

  return { ok: true, order: ids };
}

export function setDraftStatus(id, status) {
  if (!['draft', 'approved', 'rejected'].includes(status)) return { error: 'bad_status' };
  const row = getDraft(id);
  if (!row) return null;
  if (row.status === 'sent') return { error: 'already_sent' };

  // Leaving the approved queue clears the chosen position as well. Otherwise a
  // draft removed from the schedule and approved again weeks later would jump
  // back to the slot it used to hold, which is a decision nobody made twice.
  db.prepare(`
    UPDATE keepwarm_drafts
       SET status            = ?,
           approved_at       = CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END,
           schedule_position = CASE WHEN ? = 'approved' THEN schedule_position ELSE NULL END
     WHERE id = ?
  `).run(status, status, status, id);

  return getDraft(id);
}

/**
 * Subjects and angles already used, newest first. Fed back into the generator
 * so a later batch cannot rewrite an email that has already gone out. Rejected
 * drafts are included on purpose: the operator turning one down is a signal
 * that angle did not land, and offering it again wastes their time.
 */
export function previousSubjects(limit = 30) {
  return db.prepare(`
    SELECT subject, angle, status
      FROM keepwarm_drafts
     WHERE status IN ('approved', 'sent', 'rejected')
     ORDER BY created_at DESC
     LIMIT ?
  `).all(limit);
}
