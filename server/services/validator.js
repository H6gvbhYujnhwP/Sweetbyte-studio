/**
 * Checks a generated email before it is ever allowed to become a draft.
 *
 * TWO CHANGES FROM THE SUPPLIED PACKAGE, both found by running it against real
 * Sweetbyte copy rather than against its own examples:
 *
 * 1. THE CALL-TO-ACTION COUNT. The package counted the bare word "call"
 *    anywhere in the body as a call-to-action, so a perfectly good email about
 *    business phones — one of the engine's own ten subject areas — failed,
 *    because "when a call comes in" is a sentence about telephones, not an
 *    invitation to ring anybody. It now looks for an actual invitation.
 *
 * 2. THE OPERATOR'S OWN SUBJECT LINES. Studio lets Billy tick his own subject
 *    lines and writes bodies under them, passing the line through untouched.
 *    The package checked every subject against a 64-character limit, a spam
 *    word list and a no-exclamation-marks rule, which would have refused a
 *    hand-written line — and, because the line is not allowed to change, could
 *    never have recovered from it. A supplied fixed subject now skips the
 *    subject checks entirely and is only checked for having come back
 *    unaltered. That is a settled Studio decision, not an oversight here.
 */

import { PARAGRAPH_STYLE } from './prompts.js';

const FORBIDDEN_BODY_PATTERNS = [
  [/\bhi\s+(?:there|\{\{|[A-Z])/i, 'Do not include a greeting'],
  [/\bkind regards\b|\bbest regards\b|\byours sincerely\b/i, 'Do not include a sign-off'],
  [/\bunsubscribe\b/i, 'Do not include unsubscribe wording'],
  [/\b01702\b|\bsupport@sweetbyte\b|\bsweetbyte\.co\.uk\b/i, 'Do not include signature contact details'],
  [/\b(?:speaking|spoke) (?:with you )?(?:earlier|today)\b|\bas promised\b|\bour conversation\b/i, 'Do not reference a prior conversation'],
  [/—/, 'Do not use em dashes'],
  [/!/, 'Do not use exclamation marks'],
  [/\bSweetByte\b|\bSweet Byte\b/, 'Spell Sweetbyte correctly'],
  [/\b(?:specialize|specialized|optimization|defense|modernize|organization)\b/i, 'Use UK English spelling'],
  [/(?:https?:\/\/|www\.|mailto:)/i, 'Do not include links'],
  [/^\s*(?:[-*•]|\d+[.)])\s+/m, 'Do not include lists'],
];

// An invitation to reply, and an invitation to telephone. Both are deliberately
// narrow: they match somebody being asked to do something, not the words
// "reply" or "call" appearing in a sentence about something else.
const CTA_REPLY = /\breply\b|\bget in touch\b|\blet us know\b|\bdrop us a line\b|\bwrite back\b/i;
const CTA_CALL = /\bgive (?:us|me) a (?:call|ring)\b|\bcall us\b|\bring us\b|\bphone us\b|\bcall the (?:number|office)\b|\bcall on the number\b/i;

const SPAMMY_SUBJECT = /\b(?:free|act now|limited time|urgent|guaranteed|exclusive deal|buy now|offer|discount|save money|winner|cash|risk-free)\b/i;

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function normaliseText(value) {
  return decodeHtml(value).replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
}

function extractHtmlParagraphs(html) {
  const escaped = PARAGRAPH_STYLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<p style="${escaped}">([\\s\\S]*?)<\\/p>`, 'g');
  return [...html.matchAll(regex)].map(match => match[1]);
}

function words(value) {
  return value.trim().match(/\b[\p{L}\p{N}][\p{L}\p{N}'’/-]*\b/gu) ?? [];
}

function numericTokens(value) {
  return new Set((value.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).map(x => x.toLowerCase()));
}

function subjectTokens(value) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(x => x.length > 2));
}

export function similarity(a, b) {
  const left = subjectTokens(a);
  const right = subjectTokens(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter(x => right.has(x)).length;
  return intersection / (left.size + right.size - intersection);
}

export function validateSubject(subject, doNotRepeat = []) {
  const errors = [];
  if (typeof subject !== 'string' || !subject.trim()) return ['Subject is missing'];
  if (subject.length > 64) errors.push('Subject exceeds the 64-character hard limit');
  if (subject.includes('!') || subject.includes('—')) errors.push('Subject contains forbidden punctuation');
  if (/[^\p{L}\p{N}\p{P}\p{Zs}]/u.test(subject)) errors.push('Subject appears to contain emoji or symbols');
  if (SPAMMY_SUBJECT.test(subject)) errors.push('Subject contains promotional or spam-like wording');
  if (/SweetByte|Sweet Byte/.test(subject)) errors.push('Sweetbyte is misspelled');
  for (const used of doNotRepeat) {
    if (subject.trim().toLowerCase() === used.trim().toLowerCase() || similarity(subject, used) >= 0.65) {
      errors.push(`Subject is too similar to a used or rejected subject: ${used}`);
      break;
    }
  }
  return errors;
}

export function validateEmail(email, { knowledgeBase, doNotRepeat = [], fixedSubject = null } = {}) {
  const errors = [];
  if (!email || typeof email !== 'object') return ['Email is not an object'];
  for (const field of ['angle', 'subject', 'html', 'plain']) {
    if (typeof email[field] !== 'string' || !email[field].trim()) errors.push(`${field} is missing`);
  }
  if (errors.length) return errors;

  // A hand-written subject is checked for having survived, and for nothing
  // else. See the note at the top of this file.
  if (fixedSubject !== null) {
    if (email.subject.trim() !== String(fixedSubject).trim()) {
      errors.push('The subject line was changed and had to stay exactly as written');
    }
  } else {
    errors.push(...validateSubject(email.subject, doNotRepeat));
  }

  const angleCount = words(email.angle).length;
  if (angleCount < 4 || angleCount > 6) errors.push('Angle must contain four to six words');

  const wordCount = words(email.plain).length;
  if (wordCount < 120 || wordCount > 200) errors.push(`Body has ${wordCount} words; required range is 120 to 200`);
  for (const [pattern, message] of FORBIDDEN_BODY_PATTERNS) {
    if (pattern.test(email.plain) || pattern.test(email.html)) errors.push(message);
  }
  if (/[^\p{L}\p{N}\p{P}\p{Zs}\n\r]/u.test(email.plain)) errors.push('Body appears to contain emoji or unsupported symbols');

  const paragraphs = extractHtmlParagraphs(email.html);
  if (paragraphs.length < 3 || paragraphs.length > 6) errors.push('HTML must contain three to six paragraphs');
  const rebuilt = paragraphs.map(p => `<p style="${PARAGRAPH_STYLE}">${p}</p>`).join('');
  if (rebuilt !== email.html) errors.push('HTML contains invalid markup, spacing or paragraph styles');
  const plainParagraphs = email.plain.replace(/\r/g, '').split(/\n\n+/).map(x => x.trim()).filter(Boolean);
  if (normaliseText(paragraphs.map(decodeHtml).join('\n\n')) !== normaliseText(plainParagraphs.join('\n\n'))) {
    errors.push('HTML and plain text wording do not match');
  }

  const invitesReply = CTA_REPLY.test(email.plain);
  const invitesCall = CTA_CALL.test(email.plain);
  if (!invitesReply && !invitesCall) {
    errors.push('Body must close with one low-pressure call to action, either inviting a reply or inviting a call');
  } else if (invitesReply && invitesCall) {
    errors.push('Body must not ask for both a reply and a call. Pick one');
  }

  if (!knowledgeBase || !knowledgeBase.trim()) errors.push('Knowledge base is missing');
  else {
    const allowed = numericTokens(knowledgeBase);
    for (const token of numericTokens(`${email.subject} ${email.plain}`)) {
      if (!allowed.has(token)) errors.push(`Numeric claim ${token} is not present in the knowledge base`);
    }
  }
  return [...new Set(errors)];
}

/**
 * Check a whole batch.
 *
 * Returns per-item errors rather than a single verdict, because the engine
 * repairs and reports individual emails. A batch that comes back short is
 * reported as such rather than thrown away: the operator keeps whatever is
 * good and bins the rest, which is how the Drafts screen has always worked.
 */
export function validateBatch(result, context) {
  const errors = new Map();
  if (!result || !Array.isArray(result.emails)) return { global: ['Result must contain an emails array'], errors };
  result.emails.forEach((email, index) => {
    const itemErrors = validateEmail(email, context);
    if (itemErrors.length) errors.set(index, itemErrors);
  });
  for (let i = 0; i < result.emails.length; i += 1) {
    for (let j = i + 1; j < result.emails.length; j += 1) {
      const a = result.emails[i]; const b = result.emails[j];
      if (!a || !b || typeof a.subject !== 'string' || typeof b.subject !== 'string') continue;
      if (similarity(a.subject, b.subject) >= 0.65 || similarity(a.angle || '', b.angle || '') >= 0.65) {
        errors.set(j, [...(errors.get(j) ?? []), `Too similar to email ${i + 1}`]);
      }
    }
  }
  return { global: [], errors };
}

/**
 * The model is told to return JSON and nothing else, and this stays strict
 * about it. Tolerating stray prose here is how a half-parsed response becomes a
 * draft. Markdown fences are stripped one level up, in the model adapter,
 * because a stray fence should not cost the operator a whole generation run.
 */
export function parseJsonOnly(raw) {
  if (typeof raw !== 'string') throw new Error('Model response must be a string');
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) throw new Error('Model returned surrounding text or markdown');
  return JSON.parse(trimmed);
}

/**
 * Lift the JSON object out of a model response before the strict parse above
 * runs on it.
 *
 * The pair is deliberate. parseJsonOnly stays strict because tolerating prose
 * around a JSON object is how half a response becomes a draft. But a stray
 * markdown fence is not worth costing the operator a whole generation run, so
 * that one specific tolerance lives here, is named, and is tested.
 *
 * Returns the string unchanged when it is already clean.
 */
export function unwrapJsonText(text) {
  let out = String(text || '').trim();

  const fenced = out.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) out = fenced[1].trim();

  if (out.startsWith('{') && out.endsWith('}')) return out;

  const first = out.indexOf('{');
  const last = out.lastIndexOf('}');
  if (first !== -1 && last > first) return out.slice(first, last + 1).trim();

  return out;
}
