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
      SELECT id, text, created_at, 0 AS sent, 0 AS in_drafts
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
export function resolveIdeas(ids = []) {
  const wanted = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
  if (wanted.length === 0) return { subjects: [], error: null };

  const all = listIdeas();
  const byId = new Map(all.map(i => [i.id, i]));
  const subjects = [];

  for (const id of wanted) {
    const idea = byId.get(id);
    if (!idea) {
      return { subjects: [], error: 'One of the subject lines you picked is no longer there. Refresh the page and try again.' };
    }
    if (!idea.usable) {
      return {
        subjects: [],
        error: idea.state === 'sent'
          ? `"${idea.text}" has already been sent, so it cannot be used again.`
          : `"${idea.text}" is already sitting in a draft. Approve or bin that one first.`,
      };
    }
    subjects.push(idea.text);
  }

  return { subjects, error: null };
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
export function addIdeas(input) {
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
    'INSERT INTO keepwarm_subject_ideas (id, text) VALUES (?, ?)'
  );
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
        ins.run(id, line);
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
