/**
 * service-emails.js — Studio's half of the WorkTrackr service-email bridge.
 *
 * Mounted at /api/service-emails in server/index.js.
 *
 * WorkTrackr (worktrackr.cloud) is the caller. After a cold call the
 * salesperson types the address they were given, taps the services the
 * prospect showed interest in, and taps Send. WorkTrackr signs a request and
 * hands it here. The contract is documented in SERVICE_EMAILS_INTEGRATION.md
 * at the repo root — keep the two in step, and keep both in step with
 * WorkTrackr's web/services/serviceEmailBridge.js.
 *
 * ── AUTHENTICATION ──────────────────────────────────────────────────────────
 * These routes are NOT behind Studio's admin login. They are server-to-server
 * and authenticate with an HMAC signature over a short-lived payload:
 *
 *   payload = "<expiryUnixSeconds>.<nonce>.<METHOD>.<PATH>"
 *   sig     = HMAC-SHA256(WORKTRACKR_SERVICE_EMAIL_SECRET, payload)  hex
 *   header  = X-WT-Signature: <expiry>.<nonce>.<sig>
 *
 * PATH is the path WITHIN this mount — "/catalogue", not
 * "/api/service-emails/catalogue". Method and path are inside the signature so
 * a captured signature for a harmless GET can't be replayed against POST.
 *
 * Comparison is constant-time. A missing secret is a 503 rather than a 500,
 * because an unconfigured service is a deployment state, not a crash, and the
 * distinction matters when reading logs at speed.
 *
 * ── SCOPE (Phase 1) ─────────────────────────────────────────────────────────
 * This file currently implements GET /catalogue only. WorkTrackr also calls
 * /send, /cancel, /status and /cancel-followups. Those involve sending through
 * SES, a 10-second undo window, a 7-day follow-up and a suppression list, and
 * are deliberately NOT stubbed here: a stub that returns 200 would make
 * WorkTrackr record a send in its local mirror and write a timeline note for an
 * email that never left. An honest 501 keeps the two sides truthful until the
 * real implementation lands.
 *
 * Env:
 *   WORKTRACKR_SERVICE_EMAIL_SECRET  (required) — long random hex, must match
 *                                    WorkTrackr's value of the same name.
 *                                    Separate from IDYQ_BRIDGE_SECRET and
 *                                    WORKTRACKR_BRIDGE_SECRET — different
 *                                    relationship, different secret.
 */
import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';

const router = Router();

// WorkTrackr signs 120 seconds out. We allow a little clock skew on top: two
// Render services won't have identical clocks, and rejecting a request because
// one host is three seconds fast would be a maddening intermittent bug.
const CLOCK_SKEW_SECONDS = 30;

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify the X-WT-Signature header for this request.
 *
 * `routePath` is passed explicitly rather than read from req.path so that the
 * value signed and the value verified can never drift apart through Express
 * routing quirks (trailing slashes, mount prefixes, case).
 */
function requireSignature(routePath) {
  return (req, res, next) => {
    const secret = process.env.WORKTRACKR_SERVICE_EMAIL_SECRET;
    if (!secret) {
      console.error('[service-emails] WORKTRACKR_SERVICE_EMAIL_SECRET is not set');
      return res.status(503).json({ error: 'Service email bridge not configured' });
    }

    const header = String(req.headers['x-wt-signature'] || '');
    const parts = header.split('.');
    if (parts.length !== 3) {
      return res.status(401).json({ error: 'Missing or malformed signature' });
    }

    const [expiryRaw, nonce, sig] = parts;
    const expiry = Number(expiryRaw);
    if (!Number.isFinite(expiry)) {
      return res.status(401).json({ error: 'Malformed signature' });
    }

    const now = Math.floor(Date.now() / 1000);
    if (expiry + CLOCK_SKEW_SECONDS < now) {
      return res.status(401).json({ error: 'Signature expired' });
    }
    // An expiry far in the future would widen the replay window indefinitely.
    if (expiry > now + 600) {
      return res.status(401).json({ error: 'Signature expiry out of range' });
    }
    if (!nonce || !/^[a-f0-9]{8,64}$/i.test(nonce)) {
      return res.status(401).json({ error: 'Malformed signature' });
    }

    const payload = `${expiryRaw}.${nonce}.${req.method}.${routePath}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    if (!timingSafeEqualHex(sig.toLowerCase(), expected)) {
      console.warn('[service-emails] signature mismatch on', req.method, routePath);
      return res.status(401).json({ error: 'Bad signature' });
    }

    next();
  };
}

// ── GET /catalogue ───────────────────────────────────────────────────────────
// Returns the services WorkTrackr shows as tappable chips.
//
// Shape is fixed by WorkTrackr's ServiceEmailPanel.jsx, which reads s.key and
// s.label off each entry:
//
//   { services: [ { key, label, description }, … ] }
//
// Inactive services are withheld rather than flagged: WorkTrackr renders every
// row it receives, so filtering here is what "turn a service off" means.
// Ordering is Studio's decision and is honoured as sent.
router.get('/catalogue', requireSignature('/catalogue'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT service_key, label, description
        FROM service_catalogue
       WHERE active = 1
       ORDER BY sort_order ASC, label ASC
    `).all();

    res.json({
      services: rows.map((r) => ({
        key: r.service_key,
        label: r.label,
        description: r.description || null,
      })),
    });
  } catch (err) {
    console.error('[service-emails] catalogue failed:', err.message);
    res.status(500).json({ error: 'Could not load services' });
  }
});

// ── Not yet implemented ──────────────────────────────────────────────────────
// WorkTrackr calls these. Answering 501 makes it show an honest error rather
// than recording a send that never happened. See the SCOPE note at the top.
const notYet = (name) => (req, res) => {
  console.warn(`[service-emails] ${name} called but not implemented yet`);
  res.status(501).json({ error: 'Not implemented yet in Studio' });
};

router.post('/send',             requireSignature('/send'),             notYet('send'));
router.post('/cancel',           requireSignature('/cancel'),           notYet('cancel'));
router.get('/status',            requireSignature('/status'),           notYet('status'));
router.post('/cancel-followups', requireSignature('/cancel-followups'), notYet('cancel-followups'));

export default router;
