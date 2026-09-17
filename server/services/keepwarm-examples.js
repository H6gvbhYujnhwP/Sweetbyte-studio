/**
 * server/services/keepwarm-examples.js — the example websites that go at the
 * foot of a lane email, just above the signature.
 *
 * WHAT THIS IS FOR
 * A Website keep-warm email ends with a line introducing one or two sites
 * Sweetbyte has actually built, with the client's name as the link. The line
 * exists to give the reader something to look at; the whole point is that the
 * addresses are real.
 *
 * WHO WRITES WHAT, AND WHY IT IS SPLIT THAT WAY
 * Studio owns the addresses. The model owns the sentence that introduces them.
 *
 * The model has never seen a real client URL and will invent a plausible wrong
 * one if asked for it, and a wrong link looks completely right until somebody
 * clicks it. The body checker also refuses any markup in a paragraph except a
 * bold label, so an <a href> written into the body would fail its checks every
 * time and the draft would be thrown away.
 *
 * The sentence is the model's because a fixed one would be word-for-word
 * identical in every Website email forever. It writes the words and never
 * touches an address — and it is checked here for having obeyed that, rather
 * than trusted to.
 *
 * WHERE THE LINE SITS
 * Below the body, above the signature. Outside the checked body, so it cannot
 * fail validation, and outside the editing box, so it cannot be mangled when a
 * draft is edited and saved.
 *
 * FROZEN ONTO THE DRAFT
 * The sentence and the two sites chosen are written against the draft the
 * moment it is generated and never touched again. Editing the list afterwards
 * changes what the NEXT email says, not what an approved one sends. What was
 * approved is what goes out.
 *
 * ROTATION IS PER EMAIL, NOT PER PERSON
 * Each new draft takes the next two off the list, so two drafts in a row do not
 * show the same pair. Everybody on one send sees the same two, which is the
 * point: swapping the examples per recipient at send time, the way the greeting
 * is swapped, is work the lanes are far too small to be worth.
 *
 * PER LANE
 * Stored against a lane key, so Custom apps can be switched on later by adding
 * its key to LANES_WITH_EXAMPLES and nothing else.
 *
 * This file owns its two tables, following the pattern the rest of keep-warm
 * uses: the file that writes the rows owns the table.
 */

import db from '../db.js';
import { P_STYLE } from './email-body-style.js';
import { createKeepWarmModel } from './keepwarm-model.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS keepwarm_lane_examples (
    lane       TEXT PRIMARY KEY,
    sites      TEXT NOT NULL DEFAULT '[]',
    pointer    INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS keepwarm_draft_examples (
    draft_id   TEXT PRIMARY KEY,
    lane       TEXT,
    lead       TEXT NOT NULL,
    sites      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─────────────────────────────────────────────────────────────────────────────
// Which lanes offer examples
// ─────────────────────────────────────────────────────────────────────────────
//
// Website only, for now. The storage is per lane so the others need no rebuild;
// turning Custom apps on is this list plus a saved list of sites.
export const LANES_WITH_EXAMPLES = ['website'];

export function laneTakesExamples(lane) {
  return LANES_WITH_EXAMPLES.includes(String(lane || '').trim());
}

// How many go in one email.
export const EXAMPLES_PER_EMAIL = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Addresses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check an address looks like a web address, and hand back the form that will
 * be stored.
 *
 * A bare domain is accepted and stored with https:// on the front. That is not
 * a silent fallback — the full address is handed straight back to the screen and
 * shown in the list, so what was stored is visible before anything is sent.
 *
 * Everything else is refused in plain words. A dead link in an email is worse
 * than being made to retype an address.
 */
export function normaliseSiteUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return { error: 'An address is missing.' };
  if (/\s/.test(value)) return { error: `"${value}" has a space in it, so it is not a web address.` };
  if (/[<>"'`]/.test(value)) return { error: `"${value}" contains characters an address cannot have.` };

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: `"${value}" does not look like a web address.` };
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    return { error: `"${value}" is not a web address Studio can link to.` };
  }
  // A host with no dot in it is a machine name on somebody's network, not a
  // website a customer can open.
  if (!parsed.hostname.includes('.') || parsed.hostname.endsWith('.')) {
    return { error: `"${value}" does not look like a web address.` };
  }
  if (!/^[a-z0-9.-]+$/i.test(parsed.hostname)) {
    return { error: `"${value}" does not look like a web address.` };
  }
  // The last part of the host has to be letters — .co.uk, .com, .agency. A
  // number there means somebody has typed an IP address.
  const tld = parsed.hostname.split('.').pop();
  if (!/^[a-z]{2,}$/i.test(tld)) {
    return { error: `"${value}" does not look like a web address.` };
  }

  // "https://example.co.uk/" reads as a typo in a list somebody maintains by
  // hand, so the bare domain is stored without the trailing slash. A real path
  // is left exactly as typed.
  let url = parsed.toString();
  if (parsed.pathname === '/' && !parsed.search && !parsed.hash) url = url.replace(/\/$/, '');
  return { url };
}

const MAX_SITES = 40;
const MAX_NAME = 60;

/**
 * Check a whole list on the way in. One bad row refuses the save and says which
 * row and why; a half-saved list is how a dead link ends up in an email.
 */
export function validateSites(input) {
  if (!Array.isArray(input)) return { error: 'The list of sites is missing.' };
  if (input.length > MAX_SITES) return { error: `That is more than ${MAX_SITES} sites, which is more than this list is for.` };

  const sites = [];
  const seen = new Set();

  for (const row of input) {
    const name = String((row && row.name) || '').trim().replace(/\s+/g, ' ');
    const rawUrl = String((row && row.url) || '').trim();

    if (!name && !rawUrl) continue; // an empty row is somebody who changed their mind
    if (!name) return { error: `The site at ${rawUrl} has no client name, and the name is what the reader clicks.` };
    if (name.length > MAX_NAME) return { error: `"${name.slice(0, 30)}…" is too long to read as a link.` };
    if (/[<>]/.test(name)) return { error: `"${name}" contains characters a name cannot have.` };
    if (!rawUrl) return { error: `${name} has no address against it.` };

    const checked = normaliseSiteUrl(rawUrl);
    if (checked.error) return { error: checked.error };

    const key = checked.url.toLowerCase();
    if (seen.has(key)) return { error: `${checked.url} is in the list twice.` };
    seen.add(key);

    sites.push({ name, url: checked.url });
  }

  return { sites };
}

// ─────────────────────────────────────────────────────────────────────────────
// The saved list
// ─────────────────────────────────────────────────────────────────────────────

export function getLaneExamples(lane) {
  const key = String(lane || '').trim();
  const row = db.prepare('SELECT sites, pointer FROM keepwarm_lane_examples WHERE lane = ?').get(key);
  if (!row) return { lane: key, sites: [], pointer: 0 };

  let sites = [];
  try {
    const parsed = JSON.parse(row.sites);
    if (Array.isArray(parsed)) {
      sites = parsed
        .filter(s => s && typeof s.name === 'string' && typeof s.url === 'string')
        .map(s => ({ name: s.name, url: s.url }));
    }
  } catch { sites = []; }

  return { lane: key, sites, pointer: Number(row.pointer) || 0 };
}

/**
 * Save the list. The rotation pointer is kept where it is rather than reset, so
 * correcting a typo does not start the whole list again; it is wrapped by
 * whatever the new length is when the next pair is taken.
 */
export function setLaneExamples(lane, input) {
  const key = String(lane || '').trim();
  if (!laneTakesExamples(key)) return { error: `Studio does not keep example sites for ${key || 'that'}.` };

  const checked = validateSites(input);
  if (checked.error) return { error: checked.error };

  db.prepare(`
    INSERT INTO keepwarm_lane_examples (lane, sites, pointer, updated_at)
    VALUES (?, ?, COALESCE((SELECT pointer FROM keepwarm_lane_examples WHERE lane = ?), 0), datetime('now'))
    ON CONFLICT(lane) DO UPDATE SET sites = excluded.sites, updated_at = datetime('now')
  `).run(key, JSON.stringify(checked.sites), key);

  return getLaneExamples(key);
}

/**
 * The pair the next email would use, without moving the rotation on. This is
 * what the screen shows as "next up", so pressing Write holds no surprises.
 */
export function peekNextExamples(lane, count = EXAMPLES_PER_EMAIL) {
  const { sites, pointer } = getLaneExamples(lane);
  if (!sites.length) return [];
  const take = Math.min(count, sites.length);
  const out = [];
  for (let i = 0; i < take; i += 1) out.push(sites[(pointer + i) % sites.length]);
  return out;
}

/**
 * The pair for an email being written now, and the rotation moved on past them.
 *
 * Moved on at writing rather than at sending, deliberately: two drafts written
 * one after the other should not show the same pair, and a draft that is binned
 * rather than sent has still been read by the person deciding.
 */
export function takeNextExamples(lane, count = EXAMPLES_PER_EMAIL) {
  const key = String(lane || '').trim();
  const { sites, pointer } = getLaneExamples(key);
  if (!sites.length) return [];

  const take = Math.min(count, sites.length);
  const chosen = [];
  for (let i = 0; i < take; i += 1) chosen.push(sites[(pointer + i) % sites.length]);

  db.prepare(`
    INSERT INTO keepwarm_lane_examples (lane, sites, pointer, updated_at)
    VALUES (?, '[]', ?, datetime('now'))
    ON CONFLICT(lane) DO UPDATE SET pointer = excluded.pointer, updated_at = datetime('now')
  `).run(key, (pointer + take) % sites.length);

  return chosen;
}

// ─────────────────────────────────────────────────────────────────────────────
// The sentence
// ─────────────────────────────────────────────────────────────────────────────

const LEAD_SYSTEM = `You write one short sentence for the foot of a British B2B email from Sweetbyte, an IT company in Essex.

The sentence introduces examples of websites Sweetbyte has built. The addresses are added afterwards by the software, so you must not write any web address, any client name, any company name and any markup of any kind.

RULES
- One sentence. Between 6 and 25 words.
- It ends with a colon, because the links follow straight after it.
- UK English. No em dashes. No exclamation marks.
- Plain, understated, the way one working person writes to another. No marketing language.
- Do not write "click", "check out", "portfolio" or "showcase".
- Do not name anybody. Do not write any address, link, http, www or @ sign.
- Reply with the sentence only. No quotation marks, no preamble, no JSON.`;

const LEAD_MAX_WORDS = 25;
const LEAD_MIN_WORDS = 5;

/**
 * Check what came back. Everything here is a thing the sentence must not
 * contain rather than a thing it must say, because the wording is meant to vary
 * and only the shape is fixed.
 */
export function checkLeadSentence(raw) {
  let value = String(raw || '').trim();
  if (!value) return { error: 'The model sent back an empty sentence.' };

  // A model that has been told not to use quotation marks sometimes wraps the
  // whole answer in them anyway. That is not a reason to lose the sentence.
  value = value.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '').trim();

  if (/(?:https?:\/\/|www\.|@|\.co\.uk|\.com\b)/i.test(value)) {
    return { error: 'The model put an address in the sentence, which is not its to write.' };
  }
  if (/[<>]/.test(value)) return { error: 'The model put markup in the sentence.' };
  if (/[!—]/.test(value)) return { error: 'The sentence came back with an exclamation mark or an em dash in it.' };

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < LEAD_MIN_WORDS) return { error: 'The sentence came back too short to read as a sentence.' };
  if (words.length > LEAD_MAX_WORDS) return { error: 'The sentence came back too long for the foot of an email.' };

  // Two sentences would leave a full stop in the middle of the line, with the
  // links dangling off the end of the second one.
  if (/[.?][^.?]*[A-Za-z]/.test(value.replace(/\.$/, ''))) {
    return { error: 'The model wrote more than one sentence.' };
  }

  // It is asked for a colon and usually gives one. Swapping a trailing full
  // stop for the colon it was asked for is punctuation, not invention.
  value = value.replace(/[.:;,]+$/, '') + ':';

  return { lead: value };
}

/**
 * Ask for the sentence.
 *
 * Refuses rather than falling back on a stock line. A fixed sentence is exactly
 * what this is here to avoid, and quietly substituting one would mean every
 * Website email said the same thing the moment the model had a bad day, with
 * nothing on screen to say so.
 */
export async function writeLeadSentence({ count = EXAMPLES_PER_EMAIL, model = null } = {}) {
  const client = model || createKeepWarmModel({ label: 'examples-lead' });

  const user = count === 1
    ? 'Write the sentence. One example website follows it.'
    : `Write the sentence. ${count} example websites follow it, so the sentence should read as introducing more than one.`;

  const attempts = 2;
  let lastError = 'the sentence could not be written';

  for (let i = 0; i < attempts; i += 1) {
    const raw = await client.complete({
      system: LEAD_SYSTEM,
      user: i === 0 ? user : `${user}\n\nYour last attempt was refused: ${lastError} Write a different sentence that obeys every rule.`,
      temperature: 1,
    });
    const checked = checkLeadSentence(raw);
    if (checked.lead) return checked.lead;
    lastError = checked.error;
  }

  throw new Error(`Studio could not write the line that introduces the example websites: ${lastError}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Frozen against a draft
// ─────────────────────────────────────────────────────────────────────────────

export function freezeExamplesForDraft(draftId, { lane = null, lead, sites }) {
  const id = String(draftId || '').trim();
  if (!id) return { error: 'no_draft' };
  if (!lead || !Array.isArray(sites) || !sites.length) return { error: 'nothing_to_freeze' };

  db.prepare(`
    INSERT INTO keepwarm_draft_examples (draft_id, lane, lead, sites)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(draft_id) DO UPDATE SET lane = excluded.lane, lead = excluded.lead, sites = excluded.sites
  `).run(id, lane ? String(lane) : null, String(lead), JSON.stringify(sites));

  return { ok: true };
}

export function examplesForDraft(draftId) {
  const id = String(draftId || '').trim();
  if (!id) return null;
  const row = db.prepare('SELECT lead, sites FROM keepwarm_draft_examples WHERE draft_id = ?').get(id);
  if (!row) return null;
  try {
    const sites = JSON.parse(row.sites);
    if (!Array.isArray(sites) || !sites.length) return null;
    return { lead: row.lead, sites };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The line itself
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The finished line: the model's sentence, then the client names as links.
 *
 * Same paragraph style as the body, so it reads as part of the email rather
 * than as something bolted on. The links are the only markup, and they are
 * written here rather than anywhere near the body checker.
 */
export function examplesHtml(frozen) {
  if (!frozen || !frozen.lead || !Array.isArray(frozen.sites) || !frozen.sites.length) return '';

  // Sweetbyte's link colour, the one src/brand.js names for links on a light
  // background. Not the lighter cyan the signature uses: that block is glanced
  // at as a whole, whereas this sits in a line of body text and has to read as
  // clickable at body-text size, on a phone, in daylight.
  //
  // Written twice on purpose — once on the link, once on a span inside it.
  // Outlook has no visited state, so nothing here ever turns purple, but a few
  // webmail clients overrule a colour set on the link itself and leave a colour
  // set on the words alone. Written both ways, one of them always survives, and
  // the link is never left as somebody else's default blue.
  //
  // The underline is deliberately left alone. Colour tells somebody it is a
  // link; the underline tells somebody who cannot easily see the difference in
  // colour, and in a plain business email it is the signal people actually read.
  const LINK = '#135AA0';

  const links = frozen.sites.map(s =>
    `<a href="${escapeHtml(s.url)}" style="color:${LINK};"><span style="color:${LINK};">${escapeHtml(s.name)}</span></a>`,
  );

  const joined = links.length === 1
    ? links[0]
    : `${links.slice(0, -1).join(', ')} and ${links[links.length - 1]}`;

  return `<p style="${P_STYLE}">${escapeHtml(frozen.lead)} ${joined}.</p>`;
}

/**
 * The line for a draft, ready to render. Null when the draft has none, which is
 * every general email and every lane that does not carry examples.
 */
export function examplesHtmlForDraft(draftId) {
  return examplesHtml(examplesForDraft(draftId));
}
