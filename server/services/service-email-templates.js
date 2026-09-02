/**
 * server/services/service-email-templates.js — Content blocks for WorkTrackr
 * service emails.
 *
 * SOURCE: "Sweetbyte Post Call Email Templates" (adapted from the Sweetbyte
 * Services A5 Brochure 2026). The service copy below is the approved wording —
 * treat it as content owned by the business, not as code. Editing the `html`
 * strings is expected; editing anything else is not.
 *
 * ASSEMBLY, per the source document:
 *   shared opening (once) → service block per selection → shared close (once)
 *
 * That structure is why services are BLOCKS rather than whole emails. Selecting
 * three services produces one email with three blocks and a single greeting and
 * sign-off, rather than three emails or three repeated greetings.
 *
 * ORDER: blocks render in the order the user selected them, because the source
 * document says to keep the customer's highest-interest service first. The
 * first chip tapped therefore leads the email. This is a change from the
 * earlier canonical ordering.
 *
 * FOLLOW-UP (day 7): the source document supplies initial copy only. Rather
 * than invent a second set of service claims — which would be marketing copy
 * written by a machine and attributed to Sweetbyte — the follow-up reuses the
 * approved service blocks verbatim and changes only the opening paragraph. The
 * recipient gets the same accurate information with an acknowledgement that
 * it's a second approach. To use bespoke follow-up copy later, give a service a
 * `followupHtml` and it will be used instead.
 *
 * Tokens (from the source document):
 *   {{FirstName}}    — contact's first name, or "there" when unknown
 *   {{CompanyName}}  — the company name from WorkTrackr
 *   {{SenderName}}   — the Sweetbyte team member sending
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared opening, close and signature
// ─────────────────────────────────────────────────────────────────────────────

const OPENING_INITIAL = `
  <p>Hi {{FirstName}},</p>
  <p>It was great speaking with you earlier. As promised, I've put together a
  little more information about the Sweetbyte services we discussed and how they
  could support your business.</p>
`;

// Day-7 variant. Same voice, acknowledges the earlier email, makes no new claims.
const OPENING_FOLLOWUP = `
  <p>Hi {{FirstName}},</p>
  <p>I got in touch last week after we spoke, and I wanted to follow up in case
  the timing is better now. I've included the same information below so it's all
  in one place.</p>
`;

const CLOSE = `
  <p style="margin-top:24px;">If you'd like to talk through your requirements,
  compare options or arrange a quotation, simply reply to this email or call us
  on 01702 540776. We'd be happy to help, with no pressure or obligation.</p>
  <p>Kind regards,</p>
  <p><strong>{{SenderName}}</strong></p>
  <p style="margin:0;">Sweetbyte Ltd<br>
  01702 540776 &nbsp;|&nbsp; support@sweetbyte.co.uk &nbsp;|&nbsp;
  <a href="https://www.sweetbyte.co.uk">www.sweetbyte.co.uk</a></p>
`;

// Used when more than one service is selected, per the document's subject rules.
const SUBJECT_MULTI = 'Following our conversation - information for {{CompanyName}}';

// The document gives no follow-up subject rule. One consistent line for every
// day-7 email, single or multi, so a follow-up is recognisable as one.
const SUBJECT_FOLLOWUP = 'Following up - information for {{CompanyName}}';

// ─────────────────────────────────────────────────────────────────────────────
// Service catalogue
// ─────────────────────────────────────────────────────────────────────────────
// `key` matches the "Service ID" in the source document. These are written to
// the database and to WorkTrackr's mirror table, and the dedupe rule is keyed
// on them, so renaming one orphans every historical send. Treat as permanent.
//
// `order` is presentation order for the chip grid only. It does NOT control
// block order in the email — selection order does.

export const SERVICES = [
  {
    key: 'about_sweetbyte',
    heading: 'About Sweetbyte',
    label: 'About Sweetbyte',
    order: 0,
    subject: 'A little more about Sweetbyte',
    html: `
      <p>Sweetbyte is a Rayleigh-based technology partner providing
      enterprise-level IT support and services to SME businesses, typically with
      5-100 staff. With more than 25 years of experience, we combine established
      technical expertise with practical, forward-thinking solutions.</p>
      <p>We are more than a helpdesk. Our aim is to understand the business
      behind the technology, provide tailored advice and support growth with
      systems that are reliable, secure and appropriate for the organisation.</p>
      <p>Customers choose Sweetbyte for responsive local support, consistent
      service levels and flexibility. We do not rely on lengthy contracts to
      retain customers - our focus is on earning loyalty through the quality of
      the service we provide.</p>
    `,
  },
  {
    key: 'it_support',
    heading: 'IT support packages',
    label: 'IT support packages',
    order: 1,
    subject: 'Friendly, flexible IT support for {{CompanyName}}',
    html: `
      <p>Sweetbyte provides enterprise-level IT support for SME businesses,
      backed by more than 25 years of experience and a local team. Our support is
      designed to be flexible, with three-month rolling arrangements rather than
      lengthy commitments.</p>
      <p>Reactive support covers break/fix issues, incidents, user requests,
      troubleshooting and problem resolution. Proactive support adds real-time
      monitoring, system health checks, security alerts, patch management,
      performance optimisation and preventative maintenance.</p>
      <p>Packages range from Silver for unlimited remote and reactive support,
      through Gold for combined reactive and proactive cover with monitoring and
      included onsite time, to Your Very Own IT Department for organisations
      wanting a more complete outsourced IT function, including strategic
      planning and an account manager. We can help identify the right level
      rather than selling unnecessary cover.</p>
    `,
  },
  {
    key: 'cyber_security',
    heading: 'Cyber security',
    label: 'Cyber security solutions',
    order: 2,
    subject: 'Strengthening cyber security at {{CompanyName}}',
    html: `
      <p>Sweetbyte provides layered cyber security for small and medium-sized
      businesses. This can include managed antivirus and anti-malware, ransomware
      protection, email security with spam and phishing filtering, and support
      towards Cyber Essentials certification.</p>
      <p>Cyber Essentials helps demonstrate that recognised, industry-standard
      security controls are in place. It can strengthen customer confidence and
      may be required when working with particular organisations or supply
      chains.</p>
      <p>We can also provide secure password and document protection with
      zero-knowledge architecture, two-factor authentication, health checks and
      mobile access. Setup and training are available so users understand how to
      adopt the tools properly, rather than simply being given another piece of
      software.</p>
    `,
  },
  {
    key: 'voip_telephony',
    heading: 'VoIP telephony',
    label: 'VoIP telephony',
    order: 3,
    subject: 'Flexible business telephony from Sweetbyte',
    html: `
      <p>Sweetbyte's VoIP service gives your team a flexible business phone
      system that can scale as people join, move or work remotely. Users can
      switch between a desk phone, mobile app and PC softphone, helping them stay
      reachable wherever they are working.</p>
      <p>Features such as call recording, auto-attendants and voicemail-to-email
      are included as standard, supported by a 99.9% uptime guarantee and local
      UK-based support. Flexible monthly plans mean users can be added or removed
      without lengthy contracts.</p>
      <p>We can supply entry-level, mid-range, executive and cordless handsets,
      plus wired or wireless headsets. Professional welcome messages, menu
      prompts, on-hold marketing and out-of-hours announcements are also
      available, with voice-only recordings from £50 and voice with background
      music from £99 for up to 50 words.</p>
    `,
  },
  {
    key: 'internet_wifi',
    heading: 'Internet lines &amp; Wi-Fi',
    label: 'Internet lines & Wi-Fi',
    order: 4,
    subject: 'Reliable internet and Wi-Fi for {{CompanyName}}',
    html: `
      <p>Sweetbyte provides business connectivity designed around your location,
      team size and reliance on online systems. Options include cost-effective
      FTTC and FTTP broadband, dedicated leased lines with symmetrical 1Gbps+
      speeds and 4G/5G automatic failover to help keep the business online if the
      main connection fails.</p>
      <p>We also design and manage business-grade Wi-Fi. High-capacity access
      points support busy offices, seamless roaming helps users move around
      without dropped connections, and secure guest networks keep visitors
      separated from important business data.</p>
      <p>Our managed Wi-Fi design includes a 100% coverage guarantee, with the
      network planned to eliminate dead zones. We can review your current
      connection and wireless coverage, then recommend an appropriate solution
      without overspecifying it.</p>
    `,
  },
  {
    key: 'backup_solutions',
    heading: 'Backup solutions',
    label: 'Backup solutions',
    order: 5,
    subject: 'Protecting {{CompanyName}} with managed backups',
    html: `
      <p>A reliable backup should do more than store a second copy of your data -
      it should be monitored, protected and ready to restore when you need it.
      Sweetbyte provides fully managed onsite and cloud backup solutions for
      business systems.</p>
      <p>On-premise protection can cover NAS devices, Windows servers and PCs,
      with local redundancy to support fast recovery. Cloud backup can protect
      Microsoft 365 data including mailboxes, SharePoint and Teams, using secure
      offsite storage and encrypted data transfer.</p>
      <p>Our service includes continuous monitoring, daily automated reporting
      and rapid remote restoration. If a backup fails, we investigate and fix it
      rather than leaving your team to discover the problem during an
      emergency.</p>
    `,
  },
  {
    key: 'office_365',
    heading: 'Microsoft 365',
    label: 'Office 365',
    order: 6,
    subject: 'Making Microsoft 365 easier for your team',
    html: `
      <p>Sweetbyte supplies and fully manages Microsoft 365 for businesses,
      including setup, user management and troubleshooting. This gives your team
      access to familiar tools while removing the day-to-day administration from
      your workload.</p>
      <p>Business Basic includes web and mobile versions of Word, Excel and
      PowerPoint, a 50GB Exchange mailbox, 1TB OneDrive, Teams and SharePoint.
      Business Standard adds the desktop applications and offline access for
      office-based users who need the full experience.</p>
      <p>For organisations with more advanced requirements, Microsoft 365 E3 can
      provide 100GB mailboxes, expanded OneDrive capacity, information
      protection, rights management and device management through Microsoft
      Intune. We can recommend a suitable licence mix rather than putting every
      user on the same plan.</p>
    `,
  },
  {
    key: 'domains_websites',
    heading: 'Domain names &amp; websites',
    label: 'Domain names & websites',
    order: 7,
    subject: 'Domains, websites and ongoing management',
    html: `
      <p>Sweetbyte can look after the complete lifecycle of your business
      website, from domain registration and DNS management to secure hosting, SSL
      certificates, updates and ongoing maintenance.</p>
      <p>For a new site, we offer bespoke web design including e-commerce
      websites, mobile-responsive layouts and SEO optimisation. Secure hosting
      and SSL are included in the overall approach, with ongoing security updates
      available to keep the site maintained after launch.</p>
      <p>If you already have a website, we can manage the technical work behind
      it so your team does not have to. Hosting options can be matched to the
      size and performance needs of the site, including increased storage, faster
      loading, advanced security, unlimited bandwidth and priority support where
      required.</p>
    `,
  },
  {
    key: 'automation_services',
    heading: 'Automation services',
    label: 'Automation services',
    order: 8,
    subject: 'A simpler way to automate repetitive work',
    html: `
      <p>Sweetbyte creates smart workflows that automate repetitive tasks such as
      data entry, invoicing, scheduling and order processing. The aim is
      straightforward: reduce manual effort, lower the chance of human error and
      give your team more time for higher-value work.</p>
      <p>We look at the systems and steps you already use, identify where
      information is being copied or delayed, and build a workflow around your
      business. This can include moving information between systems, triggering
      notifications, updating records and completing routine actions
      automatically.</p>
      <p>Automation can save businesses significant time each week - one customer
      saved £25,000 per year by automating order processing. Actual results
      depend on the process, but we can assess the opportunity and explain what
      is realistic before anything is built.</p>
    `,
  },
  {
    key: 'custom_app_development',
    heading: 'Custom app development',
    label: 'Custom app development',
    order: 9,
    subject: 'A custom app built around {{CompanyName}}',
    html: `
      <p>Sweetbyte designs custom-built apps around the way a business actually
      works. Rather than forcing your team to adapt to generic software, we can
      create a practical system for your processes, information and day-to-day
      tasks.</p>
      <p>A tailored app can bring information into one place, simplify data
      entry, connect separate stages of a workflow and give your team clearer
      visibility of what needs to happen next. It may support internal
      operations, customer requests, order processing, scheduling, reporting or
      another process that currently relies on spreadsheets, emails or repeated
      manual work.</p>
      <p>We start by understanding the process, where time is being lost and what
      a useful result looks like. The solution is then shaped around your
      requirements, with the aim of making work quicker, more consistent and
      easier to manage.</p>
    `,
  },
  {
    key: 'marketing_services',
    heading: 'Marketing services',
    label: 'Marketing services',
    order: 10,
    subject: 'Helping {{CompanyName}} reach more customers',
    html: `
      <p>Sweetbyte can support your online growth through social media, email
      marketing and website marketing. The service can be tailored around whether
      you want to build awareness, create enquiries, nurture existing contacts or
      improve the return from your website.</p>
      <p>Social media support can include content planning, regular posting,
      professional graphics and copywriting, community management and monthly
      reporting. Email marketing can include mobile-friendly newsletters,
      automated nurture campaigns, audience segmentation and reporting on opens,
      clicks and conversions.</p>
      <p>For website growth, we offer search engine optimisation, pay-per-click
      advertising, content marketing and transparent analytics. We can discuss
      which channels suit your audience and goals rather than treating every
      platform as essential.</p>
    `,
  },
  {
    key: 'password_document_protection',
    heading: 'Password &amp; document protection',
    label: 'Password & document protection',
    order: 11,
    subject: 'A safer way to manage passwords and documents',
    html: `
      <p>Sweetbyte's password and document protection service gives your team one
      secure place to create, store and share passwords and important
      documentation.</p>
      <p>The solution uses zero-knowledge architecture and includes two-factor
      authentication. Real-time health checks help identify areas that need
      attention, while secure mobile access means authorised users can reach the
      information they need when they are away from their desk.</p>
      <p>Setup and training are £49 per workstation or user. This includes help
      creating the user account, configuring multi-factor authentication and
      showing the user how to work with the system securely.</p>
    `,
  },
];

// Fast lookup by key. Built once at module load.
const BY_KEY = new Map(SERVICES.map(s => [s.key, s]));

export function getService(key) {
  return BY_KEY.get(key) || null;
}

export function isValidServiceKey(key) {
  return BY_KEY.has(key);
}

/**
 * Public catalogue for WorkTrackr's chip grid. WorkTrackr reads this over the
 * wire instead of hardcoding its own copy of the list — one source of truth, so
 * adding a service here makes the chip appear in WorkTrackr without a second
 * deploy.
 */
export function getCatalogue() {
  return SERVICES
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(s => ({ key: s.key, label: s.label, order: s.order }));
}

/**
 * Normalise and validate a requested selection.
 *
 * Deliberately does NOT sort: the source document says to keep the customer's
 * highest-interest service first, so selection order is meaningful and is
 * preserved all the way through to the rendered email.
 *
 * Returns { keys, invalid } — deduped, order preserved.
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

function applyTokens(text, vars) {
  return String(text)
    .replace(/\{\{FirstName\}\}/g, escapeHtml(vars.firstName))
    .replace(/\{\{CompanyName\}\}/g, escapeHtml(vars.companyName))
    .replace(/\{\{SenderName\}\}/g, escapeHtml(vars.senderName));
}

// Subject lines are plain text, not HTML — escaping here would put "&amp;" in
// the inbox for a company called "Smith & Sons".
function applyTokensPlain(text, vars) {
  return String(text)
    .replace(/\{\{FirstName\}\}/g, vars.firstName)
    .replace(/\{\{CompanyName\}\}/g, vars.companyName)
    .replace(/\{\{SenderName\}\}/g, vars.senderName);
}

function buildVars({ companyName, contactName, senderName }) {
  return {
    firstName: firstName(contactName),
    companyName: companyName || 'your business',
    senderName: senderName || 'Sweetbyte',
  };
}

/**
 * Subject line, per the source document's rules:
 *   one service   → that service's suggested subject
 *   several       → the shared multi-service line
 *   any follow-up → the shared follow-up line
 */
export function buildSubject(serviceKeys, step, { companyName, contactName, senderName } = {}) {
  const vars = buildVars({ companyName, contactName, senderName });
  const keys = Array.isArray(serviceKeys) ? serviceKeys : [];

  if (step === 2) return applyTokensPlain(SUBJECT_FOLLOWUP, vars);

  if (keys.length === 1) {
    const svc = BY_KEY.get(keys[0]);
    if (svc) return applyTokensPlain(svc.subject, vars);
  }
  return applyTokensPlain(SUBJECT_MULTI, vars);
}

/**
 * Assemble the body: shared opening → selected blocks in selection order →
 * shared close → unsubscribe footer.
 *
 * Returns a FRAGMENT, not a whole document — ses.js wraps it with the shared
 * email CSS shell so paragraph spacing matches everything else the platform
 * sends.
 *
 * `unsubUrl` is required. Every one of these goes to someone who has not opted
 * in, so there is always a working opt-out.
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

  const chosen = (serviceKeys || []).map(k => BY_KEY.get(k)).filter(Boolean);

  // Headings appear ONLY when more than one service is selected.
  //
  // A single-service email is a letter and reads as one — a heading above a
  // lone block looks like a brochure page. Merge two or more and the opposite
  // is true: without a heading the blocks run together as one wall of prose and
  // the reader cannot see where one service ends and the next begins. Checked
  // by rendering it, not by guessing.
  const showHeadings = chosen.length > 1;

  const blocks = chosen
    .map(svc => {
      const body = applyTokens(
        (step === 2 && svc.followupHtml) ? svc.followupHtml : svc.html,
        vars,
      );
      if (!showHeadings) return body;
      return `<h3 style="margin:26px 0 8px;font-size:15px;font-weight:700;">`
        + `${svc.heading || svc.label}</h3>${body}`;
    })
    .join('\n');

  const opening = applyTokens(step === 2 ? OPENING_FOLLOWUP : OPENING_INITIAL, vars);
  const close = applyTokens(CLOSE, vars);

  const footer = `
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 12px;">
    <p style="font-size:12px;color:#6b7280;margin:0;">
      You're receiving this because we spoke about ${escapeHtml(vars.companyName)}'s
      requirements. If you'd rather not hear from us again,
      <a href="${escapeHtml(unsubUrl)}" style="color:#6b7280;">unsubscribe here</a>
      and we'll stop contacting you.
    </p>
  `;

  return `${opening}\n${blocks}\n${close}\n${footer}`;
}
