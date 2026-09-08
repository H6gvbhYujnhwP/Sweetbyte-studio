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

export const STAGE_LABELS = {
  new:          'New',
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
  return db.prepare(`
    SELECT
      lower(s.to_email)        AS email,
      MAX(s.created_at)        AS last_sent_at,
      s.external_company_id    AS external_company_id,
      s.company_name           AS sent_company_name,
      s.contact_name           AS contact_name,
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
    ORDER BY MAX(s.created_at) DESC
  `).all();
}

function project(row) {
  return {
    email:             row.email,
    contactName:       row.contact_name || row.primary_contact || null,
    companyName:       row.live_company_name || row.sent_company_name || null,
    externalCompanyId: row.external_company_id || null,
    stage:             row.stage || null,
    stageLabel:        row.stage ? (STAGE_LABELS[row.stage] || row.stage) : 'No stage',
    lastSentAt:        row.last_sent_at || null,
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

  for (const row of rawAudience()) {
    if (isSuppressed(row.email)) { suppressed++; continue; }
    const key = row.stage && ALL_STAGES.includes(row.stage) ? row.stage : '__none';
    counts[key] = (counts[key] || 0) + 1;
  }

  return { counts, suppressed };
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

    if (isSuppressed(p.email)) {
      excluded.push({ ...p, reason: 'unsubscribed' });
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
  const where = status ? 'WHERE status = ?' : '';
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

export function setDraftStatus(id, status) {
  if (!['draft', 'approved', 'rejected'].includes(status)) return { error: 'bad_status' };
  const row = getDraft(id);
  if (!row) return null;
  if (row.status === 'sent') return { error: 'already_sent' };

  db.prepare(`
    UPDATE keepwarm_drafts
       SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END
     WHERE id = ?
  `).run(status, status, id);

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
