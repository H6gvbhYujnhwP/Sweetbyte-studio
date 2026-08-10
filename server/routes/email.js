import express from 'express';
import { v4 as uuid } from 'uuid';
import https from 'https';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendCampaign, sendEmail, getQuota, getVerifiedDomains } from '../services/ses.js';
import { getLinkUrl, TRANSPARENT_GIF } from '../services/tracking.js';
import { getTouchCountsBulk, shouldTrackRecipient } from '../services/touch-count.js';
import { encrypt, selfTest as cryptoSelfTest } from '../services/crypto-vault.js';
import { testImapCredentials, pollSingleInbox } from '../services/imap-poller.js';
import { parseFirstName, parseAndCacheList, templateUsesFirstName, renderTemplate } from '../services/name-parser.js';
import { classifyPendingOnce, classifyOneReply } from '../services/classify-replies.js';
import { isFormspreeLeadRow } from '../services/formspree-flagger.js';
import { resolveLinkedSet, resolveCrmCustomerId, buildSubscriptionsPanel, applySubscriptionsUpdate } from './hot-prospects.js';
import dns from 'dns';
import { promisify } from 'util';

const router  = express.Router();
const resolve = promisify(dns.resolveTxt);

// Run the fast rule parser over any subscribers on this list whose first_name
// has never been touched (source IS NULL). This avoids the "0 will receive the
// campaign" surprise when subscribers were added before name-parsing existed,
// or via paths that didn't auto-parse. Idempotent — only updates rows that
// currently have NULL source. AI fallback is NOT run here; users explicitly
// trigger that via the Preview UI's "Parse N names" button.
function ensureRuleParsed(listId) {
  const unparsed = db.prepare(
    "SELECT id, name FROM email_subscribers WHERE list_id = ? AND first_name_source IS NULL"
  ).all(listId);
  if (unparsed.length === 0) return { parsed: 0 };
  const update = db.prepare(
    "UPDATE email_subscribers SET first_name = ?, first_name_source = ?, first_name_reason = ? WHERE id = ?"
  );
  let parsed = 0;
  for (const sub of unparsed) {
    const r = parseFirstName(sub.name);
    if (r.source === 'rule') {
      update.run(r.firstName, 'rule', r.reason, sub.id);
      parsed++;
    } else if (r.source === 'skip') {
      update.run(null, 'skip', r.reason, sub.id);
      parsed++;
    }
    // 'needs_ai' rows stay NULL; user runs Preview → Parse N names to resolve them
  }
  if (parsed > 0) console.log(`[email] auto-parsed ${parsed} subscriber name(s) on list ${listId}`);
  return { parsed };
}
const resolveMx = promisify(dns.resolveMx);

// ── Public routes (no auth) ───────────────────────────────────────────────────
// These are hit by recipients' email clients and by AWS SNS — never by the
// logged-in user — so they bypass requireAuth.
const PUBLIC_PREFIXES = ['/unsubscribe', '/track/', '/sns'];

router.use((req, res, next) => {
  if (PUBLIC_PREFIXES.some(p => req.path.startsWith(p))) return next();
  requireAuth(req, res, next);
});

// ═════════════════════════════════════════════════════════════════════════════
// TRACKING ENDPOINTS (public — recipient's email client hits these)
// ═════════════════════════════════════════════════════════════════════════════

// ── Open tracking pixel ──────────────────────────────────────────────────────
// URL: /api/email/track/open/:campaignId/:subscriberId.gif
// The .gif extension is cosmetic — helps some spam filters trust it more.
router.get('/track/open/:campaignId/:subscriberId.gif', (req, res) => {
  trackOpen(req.params.campaignId, req.params.subscriberId);
  // Always return the GIF — never let DB problems break image rendering
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', TRANSPARENT_GIF.length);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.end(TRANSPARENT_GIF);
});

// Fallback without .gif extension (in case some client strips it)
router.get('/track/open/:campaignId/:subscriberId', (req, res) => {
  trackOpen(req.params.campaignId, req.params.subscriberId);
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', TRANSPARENT_GIF.length);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(TRANSPARENT_GIF);
});

function trackOpen(campaignId, subscriberId) {
  try {
    // Find the email_sends row for this (campaign, subscriber)
    const send = db.prepare(`SELECT id, opened_at, open_count FROM email_sends
                             WHERE campaign_id=? AND subscriber_id=?`).get(campaignId, subscriberId);
    if (!send) return; // unknown — could be a stale link or a forwarded email

    if (!send.opened_at) {
      // First open — bump campaign open_count
      db.prepare(`UPDATE email_sends SET status='opened', opened_at=datetime('now'), open_count=open_count+1
                  WHERE id=?`).run(send.id);
      db.prepare(`UPDATE email_campaigns SET open_count=open_count+1 WHERE id=?`).run(campaignId);
    } else {
      // Repeat open — count it on the send row only (campaign open_count is unique opens)
      db.prepare(`UPDATE email_sends SET open_count=open_count+1 WHERE id=?`).run(send.id);
    }
  } catch (err) {
    console.error('[track/open] error:', err.message);
  }
}

// ── Click tracking ───────────────────────────────────────────────────────────
// URL: /api/email/track/click/:campaignId/:subscriberId/:hash
// Records click, then 302-redirects to the original URL.
router.get('/track/click/:campaignId/:subscriberId/:hash', (req, res) => {
  const { campaignId, subscriberId, hash } = req.params;
  const url = getLinkUrl(campaignId, hash);
  if (!url) return res.status(404).send('Link not found');

  try {
    // Record the click — capture source IP + browser-agent so scanner pre-fetches
    // can be told apart from real human clicks (#101b). X-Forwarded-For first
    // (Render sits behind a proxy), falling back to the socket address. Works
    // regardless of trust-proxy config.
    const ipAddress = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
      .toString().split(',')[0].trim() || null;
    const userAgent = req.get('user-agent') || null;
    db.prepare(`INSERT INTO email_link_clicks (id, campaign_id, subscriber_id, url, clicked_at, ip_address, user_agent)
                VALUES (?, ?, ?, ?, datetime('now'), ?, ?)`).run(uuid(), campaignId, subscriberId, url, ipAddress, userAgent);

    // Update the send row — first click marks it; subsequent clicks bump count
    const send = db.prepare(`SELECT id, clicked_at FROM email_sends
                             WHERE campaign_id=? AND subscriber_id=?`).get(campaignId, subscriberId);
    if (send) {
      if (!send.clicked_at) {
        db.prepare(`UPDATE email_sends SET status='clicked', clicked_at=datetime('now'), click_count=click_count+1
                    WHERE id=?`).run(send.id);
        db.prepare(`UPDATE email_campaigns SET click_count=click_count+1 WHERE id=?`).run(campaignId);
      } else {
        db.prepare(`UPDATE email_sends SET click_count=click_count+1 WHERE id=?`).run(send.id);
      }
    }
  } catch (err) {
    console.error('[track/click] error:', err.message);
    // Still redirect even if DB write fails — recipient experience matters most
  }

  res.redirect(302, url);
});

// ── SNS webhooks for bounces + complaints (split, to mirror Sendy) ───────────
// We share the same SNS topics as Sendy:
//   - bounces topic   → POSTs to /api/email/sns/bounces
//   - complaints topic → POSTs to /api/email/sns/complaints
// Both apps subscribe to both topics; SNS fans out to all subscribers.
//
// Each endpoint handles three message Types from SNS:
//   - SubscriptionConfirmation: GET the SubscribeURL to confirm (one-time)
//   - Notification: parse Message field for the actual SES event
//   - UnsubscribeConfirmation: ignored (logged only)
//
// We accept text/plain bodies because AWS SNS sends Content-Type: text/plain.
// express.json() at the app level only parses application/json, so we re-parse here.

const snsTextParser = express.text({ type: '*/*', limit: '500kb' });

function parseSnsBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return null;
  }
}

function logSnsEvent(body, rawBody, source) {
  try {
    db.prepare(`INSERT INTO email_sns_events (id, type, payload) VALUES (?, ?, ?)`)
      .run(uuid(), `${source}:${body?.Type || 'unknown'}`, typeof rawBody === 'string' ? rawBody : JSON.stringify(body));
  } catch {}
}

function handleSubscriptionConfirmation(body, source) {
  try {
    const u = new URL(body.SubscribeURL);
    if (!u.hostname.endsWith('amazonaws.com')) {
      console.warn(`[sns:${source}] refusing to confirm non-AWS SubscribeURL:`, u.hostname);
      return false;
    }
    https.get(body.SubscribeURL, () => {
      console.log(`[sns:${source}] subscription confirmed for topic:`, body.TopicArn);
    }).on('error', err => console.error(`[sns:${source}] confirm error:`, err.message));
    return true;
  } catch (err) {
    console.error(`[sns:${source}] bad SubscribeURL:`, err.message);
    return false;
  }
}

// Bounces endpoint — subscribes to the existing 'bounces' SNS topic
router.post('/sns/bounces', snsTextParser, (req, res) => {
  const body = parseSnsBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid JSON' });
  logSnsEvent(body, req.body, 'bounces');

  if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
    handleSubscriptionConfirmation(body, 'bounces');
    return res.json({ ok: true });
  }

  if (body.Type === 'Notification' && body.Message) {
    let msg;
    try { msg = JSON.parse(body.Message); }
    catch { return res.json({ ok: true }); }
    if (msg.notificationType === 'Bounce') {
      handleBounce(msg, msg?.mail?.messageId);
    }
    return res.json({ ok: true });
  }

  res.json({ ok: true });
});

// Complaints endpoint — subscribes to the existing 'complaints' SNS topic
router.post('/sns/complaints', snsTextParser, (req, res) => {
  const body = parseSnsBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid JSON' });
  logSnsEvent(body, req.body, 'complaints');

  if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
    handleSubscriptionConfirmation(body, 'complaints');
    return res.json({ ok: true });
  }

  if (body.Type === 'Notification' && body.Message) {
    let msg;
    try { msg = JSON.parse(body.Message); }
    catch { return res.json({ ok: true }); }
    if (msg.notificationType === 'Complaint') {
      handleComplaint(msg, msg?.mail?.messageId);
    }
    return res.json({ ok: true });
  }

  res.json({ ok: true });
});

function handleBounce(msg, messageId) {
  const isPermanent = msg.bounce?.bounceType === 'Permanent';
  const recipients  = msg.bounce?.bouncedRecipients || [];

  for (const r of recipients) {
    const email = (r.emailAddress || '').toLowerCase().trim();
    if (!email) continue;

    // Look up the send row by messageId first (most reliable)
    let send = messageId ? db.prepare(`SELECT * FROM email_sends WHERE message_id=?`).get(messageId) : null;

    // Fallback — find by email + campaign via the most recent send
    if (!send) {
      const sub = db.prepare(`SELECT id FROM email_subscribers WHERE email=? ORDER BY created_at DESC LIMIT 1`).get(email);
      if (sub) {
        send = db.prepare(`SELECT * FROM email_sends WHERE subscriber_id=? ORDER BY sent_at DESC LIMIT 1`).get(sub.id);
      }
    }

    if (send) {
      db.prepare(`UPDATE email_sends SET status='bounced', bounced_at=datetime('now') WHERE id=?`).run(send.id);
      db.prepare(`UPDATE email_campaigns SET bounce_count=bounce_count+1 WHERE id=?`).run(send.campaign_id);

      // Permanent bounces — mark subscriber so we never email them again
      if (isPermanent) {
        db.prepare(`UPDATE email_subscribers SET status='bounced', bounced_at=datetime('now') WHERE id=?`)
          .run(send.subscriber_id);
        // Refresh subscriber count on the list
        const sub = db.prepare(`SELECT list_id FROM email_subscribers WHERE id=?`).get(send.subscriber_id);
        if (sub) {
          db.prepare(`UPDATE email_lists SET subscriber_count=(SELECT COUNT(*) FROM email_subscribers WHERE list_id=? AND status='subscribed') WHERE id=?`)
            .run(sub.list_id, sub.list_id);
        }
      }
    }
  }
}

function handleComplaint(msg, messageId) {
  const recipients = msg.complaint?.complainedRecipients || [];

  for (const r of recipients) {
    const email = (r.emailAddress || '').toLowerCase().trim();
    if (!email) continue;

    let send = messageId ? db.prepare(`SELECT * FROM email_sends WHERE message_id=?`).get(messageId) : null;

    if (!send) {
      const sub = db.prepare(`SELECT id FROM email_subscribers WHERE email=? ORDER BY created_at DESC LIMIT 1`).get(email);
      if (sub) {
        send = db.prepare(`SELECT * FROM email_sends WHERE subscriber_id=? ORDER BY sent_at DESC LIMIT 1`).get(sub.id);
      }
    }

    if (send) {
      db.prepare(`UPDATE email_campaigns SET spam_count=spam_count+1 WHERE id=?`).run(send.campaign_id);
      // Mark subscriber as spam — Sendy does the same, never email them again
      db.prepare(`UPDATE email_subscribers SET status='spam', spam_at=datetime('now') WHERE id=?`)
        .run(send.subscriber_id);
      const sub = db.prepare(`SELECT list_id FROM email_subscribers WHERE id=?`).get(send.subscriber_id);
      if (sub) {
        db.prepare(`UPDATE email_lists SET subscriber_count=(SELECT COUNT(*) FROM email_subscribers WHERE list_id=? AND status='subscribed') WHERE id=?`)
          .run(sub.list_id, sub.list_id);
      }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS (auth required — for debugging only)
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/email/diag — runs four checks and returns JSON:
//   1. Env vars: present? expected length? whitespace?
//   2. Server time: if Render's clock is skewed >5min from real time, AWS rejects
//   3. SDK signing path: GetSendQuota via the AWS SDK (different signer than ours)
//   4. Raw signing path: GetSendQuota via OUR raw Signature V4 code
//
// If 3 passes but 4 fails, the bug is in our raw signer — not credentials.
// If both 3 and 4 pass, sending should work; signature errors are intermittent.
// If 3 fails too, the credentials are bad.
router.get('/diag', async (req, res) => {
  const out = {
    timestamp: new Date().toISOString(),
    env: {},
    server_time: {},
    sdk_check: {},
    raw_check: {},
  };

  // ── 1. Env vars ──
  const ak = process.env.AWS_ACCESS_KEY_ID || '';
  const sk = process.env.AWS_SECRET_ACCESS_KEY || '';
  out.env = {
    AWS_ACCESS_KEY_ID:     ak ? `SET (${ak.length} chars, starts "${ak.slice(0,4)}", ends "${ak.slice(-2)}")` : 'MISSING',
    AWS_ACCESS_KEY_ID_ok:  ak.length === 20 && /^[A-Z0-9]+$/.test(ak) && ak === ak.trim(),
    AWS_SECRET_ACCESS_KEY: sk ? `SET (${sk.length} chars, ends "${sk.slice(-2)}")` : 'MISSING',
    AWS_SECRET_ACCESS_KEY_ok: sk.length === 40 && sk === sk.trim(),
    AWS_SES_REGION:        process.env.AWS_SES_REGION || 'eu-north-1 (default)',
    PUBLIC_URL:            process.env.PUBLIC_URL || 'NOT SET (using request host)',
    SES_CONFIGURATION_SET: process.env.SES_CONFIGURATION_SET || 'NOT SET (no X-SES-CONFIGURATION-SET header will be added — AWS account default applies)',
    has_whitespace_in_ak:  ak !== ak.trim(),
    has_whitespace_in_sk:  sk !== sk.trim(),
  };

  // ── 2. Server time skew ──
  // We can't ping NTP from here without an extra dep, but we can show what we think
  // the time is — you can compare against your watch / a NTP site.
  out.server_time = {
    iso:      new Date().toISOString(),
    epoch_ms: Date.now(),
    note:     'Compare against time.is. If skew >5min, AWS will reject signatures.',
  };

  // ── 3. SDK signing path ──
  // Uses @aws-sdk/client-ses, which has its own (well-tested) Signature V4 implementation.
  // If this works, credentials are valid.
  try {
    const { getQuota } = await import('../services/ses.js');
    const quota = await getQuota();
    out.sdk_check = { ok: true, quota };
  } catch (err) {
    out.sdk_check = { ok: false, error: err.message };
  }

  // ── 4. Raw signing path ──
  // Calls GetSendQuota via OUR raw HTTPS + Signature V4 code. Does NOT send any
  // email. If this fails but #3 passes, the bug is in our signer.
  try {
    const result = await rawSesGetSendQuota();
    out.raw_check = { ok: true, response_snippet: result.slice(0, 200) };
  } catch (err) {
    out.raw_check = { ok: false, error: err.message };
  }

  res.json(out);
});

// GET /api/email/diag/raw-mime — returns the raw MIME we'd send for a test email.
// Does NOT send anything. Used to verify what headers actually reach the
// buildRawEmail output (specifically the X-SES-CONFIGURATION-SET header).
router.get('/diag/raw-mime', async (req, res) => {
  const fromEmail = req.query.from || 'test@example.com';
  const toEmail   = req.query.to   || 'recipient@example.com';

  const headers = [
    `From: Test Sender <${fromEmail}>`,
    `To: ${toEmail}`,
    `Reply-To: ${fromEmail}`,
    `Subject: =?UTF-8?B?${Buffer.from('Diag MIME Dump').toString('base64')}?=`,
    `MIME-Version: 1.0`,
  ];
  const configSet = process.env.SES_CONFIGURATION_SET;
  if (configSet) headers.push(`X-SES-CONFIGURATION-SET: ${configSet}`);
  headers.push(`Content-Type: multipart/alternative; boundary="b_diag"`);

  const mime = [
    ...headers, '',
    '--b_diag',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable', '',
    'This is the diag MIME dump.', '',
    '--b_diag--',
  ].join('\r\n');

  res.json({
    SES_CONFIGURATION_SET_env: configSet || 'NOT SET',
    config_set_header_in_mime: mime.includes('X-SES-CONFIGURATION-SET'),
    raw_mime_preview: mime,
    explanation: configSet
      ? "If 'config_set_header_in_mime' is true, the header IS being added. If you still see awstrack.me pixels in real sends, the issue is AWS-side — config set name mismatch, or AWS not honoring it for that identity."
      : "SES_CONFIGURATION_SET env var is empty in this Node process. Header won't be added.",
  });
});

// Helper: call SES GetSendQuota via our raw signer (same code path as SendRawEmail)
async function rawSesGetSendQuota() {
  // We deliberately import the internal sesRequest — but it's not exported.
  // So we replicate the signed call here using the same primitives.
  const https  = await import('https');
  const crypto = await import('crypto');

  const REGION = process.env.AWS_SES_REGION || 'eu-north-1';
  const HOST   = `email.${REGION}.amazonaws.com`;
  const AK     = process.env.AWS_ACCESS_KEY_ID;
  const SK     = process.env.AWS_SECRET_ACCESS_KEY;

  const params = { Action: 'GetSendQuota' };
  const sorted = Object.keys(params).sort().reduce((acc, k) => { acc[k] = params[k]; return acc; }, {});
  const body   = new URLSearchParams(sorted).toString();

  const now      = new Date();
  const amzDate  = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date     = amzDate.slice(0, 8);
  const payHash  = crypto.createHash('sha256').update(body).digest('hex');
  const canonHeaders  = `content-type:application/x-www-form-urlencoded\nhost:${HOST}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonReq      = ['POST', '/', '', canonHeaders, signedHeaders, payHash].join('\n');
  const credScope  = `${date}/${REGION}/email/aws4_request`;
  const strToSign  = ['AWS4-HMAC-SHA256', amzDate, credScope, crypto.createHash('sha256').update(canonReq).digest('hex')].join('\n');

  const hmac = (key, data, enc) => crypto.createHmac('sha256', key).update(data).digest(enc);
  // Keep keys as Buffers between HMAC stages — see ses.js for why.
  const k1 = hmac('AWS4' + SK, date);
  const k2 = hmac(k1, REGION);
  const k3 = hmac(k2, 'email');
  const signingKey = hmac(k3, 'aws4_request');
  const signature  = hmac(signingKey, strToSign, 'hex');

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: HOST, port: 443, path: '/', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'host':         HOST,
        'x-amz-date':   amzDate,
        'Authorization': `AWS4-HMAC-SHA256 Credential=${AK}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    };
    const r = https.request(opts, response => {
      let data = '';
      response.on('data', c => data += c);
      response.on('end', () => {
        if (response.statusCode === 200) resolve(data);
        else reject(new Error(`SES error ${response.statusCode}: ${data}`));
      });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// UNSUBSCRIBE (public — recipient clicks footer link, or Gmail one-click POSTs)
// ═════════════════════════════════════════════════════════════════════════════

// GET = recipient clicked unsubscribe link in email
router.get('/unsubscribe', (req, res) => {
  const { sid, cid } = req.query;
  doUnsub(sid, cid);
  res.send(`<!DOCTYPE html><html><head><title>Unsubscribed</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f3;}
    .box{text-align:center;padding:40px;max-width:400px;}h1{font-size:22px;font-weight:500;color:#1a1a1a;margin-bottom:12px;}
    p{color:#666;font-size:14px;line-height:1.6;}</style></head>
    <body><div class="box"><h1>You've been unsubscribed</h1>
    <p>Your email address has been removed from this mailing list.</p>
    </div></body></html>`);
});

// POST = RFC 8058 one-click unsubscribe (Gmail/Outlook header button)
router.post('/unsubscribe', express.urlencoded({ extended: true }), (req, res) => {
  const sid = req.query.sid || req.body?.sid;
  const cid = req.query.cid || req.body?.cid;
  doUnsub(sid, cid);
  res.json({ ok: true });
});

function doUnsub(sid, cid) {
  if (!sid) return false;
  const sub = db.prepare('SELECT * FROM email_subscribers WHERE id=?').get(sid);
  if (!sub) return false;
  db.prepare("UPDATE email_subscribers SET status='unsubscribed', unsubscribed_at=datetime('now') WHERE id=?").run(sid);
  db.prepare("UPDATE email_lists SET subscriber_count=(SELECT COUNT(*) FROM email_subscribers WHERE list_id=? AND status='subscribed') WHERE id=?")
    .run(sub.list_id, sub.list_id);
  if (cid) db.prepare('UPDATE email_campaigns SET unsubscribe_count=unsubscribe_count+1 WHERE id=?').run(cid);
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// ALL ROUTES BELOW REQUIRE AUTH
// ═════════════════════════════════════════════════════════════════════════════

// ── STATS ─────────────────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const lists       = db.prepare('SELECT COUNT(*) as c FROM email_lists').get().c;
    const subscribers = db.prepare("SELECT COUNT(*) as c FROM email_subscribers WHERE status='subscribed'").get().c;
    const campaigns   = db.prepare('SELECT COUNT(*) as c FROM email_campaigns').get().c;
    const sent        = db.prepare("SELECT COALESCE(SUM(sent_count),0) as c FROM email_campaigns WHERE status='sent'").get().c;
    let quota = null;
    try { quota = await getQuota(); } catch(e) {}
    res.json({ lists, subscribers, campaigns, sent, quota });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── EMAIL CLIENTS (completely separate from LinkedIn clients) ──────────────────

router.get('/clients', (req, res) => {
  // Customers list is "real email customers" only — anything pulled from AWS
  // verified domains, or manually added by the operator. Portal anchor rows
  // (created when a LinkedIn-only customer like Cube6 gets a portal) live in
  // the same table but should NOT show up here. The `source` column was added
  // and backfilled in db.js; see the migration block there for full rationale.
  //
  // Archived domains (archived_at set) are hidden by default; pass ?archived=1
  // to list ONLY the archived ones (for the "Show archived" toggle).
  const wantArchived = req.query.archived === '1';
  const archiveClause = wantArchived ? 'ec.archived_at IS NOT NULL' : 'ec.archived_at IS NULL';
  const rows = db.prepare(`
    SELECT ec.*,
      (SELECT COUNT(*) FROM email_lists WHERE email_client_id=ec.id) as list_count,
      (SELECT COALESCE(SUM(s.cnt),0) FROM (SELECT COUNT(*) as cnt FROM email_subscribers es JOIN email_lists el ON es.list_id=el.id WHERE el.email_client_id=ec.id AND es.status='subscribed') s) as subscriber_count,
      (SELECT COUNT(*) FROM email_campaigns WHERE email_client_id=ec.id) as campaign_count
    FROM email_clients ec
    WHERE (ec.source IS NULL OR ec.source IN ('aws_domain', 'manual')) AND ${archiveClause}
    ORDER BY ec.name ASC
  `).all();
  res.json(rows);
});

router.post('/clients', async (req, res) => {
  const { name, color, force } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const trimmedName = name.trim();
  const lower = trimmedName.toLowerCase();

  // Don't let the frontend's AWS verified-domain auto-sync recreate a domain
  // we deliberately removed. A manual re-add (force:true) clears the tombstone.
  const tomb = db.prepare('SELECT name FROM email_client_removals WHERE LOWER(name)=?').get(lower);
  if (tomb) {
    if (force) db.prepare('DELETE FROM email_client_removals WHERE LOWER(name)=?').run(lower);
    else return res.json({ skipped: true, reason: 'removed' });
  }
  // Never duplicate an existing row (active OR archived) — the auto-sync can't
  // see archived rows via GET, so it would otherwise re-POST them. Return the
  // existing row without un-archiving it.
  const existing = db.prepare('SELECT * FROM email_clients WHERE LOWER(name)=?').get(lower);
  if (existing) return res.json(existing);

  const id = uuid();
  // Auto-generate a URL-safe slug for the customer portal at /c/<slug>.
  // The helper (db._portalUniqueSlug) lives in db.js so the same algorithm
  // is used for backfill of existing rows AND for new inserts here.
  const slug = db._portalUniqueSlug
    ? db._portalUniqueSlug(name.trim(), id)
    : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  // Classify the new row's source. The auto-sync in EmailSection.jsx (loadAll)
  // calls this endpoint with names that match AWS verified domains; the
  // operator-driven "+ New client" UI calls it with arbitrary names. Both
  // paths land here, so we look at the actual AWS list to decide.
  // Failure to reach AWS falls through to 'manual' — safer than silently
  // hiding a row from the very list the operator was trying to add it to.
  let source = 'manual';
  try {
    const trimmed = name.trim().toLowerCase();
    const verified = await getVerifiedDomains();
    if (Array.isArray(verified) && verified.some(d => String(d).toLowerCase() === trimmed)) {
      source = 'aws_domain';
    }
  } catch (err) {
    console.warn(`[email/clients POST] verified-domains lookup failed, defaulting source='manual': ${err.message}`);
  }

  db.prepare('INSERT INTO email_clients (id,name,color,slug,source) VALUES (?,?,?,?,?)')
    .run(id, name.trim(), color || '#1D9E75', slug, source);
  res.json(db.prepare('SELECT * FROM email_clients WHERE id=?').get(id));
});

router.put('/clients/:id', (req, res) => {
  const { name, color, test_email, default_from_email, default_from_name } = req.body;
  const c = db.prepare('SELECT * FROM email_clients WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE email_clients SET name=?,color=?,test_email=?,default_from_email=?,default_from_name=? WHERE id=?')
    .run(
      name ?? c.name, color ?? c.color, test_email ?? c.test_email,
      default_from_email ?? c.default_from_email,
      default_from_name  ?? c.default_from_name,
      req.params.id
    );
  res.json(db.prepare('SELECT * FROM email_clients WHERE id=?').get(req.params.id));
});

// DELETE /api/email/clients/:id — DELETE EVERYTHING. Permanently purges every
// record tied to this domain across all tables, then tombstones the name so
// the AWS auto-sync can't recreate it. AWS/SES is NOT touched (operator removes
// the identity manually). Irreversible — the UI puts a typed-confirm in front.
router.delete('/clients/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM email_clients WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const id = req.params.id;
  // Full purge of one customer's entire tree. FK enforcement is disabled for
  // the duration so delete ORDER doesn't matter (we're removing the whole
  // graph anyway, and some child tables reference email_subscribers/_sends).
  // PRAGMA foreign_keys must be toggled OUTSIDE a transaction to take effect.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM email_subscribers WHERE list_id IN (SELECT id FROM email_lists WHERE email_client_id=?)').run(id);
      db.prepare('DELETE FROM email_sends WHERE campaign_id IN (SELECT id FROM email_campaigns WHERE email_client_id=?)').run(id);
      db.prepare('DELETE FROM client_sessions WHERE client_user_id IN (SELECT id FROM client_users WHERE email_client_id=?)').run(id);
      for (const t of [
        'email_lists', 'email_campaigns', 'email_campaign_steps', 'email_outbound', 'email_brands',
        'email_replies', 'email_inboxes', 'hot_prospects', 'campaign_unsubscribes', 'contact_unsubscribed_all',
        'customer_services', 'facebook_pixels', 'facebook_ads', 'facebook_ad_creatives', 'client_post_regens',
        'password_resets', 'client_login_attempts', 'client_users',
      ]) {
        try { db.prepare(`DELETE FROM ${t} WHERE email_client_id=?`).run(id); } catch (e) { /* table may not exist on older DBs */ }
      }
      db.prepare('DELETE FROM email_clients WHERE id=?').run(id);
      db.prepare('INSERT OR REPLACE INTO email_client_removals (name) VALUES (?)').run(c.name);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  res.json({ ok: true, purged: true });
});

// POST /api/email/clients/:id/archive — keep all records, disconnect mailboxes,
// hide from the active Customers list. Reversible via /restore.
router.post('/clients/:id/archive', (req, res) => {
  const c = db.prepare('SELECT * FROM email_clients WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    db.prepare("UPDATE email_clients SET archived_at=datetime('now') WHERE id=?").run(req.params.id);
    db.prepare('UPDATE email_inboxes SET enabled=0 WHERE email_client_id=?').run(req.params.id);
    db.prepare(`INSERT INTO email_audit_log (id, actor, action, target_type, target_id)
                VALUES (?, 'system', 'archive_domain', 'email_client', ?)`).run(uuid(), req.params.id);
  })();
  res.json({ ok: true, archived: true });
});

// POST /api/email/clients/:id/restore — bring an archived domain back + re-enable its mailboxes.
router.post('/clients/:id/restore', (req, res) => {
  const c = db.prepare('SELECT * FROM email_clients WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    db.prepare('UPDATE email_clients SET archived_at=NULL WHERE id=?').run(req.params.id);
    db.prepare('UPDATE email_inboxes SET enabled=1 WHERE email_client_id=?').run(req.params.id);
    db.prepare('DELETE FROM email_client_removals WHERE LOWER(name)=LOWER(?)').run(c.name);
    db.prepare(`INSERT INTO email_audit_log (id, actor, action, target_type, target_id)
                VALUES (?, 'system', 'restore_domain', 'email_client', ?)`).run(uuid(), req.params.id);
  })();
  res.json({ ok: true, restored: true });
});

// ── BRANDS ────────────────────────────────────────────────────────────────────

router.get('/brands', (req, res) => {
  const { email_client_id } = req.query;
  const rows = email_client_id
    ? db.prepare('SELECT * FROM email_brands WHERE email_client_id=? ORDER BY name ASC').all(email_client_id)
    : db.prepare('SELECT * FROM email_brands ORDER BY name ASC').all();
  res.json(rows);
});

router.post('/brands', (req, res) => {
  const { email_client_id, name, from_name, from_email, reply_to, color } = req.body;
  if (!email_client_id || !name || !from_name || !from_email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const id = uuid();
  db.prepare('INSERT INTO email_brands (id,email_client_id,name,from_name,from_email,reply_to,color) VALUES (?,?,?,?,?,?,?)')
    .run(id, email_client_id, name, from_name, from_email, reply_to || from_email, color || '#1D9E75');
  res.json(db.prepare('SELECT * FROM email_brands WHERE id=?').get(id));
});

router.put('/brands/:id', (req, res) => {
  const { name, from_name, from_email, reply_to, color } = req.body;
  const b = db.prepare('SELECT * FROM email_brands WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE email_brands SET name=?,from_name=?,from_email=?,reply_to=?,color=? WHERE id=?')
    .run(name ?? b.name, from_name ?? b.from_name, from_email ?? b.from_email, reply_to ?? b.reply_to, color ?? b.color, req.params.id);
  res.json(db.prepare('SELECT * FROM email_brands WHERE id=?').get(req.params.id));
});

router.delete('/brands/:id', (req, res) => {
  db.prepare('DELETE FROM email_brands WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── LISTS ─────────────────────────────────────────────────────────────────────

router.get('/lists', (req, res) => {
  const { email_client_id } = req.query;
  const q = `
    SELECT l.*,
      (SELECT COUNT(*) FROM email_subscribers WHERE list_id=l.id AND status='subscribed')   as subscriber_count,
      (SELECT COUNT(*) FROM email_subscribers WHERE list_id=l.id AND status='bounced')      as bounced_count,
      (SELECT COUNT(*) FROM email_subscribers WHERE list_id=l.id AND status='unsubscribed') as unsubscribed_count,
      (SELECT COUNT(*) FROM email_subscribers WHERE list_id=l.id AND status='spam')         as spam_count
    FROM email_lists l
    ${email_client_id ? 'WHERE l.email_client_id=?' : ''}
    ORDER BY l.created_at DESC
  `;
  const rows = email_client_id
    ? db.prepare(q).all(email_client_id)
    : db.prepare(q).all();
  res.json(rows);
});

router.post('/lists', (req, res) => {
  const { email_client_id, name, from_name, from_email, reply_to } = req.body;
  if (!email_client_id || !name || !from_name || !from_email || !reply_to) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const id = uuid();
  db.prepare('INSERT INTO email_lists (id,email_client_id,name,from_name,from_email,reply_to) VALUES (?,?,?,?,?,?)')
    .run(id, email_client_id, name, from_name, from_email, reply_to);
  res.json(db.prepare('SELECT * FROM email_lists WHERE id=?').get(id));
});

router.delete('/lists/:id', (req, res) => {
  db.prepare('DELETE FROM email_subscribers WHERE list_id=?').run(req.params.id);
  db.prepare('DELETE FROM email_lists WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── SUBSCRIBERS ───────────────────────────────────────────────────────────────

router.get('/lists/:id/subscribers', (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare('SELECT * FROM email_subscribers WHERE list_id=? AND status=? ORDER BY created_at DESC').all(req.params.id, status)
    : db.prepare('SELECT * FROM email_subscribers WHERE list_id=? ORDER BY created_at DESC').all(req.params.id);
  res.json(rows);
});

router.post('/lists/:id/subscribers', (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const id = uuid();
  try {
    // Run the rule parser inline so single-add subscribers get a first_name
    // populated immediately, just like CSV-imported ones. AI fallback for the
    // "needs_ai" cases happens on demand via /lists/:id/parse-names.
    const parsed = parseFirstName(name);
    const fnVal    = (parsed.source === 'rule')     ? parsed.firstName : null;
    const fnSource = (parsed.source === 'needs_ai') ? null : parsed.source;
    db.prepare('INSERT INTO email_subscribers (id,list_id,email,name,first_name,first_name_source,first_name_reason) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.params.id, email.toLowerCase().trim(), name || null, fnVal, fnSource, parsed.reason);
    db.prepare("UPDATE email_lists SET subscriber_count=(SELECT COUNT(*) FROM email_subscribers WHERE list_id=? AND status='subscribed') WHERE id=?")
      .run(req.params.id, req.params.id);
    res.json({ ok: true, id });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Already subscribed' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/lists/:id/import', (req, res) => {
  const { csv } = req.body;
  if (!csv) return res.status(400).json({ error: 'No CSV data' });

  const lines = csv.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return res.json({ ok: true, added: 0 });

  // Parse header row to find column positions (handles Sendy and simple formats)
  const headerLine = lines[0].replace(/"/g, '').toLowerCase();
  const headers = headerLine.split(',').map(h => h.trim());
  const emailIdx  = headers.findIndex(h => h === 'email');
  const nameIdx   = headers.findIndex(h => h === 'name');
  const statusIdx = headers.findIndex(h => h === 'status');

  // If no header row found, treat first column as email, second as name
  const hasHeader = emailIdx !== -1;
  const dataRows  = hasHeader ? lines.slice(1) : lines;

  // Map Sendy status values to our internal status values
  function mapStatus(raw) {
    if (!raw) return 'subscribed';
    const s = raw.toLowerCase().trim();
    if (s === 'bounced')      return 'bounced';
    if (s === 'unsubscribed') return 'unsubscribed';
    if (s === 'spam' || s === 'marked as spam') return 'spam';
    if (s === 'unconfirmed')  return 'unsubscribed'; // treat unconfirmed as unsub
    return 'subscribed'; // Active, Subscribed etc
  }

  const insert = db.prepare('INSERT OR IGNORE INTO email_subscribers (id,list_id,email,name,status,first_name,first_name_source,first_name_reason) VALUES (?,?,?,?,?,?,?,?)');
  const insertMany = db.transaction((rows) => {
    let added = 0;
    for (const line of rows) {
      // Handle quoted CSV values properly
      const cols = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g)
        ?.map(v => v.replace(/^"|"$/g, '').trim()) || line.split(',').map(v => v.trim());

      const email  = hasHeader ? cols[emailIdx]  : cols[0];
      const name   = hasHeader ? cols[nameIdx]   : cols[1];
      const status = hasHeader && statusIdx !== -1 ? mapStatus(cols[statusIdx]) : 'subscribed';

      if (!email || !email.includes('@')) continue;
      // Run the fast rule parse on import. AI fallback is deferred — call
      // POST /lists/:id/parse-names to resolve the rule's "needs_ai" cases.
      const parsed = parseFirstName(name);
      const fnVal    = (parsed.source === 'rule')     ? parsed.firstName : null;
      const fnSource = (parsed.source === 'needs_ai') ? null : parsed.source; // null = "not yet decided, awaiting AI"
      insert.run(uuid(), req.params.id, email.toLowerCase(), name || null, status, fnVal, fnSource, parsed.reason);
      added++;
    }
    return added;
  });

  const added = insertMany(dataRows);

  // Update subscriber count (active only)
  db.prepare("UPDATE email_lists SET subscriber_count=(SELECT COUNT(*) FROM email_subscribers WHERE list_id=? AND status='subscribed') WHERE id=?")
    .run(req.params.id, req.params.id);

  res.json({ ok: true, added });
});

router.delete('/lists/:listId/subscribers/:subId', (req, res) => {
  db.prepare("UPDATE email_subscribers SET status='unsubscribed', unsubscribed_at=datetime('now') WHERE id=? AND list_id=?")
    .run(req.params.subId, req.params.listId);
  db.prepare("UPDATE email_lists SET subscriber_count=(SELECT COUNT(*) FROM email_subscribers WHERE list_id=? AND status='subscribed') WHERE id=?")
    .run(req.params.listId, req.params.listId);
  res.json({ ok: true });
});

// ── FIRST-NAME PARSING ────────────────────────────────────────────────────────
// Phase 4 — parse Christian names from each subscriber's stored `name` field
// for use in {{first_name}} email placeholders. Two-stage: fast rule first,
// Claude Haiku fallback for messy cases (caps, joint names, role-only entries).

// POST /api/email/lists/:id/parse-names
// Bulk-parse every subscriber on this list. Idempotent: only touches rows where
// first_name_source IS NULL (i.e. never been parsed). Pass ?force=1 to re-parse
// everything, including manual overrides — use sparingly.
router.post('/lists/:id/parse-names', async (req, res) => {
  const list = db.prepare('SELECT id FROM email_lists WHERE id=?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const result = await parseAndCacheList(req.params.id, { force });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[parse-names] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/email/campaigns/:id/preview-recipients
// Returns the active subscriber list for this campaign with parsed first names,
// the rendered (subject, body) for each, and skip status. Used by the
// arrow-driven preview UI in the campaign edit modal.
//
// Response shape:
//   { campaign, recipients: [{ id, email, name, first_name, first_name_source,
//                              first_name_reason, will_skip, rendered_subject,
//                              rendered_html, rendered_plain }, ...],
//     uses_first_name: true|false,
//     summary: { total, will_send, will_skip, by_source: {rule,ai,manual,skip,unparsed} } }
router.get('/campaigns/:id/preview-recipients', (req, res) => {
  const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  // Auto-resolve any names the rule can handle. This means opening Preview on a
  // brand-new list won't show "all subscribers not yet parsed" — only the genuinely
  // ambiguous ones (joint names, all-caps, etc.) need the explicit "Parse N names" click.
  ensureRuleParsed(campaign.list_id);

  const subs = db.prepare(
    "SELECT id, email, name, first_name, first_name_source, first_name_reason FROM email_subscribers WHERE list_id=? AND status='subscribed' ORDER BY created_at ASC"
  ).all(campaign.list_id);

  const usesFirstName = templateUsesFirstName(campaign.subject, campaign.html_body, campaign.plain_body);

  const summary = {
    total: subs.length, will_send: 0, will_skip: 0,
    by_source: { rule: 0, ai: 0, manual: 0, skip: 0, unparsed: 0 },
  };

  const recipients = subs.map(s => {
    const source = s.first_name_source || 'unparsed';
    summary.by_source[source] = (summary.by_source[source] || 0) + 1;
    // Skip when the template uses {{first_name}} and we have no parsed name.
    // If the template doesn't use it, everyone receives — first_name irrelevant.
    const willSkip = usesFirstName && !s.first_name;
    if (willSkip) summary.will_skip++; else summary.will_send++;

    const fn = s.first_name || '';
    return {
      id:                 s.id,
      email:              s.email,
      name:               s.name,
      first_name:         s.first_name,
      first_name_source:  s.first_name_source,
      first_name_reason:  s.first_name_reason,
      will_skip:          willSkip,
      rendered_subject:   willSkip ? campaign.subject    : renderTemplate(campaign.subject, fn),
      rendered_html:      willSkip ? campaign.html_body  : renderTemplate(campaign.html_body, fn),
      rendered_plain:     willSkip ? campaign.plain_body : renderTemplate(campaign.plain_body, fn),
    };
  });

  res.json({ campaign, recipients, uses_first_name: usesFirstName, summary });
});

// PUT /api/email/subscribers/:id/first-name
// Manual override for a single subscriber. Pass { first_name: "Andy" } to set,
// or { first_name: null } to mark as unparseable (will be skipped).
router.put('/subscribers/:id/first-name', (req, res) => {
  const sub = db.prepare('SELECT id FROM email_subscribers WHERE id=?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
  const fn = req.body?.first_name;
  if (fn === undefined) return res.status(400).json({ error: 'Missing first_name in body (use null to clear)' });
  if (fn === null || fn === '') {
    db.prepare("UPDATE email_subscribers SET first_name=NULL, first_name_source='manual', first_name_reason='Manually cleared' WHERE id=?")
      .run(req.params.id);
  } else {
    if (typeof fn !== 'string' || fn.length > 80) return res.status(400).json({ error: 'Invalid first_name' });
    db.prepare("UPDATE email_subscribers SET first_name=?, first_name_source='manual', first_name_reason='Manually set' WHERE id=?")
      .run(fn.trim(), req.params.id);
  }
  res.json({ ok: true });
});

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────

router.get('/campaigns', (req, res) => {
  const { email_client_id } = req.query;
  const rows = email_client_id
    ? db.prepare(`SELECT ec.*, el.name as list_name FROM email_campaigns ec JOIN email_lists el ON ec.list_id=el.id WHERE ec.email_client_id=? ORDER BY ec.created_at DESC`).all(email_client_id)
    : db.prepare(`SELECT ec.*, el.name as list_name FROM email_campaigns ec JOIN email_lists el ON ec.list_id=el.id ORDER BY ec.created_at DESC`).all();
  res.json(rows);
});

router.post('/campaigns', (req, res) => {
  const {
    email_client_id, list_id, title, subject, from_name, from_email, reply_to,
    html_body, plain_body, scheduled_at,
    // Tracking — all optional; defaults are the column-level defaults (off / 3 / 6 / 0).
    tracking_mode, tracking_threshold, tracking_window,
    track_opens, track_clicks, track_unsub,
    // Drip schedule — all optional. If daily_limit > 0 the campaign starts as 'scheduled'
    // and the drip ticker takes it from there. If daily_limit is 0 / unset the campaign
    // is a 'draft' and behaves like a normal one-shot send.
    daily_limit, drip_start_at, send_order,
    drip_send_days, drip_window_start, drip_window_end, drip_timezone,
  } = req.body;
  if (!email_client_id || !list_id || !title || !subject || !from_name || !from_email || !html_body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const id = uuid();

  // Determine starting status. Drip with daily_limit > 0 → scheduled (so the ticker
  // picks it up). Otherwise scheduled_at fallback → scheduled. Otherwise draft.
  const isDrip = Number.isInteger(daily_limit) && daily_limit > 0;
  const startStatus = isDrip ? 'scheduled' : (scheduled_at ? 'scheduled' : 'draft');
  // For a drip, drip_start_at is the controlling timestamp. If absent default to now.
  const effectiveStartAt = isDrip ? (drip_start_at || new Date().toISOString()) : (scheduled_at || null);

  db.prepare(`INSERT INTO email_campaigns
    (id, email_client_id, list_id, title, subject, from_name, from_email, reply_to,
     html_body, plain_body, status, scheduled_at,
     tracking_mode, tracking_threshold, tracking_window,
     track_opens, track_clicks, track_unsub,
     daily_limit, drip_start_at, send_order,
     drip_send_days, drip_window_start, drip_window_end, drip_timezone)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, email_client_id, list_id, title, subject, from_name, from_email, reply_to || from_email,
      html_body, plain_body || null, startStatus, scheduled_at || null,
      tracking_mode || 'off',
      Number.isInteger(tracking_threshold) ? tracking_threshold : 3,
      Number.isInteger(tracking_window) ? tracking_window : 6,
      track_opens ? 1 : 0, track_clicks ? 1 : 0, track_unsub ? 1 : 0,
      isDrip ? daily_limit : 0,
      effectiveStartAt,
      (send_order === 'random' ? 'random' : 'top'),
      drip_send_days     || '1,2,3,4,5',
      drip_window_start  || '09:00',
      drip_window_end    || '11:00',
      drip_timezone      || 'Europe/London',
    );
  res.json(db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(id));
});

router.put('/campaigns/:id', (req, res) => {
  const {
    title, subject, from_name, from_email, reply_to, html_body, plain_body, scheduled_at, list_id,
    tracking_mode, tracking_threshold, tracking_window,
    track_opens, track_clicks, track_unsub,
    // Drip schedule fields. All optional — only the ones given are updated.
    daily_limit, drip_start_at, send_order,
    drip_send_days, drip_window_start, drip_window_end, drip_timezone,
  } = req.body;
  const current = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Not found' });
  if (current.status === 'sent') return res.status(400).json({ error: 'Cannot edit a sent campaign' });

  // Decide status. If daily_limit transitions to >0 we want 'scheduled'.
  // Otherwise leave whatever was there unless scheduled_at is being toggled.
  const newDailyLimit = Number.isInteger(daily_limit) ? daily_limit : current.daily_limit;
  const willDrip = newDailyLimit > 0;
  let status = current.status;
  if (willDrip && status === 'draft') status = 'scheduled';
  if (!willDrip && status === 'scheduled' && !scheduled_at) status = 'draft';
  if (scheduled_at && !willDrip) status = 'scheduled';
  if (!scheduled_at && req.body.scheduled_at === null) status = 'draft';

  db.prepare(`UPDATE email_campaigns SET
    title=?, subject=?, from_name=?, from_email=?, reply_to=?,
    html_body=?, plain_body=?, scheduled_at=?, status=?,
    list_id=COALESCE(?, list_id),
    tracking_mode=COALESCE(?, tracking_mode),
    tracking_threshold=COALESCE(?, tracking_threshold),
    tracking_window=COALESCE(?, tracking_window),
    track_opens=COALESCE(?, track_opens),
    track_clicks=COALESCE(?, track_clicks),
    track_unsub=COALESCE(?, track_unsub),
    daily_limit=COALESCE(?, daily_limit),
    drip_start_at=COALESCE(?, drip_start_at),
    send_order=COALESCE(?, send_order),
    drip_send_days=COALESCE(?, drip_send_days),
    drip_window_start=COALESCE(?, drip_window_start),
    drip_window_end=COALESCE(?, drip_window_end),
    drip_timezone=COALESCE(?, drip_timezone)
    WHERE id=?`).run(
      title ?? current.title, subject ?? current.subject,
      from_name ?? current.from_name, from_email ?? current.from_email,
      reply_to ?? current.reply_to, html_body ?? current.html_body,
      plain_body ?? current.plain_body, scheduled_at ?? current.scheduled_at,
      status, list_id ?? null,
      tracking_mode ?? null,
      Number.isInteger(tracking_threshold) ? tracking_threshold : null,
      Number.isInteger(tracking_window) ? tracking_window : null,
      track_opens === undefined ? null : (track_opens ? 1 : 0),
      track_clicks === undefined ? null : (track_clicks ? 1 : 0),
      track_unsub === undefined ? null : (track_unsub ? 1 : 0),
      Number.isInteger(daily_limit) ? daily_limit : null,
      drip_start_at ?? null,
      send_order ?? null,
      drip_send_days ?? null,
      drip_window_start ?? null,
      drip_window_end ?? null,
      drip_timezone ?? null,
      req.params.id,
    );
  res.json(db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id));
});

router.delete('/campaigns/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status === 'sending') return res.status(400).json({ error: 'Cannot delete while sending' });
  db.prepare('DELETE FROM email_sends WHERE campaign_id=?').run(req.params.id);
  db.prepare('DELETE FROM email_campaign_steps WHERE campaign_id=?').run(req.params.id);
  db.prepare('DELETE FROM email_campaigns WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── PHASE 4: MULTI-STEP SEQUENCE ENDPOINTS ───────────────────────────────────
// A campaign can have N steps (1st contact / 2nd contact / 3rd contact...).
// Step 1 is always present and its body lives BOTH in email_campaigns.html_body
//   (kept in sync for backwards-compat with all the existing send/preview code)
//   AND in email_campaign_steps as step_number=1. The migration backfilled
//   step 1 from html_body for every existing campaign.
// Steps 2+ live only in email_campaign_steps.
// delay_days = days to wait after the previous step's send before firing this step.
//   Step 1 has delay_days=0. Step 2 typically 3, etc.

// GET /api/email/campaigns/:id/steps
// Returns the ordered step list. Always includes step 1.
// Per-step `subject` is returned alongside `html_body` and `delay_days`.
// A NULL subject means "fall back to campaign-level subject at send time".
router.get('/campaigns/:id/steps', (req, res) => {
  const campaign = db.prepare('SELECT id, html_body, subject FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  let steps = db.prepare(`
    SELECT id, step_number, subject, html_body, delay_days, created_at
    FROM email_campaign_steps
    WHERE campaign_id=?
    ORDER BY step_number ASC
  `).all(req.params.id);
  // Defensive: if a campaign somehow has no step 1 row (e.g. created right between
  // table creation and the backfill), synthesise one from html_body so the UI
  // never sees an empty list. This should never happen in practice.
  if (steps.length === 0 || steps[0].step_number !== 1) {
    const synthId = `step_${campaign.id}_1_synth`;
    db.prepare(`INSERT INTO email_campaign_steps (id, campaign_id, step_number, subject, html_body, delay_days)
                VALUES (?,?,1,?,?,0)`).run(synthId, campaign.id, campaign.subject || null, campaign.html_body || '');
    steps = db.prepare(`
      SELECT id, step_number, subject, html_body, delay_days, created_at
      FROM email_campaign_steps
      WHERE campaign_id=?
      ORDER BY step_number ASC
    `).all(req.params.id);
  }
  // Per-step send counts so the UI can show the edit-warning toast for in-flight steps.
  const sendCounts = db.prepare(`
    SELECT step_number, COUNT(*) as sent_count
    FROM email_sends
    WHERE campaign_id=? AND status IN ('sent','opened','clicked','bounced')
    GROUP BY step_number
  `).all(req.params.id);
  const sentByStep = {};
  for (const r of sendCounts) sentByStep[r.step_number] = r.sent_count;
  res.json({
    steps: steps.map(s => ({ ...s, sent_count: sentByStep[s.step_number] || 0 })),
  });
});

// PUT /api/email/campaigns/:id/steps
// Replace the entire step list. Body: { steps: [{ step_number, subject, html_body, delay_days }, ...] }
//   - Step 1 is always required and must have delay_days=0.
//   - Step numbers must be contiguous starting from 1 (1,2,3,...).
//   - Max 10 steps total.
//   - Step 1's html_body is also written to email_campaigns.html_body so the
//     existing send / preview code paths (which read html_body) keep working
//     unchanged for step-1 sends.
//   - Step 1's subject is similarly mirrored to email_campaigns.subject.
//     Steps 2+ may have a NULL subject — the send pipeline falls back to
//     the campaign subject at send time.
//   - Already-sent rows are NOT touched. Editing a step's body, subject, or
//     delay only affects future sends. The UI surfaces a warning toast.
router.put('/campaigns/:id/steps', (req, res) => {
  const campaign = db.prepare('SELECT id, status FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'sent') return res.status(400).json({ error: 'Cannot edit a sent campaign' });

  const incoming = Array.isArray(req.body?.steps) ? req.body.steps : null;
  if (!incoming || incoming.length === 0) {
    return res.status(400).json({ error: 'steps array is required and must contain at least step 1' });
  }
  if (incoming.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 steps per campaign' });
  }
  // Validate shape: step_numbers must be 1..N contiguous, html_body required, delay_days non-negative integer.
  // Step 1's delay_days must be 0; steps 2+ must have delay_days >= 1.
  // subject is optional on every step (NULL falls back to campaign.subject at send time),
  // but if provided it must be a non-empty string.
  const sorted = [...incoming].sort((a,b) => (a.step_number||0) - (b.step_number||0));
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const expectedNum = i + 1;
    if (s.step_number !== expectedNum) {
      return res.status(400).json({ error: `Step numbers must be contiguous from 1; got ${s.step_number} at position ${i+1}` });
    }
    if (typeof s.html_body !== 'string' || s.html_body.trim().length === 0) {
      return res.status(400).json({ error: `Step ${expectedNum} has an empty body` });
    }
    if (!Number.isInteger(s.delay_days) || s.delay_days < 0) {
      return res.status(400).json({ error: `Step ${expectedNum} has an invalid delay_days` });
    }
    if (expectedNum === 1 && s.delay_days !== 0) {
      return res.status(400).json({ error: 'Step 1 must have delay_days=0' });
    }
    if (expectedNum > 1 && s.delay_days < 1) {
      return res.status(400).json({ error: `Step ${expectedNum} must have delay_days >= 1` });
    }
    if (s.subject !== undefined && s.subject !== null) {
      if (typeof s.subject !== 'string') {
        return res.status(400).json({ error: `Step ${expectedNum} has an invalid subject` });
      }
      if (s.subject.trim().length === 0 && expectedNum === 1) {
        return res.status(400).json({ error: 'Step 1 subject cannot be empty' });
      }
    }
  }

  const tx = db.transaction(() => {
    // Wipe and rewrite. Cleanest semantics — no orphaned step rows possible.
    db.prepare('DELETE FROM email_campaign_steps WHERE campaign_id=?').run(req.params.id);
    const insert = db.prepare(`INSERT INTO email_campaign_steps
      (id, campaign_id, step_number, subject, html_body, delay_days) VALUES (?,?,?,?,?,?)`);
    for (const s of sorted) {
      const stepId = `step_${req.params.id}_${s.step_number}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
      // Treat empty strings as NULL so the fallback-to-campaign-subject logic
      // at send time is unambiguous (only NULL falls back).
      const subj = (typeof s.subject === 'string' && s.subject.trim().length > 0) ? s.subject : null;
      insert.run(stepId, req.params.id, s.step_number, subj, s.html_body, s.delay_days);
    }
    // Mirror step 1's body and subject to email_campaigns so existing code paths
    // (test-send, preview, send) keep reading the right thing.
    const step1 = sorted[0];
    const step1Subj = (typeof step1.subject === 'string' && step1.subject.trim().length > 0) ? step1.subject : null;
    if (step1Subj !== null) {
      db.prepare('UPDATE email_campaigns SET html_body=?, subject=? WHERE id=?')
        .run(step1.html_body, step1Subj, req.params.id);
    } else {
      db.prepare('UPDATE email_campaigns SET html_body=? WHERE id=?')
        .run(step1.html_body, req.params.id);
    }
  });
  tx();

  const out = db.prepare(`
    SELECT id, step_number, subject, html_body, delay_days, created_at
    FROM email_campaign_steps
    WHERE campaign_id=?
    ORDER BY step_number ASC
  `).all(req.params.id);
  res.json({ ok: true, steps: out });
});

// ── TOUCH-COUNT ENDPOINTS (for the smart-tracking UI) ────────────────────────

// GET /api/email/lists/:id/touch-counts?window=6
// Returns per-subscriber touch count for a list, used in the subscriber list UI
// to show the "1st contact / 2nd contact" badge.
router.get('/lists/:id/touch-counts', (req, res) => {
  const window = Number.isInteger(parseInt(req.query.window)) ? parseInt(req.query.window) : 6;
  const subs = db.prepare("SELECT id FROM email_subscribers WHERE list_id=? AND status='subscribed'").all(req.params.id);
  const counts = getTouchCountsBulk(subs.map(s => s.id), window);
  res.json({
    window_months: window,
    counts: Object.fromEntries(counts),
  });
});

// GET /api/email/campaigns/:id/send-preview
// Returns the breakdown for the pre-send dialog: how many recipients fall into
// each touch-count bucket, and how many would be tracked vs. sent clean.
router.get('/campaigns/:id/send-preview', (req, res) => {
  const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  const list = db.prepare('SELECT * FROM email_lists WHERE id=?').get(campaign.list_id);
  if (!list) return res.status(404).json({ error: 'Campaign list missing' });

  // Auto-run the rule parser on any unparsed subs so the user doesn't see a
  // misleading skip count for names that the rule could have handled trivially.
  ensureRuleParsed(campaign.list_id);

  const subs = db.prepare("SELECT id, first_name, first_name_source FROM email_subscribers WHERE list_id=? AND status='subscribed'").all(campaign.list_id);
  const window    = campaign.tracking_window || 6;
  const mode      = campaign.tracking_mode || 'off';
  const threshold = campaign.tracking_threshold || 3;
  const alwaysWarm = !!(list && list.always_warm);

  const counts = getTouchCountsBulk(subs.map(s => s.id), window);

  // First-name personalisation: if the campaign uses {{first_name}}, anyone
  // without a parsed first name will be skipped at send time.
  const usesFirstName = templateUsesFirstName(campaign.subject, campaign.html_body, campaign.plain_body);
  let willSkip = 0;
  let unparsed = 0;
  for (const sub of subs) {
    if (!sub.first_name_source) unparsed++;
    if (usesFirstName && !sub.first_name) willSkip++;
  }

  // Histogram: 1st, 2nd, 3rd, 4+ contact (touchCount + 1 = nth contact for this send)
  const buckets = { '1st': 0, '2nd': 0, '3rd': 0, '4+': 0 };
  let trackedCount = 0;
  for (const sub of subs) {
    const touchCount = counts.get(sub.id) || 0;
    const nth = touchCount + 1;
    if (nth === 1) buckets['1st']++;
    else if (nth === 2) buckets['2nd']++;
    else if (nth === 3) buckets['3rd']++;
    else buckets['4+']++;
    if (shouldTrackRecipient({ mode, threshold, touchCount, alwaysWarm })) trackedCount++;
  }

  res.json({
    total_recipients: subs.length,
    buckets,
    personalisation: {
      uses_first_name: usesFirstName,
      will_skip:       willSkip,        // subs that'll be skipped due to no first_name (only meaningful when uses_first_name)
      unparsed:        unparsed,         // subs whose first_name has never been parsed (rule or AI)
      will_send:       subs.length - willSkip,
    },
    tracking: {
      mode, threshold, window_months: window, always_warm: alwaysWarm,
      track_opens:  !!campaign.track_opens,
      track_clicks: !!campaign.track_clicks,
      track_unsub:  !!campaign.track_unsub,
      will_track:   trackedCount,
      will_send_clean: subs.length - trackedCount,
    },
    schedule: {
      status:            campaign.status,
      scheduled_at:      campaign.scheduled_at,
      daily_limit:       campaign.daily_limit,
      drip_start_at:     campaign.drip_start_at,
      drip_sent:         campaign.drip_sent,
      drip_today_sent:   campaign.drip_today_sent,
      drip_today_date:   campaign.drip_today_date,
      drip_send_days:    campaign.drip_send_days,
      drip_window_start: campaign.drip_window_start,
      drip_window_end:   campaign.drip_window_end,
      drip_timezone:     campaign.drip_timezone,
      send_order:        campaign.send_order,
      is_drip:           !!campaign.daily_limit && campaign.daily_limit > 0,
      is_scheduled:      campaign.status === 'scheduled',
    },
    list_name: list.name,
  });
});

// PUT /api/email/lists/:id/always-warm — toggle the list-level override
router.put('/lists/:id/always-warm', (req, res) => {
  const { always_warm } = req.body;
  const list = db.prepare('SELECT * FROM email_lists WHERE id=?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE email_lists SET always_warm=? WHERE id=?')
    .run(always_warm ? 1 : 0, req.params.id);
  res.json({ ok: true, always_warm: !!always_warm });
});

// ── SEND ──────────────────────────────────────────────────────────────────────

router.post('/campaigns/:id/send', async (req, res) => {
  const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (campaign.status === 'sent') return res.status(400).json({ error: 'Already sent' });
  if (campaign.status === 'sending') return res.status(400).json({ error: 'Currently sending' });

  const list = db.prepare('SELECT * FROM email_lists WHERE id=?').get(campaign.list_id);
  // Belt-and-braces: rule-parse any still-unparsed names. /send-preview already
  // does this when the user opens the send dialog, but if they hit /send via
  // some other path (API, future drip-tick, etc.) we still want it.
  ensureRuleParsed(campaign.list_id);
  const allSubscribers = db.prepare("SELECT * FROM email_subscribers WHERE list_id=? AND status='subscribed'").all(campaign.list_id);
  if (allSubscribers.length === 0) return res.status(400).json({ error: 'No active subscribers in list' });

  // Filter recipients based on first-name personalisation.
  // If the template uses {{first_name}}, anyone without a parsed first_name is
  // skipped to avoid sending "Hi ," or "Hi {{first_name}}," to real prospects.
  // The user has already seen the skip count in the pre-send dialog and chosen
  // to proceed; we log how many got filtered for diagnostics.
  const usesFirstName = templateUsesFirstName(campaign.subject, campaign.html_body, campaign.plain_body);
  const subscribers = usesFirstName
    ? allSubscribers.filter(s => s.first_name)
    : allSubscribers;
  const skippedNoName = allSubscribers.length - subscribers.length;
  if (subscribers.length === 0) {
    db.prepare("UPDATE email_campaigns SET status='draft' WHERE id=?").run(campaign.id);
    return res.status(400).json({ error: 'All subscribers would be skipped (no parsed first names). Run name parsing on the list first.' });
  }
  if (skippedNoName > 0) {
    console.log(`[email/send] campaign ${campaign.id}: ${skippedNoName} subscribers skipped (no parsed first_name)`);
  }

  db.prepare("UPDATE email_campaigns SET status='sending' WHERE id=?").run(campaign.id);
  // baseUrl comes from the request — on Render this is studio.thegreenagents.com.
  // PUBLIC_URL env var can override (useful for local dev where req.host is localhost).
  const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const alwaysWarm = !!(list && list.always_warm);
  res.json({ ok: true, subscribers: subscribers.length, skipped_no_first_name: skippedNoName });

  try {
    const results = await sendCampaign({
      campaign, subscribers, baseUrl, alwaysWarm,
      onProgress: (pct) => {
        db.prepare('UPDATE email_campaigns SET sent_count=? WHERE id=?')
          .run(Math.round(subscribers.length * pct / 100), campaign.id);
      },
    });
    // Note: email_sends rows are now written inside sendCampaign() at send time
    // (with message_id for SNS bounce/complaint mapping). No bulk insert here.
    // Re-read status before marking sent — user may have cancelled mid-send.
    const finalStatus = db.prepare('SELECT status FROM email_campaigns WHERE id=?').get(campaign.id);
    if (finalStatus && finalStatus.status === 'cancelled') {
      // Preserve the cancelled status; just record the partial sent count
      db.prepare(`UPDATE email_campaigns SET sent_count=? WHERE id=?`).run(results.sent, campaign.id);
    } else {
      db.prepare(`UPDATE email_campaigns SET status='sent', sent_at=datetime('now'), sent_count=? WHERE id=?`)
        .run(results.sent, campaign.id);
    }
  } catch (err) {
    db.prepare("UPDATE email_campaigns SET status='failed' WHERE id=?").run(campaign.id);
    console.error('[email/send] error:', err.message);
  }
});

// ── DOMAIN HEALTH ─────────────────────────────────────────────────────────────

router.get('/domain-health/:domain', async (req, res) => {
  const domain = req.params.domain;
  const results = { domain, spf: null, dkim: null, dmarc: null, mx: null, error: null };
  try {
    try { const txt = await resolve(domain); const spfRecord = txt.flat().find(r=>r.startsWith('v=spf1')); results.spf = spfRecord ? { status:'pass', record:spfRecord } : { status:'missing', record:null }; } catch { results.spf = { status:'missing', record:null }; }
    try { const dmarc = await resolve(`_dmarc.${domain}`); const rec = dmarc.flat().find(r=>r.startsWith('v=DMARC1')); results.dmarc = rec ? { status:'pass', record:rec } : { status:'missing', record:null }; } catch { results.dmarc = { status:'missing', record:null }; }
    try { const mx = await resolveMx(domain); results.mx = mx.length>0 ? { status:'pass', records:mx.map(r=>r.exchange) } : { status:'missing', records:[] }; } catch { results.mx = { status:'missing', records:[] }; }
    const selectors = ['amazonses','google','default','mail','dkim'];
    let dkimFound = false;
    for (const sel of selectors) {
      try { const rec = await resolve(`${sel}._domainkey.${domain}`); if (rec.flat().some(r=>r.includes('v=DKIM1'))) { results.dkim = { status:'pass', selector:sel }; dkimFound=true; break; } } catch {}
    }
    if (!dkimFound) results.dkim = { status:'missing', selector:null };
  } catch (err) { results.error = err.message; }
  res.json(results);
});

// ── VERIFIED SES DOMAINS (live from AWS) ──────────────────────────────────────

router.get('/verified-domains', async (req, res) => {
  try {
    const domains = await getVerifiedDomains();
    res.json(domains);
  } catch (err) {
    console.error('[verified-domains] AWS error, using fallback:', err.message);
    res.json(['thegreenagents.com','sweetbyte.co.uk','clear-a-way.co.uk','itcloudpros.uk','mail.engineersolutions.co.uk','syncsure.cloud','socialecho.ai','clearerpaths.co.uk','mail.weprintcatalogues.com']);
  }
});

export default router;

// ── CAMPAIGN QUEUE (per list) ─────────────────────────────────────────────────

// Get all campaigns for a list, ordered by queue position
router.get('/lists/:id/queue', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, el.name as list_name,
      (SELECT COUNT(*) FROM email_subscribers WHERE list_id=c.list_id AND status='subscribed') as total_subscribers
    FROM email_campaigns c
    LEFT JOIN email_lists el ON c.list_id=el.id
    WHERE c.list_id=?
    ORDER BY c.queue_position ASC, c.created_at ASC
  `).all(req.params.id);
  res.json(rows);
});

// Reorder queue
router.post('/lists/:id/queue/reorder', (req, res) => {
  const { order } = req.body; // array of campaign ids in new order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
  const update = db.prepare('UPDATE email_campaigns SET queue_position=? WHERE id=?');
  db.transaction(() => { order.forEach((id, i) => update.run(i + 1, id)); })();
  res.json({ ok: true });
});

// ── DRIP SEND ─────────────────────────────────────────────────────────────────

router.post('/campaigns/:id/start-drip', async (req, res) => {
  const {
    daily_limit, drip_start_at, send_order,
    drip_send_days, drip_window_start, drip_window_end, drip_timezone,
  } = req.body;
  if (!daily_limit || daily_limit < 1) return res.status(400).json({ error: 'Daily limit required' });

  const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  db.prepare(`UPDATE email_campaigns SET
    daily_limit=?, drip_start_at=?, send_order=?,
    drip_send_days=COALESCE(?, drip_send_days),
    drip_window_start=COALESCE(?, drip_window_start),
    drip_window_end=COALESCE(?, drip_window_end),
    drip_timezone=COALESCE(?, drip_timezone),
    status='scheduled', drip_sent=0,
    drip_today_sent=0, drip_today_date=NULL
    WHERE id=?`).run(
      daily_limit,
      drip_start_at || new Date().toISOString(),
      send_order || 'top',
      drip_send_days ?? null,
      drip_window_start ?? null,
      drip_window_end ?? null,
      drip_timezone ?? null,
      req.params.id
    );

  res.json({ ok: true });
});

router.post('/campaigns/:id/pause', (req, res) => {
  const c = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const newStatus = c.status === 'paused' ? 'sending' : 'paused';
  db.prepare('UPDATE email_campaigns SET status=? WHERE id=?').run(newStatus, req.params.id);
  res.json({ ok: true, status: newStatus });
});

// Cancel — stop further sends but keep stats. Distinct from delete which removes
// all data. Once a campaign is cancelled, you can still view the report for the
// portion that already sent.
router.post('/campaigns/:id/cancel', (req, res) => {
  const c = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!['sending', 'paused', 'scheduled'].includes(c.status)) {
    return res.status(400).json({ error: `Cannot cancel a ${c.status} campaign` });
  }
  db.prepare(`UPDATE email_campaigns SET status='cancelled' WHERE id=?`).run(req.params.id);
  res.json({ ok: true, status: 'cancelled' });
});

// ── TEST SEND ─────────────────────────────────────────────────────────────────

router.post('/campaigns/:id/test', async (req, res) => {
  const { test_email } = req.body;
  if (!test_email) return res.status(400).json({ error: 'Test email required' });

  const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  try {
    const testFooter = `<p style="margin-top:32px;font-size:11px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:16px;"><strong>TEST SEND</strong> — This is a preview only.</p>`;
    // Use "there" as a sentinel for both placeholder forms in test sends, so
    // the user sees a believable email even though no real subscriber is chosen.
    const rawHtml = (campaign.html_body || '')
      .replace(/\{\{\s*first_name\s*\}\}/gi, 'there')
      .replace(/\[Name\]/gi, 'there');
    const subject = (campaign.subject || '')
      .replace(/\{\{\s*first_name\s*\}\}/gi, 'there')
      .replace(/\[Name\]/gi, 'there');
    const html = rawHtml.includes('</body>') ? rawHtml.replace('</body>', `${testFooter}</body>`) : rawHtml + testFooter;

    const { sendEmail } = await import('../services/ses.js');
    // NOTE: no campaignId/subscriberId/baseUrl — test sends skip tracking
    // injection so they don't pollute real campaign stats.
    await sendEmail({
      to:        test_email,
      toName:    'Test Recipient',
      fromName:  campaign.from_name,
      fromEmail: campaign.from_email,
      replyTo:   campaign.reply_to || campaign.from_email,
      subject:   `[TEST] ${subject}`,
      htmlBody:  html,
      plainBody: `TEST SEND\n\n${campaign.plain_body || campaign.html_body.replace(/<[^>]+>/g,'')}`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[test-send] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CAMPAIGN REPORT ───────────────────────────────────────────────────────────

router.get('/campaigns/:id/report', (req, res) => {
  const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  // Link click stats
  const linkClicks = db.prepare(`
    SELECT url,
      COUNT(DISTINCT subscriber_id) as unique_clicks,
      COUNT(*) as total_clicks
    FROM email_link_clicks
    WHERE campaign_id=?
    GROUP BY url
    ORDER BY unique_clicks DESC
  `).all(req.params.id);

  // Openers count
  const openers = db.prepare(`
    SELECT COUNT(*) as c FROM email_sends
    WHERE campaign_id=? AND opened_at IS NOT NULL
  `).get(req.params.id);

  res.json({
    campaign,
    link_clicks: linkClicks,
    openers_count: openers.c,
  });
});

// GET /api/email/campaigns/:id/recipients
// Per-recipient view across the campaign's whole list. For each subscriber
// returns whether they've been sent yet, when, and any open/click/unsub status.
// Used by the "Recipients" panel in the campaign report — works for both
// in-flight drips ("who got it so far, who's still queued") and completed sends
// ("who opened, who didn't").
//
// Phase 4: for multi-step sequences, each subscriber may have multiple email_sends
// rows (one per step received). We surface the LATEST step per recipient as
// `last_step`, and add per-step send/reply counts to the summary.
//
// Optional ?status=sent|queued|opened|not-opened|clicked|bounced filters the list.
router.get('/campaigns/:id/recipients', (req, res) => {
  const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  // Steps lookup so the summary knows the configured step count.
  const steps = db.prepare(`
    SELECT step_number, delay_days FROM email_campaign_steps
    WHERE campaign_id=? ORDER BY step_number ASC
  `).all(req.params.id);

  // For each subscriber, pick their LATEST email_sends row for this campaign
  // (highest step_number). Subscribers with no send row at all show as queued
  // for step 1 (last_step = 0).
  //
  // Strategy: left-join the row whose step_number equals the max step_number
  // for that (campaign, subscriber). Sub-select with MAX() handles the multi-step
  // case correctly.
  const rows = db.prepare(`
    SELECT
      s.id           as subscriber_id,
      s.email,
      s.name,
      s.first_name,
      s.status       as subscriber_status,
      es.id          as send_id,
      es.message_id,
      es.status      as send_status,
      es.sent_at,
      es.opened_at,
      es.clicked_at,
      es.bounced_at,
      es.open_count,
      es.click_count,
      COALESCE(es.step_number, 0) as last_step,
      (
        -- Per-recipient click count = number of DISTINCT links the person opened
        -- (#101b). Corporate mail scanners re-fetch the same links many times over
        -- hours, which inflated a raw-hit count wildly (one recipient showed 67 on
        -- just 2 links). Counting distinct URLs answers the useful question — "how
        -- many of your links did they engage with" — and is immune to repeat-fetch
        -- storms. Works on historic rows too. Telling scanner from human entirely
        -- is a later layer, built on the ip_address/user_agent now captured below.
        SELECT COUNT(DISTINCT lc.url) FROM email_link_clicks lc
        WHERE lc.campaign_id = ? AND lc.subscriber_id = s.id
      ) as link_click_count
    FROM email_subscribers s
    LEFT JOIN email_sends es ON es.subscriber_id = s.id AND es.campaign_id = ?
      AND es.step_number = (
        SELECT MAX(step_number) FROM email_sends
        WHERE campaign_id = ? AND subscriber_id = s.id
      )
    WHERE s.list_id = ?
    ORDER BY
      CASE WHEN es.sent_at IS NULL THEN 1 ELSE 0 END,
      es.sent_at DESC,
      s.email ASC
  `).all(req.params.id, req.params.id, req.params.id, campaign.list_id);

  // Apply filter — done in JS rather than SQL because the bucket logic is
  // small and easier to reason about here.
  const filter = req.query.status;
  const all = rows.map(r => ({
    ...r,
    bucket: r.send_id == null ? 'queued'
          : r.opened_at       ? 'opened'
          : r.bounced_at      ? 'bounced'
          : r.send_status === 'failed' ? 'failed'
          : 'sent_no_open',
  }));
  let visible = all;
  if (filter === 'sent')        visible = all.filter(r => r.send_id != null);
  else if (filter === 'queued') visible = all.filter(r => r.send_id == null);
  else if (filter === 'opened') visible = all.filter(r => r.opened_at != null);
  else if (filter === 'not-opened') visible = all.filter(r => r.send_id != null && r.opened_at == null);
  else if (filter === 'clicked') visible = all.filter(r => r.clicked_at != null || r.link_click_count > 0);
  else if (filter === 'bounced') visible = all.filter(r => r.bounced_at != null || r.subscriber_status === 'bounced');

  // Per-step send counts — one row per step that has at least one send.
  // Includes opened/bounced rows because they were sent at some point.
  const stepCountRows = db.prepare(`
    SELECT step_number, COUNT(DISTINCT subscriber_id) as sent_count
    FROM email_sends
    WHERE campaign_id = ? AND status IN ('sent','opened','clicked','bounced')
    GROUP BY step_number
    ORDER BY step_number ASC
  `).all(req.params.id);

  // Per-step reply counts — count subscribers on this campaign's list who replied
  // (any classification) AFTER receiving a given step. The "after" check uses
  // the email_sends.sent_at vs email_replies.received_at timestamps.
  // The matched_campaign_id gate ensures we only count replies that actually
  // belong to THIS campaign (mailbox-view source of truth) — without it, any
  // reply from a contact who's also on another campaign's list was over-counted.
  const stepReplyRows = db.prepare(`
    SELECT es.step_number, COUNT(DISTINCT r.id) as reply_count
    FROM email_sends es
    JOIN email_subscribers s ON s.id = es.subscriber_id
    JOIN email_replies r ON r.email_client_id = ?
      AND lower(r.from_address) = lower(s.email)
      AND datetime(r.received_at) >= datetime(es.sent_at)
      AND r.matched_campaign_id = es.campaign_id
    WHERE es.campaign_id = ?
    GROUP BY es.step_number
    ORDER BY es.step_number ASC
  `).all(campaign.email_client_id, req.params.id);

  const stepStats = steps.map(step => {
    const sentRow = stepCountRows.find(r => r.step_number === step.step_number);
    const replyRow = stepReplyRows.find(r => r.step_number === step.step_number);
    return {
      step_number: step.step_number,
      delay_days: step.delay_days,
      sent_count: sentRow ? sentRow.sent_count : 0,
      reply_count: replyRow ? replyRow.reply_count : 0,
    };
  });

  // Summary counts (always over all, not the filtered set)
  const summary = {
    total: all.length,
    sent: all.filter(r => r.send_id != null).length,
    queued: all.filter(r => r.send_id == null).length,
    opened: all.filter(r => r.opened_at != null).length,
    clicked: all.filter(r => r.clicked_at != null || r.link_click_count > 0).length,
    bounced: all.filter(r => r.bounced_at != null).length,
    failed: all.filter(r => r.send_status === 'failed').length,
    step_count: steps.length,
    steps: stepStats,
  };

  res.json({ campaign_id: req.params.id, summary, recipients: visible });
});

// ── EXPORTS ───────────────────────────────────────────────────────────────────

// Turn an email address into a best-guess company label from its domain.
// Recipients only carry name + email (no company field), so the domain is the
// closest real signal — right ~90% of the time for B2B. Handles two-part TLDs
// (co.uk, com.au …) so "x@a.co.uk" → "A", not "Co".
function companyFromEmail(email) {
  const domain = String(email || '').split('@')[1] || '';
  if (!domain) return '';
  const parts = domain.toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return '';
  const TWO_PART_TLDS = ['co.uk','org.uk','ltd.uk','plc.uk','me.uk','com.au','net.au','org.au','co.nz','co.za','com.br','co.in'];
  const lastTwo = parts.slice(-2).join('.');
  const sld = (parts.length >= 3 && TWO_PART_TLDS.includes(lastTwo))
    ? parts[parts.length - 3]
    : parts[parts.length - 2];
  if (!sld) return '';
  return sld.charAt(0).toUpperCase() + sld.slice(1);
}

// Wrap a value as a safe CSV cell (quotes doubled, always quoted) so names,
// URLs, commas and line breaks can't break the column layout.
function csvCell(v) {
  return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
}

router.get('/campaigns/:id/export/:type', (req, res) => {
  const { type } = req.params;
  const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  // ── Clickers → CSV with the engagement columns ──────────────────────────────
  // One row per person who clicked (matches the campaign's "unique clickers"
  // number). Columns: Name, Email, Number of clicks, Number of opens, Website(s)
  // they clicked, Company (best-guess from the email domain). Clicks/opens are
  // TOTAL events for that person, so a very high number is almost always a
  // corporate mail-security scanner rather than a real reader.
  if (type === 'clickers') {
    const people = db.prepare(`
      SELECT es.id AS sid, es.name AS name, es.email AS email,
             esnd.click_count AS clicks, esnd.open_count AS opens
      FROM email_sends esnd
      JOIN email_subscribers es ON es.id = esnd.subscriber_id
      WHERE esnd.campaign_id = ? AND esnd.clicked_at IS NOT NULL
      ORDER BY esnd.click_count DESC, es.email ASC
    `).all(req.params.id);

    // Distinct websites each person clicked, grouped in JS so we control the
    // separator and CSV-escaping (SQLite GROUP_CONCAT DISTINCT forces commas).
    const urlRows = db.prepare(`
      SELECT DISTINCT subscriber_id AS sid, url
      FROM email_link_clicks
      WHERE campaign_id = ?
    `).all(req.params.id);
    const urlsBySid = new Map();
    for (const u of urlRows) {
      if (!urlsBySid.has(u.sid)) urlsBySid.set(u.sid, []);
      urlsBySid.get(u.sid).push(u.url);
    }

    const header = ['Name','Email','Number of clicks','Number of opens','Website','Company']
      .map(csvCell).join(',') + '\n';
    const body = people.map(p => [
      p.name || '',
      p.email || '',
      p.clicks || 0,
      p.opens || 0,
      (urlsBySid.get(p.sid) || []).join(' | '),
      companyFromEmail(p.email),
    ].map(csvCell).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="clickers-${req.params.id}.csv"`);
    return res.send(header + body);
  }

  let rows = [];
  const header = 'Name,Email,Status\n';

  if (type === 'openers') {
    rows = db.prepare(`
      SELECT es.name, es.email, 'Opened' as status
      FROM email_subscribers es
      JOIN email_sends esnd ON esnd.subscriber_id=es.id
      WHERE esnd.campaign_id=? AND esnd.opened_at IS NOT NULL
    `).all(req.params.id);
  } else if (type === 'non-openers') {
    rows = db.prepare(`
      SELECT es.name, es.email, 'Not opened' as status
      FROM email_subscribers es
      JOIN email_sends esnd ON esnd.subscriber_id=es.id
      WHERE esnd.campaign_id=? AND esnd.opened_at IS NULL
    `).all(req.params.id);
  } else if (type === 'bounced') {
    rows = db.prepare(`
      SELECT es.name, es.email, 'Bounced' as status
      FROM email_subscribers es
      WHERE es.list_id=? AND es.status='bounced'
    `).all(campaign.list_id);
  } else if (type === 'recipients') {
    // Everyone the campaign has been sent to so far. For an in-flight drip
    // this answers "who's actually received the email at this point".
    rows = db.prepare(`
      SELECT s.name, s.email,
        CASE
          WHEN esnd.bounced_at IS NOT NULL THEN 'Bounced'
          WHEN esnd.opened_at  IS NOT NULL THEN 'Sent (opened)'
          WHEN esnd.status = 'failed'      THEN 'Send failed'
          ELSE 'Sent'
        END as status,
        esnd.sent_at
      FROM email_subscribers s
      JOIN email_sends esnd ON esnd.subscriber_id = s.id
      WHERE esnd.campaign_id = ?
      ORDER BY esnd.sent_at DESC
    `).all(req.params.id);
  } else if (type === 'queued') {
    // Everyone on the list who hasn't been sent yet. Useful while a drip is
    // mid-flight to see who's still queued.
    rows = db.prepare(`
      SELECT s.name, s.email, 'Queued' as status
      FROM email_subscribers s
      WHERE s.list_id = ? AND s.status = 'subscribed'
        AND NOT EXISTS (
          SELECT 1 FROM email_sends esnd WHERE esnd.campaign_id = ? AND esnd.subscriber_id = s.id
        )
      ORDER BY s.email ASC
    `).all(campaign.list_id, req.params.id);
  }

  const csv = header + rows.map(r => `"${r.name||''}","${r.email}","${r.status}"`).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${type}-${req.params.id}.csv"`);
  res.send(csv);
});

// ── MAILBOXES (Phase 3.1) ─────────────────────────────────────────────────────
// IMAP-based reply monitoring for connected Gmail/Workspace inboxes.
// Each mailbox belongs to one email_client. App passwords are encrypted at rest.

// GET /api/email/mailboxes — list all connected inboxes (optionally filtered by email_client_id)
router.get('/mailboxes', (req, res) => {
  const { email_client_id } = req.query;
  const sql = email_client_id
    ? `SELECT i.*,
         (SELECT COUNT(*) FROM email_replies r WHERE r.inbox_id=i.id AND r.classification='positive' AND r.handled_at IS NULL) as new_prospect_count,
         (SELECT COUNT(*) FROM email_replies r WHERE r.inbox_id=i.id AND r.auto_unsubscribed=1) as auto_unsub_count,
         (SELECT COUNT(*) FROM email_replies r WHERE r.inbox_id=i.id AND r.received_at >= datetime('now','-30 days')) as replies_30d
       FROM email_inboxes i WHERE i.email_client_id=? ORDER BY i.email_address ASC`
    : `SELECT i.*,
         (SELECT COUNT(*) FROM email_replies r WHERE r.inbox_id=i.id AND r.classification='positive' AND r.handled_at IS NULL) as new_prospect_count,
         (SELECT COUNT(*) FROM email_replies r WHERE r.inbox_id=i.id AND r.auto_unsubscribed=1) as auto_unsub_count,
         (SELECT COUNT(*) FROM email_replies r WHERE r.inbox_id=i.id AND r.received_at >= datetime('now','-30 days')) as replies_30d
       FROM email_inboxes i ORDER BY i.email_address ASC`;
  const rows = email_client_id ? db.prepare(sql).all(email_client_id) : db.prepare(sql).all();
  // Strip the encrypted password from the response — frontend never needs it
  for (const r of rows) delete r.app_password_encrypted;
  res.json(rows);
});

// GET /api/email/mailboxes/badge-count — total new-prospect count across all inboxes
// Drives the sidebar badge on the Mailboxes menu item
router.get('/mailboxes/badge-count', (req, res) => {
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM email_replies
    WHERE classification='positive' AND handled_at IS NULL
  `).get();
  res.json({ new_prospects: row?.c || 0 });
});

// POST /api/email/mailboxes/test — verify IMAP credentials before saving
router.post('/mailboxes/test', async (req, res) => {
  const { email, app_password } = req.body;
  if (!email || !app_password) return res.status(400).json({ error: 'email and app_password required' });
  // Strip whitespace — Google's app password format includes spaces but Gmail accepts either
  const pw = app_password.replace(/\s+/g, '');
  const result = await testImapCredentials({ email, appPassword: pw });
  res.json(result);
});

// POST /api/email/mailboxes — connect a new mailbox (encrypts and stores the password)
router.post('/mailboxes', async (req, res) => {
  const { email_client_id, email, app_password } = req.body;
  if (!email_client_id || !email || !app_password) {
    return res.status(400).json({ error: 'email_client_id, email and app_password required' });
  }
  // Verify encryption is configured before we save
  const ct = cryptoSelfTest();
  if (!ct.ok) return res.status(500).json({ error: `Server misconfigured: ${ct.reason}` });

  const pw = app_password.replace(/\s+/g, '');

  // Test connection first — don't save broken credentials
  const test = await testImapCredentials({ email, appPassword: pw });
  if (!test.ok) return res.status(400).json({ error: `IMAP test failed: ${test.error}` });

  try {
    const id = uuid();
    db.prepare(`INSERT INTO email_inboxes (id, email_client_id, email_address, app_password_encrypted)
                VALUES (?, ?, ?, ?)`).run(id, email_client_id, email.toLowerCase().trim(), encrypt(pw));
    db.prepare(`INSERT INTO email_audit_log (id, actor, action, target_type, target_id, metadata)
                VALUES (?, 'system', 'connect_mailbox', 'mailbox', ?, ?)`)
      .run(uuid(), id, JSON.stringify({ email, email_client_id }));
    res.json({ ok: true, id });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Mailbox already connected' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/email/mailboxes/:id — update enabled flag, or rotate the app password
router.put('/mailboxes/:id', async (req, res) => {
  const ib = db.prepare('SELECT * FROM email_inboxes WHERE id=?').get(req.params.id);
  if (!ib) return res.status(404).json({ error: 'Not found' });
  const { enabled, app_password } = req.body;
  if (typeof enabled === 'boolean') {
    db.prepare('UPDATE email_inboxes SET enabled=? WHERE id=?').run(enabled ? 1 : 0, req.params.id);
  }
  if (app_password) {
    const pw = app_password.replace(/\s+/g, '');
    const test = await testImapCredentials({ email: ib.email_address, appPassword: pw });
    if (!test.ok) return res.status(400).json({ error: `IMAP test failed: ${test.error}` });
    db.prepare('UPDATE email_inboxes SET app_password_encrypted=?, last_error=NULL WHERE id=?').run(encrypt(pw), req.params.id);
  }
  res.json({ ok: true });
});

// DELETE /api/email/mailboxes/:id — disconnect (keeps reply history)
router.delete('/mailboxes/:id', (req, res) => {
  // Replies stay (linked by inbox_id) so historical reports remain. Audit logged.
  db.prepare('UPDATE email_inboxes SET enabled=0 WHERE id=?').run(req.params.id);
  db.prepare(`INSERT INTO email_audit_log (id, actor, action, target_type, target_id)
              VALUES (?, 'system', 'disconnect_mailbox', 'mailbox', ?)`)
    .run(uuid(), req.params.id);
  res.json({ ok: true });
});

// POST /api/email/mailboxes/:id/poll — trigger an immediate poll (for "Check now" button)
router.post('/mailboxes/:id/poll', async (req, res) => {
  const result = await pollSingleInbox(req.params.id);
  res.json(result);
});

// POST /api/email/mailboxes/:id/resync — full destructive resync.
//
// What this does, in order:
//   1. Deletes every email_replies row for this mailbox (the local copies).
//   2. Optionally reverts any auto-unsubscribes that those replies caused —
//      ONLY if revertAutoUnsubs=true is in the body. Default false because
//      silently re-subscribing people who replied "remove me" is a CAN-SPAM /
//      GDPR risk. The UI defaults the checkbox to off.
//   3. Resets last_uid=0 so the next IMAP poll re-fetches from scratch.
//   4. Triggers an immediate poll so the UI refreshes without waiting.
//   5. Audit-logs the whole thing with counts.
//
// Anything no longer in the IMAP inbox is permanently lost from the Studio.
// This is the user's explicit choice — the button has a typed-confirmation
// modal in front of it.
router.post('/mailboxes/:id/resync', async (req, res) => {
  const inbox = db.prepare('SELECT * FROM email_inboxes WHERE id=?').get(req.params.id);
  if (!inbox) return res.status(404).json({ ok: false, error: 'Mailbox not found' });

  const revertAutoUnsubs = !!req.body?.revertAutoUnsubs;

  // 1. Find replies that caused auto-unsubs — needed both for the revert step
  // (if requested) and for the audit-log metadata (always).
  const replyIds = db.prepare('SELECT id FROM email_replies WHERE inbox_id = ?')
    .all(req.params.id).map(r => r.id);
  const replyCount = replyIds.length;

  let revertedSubscribers = 0;
  const touchedListIds = new Set();

  const tx = db.transaction(() => {
    if (revertAutoUnsubs && replyIds.length > 0) {
      // Find every subscriber that was auto-unsubbed because of one of these replies.
      // The audit log row recorded the link (reply_id column).
      const placeholders = replyIds.map(() => '?').join(',');
      const affected = db.prepare(`
        SELECT DISTINCT target_id as subscriber_id
        FROM email_audit_log
        WHERE action = 'auto_unsubscribe'
          AND target_type = 'subscriber'
          AND reply_id IN (${placeholders})
      `).all(...replyIds);

      // Only revert subscribers that are still in 'unsubscribed' status. If they've
      // been manually re-subscribed since, leave them alone.
      const revertStmt = db.prepare(`
        UPDATE email_subscribers
        SET status = 'subscribed', unsubscribed_at = NULL
        WHERE id = ? AND status = 'unsubscribed'
      `);
      const revertAuditStmt = db.prepare(`INSERT INTO email_audit_log
        (id, actor, action, target_type, target_id, metadata)
        VALUES (?, 'system', 'resync_revert_auto_unsubscribe', 'subscriber', ?, ?)`);
      const getListId = db.prepare('SELECT list_id FROM email_subscribers WHERE id = ?');
      for (const row of affected) {
        const r = revertStmt.run(row.subscriber_id);
        if (r.changes > 0) {
          revertedSubscribers++;
          revertAuditStmt.run(uuid(), row.subscriber_id,
            JSON.stringify({ inbox_id: req.params.id, reason: 'mailbox resync' }));
          const lst = getListId.get(row.subscriber_id);
          if (lst?.list_id) touchedListIds.add(lst.list_id);
        }
      }
      // Recompute subscriber_count on every list that had a revert.
      const updateListCount = db.prepare(
        "UPDATE email_lists SET subscriber_count = (SELECT COUNT(*) FROM email_subscribers WHERE list_id = ? AND status = 'subscribed') WHERE id = ?"
      );
      for (const lid of touchedListIds) updateListCount.run(lid, lid);
    }

    // 2. Wipe local replies for this mailbox. Done after the auto-unsub revert
    // so the audit log link still exists when we look it up.
    db.prepare('DELETE FROM email_replies WHERE inbox_id = ?').run(req.params.id);

    // 3. Reset poll cursor. Next poll fetches from scratch.
    db.prepare('UPDATE email_inboxes SET last_uid = 0, last_error = NULL WHERE id = ?').run(req.params.id);

    // 4. Audit log the resync itself.
    db.prepare(`INSERT INTO email_audit_log
      (id, actor, action, target_type, target_id, metadata)
      VALUES (?, 'user', 'resync_mailbox_purge', 'mailbox', ?, ?)`).run(
      uuid(), req.params.id,
      JSON.stringify({
        replies_deleted: replyCount,
        auto_unsubs_reverted: revertedSubscribers,
        revert_requested: revertAutoUnsubs,
      })
    );
  });
  tx();

  console.log(`[poller] ${inbox.email_address}: full resync — purged ${replyCount} replies, reverted ${revertedSubscribers} auto-unsubs (revert_requested=${revertAutoUnsubs})`);

  // 5. Immediately re-poll so the user sees results without waiting 3 minutes.
  const result = await pollSingleInbox(req.params.id);
  res.json({
    ok: true,
    replies_deleted: replyCount,
    auto_unsubs_reverted: revertedSubscribers,
    poll: result,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// attachInboxBadges(rows)
//
// Decorates a list of email_replies rows (or a single row passed as a one-
// element array) with two extra fields that the frontend uses to render
// secondary status badges next to the classification badge:
//
//   hot_prospect_id              — UUID of the matching hot_prospects row, or
//                                  null. Drives the "On Hot Prospects list"
//                                  badge + the Open-in-CRM click target.
//   hot_prospect_crm_customer_id — Anchor id for Open-in-CRM (decision #85 —
//                                  for a linked customer this is the portal
//                                  anchor, not the inbox-owning row).
//   contact_unsubscribed         — true if the sender's email matches any
//                                  subscribers row under this customer's
//                                  lists with status='unsubscribed' OR
//                                  unsubscribed_at populated.
//
// Both lookups are batched across all rows so a 100-row page is two SQL
// queries, not 200. Mutates rows in place and also returns them for chainability.
//
// Both fields are PRESENT on every row (default null/false) so the frontend
// never has to guard against undefined. Errors are swallowed — a JOIN
// failure shouldn't blank out the inbox.
// ─────────────────────────────────────────────────────────────────────────────
function attachInboxBadges(rows) {
  // Pre-default so callers can rely on the keys being present
  for (const r of rows) {
    r.hot_prospect_id = null;
    r.hot_prospect_crm_customer_id = null;
    r.contact_unsubscribed = false;
    // Single source of truth for the "Website Prospect" badge: the same
    // Formspree detection the auto-flagger uses (sender + body form-fields),
    // so the UI never drifts from the flagger via a stale keyword copy.
    r.is_website_prospect = isFormspreeLeadRow(r);
  }
  if (!rows || rows.length === 0) return rows;

  try {
    // Collect distinct (email_client_id, lowercased from_address) pairs. In
    // practice all rows in one mailbox view share the same email_client_id,
    // but the function takes a generic list so we don't assume that.
    const pairs = [];
    const seen = new Set();
    for (const r of rows) {
      const ecid = r.email_client_id ? String(r.email_client_id) : null;
      const addr = r.from_address ? String(r.from_address).toLowerCase() : null;
      if (!ecid || !addr) continue;
      const key = ecid + '|' + addr;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ ecid, addr });
    }
    if (pairs.length === 0) return rows;

    // Hot Prospects: lookup keyed by (linked-set of email_client_ids, email).
    // We resolve each ecid's linked set once, then run one batched query per
    // distinct linked-set + address combination. In the common single-customer
    // case (one mailbox, all rows share one ecid, one linked set), that's a
    // single batched query against all sender addresses.
    const hpMap = new Map(); // key = `${ecid}|${addr}` → { id, crm_customer_id }
    const linkedSetCache = new Map(); // ecid → resolved set
    function getLinkedSet(ecid) {
      if (linkedSetCache.has(ecid)) return linkedSetCache.get(ecid);
      const set = resolveLinkedSet(ecid);
      linkedSetCache.set(ecid, set);
      return set;
    }

    // Group pairs by their linked set so we can do ONE query per distinct set.
    const groupedBySet = new Map(); // setKey → { ids:[...], pairs:[{ecid, addr}] }
    for (const p of pairs) {
      const ids = getLinkedSet(p.ecid);
      const setKey = ids.slice().sort().join(',');
      if (!groupedBySet.has(setKey)) {
        groupedBySet.set(setKey, { ids, pairs: [] });
      }
      groupedBySet.get(setKey).pairs.push(p);
    }

    for (const group of groupedBySet.values()) {
      const addrs = Array.from(new Set(group.pairs.map(p => p.addr)));
      if (addrs.length === 0) continue;
      const idPlaceholders = group.ids.map(() => '?').join(',');
      const addrPlaceholders = addrs.map(() => '?').join(',');
      const hpRows = db.prepare(`
        SELECT id, email_client_id, prospect_email
        FROM hot_prospects
        WHERE email_client_id IN (${idPlaceholders})
          AND LOWER(prospect_email) IN (${addrPlaceholders})
      `).all(...group.ids, ...addrs);
      for (const hp of hpRows) {
        // Store keyed by the original reply's ecid (not the hp row's ecid)
        // because the badge needs to map back to the row. Any pair in this
        // group that matches the address gets this prospect.
        for (const p of group.pairs) {
          if (p.addr === String(hp.prospect_email).toLowerCase()) {
            hpMap.set(p.ecid + '|' + p.addr, {
              id: hp.id,
              crm_customer_id: resolveCrmCustomerId(hp.email_client_id),
            });
          }
        }
      }
    }

    // Subscribers: lookup keyed by (linked-set of email_client_ids, email).
    // Lists belong to a single email_client_id, BUT for linked customers
    // (decision #85) the lists could be under EITHER the portal anchor row
    // OR the inbox-owning row in principle. Scoping the JOIN to the inbox
    // row alone would miss real unsubscribes when the lists actually live
    // under the anchor (the common case). Use the same linked-set as Hot
    // Prospects to keep the answer correct for all customer shapes.
    const unsubMap = new Set(); // `${ecid}|${addr}` if unsubscribed
    for (const group of groupedBySet.values()) {
      const addrs = Array.from(new Set(group.pairs.map(p => p.addr)));
      if (addrs.length === 0) continue;
      const idPlaceholders = group.ids.map(() => '?').join(',');
      const addrPlaceholders = addrs.map(() => '?').join(',');
      const subRows = db.prepare(`
        SELECT DISTINCT LOWER(s.email) AS email
        FROM email_subscribers s
        JOIN email_lists l ON l.id = s.list_id
        WHERE l.email_client_id IN (${idPlaceholders})
          AND LOWER(s.email) IN (${addrPlaceholders})
          AND (s.status = 'unsubscribed' OR s.unsubscribed_at IS NOT NULL)
      `).all(...group.ids, ...addrs);
      for (const sr of subRows) {
        for (const p of group.pairs) {
          if (p.addr === sr.email) {
            unsubMap.add(p.ecid + '|' + p.addr);
          }
        }
      }
    }

    // Stamp results back onto every row
    for (const r of rows) {
      const ecid = r.email_client_id ? String(r.email_client_id) : null;
      const addr = r.from_address ? String(r.from_address).toLowerCase() : null;
      if (!ecid || !addr) continue;
      const key = ecid + '|' + addr;
      const hp = hpMap.get(key);
      if (hp) {
        r.hot_prospect_id = hp.id;
        r.hot_prospect_crm_customer_id = hp.crm_customer_id;
      }
      if (unsubMap.has(key)) {
        r.contact_unsubscribed = true;
      }
    }
  } catch (e) {
    // Never let badge lookup break the inbox load. Log + continue with defaults.
    console.warn('[email] attachInboxBadges failed (non-fatal):', e?.message || e);
  }
  return rows;
}

// GET /api/email/mailboxes/:id/replies — list replies for one inbox
// query params: ?bucket=all|prospects|auto_unsubscribed|out_of_office&limit=50
router.get('/mailboxes/:id/replies', (req, res) => {
  const ib = db.prepare('SELECT id FROM email_inboxes WHERE id=?').get(req.params.id);
  if (!ib) return res.status(404).json({ error: 'Not found' });

  const bucket = req.query.bucket || 'all';
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);

  let where = 'inbox_id = ?';
  const args = [req.params.id];
  if (bucket === 'prospects') {
    where += " AND classification = 'positive' AND handled_at IS NULL";
  } else if (bucket === 'auto_unsubscribed') {
    where += ' AND auto_unsubscribed = 1';
  } else if (bucket === 'out_of_office') {
    where += " AND classification = 'auto_reply'";
  }

  const rows = db.prepare(`
    SELECT r.*, s.name as subscriber_name, c.title as campaign_title
    FROM email_replies r
    LEFT JOIN email_subscribers s ON s.id = r.matched_subscriber_id
    LEFT JOIN email_campaigns c ON c.id = r.matched_campaign_id
    WHERE ${where}
    ORDER BY r.received_at DESC
    LIMIT ?
  `).all(...args, limit);

  // Attach per-row "has been added to Hot Prospects" + "contact unsubscribed"
  // badges. Both signals are looked up by (customer, sender-email). Hot
  // Prospects spans the linked set per decision #85 (Cube6 anchor + the linked
  // inbox row count as one customer); subscribers belong to lists, lists belong
  // to a single email_client_id, so the subscriber lookup uses the reply's own
  // email_client_id.
  //
  // For efficiency we resolve the linked set ONCE per request (all replies on
  // a given mailbox/inbox share the same email_client_id), then do two batched
  // lookups across all sender addresses in this page of results.
  attachInboxBadges(rows);

  // Trim huge body fields for the list view — full bodies fetched on detail
  for (const r of rows) {
    if (r.body_text && r.body_text.length > 500) r.body_text = r.body_text.slice(0, 500) + '…';
    delete r.body_html;
  }
  res.json(rows);
});

// GET /api/email/replies/:id — full detail for one reply
router.get('/replies/:id', (req, res) => {
  const r = db.prepare(`
    SELECT r.*, s.name as subscriber_name, s.email as subscriber_email,
           c.title as campaign_title, c.subject as campaign_subject, c.sent_at as campaign_sent_at,
           i.email_address as inbox_email
    FROM email_replies r
    LEFT JOIN email_subscribers s ON s.id = r.matched_subscriber_id
    LEFT JOIN email_campaigns c ON c.id = r.matched_campaign_id
    LEFT JOIN email_inboxes i ON i.id = r.inbox_id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  // Decorate with hot_prospect_id + contact_unsubscribed for the modal badges.
  attachInboxBadges([r]);
  res.json(r);
});

// POST /api/email/replies/:id/handle — mark a prospect as handled (clears badge)
router.post('/replies/:id/handle', (req, res) => {
  const r = db.prepare('SELECT * FROM email_replies WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE email_replies SET handled_at=datetime('now'), handled_by='user' WHERE id=?`).run(req.params.id);
  db.prepare(`INSERT INTO email_audit_log (id, actor, action, target_type, target_id, reply_id)
              VALUES (?, 'user', 'mark_handled', 'reply', ?, ?)`)
    .run(uuid(), req.params.id, req.params.id);
  res.json({ ok: true });
});

// POST /api/email/replies/:id/reclassify — change classification (manual override)
router.post('/replies/:id/reclassify', (req, res) => {
  const { classification } = req.body;
  const valid = ['positive', 'hard_negative', 'soft_negative', 'auto_reply', 'forwarding', 'neutral'];
  if (!valid.includes(classification)) return res.status(400).json({ error: 'invalid classification' });
  const r = db.prepare('SELECT * FROM email_replies WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE email_replies SET classification=?, classification_reason=? WHERE id=?')
    .run(classification, 'manual override', req.params.id);
  db.prepare(`INSERT INTO email_audit_log (id, actor, action, target_type, target_id, reply_id, metadata)
              VALUES (?, 'user', 'reclassify', 'reply', ?, ?, ?)`)
    .run(uuid(), req.params.id, req.params.id, JSON.stringify({ from: r.classification, to: classification }));
  res.json({ ok: true });
});

// POST /api/email/replies/:id/classify — run the AI classifier on this single reply
// (force=true re-runs even if already classified). Used by the "Classify with AI"
// button in the reply detail modal.
router.post('/replies/:id/classify', async (req, res) => {
  const force = req.body?.force === true || req.query.force === '1';
  try {
    const result = await classifyOneReply(req.params.id, { force });
    res.json(result);
  } catch (err) {
    console.error('[classify-one] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/replies/classify-now — kick the classifier cron immediately.
// Runs the next batch of unclassified replies (capped at MAX_PER_RUN per run).
// Used by the "Classify pending" button in the mailbox detail header.
router.post('/replies/classify-now', async (req, res) => {
  try {
    const stats = await classifyPendingOnce();
    res.json({ ok: true, ...stats });
  } catch (err) {
    console.error('[classify-now] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/replies/:id/manual-unsubscribe — operator unsubscribes the
// sender from all of this customer's mailing lists.
//
// "This customer" = the linked set per decision #85, so a reply that arrived
// on the inbox row (mail.eng) still unsubscribes the sender from lists under
// the portal anchor (Cube6). Single-customer flows are unaffected — the
// linked set is just [self] in that case.
//
// Three response shapes (frontend keys off `code` when ok=false):
//   1. ok=true, lists_affected=N           — at least one subscriber row
//                                            flipped, OR contact was already
//                                            unsubscribed on every row we
//                                            found. Per-reply flag stamped
//                                            either way (audit signal).
//   2. ok=false, code='not_on_lists'       — sender's email isn't on ANY of
//                                            this customer's mailing lists.
//                                            Nothing flipped, nothing
//                                            stamped — honest refusal so
//                                            the operator knows.
//   3. ok=false, code='already_unsubscribed' — every subscriber row was
//                                              already unsubscribed.
//                                              Different from (1) because
//                                              there was nothing to do at
//                                              the subscriber level.
router.post('/replies/:id/manual-unsubscribe', (req, res) => {
  const r = db.prepare('SELECT * FROM email_replies WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });

  const email = r.from_address;
  const emailLc = String(email || '').toLowerCase();
  const linkedIds = resolveLinkedSet(r.email_client_id);
  const idPlaceholders = linkedIds.map(() => '?').join(',');

  // ALL subscriber rows for this email under the customer's linked set,
  // regardless of current status. We need to know if (a) there are any rows
  // at all, and (b) which are still active and need flipping.
  const allRows = db.prepare(`
    SELECT s.* FROM email_subscribers s
    JOIN email_lists l ON s.list_id = l.id
    WHERE LOWER(s.email) = ? AND l.email_client_id IN (${idPlaceholders})
  `).all(emailLc, ...linkedIds);

  if (allRows.length === 0) {
    return res.json({
      ok: false,
      code: 'not_on_lists',
      message: 'This contact isn\'t on any of your mailing lists, so there\'s nothing to unsubscribe.',
    });
  }

  const subscribedRows = allRows.filter(s => s.status === 'subscribed');
  if (subscribedRows.length === 0) {
    return res.json({
      ok: false,
      code: 'already_unsubscribed',
      message: 'This contact is already unsubscribed from all of your mailing lists.',
    });
  }

  for (const s of subscribedRows) {
    db.prepare("UPDATE email_subscribers SET status='unsubscribed', unsubscribed_at=datetime('now') WHERE id=?").run(s.id);
    db.prepare(`UPDATE email_lists SET subscriber_count=(SELECT COUNT(*) FROM email_subscribers WHERE list_id=? AND status='subscribed') WHERE id=?`)
      .run(s.list_id, s.list_id);
  }
  db.prepare('UPDATE email_replies SET auto_unsubscribed=1 WHERE id=?').run(req.params.id);
  db.prepare(`INSERT INTO email_audit_log (id, actor, action, target_type, target_id, reply_id, metadata)
              VALUES (?, 'user', 'manual_unsubscribe', 'subscriber', ?, ?, ?)`)
    .run(uuid(), email, req.params.id, JSON.stringify({
      email_client_id: r.email_client_id,
      linked_ids: linkedIds,
      lists_affected: subscribedRows.length,
    }));
  res.json({ ok: true, lists_affected: subscribedRows.length });
});

// POST /api/email/replies/:id/manual-resubscribe — reverse of the above.
//
// Flips every unsubscribed subscriber row for this email back to status =
// 'subscribed' and clears unsubscribed_at, across the linked set. Does NOT
// touch the per-reply auto_unsubscribed flag — that's audit history for the
// reply, not the contact's current state. (The new "contact_unsubscribed"
// pill reads from email_subscribers, not from this flag, so dropping the
// pill on next load is the visible effect.)
//
// Same three-shape response pattern as unsubscribe:
//   ok=true, lists_affected=N             — at least one row flipped back
//   ok=false, code='not_on_lists'         — no subscriber rows exist at all
//   ok=false, code='already_subscribed'   — all rows already active
router.post('/replies/:id/manual-resubscribe', (req, res) => {
  const r = db.prepare('SELECT * FROM email_replies WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });

  const email = r.from_address;
  const emailLc = String(email || '').toLowerCase();
  const linkedIds = resolveLinkedSet(r.email_client_id);
  const idPlaceholders = linkedIds.map(() => '?').join(',');

  const allRows = db.prepare(`
    SELECT s.* FROM email_subscribers s
    JOIN email_lists l ON s.list_id = l.id
    WHERE LOWER(s.email) = ? AND l.email_client_id IN (${idPlaceholders})
  `).all(emailLc, ...linkedIds);

  if (allRows.length === 0) {
    return res.json({
      ok: false,
      code: 'not_on_lists',
      message: 'This contact isn\'t on any of your mailing lists.',
    });
  }

  const unsubRows = allRows.filter(s => s.status === 'unsubscribed');
  if (unsubRows.length === 0) {
    return res.json({
      ok: false,
      code: 'already_subscribed',
      message: 'This contact is already subscribed to all of your mailing lists.',
    });
  }

  for (const s of unsubRows) {
    db.prepare("UPDATE email_subscribers SET status='subscribed', unsubscribed_at=NULL WHERE id=?").run(s.id);
    db.prepare(`UPDATE email_lists SET subscriber_count=(SELECT COUNT(*) FROM email_subscribers WHERE list_id=? AND status='subscribed') WHERE id=?`)
      .run(s.list_id, s.list_id);
  }
  db.prepare(`INSERT INTO email_audit_log (id, actor, action, target_type, target_id, reply_id, metadata)
              VALUES (?, 'user', 'manual_resubscribe', 'subscriber', ?, ?, ?)`)
    .run(uuid(), email, req.params.id, JSON.stringify({
      email_client_id: r.email_client_id,
      linked_ids: linkedIds,
      lists_affected: unsubRows.length,
    }));
  res.json({ ok: true, lists_affected: unsubRows.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/email/replies/:id/subscriptions
//
// Build the campaign-subscription panel for the contact who sent this reply.
// Used by the inbox open-email modal — the starting point is a reply row,
// so we resolve the contact via from_address + email_client_id and pass
// those to the shared helper in hot-prospects.js.
//
// Same panel shape as the Hot Prospect endpoint. The frontend renders the
// same component regardless of which surface invoked it; that's the whole
// point of the panel design (decision 2026-05-22, "identical UX on inbox
// emails and Hot Prospect list").
//
// extras.reply_id lets the frontend cross-reference the source modal.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/replies/:id/subscriptions', (req, res) => {
  const reply = db
    .prepare('SELECT id, email_client_id, from_address FROM email_replies WHERE id = ?')
    .get(String(req.params.id || ''));
  if (!reply) return res.status(404).json({ error: 'reply not found' });
  const panel = buildSubscriptionsPanel(
    reply.email_client_id,
    reply.from_address,
    { extras: { reply_id: reply.id } }
  );
  if (!panel) return res.status(404).json({ error: 'contact not resolvable from reply' });
  res.json(panel);
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/email/replies/:id/subscriptions
//
// Apply a partial subscription update from the inbox modal. Same body shape
// as the Hot Prospect PUT — both call into applySubscriptionsUpdate. Returns
// the fresh panel state for re-render.
//
// audit.extras records reply_id so the audit trail tells you which surface
// the change came from (vs hot_prospect_id from the Hot Prospect side).
// ─────────────────────────────────────────────────────────────────────────────
router.put('/replies/:id/subscriptions', (req, res) => {
  const reply = db
    .prepare('SELECT id, email_client_id, from_address FROM email_replies WHERE id = ?')
    .get(String(req.params.id || ''));
  if (!reply) return res.status(404).json({ error: 'reply not found' });
  applySubscriptionsUpdate(
    reply.email_client_id,
    reply.from_address,
    req.body || {},
    { actor: 'user', extras: { reply_id: reply.id } }
  );
  const panel = buildSubscriptionsPanel(
    reply.email_client_id,
    reply.from_address,
    { extras: { reply_id: reply.id } }
  );
  res.json(panel);
});

// POST /api/email/replies/:id/send — admin reply to an inbound message.
//
// Mirrors the customer-portal POST /api/portal/replies/:id/send endpoint
// (server/routes/portal.js) in behaviour: resolves the reply + its inbox,
// builds RFC 5322 threading headers (In-Reply-To + References), persists an
// email_outbound row up front, then calls SES. On SES success the row gets
// stamped with the SES MessageId; on failure the error is stored on the row
// and the request returns 502.
//
// Differences from the portal version:
//   - There's no portal user — client_user_id stays NULL.
//   - From-name uses the email_client's default_from_name when set, falling
//     back to the email_client's display name. Recipients see a sender
//     consistent with what they'd see from a campaign, not from the operator.
//   - actor in the audit log is 'admin'.
//
// Body: { cc?: string, body: string }
router.post('/replies/:id/send', async (req, res) => {
  const { cc = '', body = '' } = req.body || {};
  const bodyText = String(body || '').trim();
  const ccText   = String(cc   || '').trim();

  if (!bodyText) {
    return res.status(400).json({ error: 'Reply body cannot be empty.' });
  }

  // Resolve the reply + its mailbox + the customer's default-from settings.
  const reply = db.prepare(`
    SELECT
      r.id, r.email_client_id, r.inbox_id, r.message_id,
      r.from_address, r.from_name, r.subject,
      r.in_reply_to, r.references_header,
      i.email_address AS mailbox_address,
      ec.name              AS client_name,
      ec.default_from_name AS client_default_from_name
    FROM email_replies r
    LEFT JOIN email_inboxes i  ON i.id  = r.inbox_id
    LEFT JOIN email_clients ec ON ec.id = r.email_client_id
    WHERE r.id = ?
  `).get(req.params.id);

  if (!reply) return res.status(404).json({ error: 'Not found' });
  if (!reply.mailbox_address) {
    return res.status(500).json({ error: 'Mailbox for this reply could not be resolved.' });
  }

  // Threading chain — same construction as the portal endpoint.
  const inReplyTo = reply.message_id || null;
  const refsParts = [
    reply.references_header || '',
    reply.message_id || '',
  ].filter(Boolean).join(' ').trim() || null;

  // Subject — prefix "Re: " unless the inbound is already a reply.
  const inboundSubject = reply.subject || '';
  const replySubject = /^re:/i.test(inboundSubject)
    ? inboundSubject
    : `Re: ${inboundSubject || '(no subject)'}`;

  // From-name resolution (operator confirmed: use customer's default_from_name).
  // Fallbacks keep this never-empty so the SES envelope is always well-formed.
  const fromName  = (reply.client_default_from_name && reply.client_default_from_name.trim())
                  || reply.client_name
                  || 'Reply';
  const fromEmail = reply.mailbox_address;

  // Plain → HTML body wrapper, same escaping as the portal version.
  const htmlBody = `<div>${bodyText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')}</div>`;

  // Persist the outbound row before SES runs. If SES throws we update with
  // error; on success we stamp the MessageId. Either way the body is never lost.
  const outboundId = `eo_${uuid()}`;
  db.prepare(`
    INSERT INTO email_outbound (
      id, email_client_id, in_reply_to_reply_id, client_user_id,
      from_address, to_address, cc_address, subject,
      body_text, body_html,
      message_id, in_reply_to_header, references_header
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    outboundId,
    reply.email_client_id,
    reply.id,
    null,                       // client_user_id — admin send, no portal user
    fromEmail,
    reply.from_address,
    ccText || null,
    replySubject,
    bodyText,
    htmlBody,
    null,
    inReplyTo,
    refsParts,
  );

  try {
    const { messageId } = await sendEmail({
      to:        reply.from_address,
      toName:    reply.from_name || null,
      fromName,
      fromEmail,
      replyTo:   fromEmail,
      subject:   replySubject,
      htmlBody,
      plainBody: bodyText,
      // 1:1 reply — no campaign tracking.
      track_opens:  false,
      track_clicks: false,
      track_unsub:  false,
      // Threading.
      inReplyTo,
      references: refsParts,
    });

    db.prepare(`UPDATE email_outbound SET message_id = ? WHERE id = ?`)
      .run(messageId || null, outboundId);

    // Audit-log the action for parity with the portal side's behaviour.
    db.prepare(`INSERT INTO email_audit_log (id, actor, action, target_type, target_id, reply_id, metadata)
                VALUES (?, 'admin', 'reply_sent', 'reply', ?, ?, ?)`)
      .run(
        uuid(),
        req.params.id,
        req.params.id,
        JSON.stringify({
          outbound_id: outboundId,
          to: reply.from_address,
          from: fromEmail,
        }),
      );

    res.json({ ok: true, message_id: messageId, outbound_id: outboundId });
  } catch (err) {
    console.error(`[admin] reply send failed for ${req.params.id}:`, err.message);
    db.prepare(`UPDATE email_outbound SET error = ? WHERE id = ?`)
      .run(err.message.slice(0, 500), outboundId);
    res.status(502).json({ error: `Send failed: ${err.message}` });
  }
});

// GET /api/email/audit-log — recent actions, optionally filtered
router.get('/audit-log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = db.prepare(`SELECT * FROM email_audit_log ORDER BY created_at DESC LIMIT ?`).all(limit);
  for (const r of rows) {
    if (r.metadata) {
      try { r.metadata = JSON.parse(r.metadata); } catch {}
    }
  }
  res.json(rows);
});
