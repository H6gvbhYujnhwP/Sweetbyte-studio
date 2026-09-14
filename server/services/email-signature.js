/**
 * server/services/email-signature.js — the one email signature, and the one
 * legal disclaimer.
 *
 * WHY THIS FILE EXISTS
 * There were two signatures: signatureHtml() in keepwarm-generator.js and
 * SIGNATURE in service-email-templates.js. Same person, same company, different
 * wording, different phone formatting, different link colour. Two copies of a
 * thing that is meant to be identical drift the moment one of them is edited,
 * and the drift is invisible because nobody reads the introduction email and a
 * keep-warm email side by side. Every send path now reads this file, so there
 * is nothing left to drift.
 *
 * TABLES, NOT DIVS
 * Outlook on Windows renders email with Microsoft Word's engine, which does not
 * do flexbox, floats or max-width. A two-column layout with a vertical rule
 * down the middle is a table there or it is nothing. The rule itself is a
 * two-pixel-wide cell with a background colour rather than a CSS border,
 * because a background colour is the one thing Word's renderer never gets
 * wrong.
 *
 * THE PICTURES TRAVEL WITH THE EMAIL
 * This was built first with the images hosted at Studio's own address, and the
 * first real test proved why that does not work: Outlook blocks remote images
 * by default on anything arriving from outside the recipient's organisation, so
 * the signature landed as a row of "click here to download" placeholders. Most
 * of the people being emailed are on business Outlook and most of them will
 * never click it.
 *
 * So the seven pictures are now embedded in the message. Each is a MIME part
 * with a Content-ID and the HTML refers to it as cid:<that id>. There is
 * nothing to fetch, so nothing to block — which is exactly why a signature
 * built inside Outlook always looks right. Three things follow from the change,
 * all of them improvements:
 *
 *   - No image request reaches Studio's server, so the accidental
 *     open-tracking-by-the-back-door that was raised and accepted when this was
 *     hosted no longer exists. There is nothing in the log to read.
 *   - The onrender.com hostname no longer appears in the source of an email
 *     sent under the Sweetbyte name.
 *   - The whole set is under 6KB, so it costs nothing per send.
 *
 * Alt text is still on every picture, and still reads as a word rather than a
 * gap. Embedded images display in every mail client worth naming, but the
 * signature has to survive one that does not.
 *
 * WEB VERSION STILL EXISTS
 * cid: means nothing in a browser, so the on-screen preview on the Drafts and
 * Schedule tabs would show broken pictures. `inline` therefore defaults to
 * FALSE — hosted URLs, correct in a browser — and the two send paths opt in.
 * That way the preview kept working without a single change to the API routes,
 * and a send path that forgets to opt in produces a slightly worse email rather
 * than a broken one.
 *
 * NOT DRIVEN BY AN ENV VAR
 * Hardcoded to Billy, for the reason both of the old copies gave: a job title,
 * a direct address and a phone number cannot be derived from a first name. If
 * Joe or Lewis ever send these, this file gets edited.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The origin the hosted copies are fetched from, for the on-screen preview and
// for any picture that failed to load off disk. Same fallback as
// service-email-sender.js deliberately: one of them being set and the other not
// would mean an email whose unsubscribe link and whose logo point at different
// hosts, which is worse than both being wrong in the same way.
function publicBaseUrl() {
  return (process.env.PUBLIC_URL || 'https://thegreenagents-studio.onrender.com')
    .replace(/\/+$/, '');
}

// Font stack matches keepwarm-generator.js and service-email-templates.js:
// Aptos first because that is what Sweetbyte writes in, degrading through
// Calibri and Segoe UI to Arial so it never lands on Times New Roman.
const FONT = "font-family:Aptos,'Aptos Display',Calibri,'Segoe UI',Arial,sans-serif;";

const NAVY  = '#0f1d3f'; // the dark half of the swirl in the logo
const CYAN  = '#1ea4c9'; // the light half — the name, and links
const INK   = '#1f2937'; // body text
const MUTED = '#5b6470'; // the detail lines, and the icons, which are drawn in it
const RULE  = '#d5d9de'; // the vertical rule

const FACEBOOK_URL = 'https://www.facebook.com/SweetbyteIT/';

// ── The pictures ─────────────────────────────────────────────────────────────
//
// Read off disk once at module load. They change between deploys, never between
// sends, and re-reading them per email would be seven disk hits per recipient
// for no benefit.
//
// A missing file is NOT fatal, unlike the company RAG in keepwarm-generator.js.
// The difference: generating copy with no company knowledge produces confident
// wrong text over Billy's name, whereas a signature short one icon is still a
// correct email. So a file that will not read is shouted about in the log at
// boot and that picture falls back to its hosted URL — which is what it did
// before this change, and still works after one click. Silence would be the
// problem; a loud line in the log and a working email is not.
const PUBLIC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
);

const IMAGE_FILES = [
  'sig-sweetbyte.png',
  'sig-facebook.png',
  'sig-phone.png',
  'sig-email.png',
  'sig-web.png',
  'sig-address.png',
  'sig-reg.png',
];

const LOADED = new Map(); // filename -> Buffer

for (const file of IMAGE_FILES) {
  try {
    LOADED.set(file, fs.readFileSync(path.join(PUBLIC_DIR, file)));
  } catch (err) {
    console.error(
      `[signature] MISSING ${path.join('public', file)} — it will be requested over the web instead, ` +
      `which Outlook blocks by default. ${err.message}`,
    );
  }
}

const totalBytes = [...LOADED.values()].reduce((n, b) => n + b.length, 0);
console.log(
  `[signature] ${LOADED.size}/${IMAGE_FILES.length} pictures embedded (${Math.round(totalBytes / 1024)}KB per email)`,
);

// A Content-ID per picture. Derived from the filename so the two can never
// disagree, and prefixed so it cannot collide with anything else in a message.
function cidFor(file) {
  return `sb-${file.replace(/\.png$/, '')}`;
}

/**
 * The pictures, in the shape sendEmail() wants for `inlineImages`.
 *
 * Only ones that actually loaded — a send must not carry an empty part, and
 * signatureHtml() points the same picture at its hosted URL in that case, so
 * the two stay in step without either having to ask the other.
 */
export function signatureImages() {
  return IMAGE_FILES
    .filter(f => LOADED.has(f))
    .map(f => ({
      cid:         cidFor(f),
      filename:    f,
      contentType: 'image/png',
      content:     LOADED.get(f),
    }));
}

// One <img>. Embedded when the send path asked for it and the file is in hand,
// hosted otherwise.
function img(file, { inline, width, height, alt, extraStyle = '' }) {
  const src = (inline && LOADED.has(file))
    ? `cid:${cidFor(file)}`
    : `${publicBaseUrl()}/${file}`;
  return `<img src="${src}" width="${width}" height="${height}" alt="${alt}"`
    + ` style="display:block;border:0;outline:none;text-decoration:none;${extraStyle}">`;
}

// One row of the detail block: icon, then text. The icon cell has a fixed width
// so the text edges line up whether the pictures showed or not.
function detailRow(file, alt, html, inline) {
  return `
      <tr>
        <td width="24" style="width:24px;padding:3px 8px 3px 0;vertical-align:top;">
          ${img(file, { inline, width: 14, height: 14, alt })}
        </td>
        <td style="padding:3px 0;vertical-align:top;${FONT}font-size:9pt;color:${MUTED};line-height:1.45;">${html}</td>
      </tr>`;
}

/**
 * The legal disclaimer, for the footer — below the unsubscribe line on
 * keep-warm, below the "why you're getting this" line on the introduction and
 * follow-up emails.
 *
 * Shared for the same reason the signature is: two copies of a legal notice
 * that are meant to be identical are one edit away from disagreeing, and a
 * disagreement between two versions of a disclaimer is worse than not having
 * one.
 *
 * Set smaller and greyer than the unsubscribe line above it, deliberately. It
 * has to be present and readable; it does not have to compete with the email.
 * The bank-details line is the one that earns its place — invoice-redirection
 * fraud starts with an email from a supplier's real address, and a standing
 * statement that Sweetbyte never changes details without a phone call is the
 * cheapest defence there is.
 */
export function disclaimerHtml() {
  // Each line is one unbroken line of source on purpose. A source newline
  // inside the paragraph is invisible in HTML but survives into the plain-text
  // half of the email, where it breaks a sentence in the middle.
  const lines = [
    "This email may contain privileged information. If you're not the intended recipient, please call 01702 540776 and delete it.",
    'We accept no responsibility for content sent via the internet. Nothing here is legally binding unless confirmed in writing.',
    'We will never change bank details without verbal confirmation.',
    'Please consider the environment before printing.',
  ];
  return `<p style="margin:10px 0 0;${FONT}font-size:8pt;color:#9aa1aa;line-height:1.55;">${lines.join('<br>')}</p>`;
}

/**
 * The signature.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.closing=true] Include the "Kind regards," line above
 *        it. True for every current send path. The switch exists because a
 *        future email whose copy already ends in a sign-off should not carry
 *        two.
 * @param {boolean} [opts.inline=false] Embed the pictures in the message.
 *        A real send wants true. Defaults to false so the on-screen preview,
 *        which renders in a browser where cid: means nothing, keeps working.
 * @returns {string} HTML
 */
export function signatureHtml({ closing = true, inline = false } = {}) {
  const closingLine = closing
    ? `<p style="margin:24px 0 14px;${FONT}font-size:11pt;color:${INK};">Kind regards,</p>`
    : '';

  return `${closingLine}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;border-collapse:collapse;">
  <tr>
    <td width="164" style="width:164px;padding:2px 16px 0 0;vertical-align:top;">
      ${img('sig-sweetbyte.png', { inline, width: 150, height: 34, alt: 'Sweetbyte' })}
      <div style="margin-top:16px;">
        <a href="${FACEBOOK_URL}" style="text-decoration:none;border:0;">
          ${img('sig-facebook.png', { inline, width: 20, height: 20, alt: 'Facebook' })}
        </a>
      </div>
    </td>

    <td width="2" bgcolor="${RULE}" style="width:2px;background-color:${RULE};font-size:0;line-height:0;">&nbsp;</td>

    <td style="padding:0 0 0 16px;vertical-align:top;">
      <div style="${FONT}font-size:11pt;font-weight:bold;color:${INK};line-height:1.3;">
        <span style="color:${CYAN};">Billy Crockett</span> |&nbsp;Business Development Consultant
      </div>
      <div style="${FONT}font-size:10pt;font-weight:bold;font-style:italic;color:${NAVY};line-height:1.4;padding-top:2px;">
        Sweetbyte Ltd
      </div>
      <div style="${FONT}font-size:9pt;font-style:italic;color:${MUTED};line-height:1.4;padding:2px 0 14px;">
        Experts in IT Solutions &amp; Digital Communications for your business.
      </div>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${
        detailRow('sig-phone.png', 'Phone', '+44 (0) 1702 540776', inline)
      }${
        detailRow('sig-email.png', 'Email',
          `<a href="mailto:Billy@sweetbyte.co.uk" style="color:${MUTED};text-decoration:none;">Billy@sweetbyte.co.uk</a>`, inline)
      }${
        detailRow('sig-web.png', 'Web',
          `<a href="https://www.sweetbyte.co.uk" style="color:${MUTED};text-decoration:none;">www.sweetbyte.co.uk</a>`, inline)
      }${
        detailRow('sig-address.png', 'Address',
          'Sweetbyte Ltd, Lower Barn Farm, London Road, Rayleigh. SS6 9ET.', inline)
      }${
        detailRow('sig-reg.png', 'Registered',
          'Company Reg: 09949224&nbsp; |&nbsp; Reg Office: 16-18 West St, Rochford, SS4 1AJ<br>VAT Number: 338 6626 71', inline)
      }
      </table>
    </td>
  </tr>
</table>`;
}
