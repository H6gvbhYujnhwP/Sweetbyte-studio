/**
 * server/services/email-body-style.js — the font a Sweetbyte email body is set
 * in, and the conversion between the styled paragraphs that get sent and the
 * plain text the operator edits.
 *
 * WHY THIS IS ITS OWN FILE
 * These strings used to live at the top of keepwarm-generator.js. The
 * generation engine in the keepwarm-engine-* files needs the same paragraph
 * style, for three separate reasons, and a second copy would break all three
 * the first time one of them was edited:
 *
 *   1. The prompt tells the model the exact style attribute to write.
 *   2. The validator rejects any paragraph that does not carry that attribute.
 *   3. textToHtml() rebuilds paragraphs with it every time the operator edits
 *      a draft, so an edited draft and an untouched one must match.
 *
 * Same discipline as email-signature.js: one copy, read by everything.
 *
 * WHY THE CONVERSION PAIR MOVED HERE
 * It used to sit in keepwarm-generator.js, which reads the company knowledge
 * base off the disk and pulls in the Anthropic SDK the moment it is imported.
 * That made the round trip impossible to test without a network library and a
 * file on disk, and the round trip is now the thing that carries bold labels
 * through an edit. keepwarm-generator.js re-exports both functions, so every
 * existing import of them still works unchanged.
 *
 * WHY THIS FONT
 * Aptos first because that is what Sweetbyte writes in, degrading through
 * Calibri and Segoe UI to Arial so it never lands on Times New Roman. Points
 * not pixels, because Office sizes in points and 11px renders noticeably
 * smaller than the size 11 the copy was written at. Applied inline on every
 * element rather than once on a wrapper, because Outlook's Word renderer does
 * not reliably inherit fonts into <p>.
 *
 * It also matches service-email-templates.js, so the introduction email and
 * the keep-warm emails that follow it look like they came from the same person.
 */

export const FONT = "font-family:Aptos,'Aptos Display',Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;";

export const P_STYLE = `margin:0 0 1em;${FONT}`;

// ── Plain text in, styled HTML out ───────────────────────────────────────────
//
// The operator edits plain paragraphs and never sees a tag. The inline styling
// is not a choice anybody makes per email — it exists so Outlook's Word
// renderer does not fall back to Times New Roman — so putting it in front of
// somebody rewording a sentence is showing them plumbing they cannot usefully
// change and can easily break.
//
// BOLD IS THE ONE EXCEPTION, and it is why these two functions are a matched
// pair rather than two separate jobs. Since the engine started writing bullet
// sections, a body contains <strong> labels. Stripping those on the way into
// the editing box and rebuilding plain paragraphs on the way out would quietly
// delete every bold label the first time a draft was opened and saved. So the
// editing box gets **Label:** and gives it back, and the message keeps
// <strong>Label:</strong>.
//
// The asterisks are for the editing box only. A recipient reading the
// plain-text half of the email sees the words with no asterisks around them,
// which is why htmlToText defaults to dropping the markers and only keeps them
// when the caller asks. The draft screen asks; the sender does not.

const BOLD_HTML = /<\s*(?:strong|b)\s*>([\s\S]*?)<\s*\/\s*(?:strong|b)\s*>/gi;
const BOLD_MARKERS = /\*\*([^*\n]+)\*\*/g;

/**
 * Styled paragraphs → plain text, blank line between paragraphs.
 *
 * @param {string} html
 * @param {{ keepBold?: boolean }} [options] keepBold turns <strong>x</strong>
 *        into **x** for the editing box. Left off, the bold simply becomes
 *        ordinary words, which is what a plain-text email should contain.
 */
export function htmlToText(html, { keepBold = false } = {}) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    // Bold first, while the tags are still intact. Once the generic tag strip
    // below has run there is nothing left to tell a bold label from any other
    // words in the sentence.
    .replace(BOLD_HTML, keepBold ? '**$1**' : '$1')
    // The signature is a table, so a row end has to become a line end or the
    // whole thing arrives as one run-on sentence in the plain-text half of the
    // email. Generated bodies contain only <p> and <strong>, so this does
    // nothing to the editor's round trip — it only matters once a signature is
    // attached.
    .replace(/<\s*\/\s*(tr|table|div)\s*>/gi, '</p>')
    .replace(/<\s*\/\s*td\s*>/gi, ' ')
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
 *
 * The bold markers are turned back into tags after the escape, deliberately:
 * escaping does not touch an asterisk, so the pattern still matches, and doing
 * it in this order means the operator cannot type a <strong> tag by hand and
 * have it taken seriously. The only bold that survives is bold that came back
 * from the editing box as **like this**.
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
    .map(p => `<p style="${P_STYLE}">${escape(p).replace(BOLD_MARKERS, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`)
    .join('');
}
