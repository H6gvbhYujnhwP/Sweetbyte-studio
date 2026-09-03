/**
 * portal-admin.js — Admin-side endpoints for managing the customer portal.
 *
 * Mounted at /api/portal-admin in server/index.js. All routes require the
 * existing admin Bearer-token (requireAuth middleware) — these are NOT used
 * by the customer-facing portal. The admin uses these to:
 *   - List portal customers and create new ones
 *   - Toggle service subscriptions for each customer
 *   - Manage portal users for each customer (add / remove / reset password)
 *   - Read the services catalogue (drives the admin Manage UI)
 *   - Read pickable options for each service that links to an external table
 *
 * Note the path: /api/portal-admin (NOT /api/portal). The fetch interceptor
 * in src/App.jsx excludes /api/portal/* from the admin Bearer token because
 * those are customer-portal routes. /api/portal-admin/* is a separate prefix
 * that DOES get the Bearer token, since it's admin-only.
 *
 * GENERIC SERVICES MODEL: services are not hardcoded here. The `services` DB
 * table is the source of truth — adding a new service (e.g. SEO, Google Ads)
 * is an INSERT into `services`, no changes to this file.
 */
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { prepareLogoForStorage } from '../services/logo-prep.js';
import { DEFAULT_CLIENT_COLOR } from '../../src/brand.js';

const router = Router();
const BCRYPT_COST = 12;

// All routes below require admin auth — apply once at the router level.
router.use(requireAuth);

// Cloudflare R2 client — mirrors routes/clients.js setup so logos for portal
// customers and LinkedIn customers all live in the same bucket. Uses the
// existing R2_* env vars; no new infrastructure required.
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const ALLOWED_LOGO_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genTempPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  let out = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Whitelist of tables that services may declare as their `link_table`. Any
 * value coming from the `services` catalogue is checked against this set
 * before being interpolated into a SQL query. Add new tables here when a
 * future service needs to reference them (e.g. 'facebook_ad_accounts').
 *
 * email_clients is in here because the Email service uses it as a picker —
 * a portal customer named "Cube6" can be pointed at the email_clients row
 * "mail.engineersolutions.co.uk" so their inbox/campaigns pull from there.
 */
const ALLOWED_LINK_TABLES = new Set(['clients', 'email_clients']);

function fetchLinkedName(linkTable, externalId) {
  if (!linkTable || !externalId) return null;
  if (!ALLOWED_LINK_TABLES.has(linkTable)) return null;
  try {
    const row = db.prepare(`SELECT name FROM ${linkTable} WHERE id = ?`).get(externalId);
    return row ? row.name : null;
  } catch {
    return null;
  }
}

/**
 * Per-customer services array for admin UI rendering. One entry per service
 * in the catalogue (subscribed or not). Used by the Manage panel to draw
 * dropdowns dynamically — no hardcoded service list on the frontend.
 */
function buildCustomerServices(emailClientId) {
  const rows = db.prepare(`
    SELECT s.service_key, s.display_name, s.description, s.state,
           s.link_table, s.link_label, s.sort_order,
           cs.linked_external_id,
           CASE WHEN cs.email_client_id IS NULL THEN 0 ELSE 1 END AS subscribed
    FROM services s
    LEFT JOIN customer_services cs
      ON cs.service_key = s.service_key AND cs.email_client_id = ?
    WHERE s.state != 'retired'
    ORDER BY s.sort_order ASC
  `).all(emailClientId);

  return rows.map(r => ({
    service_key:           r.service_key,
    display_name:          r.display_name,
    description:           r.description,
    state:                 r.state,
    link_table:            r.link_table,
    link_label:            r.link_label,
    subscribed:            !!r.subscribed,
    linked_external_id:    r.linked_external_id || null,
    linked_external_name:  fetchLinkedName(r.link_table, r.linked_external_id),
  }));
}

function projectCustomer(row) {
  const userCount = db.prepare(
    `SELECT COUNT(*) AS n FROM client_users WHERE email_client_id = ?`
  ).get(row.id).n;
  return {
    id:                row.id,
    name:              row.name,
    slug:              row.slug,
    color:             row.color,
    logo_url:          row.logo_url || null,
    portal_enabled:    !!row.portal_enabled,
    portal_user_count: userCount,
    services:          buildCustomerServices(row.id),
  };
}

function projectUser(row) {
  return {
    id:            row.id,
    username:      row.username,
    email:         row.email,
    role:          row.role,
    created_at:    row.created_at,
    last_login_at: row.last_login_at,
  };
}

/**
 * Find the LinkedIn `clients` row id linked to a portal customer, if any.
 * Reads from customer_services first (the new source of truth) and falls
 * back to the legacy linkedin_client_id column if needed.
 */
function getLinkedLinkedinClientId(emailClientId) {
  const row = db.prepare(`
    SELECT linked_external_id FROM customer_services
    WHERE email_client_id = ? AND service_key = 'linkedin'
  `).get(emailClientId);
  if (row?.linked_external_id) return row.linked_external_id;
  const legacy = db.prepare(`
    SELECT linkedin_client_id FROM email_clients WHERE id = ?
  `).get(emailClientId);
  return legacy?.linkedin_client_id || null;
}

/**
 * Find every email_clients row whose customer_services or legacy column
 * points at the given LinkedIn client id. Used to propagate a LinkedIn-side
 * logo update to any portal customers that share that LinkedIn account.
 *
 * In normal operation only zero or one row matches (UNIQUE index prevents
 * cross-customer linking) but the query handles the multi-row case defensively.
 */
function findPortalCustomersLinkedTo(linkedinClientId) {
  return db.prepare(`
    SELECT DISTINCT ec.id FROM email_clients ec
    LEFT JOIN customer_services cs
      ON cs.email_client_id = ec.id AND cs.service_key = 'linkedin'
    WHERE cs.linked_external_id = ?
       OR ec.linkedin_client_id = ?
  `).all(linkedinClientId, linkedinClientId).map(r => r.id);
}

/**
 * Upload an image buffer to R2 and return the public URL. Common code
 * shared by both portal-admin and clients logo upload routes (this file
 * also exports it via the helper module pattern, but for simplicity it
 * lives here and clients.js will get the same behaviour via a small edit).
 *
 * The file is trimmed via prepareLogoForStorage BEFORE upload so the bytes
 * sitting in R2 are the canonical, ready-to-composite form. Every regen
 * later just downloads and resizes — no trim, no variance. See
 * services/logo-prep.js for the full reasoning.
 */
async function uploadLogoToR2(file, scope, ownerId) {
  const prepped = await prepareLogoForStorage(file.buffer, file.mimetype);
  const key = `logos/${scope}/${ownerId}/logo-${uuid()}.${prepped.ext}`;
  await s3.send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET_NAME,
    Key:         key,
    Body:        prepped.buffer,
    ContentType: prepped.mimetype,
  }));
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

/**
 * Sync the legacy email_clients columns (service_email_enabled,
 * linkedin_client_id) from the customer_services source of truth. Called
 * after every service change so anything still reading the legacy columns
 * stays correct.
 *
 * When the legacy columns are eventually dropped (a future cleanup chat),
 * this helper goes too.
 */
function syncLegacyColumns(emailClientId) {
  const emailRow = db.prepare(
    `SELECT 1 FROM customer_services WHERE email_client_id = ? AND service_key = 'email'`
  ).get(emailClientId);
  const linkedinRow = db.prepare(
    `SELECT linked_external_id FROM customer_services WHERE email_client_id = ? AND service_key = 'linkedin'`
  ).get(emailClientId);
  db.prepare(`
    UPDATE email_clients
    SET service_email_enabled = ?,
        linkedin_client_id    = ?
    WHERE id = ?
  `).run(emailRow ? 1 : 0, linkedinRow?.linked_external_id || null, emailClientId);
}

// ─── 1. GET /api/portal-admin/services ────────────────────────────────────────
// Returns the catalogue of services. The admin Manage panel uses this to render
// the list of dropdowns (one per service). Adding a service to the system
// becomes "INSERT INTO services" — the admin UI picks it up automatically.
router.get('/services', (req, res) => {
  const rows = db.prepare(`
    SELECT service_key, display_name, description, state, link_table, link_label, sort_order
    FROM services
    WHERE state != 'retired'
    ORDER BY sort_order ASC
  `).all();
  res.json(rows);
});

// ─── 2. GET /api/portal-admin/service-options/:service_key ────────────────────
// Picker options for a service that has a link_table. Returns the rows of
// that external table that the admin can pick from, plus a flag for any that
// are already linked elsewhere (so the dropdown can grey those out).
//
// For services with link_table = NULL (plain on/off services), returns [].
router.get('/service-options/:service_key', (req, res) => {
  const svc = db.prepare(
    `SELECT service_key, link_table FROM services WHERE service_key = ?`
  ).get(req.params.service_key);
  if (!svc) return res.status(404).json({ error: 'Unknown service' });
  if (!svc.link_table) return res.json([]);
  if (!ALLOWED_LINK_TABLES.has(svc.link_table)) {
    return res.status(500).json({ error: `Service link_table "${svc.link_table}" is not whitelisted` });
  }

  // Per-table filter: when picking from email_clients, hide rows that are
  // themselves portal customers — you want to pick the underlying email-system
  // record (e.g. "mail.engineersolutions.co.uk"), not another portal customer.
  // Leaves a small loophole if you want a portal customer pointing at another
  // portal customer's email — fine, since we still show CURRENTLY-linked rows
  // (matched by the LEFT JOIN below) so the picker can still show the value
  // that's already saved.
  const filterSql = svc.link_table === 'email_clients'
    ? 'AND (t.portal_enabled = 0 OR cs.email_client_id IS NOT NULL)'
    : '';

  // Self-link treatment: if a customer_services row has email_client_id =
  // linked_external_id, that's a "self-link" (portal customer points at its
  // own email record by default). Treat self-links as unlinked for picker
  // purposes — they shouldn't show as "already linked to <name>" because the
  // owning customer can re-link them at will. Only cross-customer links
  // (where someone else has claimed this record) count as "already linked".
  const rows = db.prepare(`
    SELECT
      t.id,
      t.name,
      CASE WHEN cs.email_client_id = cs.linked_external_id THEN NULL ELSE cs.email_client_id END AS linked_to_id,
      CASE WHEN cs.email_client_id = cs.linked_external_id THEN NULL ELSE ec.name              END AS linked_to_name,
      CASE WHEN cs.email_client_id = cs.linked_external_id THEN NULL ELSE ec.slug              END AS linked_to_slug
    FROM ${svc.link_table} t
    LEFT JOIN customer_services cs
      ON cs.service_key        = ?
     AND cs.linked_external_id = t.id
    LEFT JOIN email_clients ec ON ec.id = cs.email_client_id
    WHERE 1=1 ${filterSql}
    ORDER BY t.name COLLATE NOCASE ASC
  `).all(svc.service_key);
  res.json(rows.map(r => ({
    id:             r.id,
    name:           r.name,
    linked_to_id:   r.linked_to_id   || null,
    linked_to_name: r.linked_to_name || null,
    linked_to_slug: r.linked_to_slug || null,
  })));
});

// ─── 3. GET /api/portal-admin/customers ───────────────────────────────────────
// List portal customers (portal_enabled = 1). Cold-email customers without
// a portal don't appear here.
router.get('/customers', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM email_clients WHERE portal_enabled = 1
    ORDER BY name COLLATE NOCASE ASC
  `).all();
  res.json(rows.map(projectCustomer));
});

// ─── 4. POST /api/portal-admin/customers ──────────────────────────────────────
// Create a brand-new portal customer (the "+ New portal customer" button on
// the Customer Portal admin page). Body: { name }.
//
// Defaults:
//   - portal_enabled = 1
//   - service_email_enabled = 0   (legacy column; new portal customers default
//                                  to no cold-email service)
//   - No customer_services rows   (admin opts into services in Manage panel)
//   - slug auto-generated         (db._portalUniqueSlug helper)
router.post('/customers', (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const trimmedName = String(name).trim();
  const id = uuid();
  const slug = db._portalUniqueSlug
    ? db._portalUniqueSlug(trimmedName, id)
    : trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  db.prepare(`
    INSERT INTO email_clients
      (id, name, color, slug, portal_enabled, service_email_enabled, source)
    VALUES (?, ?, ?, ?, 1, 0, 'portal')
  `).run(id, trimmedName, DEFAULT_CLIENT_COLOR, slug);

  const row = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(id);
  res.json(projectCustomer(row));
});

// ─── 5. GET /api/portal-admin/customers/:id ───────────────────────────────────
// Single-customer detail (customer + portal users) for the Manage panel.
router.get('/customers/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const users = db.prepare(`
    SELECT * FROM client_users WHERE email_client_id = ? ORDER BY username ASC
  `).all(req.params.id);
  res.json({
    customer: projectCustomer(row),
    users:    users.map(projectUser),
  });
});

// ─── 6. PUT /api/portal-admin/customers/:id ───────────────────────────────────
// Update top-level customer fields. Currently just portal_enabled.
// Disabling portal_enabled does NOT delete services or users — it just hides
// the customer from the Customer Portal admin list. Re-enabling brings them back.
router.put('/customers/:id', (req, res) => {
  const cur = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const body = req.body || {};
  const updates = [];
  const params = [];
  if ('portal_enabled' in body) {
    updates.push('portal_enabled = ?');
    params.push(body.portal_enabled ? 1 : 0);
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  params.push(req.params.id);
  db.prepare(`UPDATE email_clients SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(req.params.id);
  res.json(projectCustomer(updated));
});

// ─── 7. PUT /api/portal-admin/customers/:id/services ──────────────────────────
// Update one or more service subscriptions. Body shape:
//   {
//     services: {
//       <service_key>: {
//         subscribed: bool,
//         linked_external_id?: string|null   (only relevant for services with link_table)
//       }
//     }
//   }
//
// Per-service behaviour:
//   subscribed: false → DELETE the customer_services row (if any)
//   subscribed: true  → INSERT or UPDATE the row. For services with link_table,
//                       linked_external_id is required and must reference a
//                       valid row in that table.
router.put('/customers/:id/services', (req, res) => {
  const cur = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });

  const requested = (req.body && req.body.services) || {};
  if (typeof requested !== 'object' || Array.isArray(requested)) {
    return res.status(400).json({ error: 'Body must be { services: { <key>: {...} } }' });
  }

  const allServices = db.prepare(`SELECT * FROM services`).all();
  const byKey = new Map(allServices.map(s => [s.service_key, s]));

  // Validate every requested key BEFORE writing anything.
  for (const [key, val] of Object.entries(requested)) {
    const svc = byKey.get(key);
    if (!svc) return res.status(400).json({ error: `Unknown service: ${key}` });
    if (svc.state === 'retired') return res.status(400).json({ error: `Service ${key} is retired` });
    if (svc.state === 'coming_soon' && val.subscribed) {
      return res.status(400).json({ error: `Service ${key} is not yet live — cannot subscribe customers` });
    }
    if (val.subscribed && svc.link_table) {
      if (!val.linked_external_id) {
        return res.status(400).json({ error: `${svc.display_name} requires a linked record (pick one from the dropdown)` });
      }
      if (!ALLOWED_LINK_TABLES.has(svc.link_table)) {
        return res.status(500).json({ error: `Internal: link_table "${svc.link_table}" not whitelisted` });
      }
      const exists = db.prepare(`SELECT 1 FROM ${svc.link_table} WHERE id = ?`).get(val.linked_external_id);
      if (!exists) return res.status(400).json({ error: `Selected ${svc.link_label || 'record'} no longer exists` });
    }
  }

  try {
    db.transaction(() => {
      for (const [key, val] of Object.entries(requested)) {
        const svc = byKey.get(key);
        if (!val.subscribed) {
          db.prepare(`
            DELETE FROM customer_services
            WHERE email_client_id = ? AND service_key = ?
          `).run(req.params.id, key);
          continue;
        }
        const linkedId = svc.link_table ? val.linked_external_id : null;
        db.prepare(`
          INSERT INTO customer_services (email_client_id, service_key, linked_external_id, enabled_by)
          VALUES (?, ?, ?, 'admin')
          ON CONFLICT(email_client_id, service_key)
          DO UPDATE SET linked_external_id = excluded.linked_external_id
        `).run(req.params.id, key, linkedId);
      }
    })();
  } catch (e) {
    if (String(e.message).includes('UNIQUE') && String(e.message).includes('linked_external_id')) {
      return res.status(409).json({
        error: 'That record is already linked to another customer for this service. Unlink it there first.'
      });
    }
    throw e;
  }

  syncLegacyColumns(req.params.id);
  const updated = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(req.params.id);
  res.json(projectCustomer(updated));
});

// ─── 8. GET /api/portal-admin/customers/:id/users ─────────────────────────────
router.get('/customers/:id/users', (req, res) => {
  const customer = db.prepare(`SELECT id FROM email_clients WHERE id = ?`).get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const rows = db.prepare(`
    SELECT * FROM client_users WHERE email_client_id = ? ORDER BY username ASC
  `).all(req.params.id);
  res.json(rows.map(projectUser));
});

// ─── 9. POST /api/portal-admin/customers/:id/users ────────────────────────────
// Create a portal user with a generated 12-char temporary password.
router.post('/customers/:id/users', async (req, res) => {
  const customer = db.prepare(`SELECT id FROM email_clients WHERE id = ?`).get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const { username = '', email = '', role = 'viewer' } = req.body || {};
  const u = String(username).trim().toLowerCase();
  const e = String(email || '').trim().toLowerCase() || null;
  if (!u) return res.status(400).json({ error: 'Username is required' });
  if (!/^[a-z0-9][a-z0-9._-]{1,30}$/.test(u)) {
    return res.status(400).json({
      error: 'Username must be 2–31 chars, lowercase letters/digits/._- only, starting with a letter or digit'
    });
  }
  if (!['admin', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or viewer' });
  }

  const tempPw = genTempPassword();
  const hash = await bcrypt.hash(tempPw, BCRYPT_COST);
  const id = `cu_${uuid()}`;

  try {
    db.prepare(`
      INSERT INTO client_users (id, email_client_id, username, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, u, e, hash, role);
  } catch (err) {
    if (String(err.message).includes('UNIQUE') && String(err.message).includes('username')) {
      return res.status(409).json({ error: `A user with username "${u}" already exists for this customer.` });
    }
    throw err;
  }

  const row = db.prepare(`SELECT * FROM client_users WHERE id = ?`).get(id);
  res.json({
    user: projectUser(row),
    temporary_password: tempPw,
  });
});

// ─── 10. DELETE /api/portal-admin/users/:id ───────────────────────────────────
router.delete('/users/:id', (req, res) => {
  const row = db.prepare(`SELECT id, email_client_id, username FROM client_users WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    db.prepare(`DELETE FROM client_sessions WHERE client_user_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM password_resets  WHERE client_user_id = ?`).run(req.params.id);
    db.prepare(`
      DELETE FROM client_login_attempts
      WHERE email_client_id = ? AND username = ?
    `).run(row.email_client_id, row.username);
    db.prepare(`DELETE FROM client_users WHERE id = ?`).run(req.params.id);
  })();
  res.json({ ok: true });
});

// ─── 11. POST /api/portal-admin/users/:id/reset-password ──────────────────────
// Body (optional): { new_password: string }
//   - If `new_password` is provided, it's used as the new password (admin-chosen flow).
//     Must be at least 8 characters to match portal-auth signup/reset validation.
//   - If absent or empty, a random temporary password is generated (original behaviour).
// In both cases the plaintext is returned to the admin once so it can be given to
// the user. The response `kind` field is 'admin_chosen' or 'random' so the modal
// can render slightly different copy.
router.post('/users/:id/reset-password', async (req, res) => {
  const row = db.prepare(`SELECT * FROM client_users WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const supplied = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
  let newPw, kind;
  if (supplied) {
    if (supplied.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    newPw = supplied;
    kind  = 'admin_chosen';
  } else {
    newPw = genTempPassword();
    kind  = 'random';
  }
  const hash = await bcrypt.hash(newPw, BCRYPT_COST);

  db.transaction(() => {
    db.prepare(`
      UPDATE client_users SET password_hash = ?, last_login_at = NULL WHERE id = ?
    `).run(hash, req.params.id);
    db.prepare(`DELETE FROM client_sessions WHERE client_user_id = ?`).run(req.params.id);
    db.prepare(`
      UPDATE password_resets SET used_at = datetime('now')
      WHERE client_user_id = ? AND used_at IS NULL
    `).run(req.params.id);
  })();

  res.json({
    ok: true,
    temporary_password: newPw,
    kind,
  });
});

// ─── 12. GET /api/portal-admin/eligible-customers ─────────────────────────────
// email_clients NOT yet portal-enabled. Used by the "Enable existing customer"
// flow on the admin page — alternative to "+ New portal customer" when the
// company already exists as an email_client.
router.get('/eligible-customers', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, slug FROM email_clients
    WHERE portal_enabled = 0
    ORDER BY name COLLATE NOCASE ASC
  `).all();
  res.json(rows);
});

// ─── 13. POST /api/portal-admin/customers/:id/logo ────────────────────────────
// Upload a logo for a portal customer. Stored in R2 under logos/portal/<id>/.
// Cross-sync: if this portal customer is linked to a LinkedIn account, the
// uploaded URL is also written to that LinkedIn `clients` row's logo_url so
// the LinkedIn admin view stays consistent.
//
// Allowed types: PNG, JPG, SVG, WebP. Max size 20 MB (mirrors the existing
// LinkedIn logo upload).
router.post('/customers/:id/logo', upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No logo file uploaded' });
  if (!ALLOWED_LOGO_MIME.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Logo must be PNG, JPG, SVG, or WebP' });
  }
  const customer = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  let logoUrl;
  try {
    logoUrl = await uploadLogoToR2(req.file, 'portal', req.params.id);
  } catch (err) {
    console.error('[portal-admin] Logo upload failed:', err.message);
    return res.status(500).json({ error: `Logo upload failed: ${err.message}` });
  }

  // Update the portal customer's logo. Then propagate to any linked LinkedIn
  // record so uploads from either side keep both in sync (option Z behaviour
  // — last write wins on both sides, which is fine in practice). Both sides
  // get logo_processed_at stamped so the boot-time backfill migration
  // (services/logo-backfill.js) skips these rows next time it runs.
  db.transaction(() => {
    db.prepare(`UPDATE email_clients SET logo_url = ?, logo_processed_at = datetime('now') WHERE id = ?`).run(logoUrl, req.params.id);
    const linkedinId = getLinkedLinkedinClientId(req.params.id);
    if (linkedinId) {
      db.prepare(`
        UPDATE clients SET logo_url = ?, logo_processed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
      `).run(logoUrl, linkedinId);
    }
  })();

  const updated = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, customer: projectCustomer(updated) });
});

// ─── 14. DELETE /api/portal-admin/customers/:id/logo ──────────────────────────
// Clear the portal customer's logo. Also clears the linked LinkedIn record's
// logo to keep them in sync (option Z behaviour). The R2 object stays
// behind — costs nothing and saves a "but I want it back" recovery moment.
router.delete('/customers/:id/logo', (req, res) => {
  const customer = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  db.transaction(() => {
    db.prepare(`UPDATE email_clients SET logo_url = NULL WHERE id = ?`).run(req.params.id);
    const linkedinId = getLinkedLinkedinClientId(req.params.id);
    if (linkedinId) {
      db.prepare(`
        UPDATE clients SET logo_url = NULL, updated_at = datetime('now') WHERE id = ?
      `).run(linkedinId);
    }
  })();

  const updated = db.prepare(`SELECT * FROM email_clients WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, customer: projectCustomer(updated) });
});

export default router;
