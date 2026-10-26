/**
 * server/services/keepwarm-subjects.js — the operator's own subject lines.
 *
 * WHAT THIS IS FOR
 * Studio invents subject lines itself, and they are competent. They are not
 * Billy's. "Has your printer won the argument today?" is a voice a machine
 * writing to a brief does not reach for. This is somewhere to keep lines
 * written by a person, and to have an email built around one of them, word for
 * word, rather than reworded into something blander.
 *
 * WHY "USED" IS DERIVED RATHER THAN STORED
 * The rule the operator asked for is that a line is never used twice. The
 * obvious implementation is a used_at column set when something is generated —
 * and it is wrong, because generating is not using. Nine drafts get written and
 * two get approved; the other seven lines would be burnt for nothing.
 *
 * So nothing is written here at send time at all. A line counts as used when a
 * RUN THAT ACTUALLY WENT carries that subject, and counts as spoken-for when a
 * live draft carries it. Both are read out of the tables that already hold that
 * truth. Consequences fall out for free rather than needing code: reject a
 * draft and its line returns to the pool, undo a send inside the ten seconds
 * and the run never reaches 'sent' so the line was never used, empty the bin
 * and nothing changes because the line was never marked in the first place.
 *
 * The matching is on the subject text. That is why a draft generated from a
 * line must keep the line word for word — which is what the operator asked for
 * anyway, so the constraint and the requirement are the same constraint.
 *
 * SCHEMA LIVES HERE, NOT IN db.js
 * Same reasoning as keepwarm-store.js and service-email-sender.js: one small
 * table next to the code that owns it, rather than appending to the 2,100-line
 * file every feature shares.
 *
 * Env: none.
 */

import { v4 as uuid } from 'uuid';
import db from '../db.js';

// Matches the slice applied to generated subjects in keepwarm-generator.js, so
// a line cannot be stored in a length that a draft could never carry.
const MAX_LEN = 200;

// A paste of the whole list at once is the normal way this gets filled. The cap
// is there so a mis-paste of an entire document fails visibly rather than
// filling the table.
const MAX_PER_PASTE = 50;

db.exec(`
  CREATE TABLE IF NOT EXISTS keepwarm_subject_ideas (
    id         TEXT PRIMARY KEY,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_kw_ideas_live ON keepwarm_subject_ideas(deleted_at, created_at);
`);

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ─────────────────────────────────────────────────────────────────────────────
// Which kind of email a line is for
// ─────────────────────────────────────────────────────────────────────────────
//
// Every line now carries a type: NULL for a General email (everyone in the
// loop), or a service-lane key such as 'website'. Ticking a Website line writes
// a Website email that only goes to the Website people.
//
// `lane_suggested` = 1 means Studio guessed the type from the wording and the
// operator has not looked at it yet. The screen marks those "suggested" until
// the type is changed by hand or "These look right" is pressed.
//
// Lane keys are checked against the real list in the routes file, which owns
// INTEREST_KEYS; this file stores what it is given.

// Studio's guess, from the words in the line. First match wins, so the more
// specific services come before the broad ones: "When the Wi-Fi is slow but
// the line is fast" is a Wi-Fi line, not a broadband one.
const SUGGEST_RULES = [
  ['cyber_security', /cyber|secur|hack|phish|scam|dodgy email|password|ransom|virus|malware/i],
  ['wifi',           /wi-?fi|wireless/i],
  ['website',        /web ?site|shop window|\bseo\b|online presence/i],
  ['domains',        /domain|hosting|\bdns\b/i],
  ['microsoft_365',  /microsoft|office 365|\bm365\b|outlook|\bteams\b|office licen|sharepoint|onedrive/i],
  ['voip',           /phone|voip|telephon|\bcalls?\b|switchboard/i],
  ['internet',       /broadband|internet|fib(re|er)|connection|\bline\b/i],
  ['custom_apps',    /\bapps?\b|software|automat|spreadsheet|manual task|workflow/i],
];

export function suggestLane(text) {
  const t = String(text || '');
  for (const [key, re] of SUGGEST_RULES) if (re.test(t)) return key;
  return null;
}

// Added after the table existed. On the first start with these columns, every
// line already there gets Studio's guess and is marked suggested, so the
// operator checks them once rather than sorting thirty-odd lines by hand.
try {
  const cols = db.prepare(`PRAGMA table_info(keepwarm_subject_ideas)`).all().map(c => c.name);
  if (!cols.includes('lane')) {
    db.exec(`ALTER TABLE keepwarm_subject_ideas ADD COLUMN lane TEXT`);
    db.exec(`ALTER TABLE keepwarm_subject_ideas ADD COLUMN lane_suggested INTEGER NOT NULL DEFAULT 0`);
    const rows = db.prepare(`SELECT id, text FROM keepwarm_subject_ideas`).all();
    const upd = db.prepare(`UPDATE keepwarm_subject_ideas SET lane = ?, lane_suggested = 1 WHERE id = ?`);
    db.transaction(() => { for (const r of rows) upd.run(suggestLane(r.text), r.id); })();
    console.log(`[keepwarm] subject lines: added types, suggested for ${rows.length} line(s)`);
  }
} catch (err) {
  console.error('[keepwarm] subject line type migration failed:', err.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every line, with its state worked out from the drafts and runs tables.
 *
 *   unused    — free to pick
 *   in drafts — a live draft already carries it; picking it again would write
 *               the same email twice
 *   sent      — an email with this subject has gone out. Finished.
 *
 * The two EXISTS clauses are wrapped because keepwarm_runs and keepwarm_drafts
 * are created by other modules at import time, and on a brand-new database this
 * can run first. A missing table means "nothing has been sent yet", which is
 * true, so the fallback is to report everything as unused rather than to fail.
 */
export function listIdeas() {
  let rows;
  try {
    rows = db.prepare(`
      SELECT
        i.id,
        i.text,
        i.created_at,
        i.lane,
        i.lane_suggested,
        EXISTS (
          SELECT 1 FROM keepwarm_runs r
           WHERE r.status = 'sent' AND r.subject = i.text
        ) AS sent,
        EXISTS (
          SELECT 1 FROM keepwarm_drafts d
           WHERE d.subject = i.text
             AND d.status IN ('draft', 'approved')
             AND d.deleted_at IS NULL
        ) AS in_drafts
      FROM keepwarm_subject_ideas i
      WHERE i.deleted_at IS NULL
      ORDER BY i.created_at ASC
    `).all();
  } catch {
    rows = db.prepare(`
      SELECT id, text, created_at, lane, lane_suggested, 0 AS sent, 0 AS in_drafts
        FROM keepwarm_subject_ideas
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC
    `).all();
  }

  return rows.map(r => ({
    id:      r.id,
    text:    r.text,
    state:   r.sent ? 'sent' : (r.in_drafts ? 'in drafts' : 'unused'),
    usable:  !r.sent && !r.in_drafts,
    // null = General. Otherwise a service-lane key.
    lane:      r.lane || null,
    suggested: !!r.lane_suggested,
  }));
}

export function unusedCount() {
  return listIdeas().filter(i => i.usable).length;
}

/**
 * Resolve the ids the screen ticked into the exact strings to generate from.
 *
 * Refuses rather than guesses, and says which line is the problem. An id that
 * has been deleted, or a line that has since been used by another tab or
 * another person, must not quietly turn into one fewer email than the operator
 * asked for — they would have no way of knowing which of their lines went
 * missing or why.
 */
// `lines` carries each picked line's type as well, so the generator can write a
// Website line as a Website email. `subjects` is the plain text list, as before.
export function resolveIdeas(ids = []) {
  const wanted = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
  if (wanted.length === 0) return { subjects: [], lines: [], error: null };

  const all = listIdeas();
  const byId = new Map(all.map(i => [i.id, i]));
  const subjects = [];
  const lines = [];

  for (const id of wanted) {
    const idea = byId.get(id);
    if (!idea) {
      return { subjects: [], lines: [], error: 'One of the subject lines you picked is no longer there. Refresh the page and try again.' };
    }
    if (!idea.usable) {
      return {
        subjects: [],
        lines: [],
        error: idea.state === 'sent'
          ? `"${idea.text}" has already been sent, so it cannot be used again.`
          : `"${idea.text}" is already sitting in a draft. Approve or bin that one first.`,
      };
    }
    subjects.push(idea.text);
    lines.push({ text: idea.text, lane: idea.lane });
  }

  return { subjects, lines, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add one line or a whole pasted block, one per line.
 *
 * Duplicates are skipped rather than rejected, and skipping is compared without
 * case or spacing, so pasting the same list twice adds nothing the second time
 * instead of producing nine lines that each look identical on screen and each
 * count separately against the never-twice rule.
 *
 * A line that has been SENT and then binned stays gone, even if the whole list
 * is pasted back in — bringing it back would be a way to send the same subject
 * twice by accident, which is the one thing the operator asked not to be
 * possible. A binned line that never went out is a change of mind rather than
 * history, so pasting it back restores it.
 */
// `lane` is the type picked beside the Add box: a lane key, null for General,
// or 'auto' to let Studio guess each line (marked suggested).
//
// The Keep button on a Studio suggestion comes through here too, with the type
// the operator picked, so a kept line is stored exactly like one they typed:
// no "suggested" mark and nothing recording that Studio wrote it.
export function addIdeas(input, lane = 'auto') {
  const lines = String(input || '')
    .split('\n')
    .map(norm)
    .filter(Boolean)
    .map(t => t.slice(0, MAX_LEN));

  if (lines.length === 0) return { added: 0, skipped: 0, error: 'Nothing to add.' };
  if (lines.length > MAX_PER_PASTE) {
    return { added: 0, skipped: 0, error: `That is ${lines.length} lines. ${MAX_PER_PASTE} is the most at once — paste it in smaller pieces.` };
  }

  // Deleted rows are compared against too, not just live ones. Without that,
  // binning a line and pasting the list back in would resurrect it — including
  // a line that has already gone out, which is precisely the accident the
  // never-twice rule exists to stop.
  const existing = db.prepare(
    'SELECT id, text, deleted_at FROM keepwarm_subject_ideas'
  ).all();

  const byKey = new Map(existing.map(r => [r.text.toLowerCase(), r]));

  // Which of those have actually been sent. A binned line that never went out
  // is a line the operator changed their mind about, and pasting it back should
  // bring it back; a binned line that DID go out must stay gone.
  let sentTexts = new Set();
  try {
    sentTexts = new Set(
      db.prepare(`SELECT subject FROM keepwarm_runs WHERE status = 'sent'`)
        .all().map(r => String(r.subject || '').toLowerCase())
    );
  } catch { /* no runs table yet — nothing has been sent */ }

  const ins = db.prepare(
    'INSERT INTO keepwarm_subject_ideas (id, text, lane, lane_suggested) VALUES (?, ?, ?, ?)'
  );
  const auto = lane === 'auto';
  const laneFor = (text) => (auto ? suggestLane(text) : (lane || null));
  const restore = db.prepare(
    'UPDATE keepwarm_subject_ideas SET deleted_at = NULL WHERE id = ?'
  );

  let added = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const line of lines) {
      const key = line.toLowerCase();
      const row = byKey.get(key);

      if (!row) {
        const id = uuid();
        ins.run(id, line, laneFor(line), auto ? 1 : 0);
        byKey.set(key, { id, text: line, deleted_at: null });
        added++;
        continue;
      }

      if (row.deleted_at && !sentTexts.has(key)) {
        restore.run(row.id);
        row.deleted_at = null;
        added++;
        continue;
      }

      skipped++;
    }
  });
  tx();

  if (added) console.log(`[keepwarm] added ${added} subject line(s)${skipped ? `, skipped ${skipped} already there` : ''}`);
  return { added, skipped, error: null };
}

/**
 * Change a line's type by hand. Clears the "suggested" mark, because the
 * operator has now decided.
 */
export function setIdeaLane(id, lane) {
  const res = db.prepare(`
    UPDATE keepwarm_subject_ideas
       SET lane = ?, lane_suggested = 0
     WHERE id = ? AND deleted_at IS NULL
  `).run(lane || null, String(id || ''));
  return { ok: !!res.changes };
}

/**
 * Change the wording of a line. Returns { ok } or { ok: false, error } with a
 * sentence the screen shows as it is.
 *
 * Only an unused line can be changed. A line is linked to its draft and to its
 * send by the exact wording, so changing a line that is in a draft would make it
 * look unused while the draft still carries the old words, and a sent line must
 * stay exactly as it went for the never-twice rule to hold.
 *
 * The new wording is refused if it matches another line on the list, a subject
 * that has already been sent, or a subject a live draft already carries — each
 * of those would let the same subject go out twice.
 */
export function editIdea(id, input) {
  const text = norm(input).slice(0, MAX_LEN);
  if (!text) return { ok: false, error: 'The line cannot be empty.' };

  const idea = listIdeas().find(i => i.id === String(id || ''));
  if (!idea) return { ok: false, error: 'That line is not there any more. Refresh the page.' };
  if (idea.state === 'sent') return { ok: false, error: 'That line has already been sent, so it cannot be changed.' };
  if (idea.state === 'in drafts') {
    return { ok: false, error: 'That line is in a draft. Bin or approve the draft first, then change the line.' };
  }
  if (text === idea.text) return { ok: true, unchanged: true };

  const key = text.toLowerCase();

  // Another line with the same words — live, or binned after it went out.
  const others = db.prepare(
    'SELECT id, text, deleted_at FROM keepwarm_subject_ideas WHERE id != ?'
  ).all(idea.id).filter(r => r.text.toLowerCase() === key);
  if (others.some(r => !r.deleted_at)) return { ok: false, error: 'That line is already on your list.' };

  let sent = false;
  let drafted = false;
  try {
    sent = !!db.prepare(
      `SELECT 1 FROM keepwarm_runs WHERE status = 'sent' AND lower(subject) = ? LIMIT 1`
    ).get(key);
  } catch { /* no runs table yet — nothing has been sent */ }
  try {
    drafted = !!db.prepare(
      `SELECT 1 FROM keepwarm_drafts
        WHERE lower(subject) = ? AND status IN ('draft', 'approved') AND deleted_at IS NULL LIMIT 1`
    ).get(key);
  } catch { /* no drafts table yet */ }
  if (sent) return { ok: false, error: 'An email with that subject has already been sent. Try different wording.' };
  if (drafted) return { ok: false, error: 'A draft already has that subject. Try different wording.' };

  // A binned line with these words that never went out is just a discarded
  // idea. It is removed so the list never holds the same words twice.
  const drop = db.prepare('DELETE FROM keepwarm_subject_ideas WHERE id = ?');
  const upd = db.prepare('UPDATE keepwarm_subject_ideas SET text = ? WHERE id = ? AND deleted_at IS NULL');
  db.transaction(() => {
    for (const r of others) drop.run(r.id);
    upd.run(text, idea.id);
  })();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// What the Suggest button needs to know
// ─────────────────────────────────────────────────────────────────────────────

// Enough of the operator's lines to carry their voice without turning the
// prompt into a copy of the whole list.
const MAX_EXAMPLES = 30;

/**
 * The two lists a suggestion run is built from.
 *
 *   examples — the operator's own lines of this type, then their General
 *              lines, as a reference for tone. Binned lines are left out:
 *              binning one is a sign it is not the voice they want.
 *   avoid    — every subject Studio must not repeat or land too close to:
 *              every line ever on the list (binned ones too — a line binned
 *              once should not come back dressed as a suggestion), every
 *              draft subject whatever happened to it (rejected ones are the
 *              clearest "not this"), and every subject on a send.
 *
 * Each table read is wrapped for the same reason as listIdeas(): on a brand-new
 * database another module's table may not exist yet, and a missing table means
 * there is nothing in it to avoid.
 */
export function suggestionContext(lane = null) {
  const own = db.prepare(`
    SELECT text, lane FROM keepwarm_subject_ideas
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC
  `).all();
  const ofType = lane ? own.filter(r => r.lane === lane) : [];
  const general = own.filter(r => !r.lane);
  const exampleKeys = new Set();
  const examples = [];
  for (const r of [...ofType, ...general]) {
    const clean = norm(r.text);
    if (!clean || exampleKeys.has(clean.toLowerCase())) continue;
    exampleKeys.add(clean.toLowerCase());
    examples.push(clean);
    if (examples.length >= MAX_EXAMPLES) break;
  }

  const texts = db.prepare('SELECT text FROM keepwarm_subject_ideas').all().map(r => r.text);
  try {
    texts.push(...db.prepare('SELECT subject FROM keepwarm_drafts').all().map(r => r.subject));
  } catch { /* no drafts table yet */ }
  try {
    texts.push(...db.prepare('SELECT subject FROM keepwarm_runs').all().map(r => r.subject));
  } catch { /* no runs table yet */ }

  const seen = new Set();
  const avoid = [];
  for (const t of texts) {
    const clean = norm(t);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    avoid.push(clean);
  }
  return { examples, avoid };
}

/** "These look right" — keep every suggested type as it is and clear the marks. */
export function confirmSuggestedLanes() {
  const res = db.prepare(`
    UPDATE keepwarm_subject_ideas SET lane_suggested = 0
     WHERE lane_suggested = 1 AND deleted_at IS NULL
  `).run();
  return { ok: true, confirmed: res.changes };
}

/**
 * Take a line off the list.
 *
 * Soft, for the same reason binned drafts are soft-deleted: a line that has
 * been sent must keep counting against the never-twice rule even after the
 * operator has stopped wanting to look at it. A hard delete would let the same
 * subject be pasted back in and sent a second time.
 */
export function deleteIdea(id) {
  const res = db.prepare(`
    UPDATE keepwarm_subject_ideas
       SET deleted_at = datetime('now')
     WHERE id = ? AND deleted_at IS NULL
  `).run(String(id || ''));
  return { ok: !!res.changes };
}
