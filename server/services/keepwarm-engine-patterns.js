/**
 * The ten subject areas a keep-warm email can be about.
 *
 * One is assigned to each email in a batch before the model is asked for
 * anything, which is what stops a batch of nine containing three variations on
 * the same idea. Nine emails means nine different areas, decided here rather
 * than hoped for in a prompt.
 *
 * The supplied package carried a `subjectFamily` field on each of these, with
 * values like "Sweetbyte IT - Backups". It has been removed rather than passed
 * to the model: a hyphenated prefix on every subject line is exactly the
 * mass-mailing signal the subject rules exist to avoid, and showing the model a
 * field called subjectFamily is an invitation to use it as one.
 */
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
    id: 'backups',
    label: 'backup restore confidence',
    readerPain: 'A backup may appear healthy until somebody needs to restore it',
    usefulPoint: 'Monitoring and restore readiness matter as much as creating copies',
    ctaPrompt: 'Suggest replying if the last successful restore test is unclear',
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
