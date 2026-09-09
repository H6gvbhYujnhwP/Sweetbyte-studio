/**
 * server/routes/service-email-api.js — API surface for WorkTrackr service emails.
 *
 * Mounted at /api/service-emails in server/index.js.
 *
 * AUTH IS PER-ROUTE, NOT ROUTER-WIDE. Everything WorkTrackr calls is signed
 * with an HMAC; the unsubscribe landing page has to be reachable by a stranger
 * clicking a link in an email, so it carries no auth at all. A `router.use()`
 * would have locked the recipient out of their own opt-out, which is the one
 * thing that must never break.
 *
 * SIGNING (same shape as the Studio↔IDYQ bridge, different secret):
 *   payload = "<expiryUnixSeconds>.<nonce>.<METHOD>.<PATH>"
 *   sig     = HMAC-SHA256(WORKTRACKR_SERVICE_EMAIL_SECRET, payload) hex
 *   header  = X-WT-Signature: <expiry>.<nonce>.<sig>
 *
 * PATH is the path as mounted here (e.g. "/send"), not the full URL.
 *
 * The nonce isn't tracked, matching the existing bridge. Within the ~120s
 * window a replayed /send would normally duplicate an email — the dedupe rule
 * in service-email-sender.js catches it, because the second attempt finds the
 * already sent to that address and is rejected. Worth knowing rather than
 * assuming; if this ever guards something without its own idempotency, add a
 * seen-nonce table.
 *
 * Env:
 *   WORKTRACKR_SERVICE_EMAIL_SECRET  (required) long random hex, shared with
 *                                    WorkTrackr. Separate from IDYQ_BRIDGE_SECRET
 *                                    and from WORKTRACKR_BRIDGE_SECRET.
 *   SERVICE_EMAIL_FROM               default billy@sweetbyte.co.uk
 *   SERVICE_EMAIL_FROM_NAME          default "Billy — Sweetbyte"
 *   SERVICE_EMAIL_CC                 default westley@sweetbyte.co.uk
 *   SERVICE_EMAIL_UNDO_SECONDS       default 10
 *   SERVICE_EMAIL_FOLLOWUP_DAYS      default 7
 *   SWEETBYTE_EMAIL_CLIENT_ID        optional — mirrors opt-outs into the
 *                                    campaign-side suppression table
 *   PUBLIC_URL                       origin for unsubscribe links
 */

import { Router } from 'express';
import crypto from 'crypto';
import {
  queueServiceEmail,
  cancelSend,
  cancelPendingForCompany,
  historyForCompany,
  sentServiceKeys,
  isSuppressed,
  unsubscribe,
  verifyUnsubToken,
} from '../services/service-email-sender.js';
import { getCatalogue } from '../services/service-email-templates.js';
import { applyStages } from '../services/keepwarm-store.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// HMAC verification
// ─────────────────────────────────────────────────────────────────────────────

function requireBridgeAuth(req, res, next) {
  const secret = process.env.WORKTRACKR_SERVICE_EMAIL_SECRET;
  if (!secret) {
    return res.status(500).json({
      error: 'WORKTRACKR_SERVICE_EMAIL_SECRET not set on Studio',
    });
  }

  const header = req.get('X-WT-Signature') || '';
  const parts = header.split('.');
  if (parts.length !== 3) {
    return res.status(401).json({ error: 'Malformed signature' });
  }

  const [expiry, nonce, sig] = parts;
  const expiryNum = Number(expiry);
  if (!Number.isFinite(expiryNum) || expiryNum < Math.floor(Date.now() / 1000)) {
    return res.status(401).json({ error: 'Signature expired' });
  }

  // req.baseUrl is the mount point, req.path the route within it. Signing the
  // route path alone keeps the contract stable if the mount point ever moves.
  const payload  = `${expiry}.${nonce}.${req.method}.${req.path}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Bad signature' });
  }

  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridge endpoints — called by WorkTrackr, server to server
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/service-emails/catalogue
 * The service list for WorkTrackr's chip grid. Served rather than duplicated so
 * adding a service is a one-app change.
 */
router.get('/catalogue', requireBridgeAuth, (req, res) => {
  res.json({ services: getCatalogue() });
});

/**
 * POST /api/service-emails/send
 * Body: { externalCompanyId, companyName, contactName, spokeTo, referrerName,
 *         toEmail, services: [key] }
 *
 * `spokeTo` is 'them' | 'someone_else' | 'nobody' and decides the email's
 * opening. It is optional on the wire: an older WorkTrackr omits it, and the
 * sender falls back to the previous referrer-name inference for those.
 *
 * Queues rather than sends: the row sits for the undo window first. A 409 means
 * the request was understood and deliberately not actioned — every one of those
 * reasons is something the sender needs to see, not a failure to retry.
 */
router.post('/send', requireBridgeAuth, (req, res) => {
  const {
    externalCompanyId, companyName, contactName,
    referrerName, spokeTo, toEmail, services,
  } = req.body || {};

  const result = queueServiceEmail({
    externalCompanyId, companyName, contactName,
    referrerName, spokeTo, toEmail, services,
  });

  if (!result.ok) {
    return res.status(409).json({
      error: result.reason,
      already: result.already || undefined,
      invalid: result.invalid || undefined,
    });
  }

  res.json({
    id: result.id,
    services: result.services,
    skipped: result.skipped,
    sendAfter: result.sendAfter,
  });
});

/**
 * POST /api/service-emails/cancel
 * Body: { id }
 * The undo button. Returns 409 once the send has been claimed — at that point
 * the email is with SES and cannot be recalled.
 */
router.post('/cancel', requireBridgeAuth, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  const result = cancelSend(id);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json({ ok: true });
});

/**
 * POST /api/service-emails/cancel-followups
 * Body: { externalCompanyId, reason? }
 * Fired by WorkTrackr when a company moves to dead or customer.
 */
router.post('/cancel-followups', requireBridgeAuth, (req, res) => {
  const { externalCompanyId, reason } = req.body || {};
  if (!externalCompanyId) return res.status(400).json({ error: 'externalCompanyId required' });

  const result = cancelPendingForCompany(externalCompanyId, reason || 'stage change');
  res.json(result);
});

/**
 * GET /api/service-emails/status?externalCompanyId=…&email=…
 * Send history for a company, plus the services already used against a given
 * address. WorkTrackr keeps its own mirror for rendering speed; this is the
 * authoritative view for reconciliation.
 */
router.get('/status', requireBridgeAuth, (req, res) => {
  const { externalCompanyId, email } = req.query || {};
  if (!externalCompanyId) return res.status(400).json({ error: 'externalCompanyId required' });

  res.json({
    history: historyForCompany(externalCompanyId),
    sentServices: email ? sentServiceKeys(externalCompanyId, email) : [],
    suppressed: email ? isSuppressed(email) : false,
  });
});

/**
 * POST /api/service-emails/stages
 * Body: { companies: [{ id, name, primaryContact, stage }], snapshot: bool, reason }
 *
 * WorkTrackr telling Studio what the sales stages are. Studio's keep-warm
 * emails go to everyone who has had the introduction EXCEPT those at excluded
 * stages, and the stage is the one thing Studio cannot work out for itself.
 *
 * Lives on THIS router rather than a new one so it rides the connection that
 * already works — same secret, same signing, same base URL WorkTrackr has had
 * configured since the send panel shipped. A separate bridge would have meant
 * new credentials on two more services for no gain.
 *
 * `snapshot: true` means the payload is the complete set; anything Studio holds
 * that is absent has its stage cleared, so a company deleted in WorkTrackr stops
 * being emailed rather than keeping the stage it had on the day it vanished.
 * A single-company push must NOT set it.
 *
 * Returns what was applied rather than a bare ok, so the WorkTrackr log records
 * a number somebody can sanity-check against the pipeline.
 */
router.post('/stages', requireBridgeAuth, (req, res) => {
  const { companies, snapshot } = req.body || {};
  if (!Array.isArray(companies)) {
    return res.status(400).json({ error: 'companies must be an array' });
  }

  try {
    const result = applyStages({ companies, snapshot: !!snapshot });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[service-email] stage apply failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Public — the recipient's opt-out. No auth by design.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/service-emails/unsubscribe?e=<email>&t=<token>
 *
 * The token is an HMAC of the address, so the link can't be edited to opt out
 * somebody else. On success the address is suppressed platform-wide and any
 * queued follow-up is cancelled on the spot.
 */
router.get('/unsubscribe', (req, res) => {
  const { e, t } = req.query || {};

  const page = (title, body) => `<!doctype html>
    <html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#fafafa;
           margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
      .box{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:32px 40px;
           max-width:460px;text-align:center}
      h1{font-size:20px;margin:0 0 10px}
      p{color:#6b7280;font-size:14px;line-height:1.5;margin:0}
    </style></head>
    <body><div class="box"><h1>${title}</h1><p>${body}</p></div></body></html>`;

  if (!e || !t || !verifyUnsubToken(e, t)) {
    return res.status(400).send(page(
      'Link not recognised',
      'This unsubscribe link is invalid or incomplete. Reply to the email and we will remove you manually.'
    ));
  }

  unsubscribe(e, 'service_email_link');

  res.send(page(
    "You've been unsubscribed",
    "We won't email you again. Anything already scheduled has been cancelled."
  ));
});

export default router;
