/**
 * SES email sender — bypasses AWS SDK entirely.
 * Makes raw HTTPS POST directly to SES API, signed with AWS Signature V4.
 * This is exactly how Sendy works (class.amazonses.php) and avoids the SDK
 * middleware that attaches account-level default configuration sets,
 * which cause AWS to inject the awstrack.me tracking pixel.
 *
 * Tracking is injected BEFORE handing to SES, so opens/clicks point to our
 * own domain — same approach as Sendy.
 */

import https from 'https';
import crypto from 'crypto';
import db from '../db.js';
import { v4 as uuid } from 'uuid';
import { applyTracking } from './tracking.js';
import { getTouchCountsBulk, shouldTrackRecipient } from './touch-count.js';
import { renderTemplate, templateUsesFirstName } from './name-parser.js';
import { SESClient, GetSendQuotaCommand, ListIdentitiesCommand, GetIdentityVerificationAttributesCommand } from '@aws-sdk/client-ses';

const REGION  = process.env.AWS_SES_REGION || 'eu-north-1';
const HOST    = `email.${REGION}.amazonaws.com`;
const AK      = process.env.AWS_ACCESS_KEY_ID;
const SK      = process.env.AWS_SECRET_ACCESS_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── AWS Signature V4 ──────────────────────────────────────────────────────────
// IMPORTANT: when chaining HMACs, keep keys as Buffers — never digest('binary')
// and pass the resulting string back in. Node converts that string to UTF-8 when
// used as a key, which silently corrupts any byte ≥ 0x80, so signing fails
// roughly half the time depending on the secret. digest() with no arg returns
// a Buffer that round-trips correctly.
function hmacBuf(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}
function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function sign(date, region, service, secret) {
  const k1 = hmacBuf('AWS4' + secret, date);
  const k2 = hmacBuf(k1, region);
  const k3 = hmacBuf(k2, service);
  return hmacBuf(k3, 'aws4_request');
}

function buildAuthHeader(body) {
  const now      = new Date();
  const amzDate  = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date     = amzDate.slice(0, 8);
  const payHash  = crypto.createHash('sha256').update(body).digest('hex');

  const canonHeaders  = `content-type:application/x-www-form-urlencoded\nhost:${HOST}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonReq      = ['POST', '/', '', canonHeaders, signedHeaders, payHash].join('\n');

  const credScope  = `${date}/${REGION}/email/aws4_request`;
  const strToSign  = ['AWS4-HMAC-SHA256', amzDate, credScope, crypto.createHash('sha256').update(canonReq).digest('hex')].join('\n');
  const signingKey = sign(date, REGION, 'email', SK);
  const signature  = hmacHex(signingKey, strToSign);

  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${AK}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date':  amzDate,
  };
}

// ── Raw HTTPS POST to SES API ─────────────────────────────────────────────────
function sesRequest(params) {
  return new Promise((resolve, reject) => {
    // Sort params alphabetically — required for correct AWS Signature V4 (Sendy does ksort)
    const sorted = Object.keys(params).sort().reduce((acc, k) => { acc[k] = params[k]; return acc; }, {});
    const body   = new URLSearchParams(sorted).toString();
    const authHdr = buildAuthHeader(body);

    const options = {
      hostname: HOST,
      port:     443,
      path:     '/',
      method:   'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'host':         HOST,
        ...authHdr,
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`SES error ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Extract MessageId from SES XML response ───────────────────────────────────
function extractMessageId(xml) {
  const m = xml && xml.match(/<MessageId>([^<]+)<\/MessageId>/);
  return m ? m[1] : null;
}

// ── Build raw MIME email ──────────────────────────────────────────────────────
// inReplyTo and references support email threading. When the customer portal
// replies to a received message, we set:
//   In-Reply-To: <message-id-of-the-reply-they're-answering>
//   References: <chain of message-ids in the thread>
// Both are optional — undefined means a fresh standalone email (existing
// behaviour). Most call sites don't need them; only the portal reply route does.
// attachments — optional array of { filename, contentType, content } where
// content is a Buffer. When absent or empty the message structure is byte-for-byte
// what it always was (multipart/alternative at the top level), so campaign and
// portal sends are completely unaffected. When present, the message becomes
// multipart/mixed wrapping the existing multipart/alternative, per RFC 2046.
function buildRawEmail({ to, toName, cc, fromName, fromEmail, replyTo, subject, htmlBody, plainBody, listUnsubUrl, inReplyTo, references, attachments = [] }) {
  const boundary   = `b_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const toAddress  = toName ? `${toName} <${to}>` : to;
  const plain      = plainBody || htmlToPlain(htmlBody);
  const subjEnc    = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;

  // Wrap the body fragment with a minimal HTML shell + CSS that normalises
  // paragraph spacing. Why: the rich-text editor saves <p>...</p> blocks for
  // every line, and browsers' default <p> margin is ~1em top + ~1em bottom.
  // When the user adds a "blank line" by pressing Enter twice, the saved HTML
  // becomes <p>...</p><p><br></p><p>...</p> — three paragraphs with margins
  // between them, rendering in Outlook/Gmail as ~3 visual line breaks instead
  // of 1. The CSS below resets paragraph margins to a sensible 1em-bottom
  // (one blank line between paragraphs) and hides empty <p> placeholders.
  // Result: what you see in the editor matches what the recipient sees.
  const wrappedHtml = wrapBodyWithEmailCss(htmlBody);

  // Cc — optional, and omitted entirely when absent so every existing call site
  // produces a byte-identical message to before.
  //
  // We call SendRawEmail without explicit Destinations, so SES takes the
  // recipient list from the headers themselves. Adding a Cc header is therefore
  // enough to actually deliver a copy — no change needed at the API layer.
  //
  // Accepts a string or an array; multiple addresses are comma-joined per
  // RFC 5322.
  const ccList = (Array.isArray(cc) ? cc : (cc ? [cc] : []))
    .map(a => String(a || '').trim())
    .filter(Boolean);

  const headers = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${toAddress}`,
    ...(ccList.length ? [`Cc: ${ccList.join(', ')}`] : []),
    `Reply-To: ${replyTo || fromEmail}`,
    `Subject: ${subjEnc}`,
    `MIME-Version: 1.0`,
  ];

  // Force SES to use a specific configuration set, overriding any account default.
  // Set SES_CONFIGURATION_SET env var to the name of a config set with NO open-
  // tracking event destination (e.g. "studio-no-tracking") — this is the only
  // deterministic way to stop the awstrack.me pixel injection. Without this,
  // SES applies whatever default config set is set on the account/identity.
  const configSet = process.env.SES_CONFIGURATION_SET;
  if (configSet) {
    headers.push(`X-SES-CONFIGURATION-SET: ${configSet}`);
  }

  // List-Unsubscribe headers (RFC 2369 + RFC 8058) — Gmail/Outlook deliverability win.
  // Only added when we have a campaign-bound unsubscribe URL.
  if (listUnsubUrl) {
    headers.push(`List-Unsubscribe: <${listUnsubUrl}>`);
    headers.push(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
  }

  // Threading headers — used when this message is a reply to an existing thread.
  // Message ids must be wrapped in angle brackets per RFC 5322. We accept ids
  // either bare ("abc@example.com") or already-bracketed ("<abc@example.com>")
  // and normalise to the bracketed form.
  function normaliseId(id) {
    if (!id) return null;
    const trimmed = String(id).trim();
    if (!trimmed) return null;
    return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`;
  }
  const irt = normaliseId(inReplyTo);
  if (irt) headers.push(`In-Reply-To: ${irt}`);
  if (references) {
    // References is a space-separated chain of message ids. The caller can
    // pass either a single id or a pre-built chain. We split on whitespace,
    // normalise each, and rejoin.
    const chain = String(references).split(/\s+/).map(normaliseId).filter(Boolean).join(' ');
    if (chain) headers.push(`References: ${chain}`);
  }

  const files = (Array.isArray(attachments) ? attachments : []).filter(
    a => a && a.filename && a.content && a.content.length,
  );
  const hasFiles = files.length > 0;
  const mixedBoundary = `m_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  headers.push(
    hasFiles
      ? `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`
      : `Content-Type: multipart/alternative; boundary="${boundary}"`,
  );

  // Encode bodies as base64 with hard line wraps at 76 chars (RFC 2045).
  // Previously declared quoted-printable but didn't actually QP-encode, which
  // caused recipient clients (or relays) to interpret literal '=' chars in
  // tracking URLs as QP escape sequences — corrupting hrefs and styles.
  // base64 is the safest choice for HTML containing arbitrary URLs and styles.
  const htmlB64  = Buffer.from(wrappedHtml, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const plainB64 = Buffer.from(plain,       'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

  // The alternative part is identical in both cases — it just sits one level
  // deeper when there are attachments.
  const alternative = [
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    plainB64,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    htmlB64,
    ``,
    `--${boundary}--`,
  ];

  if (!hasFiles) {
    return [...headers, ``, ...alternative].join('\r\n');
  }

  const fileParts = files.flatMap((f) => {
    // RFC 2045 caps encoded lines at 76 chars. A 4MB PDF is ~5.6MB encoded, so
    // this wrap matters: unwrapped base64 is rejected outright by some relays.
    const b64 = f.content.toString('base64').replace(/(.{76})/g, '$1\r\n');
    // Filenames: a plain ASCII name goes out as-is, which is what every client
    // handles correctly. RFC 2047 ("=?UTF-8?B?...?=") is NOT valid in a filename
    // parameter — clients that follow the spec display the encoded string
    // verbatim as the attachment name. Non-ASCII uses RFC 2231 instead, which
    // is the mechanism actually defined for parameter values.
    const name = String(f.filename);
    const asciiSafe = /^[\x20-\x7E]*$/.test(name) && !/["\\]/.test(name);
    const nameParam = asciiSafe
      ? `filename="${name}"`
      : `filename*=UTF-8''${encodeURIComponent(name)}`;
    return [
      `--${mixedBoundary}`,
      `Content-Type: ${f.contentType || 'application/octet-stream'}`,
      `Content-Disposition: attachment; ${nameParam}`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64,
      ``,
    ];
  });

  return [
    ...headers,
    ``,
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    ...alternative,
    ``,
    ...fileParts,
    `--${mixedBoundary}--`,
  ].join('\r\n');
}

// ── Send a single email — raw SES API, no SDK middleware ─────────────────────
// Tracking is per-signal opt-in via track_opens / track_clicks / track_unsub.
// listUnsubUrl is added to MIME headers only when track_unsub is true.
// Returns { messageId } — used by sendCampaign to map bounces/complaints back.
//
// inReplyTo / references — optional, used by the customer-portal reply route
// to thread outbound messages with the inbound message they're answering.
// cc — optional. Added for WorkTrackr service emails, which always copy a
// second internal address. Defaults to null, so campaign and portal sends are
// unaffected.
export async function sendEmail({
  to, toName, cc = null, fromName, fromEmail, replyTo, subject, htmlBody, plainBody,
  campaignId, subscriberId, baseUrl,
  track_opens = false, track_clicks = false, track_unsub = false,
  inReplyTo = null, references = null, attachments = [],
}) {
  let finalHtml = htmlBody;
  let listUnsubUrl = null;

  // Tracking is only ever applied when we have campaign + subscriber context
  // (rules out test sends), AND at least one signal is requested.
  const wantsTracking = (track_opens || track_clicks || track_unsub);
  if (campaignId && subscriberId && baseUrl && wantsTracking) {
    finalHtml = applyTracking(htmlBody, {
      baseUrl, campaignId, subscriberId,
      track_opens, track_clicks, track_unsub,
    });
    if (track_unsub) {
      listUnsubUrl = `${baseUrl}/api/email/unsubscribe?sid=${subscriberId}&cid=${campaignId}`;
    }
  }

  const raw = buildRawEmail({
    to, toName, cc, fromName, fromEmail, replyTo, subject,
    htmlBody: finalHtml, plainBody, listUnsubUrl,
    inReplyTo, references, attachments,
  });

  const xml = await sesRequest({
    Action:            'SendRawEmail',
    'RawMessage.Data': Buffer.from(raw).toString('base64'),
  });

  return { messageId: extractMessageId(xml) };
}

// ── Send a campaign ───────────────────────────────────────────────────────────
// Decides per-recipient whether to apply tracking based on the campaign's
// tracking_mode + tracking_threshold + tracking_window settings, plus the
// list's always_warm flag. See touch-count.js for the rules.
//
// Writes one email_sends row per subscriber AT SEND TIME, capturing the
// SES MessageId — this is what makes SNS bounce/complaint webhooks work.
//
// stepNumber (Phase 4): which step in a multi-step sequence this send is for.
//   Default 1 — backwards compatible with all existing call sites.
// bodyOverride (Phase 4): if provided, used as the html body INSTEAD of
//   campaign.html_body. Used by the drip ticker when sending follow-up steps
//   whose body lives in email_campaign_steps.
// subjectOverride (Phase 4): if provided, used as the subject INSTEAD of
//   campaign.subject. Per-step subjects ("Re: my last note", etc.) live on
//   email_campaign_steps.subject; the drip ticker passes them through here.
//   Pass null (default) to keep campaign-wide subject behaviour.
export async function sendCampaign({ campaign, subscribers, baseUrl, alwaysWarm = false, onProgress, stepNumber = 1, bodyOverride = null, subjectOverride = null }) {
  const results = { sent: 0, failed: 0, skipped: 0, errors: [], tracked: 0, untracked: 0 };
  const BATCH_SIZE = 10;
  const DELAY_MS   = 800;

  // Pre-compute touch counts in one query — avoids N+1 when sending to thousands
  const window = campaign.tracking_window ?? 6;
  const touchCounts = getTouchCountsBulk(subscribers.map(s => s.id), window);

  const mode      = campaign.tracking_mode || 'off';
  const threshold = campaign.tracking_threshold || 3;
  const flags = {
    track_opens:  !!campaign.track_opens,
    track_clicks: !!campaign.track_clicks,
    track_unsub:  !!campaign.track_unsub,
  };

  const insertSend = db.prepare(`INSERT INTO email_sends
    (id, campaign_id, subscriber_id, message_id, status, sent_at, step_number, tracked)
    VALUES (?, ?, ?, ?, 'sent', datetime('now'), ?, ?)`);

  const markFailed = db.prepare(`INSERT INTO email_sends
    (id, campaign_id, subscriber_id, status, sent_at, step_number)
    VALUES (?, ?, ?, 'failed', datetime('now'), ?)`);

  // Status checker — runs between batches. Returns one of:
  //   'continue' → keep sending
  //   'pause'    → wait until status flips back to 'sending'
  //   'stop'     → exit the send loop entirely
  // Used so the user can pause or cancel a campaign mid-send.
  const checkStatus = db.prepare("SELECT status FROM email_campaigns WHERE id=?");
  async function statusGate() {
    while (true) {
      const row = checkStatus.get(campaign.id);
      if (!row) return 'stop';                       // campaign deleted
      if (row.status === 'cancelled') return 'stop'; // user cancelled
      if (row.status === 'paused')   { await sleep(5000); continue; }  // wait, then re-check
      return 'continue';
    }
  }

  // Body for THIS send call. For step 1 (or any non-step-aware send) it's the
  // campaign's html_body. For follow-up steps the ticker passes the step body in.
  const effectiveHtmlBody = bodyOverride !== null ? bodyOverride : campaign.html_body;
  // Subject for THIS send call. Follow-ups can override per-step.
  const effectiveSubject  = subjectOverride !== null ? subjectOverride : campaign.subject;
  // Detect whether this body uses {{first_name}} anywhere — if it doesn't,
  // we don't need to skip subscribers with no parsed first name.
  const usesFirstName = templateUsesFirstName(
    effectiveSubject, effectiveHtmlBody, campaign.plain_body
  );

  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    // Check pause/cancel before each batch
    const gate = await statusGate();
    if (gate === 'stop') break;

    const batch = subscribers.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async sub => {
      try {
        // Skip if the template needs a first name and this subscriber has none.
        // This shouldn't happen in practice — the route filters them out before
        // calling sendCampaign — but it's a belt-and-braces check.
        if (usesFirstName && !sub.first_name) {
          results.skipped = (results.skipped || 0) + 1;
          return;
        }

        const firstName = sub.first_name || '';
        const subject   = renderTemplate(effectiveSubject,    firstName);
        const htmlBody  = renderTemplate(effectiveHtmlBody,   firstName);
        const plainBody = renderTemplate(campaign.plain_body || htmlToPlain(effectiveHtmlBody || ''), firstName);

        // Decide whether to track this specific recipient
        const touchCount = touchCounts.get(sub.id) || 0;
        const trackThis = shouldTrackRecipient({ mode, threshold, touchCount, alwaysWarm });

        const { messageId } = await sendEmail({
          to:          sub.email,
          toName:      sub.name,
          fromName:    campaign.from_name,
          fromEmail:   campaign.from_email,
          replyTo:     campaign.reply_to,
          subject,
          htmlBody,
          plainBody,
          campaignId:    campaign.id,
          subscriberId:  sub.id,
          baseUrl,
          // If trackThis is false, all three flags collapse to false → clean send.
          // If true, the campaign's own flags decide which signals to inject.
          track_opens:  trackThis && flags.track_opens,
          track_clicks: trackThis && flags.track_clicks,
          track_unsub:  trackThis && flags.track_unsub,
        });

        insertSend.run(uuid(), campaign.id, sub.id, messageId, stepNumber, trackThis ? 1 : 0);
        results.sent++;
        if (trackThis) results.tracked++; else results.untracked++;
      } catch (err) {
        try { markFailed.run(uuid(), campaign.id, sub.id, stepNumber); } catch {}
        results.failed++;
        results.errors.push({ email: sub.email, error: err.message });
      }
    }));
    if (onProgress) onProgress(Math.round(((i + batch.length) / subscribers.length) * 100));
    if (i + BATCH_SIZE < subscribers.length) await sleep(DELAY_MS);
  }
  return results;
}

// ── SDK still used for read-only queries (quota, verified domains) ────────────
const sdkClient = new SESClient({
  region: REGION,
  credentials: { accessKeyId: AK, secretAccessKey: SK },
});

export async function getQuota() {
  const data = await sdkClient.send(new GetSendQuotaCommand({}));
  return { max24HourSend: data.Max24HourSend, maxSendRate: data.MaxSendRate, sentLast24Hours: data.SentLast24Hours };
}

export async function getVerifiedDomains() {
  const listData = await sdkClient.send(new ListIdentitiesCommand({ IdentityType: 'Domain', MaxItems: 100 }));
  const identities = listData.Identities || [];
  if (!identities.length) return [];
  const attrData = await sdkClient.send(new GetIdentityVerificationAttributesCommand({ Identities: identities }));
  const attrs = attrData.VerificationAttributes || {};
  return identities.filter(id => attrs[id]?.VerificationStatus === 'Success').sort();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Wrap a body fragment from the rich-text editor with the minimal HTML shell
// every email client expects, plus a tiny CSS reset that fixes paragraph
// spacing. Without this the recipient sees ~3x the line spacing the user typed
// because browsers' default <p> margins (1em top + 1em bottom = ~28px each)
// stack between every paragraph and around every empty <p><br></p> placeholder.
//
// Notes:
//   • Idempotent: if the body already has <html>/<body> tags (legacy or AI-
//     generated), we don't double-wrap. We just inject the <style> into <head>.
//   • Safe with both base64 transport AND with tracking pixel/link injection:
//     applyTracking() in tracking.js operates on the raw string, and we wrap
//     here AFTER tracking has been applied (in sendEmail caller order).
function wrapBodyWithEmailCss(body) {
  if (!body) return '';
  // Defaults match the RichTextEditor (Verdana 12). When the operator changes
  // font/size in the editor, those choices are emitted as inline span styles
  // and override these CSS defaults — so the recipient sees exactly what the
  // editor previewed. Outlook quirks (default p margins) are normalised by
  // the p { margin: 0 } rule.
  const css = `
    body { margin: 0; padding: 0; line-height: 1.4; font-family: Verdana, Geneva, sans-serif; font-size: 12px; color: #1a1a1a; }
    p { margin: 0; }
    p:empty { min-height: 1em; }
    p:has(> br:only-child) { min-height: 1em; }
    ul, ol { margin: 0 0 1em 1.5em; padding: 0; }
    li { margin: 0 0 0.25em 0; }
    a { color: #185FA5; }
  `.trim();

  // If the body already looks like a full document, just slot the CSS into <head>.
  if (/<html[\s>]/i.test(body)) {
    if (/<head[\s>]/i.test(body)) {
      return body.replace(/<head([^>]*)>/i, `<head$1><style>${css}</style>`);
    }
    return body.replace(/<html([^>]*)>/i, `<html$1><head><style>${css}</style></head>`);
  }

  // Otherwise wrap the fragment.
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}</body></html>`;
}

function htmlToPlain(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
