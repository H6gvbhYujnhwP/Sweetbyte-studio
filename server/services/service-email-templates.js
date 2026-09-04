/**
 * server/services/service-email-templates.js — copy for WorkTrackr service emails.
 *
 * ONE service. This file used to hold twelve; the product decision in Sep 2026
 * was to send a single introduction email after a cold call rather than ask the
 * caller to pick topics. The multi-service machinery has been removed rather
 * than left dormant — dead branches in copy-rendering code are how the wrong
 * paragraph ends up in front of a customer.
 *
 * If a second service is ever wanted, add it to SERVICES and reinstate the
 * combining logic from git history (commit prior to the single-service change).
 *
 * Everything a prospect reads is in this file. No copy lives in the sender.
 */

// The one service. `key` is written into service_email_sends rows and is the
// dedup key, so it is permanent once the first email has gone out.
export const SERVICES = [
  {
    key: 'sweetbyte_intro',
    label: 'About Sweetbyte',
    order: 1,
  },
];

const BY_KEY = new Map(SERVICES.map(s => [s.key, s]));

/**
 * Follow-up copy has not been written yet. While this is false the sender will
 * not schedule a step-2 row at all, so there is no way for an empty follow-up
 * to reach a prospect. Flip to true in the same commit that fills in
 * FOLLOWUP_BODY and FOLLOWUP_SUBJECT below — not before.
 */
export const FOLLOWUP_READY = false;

const FOLLOWUP_SUBJECT = ''; // TODO: follow-up subject line
const FOLLOWUP_BODY    = ''; // TODO: follow-up body, same HTML shape as BODY

// ─────────────────────────────────────────────────────────────────────────────
// Copy
// ─────────────────────────────────────────────────────────────────────────────

// Typography. Aptos is Office's default and is what Sweetbyte writes in, but it
// ships with Office rather than being a web font — a Gmail user on a Mac or a
// phone will not have it. The fallback chain degrades through Calibri (older
// Office) and Segoe UI (Windows) to Arial, so the email stays close in feel
// everywhere without ever falling back to Times New Roman.
//
// 11pt not 11px: Office sizes in points, and 11px would render noticeably
// smaller than the "size 11" the copy was written at.
//
// Applied inline on every element rather than once on a wrapper, because
// Outlook's Word renderer does not reliably inherit fonts into <p> and <li style="${FONT}">.
const FONT = "font-family:Aptos,'Aptos Display',Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;";
const P_STYLE = `margin:0 0 1em;${FONT}`;

const BODY = `
  <p style="${P_STYLE}">Hi [NAME], thanks for taking my call today. I appreciate you're busy and
  there's never really a good time for an unexpected IT call!</p>

  <p style="${P_STYLE}">Just to give you a little background on us. We're a local IT company based
  in Essex and have been helping businesses across London and surrounding
  counties with their IT for over 25 years.</p>

  <p style="${P_STYLE}">We try to do things a little differently from other IT providers. We're
  friendly, approachable and flexible, and importantly, we don't believe in
  tying customers into lengthy contracts. Our aim is simply to become an
  extension of your business and be there when you need us.</p>

  <p style="${P_STYLE}">We can help with everything from day-to-day IT support through to larger
  projects, including:</p>

  <ul style="margin:0 0 1em;padding-left:20px;${FONT}">
    <li style="${FONT}">Flexible managed IT support</li>
    <li style="${FONT}">Microsoft 365, email and cloud backups</li>
    <li style="${FONT}">Cyber security and Cyber Essentials</li>
    <li style="${FONT}">Business internet, Wi-Fi and VoIP telephony</li>
    <li style="${FONT}">Websites and custom app development</li>
    <li style="${FONT}">Domain names and digital services</li>
    <li style="${FONT}">Business automation and bespoke software solutions</li>
  </ul>

  <p style="${P_STYLE}">I've attached our brochure, which goes into a bit more detail on everything
  we do.</p>

  <p style="${P_STYLE}">There's absolutely no pressure from our side. I'd be happy to give you
  another call next week when hopefully the timing is a little better, or if you
  prefer, we can arrange a convenient time for me to pop over, introduce myself
  and have an informal chat about your current IT setup and where we may be able
  to help.</p>

  <p style="${P_STYLE}">Feel free to reply to this email with a day or time that works for you, or
  you can reach me on 01702 540776.</p>

  <p style="${P_STYLE}">{{ThanksAgain}} and hopefully we'll speak soon.</p>
`;

// Signature block. Hardcoded rather than driven by SERVICE_EMAIL_SENDER_NAME:
// a job title, phone number and company name can't be derived from a first
// name, so if someone other than Billy ever sends these, this block needs
// editing rather than an env var flipping.
//
// Inline styles only — Gmail and Outlook both strip <style> blocks from the
// head, so anything relying on a class silently loses its formatting.
const SIGNATURE = `
  <p style="margin:16px 0 0;${FONT}">
    <strong>Billy Crockett</strong>&nbsp; |&nbsp; Business Development Consultant<br>
    Sweetbyte Ltd<br>
    01702 540776<br>
    <a href="https://www.sweetbyte.co.uk" style="color:#0b6bcb;">www.sweetbyte.co.uk</a>
  </p>
`;

// ─────────────────────────────────────────────────────────────────────────────
// Lookup / catalogue
// ─────────────────────────────────────────────────────────────────────────────

export function getService(key) {
  return BY_KEY.get(key) || null;
}

export function isValidServiceKey(key) {
  return BY_KEY.has(key);
}

/**
 * WorkTrackr reads this over the wire rather than holding its own copy, so the
 * button label can change here without redeploying WorkTrackr.
 */
export function getCatalogue() {
  return SERVICES
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(s => ({ key: s.key, label: s.label, order: s.order }));
}

/**
 * Normalise and validate a selection.
 *
 * Kept as an array API even though there is only one service: the bridge
 * contract, the database column and WorkTrackr's mirror table all speak arrays,
 * and narrowing them would be a far wider change than it is worth.
 */
export function normaliseServiceKeys(input) {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set();
  const keys = [];
  const invalid = [];
  for (const k of raw) {
    const key = String(k || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (BY_KEY.has(key)) keys.push(key);
    else invalid.push(key);
  }
  return { keys, invalid };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// First name only. "Dave Smith" → "Dave". Returns null when there is no usable
// name, so callers can choose their own fallback — the subject drops the name
// entirely, the body says "there".
//
// Capitalisation is always normalised, because it is typed in a hurry between
// calls and comes in every shape: "tony", "TONY", "tOnY" and "TOnY" all become
// "Tony". Hyphens and apostrophes are respected, so "jo-anne" → "Jo-Anne" and
// "o'brien" → "O'Brien".
//
// The known trade-off: "McDonald" becomes "Mcdonald". Preserving that would
// mean trusting whatever case was typed, which is exactly what produced "TOnY"
// in a live subject line. Consistency was judged the better bet — a Mc name is
// far rarer than a hurried typo.
function firstNameOrNull(contactName) {
  const n = String(contactName || '').trim();
  if (!n) return null;
  const first = n.split(/\s+/)[0];
  if (!first) return null;

  return first
    .toLowerCase()
    .replace(/(^|[-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

function applyTokens(text, vars) {
  return String(text)
    .replace(/\[NAME\]/g, escapeHtml(vars.firstName))
    .replace(/\{\{ThanksAgain\}\}/g, escapeHtml(vars.thanksAgain))
    .replace(/\{\{SenderName\}\}/g, escapeHtml(vars.senderName))
    .replace(/\{\{CompanyName\}\}/g, escapeHtml(vars.companyName));
}

function buildVars({ companyName, contactName, senderName }) {
  const name = firstNameOrNull(contactName);
  return {
    // "Hi there," is fine as a greeting. "Thanks again, there," is not — the
    // whole clause has to go, not just the word, so the sign-off is built here
    // rather than token-substituted into a fixed sentence.
    firstName: name || 'there',
    thanksAgain: name ? `Thanks again, ${name},` : 'Thanks again,',
    companyName: companyName || 'your business',
    senderName: senderName || 'Billy',
  };
}

/**
 * Subject line.
 *
 *   with a contact name → "Dave - Sweetbyte Introduction"
 *   without one         → "Sweetbyte Introduction"
 *
 * Note this deliberately does NOT use the "there" fallback: "there - Sweetbyte
 * Introduction" in an inbox would look broken.
 */
export function buildSubject(serviceKeys, step, { companyName, contactName, senderName } = {}) {
  if (step === 2) {
    const vars = buildVars({ companyName, contactName, senderName });
    return String(FOLLOWUP_SUBJECT)
      .replace(/\[NAME\]/g, vars.firstName)
      .replace(/\{\{SenderName\}\}/g, vars.senderName)
      .replace(/\{\{CompanyName\}\}/g, vars.companyName);
  }

  const name = firstNameOrNull(contactName);
  return name ? `${name} - Sweetbyte Introduction` : 'Sweetbyte Introduction';
}

/**
 * Assemble the body.
 *
 * Returns a FRAGMENT — ses.js wraps it in the shared email CSS shell so spacing
 * matches everything else the platform sends.
 *
 * `unsubUrl` is required: these go to people who have not opted in, so there is
 * always a working opt-out.
 */
export function renderServiceEmail({
  serviceKeys,
  step = 1,
  companyName,
  contactName,
  senderName,
  unsubUrl,
}) {
  const vars = buildVars({ companyName, contactName, senderName });

  const body = (step === 2)
    ? applyTokens(FOLLOWUP_BODY, vars)
    : applyTokens(BODY, vars);

  const footer = `
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 12px;">
    <p style="font-size:12px;color:#6b7280;margin:0;">
      You're receiving this because we spoke about your requirements. If you'd
      rather not hear from us again,
      <a href="${escapeHtml(unsubUrl)}" style="color:#6b7280;">unsubscribe here</a>
      and we'll stop contacting you.
    </p>
  `;

  return [
    body,
    applyTokens(SIGNATURE, vars),
    footer,
  ].join('\n');
}
