/**
 * name-parser.js — Extract a first name (Christian name) from a stored
 * subscriber `name` field for use in {{first_name}} email placeholders.
 *
 * Two-stage approach:
 *   1. parseFirstName(name) — fast deterministic rule. Returns one of:
 *        { firstName: "Andy", source: "rule",  reason: "..." }   ← clean match
 *        { firstName: null,   source: "skip",  reason: "..." }   ← can't parse, don't send
 *        { firstName: "...",  source: "needs_ai", reason: "..." } ← rule guessed but should be re-checked
 *   2. parseFirstNameWithAI(name) — Claude Haiku fallback for "needs_ai" cases.
 *      Returns the same shape but with source: "ai" or "skip".
 *
 * Cost note: real campaigns of ~500 subs will trigger maybe 20-30 AI calls
 * (only the messy ones), so total cost is ~$0.01 not $0.15. Names are then
 * cached on the subscriber row so we never re-parse.
 *
 * Edge cases the rule handles:
 *   "Andy Pickford"            → "Andy"           (rule)
 *   "Mr. John Smith"           → "John"           (rule, honorific stripped)
 *   "Mary-Jane O'Brien"        → "Mary-Jane"      (rule, hyphenated kept)
 *   "DR ANGELA REID"           → needs_ai → "Angela"
 *   "Mr & Mrs Smith"           → needs_ai → skip
 *   "Hospital Reception Team"  → skip             (rule, role words)
 *   ""  / null                 → skip             (rule, empty)
 *   "jane.doe"                 → needs_ai → "Jane"
 *   "a.smith"                  → skip             (rule, single initial)
 */

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';

let _client = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// Honorifics to strip from the front of a name. Lowercased, no punctuation.
const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mx',
  'dr', 'prof', 'professor',
  'sir', 'dame', 'lord', 'lady',
  'rev', 'revd', 'reverend', 'fr', 'father',
  'capt', 'captain', 'maj', 'major', 'col', 'colonel', 'lt', 'lieutenant',
  'hon', 'honorable',
]);

// Tokens that strongly suggest the entry is a role/team/department, not a person.
// Conservative on purpose — we'd rather AI-check a borderline case than auto-skip.
const ROLE_WORDS = new Set([
  'team', 'reception', 'receptionist',
  'admin', 'administrator', 'administration',
  'info', 'enquiries', 'enquiry', 'inquiries', 'inquiry',
  'sales', 'support', 'helpdesk', 'help',
  'accounts', 'accounting', 'finance', 'billing',
  'office', 'department', 'dept',
  'contact', 'customer', 'service', 'services',
  'hr', 'recruitment', 'recruiting',
  'marketing', 'press', 'media',
  'reservations', 'bookings',
]);

// Tokens that mean "joint name" — Mr & Mrs, John and Jane, etc.
const JOINT_TOKENS = new Set(['&', 'and', '+']);

/**
 * The greeting for a keep-warm email, resolved without an AI call.
 *
 * Order is contact name, then referrer name, then nothing.
 *
 * THE REFERRER FALLBACK IS A DELIBERATE OPERATOR DECISION, AND IT IS CONTESTED.
 * `referrerName` is only ever populated when the caller chose "spoke to someone
 * else" in WorkTrackr — which is WorkTrackr recording that this person is NOT
 * the recipient, but a colleague who passed the address on. Greeting a shared
 * inbox with that name addresses the email to somebody who is not reading it.
 * Billy weighed that up on 9 September 2026 and asked for it anyway, on the
 * grounds that in practice the person named is usually the one who asked for
 * the email. Recorded here so the next reader knows it is a choice rather than
 * a misunderstanding of the field. The clean fix is on the WorkTrackr side —
 * record that person as the contact with spokeTo 'them'.
 *
 * Only `rule` results are accepted. `needs_ai` means the deterministic pass had
 * a guess it wanted checked, and an unchecked guess in a greeting is exactly the
 * failure worth avoiding: "Hi Shorders," is worse than "Hi there,". Those fall
 * through to null until somebody decides to wire the AI pass in here.
 */
export function greetingFirstName(contactName, referrerName = null) {
  for (const candidate of [contactName, referrerName]) {
    if (!candidate) continue;
    const r = parseFirstName(candidate);
    if (r.source === 'rule' && r.firstName) return r.firstName;
  }
  return null;
}

/**
 * Stage 1 — fast deterministic parse.
 * Returns { firstName, source, reason } where source is one of:
 *   "rule"     — clean, no AI needed
 *   "needs_ai" — rule has a guess but caller should run AI to verify
 *   "skip"     — definitely can't be parsed
 */
export function parseFirstName(rawName) {
  if (!rawName || typeof rawName !== 'string' || !rawName.trim()) {
    return { firstName: null, source: 'skip', reason: 'No name on subscriber' };
  }

  // Normalise whitespace, strip stray quotes, trim trailing periods on tokens
  const cleaned = rawName.trim().replace(/\s+/g, ' ').replace(/^["']|["']$/g, '');
  let tokens = cleaned.split(' ').filter(Boolean);

  // Strip leading honorifics (one or more — e.g. "Prof Sir David")
  let stripped = 0;
  while (tokens.length > 0) {
    const t = tokens[0].toLowerCase().replace(/[.,]$/, '');
    if (HONORIFICS.has(t)) {
      tokens = tokens.slice(1);
      stripped++;
    } else {
      break;
    }
  }

  if (tokens.length === 0) {
    return { firstName: null, source: 'skip', reason: 'Only honorifics, no actual name' };
  }

  // Joint-name detector: "Mr & Mrs Smith" → after strip → "& Mrs Smith"
  // or "John & Jane Smith" → "John & Jane Smith".
  // We can't safely pick a first name here.
  if (tokens.some(t => JOINT_TOKENS.has(t.toLowerCase()))) {
    return { firstName: null, source: 'needs_ai', reason: 'Joint name pattern detected' };
  }

  // Role/team detector — any role word in the remaining tokens
  const lowerTokens = tokens.map(t => t.toLowerCase().replace(/[.,]$/, ''));
  if (lowerTokens.some(t => ROLE_WORDS.has(t))) {
    return { firstName: null, source: 'skip', reason: 'Looks like a role or team, not a person' };
  }

  let first = tokens[0].replace(/[.,]$/, '');

  // Email-local-part style: "jane.doe" or "a.smith" — exactly one token containing a dot
  if (tokens.length === 1 && first.includes('.')) {
    const parts = first.split('.');
    const head = parts[0];
    if (head.length <= 1) {
      return { firstName: null, source: 'skip', reason: 'Only an initial, not enough to address' };
    }
    // Letting AI handle this — could be a real name, could be junk
    return { firstName: capitalise(head), source: 'needs_ai', reason: 'Email-style name, AI verifying' };
  }

  // Strip wrapping parentheses like "(John)"
  first = first.replace(/^\(|\)$/g, '');

  // Single initial: "A Pickford" → can't address as "A,"
  if (first.length === 1 || /^[A-Za-z]\.?$/.test(first)) {
    return { firstName: null, source: 'skip', reason: 'First token is just an initial' };
  }

  // All caps: "ANGELA" or "DR ANGELA REID" (after honorific strip → "ANGELA REID")
  // Send to AI so casing gets normalised properly even with diacritics etc.
  const isAllCaps = /^[A-Z][A-Z\-']*$/.test(first) && first.length > 1;
  if (isAllCaps) {
    return { firstName: capitalise(first), source: 'needs_ai', reason: 'All caps — AI normalising casing' };
  }

  // Single lowercase token: "angela" — fix casing, accept by rule
  if (/^[a-z][a-z\-']*$/.test(first)) {
    return { firstName: capitalise(first), source: 'rule', reason: 'Single lowercase token' };
  }

  // Has digits or weird symbols → skip
  if (/[\d@#$%^*]/.test(first)) {
    return { firstName: null, source: 'skip', reason: 'Contains digits or symbols — not a name' };
  }

  // Default success path: clean rule match
  return { firstName: first, source: 'rule', reason: 'First token after honorifics' };
}

/**
 * Stage 2 — Haiku fallback for the messy cases.
 * Only call when stage 1 returns { source: "needs_ai" }.
 */
export async function parseFirstNameWithAI(rawName) {
  if (!rawName || !rawName.trim()) {
    return { firstName: null, source: 'skip', reason: 'No name on subscriber' };
  }

  const prompt = `You are extracting a first name (also known as a Christian name or given name) from a stored subscriber name field, so a cold-outreach email can address the recipient as "Hi <FirstName>,".

Stored name: "${rawName}"

Rules:
- Return ONLY the first name itself, properly capitalised (e.g. "Angela", "Mary-Jane", "John").
- Strip titles/honorifics (Mr, Mrs, Dr, Prof, Sir, etc).
- For joint names like "Mr & Mrs Smith" or "John and Jane", return SKIP — don't pick one.
- For roles/teams/departments (e.g. "Reception Team", "Sales Office"), return SKIP.
- For names with no parseable Christian name (just initials, just an email local-part with no clear name, gibberish), return SKIP.
- Keep hyphens and apostrophes in real names (Mary-Jane, O'Brien, D'Angelo).
- For all-caps or all-lowercase input, normalise to title case (ANGELA → Angela, mary → Mary).

Reply with ONLY one of:
  - The first name itself, on a single line, nothing else.
  - The literal word: SKIP

Do not include quotes, punctuation, explanations, or anything else.`;

  try {
    const resp = await client().messages.create({
      // Configurable so we can bump model versions without a code change.
      // claude-haiku-4-5-20251001 was the latest Haiku at time of writing.
      model: process.env.NAME_PARSER_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 30,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (resp.content?.[0]?.text || '').trim();
    if (!text || text.toUpperCase() === 'SKIP') {
      return { firstName: null, source: 'skip', reason: 'AI determined no parseable first name' };
    }
    // Defensive: take the first line only, strip quotes/punctuation that the model might add despite the prompt
    const firstLine = text.split(/\r?\n/)[0].trim().replace(/^["'`]|["'`.,!?]$/g, '');
    if (!firstLine || firstLine.length > 40 || /\s/.test(firstLine)) {
      // Multi-word or absurdly long response → don't trust it, skip
      return { firstName: null, source: 'skip', reason: 'AI returned unusable response' };
    }
    return { firstName: firstLine, source: 'ai', reason: 'Parsed by AI' };
  } catch (err) {
    console.error('[name-parser] AI fallback failed:', err.message);
    // On AI failure, conservatively skip rather than send wrong text
    return { firstName: null, source: 'skip', reason: 'AI lookup failed: ' + err.message };
  }
}

/**
 * Convenience wrapper: parse a single name through the full pipeline.
 * Used by ad-hoc lookups; bulk operations should use parseAndCacheList for batching.
 */
export async function parseFirstNameFull(rawName) {
  const stage1 = parseFirstName(rawName);
  if (stage1.source === 'rule' || stage1.source === 'skip') return stage1;
  return parseFirstNameWithAI(rawName);
}

/**
 * Bulk parse + cache for an entire list. Idempotent — only processes
 * subscribers where first_name_source IS NULL or where force=true.
 *
 * Returns { processed, byRule, byAI, skipped, errors } so the UI can
 * report progress.
 *
 * Concurrency: AI calls run with limited parallelism (default 5) so we
 * don't melt the API. Rule-only parses run synchronously inline.
 */
export async function parseAndCacheList(listId, { force = false, concurrency = 5 } = {}) {
  const where = force
    ? "WHERE list_id = ?"
    : "WHERE list_id = ? AND (first_name_source IS NULL OR first_name_source = '')";
  const subs = db.prepare(`SELECT id, name FROM email_subscribers ${where}`).all(listId);

  const update = db.prepare(
    "UPDATE email_subscribers SET first_name = ?, first_name_source = ?, first_name_reason = ? WHERE id = ?"
  );

  let byRule = 0, byAI = 0, skipped = 0, errors = 0;

  // Stage 1: rule pass for everyone — instant
  const needsAI = [];
  for (const sub of subs) {
    try {
      const r = parseFirstName(sub.name);
      if (r.source === 'rule') {
        update.run(r.firstName, 'rule', r.reason, sub.id);
        byRule++;
      } else if (r.source === 'skip') {
        update.run(null, 'skip', r.reason, sub.id);
        skipped++;
      } else {
        // needs_ai — defer
        needsAI.push(sub);
      }
    } catch (err) {
      console.error('[name-parser] rule pass error for', sub.id, err.message);
      errors++;
    }
  }

  // Stage 2: AI pass with concurrency cap
  if (needsAI.length > 0) {
    console.log(`[name-parser] list ${listId}: ${needsAI.length} subs need AI fallback`);
    let cursor = 0;
    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= needsAI.length) return;
        const sub = needsAI[idx];
        try {
          const r = await parseFirstNameWithAI(sub.name);
          if (r.source === 'ai') {
            update.run(r.firstName, 'ai', r.reason, sub.id);
            byAI++;
          } else {
            update.run(null, 'skip', r.reason, sub.id);
            skipped++;
          }
        } catch (err) {
          console.error('[name-parser] AI pass error for', sub.id, err.message);
          errors++;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, needsAI.length) }, worker));
  }

  console.log(`[name-parser] list ${listId}: rule=${byRule}, ai=${byAI}, skipped=${skipped}, errors=${errors}`);
  return { processed: subs.length, byRule, byAI, skipped, errors };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function capitalise(s) {
  if (!s) return s;
  // Handle hyphens and apostrophes: "mary-jane" → "Mary-Jane", "o'brien" → "O'Brien"
  return s.toLowerCase().split(/([\-'])/).map((part, i) => {
    if (part === '-' || part === "'") return part;
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join('');
}

/**
 * Apply {{first_name}} substitution to a template string.
 * Returns the rendered text. If firstName is null, the placeholder is left as-is
 * (caller should be skipping the subscriber in that case).
 *
 * Match is case-insensitive on the placeholder ({{first_name}}, {{First_Name}}
 * and {{FIRST_NAME}} all work). The `[Name]` legacy placeholder also matches
 * for backward compatibility with existing campaigns.
 */
export function renderTemplate(text, firstName) {
  if (!text) return text;
  if (firstName == null) return text;
  return text
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
    .replace(/\[Name\]/gi, firstName);
}

/**
 * Detect whether a template uses the {{first_name}} placeholder. Used by the
 * send flow to decide if subscribers without a parsed first name should be
 * skipped (only matters if the template actually personalises).
 */
export function templateUsesFirstName(...texts) {
  for (const t of texts) {
    if (!t) continue;
    if (/\{\{\s*first_name\s*\}\}/i.test(t)) return true;
    if (/\[Name\]/i.test(t)) return true;
  }
  return false;
}
