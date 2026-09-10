/**
 * server/services/keepwarm-generator.js — writes keep-warm email drafts.
 *
 * Mirrors the shape of the LinkedIn post generator in services/claude.js: ask
 * for a batch, get structured JSON back, hand the operator a set to choose
 * from. Emails rather than posts, and no images.
 *
 * SOURCE OF TRUTH
 * server/assets/sweetbyte-company-rag.md, read once at module load. It carries
 * its own guardrails in §9 — no statistic outside §3 or §7, no client name
 * outside §8, no surname for anyone except Sweetman, UK spelling — and those
 * are restated as hard rules in the prompt rather than left for the model to
 * notice while reading. A generator that invents a plausible-sounding uptime
 * figure is worse than one that produces nothing, because the invented figure
 * goes out over Billy's name.
 *
 * WHAT COMES BACK
 * Each draft is a complete email: one subject line and one body. The operator
 * picks the ones worth keeping and bins the rest, so the batch is a set of
 * genuine alternatives rather than a queue to work through — which is why the
 * prompt insists each one open differently. Three variations on "Fed up with
 * slow IT support?" is one draft with extra steps.
 *
 * NO IMAGES, NO ATTACHMENT, NO TRACKING PIXEL
 * Deliberate, and each for its own reason. Images because a cold-ish B2B email
 * that looks like a newsletter gets filed like one. The brochure because a 4MB
 * attachment on repeat sends is a deliverability problem. The pixel is a Phase 2
 * question and is not decided here.
 *
 * HTML SHAPE
 * Plain, inline-styled, single column, no tables and no media queries. The font
 * stack matches service-email-templates.js so the introduction email and the
 * keep-warm emails that follow it look like they came from the same person —
 * because they did.
 *
 * Env: ANTHROPIC_API_KEY (required).
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── The RAG ──────────────────────────────────────────────────────────────────
// Read once at module load. It changes between deploys, never between calls,
// and re-reading it per generation would be a disk hit for no benefit.
//
// A missing file IS fatal here, unlike the brochure in service-email-sender.js.
// The difference matters: an introduction email without its attachment is still
// a correct email, whereas generating marketing copy with no company knowledge
// produces confident, fluent, wrong text over Billy's signature.
const RAG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'sweetbyte-company-rag.md',
);

let RAG = null;
try {
  RAG = fs.readFileSync(RAG_PATH, 'utf8');
  console.log(`[keepwarm] company RAG loaded (${Math.round(RAG.length / 1024)}KB)`);
} catch (err) {
  console.error(`[keepwarm] COMPANY RAG MISSING at ${RAG_PATH} — generation will refuse to run. ${err.message}`);
}

export function ragLoaded() { return !!RAG; }

export const ALLOWED_COUNTS = [3, 6, 9];

// ── Email shell ──────────────────────────────────────────────────────────────
// Matches service-email-templates.js: Aptos first because that is what
// Sweetbyte writes in, degrading through Calibri and Segoe UI to Arial so it
// never lands on Times New Roman. Points not pixels, because Office sizes in
// points and 11px renders noticeably smaller than the size 11 the copy was
// written at. Applied inline on every element rather than once on a wrapper,
// because Outlook's Word renderer does not reliably inherit fonts into <p>.
const FONT = "font-family:Aptos,'Aptos Display',Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;";
const P_STYLE = `margin:0 0 1em;${FONT}`;

/**
 * The signature block. Hardcoded to Billy rather than driven by an env var,
 * for the same reason the introduction email's is: a job title and a phone
 * number cannot be derived from a first name. These emails come from Billy's
 * address, so they carry Billy's name. If Joe or Lewis ever send them, this
 * block needs editing.
 *
 * No brochure attachment — the website, the address and the number are the
 * whole footer, as agreed.
 */
export function signatureHtml() {
  return `
  <p style="${P_STYLE}">Thanks,<br>
  <strong>Billy Crockett</strong><br>
  Sweetbyte Ltd</p>
  <p style="margin:0 0 1em;${FONT}color:#444;">
    <a href="https://sweetbyte.co.uk" style="color:#1EA4C9;text-decoration:none;">sweetbyte.co.uk</a><br>
    <a href="mailto:billy@sweetbyte.co.uk" style="color:#1EA4C9;text-decoration:none;">billy@sweetbyte.co.uk</a><br>
    01702 540776
  </p>`;
}

/**
 * Assemble a finished email: the generated body, then the signature, then the
 * opt-out line.
 *
 * ONE renderer, used by both the preview and (in the next phase) the send, so
 * what the operator approves on screen is byte-for-byte what leaves the
 * building. Two renderers is how an email gets approved in one wording and
 * delivered in another.
 *
 * `unsubUrl` is optional only so the preview can render before an address is
 * known. A send must always pass one — an unsubscribe link is not decoration
 * on a repeat marketing email, it is the thing that makes sending it lawful.
 */
export function renderEmailHtml({ bodyHtml, unsubUrl = null, firstName = null }) {
  const greeting = `<p style="${P_STYLE}">Hi ${firstName || 'there'},</p>`;

  const optOut = unsubUrl
    ? `<p style="margin:24px 0 0;${FONT}font-size:9pt;color:#888;">
         Not useful? <a href="${unsubUrl}" style="color:#888;">Unsubscribe</a> and we will not email you again.<br>
         Sweetbyte Ltd, Studio 6, Lower Barn Farm, London Road, Rayleigh, Essex, SS6 9ET. Company 09949224.
       </p>`
    : `<p style="margin:24px 0 0;${FONT}font-size:9pt;color:#888;">
         Not useful? Unsubscribe and we will not email you again.<br>
         Sweetbyte Ltd, Studio 6, Lower Barn Farm, London Road, Rayleigh, Essex, SS6 9ET. Company 09949224.
       </p>`;

  return `<div style="max-width:600px;${FONT}color:#222;">
${greeting}
${bodyHtml}
${signatureHtml()}
${optOut}
</div>`;
}

// ── Plain text in, styled HTML out ───────────────────────────────────────────
//
// The operator edits plain paragraphs and never sees a tag. The inline styling
// is not a choice anybody makes per email — it exists so Outlook's Word
// renderer does not fall back to Times New Roman — so putting it in front of
// somebody rewording a sentence is showing them plumbing they cannot usefully
// change and can easily break.
//
// This conversion lives here, on the server, next to P_STYLE. Doing it in the
// browser would mean a second copy of the style string, and two copies of a
// constant drift the moment one of them is edited.
//
// The round trip is lossless because the generated body is only ever plain
// paragraphs — the prompts forbid headings, tables, links and inline emphasis
// precisely so that stripping to text and rebuilding loses nothing. If a future
// prompt ever reintroduces inline markup, this pair stops being safe and the
// editor has to change with it.

/**
 * Styled paragraphs → plain text, blank line between paragraphs.
 */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .split(/<\s*\/\s*p\s*>/i)
    .map(chunk => chunk.replace(/<[^>]*>/g, ''))
    .map(chunk => chunk
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/gi, "'"))
    .map(chunk => chunk.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Plain text → styled paragraphs.
 *
 * Escaping first is not optional. An ampersand or an angle bracket typed into
 * the box would otherwise be written into the message as markup, and the reader
 * would get a mangled sentence or a swallowed one.
 */
export function textToHtml(text) {
  const escape = (t) => String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p style="${P_STYLE}">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You write keep-warm marketing emails for Sweetbyte Ltd, an Essex-based managed IT services provider.

These go to small-business owners and office managers who took a cold call from Sweetbyte, were sent an introduction email, and have not said no. They are busy, not technical, and did not ask to hear from you again. Earn the read.

The company knowledge base you are given is the ONLY permitted source of fact. Treat it as absolute.`;

function buildUserPrompt(count, avoid) {
  const avoidBlock = avoid.length
    ? `\nALREADY USED — do not repeat these subjects, and do not rework these angles:\n${avoid.map(a => `- "${a.subject}"${a.angle ? ` (angle: ${a.angle})` : ''}`).join('\n')}\n`
    : '';

  return `COMPANY KNOWLEDGE BASE:
${RAG}
${avoidBlock}
Write ${count} completely different keep-warm emails.

HARD RULES — breaking any of these makes the email unusable:
1. Do not state a statistic, price, percentage or time figure that is not in section 3 or section 7 of the knowledge base. If you want a number and cannot find one, write the sentence without a number.
2. Do not name a client that is not in section 8.
3. Do not give a surname for any team member except Sweetman.
4. UK English throughout: specialises, optimisation, defence, modernise, organisation.
5. Never write "SweetByte" or "Sweet Byte". It is "Sweetbyte", one word, capital S only.
6. No em dashes. No exclamation marks. No emoji. No images.
7. Do not claim the reader is an existing customer, do not reference a specific conversation, and do not invent anything about their business. You do not know what they do.
8. Do not write a sign-off, a signature, a phone number or an unsubscribe line. Those are added afterwards. End on the last sentence of your final paragraph.

SUBJECT LINES:
Short, specific and human. Aim under 55 characters. It should read like a line from a person, not a campaign. The strongest openers in Sweetbyte's own material frame the reader's pain as a question, or set Sweetbyte against how other IT companies behave. Avoid words that trip spam filters and avoid anything that reads as a mass mailing.

BODY:
120 to 200 words. Short paragraphs, two or three sentences each. Plain English, first person plural, address the reader as "you", no jargon. Open on something the reader recognises about their own situation, make one point well, and close with a single low-pressure call to action — a reply, or a call on the number in the signature. One idea per email. Do not try to cover the whole service catalogue.

VARIETY — this matters most:
Each of the ${count} emails must take a genuinely different angle: a different service area, a different reader pain, a different opening move. If two of them could swap subject lines without anyone noticing, you have written the same email twice.

HTML:
Body must be plain HTML paragraphs only. Every paragraph exactly: <p style="${P_STYLE}">text</p>
No bold, no <strong>, no headings, no tables, no images, no inline links, no lists. Paragraphs only — the operator edits these as plain text, so any inline markup would be lost the first time they reword a sentence.

Return ONLY valid JSON, no other text, no markdown fences:
{
  "emails": [
    {
      "angle": "four to six words naming the angle, e.g. 'backup failure pain'",
      "subject": "the subject line",
      "html": "<p style=\\"${P_STYLE}\\">First paragraph...</p><p style=\\"${P_STYLE}\\">Second...</p>",
      "plain": "the same email as plain text, paragraphs separated by blank lines"
    }
  ]
}

Generate exactly ${count}.`;
}

// ── Regenerating one half at a time ──────────────────────────────────────────
//
// Two separate jobs, and conflating them wastes the operator's work. Wanting a
// punchier subject is not wanting a different email, and being happy with the
// subject while the body reads flat is not a reason to lose the subject.
//
// Both of these take the CURRENT text as it stands on screen, including
// unsaved typing, rather than whatever was last written to the database. If
// somebody has reworded a paragraph and then asks for a new subject line, the
// subject has to be written for the paragraph they can see.

/**
 * A new subject line for a body that is staying as it is.
 *
 * `avoid` is everything already tried — subjects used on other drafts, plus the
 * ones rejected during this sitting. Without it the model converges on the same
 * two or three phrasings and pressing the button again appears to do nothing.
 *
 * Returns one line, not a list. The screen keeps the previous subjects as
 * chips, so pressing again is how you see alternatives, and nothing is lost by
 * showing one at a time.
 */
export async function generateSubject({ bodyHtml, avoid = [] }) {
  if (!RAG) throw new Error('Company knowledge base is missing from the server — cannot generate.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on Studio.');

  const avoidBlock = avoid.length
    ? `\nDo not produce any of these, or a close variation of them:\n${avoid.map(a => `- "${a}"`).join('\n')}\n`
    : '';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `COMPANY KNOWLEDGE BASE:
${RAG}

Here is the body of an email that is already written and is NOT changing:

${bodyHtml}
${avoidBlock}
Write ONE new subject line for it.

Rules:
- It must match what the body actually says. A subject promising something the body does not deliver is worse than a dull one.
- Short, specific, human. Under 55 characters if you can.
- Frame the reader's pain as a question, or set Sweetbyte against how other IT companies behave. Those are the two openers that work in Sweetbyte's own material.
- No em dashes, no exclamation marks, no emoji, no ALL CAPS.
- UK English. "Sweetbyte" is one word, capital S only.
- Do not state a figure that is not in section 3 or section 7 of the knowledge base.

Return ONLY the subject line as plain text. No quotes, no label, no explanation.`,
    }],
  });

  const line = (message.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .split('\n')[0]
    .trim();

  if (!line) throw new Error('Claude returned an empty subject line.');
  return line.slice(0, 200);
}

/**
 * A new body for a subject that is staying as it is.
 *
 * Deliberately kept on the same topic. The subject is fixed, so wandering onto
 * a different service would produce an email whose first line contradicts its
 * second — this is a rewrite, not a fresh idea. The current body is passed in
 * so the model can be told what to move away from rather than accidentally
 * reproducing it.
 */
export async function generateBody({ subject, currentHtml }) {
  if (!RAG) throw new Error('Company knowledge base is missing from the server — cannot generate.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on Studio.');

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `COMPANY KNOWLEDGE BASE:
${RAG}

This subject line is fixed and is NOT changing:

"${subject}"

This is the current body. Write a better one on the same topic. Do not reuse its sentences.

${currentHtml}

HARD RULES:
1. The body must deliver what the subject promises. Same topic, fresh execution.
2. Do not state a statistic, price, percentage or time figure that is not in section 3 or section 7 of the knowledge base.
3. Do not name a client that is not in section 8.
4. No surname for any team member except Sweetman.
5. UK English. "Sweetbyte" is one word, capital S only.
6. No em dashes, no exclamation marks, no emoji, no images.
7. Do not claim the reader is an existing customer, do not reference a specific conversation, and do not invent anything about their business.
8. No sign-off, no signature, no phone number, no unsubscribe line. Those are added afterwards. End on the last sentence of your final paragraph.

LENGTH AND SHAPE: 120 to 200 words. Short paragraphs of two or three sentences. Plain English, first person plural, address the reader as "you". Open on something the reader recognises about their own situation, make one point well, close with a single low-pressure call to action.

HTML: plain paragraphs only, each exactly <p style="${P_STYLE}">text</p>. No bold, no <strong>, no headings, no tables, no images, no inline links.

Return ONLY valid JSON, no markdown fences:
{"html":"<p style=\\"${P_STYLE}\\">...</p>","plain":"the same email as plain text"}`,
    }],
  });

  const text = (message.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude did not return JSON. First 200 characters: ' + text.slice(0, 200));

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    throw new Error('Claude returned malformed JSON: ' + err.message);
  }

  const html = typeof parsed.html === 'string' ? parsed.html.trim() : '';
  if (!html) throw new Error('Claude returned an empty email body.');

  return { html, plain: typeof parsed.plain === 'string' ? parsed.plain.trim() : null };
}


/**
 * Write one email around a subject line the operator wrote.
 *
 * Distinct from generateBody() above, which rewrites an existing body and needs
 * one to move away from. This starts from nothing but the line.
 *
 * The subject is passed through untouched and returned untouched. It is never
 * shown to the model as something to improve, because the whole point is that
 * these are in Billy's voice rather than the model's, and a model asked to
 * consider a line will tidy it into house style without being told to.
 *
 * `avoid` is the do-not-repeat list, used here only to stop the BODY retreading
 * an angle that has already gone out. The subject is fixed regardless.
 */
export async function generateFromSubject({ subject, avoid = [] }) {
  if (!RAG) throw new Error('Company knowledge base is missing from the server — cannot generate.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on Studio.');

  const fixed = String(subject || '').trim();
  if (!fixed) throw new Error('No subject line given.');

  const avoidBlock = avoid.length
    ? `\nANGLES ALREADY USED — do not retread these:\n${avoid.map(a => `- "${a.subject}"${a.angle ? ` (angle: ${a.angle})` : ''}`).join('\n')}\n`
    : '';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `COMPANY KNOWLEDGE BASE:
${RAG}

The subject line is FIXED. It was written by hand and is not yours to improve, shorten, punctuate differently or reword in any way:

"${fixed}"

Write the email that belongs under it.
${avoidBlock}
HARD RULES:
1. The body must deliver what the subject promises. If the subject is a joke about IT frustration, the first line must land that recognition before it sells anything.
2. Do not state a statistic, price, percentage or time figure that is not in section 3 or section 7 of the knowledge base.
3. Do not name a client that is not in section 8.
4. No surname for any team member except Sweetman.
5. UK English. "Sweetbyte" is one word, capital S only.
6. No em dashes, no exclamation marks, no emoji, no images.
7. Do not claim the reader is an existing customer, do not reference a specific conversation, and do not invent anything about their business.
8. No sign-off, no signature, no phone number, no unsubscribe line. Those are added afterwards. End on the last sentence of your final paragraph.

LENGTH AND SHAPE: 120 to 200 words. Short paragraphs of two or three sentences. Plain English, first person plural, address the reader as "you". Open on something the reader recognises about their own situation, make one point well, close with a single low-pressure call to action.

HTML: plain paragraphs only, each exactly <p style="${P_STYLE}">text</p>. No bold, no <strong>, no headings, no tables, no images, no inline links.

Return ONLY valid JSON, no markdown fences:
{"angle":"four to six words naming the angle","html":"<p style=\\"${P_STYLE}\\">...</p>","plain":"the same email as plain text"}`,
    }],
  });

  const text = (message.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude did not return JSON. First 200 characters: ' + text.slice(0, 200));

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    throw new Error('Claude returned malformed JSON: ' + err.message);
  }

  const html = typeof parsed.html === 'string' ? parsed.html.trim() : '';
  if (!html) throw new Error('Claude returned an empty email body for "' + fixed + '".');

  // The operator's line, returned exactly as it was given. Nothing the model
  // said about the subject is read back.
  return {
    subject: fixed,
    angle:   String(parsed.angle || '').trim().slice(0, 120) || null,
    html,
    plain:   typeof parsed.plain === 'string' ? parsed.plain.trim() : null,
  };
}


/**
 * Ask Claude for `count` drafts.
 *
 * Throws on anything that would produce silently wrong output — missing RAG,
 * missing key, unparseable response, wrong number of emails back. The screen
 * shows the thrown message verbatim, because "the model returned 2 emails
 * instead of 6" is something the operator can act on and "generation failed"
 * is not.
 */
export async function generateEmails(count, previous = []) {
  if (!RAG) throw new Error('Company knowledge base is missing from the server — cannot generate.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on Studio.');
  // Not restricted to ALLOWED_COUNTS. Those are the buttons on the screen; this
  // is how many the model is asked for, and when the operator has picked two of
  // their own subject lines out of a batch of six, this is asked for four.
  if (!Number.isInteger(count) || count < 1 || count > 9) {
    throw new Error('Count must be a whole number between 1 and 9.');
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(count, previous) }],
  });

  const text = (message.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  // The model is told not to use markdown fences, but a stray one should not
  // cost the operator a whole generation run.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude did not return JSON. First 200 characters: ' + text.slice(0, 200));

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    throw new Error('Claude returned malformed JSON: ' + err.message);
  }

  const emails = Array.isArray(parsed.emails) ? parsed.emails : [];
  const clean = emails
    .filter(e => e && typeof e.subject === 'string' && typeof e.html === 'string')
    .map(e => ({
      angle:   String(e.angle || '').trim().slice(0, 120) || null,
      subject: String(e.subject).trim().slice(0, 200),
      html:    String(e.html).trim(),
      plain:   typeof e.plain === 'string' ? e.plain.trim() : null,
    }))
    .filter(e => e.subject && e.html);

  if (clean.length === 0) throw new Error('Claude returned no usable emails.');

  return clean;
}
