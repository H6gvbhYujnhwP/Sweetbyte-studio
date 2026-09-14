/**
 * server/services/email-signature.js — the one email signature.
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
 * NINE IMAGES, ALL OF THEM OPTIONAL
 * The wordmark, the Facebook icon and the five icons down the detail lines are
 * hosted by Studio and requested by the recipient's mail client. Business
 * Outlook blocks remote images until the reader clicks "show images", so every
 * one carries alt text that reads as a word — Phone, Email, Web, Address,
 * Registered — rather than leaving a row of empty boxes. The signature is
 * readable with every image blocked. That was the test it had to pass.
 *
 * Consequence accepted when this was agreed: each image load hits Studio's
 * server and lands in the log, which is open tracking arriving through the back
 * door. There is no report built on it and none intended.
 *
 * THE IMAGE HOST
 * The images live in public/ and are served from the same origin as the
 * unsubscribe links, so the source of every email carries the onrender.com
 * hostname under the Sweetbyte name. Same problem as the unsubscribe link and
 * the same fix — point studio.sweetbyte.co.uk at Render and set PUBLIC_URL.
 * Nothing here needs changing when that happens.
 *
 * NOT DRIVEN BY AN ENV VAR
 * Hardcoded to Billy, for the reason both of the old copies gave: a job title,
 * a direct address and a phone number cannot be derived from a first name. If
 * Joe or Lewis ever send these, this file gets edited.
 */

// The origin the images are fetched from. Same fallback as
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

// One row of the detail block: icon, then text. The icon cell has a fixed width
// so the text edges line up whether the images loaded or not.
function detailRow(base, file, alt, html) {
  return `
      <tr>
        <td width="24" style="width:24px;padding:3px 8px 3px 0;vertical-align:top;">
          <img src="${base}/${file}" width="14" height="14" alt="${alt}"
               style="display:block;border:0;outline:none;text-decoration:none;">
        </td>
        <td style="padding:3px 0;vertical-align:top;${FONT}font-size:9pt;color:${MUTED};line-height:1.45;">${html}</td>
      </tr>`;
}

/**
 * The signature.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.closing=true] Include the "Kind regards," line above
 *        it. True for every current send path. The switch exists because a
 *        future email whose copy already ends in a sign-off should not carry
 *        two.
 * @returns {string} HTML
 */
export function signatureHtml({ closing = true } = {}) {
  const base = publicBaseUrl();

  const closingLine = closing
    ? `<p style="margin:24px 0 14px;${FONT}font-size:11pt;color:${INK};">Kind regards,</p>`
    : '';

  return `${closingLine}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;border-collapse:collapse;">
  <tr>
    <td width="164" style="width:164px;padding:2px 16px 0 0;vertical-align:top;">
      <img src="${base}/sig-sweetbyte.png" width="150" height="34" alt="Sweetbyte"
           style="display:block;border:0;outline:none;text-decoration:none;">
      <div style="margin-top:16px;">
        <a href="${FACEBOOK_URL}" style="text-decoration:none;border:0;">
          <img src="${base}/sig-facebook.png" width="20" height="20" alt="Facebook"
               style="display:block;border:0;outline:none;text-decoration:none;">
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
        detailRow(base, 'sig-phone.png', 'Phone', '+44 (0) 1702 540776')
      }${
        detailRow(base, 'sig-email.png', 'Email',
          `<a href="mailto:Billy@sweetbyte.co.uk" style="color:${MUTED};text-decoration:none;">Billy@sweetbyte.co.uk</a>`)
      }${
        detailRow(base, 'sig-web.png', 'Web',
          `<a href="https://www.sweetbyte.co.uk" style="color:${MUTED};text-decoration:none;">www.sweetbyte.co.uk</a>`)
      }${
        detailRow(base, 'sig-address.png', 'Address',
          'Sweetbyte Ltd, Lower Barn Farm, London Road, Rayleigh. SS6 9ET.')
      }${
        detailRow(base, 'sig-reg.png', 'Registered',
          'Company Reg: 09949224&nbsp; |&nbsp; Reg Office: 16-18 West St, Rochford, SS4 1AJ<br>VAT Number: 338 6626 71')
      }
      </table>
    </td>
  </tr>
</table>`;
}
