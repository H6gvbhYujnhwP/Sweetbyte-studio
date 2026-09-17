/**
 * The nine subject areas a keep-warm email can be about.
 *
 * One is assigned to each email in a batch before the model is asked for
 * anything, which is what stops a batch of nine containing three variations on
 * the same idea. Nine emails means nine different areas, decided here rather
 * than hoped for in a prompt.
 *
 * BACKUPS HAS BEEN REMOVED. It was the tenth area. Billy's decision, taken
 * after reading a generated draft about restore testing: Sweetbyte is not
 * sending keep-warm emails about backups. Deleted rather than switched off,
 * which was the choice he was offered. Nothing else in the company knowledge
 * base leads the model towards the subject on its own, so removing the entry
 * removes the topic. Putting it back means putting this block back.
 *
 * The supplied package carried a `subjectFamily` field on each of these, with
 * values like "Sweetbyte IT - Backups". The field has been removed, but the
 * prefix itself has not: every generated subject line begins "Sweetbyte IT - ".
 * That is a deliberate Studio decision, taken knowing it reads like a mailing
 * tool, and SUBJECT_PREFIX below is the one copy of it. It is applied by the
 * prompt and enforced by the validator, rather than being handed to the model
 * as a field it can improvise around.
 */
export const SUBJECT_PREFIX = 'Sweetbyte IT - ';

/**
 * Put the prefix on the front of a subject line, once.
 *
 * Used on the operator's own hand-written lines, which get the prefix and are
 * otherwise left exactly as typed, exclamation marks and all. Also used as a
 * safety net on a generated line the model returned without it.
 */
export function withSubjectPrefix(subject) {
  const trimmed = String(subject || '').trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith(SUBJECT_PREFIX) ? trimmed : `${SUBJECT_PREFIX}${trimmed}`;
}

/**
 * The subject without its prefix. Used where the prefix would distort a
 * measurement — the character limit applies to the part somebody actually
 * wrote, not to fifteen characters of standing boilerplate.
 */
export function stripSubjectPrefix(subject) {
  const trimmed = String(subject || '').trim();
  return trimmed.startsWith(SUBJECT_PREFIX) ? trimmed.slice(SUBJECT_PREFIX.length).trim() : trimmed;
}

export const CONTENT_PATTERNS = [
  {
    id: 'apps',
    label: 'custom apps and scattered processes',
    readerPain: 'Work spread across spreadsheets, inboxes and separate systems',
    usefulPoint: 'A tailored app can put one awkward process in one place',
    ctaPrompt: 'Ask which repeated process feels more complicated than it should',
  },
  {
    id: 'websites',
    label: 'website usefulness and maintenance',
    readerPain: 'A site that is slow, dated, unclear or difficult to use on a phone',
    usefulPoint: 'A website should quickly explain the business and make contact easy',
    ctaPrompt: 'Invite a reply with a website address for an informal first look',
  },
  {
    id: 'flexible_support',
    label: 'flexible IT support',
    readerPain: 'Support that is reactive, unclear or tied to the wrong arrangement',
    usefulPoint: 'Support can range from day-to-day help to proactive monitoring',
    ctaPrompt: 'Offer an informal second opinion on the current arrangement',
  },
  {
    id: 'cyber_security',
    label: 'practical cyber security layers',
    readerPain: 'Relying on one security product while overlooking people and process',
    usefulPoint: 'Security works best as several understandable layers',
    ctaPrompt: 'Invite one question about the area that is hardest to assess',
  },
  {
    id: 'microsoft_365',
    label: 'better Microsoft 365 use',
    readerPain: 'Paying for tools that are underused or using the wrong licence mix',
    usefulPoint: 'Different people may need different licences and features',
    ctaPrompt: 'Invite a reply with a Microsoft 365 question',
  },
  {
    id: 'connectivity',
    label: 'business internet and Wi-Fi',
    readerPain: 'Slow or patchy Wi-Fi that is blamed on the internet line',
    usefulPoint: 'Coverage, capacity, interference and resilience are separate issues',
    ctaPrompt: 'Ask whether there is one area where the connection regularly drops',
  },
  {
    id: 'voip',
    label: 'phones for flexible working',
    readerPain: 'A phone system that is fixed to one desk or awkward to change',
    usefulPoint: 'Modern telephony can follow users across desk, mobile and computer',
    ctaPrompt: 'Invite a reply if the current system no longer fits how the team works',
  },
  {
    id: 'automation',
    label: 'repetitive work and automation',
    readerPain: 'The same information being copied, checked or sent repeatedly',
    usefulPoint: 'The best first automation is often one small repeated process',
    ctaPrompt: 'Ask which weekly task should no longer be manual',
  },
  {
    id: 'passwords',
    label: 'password and document protection',
    readerPain: 'Passwords kept in browsers, documents, messages or notebooks',
    usefulPoint: 'A managed password system makes secure access and staff changes easier',
    ctaPrompt: 'Invite a question about how passwords are currently handled',
  },
];

export const OPENING_MOVES = [
  'recognisable-friction',
  'simple-question',
  'common-misunderstanding',
  'small-practical-check',
  'contrast-with-old-way',
];

export const CTA_MODES = [
  'reply-with-one-question',
  'reply-for-an-informal-view',
  'reply-with-the-problem-area',
];

// ─────────────────────────────────────────────────────────────────────────────
// THE NINE SERVICE INTERESTS, AS WRITING BRIEFS
//
// CONTENT_PATTERNS above are the areas the generator picks from on its own when
// it is writing a general batch. These are different: one per service interest
// ticked on a company in WorkTrackr, used when the operator presses Write on a
// lane card and the topic has therefore already been decided for them.
//
// They are kept separate on purpose rather than the two lists being merged. The
// generator's areas are shaped for variety across a batch of nine — two of them
// deliberately cut across several services. The interests are Sweetbyte's actual
// service list, and a lane email has to be about its own service and nothing
// else. Merging them would mean either the Website lane occasionally writing
// about passwords, or the general batch losing its cross-cutting angles.
//
// KEYED BY INTEREST KEY, and the keys must match INTEREST_KEYS in
// keepwarm-store.js exactly. A key with no brief here cannot be written for, and
// the route says so in plain words rather than falling back to a general email —
// a "Microsoft 365" email that is actually about IT support is worse than no
// email, because nobody would spot it before it went out.
//
// BACKUPS IS NOT HERE, for the same reason it is not in CONTENT_PATTERNS.
// ─────────────────────────────────────────────────────────────────────────────

// IT SUPPORT IS NOT HERE, and that is the merge rather than an omission.
// General IT support is not one service among eight — it is the email that
// covers all of them, so it lives in GENERAL_PATTERN below and goes out on the
// General IT support card. A brief here as well would mean writing the same
// email twice and sending it to overlapping lists.
export const INTEREST_PATTERNS = {
  cyber_security: {
    id: 'cyber_security',
    label: 'practical cyber security layers',
    readerPain: 'Relying on one security product while overlooking people and process',
    usefulPoint: 'Security works best as several understandable layers',
    ctaPrompt: 'Invite one question about the area that is hardest to assess',
  },
  internet: {
    id: 'internet',
    label: 'business internet connections',
    readerPain: 'A connection sold on headline speed that struggles when everyone is working',
    usefulPoint: 'Upload, contention and what happens when the line fails matter as much as speed',
    ctaPrompt: 'Ask what happens to the business on the day the line goes down',
  },
  wifi: {
    id: 'wifi',
    label: 'managed Wi-Fi coverage',
    readerPain: 'Patchy Wi-Fi in parts of the building that gets blamed on the internet line',
    usefulPoint: 'Coverage, capacity and interference are separate problems with separate fixes',
    ctaPrompt: 'Ask whether there is one room where the signal regularly drops',
  },
  website: {
    id: 'website',
    label: 'website usefulness and maintenance',
    readerPain: 'A site that is slow, dated, unclear or difficult to use on a phone',
    usefulPoint: 'A website should quickly explain the business and make contact easy',
    ctaPrompt: 'Invite a reply with a website address for an informal first look',
  },
  domains: {
    id: 'domains',
    label: 'domains and hosting',
    readerPain: 'A domain registered years ago by somebody who has since left',
    usefulPoint: 'Knowing who controls the domain and when it renews avoids an avoidable outage',
    ctaPrompt: 'Ask whether anybody in the business could say where the domain is registered',
  },
  microsoft_365: {
    id: 'microsoft_365',
    label: 'better Microsoft 365 use',
    readerPain: 'Paying for tools that are underused or using the wrong licence mix',
    usefulPoint: 'Different people may need different licences and features',
    ctaPrompt: 'Invite a reply with a Microsoft 365 question',
  },
  voip: {
    id: 'voip',
    label: 'phones for flexible working',
    readerPain: 'A phone system that is fixed to one desk or awkward to change',
    usefulPoint: 'Modern telephony can follow users across desk, mobile and computer',
    ctaPrompt: 'Invite a reply if the current system no longer fits how the team works',
  },
  custom_apps: {
    id: 'custom_apps',
    label: 'custom apps and scattered processes',
    readerPain: 'Work spread across spreadsheets, inboxes and separate systems',
    usefulPoint: 'A tailored app can put one awkward process in one place',
    ctaPrompt: 'Ask which repeated process feels more complicated than it should',
  },
};

/**
 * The general IT support email, written for the people with nothing ticked.
 *
 * Its own brief rather than a reuse of it_support, because the audience is
 * different: these are people Sweetbyte knows nothing specific about, so the
 * email has to be useful without assuming which service they care about.
 */
export const GENERAL_PATTERN = {
  id: 'general',
  label: 'general IT support across all of Sweetbyte\'s services',
  readerPain: 'Support that is reactive, unclear or tied to the wrong arrangement',
  usefulPoint: 'Support can span day-to-day help, proactive monitoring and the wider services around it',
  ctaPrompt: 'Offer an informal second opinion on the current arrangement',
};

/**
 * The writing brief for a lane, or null if there is not one.
 *
 * '__none' is the "nothing ticked" lane, which is a real group of people and
 * not an absence — 291 of the 295 sit in it — so it has a brief like any other.
 */
export function patternForInterest(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  if (k === '__none') return GENERAL_PATTERN;
  return INTEREST_PATTERNS[k] || null;
}
