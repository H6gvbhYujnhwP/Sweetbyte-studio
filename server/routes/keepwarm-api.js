/**
 * server/routes/keepwarm-api.js — admin API for keep-warm emails.
 *
 * Mounted at /api/keepwarm in server/index.js, behind the normal Studio login.
 *
 * This is the ADMIN side only. It never sends anything and it exposes no
 * HMAC-signed surface — the machine-to-machine bridge WorkTrackr calls lives in
 * routes/service-email-api.js and stays separate, for the same reason those two
 * are separate today: one router with two auth models is how a bridge endpoint
 * quietly becomes reachable from a browser session.
 *
 * PHASE 1 SCOPE. Everything here is audience, settings, generation and review.
 * Choosing recipients and actually sending are Phase 2, and there is
 * deliberately no route that could mail anybody yet — an unfinished send path
 * sitting behind a button is exactly the accident worth designing out.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  ALL_STAGES,
  STAGE_LABELS,
  getSettings,
  saveSettings,
  lastStageRefresh,
  stageCounts,
  buildAudience,
  createBatch,
  finishBatch,
  insertDrafts,
  listDrafts,
  getDraft,
  updateDraft,
  setDraftStatus,
  previousSubjects,
} from '../services/keepwarm-store.js';
import {
  generateEmails,
  generateSubject,
  generateBody,
  renderEmailHtml,
  htmlToText,
  textToHtml,
  ragLoaded,
  ALLOWED_COUNTS,
} from '../services/keepwarm-generator.js';

const router = Router();
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Overview — everything the screen needs on first paint, in one call
// ─────────────────────────────────────────────────────────────────────────────

router.get('/overview', (req, res) => {
  try {
    const settings = getSettings();
    const { counts, suppressed } = stageCounts();
    const { included, excluded } = buildAudience();
    const refresh = lastStageRefresh();

    res.json({
      settings,
      stages: ALL_STAGES.map(key => ({
        key,
        label: STAGE_LABELS[key],
        count: counts[key] || 0,
        selected: settings.stages.includes(key),
      })),
      noStageCount: counts.__none || 0,
      suppressedCount: suppressed,
      audienceCount: included.length,
      excludedCount: excluded.length,
      stageRefresh: refresh,
      config: {
        stagesEverReceived: !!refresh.at,
        ragLoaded: ragLoaded(),
        anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
      },
      allowedCounts: ALLOWED_COUNTS,
    });
  } catch (err) {
    console.error('[keepwarm] overview failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage cache
//
// There is no refresh route here on purpose. WorkTrackr pushes stages to Studio
// over the signed bridge in routes/service-email-api.js — immediately when
// somebody changes one, and as a full reconcile every half hour. Studio has no
// outbound connection to WorkTrackr and deliberately does not gain one just to
// power a button, because that button would need its own base URL and its own
// tenancy pin configured on two more services.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

router.put('/settings', (req, res) => {
  try {
    const { stages, includeNoStage } = req.body || {};
    const saved = saveSettings({ stages, includeNoStage });
    const { included } = buildAudience();
    res.json({ settings: saved, audienceCount: included.length });
  } catch (err) {
    console.error('[keepwarm] settings save failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Audience
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /audience?q=&show=included|excluded
 *
 * Filtering happens here rather than in the browser so the same search works
 * once the list runs to a few thousand rows.
 */
router.get('/audience', (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const show = req.query.show === 'excluded' ? 'excluded' : 'included';
    const { included, excluded } = buildAudience();

    let rows = show === 'excluded' ? excluded : included;
    if (q) {
      rows = rows.filter(r =>
        (r.email || '').toLowerCase().includes(q) ||
        (r.companyName || '').toLowerCase().includes(q) ||
        (r.contactName || '').toLowerCase().includes(q)
      );
    }

    res.json({
      show,
      rows: rows.slice(0, 1000),
      total: rows.length,
      truncated: rows.length > 1000,
      includedCount: included.length,
      excludedCount: excluded.length,
    });
  } catch (err) {
    console.error('[keepwarm] audience failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /generate  { count: 3 | 6 | 9 }
 *
 * Runs inline rather than in the background. A batch takes tens of seconds and
 * the operator is sitting watching the screen; a job queue would add a polling
 * endpoint, a status table and a class of "stuck at 90%" bugs to solve a
 * problem nobody has.
 *
 * Everything already approved, sent or rejected is passed in as the do-not-
 * repeat list, so batch four cannot quietly rewrite batch one.
 */
router.post('/generate', async (req, res) => {
  const count = Number((req.body || {}).count);
  if (!ALLOWED_COUNTS.includes(count)) {
    return res.status(400).json({ error: `count must be one of ${ALLOWED_COUNTS.join(', ')}` });
  }

  const batchId = createBatch(count);
  try {
    const drafts = await generateEmails(count, previousSubjects(30));
    insertDrafts(batchId, drafts);
    finishBatch(batchId);

    console.log(`[keepwarm] generated ${drafts.length} draft(s) (asked for ${count})`);
    res.json({
      batchId,
      generated: drafts.length,
      requested: count,
      short: drafts.length < count,
      drafts: listDrafts({ status: 'draft', limit: 200 }).filter(d => d.batch_id === batchId),
    });
  } catch (err) {
    finishBatch(batchId, err.message);
    console.error('[keepwarm] generation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Drafts
// ─────────────────────────────────────────────────────────────────────────────

router.get('/drafts', (req, res) => {
  try {
    const status = ['draft', 'approved', 'rejected', 'sent'].includes(req.query.status)
      ? req.query.status
      : null;
    res.json({ drafts: listDrafts({ status, limit: 200 }) });
  } catch (err) {
    console.error('[keepwarm] list drafts failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /drafts/:id — the draft plus a fully assembled preview.
 *
 * `preview` is the whole email exactly as it would be delivered: greeting,
 * body, Billy's signature, the address block and the opt-out. The stored
 * html_body is only the middle of that, so showing it on its own would let
 * somebody approve an email having never seen a third of it.
 */
router.get('/drafts/:id', (req, res) => {
  try {
    const row = getDraft(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    res.json({
      draft: row,
      // The editable form of the body. The operator works in plain paragraphs;
      // the inline styling is put back on save, so no tag ever reaches the screen.
      bodyText: htmlToText(row.html_body),
      preview: renderEmailHtml({ bodyHtml: row.html_body, firstName: null }),
    });
  } catch (err) {
    console.error('[keepwarm] get draft failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/drafts/:id', (req, res) => {
  try {
    // `text` is what the screen sends: plain paragraphs. `html` is still
    // accepted so nothing that already speaks the old shape breaks, but the
    // browser no longer uses it.
    const { subject, text, html } = req.body || {};
    if (subject === undefined && text === undefined && html === undefined) {
      return res.status(400).json({ error: 'nothing to update' });
    }
    if (subject !== undefined && !String(subject).trim()) {
      return res.status(400).json({ error: 'subject cannot be empty' });
    }
    if (text !== undefined && !String(text).trim()) {
      return res.status(400).json({ error: 'the email cannot be empty' });
    }

    const nextHtml = text !== undefined ? textToHtml(text)
                   : html !== undefined ? String(html)
                   : null;

    const result = updateDraft(req.params.id, {
      subject: subject === undefined ? null : String(subject).trim().slice(0, 200),
      html:    nextHtml,
    });

    if (!result) return res.status(404).json({ error: 'not_found' });
    if (result.error) return res.status(409).json({ error: result.error });

    res.json({
      draft: result,
      bodyText: htmlToText(result.html_body),
      preview: renderEmailHtml({ bodyHtml: result.html_body, firstName: null }),
    });
  } catch (err) {
    console.error('[keepwarm] update draft failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /drafts/:id/regenerate
 * Body: { part: 'subject' | 'body', subject, html, avoid?: [string] }
 *
 * Rewrites ONE half and leaves the other exactly alone.
 *
 * `subject` and `html` are the text as it currently stands on screen, including
 * anything typed but not yet saved. Reading the stored row instead would mean
 * writing a subject line for a body the operator can no longer see, which is
 * the sort of thing that looks like the model ignoring you.
 *
 * The result is saved immediately rather than left pending. A regenerate is an
 * explicit act, and leaving it unsaved means closing the panel silently throws
 * it away. Saving also clears any approval, which is correct for the same
 * reason editing does: the tick referred to wording that no longer exists.
 */
router.post('/drafts/:id/regenerate', async (req, res) => {
  const { part, subject, text, html, avoid } = req.body || {};
  if (part !== 'subject' && part !== 'body') {
    return res.status(400).json({ error: "part must be 'subject' or 'body'" });
  }

  const row = getDraft(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status === 'sent') return res.status(409).json({ error: 'already_sent' });

  const currentSubject = (subject !== undefined && subject !== null) ? String(subject) : row.subject;
  const currentHtml    = (text !== undefined && text !== null) ? textToHtml(text)
                       : (html !== undefined && html !== null) ? String(html)
                       : row.html_body;

  try {
    let result;

    if (part === 'subject') {
      // Everything already used platform-wide, plus whatever this sitting has
      // already produced and moved on from. Both matter: the first stops a
      // repeat of a live email, the second stops the button appearing to do
      // nothing when pressed twice.
      const used = previousSubjects(30).map(p => p.subject);
      const tried = Array.isArray(avoid) ? avoid.map(String) : [];
      const newSubject = await generateSubject({
        bodyHtml: currentHtml,
        avoid: [...new Set([...tried, ...used, currentSubject])].filter(Boolean).slice(0, 40),
      });
      result = updateDraft(req.params.id, { subject: newSubject, html: currentHtml });
    } else {
      const body = await generateBody({ subject: currentSubject, currentHtml });
      result = updateDraft(req.params.id, { subject: currentSubject, html: body.html });
    }

    if (!result) return res.status(404).json({ error: 'not_found' });
    if (result.error) return res.status(409).json({ error: result.error });

    res.json({
      draft: result,
      bodyText: htmlToText(result.html_body),
      preview: renderEmailHtml({ bodyHtml: result.html_body, firstName: null }),
    });
  } catch (err) {
    console.error('[keepwarm] regenerate failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/drafts/:id/status', (req, res) => {
  try {
    const status = String((req.body || {}).status || '');
    const result = setDraftStatus(req.params.id, status);
    if (!result) return res.status(404).json({ error: 'not_found' });
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ draft: result });
  } catch (err) {
    console.error('[keepwarm] set draft status failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
