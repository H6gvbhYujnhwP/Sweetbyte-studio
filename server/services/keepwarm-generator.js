/**
 * server/services/keepwarm-generator.js — writes keep-warm email drafts.
 *
 * Mirrors the shape of the LinkedIn post generator in services/claude.js: ask
 * for a batch, get structured JSON back, hand the operator a set to choose
 * from. Emails rather than posts, and no images.
 *
 * HOW THE WRITING HAPPENS
 * The prompt used to be in this file. It now lives in the keepwarm-engine-* files, which
 * assigns each email in a batch its own subject area before asking for
 * anything, and checks every email that comes back before it is allowed to
 * become a draft. This file still owns the knowledge base, the renderer and the
 * text/HTML conversion; it no longer owns the wording of the request.
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
 * Plain, inline-styled, single column, no media queries. The body has no tables
 * in it; the signature does, because a two-column block with a vertical rule is
 * a table in Outlook or it is nothing. The font stack matches
 * service-email-templates.js, and the signature itself is shared with it, so the
 * introduction email and the keep-warm emails that follow it look like they came
 * from the same person — because they did.
 *
 * Env: ANTHROPIC_API_KEY (required).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { signatureHtml, disclaimerHtml } from './email-signature.js';
import { FONT, P_STYLE, htmlToText, textToHtml } from './email-body-style.js';
import { KeepWarmEngine, planInterestSlot } from './keepwarm-engine-core.js';
import { createKeepWarmModel } from './keepwarm-model.js';

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
// FONT and P_STYLE are imported from email-body-style.js. They moved out of
// this file when the generation engine arrived, because the engine's prompt and
// its validator both need the exact same paragraph style, and a second copy
// would drift the first time one of them was edited. Same reasoning as the
// signature: one copy, read by everything.

// The signature used to live here, as a second copy of the one in
// service-email-templates.js. Both are gone: there is one in
// services/email-signature.js and every send path reads it.

/**
 * Assemble a finished email: the generated body, then the signature, then the
 * opt-out line.
 *
 * ONE renderer, used by both the preview and (in the next phase) the send, so
 * what the operator approves on screen is byte-for-byte what leaves the
 * building. Two renderers is how an email gets approved in one wording and
 * delivered in another.
 *
 * `inline` embeds the signature's pictures in the message rather than pointing
 * at hosted copies. A real send passes true; it defaults to false so the
 * on-screen preview, which renders in a browser where cid: means nothing, keeps
 * showing the pictures.
 *
 * `unsubUrl` is optional only so the preview can render before an address is
 * known. A send must always pass one — an unsubscribe link is not decoration
 * on a repeat marketing email, it is the thing that makes sending it lawful.
 */
export function renderEmailHtml({ bodyHtml, unsubUrl = null, firstName = null, inline = false }) {
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
${signatureHtml({ inline })}
${optOut}
${disclaimerHtml()}
</div>`;
}

// ── Plain text in, styled HTML out ───────────────────────────────────────────
//
// Both functions moved to email-body-style.js, next to the paragraph style they
// rebuild paragraphs with. They are re-exported here so every existing import
// of them keeps working: keepwarm-sender.js takes the plain-text half of a
// message from htmlToText, and the draft screen round-trips through both.
//
// Why they moved: the draft editor now has to carry bold labels through an
// edit, which makes the pair the one piece of plumbing a bulleted email depends
// on, and it could not be tested where it was. Importing this file reads the
// company knowledge base off the disk and pulls in the Anthropic SDK, so a test
// of the conversion needed a network library and a file on disk to do its job.
// In email-body-style.js it has no dependencies at all.
//
// htmlToText(html) gives the words with no asterisks, which is what goes out in
// the plain-text half of a real email. htmlToText(html, { keepBold: true })
// gives **Label:** for the editing box. The draft screen asks for the markers;
// the sender does not.

export { htmlToText, textToHtml };


// ── The engine ───────────────────────────────────────────────────────────────
//
// The prompt that used to live in this file has gone. Writing the emails is now
// done by the keepwarm-engine-* files, which plan a distinct subject area for every email
// in a batch before asking for anything, and checks each one that comes back
// against the rules rather than hoping the model followed them.
//
// This file keeps what it always kept: the knowledge base, the renderer, and
// the plain-text/HTML conversion the editor round-trips through. What changed is
// where the writing happens.
//
// A fresh engine per operation, only so the log line says which operation it
// was. They are stateless and share nothing.
function engineFor(label) {
  return new KeepWarmEngine(createKeepWarmModel({ label }));
}

// The do-not-repeat list arrives from the store as rows of { subject, angle }.
// The engine wants subject lines and nothing else, because the list is used for
// two jobs: telling the model what not to retread, and measuring how similar a
// new subject is to an old one. Folding the angle text into the same string
// would pollute that similarity measure and let a genuine repeat through.
//
// The angles are not lost. Variety across a batch is handled properly now, by
// assigning each email its own subject area before the model sees the request.
function doNotRepeatFrom(previous) {
  return [...new Set(
    (Array.isArray(previous) ? previous : [])
      .map(p => (typeof p === 'string' ? p : p && p.subject))
      .filter(Boolean)
      .map(String),
  )];
}

function requireRag() {
  if (!RAG) throw new Error('Company knowledge base is missing from the server — cannot generate.');
}

/**
 * A new subject line for a body that is staying as it is.
 *
 * `avoid` is everything already tried — subjects used platform-wide, plus the
 * ones rejected during this sitting. Without it the model converges on the same
 * two or three phrasings and pressing the button again appears to do nothing.
 *
 * Returns one line, not a list. The screen keeps the previous subjects as
 * chips, so pressing again is how you see alternatives.
 */
export async function generateSubject({ bodyHtml, avoid = [] }) {
  requireRag();
  const { subject } = await engineFor('subject').rewriteSubject({
    knowledgeBase: RAG,
    body: htmlToText(bodyHtml),
    currentSubject: '',
    rejectedSubjects: doNotRepeatFrom(avoid),
  });
  return String(subject).trim().slice(0, 200);
}

/**
 * A new body for a subject that is staying as it is.
 *
 * Deliberately kept on the same topic. The subject is fixed, so wandering onto
 * a different service would produce an email whose first line contradicts its
 * second — this is a rewrite, not a fresh idea.
 *
 * The subject is passed as fixed, which means the engine checks it came back
 * unchanged and runs no other check on it. That matters when the subject is one
 * the operator typed themselves: a hand-written line is not the model's to
 * shorten or repunctuate, and refusing it for having an exclamation mark in it
 * would be Studio overruling the person using it.
 */
export async function generateBody({ subject, currentHtml }) {
  requireRag();
  const result = await engineFor('body').rewriteBody({
    knowledgeBase: RAG,
    subject: String(subject || '').trim(),
    plainBody: htmlToText(currentHtml),
  });
  return {
    html: String(result.html).trim(),
    plain: typeof result.plain === 'string' ? result.plain.trim() : null,
  };
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
 */
export async function generateFromSubject({ subject, avoid = [] }) {
  requireRag();
  const fixed = String(subject || '').trim();
  if (!fixed) throw new Error('No subject line given.');

  const result = await engineFor('own-line').writeFromSubject({
    knowledgeBase: RAG,
    subject: fixed,
    doNotRepeat: doNotRepeatFrom(avoid),
  });

  // The operator's line, returned exactly as it was given. Nothing the model
  // said about the subject is read back.
  return {
    subject: fixed,
    angle:   String(result.angle || '').trim().slice(0, 120) || null,
    html:    String(result.html).trim(),
    plain:   typeof result.plain === 'string' ? result.plain.trim() : null,
  };
}

/**
 * Write ONE email for a service-interest lane.
 *
 * The topic is not chosen here and it is not chosen by the model. The operator
 * pressed Write on the Microsoft 365 card, so the email is about Microsoft 365.
 * Everything else is the ordinary engine: the same prompt, the same paragraph
 * style, the same bold-label bullets, and the same validator, so a lane email
 * that does not come back in the house shape is rejected exactly like any other.
 *
 * Refuses rather than falling back. A lane with no writing brief throws, because
 * a general email sitting under a Microsoft 365 heading would go out looking
 * correct and nobody would catch it.
 */
export async function generateForInterest({ interestKey, avoid = [], seed } = {}) {
  requireRag();
  const slot = planInterestSlot({ interestKey, seed });

  const batch = await engineFor(`lane:${interestKey}`).generateBatch({
    count: 1,
    knowledgeBase: RAG,
    doNotRepeat: doNotRepeatFrom(avoid),
    slots: [slot],
  });

  const email = batch.emails[0];
  if (!email) {
    const why = batch.rejected?.[0]?.errors?.[0] || 'nothing usable came back';
    throw new Error(`Could not write the ${slot.angle} email: ${why}`);
  }

  return {
    angle:   String(email.angle || slot.angle).trim().slice(0, 120) || null,
    subject: String(email.subject).trim().slice(0, 200),
    html:    String(email.html).trim(),
    plain:   typeof email.plain === 'string' ? email.plain.trim() : null,
  };
}

/**
 * Ask for `count` drafts.
 *
 * Returns { drafts, rejected, requested, extras }.
 *
 * `drafts` are the emails that passed every check. `rejected` describes the
 * ones that did not, so the screen can say what went wrong rather than just
 * showing a smaller number than was asked for. An email that fails its checks
 * is never saved as a draft — but one bad email out of nine does not lose the
 * other eight, which is how the Drafts screen has always worked: the operator
 * keeps what is good and bins the rest.
 *
 * Throws only where there is nothing usable to hand over — no knowledge base,
 * no API key, a response that is not JSON, or a batch in which every email
 * failed. The screen shows the thrown message verbatim, because "the model
 * returned 2 emails instead of 6" is something the operator can act on and
 * "generation failed" is not.
 *
 * Not restricted to ALLOWED_COUNTS. Those are the buttons on the screen; this
 * is how many the model is actually asked for, and when the operator has picked
 * two of their own subject lines out of a batch of six, this is asked for four.
 */
export async function generateEmails(count, previous = []) {
  requireRag();
  if (!Number.isInteger(count) || count < 1 || count > 9) {
    throw new Error('Count must be a whole number between 1 and 9.');
  }

  const result = await engineFor('batch').generateBatch({
    count,
    knowledgeBase: RAG,
    doNotRepeat: doNotRepeatFrom(previous),
  });

  const drafts = result.emails.map(e => ({
    angle:   String(e.angle || '').trim().slice(0, 120) || null,
    subject: String(e.subject).trim().slice(0, 200),
    html:    String(e.html).trim(),
    plain:   typeof e.plain === 'string' ? e.plain.trim() : null,
  }));

  if (drafts.length === 0) throw new Error('The model returned no usable emails.');

  return {
    drafts,
    rejected: result.rejected || [],
    requested: count,
    extras: result.extras || 0,
  };
}
