/**
 * portal-auth.js — Customer-portal authentication routes + session middleware
 *
 * Mounted at /api/portal in server/index.js. All routes here are PUBLIC except
 * /change-password which requires a session cookie. Data routes (in portal.js)
 * use the requirePortalSession middleware exported below.
 *
 * Sessions are SQLite-backed (table: client_sessions) — survive Render restarts.
 * Idle timeout 7 days, absolute timeout 30 days. Cookie is HttpOnly, SameSite=Lax,
 * Secure in production (Render sets NODE_ENV=production automatically).
 *
 * Tokens come from crypto.randomBytes(32).toString('base64url') so they're
 * unguessable. The session token IS the cookie value AND the row id.
 *
 * Brute-force protection:
 *   - 10 failed login attempts within a 15-min window per (email_client_id,
 *     username) → locks for 15 minutes.
 *   - Generic error on failure: don't leak whether the username or password
 *     was wrong, OR whether the user exists at all.
 *
 * Logout scope (per locked-in pre-decisions):
 *   - Logout: kills CURRENT session only.
 *   - Change-password (signed in): kills all OTHER sessions, keeps current.
 *   - Reset-password (via email link): kills ALL sessions including any new
 *     one. User has to sign in fresh after reset.
 */
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import db from '../db.js';
import { sendEmail } from '../services/ses.js';

const router = Router();

// ─── Constants ────────────────────────────────────────────────────────────────
const SESSION_COOKIE  = 'portal_session';
const BCRYPT_COST     = 12;                          // ≥12 per spec
const IDLE_DAYS       = 7;                           // bump expires_at this far on every check
const ABSOLUTE_DAYS   = 30;                          // hard cap from session created_at
const RESET_TTL_HOURS = 1;                           // password-reset link lifetime
const LOCKOUT_WINDOW_MIN  = 15;                      // attempts window
const LOCKOUT_THRESHOLD   = 10;                      // failures inside window → lock
const LOCKOUT_DURATION_MIN = 15;                     // length of lockout
const PASSWORD_RESET_FROM = 'studio@thegreenagents.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** crypto-secure random token, 32 bytes → 43-char base64url string. */
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** SQLite ISO-ish timestamp helper. SQLite returns 'YYYY-MM-DD HH:MM:SS' UTC. */
function nowSql() {
  return db.prepare(`SELECT datetime('now') AS t`).get().t;
}
function sqlPlusDays(days) {
  return db.prepare(`SELECT datetime('now', ?) AS t`).get(`+${days} days`).t;
}
function sqlMinusMinutes(min) {
  return db.prepare(`SELECT datetime('now', ?) AS t`).get(`-${min} minutes`).t;
}
function sqlPlusHours(hours) {
  return db.prepare(`SELECT datetime('now', ?) AS t`).get(`+${hours} hours`).t;
}

/**
 * Build the public services object describing what this customer is subscribed
 * to. Three states per service:
 *   'enabled'      — show the tab's real data
 *   'not_required' — show "Not required — this service isn't part of your
 *                    current plan." (per Wez's locked-in copy)
 *   'coming_soon'  — service exists in code but isn't live yet (e.g. Facebook).
 *
 * Driven by the `services` catalogue + `customer_services` join table — adding
 * a new service is a row in `services`, no code change needed here. The output
 * is always keyed by service.service_key so the frontend can do `services.email`
 * etc. and still get the right answer.
 *
 * State logic, in order:
 *   1. If services.state = 'coming_soon'   → 'coming_soon'   (regardless of subscription)
 *   2. Else if customer_services row exists → 'enabled'
 *   3. Else                                  → 'not_required'
 */
function buildServicesObject(clientId) {
  const rows = db.prepare(`
    SELECT s.service_key, s.state, s.display_name, s.customer_pitch,
           CASE WHEN cs.email_client_id IS NULL THEN 0 ELSE 1 END AS subscribed
    FROM services s
    LEFT JOIN customer_services cs
      ON cs.service_key = s.service_key AND cs.email_client_id = ?
    WHERE s.state != 'retired'
    ORDER BY s.sort_order ASC
  `).all(clientId);

  // Each entry is now an object with {state, label, pitch} so the customer
  // portal can render service-specific sales copy on gated screens. The
  // shape change is backward-compatible: PortalApp.jsx reads svc.linkedin
  // and similar — when reading the legacy string format it's a single value;
  // now reading svc.linkedin.state. Whoever updates the frontend at the same
  // time as this change has to flip the read sites — which we are.
  const out = {};
  for (const r of rows) {
    let state;
    if (r.state === 'coming_soon')   state = 'coming_soon';
    else if (r.subscribed)           state = 'enabled';
    else                             state = 'not_required';
    out[r.service_key] = {
      state,
      label: r.display_name,
      pitch: r.customer_pitch || null,
    };
  }
  return out;
}

/**
 * Public projection of a client_users row — the bits safe to send to the
 * browser. Never includes password_hash. `must_change_password` triggers the
 * "Your password is temporary — please change it" banner on the frontend
 * (true on a first sign-in where last_login_at is NULL).
 */
function projectUser(row) {
  return {
    id:       row.id,
    username: row.username,
    email:    row.email,
    role:     row.role,
    must_change_password: row.last_login_at == null,
  };
}

/** Public projection of an email_clients row — branding bits + slug. */
function projectClient(row) {
  return {
    id:           row.id,
    slug:         row.slug,
    name:         row.name,
    color:        row.color,
    logo_url:     row.logo_url || null,
    logo_initial: (row.name || '?').trim().slice(0, 2).toUpperCase(),
    logo_color:   row.color,
  };
}

/**
 * Set the HttpOnly session cookie. Same options on every set so logout's
 * clearCookie() actually targets the right cookie. SameSite=Lax means the
 * cookie travels with same-site navigations and form posts but not third-party
 * embeds — fine for this product. Secure when NODE_ENV is production.
 */
function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
    // Session lifetime in the cookie itself = absolute cap. The DB row's
    // expires_at handles the idle timeout. If the cookie outlives the DB
    // row, the session check just fails and the user re-logs.
    maxAge:   ABSOLUTE_DAYS * 24 * 60 * 60 * 1000,
  };
}

/**
 * Read the session token from cookies. We don't use cookie-parser (no new
 * deps) — just split the raw Cookie header. Fine for one cookie name.
 */
function readSessionCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

/**
 * Look up a session, validate idle + absolute timeouts, bump expires_at if OK.
 * Returns { user, client } on success or null on failure (expired, revoked,
 * or never existed). Failure also deletes the row defensively so the table
 * doesn't grow unbounded — lazy cleanup, no cron required.
 */
function resolveSession(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.id, s.client_user_id, s.expires_at, s.created_at,
           u.id AS user_id, u.username, u.email, u.role, u.last_login_at,
           u.email_client_id,
           c.id AS client_id, c.name, c.color, c.slug,
           c.linkedin_client_id, c.service_email_enabled
    FROM client_sessions s
    JOIN client_users    u ON u.id = s.client_user_id
    JOIN email_clients   c ON c.id = u.email_client_id
    WHERE s.id = ?
  `).get(token);

  if (!row) return null;

  // Idle check: now > expires_at → session is stale.
  // Absolute check: now > created_at + ABSOLUTE_DAYS → session is too old.
  // Both are computed in SQLite to avoid any local-clock vs. SQLite-clock skew.
  const check = db.prepare(`
    SELECT
      CASE WHEN datetime('now') > ? THEN 1 ELSE 0 END AS idle_expired,
      CASE WHEN datetime('now') > datetime(?, ?) THEN 1 ELSE 0 END AS abs_expired
  `).get(row.expires_at, row.created_at, `+${ABSOLUTE_DAYS} days`);

  if (check.idle_expired || check.abs_expired) {
    db.prepare(`DELETE FROM client_sessions WHERE id = ?`).run(token);
    return null;
  }

  // Bump idle expiry forward, but never past the absolute cap.
  // SQLite MIN() of two datetime strings works because they're ISO-ordered.
  const newExpires = db.prepare(`
    SELECT MIN(datetime('now', ?), datetime(?, ?)) AS t
  `).get(`+${IDLE_DAYS} days`, row.created_at, `+${ABSOLUTE_DAYS} days`).t;
  db.prepare(`UPDATE client_sessions SET expires_at = ? WHERE id = ?`).run(newExpires, token);

  return {
    user: {
      id: row.user_id, username: row.username, email: row.email, role: row.role,
      last_login_at: row.last_login_at,
    },
    client: {
      id: row.client_id, name: row.name, color: row.color, slug: row.slug,
      linkedin_client_id:     row.linkedin_client_id,
      service_email_enabled:  row.service_email_enabled,
    },
  };
}

/**
 * Express middleware — apply via router.use() at the top of routes/portal.js.
 * On success, attaches req.portalUser and req.portalClient.
 * On failure, returns 401 and stops the chain.
 */
export function requirePortalSession(req, res, next) {
  const token = readSessionCookie(req);
  const out = resolveSession(token);
  if (!out) return res.status(401).json({ error: 'Not signed in' });
  req.portalUser   = out.user;
  req.portalClient = out.client;
  req.portalSessionToken = token;
  next();
}

// ─── 1. GET /api/portal/by-slug/:slug ─────────────────────────────────────────
// Public — used by the login page header to show "<Customer> portal".
// Returns 404 if no client matches. Doesn't expose anything secret.
router.get('/by-slug/:slug', (req, res) => {
  const row = db.prepare(`
    SELECT name, slug FROM email_clients WHERE slug = ?
  `).get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ client_name: row.name, slug: row.slug });
});

// ─── 2. POST /api/portal/auth/login ───────────────────────────────────────────
// body: { slug, username, password }
// success: { ok: true, user, token, client, services } + sets HttpOnly cookie
// failure: 401 { error: 'Invalid credentials' }  (generic — don't leak which)
// rate-limit: 10 fails in 15 min per (email_client_id, username) → 429 lockout
router.post('/auth/login', async (req, res) => {
  const { slug = '', username = '', password = '' } = req.body || {};
  if (!slug || !username || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Resolve the slug → email_client. Use the same generic 401 if not found —
  // an attacker probing slug names shouldn't be able to enumerate customers.
  const client = db.prepare(`
    SELECT * FROM email_clients WHERE slug = ?
  `).get(slug);
  if (!client) return res.status(401).json({ error: 'Invalid credentials' });

  // Prune login_attempts for this username older than the lockout window so
  // the table doesn't grow unbounded. Cheap.
  db.prepare(`
    DELETE FROM client_login_attempts
    WHERE email_client_id = ? AND username = ? AND attempted_at < ?
  `).run(client.id, username, sqlMinusMinutes(LOCKOUT_WINDOW_MIN));

  // Lockout check.
  const recentFails = db.prepare(`
    SELECT COUNT(*) AS n FROM client_login_attempts
    WHERE email_client_id = ? AND username = ? AND attempted_at >= ?
  `).get(client.id, username, sqlMinusMinutes(LOCKOUT_WINDOW_MIN)).n;
  if (recentFails >= LOCKOUT_THRESHOLD) {
    return res.status(429).json({
      error: `Too many attempts. Try again in ${LOCKOUT_DURATION_MIN} minutes.`
    });
  }

  // Look up the user. We always run bcrypt.compare even on a missing user
  // (against a dummy hash) so the timing is comparable — prevents username
  // enumeration via login latency.
  const user = db.prepare(`
    SELECT * FROM client_users WHERE email_client_id = ? AND username = ?
  `).get(client.id, username);

  // Dummy hash with the same cost factor — bcrypt.compare against this takes
  // the same time as against a real hash with the same cost.
  const DUMMY_HASH = '$2b$12$abcdefghijklmnopqrstuuPHm2N0n3GpQ3l5y9x8wVwXgZkY1bZ.O';
  const hashToCheck = user ? user.password_hash : DUMMY_HASH;

  let ok = false;
  try {
    ok = await bcrypt.compare(password, hashToCheck);
  } catch (e) {
    console.error('[portal-auth] bcrypt.compare error:', e.message);
    ok = false;
  }

  if (!ok || !user) {
    db.prepare(`
      INSERT INTO client_login_attempts (email_client_id, username) VALUES (?, ?)
    `).run(client.id, username);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Success — clear failed-attempt counter for this username.
  db.prepare(`
    DELETE FROM client_login_attempts WHERE email_client_id = ? AND username = ?
  `).run(client.id, username);

  // Mint a session.
  const token = newToken();
  db.prepare(`
    INSERT INTO client_sessions (id, client_user_id, expires_at, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(token, user.id, sqlPlusDays(IDLE_DAYS));

  // Capture last_login_at AFTER computing must_change_password so the first-
  // login banner still fires correctly. We project the user from the DB row
  // we already have (which still has last_login_at NULL on first sign-in).
  const userOut = projectUser(user);
  db.prepare(`UPDATE client_users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);

  res.cookie(SESSION_COOKIE, token, cookieOpts());
  res.json({
    ok: true,
    token,                          // returned for completeness; cookie is what's used
    user:     userOut,
    client:   projectClient(client),
    services: buildServicesObject(client.id),
  });
});

// ─── 3. POST /api/portal/auth/logout ──────────────────────────────────────────
// Kills the CURRENT session only (per locked-in pre-decision). Other browsers
// the user is signed in on stay signed in.
router.post('/auth/logout', (req, res) => {
  const token = readSessionCookie(req);
  if (token) {
    db.prepare(`DELETE FROM client_sessions WHERE id = ?`).run(token);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// ─── 4. GET /api/portal/auth/check ────────────────────────────────────────────
// Validates the cookie and returns the current user/client/services so the
// portal frontend can decide what to render. Bumps idle expiry as a side effect.
// 401 if no session or session is dead — frontend then shows login.
router.get('/auth/check', (req, res) => {
  const token = readSessionCookie(req);
  const out = resolveSession(token);
  if (!out) return res.status(401).json({ error: 'Not signed in' });

  // resolveSession returns the bare client/user; we re-fetch the full client
  // row so projectClient works on the latest values. Services are computed
  // from the customer_services table by id, no need to pass the full row.
  const fullClient = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(out.client.id);
  const fullUser   = db.prepare(`SELECT * FROM client_users  WHERE id = ?`).get(out.user.id);
  res.json({
    user:     projectUser(fullUser),
    client:   projectClient(fullClient),
    services: buildServicesObject(fullClient.id),
  });
});

// ─── 5. POST /api/portal/auth/change-password ─────────────────────────────────
// body: { old, new }. Requires session. On success, kills all OTHER sessions
// for this user but keeps the current one (per locked-in pre-decision).
router.post('/auth/change-password', requirePortalSession, async (req, res) => {
  const { old: oldPw = '', new: newPw = '' } = req.body || {};
  if (!oldPw || !newPw) return res.status(400).json({ error: 'Both fields required' });
  if (newPw.length < 8)  return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const user = db.prepare(`SELECT * FROM client_users WHERE id = ?`).get(req.portalUser.id);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  let ok = false;
  try { ok = await bcrypt.compare(oldPw, user.password_hash); } catch { ok = false; }
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(newPw, BCRYPT_COST);
  db.prepare(`UPDATE client_users SET password_hash = ? WHERE id = ?`).run(newHash, user.id);

  // Kill all OTHER sessions for this user (keep the current one).
  db.prepare(`
    DELETE FROM client_sessions WHERE client_user_id = ? AND id != ?
  `).run(user.id, req.portalSessionToken);

  // Also clear any pending password-reset tokens for this user — they're
  // moot now and shouldn't be usable to set a different password later.
  db.prepare(`
    UPDATE password_resets SET used_at = datetime('now')
    WHERE client_user_id = ? AND used_at IS NULL
  `).run(user.id);

  res.json({ ok: true });
});

// ─── 6. POST /api/portal/auth/forgot-password ─────────────────────────────────
// body: { slug, email }. ALWAYS returns 200 — never leaks whether the email
// is registered. Sends a reset email via SES if the (slug, email) pair matches
// a real user. Reset link points at /c/<slug>?reset=<token>.
//
// One token per request; we don't dedupe within a window. If you spam the
// button you get multiple valid tokens; only the most recent one matters
// because the frontend reset form uses whatever token is in the URL.
router.post('/auth/forgot-password', async (req, res) => {
  const { slug = '', email = '' } = req.body || {};

  // Always respond 200 immediately — but do the real work async so timing
  // doesn't reveal whether the user existed (SES round-trip ≠ no-op).
  res.json({ ok: true });

  const client = db.prepare(`SELECT * FROM email_clients WHERE slug = ?`).get(slug);
  if (!client || !email) return;

  const user = db.prepare(`
    SELECT * FROM client_users WHERE email_client_id = ? AND email = ? COLLATE NOCASE
  `).get(client.id, email);
  if (!user) return;

  const token = newToken();
  db.prepare(`
    INSERT INTO password_resets (id, client_user_id, expires_at, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(token, user.id, sqlPlusHours(RESET_TTL_HOURS));

  const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const resetUrl = `${baseUrl}/c/${encodeURIComponent(slug)}?reset=${encodeURIComponent(token)}`;

  const subject = `Reset your ${client.name} portal password`;
  const html = `
    <p>Hi${user.username ? ' ' + user.username : ''},</p>
    <p>Someone (hopefully you) asked to reset the password on your
      ${client.name} portal at Sweetbyte.</p>
    <p><a href="${resetUrl}" style="display:inline-block;padding:10px 18px;background:#1EA4C9;color:#0F1D3F;text-decoration:none;border-radius:6px;">Reset your password</a></p>
    <p>Or paste this link into your browser:<br>
      <span style="font-family:monospace;font-size:12px;color:#5f5e5a;">${resetUrl}</span></p>
    <p>The link is valid for 1 hour. If you didn't request a reset, ignore this email — your password won't change.</p>
    <p style="color:#888;font-size:12px;margin-top:24px;">— Sweetbyte</p>
  `;
  const text =
`Hi${user.username ? ' ' + user.username : ''},

Someone (hopefully you) asked to reset the password on your ${client.name} portal at Sweetbyte.

Reset your password:
${resetUrl}

The link is valid for 1 hour. If you didn't request a reset, ignore this email — your password won't change.

— Sweetbyte`;

  try {
    await sendEmail({
      to:        user.email,
      toName:    user.username,
      fromName:  'Sweetbyte Studio',
      fromEmail: PASSWORD_RESET_FROM,
      replyTo:   PASSWORD_RESET_FROM,
      subject,
      htmlBody:  html,
      plainBody: text,
      // No campaign/subscriber context → no tracking applied (correct for
      // a transactional email).
    });
    console.log(`[portal-auth] reset email sent to ${user.email} for slug=${slug}`);
  } catch (e) {
    console.error(`[portal-auth] reset email FAILED for ${user.email}: ${e.message}`);
    // We've already sent 200 to the client. Failure here is a Render-logs
    // problem, not a user-facing one. Wez can resend manually if needed.
  }
});

// ─── 7. POST /api/portal/auth/reset-password ──────────────────────────────────
// body: { token, new }. Validates the token (not used, not expired), hashes
// the new password, marks token used, kills ALL sessions for the user (per
// locked-in pre-decision — user must sign in fresh after reset).
router.post('/auth/reset-password', async (req, res) => {
  const { token = '', new: newPw = '' } = req.body || {};
  if (!token || !newPw) return res.status(400).json({ error: 'Token and new password required' });
  if (newPw.length < 8)  return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const reset = db.prepare(`
    SELECT * FROM password_resets WHERE id = ?
  `).get(token);
  if (!reset || reset.used_at) {
    return res.status(400).json({ error: 'This reset link has already been used or is invalid.' });
  }
  const expired = db.prepare(`SELECT datetime('now') > ? AS x`).get(reset.expires_at).x;
  if (expired) {
    return res.status(400).json({ error: 'This reset link has expired. Request a new one.' });
  }

  const newHash = await bcrypt.hash(newPw, BCRYPT_COST);

  db.transaction(() => {
    db.prepare(`UPDATE client_users SET password_hash = ? WHERE id = ?`).run(newHash, reset.client_user_id);
    db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(token);
    // Kill ALL sessions for this user (per spec — fresh sign-in required).
    db.prepare(`DELETE FROM client_sessions WHERE client_user_id = ?`).run(reset.client_user_id);
    // Also invalidate any other pending reset tokens for this user.
    db.prepare(`
      UPDATE password_resets SET used_at = datetime('now')
      WHERE client_user_id = ? AND id != ? AND used_at IS NULL
    `).run(reset.client_user_id, token);
  })();

  // Clear cookie so the browser doesn't keep showing them as signed-in.
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

export default router;
