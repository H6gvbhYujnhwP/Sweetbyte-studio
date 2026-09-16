/**
 * Every prompt the keep-warm engine sends.
 *
 * PARAGRAPH_STYLE is Studio's own body style, imported rather than declared.
 * The supplied package hardcoded Arial 15px here, which would have put the body
 * of a keep-warm email in a different font from the signature underneath it and
 * from the introduction email that came before it — and would have changed the
 * moment the operator edited a paragraph, because Studio's editor rebuilds
 * paragraphs in Studio's style. See email-body-style.js.
 *
 * THE SHAPE OF AN EMAIL CHANGED HERE
 * The first version of these rules asked for three to six plain paragraphs and
 * banned bold and lists outright. An email now has a short opening, a lead-in
 * line and a bullet section of three to five points, each led by a short bold
 * label, then a close. That is what the rules below ask for and what the
 * validator enforces.
 *
 * The bullet is written as an ordinary paragraph beginning "• " rather than as
 * a <ul>. Two reasons, both about what happens after the email is written.
 * Outlook's Word renderer treats list spacing and indentation as its own
 * business and a real list arrives looking nothing like the preview; and
 * Studio's editing box hands the body back as plain paragraphs, so a list would
 * be flattened the first time a draft was opened and saved. A bulleted
 * paragraph survives both untouched.
 */

import { CONTENT_PATTERNS, SUBJECT_PREFIX } from './keepwarm-engine-patterns.js';
import { P_STYLE } from './email-body-style.js';

export const PARAGRAPH_STYLE = P_STYLE;

const HARD_RULES = `
HARD RULES. Every one is mandatory.
1. The supplied knowledge base is the only source of company facts.
2. Do not invent a statistic, price, percentage, time figure, client, result, feature, package term, certification, vendor or team detail.
3. Do not give a surname for any team member except Sweetman.
4. Use UK English: specialises, optimisation, defence, modernise, organisation. Write Sweetbyte exactly like that, one word, capital S only.
5. No em dashes, exclamation marks, emoji or images.
6. Do not claim the reader is a customer. Do not refer to a call, earlier conversation or promise. Do not guess their industry, systems, problems or circumstances.
7. Do not include a greeting, sign-off, signature, telephone number, email address, website, postal address, disclaimer or unsubscribe wording. The sending system adds these.
8. Each body must be 120 to 200 words, use plain English, address the reader as "you", use "we" for Sweetbyte and cover one idea only.
9. End with one low-pressure call to action: either invite a reply, or invite a call on the number in the signature. Never both in the same email.
10. Every subject must begin exactly "${SUBJECT_PREFIX}". What follows the prefix must be short, specific and human, and under 48 characters. Avoid urgency, hype, clickbait and promotional language.
11. The HTML may contain only paragraph elements, between six and nine of them, plus the bold labels described below. Every paragraph must carry exactly this style attribute: ${PARAGRAPH_STYLE}
12. Every email must contain exactly one bullet section of three, four or five bullet points. A bullet is an ordinary paragraph whose text begins with the bullet character and one space: "• ". The bullets must sit together with no other paragraph in between. Use the same bullet character in the plain text.
13. Every bullet begins with one short bold label of one to four words, then a colon, then useful normal-weight text. In HTML write exactly: • <strong>Short label:</strong> useful detail. In plain text write exactly: • **Short label:** useful detail. No bullet may exceed 18 words. Keep the labels factual and calm.
14. Bold appears on those labels and nowhere else in the email. No headings, links, tables, images, numbered lists, hyphen bullets or asterisk bullets.
15. Structure each email as: a short opening that names something recognisable, one short explanatory paragraph, a lead-in line ending with a colon, the bullet section, then a close carrying the single call to action.
16. HTML and plain text must contain exactly the same visible wording in the same paragraph order. The only difference is <strong>...</strong> in the HTML against **...** in the plain text.
17. Return valid JSON only. No markdown fences or commentary.`;

export function buildSystemPrompt() {
  return `You write light-touch keep-warm emails for Sweetbyte, an Essex-based managed IT services provider. The recipients are small-business owners and office managers who took a telesales call, received an introductory email and have not opted out. There is no established relationship and nothing is known about their business. The aim is to be useful, personable and remembered, not to force a sale.

VOICE
- Calm, friendly and conversational.
- Helpful enough to justify the email.
- Technically accurate without sounding technical.
- One recognisable problem, one useful point and one gentle next step.
- The tone should feel like a knowledgeable local person, not a campaign.
- The bullet section is there to make the email quick to scan, not to advertise. Each bullet should tell the reader something they could act on, not name a product.

${HARD_RULES}`;
}

function slotBlock(slot) {
  return JSON.stringify({
    area: slot.angle,
    readerPain: slot.readerPain,
    usefulPoint: slot.usefulPoint,
    ctaPrompt: slot.ctaPrompt,
    openingMove: slot.openingMove,
    ctaMode: slot.ctaMode,
  });
}

// One worked example of the required shape, built from the real paragraph
// style. Describing the bullet format in prose alone was not enough: the shape
// is fiddly, and an example the model can pattern-match costs a few hundred
// tokens and saves a repair round trip.
const SHAPE_EXAMPLE = `{"emails":[{"angle":"four to six words","subject":"${SUBJECT_PREFIX}Topic in a few words","html":"<p style=\\\\"${PARAGRAPH_STYLE}\\\\">Opening paragraph naming something recognisable.</p><p style=\\\\"${PARAGRAPH_STYLE}\\\\">One short paragraph explaining why it happens.</p><p style=\\\\"${PARAGRAPH_STYLE}\\\\">A few things usually make the difference:</p><p style=\\\\"${PARAGRAPH_STYLE}\\\\">• <strong>First label:</strong> concise useful detail</p><p style=\\\\"${PARAGRAPH_STYLE}\\\\">• <strong>Second label:</strong> concise useful detail</p><p style=\\\\"${PARAGRAPH_STYLE}\\\\">• <strong>Third label:</strong> concise useful detail</p><p style=\\\\"${PARAGRAPH_STYLE}\\\\">Closing paragraph with one low-pressure call to action.</p>","plain":"Opening paragraph naming something recognisable.\\\\n\\\\nOne short paragraph explaining why it happens.\\\\n\\\\nA few things usually make the difference:\\\\n\\\\n• **First label:** concise useful detail\\\\n\\\\n• **Second label:** concise useful detail\\\\n\\\\n• **Third label:** concise useful detail\\\\n\\\\nClosing paragraph with one low-pressure call to action."}]}`;

export function buildBatchPrompt({ count, knowledgeBase, slots, doNotRepeat }) {
  return `Create exactly ${count} complete emails.

KNOWLEDGE BASE
<knowledge_base>
${knowledgeBase}
</knowledge_base>

ASSIGNED CONTENT SLOTS
Use each slot exactly once and keep the outputs in this order. The slot guides the angle but never authorises a fact that is absent from the knowledge base. The slot is not a subject line and must not appear in one.
${slots.map((slot, index) => `${index + 1}. ${slotBlock(slot)}`).join('\n')}

SUBJECTS AND ANGLES TO AVOID REPEATING
${doNotRepeat.length ? doNotRepeat.map(value => `- ${value}`).join('\n') : '- None supplied'}

Before writing, privately check that every email has a different service area, reader pain and opening move. Do not output the plan.

Required JSON shape, and the required email shape:
${SHAPE_EXAMPLE}`;
}

export function buildRepairPrompt({ knowledgeBase, slot, candidate, errors, fixedSubject = null }) {
  return `Repair one email so every validation error is resolved. Return one JSON email object only, with keys angle, subject, html and plain.

KNOWLEDGE BASE
<knowledge_base>
${knowledgeBase}
</knowledge_base>

ASSIGNED SLOT
${slot ? slotBlock(slot) : 'None'}

${fixedSubject ? `The subject must remain exactly as it is, character for character, including its punctuation: ${fixedSubject}\n` : ''}INVALID CANDIDATE
${JSON.stringify(candidate)}

VALIDATION ERRORS
${errors.map(error => `- ${error}`).join('\n')}

THE REQUIRED SHAPE
${SHAPE_EXAMPLE}

${HARD_RULES}`;
}

export function buildSubjectRewritePrompt({ knowledgeBase, body, currentSubject, rejectedSubjects }) {
  return `Rewrite only the subject line for the supplied body. Return JSON only: {"subject":"..."}.

KNOWLEDGE BASE
<knowledge_base>${knowledgeBase}</knowledge_base>

BODY
${body}

CURRENT SUBJECT
${currentSubject}

REJECTED OR USED SUBJECTS
${rejectedSubjects.length ? rejectedSubjects.map(x => `- ${x}`).join('\n') : '- None'}

The new subject must begin exactly "${SUBJECT_PREFIX}". After that prefix it must match what the body actually says, be specific and human, under 48 characters, factually supported, materially different from every rejected subject, and free of hype, urgency, exclamation marks and emoji. Use UK English and write Sweetbyte exactly like that.`;
}

export function buildBodyRewritePrompt({ knowledgeBase, subject, plainBody }) {
  return `Rewrite the body while keeping the subject exactly unchanged. Return one JSON email object only with keys angle, subject, html and plain.

KNOWLEDGE BASE
<knowledge_base>${knowledgeBase}</knowledge_base>

FIXED SUBJECT
${subject}

CURRENT BODY
${plainBody}

The rewrite must stay on the same topic and deliver what the subject promises. Do not reuse its sentences. Return the fixed subject back unchanged, character for character.

THE REQUIRED SHAPE
${SHAPE_EXAMPLE}

${HARD_RULES}`;
}

/**
 * Write a body under a subject line the operator typed themselves.
 *
 * Distinct from buildBodyRewritePrompt: there is no current body to move away
 * from, and the line is not the model's to tidy. Studio's settled behaviour is
 * that a hand-written subject keeps its wording exactly, with only the standing
 * prefix added on the front, so the prompt says so in terms, and the validator
 * skips its subject checks entirely when a fixed subject is supplied.
 */
export function buildFromSubjectPrompt({ knowledgeBase, subject, doNotRepeat = [] }) {
  return `Write the one email that belongs under a subject line that has already been written by hand. Return one JSON email object only with keys angle, subject, html and plain.

KNOWLEDGE BASE
<knowledge_base>
${knowledgeBase}
</knowledge_base>

FIXED SUBJECT
${subject}

The subject line was written by a person and is not yours to improve, shorten, punctuate differently or reword in any way. Return it back exactly as given, character for character, including any punctuation you would not have chosen. It already carries the standing prefix; do not add a second one.

The body must deliver what that subject promises. If the subject is a joke or a complaint about IT frustration, the first line must land that recognition before it says anything about Sweetbyte.

ANGLES ALREADY USED — do not retread these
${doNotRepeat.length ? doNotRepeat.map(value => `- ${value}`).join('\n') : '- None supplied'}

THE REQUIRED SHAPE
${SHAPE_EXAMPLE}

${HARD_RULES}`;
}

export function getPattern(id) {
  return CONTENT_PATTERNS.find(pattern => pattern.id === id);
}
