/**
 * server/services/service-email-templates.js — Content blocks for WorkTrackr
 * service emails.
 *
 * SOURCE: "Sweetbyte Email Campaigns — 12 Revised". This is the approved
 * wording. Treat it as content owned by the business, not as code: editing the
 * copy strings is expected, editing the structure around them is not.
 *
 * HOW THE SOURCE IS STRUCTURED, AND WHY THAT MATTERS
 * Each of the twelve campaigns in the source is a COMPLETE email — its own
 * greeting, its own sign-off. That is exactly right when one service is sent,
 * and impossible when two are: concatenating two complete emails would greet
 * the reader twice and sign off twice.
 *
 * So each campaign is stored in four parts:
 *   openingLine — the "thanks for taking my call…" sentence, naming the service
 *   body        — the substance, one or more paragraphs
 *   cta         — the "if you'd like a chat…" close
 * and a shared greeting and signature sit around them.
 *
 * SENDING ONE SERVICE reproduces the source email verbatim: greeting +
 * openingLine + body + cta + signature. Word for word what was approved.
 *
 * SENDING SEVERAL uses a shared opening that names them, then each body under
 * its own heading, then one shared close and one signature. The approved
 * substance is untouched; only the connective tissue is replaced, because the
 * source has no wording for a combined email and inventing per-service variants
 * would mean putting words in Sweetbyte's mouth.
 *
 * FOLLOW-UP (day 7): the source supplies initial copy only. The follow-up
 * reuses the approved bodies verbatim and changes only the opening, for the
 * same reason. To give a service bespoke follow-up wording later, add a
 * `followupBody` and it will be used instead.
 *
 * Tokens:
 *   [NAME]           — contact's first name, or "there" when unknown
 *   {{SenderName}}   — the Sweetbyte team member sending
 *   {{CompanyName}}  — available, though the approved copy does not use it
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared wrapper
// ─────────────────────────────────────────────────────────────────────────────

const GREETING = `<p>Hi [NAME],</p>`;

// Used in place of the per-service opening when more than one is selected.
// "{{ServiceList}}" is replaced with the selected labels, e.g.
// "IT Support and Cyber Security" or "IT Support, Backup Solutions and VoIP".
const OPENING_MULTI = `
  <p>Thanks for taking my call earlier. As promised, I just wanted to send over
  a little more information about our {{ServiceList}} services.</p>
`;

const OPENING_FOLLOWUP_SINGLE = `
  <p>I got in touch last week after we spoke about our {{ServiceList}} services,
  and I wanted to follow up in case the timing is better now. I've included the
  same information below so it's all in one place.</p>
`;

const OPENING_FOLLOWUP_MULTI = OPENING_FOLLOWUP_SINGLE;

// Replaces the per-service close on a combined email.
const CTA_MULTI = `
  <p>If you'd like to have a chat about any of the above, just reply to this
  email or give me a call. Otherwise, hopefully the information is useful.</p>
`;

const SIGNATURE = `
  <p>Kind regards,</p>
  <p style="margin:0;">{{SenderName}}<br>
  Sweetbyte<br>
  01702 540776<br>
  <a href="https://www.sweetbyte.co.uk">www.sweetbyte.co.uk</a></p>
`;

// The source gives no subject for a combined email, nor for any follow-up.
//
// A combined subject NAMES the services, because "Following Our Conversation"
// tells the reader nothing they couldn't guess and gives them no reason to
// open it. "A Quick Overview of Our IT Support and VoIP Telephony" does, and it
// borrows the phrasing of campaign 1 so it sounds like the rest of the set.
//
// LENGTH GUARD: most mail clients truncate a subject around 60 characters, and
// phones can cut at 35. Three long service names blow straight past that and
// the reader sees a sentence with its point chopped off — worse than a short
// generic line. So when the named version gets too long, it falls back.
const SUBJECT_MULTI_PREFIX = 'Information on ';
const SUBJECT_MULTI_FALLBACK = 'Information on the Services We Discussed';

// Follow-ups name the services too, for the same reason.
const SUBJECT_FOLLOWUP_PREFIX = 'Following Up on ';
const SUBJECT_FOLLOWUP_FALLBACK = 'Following Up on Our Conversation';

// Cap set at 70, not 60. A named subject that truncates still shows the reader
// something useful — "Information on IT Support, Cyber Secu…" beats a generic
// line that names nothing. The fallback is for genuinely unwieldy selections
// (four or more), where truncation would leave the last service dangling
// mid-word and the subject looking broken rather than merely cut.
const SUBJECT_MULTI_MAX = 70;

// ─────────────────────────────────────────────────────────────────────────────
// Campaigns
// ─────────────────────────────────────────────────────────────────────────────
// `key` is written to the database and to WorkTrackr's mirror table, and the
// dedupe rule is keyed on it, so renaming one orphans every historical send.
// Treat these as permanent.
//
// `order` is the order of the chips in WorkTrackr and follows the source
// document's numbering. It does NOT control block order in a combined email —
// selection order does, so the customer's main interest leads.

export const SERVICES = [
  {
    key: 'it_support',
    label: 'IT Support',
    heading: 'IT Support',
    order: 1,
    subject: 'A Quick Overview of Our IT Support',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I just wanted to send over
      a little more information about our IT Support services.</p>`,
    body: `
      <p>We provide IT support for businesses of around 5-100 staff, covering
      day-to-day technical support, troubleshooting, security and ongoing
      management. We're a local Rayleigh-based company with over 25 years'
      experience, and we don't tie customers into lengthy contracts.</p>
      <p>The aim is simply to make sure you have reliable IT support when you
      need it, without unnecessary complication.</p>
    `,
    cta: `<p>If you'd like to have a chat about your current setup, just reply to this
      email or give me a call. Otherwise, hopefully the information is useful.</p>`,
  },
  {
    key: 'cyber_security',
    label: 'Cyber Security',
    heading: 'Cyber Security',
    order: 2,
    subject: 'A Quick Overview of Our Cyber Security Services',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I just wanted to send over
      a little more information about our Cyber Security services.</p>`,
    body: `
      <p>We help businesses with managed antivirus and anti-malware, ransomware
      protection, email and phishing protection, Cyber Essentials, password
      management, document protection and 2FA.</p>
      <p>The aim is simply to make sure your business has the right protection in
      place without adding unnecessary complexity.</p>
    `,
    cta: `<p>If you'd like to have a chat about your current setup, just reply to this
      email or give me a call. Otherwise, hopefully the information is useful.</p>`,
  },
  {
    key: 'business_internet',
    label: 'Business Internet',
    heading: 'Business Internet',
    order: 3,
    subject: 'A Look at Our Business Internet Options',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I wanted to send over a
      little more information about our Business Internet services.</p>`,
    body: `
      <p>We can provide business broadband, fibre, leased lines and dedicated
      high-speed connections, along with 4G/5G backup and automatic failover
      where required.</p>
      <p>This can be useful for businesses where a reliable internet connection
      is important for cloud systems, phones, remote working and everyday
      operations.</p>
    `,
    cta: `<p>If you'd like to have a chat about your current connection or options
      available, just reply to this email or give me a call. Otherwise, hopefully
      the information is useful.</p>`,
  },
  {
    key: 'managed_wifi',
    label: 'Managed Wi-Fi',
    heading: 'Managed Wi-Fi',
    order: 4,
    subject: 'A Quick Look at Business Wi-Fi',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I just wanted to send over
      a little more information about our Managed Wi-Fi service.</p>`,
    body: `
      <p>We provide business-grade Wi-Fi designed for reliable coverage
      throughout the workplace, with seamless roaming, secure guest networks and
      support for busy environments.</p>
      <p>We can also help identify and eliminate Wi-Fi dead zones, so staff and
      visitors can get a consistent connection where they need it.</p>
    `,
    cta: `<p>If you'd like to have a chat about your current Wi-Fi setup, just reply to
      this email or give me a call. Otherwise, hopefully the information is
      useful.</p>`,
  },
  {
    key: 'website_design',
    label: 'Website Design',
    heading: 'Website Design',
    order: 5,
    subject: 'A Little More About Our Website Design',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I just wanted to send over
      a little more information about our Website Design services.</p>`,
    body: `
      <p>We create bespoke, mobile-friendly websites for businesses, including
      e-commerce sites, with SEO, secure hosting and ongoing maintenance
      available as part of the service.</p>
      <p>We can also look after the technical side, including domains, DNS, SSL
      and security updates, so everything is kept together in one place.</p>
    `,
    cta: `<p>If you'd like to have a chat about your current website or what you might
      need, just reply to this email or give me a call. Otherwise, hopefully the
      information is useful.</p>`,
  },
  {
    key: 'domain_hosting',
    label: 'Domain & Hosting',
    heading: 'Domain &amp; Hosting',
    order: 6,
    subject: 'Website Hosting, Domains & Maintenance',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I wanted to send over a
      little more information about our Domain &amp; Hosting services.</p>`,
    body: `
      <p>We can take care of domain registration, secure hosting, SSL
      certificates, DNS and ongoing website updates and maintenance.</p>
      <p>It means the technical side of your website can be managed for you, with
      regular maintenance and security updates helping to keep things running
      smoothly.</p>
    `,
    cta: `<p>If you'd like to discuss your current hosting or domain setup, just reply
      to this email or give me a call. Otherwise, hopefully the information is
      useful.</p>`,
  },
  {
    key: 'backup_solutions',
    label: 'Backup Solutions',
    heading: 'Backup Solutions',
    order: 7,
    subject: 'A Quick Look at Business Backup',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I just wanted to send over
      a little more information about our Backup Solutions.</p>`,
    body: `
      <p>We provide both onsite and cloud backup, covering areas such as PCs,
      Windows servers, Microsoft 365 mailboxes, SharePoint and Teams. Backups are
      monitored and reported on, with secure offsite storage and fast remote
      restoration available.</p>
      <p>The idea is to give businesses a straightforward, fully managed way of
      protecting important data and being able to restore it when needed.</p>
    `,
    cta: `<p>If you'd like to have a chat about your current backup arrangements, just
      reply to this email or give me a call. Otherwise, hopefully the information
      is useful.</p>`,
  },
  {
    key: 'microsoft_365',
    label: 'Microsoft 365',
    heading: 'Microsoft 365',
    order: 8,
    subject: 'Getting More From Microsoft 365',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I wanted to send over a
      little more information about our Microsoft 365 services.</p>`,
    body: `
      <p>We can help with Microsoft 365 setup and management, including Exchange
      email, OneDrive, Teams and SharePoint, as well as user management and
      troubleshooting.</p>
      <p>We also support Microsoft 365 plans ranging from Business Basic and
      Standard through to Enterprise E3, depending on what your business
      needs.</p>
    `,
    cta: `<p>If you'd like to discuss your current Microsoft 365 setup, just reply to
      this email or give me a call. Otherwise, hopefully the information is
      useful.</p>`,
  },
  {
    key: 'voip_telephony',
    label: 'VoIP Telephony',
    heading: 'VoIP Telephony',
    order: 9,
    subject: 'A Look at Our VoIP Telephone Service',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I just wanted to send over
      a little more information about our VoIP Telephone services.</p>`,
    body: `
      <p>Our VoIP system allows businesses to use desk phones, mobiles and PCs,
      with features such as call recording, auto-attendant, voicemail-to-email
      and flexible monthly plans.</p>
      <p>It can make it much easier for staff to work from different locations
      while keeping a professional business phone system.</p>
    `,
    cta: `<p>If you'd like to have a chat about your current phone system or options
      available, just reply to this email or give me a call. Otherwise, hopefully
      the information is useful.</p>`,
  },
  {
    key: 'custom_apps_automation',
    label: 'Custom Apps & Automation',
    heading: 'Custom Apps &amp; Automation',
    order: 10,
    subject: 'Could Automation Help With Your Processes?',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I wanted to send over a
      little more information about our Custom Apps &amp; Automation services.</p>`,
    body: `
      <p>We build bespoke apps and workflows to help automate repetitive tasks
      such as data entry, invoicing, scheduling and order processing.</p>
      <p>The idea is to remove some of the manual work from everyday processes,
      reduce human error and give staff more time to concentrate on other
      things.</p>
    `,
    cta: `<p>If you'd like to talk through a process that currently takes up a lot of
      time, just reply to this email or give me a call. Otherwise, hopefully the
      information is useful.</p>`,
  },
  {
    key: 'email_marketing',
    label: 'Email Marketing',
    heading: 'Email Marketing',
    order: 11,
    subject: 'A Little More About Email Marketing',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I just wanted to send over
      a little more information about our Email Marketing services.</p>`,
    body: `
      <p>We can help with professional newsletters, automated campaigns and drip
      sequences, audience segmentation and reporting, giving you a more organised
      way to keep in touch with customers and prospects.</p>
      <p>Everything can be tailored around your audience and the type of
      communication you want to send.</p>
    `,
    cta: `<p>If you'd like to have a chat about your current email marketing, just reply
      to this email or give me a call. Otherwise, hopefully the information is
      useful.</p>`,
  },
  {
    key: 'voice_greetings',
    label: 'Professional Voice & Greetings',
    heading: 'Professional Voice &amp; Telephone Greetings',
    order: 12,
    subject: 'A More Professional Sound for Your Phone System',
    openingLine: `<p>Thanks for taking my call earlier. As promised, I wanted to send over a
      little more information about our Professional Voice &amp; Telephone
      Greetings service.</p>`,
    body: `
      <p>We provide professionally recorded welcome messages, IVR prompts,
      voicemail messages, on-hold marketing and out-of-hours messages for
      business phone systems.</p>
      <p>The recordings can be supplied with professional voice only or with
      voice and music, helping give callers a more polished experience when they
      contact your business.</p>
    `,
    cta: `<p>If you'd like to discuss what you currently have in place, just reply to
      this email or give me a call. Otherwise, hopefully the information is
      useful.</p>`,
  },
];

const BY_KEY = new Map(SERVICES.map(s => [s.key, s]));

export function getService(key) {
  return BY_KEY.get(key) || null;
}

export function isValidServiceKey(key) {
  return BY_KEY.has(key);
}

/**
 * Public catalogue for WorkTrackr's chip grid. WorkTrackr reads this over the
 * wire rather than holding its own copy — one source of truth, so changing a
 * label here changes the chip without redeploying WorkTrackr.
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
 * Deliberately does NOT sort: selection order is meaningful, so the service the
 * customer was most interested in leads the email.
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

// First name only. "Dave Smith" → "Dave". Falls back to "there" so the greeting
// never reads "Hi ,".
function firstName(contactName) {
  const n = String(contactName || '').trim();
  if (!n) return 'there';
  return n.split(/\s+/)[0] || 'there';
}

// "A" · "A and B" · "A, B and C" — the way a person would write it.
function listServices(labels) {
  if (labels.length === 0) return 'our';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function applyTokens(text, vars) {
  return String(text)
    .replace(/\[NAME\]/g, escapeHtml(vars.firstName))
    .replace(/\{\{SenderName\}\}/g, escapeHtml(vars.senderName))
    .replace(/\{\{CompanyName\}\}/g, escapeHtml(vars.companyName))
    .replace(/\{\{ServiceList\}\}/g, vars.serviceList);
}

// Subjects are plain text — escaping here would put "&amp;" in the inbox.
function applyTokensPlain(text, vars) {
  return String(text)
    .replace(/\[NAME\]/g, vars.firstName)
    .replace(/\{\{SenderName\}\}/g, vars.senderName)
    .replace(/\{\{CompanyName\}\}/g, vars.companyName);
}

function buildVars({ companyName, contactName, senderName, serviceList }) {
  return {
    firstName: firstName(contactName),
    companyName: companyName || 'your business',
    senderName: senderName || 'Billy',
    serviceList: serviceList || '',
  };
}

/**
 * Subject line.
 *   one service   → that campaign's own subject, exactly as approved
 *   several       → the shared combined line
 *   any follow-up → the shared follow-up line
 */
export function buildSubject(serviceKeys, step, { companyName, contactName, senderName } = {}) {
  const vars = buildVars({ companyName, contactName, senderName });
  const keys = Array.isArray(serviceKeys) ? serviceKeys : [];
  const chosen = keys.map(k => BY_KEY.get(k)).filter(Boolean);

  // A single service keeps its own approved subject, exactly as written.
  if (step !== 2 && chosen.length === 1) {
    return applyTokensPlain(chosen[0].subject, vars);
  }

  const list = listServices(chosen.map(s => s.label));

  if (step === 2) {
    const named = `${SUBJECT_FOLLOWUP_PREFIX}${list}`;
    return applyTokensPlain(
      (chosen.length && named.length <= SUBJECT_MULTI_MAX) ? named : SUBJECT_FOLLOWUP_FALLBACK,
      vars,
    );
  }

  const named = `${SUBJECT_MULTI_PREFIX}${list}`;
  return applyTokensPlain(
    (chosen.length && named.length <= SUBJECT_MULTI_MAX) ? named : SUBJECT_MULTI_FALLBACK,
    vars,
  );
}

/**
 * Assemble the body.
 *
 * ONE service reproduces the approved email exactly.
 * SEVERAL keeps every approved body and replaces only the connective wording.
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
  const chosen = (serviceKeys || []).map(k => BY_KEY.get(k)).filter(Boolean);
  const vars = buildVars({
    companyName, contactName, senderName,
    serviceList: listServices(chosen.map(s => s.label)),
  });

  const single = chosen.length === 1;
  const isFollowup = step === 2;

  // Headings only when combining. A single-service email is a letter and a
  // heading above one block makes it look like a brochure page; combine two and
  // without headings the bodies run together as one wall of prose.
  const blocks = chosen
    .map((svc) => {
      const body = applyTokens(
        (isFollowup && svc.followupBody) ? svc.followupBody : svc.body,
        vars,
      );
      if (single) return body;
      return `<h3 style="margin:24px 0 8px;font-size:15px;font-weight:700;">`
        + `${svc.heading || svc.label}</h3>${body}`;
    })
    .join('\n');

  let opening;
  if (isFollowup) {
    opening = applyTokens(single ? OPENING_FOLLOWUP_SINGLE : OPENING_FOLLOWUP_MULTI, vars);
  } else if (single) {
    opening = applyTokens(chosen[0].openingLine, vars);
  } else {
    opening = applyTokens(OPENING_MULTI, vars);
  }

  // A single service keeps its own approved close; a combined email uses the
  // shared one, since twelve near-identical "if you'd like a chat" paragraphs
  // stacked together would read badly.
  const cta = applyTokens(single ? chosen[0].cta : CTA_MULTI, vars);

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
    applyTokens(GREETING, vars),
    opening,
    blocks,
    cta,
    applyTokens(SIGNATURE, vars),
    footer,
  ].join('\n');
}
