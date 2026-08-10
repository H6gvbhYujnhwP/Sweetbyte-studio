import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { generatePosts, getLinkedInAlgorithmContext, regenerateSinglePost } from '../services/openai.js';
import { getCurrentBrief } from './algorithm.js';
import { generateImage, recompositeLogoFromUrl, sleep } from '../services/gemini.js';
import { uploadImageToR2 } from '../services/r2.js';
import { createDraft, queuePost, getContentDna } from '../services/supergrow.js';

const router = Router();
const sseClients = new Map();
const cancelledCampaigns = new Set(); // track in-flight cancellations

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function sendSSE(campaignId, data) {
  const clients = sseClients.get(campaignId) || [];
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => { try { res.write(payload); } catch (_) {} });
}

function updateCampaign(id, fields) {
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(fields), id];
  db.prepare(`UPDATE campaigns SET ${sets} WHERE id = ?`).run(...vals);
}

// Return a copy of the campaign row whose posts_json has each post enriched
// with this client's configured logo defaults (default_logo_position / _size
// / _panel). The admin post-card dropdowns read these so they reflect the
// operator's Brand panel settings instead of the hardcoded factory fallback.
// Mirrors the customer portal's projectPost (decision #65). Per-post overrides
// already on the post still take precedence on the frontend. Never throws —
// returns the campaign unchanged if anything goes wrong (worst case = old
// factory-default behaviour, never a crash).
function withLogoDefaults(campaign) {
  if (!campaign || !campaign.posts_json) return campaign;
  try {
    const client = db.prepare(
      'SELECT logo_position, logo_size, logo_panel FROM clients WHERE id = ?'
    ).get(campaign.client_id);
    const posts = JSON.parse(campaign.posts_json);
    const enriched = posts.map(p => ({
      ...p,
      default_logo_position: (client && client.logo_position) || 'bottom-right',
      default_logo_size:     (client && client.logo_size)     || 'small',
      default_logo_panel:    (client && client.logo_panel)    || 'white',
    }));
    return { ...campaign, posts_json: JSON.stringify(enriched) };
  } catch (_) {
    return campaign;
  }
}

// Same idea for a single post being returned to the frontend (after a regen
// or recomposite). Without the default_logo_* fields the just-updated card
// would lose its correct dropdown defaults until a full page reload. clientId
// is the campaign.client_id. Never throws.
function postWithLogoDefaults(post, clientId) {
  try {
    const client = db.prepare(
      'SELECT logo_position, logo_size, logo_panel FROM clients WHERE id = ?'
    ).get(clientId);
    return {
      ...post,
      default_logo_position: (client && client.logo_position) || 'bottom-right',
      default_logo_size:     (client && client.logo_size)     || 'small',
      default_logo_panel:    (client && client.logo_panel)    || 'white',
    };
  } catch (_) {
    return post;
  }
}

// ─── SSE progress stream ──────────────────────────────────────────────────────

router.get('/progress/:id', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { id } = req.params;
  if (!sseClients.has(id)) sseClients.set(id, []);
  sseClients.get(id).push(res);

  // Send current DB state immediately on connect
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (campaign) res.write(`data: ${JSON.stringify({ type: 'status', campaign: withLogoDefaults(campaign) })}\n\n`);

  req.on('close', () => {
    const list = sseClients.get(id) || [];
    sseClients.set(id, list.filter(r => r !== res));
  });
});

// ─── Campaign queries ─────────────────────────────────────────────────────────

router.get('/client/:clientId', requireAuth, (req, res) => {
  const campaigns = db.prepare('SELECT * FROM campaigns WHERE client_id = ? ORDER BY created_at DESC').all(req.params.clientId);
  res.json(campaigns);
});

router.get('/:id', requireAuth, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  res.json(withLogoDefaults(campaign));
});

// ─── Start campaign ───────────────────────────────────────────────────────────

router.post('/start/:clientId', requireAuth, async (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.rag_content) return res.status(400).json({ error: 'No RAG document uploaded for this client' });

  const campaignId = uuid();
  // How many posts this run. From the Generate dropdown; clamped 1–24, default 12.
  const postCount = Math.max(1, Math.min(24, Number(req.body?.postCount) || 12));
  db.prepare(`
    INSERT INTO campaigns (id, client_id, status, stage, progress, total_posts)
    VALUES (?, ?, 'running', 'generating_posts', 0, ?)
  `).run(campaignId, client.id, postCount);

  const includeImages = req.body?.includeImages !== false; // default true

  res.json({ campaignId });

  runCampaign(campaignId, client, includeImages, postCount).catch(err => {
    console.error('Campaign error:', err);
    updateCampaign(campaignId, { status: 'failed', stage: 'error', error_log: err.message });
    sendSSE(campaignId, { type: 'error', message: err.message });
  });
});

// ─── Two-button deploy (decision #72) ─────────────────────────────────────────
// Replaces the old single "Send drafts to Supergrow" button. Supergrow Drafts
// is no longer a destination — every route ends in Supergrow "scheduled".
//
//   Button 1  POST /:id/send-to-customer
//     Does NOT push to Supergrow. The campaign is ALREADY visible in the
//     customer portal the moment it reaches stage 'awaiting_approval' (the
//     portal reads awaiting_approval campaigns directly). This endpoint just
//     records that the operator has handed it to the customer. When the
//     customer clicks "Approve all" in their portal, the existing portal
//     approve-all path queues every post to Supergrow scheduled (and now
//     carries images, via decision #71). Stage stays 'awaiting_approval' so
//     the customer can still act on it; we stamp sent_to_customer_at for the
//     admin UI to show the "waiting on customer" state.
//
//   Button 2  POST /:id/deploy   (kept the same path so nothing else breaks)
//     Admin pushes directly, skipping the customer. queue_post every post →
//     Supergrow "scheduled" column, auto-publishes on Supergrow's calendar
//     slots. Campaign ends stage='done', deployed_by='admin'. The customer
//     still sees it in their portal as completed history (same as the
//     customer-portal approve-all end state).

router.post('/:id/send-to-customer', requireAuth, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.stage !== 'awaiting_approval') {
    return res.status(400).json({ error: `Cannot send from stage: ${campaign.stage}` });
  }

  const posts = JSON.parse(campaign.posts_json || '[]');
  if (!posts.length) return res.status(400).json({ error: 'No posts to send' });

  // No Supergrow call — the portal already shows awaiting_approval campaigns.
  // Stamp the handoff time so the admin UI can render the "waiting on
  // customer" banner instead of the action buttons. Stage is intentionally
  // left at awaiting_approval so the customer can approve and Button 2
  // remains available to the operator.
  updateCampaign(campaign.id, { sent_to_customer_at: new Date().toISOString() });

  res.json({ ok: true, total: posts.length, sent_to_customer: true });
});

router.post('/:id/deploy', requireAuth, async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.stage !== 'awaiting_approval') {
    return res.status(400).json({ error: `Cannot deploy from stage: ${campaign.stage}` });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(campaign.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.supergrow_workspace_id || !client.supergrow_api_key) {
    return res.status(400).json({ error: 'This client is not fully configured for Supergrow.' });
  }

  const posts = JSON.parse(campaign.posts_json || '[]');
  if (!posts.length) return res.status(400).json({ error: 'No posts to deploy' });

  res.json({ ok: true, total: posts.length });

  // Run deployment in background, send progress via SSE
  deployToQueue(campaign.id, client, posts).catch(err => {
    console.error('Deploy error:', err);
    updateCampaign(campaign.id, { status: 'failed', stage: 'error', error_log: err.message });
    sendSSE(campaign.id, { type: 'error', message: err.message });
  });
});

// ─── Regenerate image for a single post ──────────────────────────────────────

router.post('/:id/regenerate-image/:postIndex', requireAuth, async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  // Don't let a stale admin tab regenerate posts on a campaign that's already
  // been deployed (either by admin or by customer-portal approve-all). The
  // posts are already live in Supergrow's queue at this point — overwriting
  // them in the DB would create a desync between what the customer signed off
  // on and what's about to publish.
  if (campaign.stage === 'done') {
    return res.status(400).json({ error: 'Campaign is already deployed — regeneration is locked.' });
  }

  const postIndex = parseInt(req.params.postIndex, 10);
  const posts = JSON.parse(campaign.posts_json || '[]');
  if (postIndex < 0 || postIndex >= posts.length) {
    return res.status(400).json({ error: `Post index ${postIndex} out of range` });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(campaign.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Respond immediately — image gen runs async
  res.json({ ok: true, postIndex });

  try {
    const post = posts[postIndex];
    const imageData = await generateImage(
      post.image_prompt || `Professional LinkedIn image for: ${post.topic}`,
      client,
      post
    );
    const imageUrl = await uploadImageToR2(imageData.data, imageData.mimeType, client.id, post.id || `post-${postIndex}`);

    // Also store the pre-logo bytes (Gemini's raw output before the logo
    // paste) so the per-post recomposite endpoint can re-run only the
    // composite step when the customer changes per-post logo dropdowns.
    // Stored under a sibling key in the same R2 prefix shape; failing to
    // upload it is non-fatal (the main image is still good, the customer
    // just won't be able to use the per-post logo dropdowns on this post
    // until they click New image again).
    let preLogoUrl = null;
    if (imageData.preLogoData) {
      try {
        preLogoUrl = await uploadImageToR2(
          imageData.preLogoData,
          imageData.preLogoMime,
          client.id,
          `${post.id || `post-${postIndex}`}-prelogo`
        );
      } catch (e) {
        console.warn(`[campaigns] pre-logo upload failed (non-fatal): ${e.message}`);
      }
    }

    posts[postIndex] = {
      ...post,
      image_url: imageUrl,
      // A fresh image was just generated, so its logo-less (pre-logo) copy MUST
      // be the one stored here — NEVER fall back to a previous generation's
      // pre-logo. The old fallback ( `|| post.pre_logo_image_url` ) let the
      // displayed image and its pre-logo copy drift apart: a later logo-dropdown
      // re-composite then pasted the logo onto the OLD copy and silently
      // reverted the colours (RGS green → old blue). If the new pre-logo upload
      // failed, store null — the logo dropdowns disable with a "click New image"
      // hint, which is honest, rather than reverting the customer's brand colours.
      pre_logo_image_url: preLogoUrl,
      // Reset any per-post overrides on a full regen — fresh image, fresh
      // dropdown state at the customer-level default.
      logo_position: null,
      logo_size: null,
      logo_panel: null,
      image_error: undefined,
    };
    updateCampaign(campaign.id, { posts_json: JSON.stringify(posts) });
    sendSSE(campaign.id, {
      type: 'post_updated',
      postIndex,
      post: postWithLogoDefaults(posts[postIndex], campaign.client_id),
      message: `✓ Image regenerated for post ${postIndex + 1}.`
    });
  } catch (err) {
    console.error(`Regen image failed post ${postIndex}:`, err.message);
    sendSSE(campaign.id, {
      type: 'post_update_error',
      postIndex,
      message: `Image regen failed: ${err.message}`
    });
  }
});

// ─── Recomposite logo for a single post (admin mirror of the portal one) ───────
// Per-post logo Position/Size/Background override. Re-runs ONLY the compositor
// on the post's stored pre-logo image — no Gemini call, no AI cost, ~½ sec.
// Mirrors the customer-portal POST /api/portal/posts/:id/recomposite-logo
// behaviour exactly (decision #65) but on the admin side with admin auth and
// posts addressed by index in posts_json. Uses the SAME shared
// recompositeLogoFromUrl service the portal uses — no duplicate compositor.
// Returns 400 { error:'pre_logo_unavailable' } for posts generated before the
// pre-logo storage feature shipped, so the admin card shows the same "click
// New image to enable" hint the customer card does.
router.post('/:id/recomposite-logo/:postIndex', requireAuth, async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  // Same deployed-lock as regenerate-image: once a campaign is done its posts
  // are live/queued in Supergrow — don't let a stale tab mutate them.
  if (campaign.stage === 'done') {
    return res.status(400).json({ error: 'Campaign is already deployed — logo changes are locked.' });
  }

  const postIndex = parseInt(req.params.postIndex, 10);
  const posts = JSON.parse(campaign.posts_json || '[]');
  if (postIndex < 0 || postIndex >= posts.length) {
    return res.status(400).json({ error: `Post index ${postIndex} out of range` });
  }

  const ALLOWED_POSITIONS = ['bottom-right', 'top-right', 'bottom-left', 'top-left'];
  const ALLOWED_SIZES     = ['small', 'medium', 'large'];
  const ALLOWED_PANELS    = ['white', 'none'];

  const reqPosition = req.body?.logo_position;
  const reqSize     = req.body?.logo_size;
  const reqPanel    = req.body?.logo_panel;

  if (reqPosition !== undefined && reqPosition !== null && !ALLOWED_POSITIONS.includes(reqPosition)) {
    return res.status(400).json({ error: `Invalid logo_position: ${reqPosition}` });
  }
  if (reqSize !== undefined && reqSize !== null && !ALLOWED_SIZES.includes(reqSize)) {
    return res.status(400).json({ error: `Invalid logo_size: ${reqSize}` });
  }
  if (reqPanel !== undefined && reqPanel !== null && !ALLOWED_PANELS.includes(reqPanel)) {
    return res.status(400).json({ error: `Invalid logo_panel: ${reqPanel}` });
  }

  const post = posts[postIndex];
  if (!post.pre_logo_image_url) {
    return res.status(400).json({
      error: 'pre_logo_unavailable',
      message: 'This post was generated before per-post logo controls were available. Click "New image" to enable them on this post.',
    });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(campaign.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.logo_url) {
    return res.status(400).json({ error: 'No customer logo configured — re-composite has nothing to place.' });
  }

  // Supplied value wins; else keep the post's existing override; else fall
  // back to the customer-level default (handled inside compositeLogo). So
  // changing only Position preserves the existing Size/Panel overrides.
  const effectivePosition = (reqPosition !== undefined && reqPosition !== null)
    ? reqPosition : (post.logo_position || null);
  const effectiveSize = (reqSize !== undefined && reqSize !== null)
    ? reqSize : (post.logo_size || null);
  const effectivePanel = (reqPanel !== undefined && reqPanel !== null)
    ? reqPanel : (post.logo_panel || null);

  let newImageUrl;
  try {
    const overrides = {};
    if (effectivePosition) overrides.logo_position = effectivePosition;
    if (effectiveSize)     overrides.logo_size     = effectiveSize;
    if (effectivePanel)    overrides.logo_panel    = effectivePanel;

    const imageData = await recompositeLogoFromUrl(post.pre_logo_image_url, client, overrides);
    newImageUrl = await uploadImageToR2(
      imageData.data,
      imageData.mimeType,
      client.id,
      `${post.id || `post-${postIndex}`}-recomp`
    );
  } catch (err) {
    console.error(`[campaigns] recomposite-logo failed post ${postIndex}:`, err.message);
    return res.status(502).json({ error: `Logo re-composite failed: ${err.message}` });
  }

  posts[postIndex] = {
    ...post,
    image_url: newImageUrl,
    logo_position: effectivePosition,
    logo_size:     effectiveSize,
    logo_panel:    effectivePanel,
  };
  updateCampaign(campaign.id, { posts_json: JSON.stringify(posts) });

  res.json({ ok: true, postIndex, post: postWithLogoDefaults(posts[postIndex], campaign.client_id) });
});

// ─── Regenerate post text for a single post ───────────────────────────────────

router.post('/:id/regenerate-post/:postIndex', requireAuth, async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  // See the equivalent guard on regenerate-image — blocks regeneration once
  // posts have been pushed to Supergrow.
  if (campaign.stage === 'done') {
    return res.status(400).json({ error: 'Campaign is already deployed — regeneration is locked.' });
  }

  const postIndex = parseInt(req.params.postIndex, 10);
  const posts = JSON.parse(campaign.posts_json || '[]');
  if (postIndex < 0 || postIndex >= posts.length) {
    return res.status(400).json({ error: `Post index ${postIndex} out of range` });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(campaign.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  res.json({ ok: true, postIndex });

  try {
    const post = posts[postIndex];
    const rewritten = await regenerateSinglePost(post, client);

    posts[postIndex] = {
      ...post,
      linkedin_post_text: rewritten.linkedin_post_text,
      image_prompt: rewritten.image_prompt || post.image_prompt
    };
    updateCampaign(campaign.id, { posts_json: JSON.stringify(posts) });
    sendSSE(campaign.id, {
      type: 'post_updated',
      postIndex,
      post: postWithLogoDefaults(posts[postIndex], campaign.client_id),
      message: `✓ Post ${postIndex + 1} text regenerated by GPT-4o.`
    });
  } catch (err) {
    console.error(`Regen post failed post ${postIndex}:`, err.message);
    sendSSE(campaign.id, {
      type: 'post_update_error',
      postIndex,
      message: `Post regen failed: ${err.message}`
    });
  }
});

// ─── Edit post text inline ────────────────────────────────────────────────────

router.patch('/:id/edit-post/:postIndex', requireAuth, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  // See the regenerate guards above — once a campaign has been deployed to
  // Supergrow, the admin can't edit text on the stored posts because that'd
  // create a desync between what's in our DB and what's in Supergrow's queue.
  if (campaign.stage === 'done') {
    return res.status(400).json({ error: 'Campaign is already deployed — editing is locked.' });
  }

  const postIndex = parseInt(req.params.postIndex, 10);
  const posts = JSON.parse(campaign.posts_json || '[]');
  if (postIndex < 0 || postIndex >= posts.length) {
    return res.status(400).json({ error: `Post index ${postIndex} out of range` });
  }

  const { linkedin_post_text } = req.body;
  if (typeof linkedin_post_text !== 'string' || !linkedin_post_text.trim()) {
    return res.status(400).json({ error: 'linkedin_post_text is required' });
  }

  posts[postIndex] = { ...posts[postIndex], linkedin_post_text: linkedin_post_text.trim() };
  updateCampaign(campaign.id, { posts_json: JSON.stringify(posts) });

  res.json({ ok: true, post: postWithLogoDefaults(posts[postIndex], campaign.client_id) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Cancel a running campaign ───────────────────────────────────────────────

router.post('/:id/cancel', requireAuth, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (!['running', 'awaiting_approval'].includes(campaign.status)) {
    return res.status(400).json({ error: `Campaign is ${campaign.status} — cannot cancel` });
  }
  cancelledCampaigns.add(req.params.id);
  updateCampaign(req.params.id, { status: 'failed', stage: 'error', error_log: 'Cancelled by operator' });
  sendSSE(req.params.id, { type: 'error', message: 'Campaign cancelled by operator.' });
  res.json({ ok: true });
});

// ─── Add more posts to an existing campaign (admin only) ─────────────────────
// Appends freshly-generated posts to a campaign that is STILL IN REVIEW
// (stage 'awaiting_approval'). Blocked once deployed/approved (stage 'done').
// The new posts are told which topics/angles already exist so there are no
// duplicates, get images only if the campaign already has images, and use
// whatever image engine the client is set to (so gpt_image clients get
// designed ads). Synchronous — keep top-ups modest (3–6) for a snappy
// response; large adds take a while because each image is generated in turn.
router.post('/:id/add-posts', requireAuth, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.stage !== 'awaiting_approval') {
    return res.status(400).json({ error: `Posts can only be added while a campaign is in review (current stage: ${campaign.stage}).` });
  }
  if (campaign.add_status === 'running') {
    return res.status(409).json({ error: 'Already adding posts — let the current batch finish.' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(campaign.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const count = Math.max(1, Math.min(24, Number(req.body?.count) || 3));

  // Mark the add as started and respond IMMEDIATELY. The actual writing +
  // image generation runs in the background (like the main campaign run) and
  // streams progress over SSE. We also persist add_status/add_done/add_total so
  // the 8-second polling fallback can drive the progress bar even if the live
  // feed drops. Previously this whole job ran inside the request, so a big batch
  // (e.g. 12 posts × ~7s/image) blew past the browser/proxy timeout and nothing
  // came back — the posts never appeared.
  updateCampaign(campaign.id, { add_status: 'running', add_done: 0, add_total: count });
  sendSSE(campaign.id, { type: 'progress', add_status: 'running', add_done: 0, add_total: count });
  res.json({ ok: true, adding: count });

  runAddPosts(campaign, client, count).catch(err => {
    console.error('[campaigns] add-posts background failed:', err.message);
    // Leave the existing posts intact; just clear the flag and surface the error.
    updateCampaign(campaign.id, { add_status: 'error' });
    sendSSE(campaign.id, { type: 'progress', add_status: 'error' });
    sendSSE(campaign.id, { type: 'log', message: `Add posts failed: ${err.message}` });
  });
});

// Background worker for add-posts. Appends `count` fresh posts to a campaign
// that's in review, generating images to match the existing set, and reports
// progress as it goes. Never changes the campaign's stage — it stays in review
// the whole time so the operator's approve buttons come straight back when done.
async function runAddPosts(campaign, client, count) {
  const existing = JSON.parse(campaign.posts_json || '[]');
  const existingTopics = existing
    .map(p => [p.topic, p.angle].filter(Boolean).join(' — '))
    .filter(Boolean);
  const includeImages = (campaign.images_generated || 0) > 0;

  let contentDna = null;
  try { contentDna = await getContentDna(client.supergrow_workspace_id, client.supergrow_api_key); } catch (_) {}
  const algorithmBrief = getCurrentBrief();

  // 1) Write the new post text. Give each a fresh id so image keys can't collide.
  const generated = await generatePosts(client, () => {}, contentDna, algorithmBrief, count, existingTopics);
  const newPosts = (generated.posts || []).map(p => ({ ...p, id: p.id || uuid(), image_url: null }));
  const addTotal = newPosts.length;

  // Append immediately so the new cards show right away (as "Generating…" if
  // images are still to come), then let the frontend load the combined set.
  const combined = existing.concat(newPosts);
  const baseIndex = existing.length;
  updateCampaign(campaign.id, {
    posts_json: JSON.stringify(combined),
    posts_generated: combined.length,
    total_posts: combined.length,
    add_total: addTotal,
    add_done: includeImages ? 0 : addTotal,
  });
  sendSSE(campaign.id, { type: 'status', campaign: withLogoDefaults(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign.id)) });
  sendSSE(campaign.id, { type: 'progress', add_status: 'running', add_total: addTotal, add_done: includeImages ? 0 : addTotal });

  // 2) Images, one at a time — bump the bar and fill each card in as it lands.
  if (includeImages) {
    const delay = client.image_engine === 'gpt_image' ? 1000 : 7000;
    for (let i = 0; i < newPosts.length; i++) {
      const post = newPosts[i];
      let finalPost;
      try {
        const imageData = await generateImage(
          post.image_prompt || `Professional LinkedIn image for: ${post.topic}`,
          client,
          post
        );
        const imageUrl = await uploadImageToR2(imageData.data, imageData.mimeType, client.id, post.id);
        let preLogoUrl = null;
        if (imageData.preLogoData) {
          try {
            preLogoUrl = await uploadImageToR2(imageData.preLogoData, imageData.preLogoMime, client.id, `${post.id}-prelogo`);
          } catch (e) {
            console.warn(`[campaigns] add-posts pre-logo upload failed (non-fatal): ${e.message}`);
          }
        }
        finalPost = { ...post, image_url: imageUrl, pre_logo_image_url: preLogoUrl };
      } catch (err) {
        console.error('[campaigns] add-posts image failed:', err.message);
        finalPost = { ...post, image_url: null, image_error: err.message };
      }
      combined[baseIndex + i] = finalPost;
      const imagesGenerated = combined.filter(p => p.image_url).length;
      updateCampaign(campaign.id, {
        posts_json: JSON.stringify(combined),
        images_generated: imagesGenerated,
        add_done: i + 1,
      });
      sendSSE(campaign.id, { type: 'post_updated', postIndex: baseIndex + i, post: finalPost, message: `New post ${i + 1}/${addTotal} ready` });
      sendSSE(campaign.id, { type: 'progress', add_status: 'running', add_done: i + 1, add_total: addTotal, images_generated: imagesGenerated });
      if (i < newPosts.length - 1) await sleep(delay);
    }
  }

  // 3) Done — clear the flag; the campaign stays in review with the new posts.
  updateCampaign(campaign.id, { add_status: null, add_done: addTotal, add_total: addTotal });
  sendSSE(campaign.id, { type: 'progress', add_status: 'done', add_done: addTotal, add_total: addTotal });
  sendSSE(campaign.id, { type: 'status', campaign: withLogoDefaults(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign.id)) });
  sendSSE(campaign.id, { type: 'log', message: `Added ${addTotal} post${addTotal === 1 ? '' : 's'}.` });
}

// ─── Campaign pipeline ────────────────────────────────────────────────────────

async function runCampaign(campaignId, client, includeImages = true, postCount = 12) {
  try {
    // ── Fetch Content DNA ──────────────────────────────────────────────────────
    let contentDna = null;
    try {
      sendSSE(campaignId, { type: 'log', message: 'Fetching Content DNA from Supergrow...' });
      contentDna = await getContentDna(client.supergrow_workspace_id, client.supergrow_api_key);
      sendSSE(campaignId, { type: 'log', message: contentDna
        ? 'Content DNA loaded — posts will match writing style.'
        : 'No Content DNA found — proceeding without style data.' });
    } catch (err) {
      sendSSE(campaignId, { type: 'log', message: `Content DNA unavailable (${err.message}) — proceeding.` });
    }

    // ── Stage 1: Generate posts via Claude Sonnet ───────────────────────────────
    // Stage 1: Generate posts via Claude Sonnet
    sendSSE(campaignId, { type: 'log', message: 'Starting post generation with Claude Sonnet...' });
    updateCampaign(campaignId, { stage: 'generating_posts', progress: 5 });

    // Pull the latest algorithm brief from the DB (null if never run)
    const algorithmBrief = getCurrentBrief();
    if (algorithmBrief) {
      sendSSE(campaignId, { type: 'log', message: '\u2713 Algorithm brief loaded \u2014 posts will follow latest LinkedIn best practices.' });
    } else {
      sendSSE(campaignId, { type: 'log', message: 'No algorithm brief found \u2014 Claude will research LinkedIn trends inline.' });
    }

    const generated = await generatePosts(
      client,
      msg => sendSSE(campaignId, { type: 'log', message: msg }),
      contentDna,
      algorithmBrief,
      postCount
    );

    const posts = generated.posts;

    updateCampaign(campaignId, {
      stage: 'scoring_posts',
      progress: 25,
      posts_generated: posts.length,
      total_posts: posts.length,
      posts_json: JSON.stringify(posts)
    });
    sendSSE(campaignId, { type: 'progress', stage: 'scoring_posts', progress: 25, posts_generated: posts.length });

    // ── Stage 2: Scoring skipped — score_post MCP consistently times out.
    // Posts proceed directly to image generation at full quality from GPT-4o.
    const scoredPosts = posts;
    sendSSE(campaignId, { type: 'log', message: `✓ ${posts.length} posts ready — Proceeding to image generation.` });

    // ── Stage 3: Generate images (skipped if includeImages=false) ───────────────
    if (!includeImages) {
      sendSSE(campaignId, { type: 'log', message: 'Skipping image generation (text-only campaign).' });
      const postsNoImages = scoredPosts.map(p => ({ ...p, image_url: null }));
      updateCampaign(campaignId, {
        stage: 'awaiting_approval', status: 'awaiting_approval', progress: 95,
        posts_json: JSON.stringify(postsNoImages)
      });
      sendSSE(campaignId, {
        type: 'awaiting_approval',
        total: postsNoImages.length,
        images: 0,
        message: `${postsNoImages.length} posts ready (text only). Review below, then send to Supergrow as drafts.`
      });
      return;
    }

    updateCampaign(campaignId, { stage: 'generating_images', progress: 35 });
    sendSSE(campaignId, { type: 'progress', stage: 'generating_images', progress: 35, posts_generated: scoredPosts.length });

    const enrichedPosts = [];
    const RATE_LIMIT_DELAY = 7000;

    for (let i = 0; i < scoredPosts.length; i++) {
      const post = scoredPosts[i];

      // Check if operator cancelled while we were generating
      if (cancelledCampaigns.has(campaignId)) {
        cancelledCampaigns.delete(campaignId);
        return;
      }

      try {
        sendSSE(campaignId, { type: 'log', message: `Generating image ${i + 1}/${scoredPosts.length}...` });
        const imageData = await generateImage(
          post.image_prompt || `Professional LinkedIn image for: ${post.topic}`,
          client,
          post
        );
        const imageUrl = await uploadImageToR2(imageData.data, imageData.mimeType, client.id, post.id);

        // Also store the pre-logo bytes for the per-post recomposite path.
        // Non-fatal if it fails — see equivalent comment in the single-post
        // regen route above.
        let preLogoUrl = null;
        if (imageData.preLogoData) {
          try {
            preLogoUrl = await uploadImageToR2(
              imageData.preLogoData,
              imageData.preLogoMime,
              client.id,
              `${post.id}-prelogo`
            );
          } catch (e) {
            console.warn(`[campaigns] pre-logo upload failed (non-fatal): ${e.message}`);
          }
        }

        enrichedPosts.push({
          ...post,
          image_url: imageUrl,
          pre_logo_image_url: preLogoUrl,
        });
        sendSSE(campaignId, { type: 'log', message: `✓ Image ${i + 1} generated and uploaded.` });
      } catch (err) {
        console.error(`Image gen failed for post ${i + 1}:`, err.message);
        enrichedPosts.push({ ...post, image_url: null, image_error: err.message });

        // Give a clear, actionable message for quota exhaustion
        let logMsg;
        if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('quota')) {
          logMsg = `⚠️ Image ${i + 1}: Gemini free tier quota exhausted — resets midnight Pacific. Posts will continue without images.`;
        } else {
          logMsg = `Image ${i + 1} failed (${err.message}) — post kept without image.`;
        }
        sendSSE(campaignId, { type: 'log', message: logMsg });
      }

      const progress = 35 + Math.round((i + 1) / scoredPosts.length * 55);
      updateCampaign(campaignId, {
        progress,
        images_generated: i + 1,
        posts_json: JSON.stringify(enrichedPosts)
      });
      sendSSE(campaignId, { type: 'progress', stage: 'generating_images', images_generated: i + 1, total: scoredPosts.length });

      // Only apply rate-limit delay after a successful image generation
      const lastPost = enrichedPosts[enrichedPosts.length - 1];
      if (i < scoredPosts.length - 1 && lastPost?.image_url) await sleep(RATE_LIMIT_DELAY);
    }

    // ── Stage 4: Await operator approval ─────────────────────────────────────
    // Pipeline stops here. Operator reviews all posts + images in the app,
    // then clicks "Send to Supergrow as Drafts" to trigger deployment.
    updateCampaign(campaignId, {
      stage: 'awaiting_approval',
      status: 'awaiting_approval',
      progress: 95,
      posts_json: JSON.stringify(enrichedPosts)
    });

    sendSSE(campaignId, {
      type: 'awaiting_approval',
      total: enrichedPosts.length,
      images: enrichedPosts.filter(p => p.image_url).length,
      message: `${enrichedPosts.length} posts and ${enrichedPosts.filter(p => p.image_url).length} images are ready. Review below, then send to Supergrow as drafts.`
    });

  } catch (err) {
    updateCampaign(campaignId, { status: 'failed', stage: 'error', error_log: err.message });
    sendSSE(campaignId, { type: 'error', message: err.message });
    throw err;
  }
}

// ─── Deployment pipeline (runs after operator approves) ───────────────────────
// All posts are ALWAYS sent as drafts via create_post.
// Clients approve inside Supergrow before anything goes to LinkedIn.

// deployToQueue (decision #72, Button 2) — queue_post every post so Supergrow
// auto-schedules it into the "scheduled" kanban column. Mirrors deployToDrafts'
// structure exactly (sequential to preserve post order, one retry per post,
// app_url written back, same terminal stage/state) — only the Supergrow call
// (queuePost vs createDraft) and the log wording differ. queuePost carries the
// image via the media flow (decision #71). Supergrow owns the actual posting
// time (its calendar slots) — there is no API to set an explicit datetime.
//
// deployToDrafts is kept below, unused, until this path is confirmed in
// production (same caution as decision #71 — don't delete the fallback yet).
async function deployToQueue(campaignId, client, posts) {
  updateCampaign(campaignId, { stage: 'deploying', status: 'running', progress: 95 });
  sendSSE(campaignId, { type: 'progress', stage: 'deploying' });

  const results = [];
  let deployed = 0;

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    try {
      sendSSE(campaignId, { type: 'log', message: `Scheduling post ${i + 1}/${posts.length} in Supergrow...` });

      const result = await queuePost({
        workspaceId: client.supergrow_workspace_id,
        apiKey: client.supergrow_api_key,
        postText: post.linkedin_post_text,
        imageUrl: post.image_url || null
      });

      let supergrowPostId = null;
      let supergrowAppUrl = null;
      try {
        const raw = result?.content;
        const text = typeof raw === 'string' ? raw
          : Array.isArray(raw) ? (raw.find(b => b.type === 'text')?.text ?? '') : '';
        const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
        const parsed = JSON.parse(clean);
        supergrowPostId = parsed?.post?.id ?? null;
        supergrowAppUrl = parsed?.post?.app_url ?? null;
      } catch (_) {}

      posts[i] = { ...post, supergrow_post_id: supergrowPostId, supergrow_app_url: supergrowAppUrl };

      results.push({ postId: post.id, status: 'success', result });
      deployed++;
      sendSSE(campaignId, { type: 'log', message: `✓ Post ${i + 1} scheduled in Supergrow.` });

    } catch (err) {
      console.error(`Schedule failed for post ${i + 1}:`, err.message);
      try {
        await sleep(2000);
        const retry = await queuePost({
          workspaceId: client.supergrow_workspace_id,
          apiKey: client.supergrow_api_key,
          postText: post.linkedin_post_text,
          imageUrl: post.image_url || null
        });

        try {
          const raw = retry?.content;
          const text = typeof raw === 'string' ? raw
            : Array.isArray(raw) ? (raw.find(b => b.type === 'text')?.text ?? '') : '';
          const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
          const parsed = JSON.parse(clean);
          posts[i] = { ...post, supergrow_post_id: parsed?.post?.id ?? null, supergrow_app_url: parsed?.post?.app_url ?? null };
        } catch (_) {}

        results.push({ postId: post.id, status: 'success_retry', result: retry });
        deployed++;
        sendSSE(campaignId, { type: 'log', message: `✓ Post ${i + 1} scheduled (retry succeeded).` });
      } catch (retryErr) {
        results.push({ postId: post.id, status: 'failed', error: retryErr.message });
        sendSSE(campaignId, { type: 'log', message: `✗ Post ${i + 1} failed: ${retryErr.message}` });
      }
    }

    const progress = 95 + Math.round((i + 1) / posts.length * 4);
    updateCampaign(campaignId, { progress, posts_deployed: deployed });
    sendSSE(campaignId, { type: 'progress', stage: 'deploying', posts_deployed: i + 1, total: posts.length });
    await sleep(500);
  }

  const files = buildOutputFiles(client, posts, results);

  updateCampaign(campaignId, {
    status: 'completed',
    stage: 'done',
    deployed_by: 'admin',
    progress: 100,
    posts_deployed: deployed,
    posts_json: JSON.stringify(posts),
    files_json: JSON.stringify(files),
    completed_at: new Date().toISOString()
  });

  sendSSE(campaignId, { type: 'complete', deployed, total: posts.length, files });
}

async function deployToDrafts(campaignId, client, posts) {
  updateCampaign(campaignId, { stage: 'deploying', status: 'running', progress: 95 });
  sendSSE(campaignId, { type: 'progress', stage: 'deploying' });

  const results = [];
  let deployed = 0;

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    try {
      sendSSE(campaignId, { type: 'log', message: `Sending post ${i + 1}/${posts.length} to Supergrow as draft...` });

      // ALWAYS create_post (draft) — never queue_post
      // Client approves in Supergrow before anything publishes to LinkedIn
      const result = await createDraft({
        workspaceId: client.supergrow_workspace_id,
        apiKey: client.supergrow_api_key,
        postText: post.linkedin_post_text,
        imageUrl: post.image_url || null
      });

      // Extract app_url and post id from Supergrow response
      let supergrowPostId = null;
      let supergrowAppUrl = null;
      try {
        const raw = result?.content;
        const text = typeof raw === 'string' ? raw
          : Array.isArray(raw) ? (raw.find(b => b.type === 'text')?.text ?? '') : '';
        const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
        const parsed = JSON.parse(clean);
        supergrowPostId = parsed?.post?.id ?? null;
        supergrowAppUrl = parsed?.post?.app_url ?? null;
      } catch (_) {}

      // Write app_url back into posts_json so the review grid can link to Supergrow
      posts[i] = { ...post, supergrow_post_id: supergrowPostId, supergrow_app_url: supergrowAppUrl };

      results.push({ postId: post.id, status: 'success', result });
      deployed++;
      sendSSE(campaignId, { type: 'log', message: `✓ Post ${i + 1} saved as draft in Supergrow.` });

    } catch (err) {
      console.error(`Deploy failed for post ${i + 1}:`, err.message);
      // Retry once
      try {
        await sleep(2000);
        const retry = await createDraft({
          workspaceId: client.supergrow_workspace_id,
          apiKey: client.supergrow_api_key,
          postText: post.linkedin_post_text,
          imageUrl: post.image_url || null
        });

        // Extract app_url from retry response
        try {
          const raw = retry?.content;
          const text = typeof raw === 'string' ? raw
            : Array.isArray(raw) ? (raw.find(b => b.type === 'text')?.text ?? '') : '';
          const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
          const parsed = JSON.parse(clean);
          posts[i] = { ...post, supergrow_post_id: parsed?.post?.id ?? null, supergrow_app_url: parsed?.post?.app_url ?? null };
        } catch (_) {}

        results.push({ postId: post.id, status: 'success_retry', result: retry });
        deployed++;
        sendSSE(campaignId, { type: 'log', message: `✓ Post ${i + 1} sent (retry succeeded).` });
      } catch (retryErr) {
        results.push({ postId: post.id, status: 'failed', error: retryErr.message });
        sendSSE(campaignId, { type: 'log', message: `✗ Post ${i + 1} failed: ${retryErr.message}` });
      }
    }

    const progress = 95 + Math.round((i + 1) / posts.length * 4);
    updateCampaign(campaignId, { progress, posts_deployed: deployed });
    sendSSE(campaignId, { type: 'progress', stage: 'deploying', posts_deployed: i + 1, total: posts.length });
    await sleep(500);
  }

  const files = buildOutputFiles(client, posts, results);

  updateCampaign(campaignId, {
    status: 'completed',
    stage: 'done',
    deployed_by: 'admin',
    progress: 100,
    posts_deployed: deployed,
    posts_json: JSON.stringify(posts),
    files_json: JSON.stringify(files),
    completed_at: new Date().toISOString()
  });

  sendSSE(campaignId, { type: 'complete', deployed, total: posts.length, files });
}

// ─── Output file builder ──────────────────────────────────────────────────────

function buildOutputFiles(client, posts, results) {
  const successCount = results.filter(r => r.status === 'success' || r.status === 'success_retry').length;
  const failedResults = results.filter(r => r.status === 'failed');

  const postsMarkdown = posts.map((p, i) => {
    const scoreNote = p.quality_score != null
      ? ` | Score: ${p.quality_score}/100${p.quality_score_fixed ? ' (auto-fixed)' : ''}`
      : '';
    const scheduleNote = p.suggested_day ? ` | ${p.suggested_day} ${p.suggested_time}` : '';
    return `## Post ${i + 1}: ${p.topic || ''}${scoreNote}${scheduleNote}

**Pillar:** ${p.content_pillar || ''} | **Format:** ${p.format || 'Text Post'}
**Angle:** ${p.angle || ''}
**Segment:** ${p.buyer_segment || ''}
**CTA:** ${p.cta_type || ''}

${p.linkedin_post_text}

---
`;
  }).join('\n');

  const postsJson = JSON.stringify(posts.map(p => ({
    id: p.id,
    topic: p.topic,
    linkedin_post_text: p.linkedin_post_text,
    image_urls: p.image_url ? [p.image_url] : [],
    workspace_id: client.supergrow_workspace_id,
    quality_score: p.quality_score ?? null,
    quality_score_fixed: p.quality_score_fixed ?? false,
    suggested_day: p.suggested_day ?? null,
    suggested_time: p.suggested_time ?? null,
    content_pillar: p.content_pillar ?? null,
    format: p.format ?? null
  })), null, 2);

  const csvRows = posts.map(p =>
    `"${p.id}","${(p.linkedin_post_text || '').replace(/"/g, '""')}","${p.image_url || ''}","${client.supergrow_workspace_id}","${p.suggested_day || ''}","${p.suggested_time || ''}"`
  ).join('\n');

  const scheduleTracker = `# Schedule Tracker: ${client.name}

Campaign Run: ${new Date().toISOString()}
Total Posts: ${posts.length}
Successfully Deployed as Drafts: ${successCount}
Failed: ${failedResults.length}

## Quality Gate Summary (70/100 threshold)
Posts auto-fixed: ${posts.filter(p => p.quality_score_fixed).length}
Posts with score ≥ 70: ${posts.filter(p => p.quality_score != null && p.quality_score >= 70).length}
Posts without score data: ${posts.filter(p => p.quality_score == null).length}

## Failed Posts
${failedResults.map(r => `- Post ${r.postId}: ${r.error}`).join('\n') || 'None'}
`;

  const workflowLog = `# Workflow Log: ${client.name}

Run completed: ${new Date().toISOString()}
Client: ${client.name} (${client.brand})
Workspace: ${client.supergrow_workspace_name} (${client.supergrow_workspace_id})
Mode: Draft only (operator approval in Supergrow before publishing)
Posts generated: ${posts.length}
Images generated: ${posts.filter(p => p.image_url).length}
Posts deployed as drafts: ${successCount}
Auto-fixed (quality gate): ${posts.filter(p => p.quality_score_fixed).length}
Generated by: GPT-4o with LinkedIn Master prompt + live algorithm context
`;

  return {
    'generated_posts.md': postsMarkdown,
    'generated_posts.json': postsJson,
    'generated_posts_for_scheduling.csv': `id,linkedin_post_text,image_url,workspace_id,suggested_day,suggested_time\n${csvRows}`,
    'schedule_tracker.md': scheduleTracker,
    'workflow_log.md': workflowLog,
    'execution_results.json': JSON.stringify({ campaign_run: new Date().toISOString(), client: client.name, results }, null, 2)
  };
}

export default router;
