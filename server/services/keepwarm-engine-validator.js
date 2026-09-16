/**
 * Checks a generated email before it is ever allowed to become a draft.
 *
 * FOUR THINGS HERE DIFFER FROM THE SUPPLIED PACKAGE, all of them found by
 * running it against real Sweetbyte copy rather than against its own examples:
 *
 * 1. THE CALL-TO-ACTION COUNT. The package counted the bare word "call"
 *    anywhere in the body as a call-to-action, so a perfectly good email about
 *    business phones — one of the engine's own subject areas — failed, because
 *    "when a call comes in" is a sentence about telephones, not an invitation
 *    to ring anybody. It now looks for an actual invitation.
 *
 * 2. THE OPERATOR'S OWN SUBJECT LINES. Studio lets Billy tick his own subject
 *    lines and writes bodies under them, passing the line through untouched
 *    apart from the standing prefix. The package checked every subject against
 *    a character limit, a spam word list and a no-exclamation-marks rule, which
 *    would have refused a hand-written line — and, because the line is not
 *    allowed to change, could never have recovered from it. A supplied fixed
 *    subject skips the subject checks entirely and is only checked for having
 *    come back unaltered. That is a settled Studio decision, not an oversight.
 *
 * 3. THE CHARACTER LIMIT IS MEASURED AFTER THE PREFIX. Every generated subject
 *    now begins "Sweetbyte IT - ". Counting those fifteen standing characters
 *    against a limit meant to keep a subject readable in an inbox would shorten
 *    every subject line for no reason, so the limit applies to the part the
 *    model actually wrote.
 *
 * 4. BULLETS AND BOLD ARE CHECKED, NOT BANNED. The first version of these rules
 *    refused any line that looked like a list. An email now has to contain a
 *    bullet section, and the checks below are what stop that turning into a
 *    free-for-all: three to five bullets, together, each led by one short bold
 *    label, and bold nowhere else in the email.
 */

import { PARAGRAPH_STYLE } from './keepwarm-engine-prompts.js';
import { SUBJECT_PREFIX, stripSubjectPrefix } from './keepwarm-engine-patterns.js';

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
  // The bullet character is now allowed and required. Hyphens, asterisks and
  // numbers at the start of a line are still refused: they are what a model
  // reaches for when it ignores the bullet format, and they arrive in Outlook
  // as plain punctuation rather than as a list.
  [/^\s*(?:[-*]|\d+[.)])\s+/m, 'Use bullet lines beginning with the bullet character, not hyphens, asterisks or numbers'],
];

// An invitation to reply, and an invitation to telephone. Both are deliberately
// narrow: they match somebody being asked to do something, not the words
// "reply" or "call" appearing in a sentence about something else.
const CTA_REPLY = /\breply\b|\bget in touch\b|\blet us know\b|\bdrop us a line\b|\bwrite back\b/i;
const CTA_CALL = /\bgive (?:us|me) a (?:call|ring)\b|\bcall us\b|\bring us\b|\bphone us\b|\bcall the (?:number|office)\b|\bcall on the number\b/i;

const SPAMMY_SUBJECT = /\b(?:free|act now|limited time|urgent|guaranteed|exclusive deal|buy now|offer|discount|save money|winner|cash|risk-free)\b/i;

// One bullet, in each half of the email. The label is bold, ends in a colon,
// and is followed by ordinary text. Anything else is not a bullet Studio wrote.
const HTML_BULLET = /^•\s<strong>[^<>]{2,45}:<\/strong>\s\S/;
const PLAIN_BULLET = /^•\s\*\*[^*\n]{2,45}:\*\*\s\S/;

const MIN_BULLETS = 3;
const MAX_BULLETS = 5;

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

/**
 * The wording with its emphasis markers taken off, so the HTML half and the
 * plain half can be compared on what the reader actually sees. <strong> in one
 * and ** in the other is the single difference the rules allow between them,
 * and it must not register as a mismatch.
 */
function withoutEmphasis(value) {
  return String(value).replace(/<\/?strong>/gi, '').replace(/\*\*/g, '');
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
  if (!subject.startsWith(SUBJECT_PREFIX)) errors.push(`Subject must begin exactly "${SUBJECT_PREFIX}"`);
  const written = stripSubjectPrefix(subject);
  if (!written) errors.push('Subject is nothing but the prefix');
  if (written.length > 48) errors.push('Subject exceeds the 48-character limit after the prefix');
  if (subject.includes('!') || subject.includes('—')) errors.push('Subject contains forbidden punctuation');
  if (/[^\p{L}\p{N}\p{P}\p{Zs}]/u.test(subject)) errors.push('Subject appears to contain emoji or symbols');
  if (SPAMMY_SUBJECT.test(written)) errors.push('Subject contains promotional or spam-like wording');
  if (/SweetByte|Sweet Byte/.test(written)) errors.push('Sweetbyte is misspelled');
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
  if (/[^\p{L}\p{N}\p{P}\p{Zs}\n\r•]/u.test(email.plain)) errors.push('Body appears to contain emoji or unsupported symbols');

  const paragraphs = extractHtmlParagraphs(email.html);
  if (paragraphs.length < 6 || paragraphs.length > 9) errors.push('HTML must contain six to nine paragraphs');
  const rebuilt = paragraphs.map(p => `<p style="${PARAGRAPH_STYLE}">${p}</p>`).join('');
  if (rebuilt !== email.html) errors.push('HTML contains invalid markup, spacing or paragraph styles');

  // Inside a paragraph, a bold label is the only markup allowed. Taking the
  // <strong> pairs out should leave text with no angle brackets in it at all.
  for (const paragraph of paragraphs) {
    if (/<[^>]*>/.test(paragraph.replace(/<strong>[^<>]+<\/strong>/g, ''))) {
      errors.push('A paragraph contains markup other than a bold label');
      break;
    }
  }

  const plainParagraphs = email.plain.replace(/\r/g, '').split(/\n\n+/).map(x => x.trim()).filter(Boolean);
  if (normaliseText(withoutEmphasis(paragraphs.map(decodeHtml).join('\n\n')))
      !== normaliseText(withoutEmphasis(plainParagraphs.join('\n\n')))) {
    errors.push('HTML and plain text wording do not match');
  }

  // ── The bullet section ────────────────────────────────────────────────────
  const decoded = paragraphs.map(decodeHtml);
  const bulletIndexes = decoded
    .map((paragraph, index) => (paragraph.trim().startsWith('•') ? index : -1))
    .filter(index => index >= 0);

  if (bulletIndexes.length < MIN_BULLETS || bulletIndexes.length > MAX_BULLETS) {
    errors.push(`Body must contain one bullet section of ${MIN_BULLETS} to ${MAX_BULLETS} bullet points, each beginning with the bullet character`);
  }
  if (bulletIndexes.length) {
    const first = bulletIndexes[0];
    if (!bulletIndexes.every((index, offset) => index === first + offset)) {
      errors.push('The bullet points must sit together as one section');
    }
    if (first === 0) errors.push('The email must open with a paragraph, not with a bullet point');
    if (bulletIndexes[bulletIndexes.length - 1] === decoded.length - 1) {
      errors.push('The email must close with a paragraph, not with a bullet point');
    }
    for (const index of bulletIndexes) {
      const htmlBullet = decoded[index].trim();
      const plainBullet = (plainParagraphs[index] ?? '').trim();
      if (!HTML_BULLET.test(htmlBullet)) {
        errors.push('Each bullet must begin with one short bold label ending in a colon');
      }
      if (!PLAIN_BULLET.test(plainBullet)) {
        errors.push('Each plain-text bullet must carry the matching **bold label:**');
      }
      const bulletWords = words(withoutEmphasis(htmlBullet).replace(/^•\s*/, '')).length;
      if (bulletWords < 2 || bulletWords > 18) errors.push('Each bullet must contain 2 to 18 words');
    }
  }

  const strongCount = (email.html.match(/<strong>/g) ?? []).length;
  const plainBoldCount = Math.floor((email.plain.match(/\*\*/g) ?? []).length / 2);
  if (strongCount !== bulletIndexes.length || plainBoldCount !== bulletIndexes.length) {
    errors.push('Bold must appear once at the start of every bullet and nowhere else');
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
