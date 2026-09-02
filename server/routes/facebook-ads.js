// ─────────────────────────────────────────────────────────────────────────────
// Facebook Ads (admin) — READ-ONLY reporting (decision #107).
//
// Studio does NOT create or manage ads — Manus AI makes the posts/images and
// builds the campaigns. Studio is a read-only window onto Facebook: it shows
// each customer's live ads + performance. One ad account per customer.
//
// Routes:
//   GET  /connection-status            — is Studio reaching Facebook?
//   GET  /ads?customer=&window=         — a customer's account + ads + stats
//   GET  /customers                     — Facebook Ads roster (+ their account id)
//   GET  /available-customers           — customers you can add
//   POST /:emailClientId/account        — set/clear a customer's ad account id
//
// Mounted at /api/facebook-ads, behind requireAuth.
// ─────────────────────────────────────────────────────────────────────────────
import express from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { metaConfigured, testConnection, getAdsOverview, checkCreatePermission, listPages, listLeadForms, pushAdsToFacebook, META } from '../services/meta-api.js';
import { extractTextFromBuffer } from '../utils/extractText.js';
import { prepareLogoForStorage } from '../services/logo-prep.js';
import { extractBrandFromRag } from '../services/brand-extract.js';
import { recompositeLogoFromUrl } from '../services/gemini.js';
import { uploadImageToR2 } from '../services/r2.js';
import { normalizeCta } from '../services/facebook-ads-playbook.js';
import { generateAdCreatives, regenerateAdCopy, regenerateAdImage } from '../services/facebook-ads-gen.js';
import { DEFAULT_CLIENT_COLOR } from '../../src/brand.js';

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Build the customer object the generation engine expects, from the customer's
// Facebook row (its own RAG + brand block + logo) joined to their name.
function fbCustomer(emailClientId) {
  const row = db.prepare(`
    SELECT fa.*, ec.name AS customer_name
    FROM facebook_ads fa JOIN email_clients ec ON ec.id = fa.email_client_id
    WHERE fa.email_client_id = ?
  `).get(emailClientId);
  if (!row) return null;
  return {
    id: emailClientId,
    name: row.customer_name,
    brand: row.customer_name,
    rag_content: row.rag_content,
    brand_colors: row.brand_colors,
    type_style: row.type_style,
    visual_style: row.visual_style,
    logo_description: row.logo_description,
    logo_url: row.logo_url,
    logo_position: row.logo_position,
    logo_panel: row.logo_panel,
    logo_size: row.logo_size,
    ad_count: row.ad_count,
  };
}

// ── CONNECTION STATUS ────────────────────────────────────────────────────────
router.get('/connection-status', async (req, res) => {
  if (!metaConfigured()) {
    return res.json({ configured: false, ok: false, message: 'Meta API is not configured — META_ACCESS_TOKEN is missing.' });
  }
  const result = await testConnection();
  res.json({
    configured: true,
    ok: result.ok,
    account: result.ok ? result.account : null,
    error: result.ok ? null : result.error,
    api_version: META.apiVersion,
    ad_account_id: `act_${META.adAccountId}`,
  });
});

// ── PHASE-2 PRE-FLIGHT: can Studio CREATE ads? ───────────────────────────────
// Diagnostic for the "Test create-ad permission" button. Creates a PAUSED test
// campaign on the selected customer's ad account and deletes it again, proving
// the token can write ads before we build the real push. Spends nothing.
// Pass ?customer=<email_client_id> to test that customer's account, or
// ?ad_account=<id> directly; otherwise the default configured account is used.
router.get('/test-create-permission', async (req, res) => {
  if (!metaConfigured()) {
    return res.json({ configured: false, verdict: 'Meta API is not configured — META_ACCESS_TOKEN is missing.' });
  }

  let adAccountId = req.query.ad_account ? String(req.query.ad_account) : null;
  if (!adAccountId && req.query.customer) {
    const fa = db.prepare('SELECT ad_account_id FROM facebook_ads WHERE email_client_id = ?').get(req.query.customer);
    if (!fa || !fa.ad_account_id) {
      return res.json({ configured: true, verdict: 'This customer has no ad account set yet — add their ad account ID first.' });
    }
    adAccountId = fa.ad_account_id;
  }

  try {
    const result = await checkCreatePermission(adAccountId || undefined);
    const verdict = result.create_ok
      ? (result.delete_ok
          ? 'PASS — Studio can create ads. A test campaign was created and removed automatically.'
          : 'PASS — Studio can create ads. The test campaign was created but not auto-removed — please delete it in Ads Manager.')
      : 'FAIL — Studio cannot create ads with the current token / account. See the detail below.';
    res.json({ configured: true, verdict, ...result });
  } catch (err) {
    res.json({ configured: true, verdict: 'FAIL — unexpected error.', error: err.message });
  }
});

// ── ADS + STATS (read-only) ──────────────────────────────────────────────────
// Scoped to one customer's ad account when ?customer=<email_client_id> is given.
// Without a customer it falls back to the default configured account (handy for
// a quick check). Always 200; a Meta failure comes back as { ok:false, error }.
router.get('/ads', async (req, res) => {
  if (!metaConfigured()) {
    return res.json({ ok: false, configured: false, error: 'Meta API is not configured.' });
  }
  const window = req.query.window || '30d';
  let adAccountId = null;
  if (req.query.customer) {
    const fa = db.prepare('SELECT ad_account_id FROM facebook_ads WHERE email_client_id = ?').get(req.query.customer);
    if (!fa || !fa.ad_account_id) {
      return res.json({ ok: false, configured: true, no_account: true, error: 'No ad account is set for this customer yet.' });
    }
    adAccountId = fa.ad_account_id;
  }
  const overview = await getAdsOverview({ window, adAccountId });
  res.json({ configured: true, ...overview });
});

// ── CUSTOMERS (Facebook Ads roster) ──────────────────────────────────────────
router.get('/customers', (req, res) => {
  const rows = db.prepare(`
    SELECT fa.email_client_id AS id, ec.name, fa.ad_account_id, fa.status
    FROM facebook_ads fa
    JOIN email_clients ec ON ec.id = fa.email_client_id
    ORDER BY ec.name COLLATE NOCASE ASC
  `).all();
  res.json(rows.map(r => ({ ...r, has_account: !!r.ad_account_id })));
});

// ── AVAILABLE CUSTOMERS (to add) ─────────────────────────────────────────────
// Non-hidden customers not already on Facebook Ads, excluding portal anchor rows
// linked to another customer (handles Cube6-style links + Manson-style self-links).
router.get('/available-customers', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name
    FROM email_clients
    WHERE (hidden_at IS NULL)
      AND id NOT IN (SELECT email_client_id FROM facebook_ads)
      AND id NOT IN (
        SELECT linked_external_id FROM customer_services
        WHERE linked_external_id IS NOT NULL AND email_client_id != linked_external_id
      )
    ORDER BY name COLLATE NOCASE ASC
  `).all();
  res.json(rows);
});

// ── SET / CLEAR a customer's ad account id ───────────────────────────────────
// Creates the Facebook Ads record for the customer if needed. Accepts the id
// with or without the 'act_' prefix; stores the bare digits.
router.post('/:emailClientId/account', (req, res) => {
  const id = req.params.emailClientId;
  const ec = db.prepare('SELECT id FROM email_clients WHERE id = ?').get(id);
  if (!ec) return res.status(404).json({ error: 'Customer not found' });

  const raw = (req.body && req.body.ad_account_id !== undefined) ? String(req.body.ad_account_id) : '';
  const acct = raw.trim().replace(/^act_/i, '').replace(/\D/g, '');
  if (!acct) return res.status(400).json({ error: 'Enter the numeric ad account ID (digits, with or without the act_ prefix).' });

  const existing = db.prepare('SELECT id FROM facebook_ads WHERE email_client_id = ?').get(id);
  if (existing) {
    db.prepare(`UPDATE facebook_ads SET ad_account_id = ?, updated_at = datetime('now') WHERE email_client_id = ?`).run(acct, id);
  } else {
    db.prepare(`INSERT INTO facebook_ads (id, email_client_id, status, ad_account_id) VALUES (?, ?, 'not_connected', ?)`).run(uuid(), id, acct);
    db.prepare(`INSERT OR IGNORE INTO customer_services (email_client_id, service_key, linked_external_id, enabled_by) VALUES (?, 'facebook_ads', NULL, 'admin')`).run(id);
  }
  res.json({ ok: true, ad_account_id: acct });
});

// ── ADD a Facebook Ads customer (existing OR brand-new, account optional) ─────
// Supports generate-only customers we make ads for but never push to Facebook:
//   - email_client_id given  → add that existing customer
//   - name given (no id)     → create a new name-only customer first
//   - ad_account_id optional → blank is fine; push stays blocked until one is set
router.post('/add-customer', (req, res) => {
  const body = req.body || {};
  let id = body.email_client_id ? String(body.email_client_id) : null;
  const name = (body.name || '').trim();
  const acct = String(body.ad_account_id || '').trim().replace(/^act_/i, '').replace(/\D/g, '') || null;

  if (!id && !name) return res.status(400).json({ error: 'Pick a customer or enter a new customer name.' });

  if (!id) {
    // Reuse an existing customer with the same name rather than duplicate it.
    const existing = db.prepare('SELECT id FROM email_clients WHERE LOWER(name) = ?').get(name.toLowerCase());
    if (existing) {
      id = existing.id;
    } else {
      id = uuid();
      const slug = db._portalUniqueSlug
        ? db._portalUniqueSlug(name, id)
        : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      db.prepare('INSERT INTO email_clients (id, name, color, slug, source) VALUES (?, ?, ?, ?, ?)')
        .run(id, name, DEFAULT_CLIENT_COLOR, slug, 'manual');
    }
  } else {
    const ec = db.prepare('SELECT id FROM email_clients WHERE id = ?').get(id);
    if (!ec) return res.status(404).json({ error: 'Customer not found' });
  }

  const existingFa = db.prepare('SELECT id FROM facebook_ads WHERE email_client_id = ?').get(id);
  if (existingFa) {
    if (acct) db.prepare(`UPDATE facebook_ads SET ad_account_id = ?, updated_at = datetime('now') WHERE email_client_id = ?`).run(acct, id);
  } else {
    db.prepare(`INSERT INTO facebook_ads (id, email_client_id, status, ad_account_id) VALUES (?, ?, 'not_connected', ?)`).run(uuid(), id, acct);
    db.prepare(`INSERT OR IGNORE INTO customer_services (email_client_id, service_key, linked_external_id, enabled_by) VALUES (?, 'facebook_ads', NULL, 'admin')`).run(id);
  }
  res.json({ ok: true, id });
});

// ─────────────────────────────────────────────────────────────────────────────
// AD APPROVALS — generation, RAG/brand setup, per-creative controls (decision
// #106 revived + upgraded to gpt-image-2). All admin, behind requireAuth.
// Nothing here writes to Facebook — pushing approved drafts is the next stage.
// ─────────────────────────────────────────────────────────────────────────────

// Overview: the setup (RAG/brand/logo/ad-count) + the current generated set.
router.get('/:emailClientId/overview', (req, res) => {
  const row = db.prepare(`
    SELECT fa.*, ec.name AS customer_name
    FROM facebook_ads fa JOIN email_clients ec ON ec.id = fa.email_client_id
    WHERE fa.email_client_id = ?
  `).get(req.params.emailClientId);
  if (!row) return res.status(404).json({ error: 'Not a Facebook Ads customer' });
  const creatives = db.prepare(
    `SELECT * FROM facebook_ad_creatives WHERE email_client_id = ? ORDER BY created_at DESC, rowid DESC`
  ).all(req.params.emailClientId);
  res.json({
    customer_name: row.customer_name,
    ad_account_id: row.ad_account_id,
    rag_filename: row.rag_filename,
    has_rag: !!row.rag_content,
    brand_colors: row.brand_colors,
    logo_description: row.logo_description,
    type_style: row.type_style,
    visual_style: row.visual_style,
    logo_url: row.logo_url,
    logo_position: row.logo_position,
    logo_panel: row.logo_panel,
    logo_size: row.logo_size,
    ad_count: row.ad_count || 6,
    // Push-stage setup + last-push reference.
    page_id: row.page_id,
    page_name: row.page_name,
    lead_form_id: row.lead_form_id,
    lead_form_name: row.lead_form_name,
    daily_budget_pence: row.daily_budget_pence,
    target_countries: row.target_countries || 'GB',
    website_url: row.website_url || '',
    pushed_campaign_id: row.pushed_campaign_id,
    pushed_adset_id: row.pushed_adset_id,
    pushed_at: row.pushed_at,
    creatives,
  });
});

// Save the setup. Optional RAG file upload auto-extracts the brand block. A plain
// save (no file) leaves brand fields as sent / unchanged.
router.put('/:emailClientId/overview', upload.single('rag'), async (req, res) => {
  const id = req.params.emailClientId;
  const ec = db.prepare('SELECT id FROM email_clients WHERE id = ?').get(id);
  if (!ec) return res.status(404).json({ error: 'Customer not found' });

  let row = db.prepare('SELECT * FROM facebook_ads WHERE email_client_id = ?').get(id);
  if (!row) {
    db.prepare(`INSERT INTO facebook_ads (id, email_client_id, status) VALUES (?, ?, 'not_connected')`).run(uuid(), id);
    db.prepare(`INSERT OR IGNORE INTO customer_services (email_client_id, service_key, linked_external_id, enabled_by) VALUES (?, 'facebook_ads', NULL, 'admin')`).run(id);
    row = db.prepare('SELECT * FROM facebook_ads WHERE email_client_id = ?').get(id);
  }

  const b = req.body || {};
  const pick = (k) => (b[k] !== undefined ? b[k] : row[k]);
  let brand_colors     = pick('brand_colors');
  let logo_description = pick('logo_description');
  let type_style       = pick('type_style');
  let visual_style     = pick('visual_style');
  const ad_count     = b.ad_count !== undefined ? (parseInt(b.ad_count, 10) || row.ad_count || 6) : (row.ad_count || 6);
  const logo_position = b.logo_position !== undefined ? b.logo_position : row.logo_position;
  const logo_panel    = b.logo_panel    !== undefined ? b.logo_panel    : row.logo_panel;
  const logo_size     = b.logo_size     !== undefined ? b.logo_size     : row.logo_size;

  // Push-stage setup. Each saved independently (the screen auto-saves a single
  // field at a time), so only keys actually present in the body are changed.
  const page_id         = b.page_id         !== undefined ? (b.page_id || null)         : row.page_id;
  const page_name       = b.page_name       !== undefined ? (b.page_name || null)       : row.page_name;
  const lead_form_id    = b.lead_form_id    !== undefined ? (b.lead_form_id || null)    : row.lead_form_id;
  const lead_form_name  = b.lead_form_name  !== undefined ? (b.lead_form_name || null)  : row.lead_form_name;
  const target_countries = b.target_countries !== undefined ? (b.target_countries || 'GB') : (row.target_countries || 'GB');
  const website_url      = b.website_url      !== undefined ? (String(b.website_url || '').trim() || null) : row.website_url;
  let daily_budget_pence = row.daily_budget_pence;
  if (b.daily_budget_pence !== undefined) {
    const n = parseInt(b.daily_budget_pence, 10);
    daily_budget_pence = (Number.isFinite(n) && n > 0) ? n : null;
  }

  let rag_filename = row.rag_filename;
  let rag_content  = row.rag_content;
  if (req.file) {
    rag_filename = req.file.originalname;
    try { rag_content = await extractTextFromBuffer(req.file.buffer, req.file.originalname); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    // Auto-pull the brand block from the new Facebook RAG (null fields keep prior).
    try {
      const ex = await extractBrandFromRag(rag_content);
      brand_colors     = ex.brand_colors     ?? brand_colors;
      logo_description = ex.logo_description  ?? logo_description;
      type_style       = ex.type_style        ?? type_style;
      visual_style     = ex.visual_style      ?? visual_style;
    } catch (e) { console.warn('[fb-ads] brand auto-extract failed (non-fatal):', e.message); }
  }

  db.prepare(`
    UPDATE facebook_ads SET
      rag_filename=?, rag_content=?,
      brand_colors=?, logo_description=?, type_style=?, visual_style=?,
      ad_count=?, logo_position=?, logo_panel=?, logo_size=?,
      page_id=?, page_name=?, lead_form_id=?, lead_form_name=?,
      daily_budget_pence=?, target_countries=?, website_url=?,
      updated_at=datetime('now')
    WHERE email_client_id=?
  `).run(rag_filename, rag_content, brand_colors, logo_description, type_style, visual_style,
         ad_count, logo_position, logo_panel, logo_size,
         page_id, page_name, lead_form_id, lead_form_name,
         daily_budget_pence, target_countries, website_url, id);
  res.json({ ok: true });
});

// Re-pull the brand block from the stored Facebook RAG (the "Pull brand" button).
router.post('/:emailClientId/extract-brand', async (req, res) => {
  const row = db.prepare('SELECT * FROM facebook_ads WHERE email_client_id = ?').get(req.params.emailClientId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.rag_content) return res.status(400).json({ error: 'No Facebook RAG document uploaded yet.' });
  try {
    const ex = await extractBrandFromRag(row.rag_content);
    const found = Object.values(ex).filter(Boolean).length;
    db.prepare(`
      UPDATE facebook_ads SET
        brand_colors=COALESCE(?,brand_colors), logo_description=COALESCE(?,logo_description),
        type_style=COALESCE(?,type_style), visual_style=COALESCE(?,visual_style),
        updated_at=datetime('now')
      WHERE email_client_id=?
    `).run(ex.brand_colors, ex.logo_description, ex.type_style, ex.visual_style, req.params.emailClientId);
    const updated = db.prepare('SELECT * FROM facebook_ads WHERE email_client_id = ?').get(req.params.emailClientId);
    res.json({ ok: true, found, overview: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload the customer's Facebook logo (its own — not the LinkedIn one).
router.post('/:emailClientId/logo', upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No logo file uploaded.' });
  const id = req.params.emailClientId;
  const row = db.prepare('SELECT id FROM facebook_ads WHERE email_client_id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not a Facebook Ads customer' });
  try {
    const prepped = await prepareLogoForStorage(req.file.buffer, req.file.mimetype);
    const b64  = prepped.buffer.toString('base64');
    const mime = prepped.mimetype || req.file.mimetype || 'image/png';
    const logo_url = await uploadImageToR2(b64, mime, id, 'fblogo');
    db.prepare(`UPDATE facebook_ads SET logo_url=?, updated_at=datetime('now') WHERE email_client_id=?`).run(logo_url, id);
    res.json({ ok: true, logo_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generate `count` ad concepts from the Facebook RAG and store them as drafts.
router.post('/:emailClientId/generate', async (req, res) => {
  const cust = fbCustomer(req.params.emailClientId);
  if (!cust) return res.status(404).json({ error: 'Not a Facebook Ads customer' });
  if (!cust.rag_content) return res.status(400).json({ error: 'Upload a Facebook RAG document first.' });
  const count = Math.max(1, Math.min(12, parseInt(req.body?.count, 10) || cust.ad_count || 6));
  try {
    const creatives = await generateAdCreatives(cust, cust.rag_content, { count });
    const batch_id = uuid();
    const insert = db.prepare(`
      INSERT INTO facebook_ad_creatives
        (id, email_client_id, batch_id, hook_label, primary_text, headline, cta, image_brief, image_url, pre_logo_image_url, status)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'draft')
    `);
    const rows = [];
    const tx = db.transaction(() => {
      for (const c of creatives) {
        const cid = uuid();
        insert.run(cid, req.params.emailClientId, batch_id, c.hook_label, c.primary_text, c.headline, c.cta, c.image_brief, c.image_url, c.pre_logo_image_url);
        rows.push(db.prepare('SELECT * FROM facebook_ad_creatives WHERE id = ?').get(cid));
      }
    });
    tx();
    res.json({ ok: true, batch_id, creatives: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rewrite one creative's copy (keeps the image).
router.post('/:emailClientId/creatives/:id/regenerate-text', async (req, res) => {
  const cust = fbCustomer(req.params.emailClientId);
  if (!cust) return res.status(404).json({ error: 'Not found' });
  if (!cust.rag_content) return res.status(400).json({ error: 'No Facebook RAG document.' });
  const cr = db.prepare('SELECT * FROM facebook_ad_creatives WHERE id = ? AND email_client_id = ?').get(req.params.id, req.params.emailClientId);
  if (!cr) return res.status(404).json({ error: 'Creative not found' });
  try {
    const nv = await regenerateAdCopy(cust.rag_content, cr);
    db.prepare(`UPDATE facebook_ad_creatives SET hook_label=?, primary_text=?, headline=?, cta=?, image_brief=?, updated_at=datetime('now') WHERE id=?`)
      .run(nv.hook_label, nv.primary_text, nv.headline, nv.cta, nv.image_brief, req.params.id);
    res.json({ ok: true, creative: db.prepare('SELECT * FROM facebook_ad_creatives WHERE id=?').get(req.params.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Make a fresh image for one creative (keeps the copy). Resets per-creative logo
// overrides so the new image and its logo-less copy always match (same fix as
// the LinkedIn colour-revert bug — never keep a previous image's pre-logo).
router.post('/:emailClientId/creatives/:id/regenerate-image', async (req, res) => {
  const cust = fbCustomer(req.params.emailClientId);
  if (!cust) return res.status(404).json({ error: 'Not found' });
  const cr = db.prepare('SELECT * FROM facebook_ad_creatives WHERE id = ? AND email_client_id = ?').get(req.params.id, req.params.emailClientId);
  if (!cr) return res.status(404).json({ error: 'Creative not found' });
  try {
    const img = await regenerateAdImage(cust, cr);
    db.prepare(`UPDATE facebook_ad_creatives SET image_url=?, pre_logo_image_url=?, logo_position=NULL, logo_panel=NULL, logo_size=NULL, updated_at=datetime('now') WHERE id=?`)
      .run(img.image_url, img.pre_logo_image_url, req.params.id);
    res.json({ ok: true, creative: db.prepare('SELECT * FROM facebook_ad_creatives WHERE id=?').get(req.params.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-place the logo on one creative (position/size/background) — recomposites
// onto the stored logo-less copy, never regenerates.
router.post('/:emailClientId/creatives/:id/recomposite-logo', async (req, res) => {
  const cust = fbCustomer(req.params.emailClientId);
  if (!cust) return res.status(404).json({ error: 'Not found' });
  const cr = db.prepare('SELECT * FROM facebook_ad_creatives WHERE id = ? AND email_client_id = ?').get(req.params.id, req.params.emailClientId);
  if (!cr) return res.status(404).json({ error: 'Creative not found' });
  if (!cr.pre_logo_image_url) return res.status(400).json({ error: 'pre_logo_unavailable', message: 'Click New image first to enable the logo controls on this ad.' });
  const b = req.body || {};
  const overrides = {
    logo_position: b.logo_position ?? cr.logo_position ?? cust.logo_position,
    logo_size:     b.logo_size     ?? cr.logo_size     ?? cust.logo_size,
    logo_panel:    b.logo_panel    ?? cr.logo_panel    ?? cust.logo_panel,
  };
  try {
    const clientObj = { ...cust, ...overrides };
    const r = await recompositeLogoFromUrl(cr.pre_logo_image_url, clientObj, overrides);
    const image_url = await uploadImageToR2(r.data, r.mimeType, req.params.emailClientId, 'fbad-recomp');
    db.prepare(`UPDATE facebook_ad_creatives SET image_url=?, logo_position=?, logo_panel=?, logo_size=?, updated_at=datetime('now') WHERE id=?`)
      .run(image_url, overrides.logo_position, overrides.logo_panel, overrides.logo_size, req.params.id);
    res.json({ ok: true, creative: db.prepare('SELECT * FROM facebook_ad_creatives WHERE id=?').get(req.params.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Save hand-edited copy on one creative.
router.put('/:emailClientId/creatives/:id/text', (req, res) => {
  const cr = db.prepare('SELECT * FROM facebook_ad_creatives WHERE id = ? AND email_client_id = ?').get(req.params.id, req.params.emailClientId);
  if (!cr) return res.status(404).json({ error: 'Creative not found' });
  const b = req.body || {};
  const headline     = b.headline     !== undefined ? b.headline     : cr.headline;
  const primary_text = b.primary_text !== undefined ? b.primary_text : cr.primary_text;
  const cta          = b.cta          !== undefined ? normalizeCta(b.cta) : cr.cta;
  db.prepare(`UPDATE facebook_ad_creatives SET headline=?, primary_text=?, cta=?, updated_at=datetime('now') WHERE id=?`).run(headline, primary_text, cta, req.params.id);
  res.json({ ok: true });
});

// Approve / un-approve one creative.
router.post('/:emailClientId/creatives/:id/approve', (req, res) => {
  const cr = db.prepare('SELECT id FROM facebook_ad_creatives WHERE id = ? AND email_client_id = ?').get(req.params.id, req.params.emailClientId);
  if (!cr) return res.status(404).json({ error: 'Creative not found' });
  const approved = req.body?.approved !== false;
  db.prepare(`UPDATE facebook_ad_creatives SET status=?, updated_at=datetime('now') WHERE id=?`).run(approved ? 'approved' : 'draft', req.params.id);
  res.json({ ok: true, status: approved ? 'approved' : 'draft' });
});

// Delete one creative.
router.delete('/:emailClientId/creatives/:id', (req, res) => {
  db.prepare('DELETE FROM facebook_ad_creatives WHERE id = ? AND email_client_id = ?').run(req.params.id, req.params.emailClientId);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUSH TO FACEBOOK — create approved ads as PAUSED drafts (campaign→ad-set→ad).
// Studio creates everything PAUSED; the operator publishes in Ads Manager.
// ─────────────────────────────────────────────────────────────────────────────

// Page picker — the Facebook Pages the system user can see. Best-effort; falls
// back to a typed Page ID on the screen if this returns empty / errors.
router.get('/pages', async (req, res) => {
  if (!metaConfigured()) return res.json({ ok: false, error: 'Meta API is not configured.' });
  try { res.json({ ok: true, pages: await listPages() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// Lead-form picker — the instant Lead forms on this customer's saved Page (or a
// ?page_id= override). May come back empty even when a form exists if the system
// user lacks page-level leads access; the screen offers a typed form ID then.
router.get('/:emailClientId/lead-forms', async (req, res) => {
  if (!metaConfigured()) return res.json({ ok: false, error: 'Meta API is not configured.' });
  let pageId = req.query.page_id ? String(req.query.page_id) : null;
  if (!pageId) {
    const row = db.prepare('SELECT page_id FROM facebook_ads WHERE email_client_id = ?').get(req.params.emailClientId);
    pageId = row && row.page_id;
  }
  if (!pageId) return res.json({ ok: true, forms: [], no_page: true });
  try { res.json({ ok: true, forms: await listLeadForms(pageId) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// Push all APPROVED, not-yet-pushed creatives to Facebook as PAUSED drafts.
// History — every ad that's been pushed to Facebook for this customer, newest
// first. Keyed directly by the customer's own id (no cross-table hop). The
// frontend groups these by pushed_campaign_id into dated push blocks.
router.get('/:emailClientId/history', (req, res) => {
  const id = req.params.emailClientId;
  const ads = db.prepare(`
    SELECT id, hook_label, headline, primary_text, cta, image_url,
           fb_ad_id, pushed_campaign_id, pushed_campaign_name, pushed_at
    FROM facebook_ad_creatives
    WHERE email_client_id = ? AND status = 'pushed' AND fb_ad_id IS NOT NULL AND fb_ad_id != ''
    ORDER BY pushed_at DESC, rowid ASC
  `).all(id);
  res.json({ ads });
});

// Creates one Leads campaign + one ad set + one ad per creative. Stamps each
// creative with its Facebook ad id (so it won't be pushed twice) or its error.
router.post('/:emailClientId/push', async (req, res) => {
  if (!metaConfigured()) return res.status(400).json({ error: 'Meta API is not configured.' });
  const id = req.params.emailClientId;
  const row = db.prepare(`
    SELECT fa.*, ec.name AS customer_name
    FROM facebook_ads fa JOIN email_clients ec ON ec.id = fa.email_client_id
    WHERE fa.email_client_id = ?
  `).get(id);
  if (!row) return res.status(404).json({ error: 'Not a Facebook Ads customer' });

  // Required setup — refuse honestly rather than invent defaults (no silent
  // fallbacks; budget in particular must be set deliberately).
  if (!row.ad_account_id) return res.status(400).json({ error: 'Set this customer’s ad account ID first.' });
  if (!row.page_id)       return res.status(400).json({ error: 'Choose a Facebook Page first.' });
  if (!row.lead_form_id)  return res.status(400).json({ error: 'Choose a Lead form first.' });
  if (!(Number(row.daily_budget_pence) > 0)) return res.status(400).json({ error: 'Set a daily budget first.' });
  if (!row.website_url) return res.status(400).json({ error: 'Set the customer’s website URL first — Meta rejects lead ads that link to a Facebook page.' });

  const creatives = db.prepare(`
    SELECT * FROM facebook_ad_creatives
    WHERE email_client_id = ? AND status = 'approved' AND (fb_ad_id IS NULL OR fb_ad_id = '')
    ORDER BY created_at ASC, rowid ASC
  `).all(id);
  if (!creatives.length) return res.status(400).json({ error: 'No approved ads waiting to be pushed.' });

  const countries = String(row.target_countries || 'GB').split(',').map(s => s.trim()).filter(Boolean);
  const campaignName = `${row.customer_name} — Leads (Studio ${new Date().toISOString().slice(0, 10)})`;

  let result;
  try {
    result = await pushAdsToFacebook({
      adAccountId: row.ad_account_id,
      pageId: row.page_id,
      leadFormId: row.lead_form_id,
      dailyBudgetPence: row.daily_budget_pence,
      websiteUrl: row.website_url,
      countries,
      campaignName,
      creatives: creatives.map(c => ({
        id: c.id, hook_label: c.hook_label, headline: c.headline,
        primary_text: c.primary_text, cta: c.cta, image_url: c.image_url,
      })),
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }

  // Persist: stamp pushed creatives with their ad id, failures with the reason,
  // and record the campaign/ad-set on the customer row.
  const stampOk  = db.prepare(`UPDATE facebook_ad_creatives SET status='pushed', fb_ad_id=?, fb_creative_id=?, pushed_campaign_id=?, pushed_campaign_name=?, push_error=NULL, pushed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`);
  const stampErr = db.prepare(`UPDATE facebook_ad_creatives SET push_error=?, updated_at=datetime('now') WHERE id=?`);
  const tx = db.transaction(() => {
    for (const r of result.results) {
      if (r.ok) stampOk.run(r.ad_id, r.creative_id, result.campaign_id, campaignName, r.id);
      else stampErr.run(r.error || 'push failed', r.id);
    }
    if (result.campaign_id) {
      db.prepare(`UPDATE facebook_ads SET pushed_campaign_id=?, pushed_adset_id=?, pushed_at=datetime('now'), status='paused', updated_at=datetime('now') WHERE email_client_id=?`)
        .run(result.campaign_id, result.adset_id, id);
    }
  });
  tx();

  const labelById = new Map(creatives.map(c => [c.id, c.hook_label || 'Untitled ad']));
  const results = result.results.map(r => ({ id: r.id, label: labelById.get(r.id) || 'Ad', ok: r.ok, ad_id: r.ad_id, error: r.error }));
  const pushed = results.filter(r => r.ok).length;
  const failed = results.length - pushed;
  res.json({
    ok: true,
    campaign_id: result.campaign_id,
    adset_id: result.adset_id,
    campaign_name: campaignName,
    top_error: result.error || null,
    failed_step: result.failed_step || null,
    pushed, failed, results,
  });
});

export default router;
