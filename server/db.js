import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../data/studio.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    website TEXT,
    supergrow_workspace_name TEXT,
    supergrow_workspace_id TEXT NOT NULL,
    supergrow_api_key TEXT NOT NULL,
    timezone TEXT DEFAULT 'Europe/London',
    cadence TEXT DEFAULT 'Daily',
    posting_identity TEXT DEFAULT 'personal',
    approval_mode TEXT DEFAULT 'auto',
    rag_filename TEXT,
    rag_content TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    stage TEXT DEFAULT 'queued',
    progress INTEGER DEFAULT 0,
    total_posts INTEGER DEFAULT 96,
    posts_generated INTEGER DEFAULT 0,
    images_generated INTEGER DEFAULT 0,
    posts_deployed INTEGER DEFAULT 0,
    posts_json TEXT,
    error_log TEXT,
    files_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );
`);

// ── Logo column migration (added for logo overlay feature) ──────────────────
try { db.exec('ALTER TABLE clients ADD COLUMN logo_url TEXT'); } catch (_) {}

// ── Brand kit + image engine columns ────────────────────────────────────────
// Additive, nullable. These hold the client's visual brand and now feed BOTH
// image engines: the plain Gemini path (services/gemini.js) and the designed-ad
// gpt-image-2 path (services/openai-image.js). They are auto-populated from the
// uploaded RAG document by services/brand-extract.js (and editable by hand), so
// LinkedIn images follow the brand colours instead of inventing their own.
//   brand_colors      — palette + how to use it, e.g. "graphite #1a1a1a background, vivid green #77A734 accent, white text"
//   logo_description  — plain words describing the logo (context only — the real
//                       uploaded logo file is always composited on top)
//   type_style        — typography style description (no exact font names needed)
//   visual_style      — overall creative direction (layout / photography / mood)
//                       PLUS an explicit "avoid" list pulled from the RAG
//   image_engine      — 'gemini' (default) | 'gpt_image'. NULL is treated as
//                       'gemini' by the dispatcher in services/gemini.js, so
//                       every existing client is completely unchanged.
try { db.exec('ALTER TABLE clients ADD COLUMN brand_colors TEXT');    } catch (_) {}
try { db.exec('ALTER TABLE clients ADD COLUMN logo_description TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE clients ADD COLUMN type_style TEXT');      } catch (_) {}
try { db.exec('ALTER TABLE clients ADD COLUMN visual_style TEXT');    } catch (_) {}
try { db.exec('ALTER TABLE clients ADD COLUMN image_engine TEXT');    } catch (_) {}

// ── content_rules column migration ──────────────────────────────────────────
// Customer-defined "refine my posts" rules — short numbered constraints the
// customer types in their portal that override the LinkedIn algorithm and the
// RAG document. Examples: "Don't mention machinery breakdowns", "Don't write
// about stress". Stored as JSON array of {id, text} items. NULL or empty
// array = no rules, post generation proceeds normally. Read fresh at every
// generate/regen call so cache invalidation is automatic when the customer
// edits or deletes a rule — no Anthropic prompt-cache TTL to wait out.
try { db.exec('ALTER TABLE clients ADD COLUMN content_rules TEXT'); } catch (_) {}

// ── deployed_by column migration ──────────────────────────────────────────────
// Records which side of the platform deployed a finished campaign:
//   'admin'  — admin clicked the deploy-to-Supergrow button on the review screen
//   'portal' — customer clicked Approve all in their portal, posts auto-pushed
// Used by the admin campaign-card status pill so support can tell at a glance
// whether the operator finished the campaign or the customer self-served.
try { db.exec("ALTER TABLE campaigns ADD COLUMN deployed_by TEXT"); } catch (_) {}

// ── sent_to_customer_at column migration (decision #72) ──────────────────────
// Set when the operator clicks "Send to customer for approval" (Button 1). No
// Supergrow call happens — the portal already shows awaiting_approval
// campaigns; this timestamp just lets the admin UI render the "waiting on
// customer" state instead of the two action buttons. NULL = not yet sent to
// the customer (operator hasn't clicked Button 1). Cleared/irrelevant once the
// campaign reaches stage='done' via either route.
try { db.exec("ALTER TABLE campaigns ADD COLUMN sent_to_customer_at TEXT"); } catch (_) {}

// ── add-posts progress columns ───────────────────────────────────────────────
// Track a background "add more posts" batch on a campaign that's in review, so
// the progress bar survives a dropped live feed (the 8s poll reads these).
// add_status: NULL/'done' = not adding, 'running' = in progress, 'error' = failed.
// add_done/add_total drive the "X of N done" bar. Never touch the campaign stage.
try { db.exec("ALTER TABLE campaigns ADD COLUMN add_status TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE campaigns ADD COLUMN add_done INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE campaigns ADD COLUMN add_total INTEGER DEFAULT 0"); } catch (_) {}

// ── services.customer_pitch column migration ─────────────────────────────────
// The original `description` column is admin-facing operator text — what the
// service does and how to wire it up. The customer_pitch column is the
// customer-facing sales blurb that renders on the gated screen when a customer
// isn't subscribed to a service. Two audiences, two columns. Both seeded below.
try { db.exec("ALTER TABLE services ADD COLUMN customer_pitch TEXT"); } catch (_) {}

// ── One-shot fix: collapse legacy 'deployed' stage into 'done' ────────────────
// During customer-portal chunk 3b, the approve-all flow set stage='deployed'.
// That value isn't recognised by the admin's CampaignProgress UI (which knows
// 'awaiting_approval' → 'deploying' → 'done'), so deployed campaigns showed up
// with a broken progress bar and re-rendered the post-edit grid as if the
// campaign were still mid-flight. The decision was to collapse 'deployed' into
// 'done' (the existing terminal stage) and use the new deployed_by column to
// distinguish the two paths instead. This UPDATE backfills any campaigns that
// were already approved via the portal during testing.
try {
  db.prepare(`
    UPDATE campaigns
       SET stage = 'done',
           status = 'completed',
           deployed_by = COALESCE(deployed_by, 'portal')
     WHERE stage = 'deployed'
  `).run();
} catch (_) {}

// ── Email module tables ───────────────────────────────────────────────────────
// email_clients is completely separate from the LinkedIn 'clients' table
db.exec(`
  CREATE TABLE IF NOT EXISTS email_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#1D9E75',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_brands (
    id TEXT PRIMARY KEY,
    email_client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    from_name TEXT NOT NULL,
    from_email TEXT NOT NULL,
    reply_to TEXT NOT NULL,
    color TEXT DEFAULT '#1D9E75',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id)
  );

  CREATE TABLE IF NOT EXISTS email_lists (
    id TEXT PRIMARY KEY,
    email_client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    from_name TEXT NOT NULL,
    from_email TEXT NOT NULL,
    reply_to TEXT NOT NULL,
    subscriber_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id)
  );

  CREATE TABLE IF NOT EXISTS email_subscribers (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    status TEXT DEFAULT 'subscribed',
    created_at TEXT DEFAULT (datetime('now')),
    unsubscribed_at TEXT,
    bounced_at TEXT,
    FOREIGN KEY (list_id) REFERENCES email_lists(id),
    UNIQUE(list_id, email)
  );

  CREATE TABLE IF NOT EXISTS email_campaigns (
    id TEXT PRIMARY KEY,
    email_client_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    from_name TEXT NOT NULL,
    from_email TEXT NOT NULL,
    reply_to TEXT NOT NULL,
    html_body TEXT NOT NULL,
    plain_body TEXT,
    status TEXT DEFAULT 'draft',
    scheduled_at TEXT,
    sent_at TEXT,
    sent_count INTEGER DEFAULT 0,
    open_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    bounce_count INTEGER DEFAULT 0,
    unsubscribe_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id),
    FOREIGN KEY (list_id) REFERENCES email_lists(id)
  );

  CREATE TABLE IF NOT EXISTS email_sends (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    subscriber_id TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    opened_at TEXT,
    clicked_at TEXT,
    bounced_at TEXT,
    sent_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id),
    FOREIGN KEY (subscriber_id) REFERENCES email_subscribers(id)
  );
`);

// ── Migrations — safe to run on every startup ─────────────────────────────────
// These handle upgrading an existing database that has the old schema.

// 1. Create email_clients table if it doesn't exist yet
db.exec(`
  CREATE TABLE IF NOT EXISTS email_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#1D9E75',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// 2. For each email table, add email_client_id column if it's missing
//    (SQLite doesn't support ALTER TABLE DROP COLUMN before 3.35, so we just ADD)
const migrations = [
  { table: 'email_brands',    col: 'email_client_id', def: "TEXT NOT NULL DEFAULT ''" },
  { table: 'email_lists',     col: 'email_client_id', def: "TEXT NOT NULL DEFAULT ''" },
  { table: 'email_campaigns', col: 'email_client_id', def: "TEXT NOT NULL DEFAULT ''" },
];

for (const { table, col, def } of migrations) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    console.log(`[db] migration: added ${col} to ${table}`);
  }
}

// 3. Fix email_lists — old table has client_id as NOT NULL which blocks inserts.
//    Recreate it without that constraint if client_id column still exists.
{
  const listCols = db.prepare('PRAGMA table_info(email_lists)').all().map(r => r.name);
  if (listCols.includes('client_id')) {
    console.log('[db] migration: rebuilding email_lists to remove old client_id constraint');
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_lists_new (
        id TEXT PRIMARY KEY,
        email_client_id TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        from_name TEXT NOT NULL,
        from_email TEXT NOT NULL,
        reply_to TEXT NOT NULL,
        subscriber_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO email_lists_new (id, email_client_id, name, from_name, from_email, reply_to, subscriber_count, created_at)
        SELECT id, COALESCE(email_client_id,''), name, from_name, from_email, reply_to, subscriber_count, created_at
        FROM email_lists;
      DROP TABLE email_lists;
      ALTER TABLE email_lists_new RENAME TO email_lists;
    `);
    console.log('[db] migration: email_lists rebuilt successfully');
  }
}

// 5. Fix email_campaigns — same old client_id constraint issue
{
  const campCols = db.prepare('PRAGMA table_info(email_campaigns)').all().map(r => r.name);
  if (campCols.includes('client_id')) {
    console.log('[db] migration: rebuilding email_campaigns to remove old client_id constraint');
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_campaigns_new (
        id TEXT PRIMARY KEY,
        email_client_id TEXT NOT NULL DEFAULT '',
        list_id TEXT NOT NULL,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        from_name TEXT NOT NULL,
        from_email TEXT NOT NULL,
        reply_to TEXT NOT NULL,
        html_body TEXT NOT NULL,
        plain_body TEXT,
        status TEXT DEFAULT 'draft',
        scheduled_at TEXT,
        sent_at TEXT,
        sent_count INTEGER DEFAULT 0,
        open_count INTEGER DEFAULT 0,
        click_count INTEGER DEFAULT 0,
        bounce_count INTEGER DEFAULT 0,
        unsubscribe_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO email_campaigns_new
        SELECT id, COALESCE(email_client_id,''), list_id, title, subject, from_name, from_email, reply_to, html_body, plain_body, status, scheduled_at, sent_at, sent_count, open_count, click_count, bounce_count, unsubscribe_count, created_at
        FROM email_campaigns;
      DROP TABLE email_campaigns;
      ALTER TABLE email_campaigns_new RENAME TO email_campaigns;
    `);
    console.log('[db] migration: email_campaigns rebuilt successfully');
  }
}

// 7. Add drip/queue columns to email_campaigns
{
  const campCols = db.prepare('PRAGMA table_info(email_campaigns)').all().map(r => r.name);
  const toAdd = [
    { col:'daily_limit',    def:'INTEGER DEFAULT 0' },
    { col:'queue_position', def:'INTEGER DEFAULT 0' },
    { col:'drip_start_at',  def:'TEXT' },
    { col:'drip_sent',      def:'INTEGER DEFAULT 0' },
    { col:'send_order',     def:"TEXT DEFAULT 'top'" },
    { col:'spam_count',     def:'INTEGER DEFAULT 0' },
    // Phase 4 drip-schedule columns ─────────────────────────────────────────
    // drip_send_days: comma-separated list of weekdays the ticker may send on.
    //   Format: "0,1,2,3,4,5,6" with 0=Sun, 1=Mon, ..., 6=Sat (matches JS Date.getDay()).
    //   Default Mon-Fri so cold outreach defaults to business days.
    { col:'drip_send_days',     def:"TEXT DEFAULT '1,2,3,4,5'" },
    // drip_window_start / drip_window_end: HH:MM strings in the campaign's timezone.
    // The ticker sends randomly-jittered emails between these times each active day.
    { col:'drip_window_start',  def:"TEXT DEFAULT '09:00'" },
    { col:'drip_window_end',    def:"TEXT DEFAULT '11:00'" },
    // drip_timezone: IANA zone, e.g. 'Europe/London'. Used so DST handles itself.
    { col:'drip_timezone',      def:"TEXT DEFAULT 'Europe/London'" },
    // drip_today_date / drip_today_sent: per-day quota counter. drip_today_date is
    // the calendar date (YYYY-MM-DD in the campaign's tz) that drip_today_sent applies
    // to. The ticker resets drip_today_sent to 0 when it first sees a new date.
    { col:'drip_today_date',    def:'TEXT' },
    { col:'drip_today_sent',    def:'INTEGER DEFAULT 0' },
    // drip_last_tick_at: diagnostic — last time the ticker considered this campaign.
    { col:'drip_last_tick_at',  def:'TEXT' },
  ];
  for (const { col, def } of toAdd) {
    if (!campCols.includes(col)) {
      db.exec(`ALTER TABLE email_campaigns ADD COLUMN ${col} ${def}`);
      console.log(`[db] migration: added ${col} to email_campaigns`);
    }
  }
}

// 8. Create email_link_clicks table for tracking per-link stats
db.exec(`
  CREATE TABLE IF NOT EXISTS email_link_clicks (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    subscriber_id TEXT NOT NULL,
    url TEXT NOT NULL,
    clicked_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id),
    FOREIGN KEY (subscriber_id) REFERENCES email_subscribers(id)
  );
`);
// Click-source capture (#101b) — record WHO/WHAT clicked so corporate mail
// security scanners (Mimecast/Proofpoint/Defender etc.) can be distinguished
// from real human clicks. We keep recording every hit raw; these columns let
// us tell scanner from human. Additive, NULL on all historic rows.
{
  const clickCols = db.prepare('PRAGMA table_info(email_link_clicks)').all().map(r => r.name);
  if (!clickCols.includes('ip_address')) {
    db.exec(`ALTER TABLE email_link_clicks ADD COLUMN ip_address TEXT`);
    console.log('[db] migration: added ip_address to email_link_clicks');
  }
  if (!clickCols.includes('user_agent')) {
    db.exec(`ALTER TABLE email_link_clicks ADD COLUMN user_agent TEXT`);
    console.log('[db] migration: added user_agent to email_link_clicks');
  }
}
{
  const subCols = db.prepare('PRAGMA table_info(email_subscribers)').all().map(r => r.name);
  if (!subCols.includes('spam_at')) {
    db.exec(`ALTER TABLE email_subscribers ADD COLUMN spam_at TEXT`);
    console.log('[db] migration: added spam_at to email_subscribers');
  }
  // Phase 4 — first_name caching for {{first_name}} placeholder personalisation.
  // first_name = the parsed Christian name; NULL means we couldn't parse it and
  //   the subscriber will be skipped from any campaign that uses {{first_name}}.
  // first_name_source = 'rule' | 'ai' | 'skip' | 'manual' — provenance.
  // first_name_reason = human-readable explanation (for the preview UI).
  if (!subCols.includes('first_name')) {
    db.exec(`ALTER TABLE email_subscribers ADD COLUMN first_name TEXT`);
    console.log('[db] migration: added first_name to email_subscribers');
  }
  if (!subCols.includes('first_name_source')) {
    db.exec(`ALTER TABLE email_subscribers ADD COLUMN first_name_source TEXT`);
    console.log('[db] migration: added first_name_source to email_subscribers');
  }
  if (!subCols.includes('first_name_reason')) {
    db.exec(`ALTER TABLE email_subscribers ADD COLUMN first_name_reason TEXT`);
    console.log('[db] migration: added first_name_reason to email_subscribers');
  }
}

// 9. Add test_email to email_clients for per-client test send persistence
{
  const cols = db.prepare('PRAGMA table_info(email_clients)').all().map(r => r.name);
  if (!cols.includes('test_email')) {
    db.exec(`ALTER TABLE email_clients ADD COLUMN test_email TEXT`);
    console.log('[db] migration: added test_email to email_clients');
  }
  // default_from_email: the address every campaign on this client defaults to using
  // for both From and Reply-To. Saves typing and prevents typos. Per request 1 the
  // user only sends from one address per domain identity, so this is the natural
  // place to remember it once.
  if (!cols.includes('default_from_email')) {
    db.exec(`ALTER TABLE email_clients ADD COLUMN default_from_email TEXT`);
    console.log('[db] migration: added default_from_email to email_clients');
  }
  // default_from_name: paired with default_from_email so the From line renders as
  // "John Wicks <john@clearerpaths.co.uk>" without re-typing both halves.
  if (!cols.includes('default_from_name')) {
    db.exec(`ALTER TABLE email_clients ADD COLUMN default_from_name TEXT`);
    console.log('[db] migration: added default_from_name to email_clients');
  }
}

// ── 10. TRACKING (open/click/bounce/spam) ─────────────────────────────────────
// New tables + columns for own-domain tracking, mirroring Sendy's approach.

// 10a. email_sends.message_id — SES MessageId, used to map SNS bounce/complaint
//     notifications back to the right subscriber. Nothing else uses it.
{
  const sendCols = db.prepare('PRAGMA table_info(email_sends)').all().map(r => r.name);
  if (!sendCols.includes('message_id')) {
    db.exec(`ALTER TABLE email_sends ADD COLUMN message_id TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_email_sends_message_id ON email_sends(message_id)`);
    console.log('[db] migration: added message_id to email_sends');
  }
  // Useful for the "did we already record this open" check on the open pixel
  if (!sendCols.includes('open_count')) {
    db.exec(`ALTER TABLE email_sends ADD COLUMN open_count INTEGER DEFAULT 0`);
    console.log('[db] migration: added open_count to email_sends');
  }
  if (!sendCols.includes('click_count')) {
    db.exec(`ALTER TABLE email_sends ADD COLUMN click_count INTEGER DEFAULT 0`);
    console.log('[db] migration: added click_count to email_sends');
  }
  // 'tracked' — was open/click tracking actually applied to THIS send?
  // Recorded at send time in ses.js based on shouldTrackRecipient(). Used by
  // the portal Campaigns view to show an honest "120 tracked / 249 untracked"
  // split per campaign. Pre-feature rows default to 0; the portal endpoint
  // detects that case via a per-campaign "tracking_split_available" flag and
  // hides the split number on historic campaigns (showing only the campaign-
  // level tracking_mode pill) so we never claim a misleading "0 tracked" for
  // a campaign that actually was sent with tracking on.
  if (!sendCols.includes('tracked')) {
    db.exec(`ALTER TABLE email_sends ADD COLUMN tracked INTEGER DEFAULT 0`);
    console.log('[db] migration: added tracked to email_sends');
  }
}

// 10b. email_campaign_links — hash → original URL, per campaign.
//     Lets click links stay short in emails; we look up the destination on click.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_campaign_links (
    hash TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (campaign_id, hash)
  );
`);

// 10c. email_sns_events — raw log of every SNS notification we receive.
//     Append-only, used for debugging when a bounce/complaint didn't take effect.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_sns_events (
    id TEXT PRIMARY KEY,
    type TEXT,
    message_id TEXT,
    payload TEXT,
    received_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_email_sns_events_message_id ON email_sns_events(message_id);
`);

// ── 11. PER-CAMPAIGN TRACKING RULES ──────────────────────────────────────────
// Adds the four tracking-control columns to email_campaigns:
//   - tracking_mode       : 'off' | 'smart' | 'all'  (default 'off' — safest)
//   - tracking_threshold  : INT — minimum touch count for tracking in 'smart' mode
//   - tracking_window     : INT — months to look back when counting touches (0 = all time)
//   - track_opens / track_clicks / track_unsub : individual fine-grained toggles
// When tracking_mode='off' the three boolean toggles are ignored (no tracking).
// When 'smart' or 'all' they decide which signals to inject for eligible recipients.
{
  const cols = db.prepare('PRAGMA table_info(email_campaigns)').all().map(r => r.name);
  const toAdd = [
    { col: 'tracking_mode',      def: "TEXT DEFAULT 'off'" },
    { col: 'tracking_threshold', def: 'INTEGER DEFAULT 3' },
    { col: 'tracking_window',    def: 'INTEGER DEFAULT 6' },
    { col: 'track_opens',        def: 'INTEGER DEFAULT 0' },
    { col: 'track_clicks',       def: 'INTEGER DEFAULT 0' },
    { col: 'track_unsub',        def: 'INTEGER DEFAULT 0' },
  ];
  for (const { col, def } of toAdd) {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE email_campaigns ADD COLUMN ${col} ${def}`);
      console.log(`[db] migration: added ${col} to email_campaigns`);
    }
  }
}

// ── 12. PER-LIST "ALWAYS WARM" OVERRIDE ──────────────────────────────────────
// When set on a list, every subscriber on that list is treated as warm regardless
// of their actual touch count. Used for e.g. "existing customers" or "newsletter
// subscribers" lists where everyone has an established relationship with us.
{
  const cols = db.prepare('PRAGMA table_info(email_lists)').all().map(r => r.name);
  if (!cols.includes('always_warm')) {
    db.exec(`ALTER TABLE email_lists ADD COLUMN always_warm INTEGER DEFAULT 0`);
    console.log('[db] migration: added always_warm to email_lists');
  }
}

// Index on email_sends(subscriber_id, status, sent_at) for efficient touch-count lookups
db.exec(`CREATE INDEX IF NOT EXISTS idx_email_sends_subscriber_status_sent_at
         ON email_sends(subscriber_id, status, sent_at)`);

// ── 13. INBOX MONITORING TABLES (replies, prospects, auto-unsubscribe) ───────
// One row per connected Gmail/Workspace mailbox. The app password is encrypted
// at rest with a master key from MAILBOX_ENCRYPTION_KEY env var.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_inboxes (
    id TEXT PRIMARY KEY,
    email_client_id TEXT NOT NULL,
    email_address TEXT NOT NULL UNIQUE,
    app_password_encrypted TEXT NOT NULL,
    imap_host TEXT NOT NULL DEFAULT 'imap.gmail.com',
    imap_port INTEGER NOT NULL DEFAULT 993,
    enabled INTEGER NOT NULL DEFAULT 1,
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_polled_at TEXT,
    last_error TEXT,
    last_uid INTEGER DEFAULT 0,
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id)
  );
  CREATE INDEX IF NOT EXISTS idx_email_inboxes_enabled ON email_inboxes(enabled);
`);

// One row per reply received. The reply is matched to a subscriber/campaign
// via the In-Reply-To and References headers, when possible. Some replies
// (e.g. from someone forwarded to) won't match — they're still stored.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_replies (
    id TEXT PRIMARY KEY,
    inbox_id TEXT NOT NULL,
    email_client_id TEXT NOT NULL,
    message_id TEXT,
    in_reply_to TEXT,
    references_header TEXT,
    from_address TEXT NOT NULL,
    from_name TEXT,
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    received_at TEXT NOT NULL,
    matched_subscriber_id TEXT,
    matched_campaign_id TEXT,
    classification TEXT,         /* 'positive' | 'hard_negative' | 'soft_negative' | 'auto_reply' | 'forwarding' | 'neutral' | NULL */
    classification_confidence REAL,
    classification_reason TEXT,
    auto_unsubscribed INTEGER NOT NULL DEFAULT 0,
    handled_at TEXT,
    handled_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (inbox_id) REFERENCES email_inboxes(id),
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id)
  );
  CREATE INDEX IF NOT EXISTS idx_email_replies_inbox_received ON email_replies(inbox_id, received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_email_replies_unhandled ON email_replies(email_client_id, classification, handled_at);
  CREATE INDEX IF NOT EXISTS idx_email_replies_message_id ON email_replies(message_id);
`);

// Append-only audit log. Records every consequential action: auto-unsubscribes,
// manual reclassifications, manual unsubscribes, mailbox connect/disconnect.
// Used so you can answer "why did this person get unsubscribed?" months later.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_audit_log (
    id TEXT PRIMARY KEY,
    actor TEXT,                  /* 'system' for auto, or user identifier for manual */
    action TEXT NOT NULL,        /* 'auto_unsubscribe' | 'manual_unsubscribe' | 'mark_handled' | 'reclassify' | 'connect_mailbox' | etc. */
    target_type TEXT,            /* 'subscriber' | 'reply' | 'mailbox' */
    target_id TEXT,
    reply_id TEXT,
    metadata TEXT,               /* JSON blob for extra context */
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_email_audit_log_target ON email_audit_log(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_email_audit_log_created ON email_audit_log(created_at DESC);
`);

// ── Phase 4: multi-step follow-up sequences ─────────────────────────────────
//
// Each campaign can now have N steps (1st contact, 2nd contact, etc.). Step 1
// is auto-migrated from the existing email_campaigns.html_body so existing
// campaigns keep working unchanged. Steps 2+ live only in this table.
//
// delay_days: how many days after the previous step's send to fire this step.
//   Step 1 has delay_days=0 (it's the start).
//   The drip ticker reads this column to decide when each recipient is due.
//
// We don't store subject/from per step — those are campaign-wide (user's call).
// Threading headers (In-Reply-To, References) make follow-ups display as
// "Re: <campaign subject>" in Gmail/Outlook automatically.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_campaign_steps (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    html_body TEXT NOT NULL,
    delay_days INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_email_campaign_steps_lookup ON email_campaign_steps(campaign_id, step_number);
`);

// step_number on email_sends so we can tell which step each row was generated by.
// Defaults to 1 for backwards compat with all pre-Phase-4 sends.
{
  const sendCols = db.prepare('PRAGMA table_info(email_sends)').all().map(r => r.name);
  if (!sendCols.includes('step_number')) {
    db.exec(`ALTER TABLE email_sends ADD COLUMN step_number INTEGER NOT NULL DEFAULT 1`);
    console.log('[db] migration: added step_number to email_sends');
  }
  // Index for fast "what's the latest step this person got on this campaign?" lookups.
  // Used by the drip ticker on every tick to figure out who's due for a follow-up.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_email_sends_campaign_subscriber_step ON email_sends(campaign_id, subscriber_id, step_number)`);
}

// Per-step subject line. Each follow-up in a multi-step sequence can override
// the campaign's top-level subject — e.g. step 1 "Quick question, {{first_name}}"
// → step 2 "Re: my last note" → step 3 "One more thought". When a step's
// subject is NULL the send pipeline falls back to email_campaigns.subject so
// existing single-step campaigns keep working unchanged. Step 1's subject is
// also mirrored back to email_campaigns.subject by the PUT /steps route so
// every code path that reads campaign.subject (test sends, previews, the
// legacy single-step send path) stays consistent.
{
  const stepCols = db.prepare('PRAGMA table_info(email_campaign_steps)').all().map(r => r.name);
  if (!stepCols.includes('subject')) {
    db.exec(`ALTER TABLE email_campaign_steps ADD COLUMN subject TEXT`);
    console.log('[db] migration: added subject to email_campaign_steps');
  }
}

// Backfill: any existing campaign without a step row gets one auto-created from
// its existing html_body. Idempotent — re-runs are safe because of the UNIQUE
// index on (campaign_id, step_number). Runs every boot but only writes once
// per campaign on the first boot after this migration ships.
{
  const campaignsNeedingStep1 = db.prepare(`
    SELECT c.id, c.html_body
    FROM email_campaigns c
    LEFT JOIN email_campaign_steps s ON s.campaign_id = c.id AND s.step_number = 1
    WHERE s.id IS NULL
  `).all();
  if (campaignsNeedingStep1.length > 0) {
    const insertStep = db.prepare(`
      INSERT INTO email_campaign_steps (id, campaign_id, step_number, html_body, delay_days)
      VALUES (?, ?, 1, ?, 0)
    `);
    const tx = db.transaction((rows) => {
      for (const row of rows) {
        const stepId = `step_${row.id}_1_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        insertStep.run(stepId, row.id, row.html_body || '');
      }
    });
    tx(campaignsNeedingStep1);
    console.log(`[db] migration: backfilled step 1 for ${campaignsNeedingStep1.length} existing campaign(s)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer portal — schema (Phase 5)
//
// A customer-facing portal lives at /c/<slug>. Each email_client gets a slug,
// optional link to a LinkedIn-side `clients` row, and a set of users who can
// sign in to review LinkedIn posts, read replies, and see campaign stats.
//
// All migrations below are ADDITIVE only — never DROP. Safe to re-run on every
// boot. Backfill of slugs for existing email_clients runs once.
// ─────────────────────────────────────────────────────────────────────────────

// ── 14a. email_clients.slug — URL-safe customer identifier ───────────────────
// Used in /c/<slug> portal URL. Generated from the client's name on insert
// (see routes/email.js POST /clients), unique. We migrate existing rows here
// once so portals work for clients that were created before this column existed.
{
  const cols = db.prepare('PRAGMA table_info(email_clients)').all().map(r => r.name);
  if (!cols.includes('slug')) {
    db.exec(`ALTER TABLE email_clients ADD COLUMN slug TEXT`);
    console.log('[db] migration: added slug to email_clients');
  }

  // Backfill slugs for any rows that don't have one yet. Slug rules:
  //   - lowercase, ASCII-only
  //   - whitespace and any non-[a-z0-9] runs collapsed to a single dash
  //   - leading/trailing dashes trimmed
  //   - on collision, append -2, -3, ...  (per Wez's locked-in pre-decision)
  const baseSlug = (name) => {
    return String(name || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
      .replace(/[^\x00-\x7f]/g, '')                       // drop remaining non-ASCII
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')                        // collapse runs to single dash
      .replace(/^-+|-+$/g, '');                           // trim ends
  };
  const uniqueSlug = (name, excludeId) => {
    let candidate = baseSlug(name) || 'client';  // fallback if name was all non-ASCII
    let n = 1;
    const stmt = db.prepare(
      `SELECT id FROM email_clients WHERE slug = ? AND id != ? LIMIT 1`
    );
    while (stmt.get(candidate, excludeId || '')) {
      n += 1;
      candidate = `${baseSlug(name) || 'client'}-${n}`;
    }
    return candidate;
  };
  // Export uniqueSlug so routes/email.js can use the same algorithm on insert.
  // (Attaching to the db object — slightly hacky but avoids a separate module.)
  db._portalUniqueSlug = uniqueSlug;

  const needSlug = db.prepare(
    `SELECT id, name FROM email_clients WHERE slug IS NULL OR slug = ''`
  ).all();
  if (needSlug.length > 0) {
    const update = db.prepare(`UPDATE email_clients SET slug = ? WHERE id = ?`);
    const tx = db.transaction(rows => {
      for (const r of rows) update.run(uniqueSlug(r.name, r.id), r.id);
    });
    tx(needSlug);
    console.log(`[db] migration: backfilled slug for ${needSlug.length} existing email_client(s)`);
  }

  // Unique index — partial so historic rows that somehow ended up with NULL
  // slug don't block this. After backfill above there shouldn't be any, but
  // belt and braces.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_email_clients_slug
      ON email_clients(slug) WHERE slug IS NOT NULL
  `);
}

// ── 14b. email_clients.linkedin_client_id — link to LinkedIn-side `clients` ──
// Nullable. When set, the customer portal's LinkedIn Posts tab pulls posts
// from that LinkedIn client's most recent campaign in stage='awaiting_approval'.
// When NULL, the portal's LinkedIn Posts tab shows "Not required — this
// service isn't part of your current plan."
//
// UNIQUE so the same LinkedIn account can't be linked to two email-side
// customers by mistake (which would cause customer A to see customer B's posts).
// Partial index — NULL allowed for the common email-only case.
{
  const cols = db.prepare('PRAGMA table_info(email_clients)').all().map(r => r.name);
  if (!cols.includes('linkedin_client_id')) {
    db.exec(`ALTER TABLE email_clients ADD COLUMN linkedin_client_id TEXT`);
    console.log('[db] migration: added linkedin_client_id to email_clients');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_email_clients_linkedin_client_id
      ON email_clients(linkedin_client_id) WHERE linkedin_client_id IS NOT NULL
  `);
}

// ── 14b-2. email_clients.service_email_enabled — explicit cold-email toggle ──
// Per-customer subscription flag for cold email. The portal's Inbox and
// Campaigns tabs check this: enabled → show real data; disabled → show
// "Not required" message.
//
// Set explicitly by admin via a dropdown in the customer-edit modal. Never
// inferred from data (e.g. "do they have campaigns?"). The portal trusts
// this flag rather than guessing from row counts.
//
// Default 1 (subscribed) — every existing customer uses cold email today,
// so existing rows are correctly defaulted. New customers Wez creates from
// scratch default to subscribed too. Admin toggles to 0 for LinkedIn-only
// customers later.
//
// Future services (Facebook Posts, Instagram, etc.) follow the same pattern:
// either a `<service>_id` column for "linked to specific account" services,
// or a `service_<name>_enabled` flag for "yes/no subscription" services.
// No generic services table — each service has its own column for what it
// actually needs to store.
{
  const cols = db.prepare('PRAGMA table_info(email_clients)').all().map(r => r.name);
  if (!cols.includes('service_email_enabled')) {
    db.exec(`ALTER TABLE email_clients ADD COLUMN service_email_enabled INTEGER NOT NULL DEFAULT 1`);
    console.log('[db] migration: added service_email_enabled to email_clients');
  }
}

// ── 14c. client_users — portal users scoped per email_client ─────────────────
// Two different email_clients can both have a user called "admin" — usernames
// are scoped per (email_client_id, username). Roles are 'admin' (can manage
// other portal users) or 'viewer'.
//
// password_hash is bcrypt with cost factor 12+ (set in routes/portal-auth.js).
// last_login_at is updated by the login route on every successful sign-in;
// used by the "Your password is temporary" banner — if NULL, show banner.
db.exec(`
  CREATE TABLE IF NOT EXISTS client_users (
    id TEXT PRIMARY KEY,
    email_client_id TEXT NOT NULL,
    username TEXT NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT,
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_client_users_client_username
    ON client_users(email_client_id, username);
  CREATE INDEX IF NOT EXISTS idx_client_users_email
    ON client_users(email_client_id, email);
`);

// ── 14d. client_sessions — SQLite-backed session storage ─────────────────────
// id IS the session token (random 32-byte base64url string set by login route).
// Survives Render restarts unlike an in-memory Map.
//
// Idle timeout 7 days, absolute timeout 30 days — both enforced at session-check
// time in the route layer:
//   - On every request, push expires_at forward to (now + 7 days), but never
//     past created_at + 30 days. When now > expires_at OR now > created_at+30d,
//     the session is dead.
//
// Cleanup of expired sessions happens lazily in the route layer (delete on
// check-failure) — no cron needed.
db.exec(`
  CREATE TABLE IF NOT EXISTS client_sessions (
    id TEXT PRIMARY KEY,
    client_user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_user_id) REFERENCES client_users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_client_sessions_user
    ON client_sessions(client_user_id);
  CREATE INDEX IF NOT EXISTS idx_client_sessions_expires
    ON client_sessions(expires_at);
`);

// ── 14e. password_resets — single-use reset tokens, 1h TTL ───────────────────
// id IS the reset token (random 32-byte base64url string). Email sent via SES
// includes /c/<slug>/reset?token=<id>. Mark used_at when redeemed so the same
// token can't be replayed.
//
// On successful reset: kill ALL sessions for the user (including any new one
// the reset flow itself creates) — per Wez's pre-decision, the user has to
// sign in fresh after reset.
db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    client_user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_user_id) REFERENCES client_users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_user
    ON password_resets(client_user_id);
`);

// ── 14f. client_login_attempts — brute-force lockout window ──────────────────
// Per Wez's locked-in default: 10 failed attempts within a 15-min window locks
// the username for 15 minutes. We track per (email_client_id, username) so
// customer A's attacker can't lock customer B's identical "admin" username.
//
// Each failed login appends a row with attempted_at=now. Lockout check on
// login: COUNT(*) WHERE attempted_at > now-15min — if >= 10, reject with
// generic "Too many attempts, try again in 15 minutes."
//
// On successful login we delete this user's rows so the counter resets.
// Old rows (> 15 min) are also pruned opportunistically on every login attempt.
db.exec(`
  CREATE TABLE IF NOT EXISTS client_login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_client_id TEXT NOT NULL,
    username TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_client_login_attempts_lookup
    ON client_login_attempts(email_client_id, username, attempted_at);
`);

// ── 14g. client_post_regens — daily soft cap on Gemini regen calls ───────────
// Per Wez's spec: 30 regens per customer (email_client) per day. Each successful
// /api/portal/posts/:id/regenerate call appends a row. The check on a new regen:
// COUNT(*) WHERE email_client_id=? AND created_at >= datetime('now','-1 day').
// Soft cap returns a 429 with a clear "you've used 30/30 today, try again
// tomorrow" message.
//
// Old rows (> 24h) are kept for now in case we want a daily-volume report
// later — they're tiny.
db.exec(`
  CREATE TABLE IF NOT EXISTS client_post_regens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_client_id TEXT NOT NULL,
    client_user_id TEXT,
    campaign_id TEXT,
    post_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_client_post_regens_client_created
    ON client_post_regens(email_client_id, created_at);
`);

// ── 14h. email_outbound — outbound replies sent from the portal ──────────────
// When a customer replies to an inbox message via the portal's compose form,
// the SES send is recorded here. Threading headers (In-Reply-To, References)
// are derived from the reply's message_id at send time.
//
// We don't reuse email_sends because that table is keyed by (campaign, subscriber)
// and these outbound messages aren't part of a campaign — they're free-form
// replies. Separate table keeps the schema honest.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_outbound (
    id TEXT PRIMARY KEY,
    email_client_id TEXT NOT NULL,
    in_reply_to_reply_id TEXT,         /* the email_replies row this is a reply to */
    client_user_id TEXT,                /* which portal user clicked Send */
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    cc_address TEXT,
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    message_id TEXT,                    /* SES MessageId, for future threading */
    in_reply_to_header TEXT,            /* the In-Reply-To header value we sent */
    references_header TEXT,             /* the References header value we sent */
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    error TEXT,                         /* populated if SES send failed */
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id),
    FOREIGN KEY (in_reply_to_reply_id) REFERENCES email_replies(id),
    FOREIGN KEY (client_user_id) REFERENCES client_users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_email_outbound_client_sent
    ON email_outbound(email_client_id, sent_at DESC);
  CREATE INDEX IF NOT EXISTS idx_email_outbound_reply
    ON email_outbound(in_reply_to_reply_id);
`);

// ── 14i. Per-post approval state (lives INSIDE campaigns.posts_json) ─────────
//
// IMPORTANT: There is no separate posts table. Posts live as a JSON array
// inside the LinkedIn `campaigns` table (column posts_json). Per Wez's
// pre-decision, customer-portal approval state goes in the SAME bundle as
// every other per-post field (linkedin_post_text, image_url, app_url, etc.),
// not in a sidecar table.
//
// The fields added to each post object inside posts_json:
//   - client_approved_at        : ISO timestamp when customer approved this post
//   - client_approved_by_user_id: which client_users row clicked approve
//
// No DB migration needed for this — the columns are inside JSON. Documented
// here so future readers know where to look. The portal route layer
// (routes/portal.js, next chat chunk) reads/writes these fields by parsing
// posts_json, mutating the relevant array entry, and writing back.
//
// On "Approve all" success and full Supergrow push, the LinkedIn campaign's
// stage flips from 'awaiting_approval' to 'done' (with deployed_by='portal'
// so the admin UI shows a 'Customer approved' status pill instead of the
// usual 'Deployed' one). The portal then hides the batch (next call to
// GET /api/portal/posts returns empty list because no awaiting_approval
// campaigns remain).
//
// PARTIAL FAILURE policy: if Supergrow accepts some queue_post calls but
// errors on a later one, the stage stays at 'awaiting_approval'. Posts that
// queued successfully are marked client_approved_at; the failed and remaining
// posts stay unapproved. The portal still shows the batch so the customer/Wez
// can retry the rest. The audit log captures the partial-failure state.

// ─────────────────────────────────────────────────────────────────────────────
// ── 14j-k. GENERIC SERVICES MODEL (Phase 5.5)
//
// Replaces the per-service columns on email_clients (service_email_enabled,
// linkedin_client_id, future facebook_page_id, etc.) with two general-purpose
// tables. Adding a new service in future becomes inserting a row in `services`
// — no schema change, no per-service column, no per-service code branch.
//
// The legacy columns (service_email_enabled, linkedin_client_id) are KEPT for
// now as a backwards-compat mirror — old code paths still work until they're
// migrated to read from customer_services. A future cleanup chat can drop them
// once nothing reads them.
//
// Two tables:
//
//   services            — catalogue of service types (one row per service we offer)
//                         e.g. ('email', 'Email Inbox + Campaigns', 'live', NULL)
//                              ('linkedin', 'LinkedIn Posts', 'live', 'clients')
//                              ('facebook', 'Facebook Posts', 'coming_soon', NULL)
//                              ('seo', 'SEO', 'live', NULL) — future
//
//   customer_services   — which customers subscribe to which services
//                         (email_client_id, service_key, linked_external_id)
//                         linked_external_id is nullable; used for services that
//                         have their own customer table (LinkedIn → clients.id).
// ─────────────────────────────────────────────────────────────────────────────

// 14j. services catalogue.
db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    service_key   TEXT PRIMARY KEY,        /* 'email', 'linkedin', 'facebook', 'seo', ... */
    display_name  TEXT NOT NULL,            /* 'LinkedIn Posts' — what the customer sees */
    description   TEXT,                     /* shown in admin UI under the dropdown */
    state         TEXT NOT NULL DEFAULT 'live', /* 'live' | 'coming_soon' | 'retired' */
    link_table    TEXT,                     /* SQL table name to pick external records from, NULL for plain on/off services */
    link_label    TEXT,                     /* dropdown label when picking from link_table, e.g. 'LinkedIn account' */
    sort_order    INTEGER NOT NULL DEFAULT 100,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// 14k. customer_services — one row per (customer, service) subscription.
db.exec(`
  CREATE TABLE IF NOT EXISTS customer_services (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    email_client_id    TEXT NOT NULL,
    service_key        TEXT NOT NULL,
    linked_external_id TEXT,                /* nullable — id in service.link_table when applicable */
    enabled_at         TEXT NOT NULL DEFAULT (datetime('now')),
    enabled_by         TEXT,                /* admin actor identifier (e.g. 'admin') for audit */
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id),
    FOREIGN KEY (service_key)     REFERENCES services(service_key)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_services_unique
    ON customer_services(email_client_id, service_key);
  CREATE INDEX IF NOT EXISTS idx_customer_services_service
    ON customer_services(service_key);
`);

// One-shot fix: an earlier version of this migration created
// idx_customer_services_external_unique that blocked self-links (rows where
// email_client_id = linked_external_id). Self-links are the natural default
// for "this email customer's portal uses its own data" — they shouldn't count
// toward the uniqueness check. Drop the old index if present, then recreate
// with the self-link exemption. Idempotent: safe to re-run forever.
db.exec(`
  DROP INDEX IF EXISTS idx_customer_services_external_unique;
  /* For services with linked_external_id, prevent the same external record
     being linked to TWO DIFFERENT portal customers. Self-links (email_client_id
     = linked_external_id) are exempt — they represent "use my own data" and
     can co-exist with another customer's link to the same record. */
  CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_services_external_unique
    ON customer_services(service_key, linked_external_id)
    WHERE linked_external_id IS NOT NULL
      AND email_client_id != linked_external_id;
`);

// 14l. Seed the services catalogue with the three services we know about today.
// INSERT OR IGNORE keeps it idempotent — re-running on every boot is safe and
// future Wez can edit display_name / description in the DB if needed without
// schema changes.
//
// Note on the Email service: link_table is 'email_clients' because some
// customers' portal name (e.g. "Cube6") differs from the email system record
// they're served from (e.g. "mail.engineersolutions.co.uk"). The picker lets
// the admin point each portal customer at the right underlying email record.
{
  const seedService = db.prepare(`
    INSERT OR IGNORE INTO services
      (service_key, display_name, description, state, link_table, link_label, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const seeds = [
    ['linkedin', 'LinkedIn Posts',
      'Customers see their LinkedIn posts pending approval, drawn from the linked LinkedIn account.',
      'live', 'clients', 'LinkedIn account', 10],
    ['facebook', 'Facebook Posts',
      'Retired (decision #107) — Studio no longer offers Facebook Posts. Manus AI handles posting; Studio keeps Meta Pixels + Facebook Ads only.',
      'retired', null, null, 20],
    ['instagram', 'Instagram',
      'Coming soon — Instagram posts in your customer\'s brand voice.',
      'coming_soon', null, null, 25],
    ['tiktok', 'TikTok',
      'Coming soon — short-form video scripts and content for TikTok.',
      'coming_soon', null, null, 28],
    ['facebook_pixels', 'Meta Pixels',
      'Read-only Meta Pixel tracking for each customer (decision #107): Studio displays the pixel\'s live website activity (page views, leads, etc.). Set one pixel per customer on the admin Meta Pixels screen. State is "live" so the customer portal shows the real page once a pixel is set.',
      'live', null, null, 29],
    ['facebook_ads', 'Facebook Ads',
      'Read-only Facebook performance for each customer (decision #107): Studio displays spend, reach, leads, cost-per-lead and the live ads. Campaigns are made and managed outside Studio (Manus AI). Set one ad account per customer on the admin Facebook Ads screen. State is "live" so the customer portal shows the real page once an ad account is set.',
      'live', null, null, 31],
    ['email', 'Email (Inbox + Campaigns)',
      'Inbox replies and email-campaign stats. Pick the underlying email system record — usually the domain you send their cold email from (e.g. mail.engineersolutions.co.uk for the "Cube6" portal customer).',
      'live', 'email_clients', 'Email system record', 30],
  ];
  for (const s of seeds) seedService.run(...s);

  // Customer-facing sales pitches. Unlike `description` (which is admin
  // operator text), these are what the customer sees on a gated screen when
  // they don't have the service. Re-applied every boot so wording tweaks
  // here ship via deploy with no manual DB work. Kept short — 2-3 sentences,
  // benefit-led, no fluff.
  const pitches = [
    ['linkedin', null], // linkedin is live for everyone who has it; never gated for sales
    ['facebook', 'Reach the buyers who scroll Facebook every day. We write, design, and schedule Facebook posts in your brand voice — same approval flow as your LinkedIn posts. One review screen, posts go straight into your scheduled queue.'],
    ['instagram', 'Showcase your work where decisions get made visually. We turn your projects, products, and team moments into scroll-stopping Instagram posts — captions and images crafted in your brand voice, delivered for review every week.'],
    ['tiktok', 'Where the next generation of buyers lives. We write TikTok-native scripts and produce short-form video content that gets watched, not skipped — designed to build awareness with audiences traditional channels miss.'],
    ['facebook_pixels', 'Stop guessing who\'s converting. We install and manage your Meta Pixel and Conversions API so every form submission, sale, or sign-up flows back to Meta — making your ad spend smarter and your reporting clearer.'],
    ['facebook_ads', 'See exactly how your Facebook and Instagram ads are performing — spend, reach, leads, and cost per lead — all in one place, updated live. We design, launch, and manage the campaigns for you; your portal is your window onto the results.'],
    ['email', 'Turn cold contacts into warm conversations. We run targeted outbound email campaigns from a properly-warmed mailbox, route every reply into your portal inbox, and keep deliverability rock-solid so the right buyers actually see your message.'],
  ];
  const updatePitch = db.prepare(`UPDATE services SET customer_pitch = ? WHERE service_key = ?`);
  for (const [key, pitch] of pitches) updatePitch.run(pitch, key);

  // Idempotent upgrade: if a previous deploy seeded 'email' with link_table=NULL,
  // upgrade it now to point at email_clients. Other columns are left alone so
  // any future manual edit (e.g. wording tweak) survives.
  db.prepare(`
    UPDATE services
    SET link_table = 'email_clients',
        link_label = 'Email system record'
    WHERE service_key = 'email' AND link_table IS NULL
  `).run();

  // Idempotent rename (decision #104): the facebook_pixels service was seeded
  // on earlier deploys with display_name 'Facebook Pixels'. INSERT OR IGNORE
  // above won't touch an existing row, so force the customer-facing label to
  // 'Meta Pixels' here. The service_key stays 'facebook_pixels' everywhere —
  // only the label the customer sees changes.
  db.prepare(`
    UPDATE services SET display_name = 'Meta Pixels'
    WHERE service_key = 'facebook_pixels'
  `).run();

  // Idempotent state changes (decision #107). INSERT OR IGNORE above never
  // touches an existing row, so service-STATE changes for rows that earlier
  // deploys already created must be forced here:
  //   • 'facebook' (Facebook Posts) is retired — Studio keeps only Meta Pixels
  //     + Facebook Ads; Manus handles posting. Retiring hides it from the
  //     customer portal, the admin sidebar, and the admin Manage-services list
  //     (every read filters `state != 'retired'`).
  //   • 'facebook_ads' goes live so the customer portal shows the real
  //     read-only Facebook Ads page once an ad account is set (otherwise it
  //     would stay gated as coming_soon for everyone).
  //   • 'facebook_pixels' goes live for the same reason — so the portal Meta
  //     Pixels page shows once a pixel is set.
  db.prepare(`UPDATE services SET state = 'retired' WHERE service_key = 'facebook'`).run();
  db.prepare(`UPDATE services SET state = 'live'    WHERE service_key = 'facebook_ads'`).run();
  db.prepare(`UPDATE services SET state = 'live'    WHERE service_key = 'facebook_pixels'`).run();
}

// 14l-fp. Facebook Pixels — per-customer Meta Pixel setup record (#facebook-pixels).
// One row per customer (keyed by email_client_id, same customer identity the
// rest of the portal uses). Stores the Meta details we hold for them plus a
// setup status + checklist. The actual Meta work happens in Business Manager;
// this is Studio's management record. Live campaign numbers (Phase B) are NOT
// stored here — they'll be pulled from Meta when that's wired. Additive table,
// nothing else touched.
db.exec(`
  CREATE TABLE IF NOT EXISTS facebook_pixels (
    id               TEXT PRIMARY KEY,
    email_client_id  TEXT NOT NULL,
    business_id      TEXT,
    ad_account_id    TEXT,
    pixel_id         TEXT,
    pixel_name       TEXT,
    domain           TEXT,
    domain_verified  INTEGER NOT NULL DEFAULT 0,
    facebook_page    TEXT,
    goal             TEXT NOT NULL DEFAULT 'leads',        /* 'leads' | 'sales' */
    conversion_event TEXT,
    status           TEXT NOT NULL DEFAULT 'not_started',  /* 'not_started' | 'in_setup' | 'active' */
    checklist_json   TEXT,                                 /* JSON map of setup-step -> 0/1 */
    notes            TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_pixels_customer
    ON facebook_pixels(email_client_id);
`);

// 14l-fa. Facebook Ads — per-customer ad-account + budget record (decision #104).
// One row per customer (keyed by email_client_id, same identity the rest of the
// portal uses). Stage 1 just creates the table; Stage 2 wires the CRUD + UI.
//
// Money is stored in MINOR units (pence for GBP) to match the Meta Marketing
// API and avoid floating-point rounding — daily_budget_pence and
// max_budget_pence are whole integers. The customer screen converts to £ for
// display and back to pence on save (decision: customer always sees £).
//
//   ad_account_id      — the customer's OWN ad account inside the Green Agents
//                        business (Architecture Option A — true isolation).
//                        Stored WITHOUT the 'act_' prefix; code adds it.
//   daily_budget_pence — what the customer set as their daily spend (writes
//                        straight to the live campaign in Stage 2, no approval).
//   max_budget_pence   — the customer's own monthly cap (maps to a Meta spending
//                        limit in the write stage).
//   status             — 'not_connected' (no account yet) | 'paused' | 'active'.
// Additive table, nothing else touched.
db.exec(`
  CREATE TABLE IF NOT EXISTS facebook_ads (
    id                 TEXT PRIMARY KEY,
    email_client_id    TEXT NOT NULL,
    ad_account_id      TEXT,
    daily_budget_pence INTEGER,
    max_budget_pence   INTEGER,
    status             TEXT NOT NULL DEFAULT 'not_connected',  /* 'not_connected' | 'paused' | 'active' */
    notes              TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_ads_customer
    ON facebook_ads(email_client_id);
`);

// 14l-fa-rag. Per-customer RAG for Facebook Ads (decision #106). Mirrors the
// LinkedIn-side per-client RAG upload (clients.rag_filename / rag_content):
// the operator uploads a doc per customer, the text is extracted and stored
// here, and the ad-copy + image generation reads it. Additive ALTERs wrapped
// in try/catch so they're no-ops once the columns exist.
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN rag_filename TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN rag_content TEXT"); } catch (_) {}

// Brand logo + panel defaults per customer (decision #64 parity for Facebook).
// logo_url is the FB-side brand logo (falls back to email_clients.logo_url at
// generation if unset). position/panel/size mirror the LinkedIn Brand Panel and
// default to the exact pre-existing LinkedIn behaviour.
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN logo_url TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN logo_position TEXT DEFAULT 'bottom-right'"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN logo_panel TEXT DEFAULT 'white'"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN logo_size TEXT DEFAULT 'small'"); } catch (_) {}

// 14l-fa-creatives. Generated Facebook ad creatives (decision #106, stage 2).
// One row per generated variation, keyed by email_client_id, grouped by
// batch_id (one generation run). Studio GENERATES these (copy via Claude in the
// customer's RAG voice, image via Gemini + logo composite) — nothing is sent to
// Facebook here; that's stage 3. status: 'draft' until the operator approves.
// image_url is the final composited image; pre_logo_image_url is Gemini's raw
// output (kept so the logo can be re-placed later without re-calling Gemini,
// same convention as LinkedIn posts). cta holds a Meta call-to-action enum.
db.exec(`
  CREATE TABLE IF NOT EXISTS facebook_ad_creatives (
    id                 TEXT PRIMARY KEY,
    email_client_id    TEXT NOT NULL,
    batch_id           TEXT,
    hook_label         TEXT,
    primary_text       TEXT,
    headline           TEXT,
    cta                TEXT NOT NULL DEFAULT 'LEARN_MORE',
    image_url          TEXT,
    pre_logo_image_url TEXT,
    status             TEXT NOT NULL DEFAULT 'draft',   /* 'draft' | 'approved' */
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id)
  );
  CREATE INDEX IF NOT EXISTS idx_fb_ad_creatives_customer
    ON facebook_ad_creatives(email_client_id);
  CREATE INDEX IF NOT EXISTS idx_fb_ad_creatives_batch
    ON facebook_ad_creatives(batch_id);
`);
// Per-creative logo overrides (decision #65/#73 parity). NULL = fall back to the
// customer default on facebook_ads, then to the hardcoded default.
try { db.exec("ALTER TABLE facebook_ad_creatives ADD COLUMN logo_position TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ad_creatives ADD COLUMN logo_panel TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ad_creatives ADD COLUMN logo_size TEXT"); } catch (_) {}

// REVIVAL (decision #106 reborn): Facebook ad generation is back in Studio,
// upgraded to gpt-image-2 + brand colours pulled from the Facebook RAG. These
// additive columns extend the dormant #106 schema. Facebook stays a fully
// standalone service — its brand block is its own, never shared with the
// LinkedIn `clients` table.
//   facebook_ads.brand_colors/logo_description/type_style/visual_style
//        — brand block auto-extracted from the Facebook RAG (services/brand-extract.js)
//   facebook_ads.ad_count        — preferred number of ads per run (the dropdown)
//   facebook_ad_creatives.image_brief
//        — the visual brief that produced the image, stored so "Regenerate
//          image" keeps the same visual intent
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN brand_colors TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN logo_description TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN type_style TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN visual_style TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN ad_count INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ad_creatives ADD COLUMN image_brief TEXT"); } catch (_) {}

// 15-fa-push. Push-to-Facebook stage (campaign→ad-set→ad as PAUSED drafts).
// Per-customer push setup that the creative generation didn't need:
//   page_id / page_name       — the Facebook Page the ad posts "as" (required)
//   lead_form_id / _name       — the instant Lead form the CTA opens (required)
//   target_countries           — CSV of country codes for ad-set targeting (default GB)
//   website_url                — the advertiser's own website the ad links to (required
//                                for lead ads: Meta rejects a creative whose link points
//                                at a Facebook page rather than external content)
//   pushed_campaign_id/_adset_id/_at — what the last push created (for reference)
// daily_budget_pence already exists on facebook_ads (reused as the ad-set budget).
// All additive ALTERs wrapped in try/catch so they're no-ops once present.
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN page_id TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN page_name TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN lead_form_id TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN lead_form_name TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN target_countries TEXT DEFAULT 'GB'"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN website_url TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN pushed_campaign_id TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN pushed_adset_id TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ads ADD COLUMN pushed_at TEXT"); } catch (_) {}
// Per-creative push result. status gains a 'pushed' value (no schema change —
// it's a free-text column). fb_ad_id non-null = already on Facebook (paused),
// so it won't be pushed again; push_error holds the last failure reason.
try { db.exec("ALTER TABLE facebook_ad_creatives ADD COLUMN fb_ad_id TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ad_creatives ADD COLUMN fb_creative_id TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ad_creatives ADD COLUMN pushed_at TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ad_creatives ADD COLUMN push_error TEXT"); } catch (_) {}
// Which campaign each ad was pushed into — stamped at push time so the History
// tab can group past pushes by campaign + date. Ads pushed before this column
// existed keep a null campaign and fall into an "Earlier push" group by date.
try { db.exec("ALTER TABLE facebook_ad_creatives ADD COLUMN pushed_campaign_id TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE facebook_ad_creatives ADD COLUMN pushed_campaign_name TEXT"); } catch (_) {}

// 14m. Backfill customer_services from the legacy columns. Idempotent — uses
// INSERT OR IGNORE on the unique (email_client_id, service_key) index, so
// re-running on every boot doesn't double-up existing subscriptions.
//
// Important: we only backfill rows where the customer is currently considered
// SUBSCRIBED. For email, that's service_email_enabled=1. For linkedin, it's
// linkedin_client_id IS NOT NULL. Customers with the legacy "not subscribed"
// state get no row in customer_services at all — that's the new representation
// of "not_required" (absence of row, not a row with an off flag).
{
  // Email subscriptions. linked_external_id = the email_client's own id —
  // preserves existing behaviour (every email-enabled customer's portal sees
  // its own email data), while letting the admin re-point the link via the
  // Manage panel later if a portal customer (e.g. "Cube6") needs to point at
  // a differently-named email system record (e.g. "mail.engineersolutions.co.uk").
  //
  // For rows that already exist in customer_services from a prior deploy
  // with linked_external_id = NULL, also fill in the self-link so the schema
  // is consistent across all email subscriptions.
  const emailRows = db.prepare(`
    SELECT id FROM email_clients
    WHERE service_email_enabled = 1
      AND id NOT IN (SELECT email_client_id FROM customer_services WHERE service_key = 'email')
  `).all();
  if (emailRows.length > 0) {
    const ins = db.prepare(`
      INSERT OR IGNORE INTO customer_services
        (email_client_id, service_key, linked_external_id, enabled_by)
      VALUES (?, 'email', ?, 'backfill')
    `);
    const tx = db.transaction(rows => { for (const r of rows) ins.run(r.id, r.id); });
    tx(emailRows);
    console.log(`[db] migration: backfilled customer_services email rows for ${emailRows.length} customer(s)`);
  }
  // Patch any pre-existing email rows that still have NULL linked_external_id
  // (would happen if a prior deploy used the on/off design before this upgrade).
  const patched = db.prepare(`
    UPDATE customer_services
    SET linked_external_id = email_client_id
    WHERE service_key = 'email' AND linked_external_id IS NULL
  `).run();
  if (patched.changes > 0) {
    console.log(`[db] migration: self-linked email service for ${patched.changes} pre-existing row(s)`);
  }

  // LinkedIn subscriptions — preserve the linked_external_id link.
  const linkedinRows = db.prepare(`
    SELECT id, linkedin_client_id FROM email_clients
    WHERE linkedin_client_id IS NOT NULL
      AND id NOT IN (SELECT email_client_id FROM customer_services WHERE service_key = 'linkedin')
  `).all();
  if (linkedinRows.length > 0) {
    const ins = db.prepare(`
      INSERT OR IGNORE INTO customer_services
        (email_client_id, service_key, linked_external_id, enabled_by)
      VALUES (?, 'linkedin', ?, 'backfill')
    `);
    const tx = db.transaction(rows => { for (const r of rows) ins.run(r.id, r.linkedin_client_id); });
    tx(linkedinRows);
    console.log(`[db] migration: backfilled customer_services linkedin rows for ${linkedinRows.length} customer(s)`);
  }
}

// 14n. portal_enabled flag on email_clients — only customers explicitly
// enabled-for-portal show up on the Customer Portal admin page. This separates
// "I send cold email from this domain" from "this customer has a portal".
//
// Default 0 (not portal-enabled) so existing cold-email-only customers don't
// suddenly appear on the Customer Portal list. The admin must opt each one in
// via the new Manage panel toggle, OR create a brand-new portal customer via
// the new "+ New portal customer" button.
{
  const cols = db.prepare('PRAGMA table_info(email_clients)').all().map(r => r.name);
  if (!cols.includes('portal_enabled')) {
    db.exec(`ALTER TABLE email_clients ADD COLUMN portal_enabled INTEGER NOT NULL DEFAULT 0`);
    console.log('[db] migration: added portal_enabled to email_clients');
  }
  // Backfill: any email_client that already has at least one portal user
  // is implicitly portal-enabled. This covers the test users you've created
  // already so they don't disappear from the admin UI on next deploy.
  const auto = db.prepare(`
    UPDATE email_clients SET portal_enabled = 1
    WHERE portal_enabled = 0
      AND id IN (SELECT DISTINCT email_client_id FROM client_users)
  `).run();
  if (auto.changes > 0) {
    console.log(`[db] migration: portal_enabled=1 set for ${auto.changes} customer(s) with existing portal users`);
  }
}

// 14o. logo_url on email_clients — portal customers can have their own logo
// uploaded directly from the admin Manage panel. Synchronised with the
// LinkedIn-side `clients.logo_url` when a customer is linked to a LinkedIn
// account: uploading on either side propagates to the other so customer
// branding stays consistent across views.
{
  const cols = db.prepare('PRAGMA table_info(email_clients)').all().map(r => r.name);
  if (!cols.includes('logo_url')) {
    db.exec(`ALTER TABLE email_clients ADD COLUMN logo_url TEXT`);
    console.log('[db] migration: added logo_url to email_clients');
  }
  // Initial sync: copy LinkedIn logos to portal customers that are linked
  // to a LinkedIn account but don't yet have their own logo. One-shot — only
  // fills in NULLs, never overwrites a portal-uploaded logo. Uses the
  // customer_services link if available, else the legacy linkedin_client_id.
  const linkedRows = db.prepare(`
    SELECT
      ec.id AS portal_id,
      COALESCE(
        (SELECT linked_external_id FROM customer_services
          WHERE email_client_id = ec.id AND service_key = 'linkedin'),
        ec.linkedin_client_id
      ) AS linked_id
    FROM email_clients ec
    WHERE ec.logo_url IS NULL
  `).all();
  if (linkedRows.length > 0) {
    const get = db.prepare(`SELECT logo_url FROM clients WHERE id = ?`);
    const upd = db.prepare(`UPDATE email_clients SET logo_url = ? WHERE id = ?`);
    let copied = 0;
    db.transaction(rows => {
      for (const r of rows) {
        if (!r.linked_id) continue;
        const lc = get.get(r.linked_id);
        if (lc?.logo_url) { upd.run(lc.logo_url, r.portal_id); copied++; }
      }
    })(linkedRows);
    if (copied > 0) {
      console.log(`[db] migration: copied LinkedIn logo to ${copied} portal customer(s) on initial sync`);
    }
  }
}

// ── email_clients.source classification ─────────────────────────────────────
// Distinguishes "real email-sending customers" from "portal anchor rows".
//
// Background. The Email Campaigns Customers page (`GET /api/email/clients`)
// originally listed every row in `email_clients`. That worked when every
// row was a real cold-email customer. Once the Customer Portal shipped, any
// LinkedIn-only customer (Cube6, Mansons, Tower Leasing) also got an
// email_clients row created as their portal anchor — and those started
// appearing in the Email Campaigns list, confusing the operator.
//
// Three values:
//   'aws_domain' — name matches a verified SES domain; the row represents a
//                  real (or potential) cold-email-sending customer. Auto-pulled
//                  from AWS by the loadAll() sync in EmailSection.jsx.
//   'manual'    — operator hit "+ New client" with a name that is NOT a
//                  verified SES domain. Vanishingly rare today but kept for
//                  completeness.
//   'portal'    — created as a portal anchor for a LinkedIn-only customer.
//                  Hidden from the Email Campaigns customers list.
//
// On-boot one-shot migration. For existing rows with NULL source we use a
// conservative classifier that doesn't depend on talking to AWS:
//   portal_enabled = 1 AND no email-sending activity     →  'portal'
//   everything else                                       →  'aws_domain'
// "Email-sending activity" = at least one row in email_lists, email_subscribers
// (via lists), email_campaigns, OR email_inboxes for this client. If a portal
// customer ever does become a real email-sending customer the row will already
// have activity and stay classified as aws_domain — the classifier is
// self-healing.
//
// The diagnostic run on 2026-05-08 confirmed this rule cleanly separates the
// 13 existing rows: Cube6 / Mansons / Tower Leasing → portal; everything else
// → aws_domain. No edge cases.
{
  const cols = db.prepare('PRAGMA table_info(email_clients)').all().map(r => r.name);
  if (!cols.includes('source')) {
    db.exec(`ALTER TABLE email_clients ADD COLUMN source TEXT`);
    console.log('[db] migration: added source to email_clients');
  }

  // One-shot classification of any rows with NULL source. Idempotent — only
  // touches rows where source IS NULL, so re-runs after the migration is
  // already done are no-ops.
  const unclassified = db.prepare(`
    SELECT
      ec.id,
      ec.name,
      ec.portal_enabled,
      (SELECT COUNT(*) FROM email_lists       WHERE email_client_id = ec.id) AS lists,
      (SELECT COUNT(*) FROM email_subscribers es
         JOIN email_lists el ON es.list_id = el.id
         WHERE el.email_client_id = ec.id)                                   AS subs,
      (SELECT COUNT(*) FROM email_campaigns   WHERE email_client_id = ec.id) AS camps,
      (SELECT COUNT(*) FROM email_inboxes     WHERE email_client_id = ec.id) AS inbox
    FROM email_clients ec
    WHERE ec.source IS NULL
  `).all();

  if (unclassified.length > 0) {
    const upd = db.prepare(`UPDATE email_clients SET source = ? WHERE id = ?`);
    let portalCount = 0;
    let domainCount = 0;
    db.transaction(rows => {
      for (const r of rows) {
        const hasActivity = r.lists > 0 || r.subs > 0 || r.camps > 0 || r.inbox > 0;
        const isPortalOnly = r.portal_enabled === 1 && !hasActivity;
        if (isPortalOnly) {
          upd.run('portal', r.id);
          portalCount++;
        } else {
          upd.run('aws_domain', r.id);
          domainCount++;
        }
      }
    })(unclassified);
    console.log(`[db] migration: classified ${unclassified.length} email_clients rows (portal=${portalCount}, aws_domain=${domainCount})`);
  }
}

// Reset any stuck algorithm analysis runs on startup
// Also clear any partial/garbage brief (valid brief starts with # LinkedIn Algorithm)
db.prepare("UPDATE linkedin_settings SET brief_running = 0 WHERE id = 1").run();
{
  const row = db.prepare("SELECT algorithm_brief FROM linkedin_settings WHERE id = 1").get();
  if (row?.algorithm_brief && !row.algorithm_brief.trim().startsWith('#')) {
    db.prepare("UPDATE linkedin_settings SET algorithm_brief = NULL, brief_updated_at = NULL WHERE id = 1").run();
    console.log('[db] Cleared invalid algorithm brief (did not start with #)');
  }
}

// ── Per-customer brand panel settings on clients ─────────────────────────────
// Per-customer overrides for how the logo is composited onto generated post
// images. Three settings, all defaulting to the existing behaviour so every
// pre-existing customer is unchanged on first deploy:
//
//   logo_position — which corner the logo lands in:
//     'bottom-right' (default) | 'top-right' | 'bottom-left' | 'top-left'
//   logo_panel    — whether a white panel sits behind the logo:
//     'white' (default — decision #42's always-white panel) | 'none'
//   logo_size     — how big the logo appears on the 1024px image:
//     'small' (default — max 280×100, current behaviour)
//     'medium' (max 480×160)
//     'large'  (max 640×220 — roughly 2× the small width)
//
// These are read by services/gemini.js at composite time. The Gemini prompt
// is also keyed on logo_position so the model is told which corner to leave
// clear of text/subject. See decision-log entry added for this feature.
//
// First real use: The Manson Group ('top-right' / 'none' / 'large'). Their
// dark-blue logo with built-in background reads better placed directly on
// the image without a white panel; top-right also moves it out of the zone
// Gemini tends to fill with headline text.
{
  const cCols = db.prepare('PRAGMA table_info(clients)').all().map(r => r.name);
  if (!cCols.includes('logo_position')) {
    db.exec(`ALTER TABLE clients ADD COLUMN logo_position TEXT DEFAULT 'bottom-right'`);
    console.log('[db] migration: added logo_position to clients');
  }
  if (!cCols.includes('logo_panel')) {
    db.exec(`ALTER TABLE clients ADD COLUMN logo_panel TEXT DEFAULT 'white'`);
    console.log('[db] migration: added logo_panel to clients');
  }
  if (!cCols.includes('logo_size')) {
    db.exec(`ALTER TABLE clients ADD COLUMN logo_size TEXT DEFAULT 'small'`);
    console.log('[db] migration: added logo_size to clients');
  }
}

// ── logo_processed_at columns ─────────────────────────────────────────────────
// Marker timestamps recording that a logo file has been trimmed via
// services/logo-prep.js and stored in its canonical pre-trimmed form in R2.
// NULL means "this row predates the trim-at-upload pipeline and may still
// have a raw, untrimmed logo in R2."
//
// The boot-time backfill in services/logo-backfill.js walks rows where this
// column is NULL and logo_url is set, downloads the file, re-trims it,
// uploads the trimmed version back to R2, updates logo_url to point at the
// new key, and stamps logo_processed_at. After backfill every row is either
// NULL+no-logo or processed-with-trimmed-logo.
//
// Both upload routes (POST /api/clients/:id/logo and
// POST /api/portal-admin/customers/:id/logo) stamp this column on success so
// the backfill skips rows it has already handled or that came in via the
// new upload path.
{
  const cCols = db.prepare('PRAGMA table_info(clients)').all().map(r => r.name);
  if (!cCols.includes('logo_processed_at')) {
    db.exec(`ALTER TABLE clients ADD COLUMN logo_processed_at TEXT`);
    console.log('[db] migration: added logo_processed_at to clients');
  }
  const eCols = db.prepare('PRAGMA table_info(email_clients)').all().map(r => r.name);
  if (!eCols.includes('logo_processed_at')) {
    db.exec(`ALTER TABLE email_clients ADD COLUMN logo_processed_at TEXT`);
    console.log('[db] migration: added logo_processed_at to email_clients');
  }
}

export default db;

// ── LinkedIn Algorithm Brief ──────────────────────────────────────────────────
// Single-row settings table that stores the latest algorithm brief from
// the Marketing Analyst Agent. Injected into every Claude campaign call.
db.exec(`
  CREATE TABLE IF NOT EXISTS linkedin_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    algorithm_brief TEXT,
    brief_updated_at TEXT,
    brief_running INTEGER DEFAULT 0
  );
  INSERT OR IGNORE INTO linkedin_settings (id) VALUES (1);
`);

// ── CRM — Hot Prospects ──────────────────────────────────────────────────────
// One row per (customer, prospect-email). Adding the same prospect twice
// updates the existing row rather than creating a duplicate (handled at the
// route layer via INSERT ... ON CONFLICT, with a UNIQUE index here as the
// belt-and-braces guarantee).
//
// added_by is a free-text string: 'admin:<username>' for admin-side adds,
// 'portal:<client_user_id>' for portal-side adds, so the row's origin is
// auditable forever.
//
// The email thread itself is NOT stored on this row — it's built live by
// joining email_replies (inbound from this address) + email_outbound (sent
// to this address) at read time. That way new mail auto-appears in the
// thread without any sync work, matching the operator-confirmed design
// (auto-update, append-only history exposure).
db.exec(`
  CREATE TABLE IF NOT EXISTS hot_prospects (
    id TEXT PRIMARY KEY,
    email_client_id TEXT NOT NULL,
    prospect_email TEXT NOT NULL,
    prospect_name TEXT,
    follow_up_date TEXT,              /* nullable; ISO date 'YYYY-MM-DD' */
    notes TEXT,
    added_by TEXT NOT NULL,           /* 'admin:<username>' or 'portal:<client_user_id>' */
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (email_client_id) REFERENCES email_clients(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_prospects_client_email
    ON hot_prospects(email_client_id, prospect_email);
  CREATE INDEX IF NOT EXISTS idx_hot_prospects_client_added
    ON hot_prospects(email_client_id, added_at DESC);
  CREATE INDEX IF NOT EXISTS idx_hot_prospects_follow_up
    ON hot_prospects(email_client_id, follow_up_date)
    WHERE follow_up_date IS NOT NULL;
`);

// ─────────────────────────────────────────────────────────────────────────────
// Migration: hot_prospects.closed_at + closed_by  (decision 2026-05-20, third
// session — "Mark as converted")
//
// `closed_at`  — ISO datetime when the prospect was marked converted (i.e.
//                became a real customer). NULL means active.
// `closed_by`  — actor identifier: 'admin' or 'portal:<client_user_id>'.
//
// Both nullable; existing rows stay active by default (NULL). Idempotent
// ALTER pattern: try the ADD COLUMN, swallow the "duplicate column" error
// SQLite throws when it's already been applied on a previous boot. Matches
// the pattern already used elsewhere in this file for additive columns.
// ─────────────────────────────────────────────────────────────────────────────
try { db.exec(`ALTER TABLE hot_prospects ADD COLUMN closed_at TEXT`); } catch {}
try { db.exec(`ALTER TABLE hot_prospects ADD COLUMN closed_by TEXT`); } catch {}

// ─────────────────────────────────────────────────────────────────────────────
// Migration: hot_prospects.source_reply_id  (decision 2026-05-21 — Formspree
// source-email pinning so the thread renders the original inbound row even
// when the prospect's email address doesn't match its from_address).
//
// `source_reply_id` — FK to email_replies.id. NULL for manual-add prospects
// whose source IS already in the thread by address match; populated for
// auto-flagged Formspree leads where the source row's from_address is
// noreply@formspree.io but the actual prospect address lives in the body.
//
// Nullable; idempotent ALTER pattern like closed_at/closed_by above. Existing
// rows stay NULL by default (and the GET .../thread endpoints will simply
// fall through to the address-match path for them).
// ─────────────────────────────────────────────────────────────────────────────
try { db.exec(`ALTER TABLE hot_prospects ADD COLUMN source_reply_id TEXT`); } catch {}

// ─────────────────────────────────────────────────────────────────────────────
// Migration: hot_prospects status/tag/viewed-tracking
//   (decision 2026-05-21 — pipeline status + per-side unread tracking).
//
// `status`         — fixed-set pipeline state: 'new' | 'contacted' |
//                    'no_response'. NOT NULL with default 'new'. Drives
//                    both the status pill in the list and the default row
//                    tint when no custom tag_color is set. Existing rows
//                    backfill to 'new'.
//
// `tag_color`      — optional customer-chosen tag colour overlaying the
//                    status default. Stored as the colour NAME ('red',
//                    'orange', 'yellow', 'green', 'blue', 'purple', 'pink',
//                    'grey') rather than a hex — keeps the palette
//                    centralised in the frontend so we can adjust hex codes
//                    later without migrating data. NULL means "no override —
//                    use status default". Bounded palette deliberate;
//                    free-hex picker was considered and rejected because
//                    nothing prevents an operator picking an unreadable
//                    colour pair against the row background.
//
// `admin_first_viewed_at`  — ISO datetime the admin first opened this
//                            prospect's detail modal. NULL = never viewed
//                            on admin side. Drives the "NEW" pill on the
//                            admin list. One-way write — never re-cleared.
//
// `portal_first_viewed_at` — same idea, portal side. NULL = never viewed
//                            in the customer portal. Drives BOTH the per-row
//                            "NEW" pill on the portal list AND the unread
//                            count badge on the portal sidebar. Tracked
//                            separately from admin because admin and
//                            customer are different audiences — admin
//                            opening a prospect should not silently clear
//                            the customer's "you have something new" signal
//                            (and vice versa).
//
// All four migrations use the idempotent ALTER pattern. Default-NOT-NULL
// requires backfilling existing rows so old data doesn't violate the
// constraint — SQLite can't add a NOT NULL column with no default in one
// step, so we do (1) ADD nullable, (2) UPDATE to set the default for
// existing rows, then optionally (3) leave the column as nullable since
// SQLite's runtime is forgiving and our INSERT paths always specify a
// value (no orphan rows possible).
// ─────────────────────────────────────────────────────────────────────────────
try { db.exec(`ALTER TABLE hot_prospects ADD COLUMN status TEXT NOT NULL DEFAULT 'new'`); } catch {}
try { db.exec(`ALTER TABLE hot_prospects ADD COLUMN tag_color TEXT`); } catch {}
try { db.exec(`ALTER TABLE hot_prospects ADD COLUMN admin_first_viewed_at TEXT`); } catch {}
try { db.exec(`ALTER TABLE hot_prospects ADD COLUMN portal_first_viewed_at TEXT`); } catch {}
// Backfill: any rows that pre-date the status migration where the default
// didn't fire (shouldn't happen with the DEFAULT clause above, but defence
// in depth — at worst this is a no-op).
try { db.exec(`UPDATE hot_prospects SET status = 'new' WHERE status IS NULL OR status = ''`); } catch {}
// Index for the unread-count query (portal sidebar). One row per prospect,
// scoped by email_client_id, filtered by NULL portal_first_viewed_at +
// active (closed_at IS NULL). Partial index keeps it tiny.
try { db.exec(`
  CREATE INDEX IF NOT EXISTS idx_hot_prospects_portal_unread
    ON hot_prospects(email_client_id)
    WHERE portal_first_viewed_at IS NULL AND closed_at IS NULL
`); } catch {}

// Partial index for the badge/list "is this row converted?" filter.
// WHERE closed_at IS NOT NULL means the index only stores rows that ARE
// converted — fast lookups for "converted prospects" without bloating the
// index with the much larger active-prospects population.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_hot_prospects_closed_at
    ON hot_prospects(email_client_id, closed_at)
    WHERE closed_at IS NOT NULL;
`);

// ─────────────────────────────────────────────────────────────────────────────
// Per-contact, per-campaign unsubscribe state (decision 2026-05-22).
//
// Two tables — `campaign_unsubscribes` for per-campaign opt-outs, and
// `contact_unsubscribed_all` for the master "Unsubscribe from ALL campaigns
// (including future)" tick. Both are linked-set scoped at read time the same
// way hot_prospects is (resolveLinkedSet → IN clause), so a Cube6-style
// linked customer's anchor and inbox row share state.
//
// Why two tables instead of one with a nullable campaign_id:
//   • The per-campaign rows have a real foreign-key relationship to
//     email_campaigns; the "all campaigns" flag is a property of the
//     (customer, contact) pair with no campaign at all. Mixing them in one
//     table means every read has to special-case the NULL campaign_id, which
//     is the kind of overload-with-two-meanings the #97 work was specifically
//     trying to avoid (lesson from `contact_on_list` vs `contact_unsubscribed`).
//   • The drip-ticker check becomes two clean NOT EXISTS clauses, one per
//     table — easy to read, easy to index.
//
// Why store contact_email and email_client_id directly instead of joining
// through hot_prospects:
//   • Not every relevant contact is a hot prospect. The panel is also shown
//     in the inbox open-email modal where the sender may never have been
//     flagged as a prospect. We need to store opt-outs against the raw
//     (customer, email) pair, independent of CRM state.
//   • email_client_id is denormalised here for the same reason hot_prospects
//     stores it directly — fast IN-clause lookups across the linked set
//     without an extra join through email_campaigns.
//
// Why store under the campaign's email_client_id (not the prospect's
// email_client_id when they differ for linked customers):
//   • The owning row is the canonical one — campaigns live under the portal
//     anchor (Cube6), not the inbox row (mail.eng). When the auto-tick on
//     Hot Prospect add fires from the inbox row, it still writes under the
//     anchor's id so subsequent reads under either side of the linked set
//     find it via the same IN-clause filter.
//   • Smoke-tested 2026-05-22 against the Cube6 + Manson realistic shapes
//     before this migration was written (lesson #77).
//
// source values used:
//   'manual'              — operator/customer ticked the box themselves
//   'hot_prospect_auto'   — auto-applied when contact was added to Hot
//                           Prospects; the source reply's matched_campaign_id
//                           is what gets ticked.
//   'list_unsubscribe'    — reserved for future bridge from the existing
//                           list-level Unsubscribe button to also tick every
//                           campaign on that list. Not used yet — kept here
//                           so audit reads make sense if we add it later.
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS campaign_unsubscribes (
    id TEXT PRIMARY KEY,
    email_client_id TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    unsubscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT,
    UNIQUE(email_client_id, contact_email, campaign_id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS contact_unsubscribed_all (
    email_client_id TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    unsubscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT,
    PRIMARY KEY(email_client_id, contact_email)
  );
`);

// Indexes for the panel-state read (look up everything for one contact under
// the customer's linked set) and the drip-ticker gate (look up rows for a
// specific (campaign, email)). The drip-ticker gate is the hot path — runs
// per-candidate on every tick — so an index keyed on campaign_id + email is
// the right shape for it.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_campaign_unsubscribes_client_email
    ON campaign_unsubscribes(email_client_id, contact_email);
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_campaign_unsubscribes_campaign_email
    ON campaign_unsubscribes(campaign_id, contact_email);
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_contact_unsubscribed_all_lookup
    ON contact_unsubscribed_all(email_client_id, contact_email);
`);

// ── 21. admin_users — Studio admin STAFF accounts (Phase 1 of Sales CRM) ──────
// The admin side historically had ONE shared login (STUDIO_USERNAME +
// STUDIO_PASSWORD env vars). That env login STILL works and is the permanent
// break-glass SUPER-ADMIN — it can never be locked out and always has full
// access. These rows are ADDITIONAL named staff accounts the super-admin
// creates, each with their own bcrypt password and a per-user access map.
//
// access_json: JSON object { "<section_key>": true, ... } — which sidebar
//   sections this user may see. is_super=1 ignores access_json (full access).
//   Section keys live in routes/admin-users.js (SECTIONS) — single source of
//   truth for the tickbox grid.
// disabled_at: soft-disable (keeps the row + history, blocks login). NULL = active.
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    is_super INTEGER NOT NULL DEFAULT 0,
    access_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT,
    disabled_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username
    ON admin_users(LOWER(username));
`);

// ── 22. admin_sessions — SQLite-backed sessions for named staff logins ────────
// id IS the bearer token (crypto.randomBytes(32).base64url), returned by
// /api/auth/login and sent back as `Authorization: Bearer <token>` (or ?token=
// for SSE) — exactly the same transport as the legacy env-password token, so
// the frontend's existing auth plumbing is untouched. Idle 7d / absolute 30d,
// enforced in middleware/auth.js + routes/auth.js. The env break-glass login
// does NOT create a session row — it stays stateless as before.
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    admin_user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_admin_sessions_user
    ON admin_sessions(admin_user_id);
  CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires
    ON admin_sessions(expires_at);
`);

// ── 23. crm_companies — Sales CRM company records (Phase 2) ───────────────────
// The CENTRE of the Sales CRM. Everything else (contacts, history, tasks,
// deals, orders — later phases) hangs off a company row.
//
// MULTI-TENANT by design: `tenant` is the sealed box this row belongs to.
//   'tga'                 → The Green Agents' own pipeline (built first).
//   <email_clients.id>    → a customer's own private CRM (final phase).
// Every read/write is scoped by tenant so boxes never see each other.
//
// status: 'suspect' | 'prospect' | 'hot_prospect' | 'customer' (the sales stage).
// account_manager_id: who owns the company — an admin_users.id, the literal
//   '__super__' (the break-glass super-admin / "you"), or NULL (unassigned).
//   Resolved to a display name at read time; survives staff deletion (shows
//   "Unassigned" if the owner row is later removed — just reassign).
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_companies (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'suspect',
    account_manager_id TEXT,
    website TEXT,
    phone TEXT,
    address TEXT,
    town TEXT,
    postcode TEXT,
    category TEXT,
    source TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_crm_companies_tenant_status
    ON crm_companies(tenant, status);
  CREATE INDEX IF NOT EXISTS idx_crm_companies_tenant_name
    ON crm_companies(tenant, LOWER(name));
`);

// ── 24. crm_contacts — people within a CRM company (Phase 3) ──────────────────
// Multiple contacts per company. `tenant` is denormalised from the parent
// company so every read/write stays scoped to one box without a join, and a
// stray company_id can never leak a contact across tenants. Deleting a company
// removes its contacts (explicit cascade in routes/crm-companies.js).
// is_decision_maker: 0/1 — more than one contact may be flagged.
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_contacts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    email TEXT,
    phone TEXT,
    is_decision_maker INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_crm_contacts_company ON crm_contacts(company_id);
`);

// ── 25. crm_history — activity timeline per CRM company (Phase 4) ──────────────
// Reverse-chronological audit trail. `kind` is one of the manual types
// (note | call | email | meeting) or an auto type (status_change | system)
// dropped in by other parts of the app. `author` is a NAME SNAPSHOT taken at
// write time (the logged-in user's username, or the actor for auto entries),
// so the line still reads correctly even if that staff member is later removed.
// `tenant` denormalised for box scoping. Deleting a company clears its history
// (explicit cascade in routes/crm-companies.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_history (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'note',
    body TEXT NOT NULL,
    author TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_crm_history_company ON crm_history(company_id, created_at DESC);
`);

// ── 26. crm_tasks — sales tasks per CRM company (Phase 5) ─────────────────────
// A task belongs to a company and is assigned to a staff member (assignee_id:
// admin_users.id | '__super__' | NULL). `tenant` denormalised for box scoping.
// priority: low | normal | high. status: open | done (completed_at stamped on
// completion). Completing a task auto-logs a line to that company's timeline.
// Deleting a company removes its tasks (cascade in routes/crm-companies.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_tasks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    title TEXT NOT NULL,
    assignee_id TEXT,
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'open',
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_crm_tasks_company ON crm_tasks(company_id);
  CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant_status ON crm_tasks(tenant, status, due_date);
`);

// ── 27. crm_deals — sales deals / forecast per CRM company (Phase 6) ──────────
// A deal belongs to a company. Per the agreed model every deal can carry BOTH
// a one-off value and a recurring monthly value. profit is entered manually
// (no fixed margin formula yet). likelihood is 0–100 (%). status open|won|lost;
// closed_at stamped when it leaves 'open'. owner_id: admin_users.id |
// '__super__' | NULL. Forecast tiles weight ONLY open deals by likelihood.
// `tenant` denormalised for box scoping. Deleting a company removes its deals.
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_deals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    title TEXT NOT NULL,
    one_off_value REAL NOT NULL DEFAULT 0,
    monthly_value REAL NOT NULL DEFAULT 0,
    profit REAL NOT NULL DEFAULT 0,
    likelihood INTEGER NOT NULL DEFAULT 0,
    expected_close TEXT,
    owner_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    closed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_crm_deals_company ON crm_deals(company_id);
  CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_status ON crm_deals(tenant, status);
`);

// ── 28. crm_orders + crm_order_lines — order workflow (Phase 7) ───────────────
// An order belongs to a company and is made of line items (qty × unit_price).
// `value` is the recomputed sum of its lines; `profit` is entered manually.
// order_no is a per-tenant sequential number for display ("Order #3").
//
// Lifecycle (status):
//   draft → awaiting_approval → approved → purchasing → completed
//                    └────────→ rejected (back to draft for changes)
// Approve/reject are ADMIN-ONLY (super-admin). "Send to purchasing" sits with
// the order owner (crm_orders). Purchasing updates/complete need crm_purchasing.
// Each step auto-logs to the company timeline. `tenant` denormalised for box
// scoping; deleting a company removes its orders + lines.
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_orders (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    order_no INTEGER,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    value REAL NOT NULL DEFAULT 0,
    profit REAL NOT NULL DEFAULT 0,
    notes TEXT,
    approver TEXT,
    approved_at TEXT,
    decision_comment TEXT,
    purchasing_status TEXT,
    purchasing_notes TEXT,
    sent_to_purchasing_at TEXT,
    completed_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_crm_orders_company ON crm_orders(company_id);
  CREATE INDEX IF NOT EXISTS idx_crm_orders_tenant_status ON crm_orders(tenant, status);

  CREATE TABLE IF NOT EXISTS crm_order_lines (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    tenant TEXT NOT NULL,
    description TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_crm_order_lines_order ON crm_order_lines(order_id);
`);

// ── 29. Domain removal — archive flag + re-import tombstone (Phase: delete domain) ─
// email_clients.archived_at: NULL = active; set = archived (hidden from the
// Customers list, mailboxes disconnected, all records KEPT, reversible).
// email_client_removals: names that must NOT be auto-recreated by the
// frontend's AWS verified-domain sync (which POSTs /api/email/clients per
// verified domain). A "delete everything" drops a tombstone here; a manual
// re-add (force) clears it. Belt-and-braces — the operator also removes the
// SES identity in AWS, after which the domain stops appearing in the sync.
try { db.exec(`ALTER TABLE email_clients ADD COLUMN archived_at TEXT`); } catch (e) { /* already added */ }
db.exec(`
  CREATE TABLE IF NOT EXISTS email_client_removals (
    name TEXT PRIMARY KEY,
    removed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
