/**
 * server/services/email-body-style.js — the font a Sweetbyte email body is set in.
 *
 * WHY THIS IS ITS OWN FILE
 * These two strings used to live at the top of keepwarm-generator.js. The
 * generation engine in the keepwarm-engine-* files needs the same paragraph style, for
 * three separate reasons, and a second copy would break all three the first
 * time one of them was edited:
 *
 *   1. The prompt tells the model the exact style attribute to write.
 *   2. The validator rejects any paragraph that does not carry that attribute.
 *   3. textToHtml() rebuilds paragraphs with it every time the operator edits
 *      a draft, so an edited draft and an untouched one must match.
 *
 * Same discipline as email-signature.js: one copy, read by everything.
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
