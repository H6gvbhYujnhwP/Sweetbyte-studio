/**
 * server/services/service-email-templates.js — Content blocks for WorkTrackr
 * service emails.
 *
 * Each service is a BLOCK, not a whole email. An email is assembled as:
 *
 *   greeting → intro → [block per selected service] → sign-off → footer
 *
 * That's what makes multi-select work: selecting three services produces one
 * email with three blocks, not three emails. It also means writing the real
 * copy later is ten small edits rather than ten full emails, with no
 * duplicated greeting/sign-off to keep in sync.
 *
 * Every service carries TWO variants:
 *   initial  — sent right after the call
 *   followup — sent 7 days later, same service, different words
 *
 * ALL COPY BELOW IS PLACEHOLDER. The plumbing is real; the words are not.
 * Replace the `html` strings and nothing else needs to change.
 *
 * Tokens available inside any html string:
 *   {{company}}     — the company name from WorkTrackr
 *   {{contact}}     — the contact's first name, or "there" when unknown
 *   {{sender_name}} — display name of the sender
 *
 * ORDERING: blocks always render in `order` sequence, never selection order,
 * so two people picking the same services in a different sequence get an
 * identical email. `about_sweetbyte` is order 0 — when selected alongside
 * others it reads as the opening context rather than a trailing afterthought.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Service catalogue
// ─────────────────────────────────────────────────────────────────────────────
// `key` is written to the database and to WorkTrackr's own mirror table.
// Renaming a key orphans every historical send and breaks the dedupe rule
// (which is keyed on company + address + service key), so treat these as
// permanent. Adding new ones is free — append and both apps pick it up, since
// WorkTrackr reads this catalogue over the wire rather than duplicating it.

export const SERVICES = [
  {
    key: 'about_sweetbyte',
    label: 'About Sweetbyte',
    order: 0,
    subjectFragment: 'Sweetbyte — what we do',
    initial: {
      heading: 'About Sweetbyte',
      html: `
        <p>Sweetbyte is a technology partner for businesses that would rather get
        on with their work than manage their IT. We cover everything from the
        connection coming into the building to the applications running on top
        of it — websites and domains, support, telephony, security, backup,
        cloud, automation and bespoke software.</p>
        <p>Because it's all under one roof, there's one number to call when
        something isn't working, and no arguments between suppliers about whose
        problem it is.</p>
      `,
    },
    followup: {
      heading: 'Still happy to talk it through',
      html: `
        <p>I sent you an overview of Sweetbyte last week. No pressure either
        way — but if any part of it looked relevant, a short conversation is
        usually the quickest way to work out whether we're a fit.</p>
      `,
    },
  },
  {
    key: 'domains_websites',
    label: 'Domain names & websites',
    order: 1,
    subjectFragment: 'domains and websites',
    initial: {
      heading: 'Domain names & websites',
      html: `
        <p>We design, build and host business websites, and we manage the domain
        names behind them — registration, renewals, DNS and the security records
        that keep your email arriving where it should.</p>
        <p>If you already have a site, we can take over the hosting and
        maintenance without rebuilding it.</p>
      `,
    },
    followup: {
      heading: 'On the website',
      html: `
        <p>Following up on the website and domain side. If it's useful, I can put
        together a short review of your current setup — hosting, speed, and
        whether your DNS records are doing what they should — at no cost.</p>
      `,
    },
  },
  {
    key: 'it_support',
    label: 'IT support packages',
    order: 2,
    subjectFragment: 'IT support',
    initial: {
      heading: 'IT support packages',
      html: `
        <p>Our support packages give you a fixed monthly cost and a team who
        already know your setup, rather than an hourly rate and a fresh
        explanation every time something breaks.</p>
        <p>Cover ranges from remote-only through to full on-site support with
        proactive monitoring. We'll size it to how many people you have and how
        much downtime actually costs you.</p>
      `,
    },
    followup: {
      heading: 'On IT support',
      html: `
        <p>Circling back on support. The question worth asking is what happens
        today when something goes down — who picks it up, and how long you wait.
        If the answer is uncomfortable, that's usually the moment to talk.</p>
      `,
    },
  },
  {
    key: 'voip_telephony',
    label: 'VoIP telephony',
    order: 3,
    subjectFragment: 'VoIP telephony',
    initial: {
      heading: 'VoIP telephony',
      html: `
        <p>Hosted phone systems that work from the office, from home, or from a
        mobile, with the same number and the same call handling wherever you are.</p>
        <p>Call recording, auto-attendants, hunt groups and reporting are
        included rather than charged as extras, and number porting means you keep
        your existing numbers.</p>
      `,
    },
    followup: {
      heading: 'On the phone system',
      html: `
        <p>Following up on telephony. If you're still on a traditional line or in
        contract with someone else, it's worth knowing your renewal date — that's
        usually where the savings are, and we can plan around it.</p>
      `,
    },
  },
  {
    key: 'cyber_security',
    label: 'Cyber security solutions',
    order: 4,
    subjectFragment: 'cyber security',
    initial: {
      heading: 'Cyber security solutions',
      html: `
        <p>Practical security for businesses that aren't big enough for a
        security team: endpoint protection, email filtering, multi-factor
        authentication, patching, and staff awareness training.</p>
        <p>We can also take you through Cyber Essentials certification, which an
        increasing number of clients and insurers now ask for.</p>
      `,
    },
    followup: {
      heading: 'On security',
      html: `
        <p>Coming back to you on security. Most incidents we're called into start
        with an email and a password rather than anything sophisticated — which
        is good news, because those are the cheapest things to fix.</p>
      `,
    },
  },
  {
    key: 'connectivity',
    label: 'Internet lines & Wi-Fi',
    order: 5,
    subjectFragment: 'connectivity and Wi-Fi',
    initial: {
      heading: 'Internet lines & Wi-Fi',
      html: `
        <p>Business broadband, leased lines and full-fibre connections, with
        service levels that mean a fault gets fixed rather than queued behind
        residential customers.</p>
        <p>We also design and install Wi-Fi properly — surveyed rather than
        guessed, so coverage holds up across the whole building.</p>
      `,
    },
    followup: {
      heading: 'On connectivity',
      html: `
        <p>Following up on connectivity. If you can tell me your postcode I can
        check exactly what's available at your building, including anything that
        has been enabled recently. Takes a couple of minutes.</p>
      `,
    },
  },
  {
    key: 'backup',
    label: 'Backup solutions',
    order: 6,
    subjectFragment: 'backup and recovery',
    initial: {
      heading: 'Backup solutions',
      html: `
        <p>Automated, monitored, off-site backup for servers, workstations and
        cloud services — including Microsoft 365, which is not backed up by
        Microsoft in the way most people assume.</p>
        <p>Backups are tested by restoring them, because a backup nobody has ever
        restored is a hope rather than a plan.</p>
      `,
    },
    followup: {
      heading: 'On backup',
      html: `
        <p>Returning to backup. The useful question isn't whether you have one —
        it's when it was last restored from, and how long a full recovery would
        take. Happy to help you work that out either way.</p>
      `,
    },
  },
  {
    key: 'office_365',
    label: 'Office 365',
    order: 7,
    subjectFragment: 'Microsoft 365',
    initial: {
      heading: 'Office 365',
      html: `
        <p>Licensing, migration and ongoing management for Microsoft 365 — email,
        Teams, SharePoint and OneDrive — set up so that it's secure and tidy
        rather than simply switched on.</p>
        <p>We handle migrations from older mail systems with no loss of history
        and, in most cases, no downtime for your staff.</p>
      `,
    },
    followup: {
      heading: 'On Microsoft 365',
      html: `
        <p>Following up on Microsoft 365. It's worth reviewing your licence mix —
        most businesses we look at are paying for a tier above what they use, or
        missing security features they already own.</p>
      `,
    },
  },
  {
    key: 'automation',
    label: 'Automation services',
    order: 8,
    subjectFragment: 'automation',
    initial: {
      heading: 'Automation services',
      html: `
        <p>We remove the repetitive parts of a working day — rekeying data between
        systems, chasing approvals, producing the same report every week — by
        wiring your existing tools together.</p>
        <p>It usually starts small: one process, measured in hours saved per
        month, before deciding whether to go further.</p>
      `,
    },
    followup: {
      heading: 'On automation',
      html: `
        <p>Coming back on automation. If there's one job in the business that
        somebody dreads doing every week, that's almost always the right place to
        start — and the easiest to put a number against.</p>
      `,
    },
  },
  {
    key: 'app_development',
    label: 'Custom app development',
    order: 9,
    subjectFragment: 'custom software',
    initial: {
      heading: 'Custom app development',
      html: `
        <p>When off-the-shelf software doesn't fit how you actually work, we build
        something that does — web and mobile applications designed around your
        process rather than the other way round.</p>
        <p>We work in stages, so you see something usable early and decide what
        happens next based on it.</p>
      `,
    },
    followup: {
      heading: 'On custom software',
      html: `
        <p>Following up on bespoke software. If there's a spreadsheet somewhere
        holding a critical process together, that's normally the first candidate —
        and a short scoping call is enough to tell whether it's worth doing.</p>
      `,
    },
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
 * wire instead of hardcoding its own copy of the list — one source of truth,
 * so adding a service here makes it appear in WorkTrackr without a second
 * deploy.
 */
export function getCatalogue() {
  return SERVICES
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(s => ({ key: s.key, label: s.label, order: s.order }));
}

/**
 * Normalise and validate a requested service selection.
 * Returns { keys, invalid } — keys deduped and sorted into canonical order.
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
  keys.sort((a, b) => BY_KEY.get(a).order - BY_KEY.get(b).order);
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
// never reads "Hi ,". Mirrors the intent of services/name-parser.js but stays
// deliberately independent — that module is bound to campaign subscriber rows.
function firstName(contactName) {
  const n = String(contactName || '').trim();
  if (!n) return 'there';
  const first = n.split(/\s+/)[0];
  return first || 'there';
}

function applyTokens(html, vars) {
  return String(html)
    .replace(/\{\{company\}\}/g, escapeHtml(vars.company))
    .replace(/\{\{contact\}\}/g, escapeHtml(vars.contact))
    .replace(/\{\{sender_name\}\}/g, escapeHtml(vars.senderName));
}

/**
 * Subject line for a selection.
 *
 * One service  → that service's own fragment, so it reads specifically.
 * Several      → a neutral line, because stacking three service names into a
 *                subject reads like a mailshot and gets treated like one.
 */
export function buildSubject(serviceKeys, step) {
  const keys = Array.isArray(serviceKeys) ? serviceKeys : [];
  const isFollowup = step === 2;

  if (keys.length === 1) {
    const svc = BY_KEY.get(keys[0]);
    const frag = svc ? svc.subjectFragment : 'our services';
    return isFollowup ? `Following up — ${frag}` : `Sweetbyte — ${frag}`;
  }
  return isFollowup
    ? 'Following up on our conversation'
    : 'The services we discussed';
}

/**
 * Assemble the full HTML body.
 *
 * Returns a body FRAGMENT, not a whole document — ses.js wraps it with the
 * shared email CSS shell (wrapBodyWithEmailCss) so paragraph spacing matches
 * every other email the platform sends.
 *
 * `unsubUrl` is required. Every one of these goes to someone who has not opted
 * in, so there is always a working opt-out in the footer.
 */
export function renderServiceEmail({
  serviceKeys,
  step = 1,
  companyName,
  contactName,
  senderName,
  unsubUrl,
}) {
  const variant = step === 2 ? 'followup' : 'initial';
  const vars = {
    company: companyName || 'your business',
    contact: firstName(contactName),
    senderName: senderName || 'Sweetbyte',
  };

  const blocks = (serviceKeys || [])
    .map(k => BY_KEY.get(k))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map(svc => {
      const part = svc[variant];
      return `
        <h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(part.heading)}</h3>
        ${applyTokens(part.html, vars)}
      `;
    })
    .join('\n');

  const intro = step === 2
    ? `<p>Hi ${escapeHtml(vars.contact)},</p>
       <p>Just following up on my email from last week. I've put the key points
       below again so you don't have to go hunting for it.</p>`
    : `<p>Hi ${escapeHtml(vars.contact)},</p>
       <p>Thanks for taking my call. As promised, here's a little more detail on
       what we talked about.</p>`;

  const signoff = `
    <p style="margin-top:24px;">If anything here is worth a longer conversation,
    just reply to this email and we'll find a time.</p>
    <p>Kind regards,<br>${escapeHtml(vars.senderName)}<br>Sweetbyte</p>
  `;

  const footer = `
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 12px;">
    <p style="font-size:12px;color:#6b7280;margin:0;">
      You're receiving this because we spoke about ${escapeHtml(vars.company)}'s
      requirements. If you'd rather not hear from us again,
      <a href="${escapeHtml(unsubUrl)}" style="color:#6b7280;">unsubscribe here</a>
      and we'll stop contacting you.
    </p>
  `;

  return `${intro}\n${blocks}\n${signoff}\n${footer}`;
}
