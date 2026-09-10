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
 * PHASE 2. Sending now exists, and the routes that reach it are the last five
 * in this file. The shape Phase 1 warned about — an unfinished send path behind
 * a button — is avoided differently now that the path is finished: pressing
 * send queues a run dated a few seconds ahead and sends nothing, so the undo
 * window is a real window rather than a recall. Everything downstream of that
 * lives in services/keepwarm-sender.js.
 *
 * Sending is deliberately NOT on a timer. Studio works out when a fortnight is
 * up and shows the operator what would go; a person presses the button. A cron
 * mailing four figures of real prospects with nobody watching was considered
 * and rejected.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  ALL_STAGES,
  LOCKED_STAGES,
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
  emptyBin,
  previousSubjects,
} from '../services/keepwarm-store.js';
import {
  generateEmails,
  generateFromSubject,
  generateSubject,
  generateBody,
  renderEmailHtml,
  htmlToText,
  textToHtml,
  ragLoaded,
  ALLOWED_COUNTS,
} from '../services/keepwarm-generator.js';
import { reminderStatus } from '../services/keepwarm-reminders.js';
import {
  listIdeas,
  addIdeas,
  deleteIdea,
  resolveIdeas,
} from '../services/keepwarm-subjects.js';
import {
  listDead,
  deadCount,
  hideDead,
  hideAllDead,
} from '../services/bounce-store.js';
import {
  queueRun,
  sendTest,
  cancelRun,
  schedule,
  sentRuns,
  runRecipients,
  activeRun,
  cadenceConfig,
} from '../services/keepwarm-sender.js';

const router = Router();
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Overview — everything the screen needs on first paint, in one call
// ─────────────────────────────────────────────────────────────────────────────

router.get('/overview', (req, res) => {
  try {
    const settings = getSettings();
    const { counts, suppressed, dead } = stageCounts();
    const { included, excluded } = buildAudience();
    const refresh = lastStageRefresh();

    res.json({
      settings,
      stages: ALL_STAGES.map(key => ({
        key,
        label: STAGE_LABELS[key],
        count: counts[key] || 0,
        selected: settings.stages.includes(key),
        // Locked stages are shown so the operator can see the number, but the
        // screen renders them as a label rather than a control. The store
        // enforces this independently — the flag is presentation only.
        locked: LOCKED_STAGES.includes(key),
      })),
      noStageCount: counts.__none || 0,
      suppressedCount: suppressed,
      // Two different numbers on purpose. `deadInAudience` is how many people
      // the bounce list has taken out of THIS audience — the one that explains
      // a smaller headcount. `deadCount` is everything on the Dead list,
      // including addresses that bounced on a campaign rather than a keep-warm
      // send, which is what the tab counter shows.
      deadInAudience: dead,
      deadCount: deadCount(),
      // Send-day state for the banner. Worked out from the same calendar the
      // reminder emails use, so the screen and the inbox cannot disagree.
      reminder: reminderStatus(included.length),
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
// Dead addresses
//
// There is no refresh route here either. Bounce notifications are read out of
// the event log by the keep-warm ticker every thirty seconds, and the first
// pass after a deploy walks the whole log, so the historical backfill happens
// on its own. A button would only ever do what the ticker already did.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /dead?q=
 *
 * Addresses that rejected mail permanently and have not been cleared off the
 * screen. Searching is server-side for the same reason as the audience list.
 */
router.get('/dead', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const rows = listDead({ q, limit: 1000 });
    res.json({
      rows: rows.slice(0, 500),
      total: rows.length,
      truncated: rows.length > 500,
      deadCount: deadCount(),
    });
  } catch (err) {
    console.error('[keepwarm] dead list failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /dead/hide  { email }
 *
 * Takes one address off the screen. It stays dead and stays unmailable — the
 * mailbox does not come back to life because somebody tidied the list. The
 * response carries the new count so the tab label cannot drift from the list.
 */
router.post('/dead/hide', (req, res) => {
  try {
    const email = String((req.body || {}).email || '').trim();
    if (!email) return res.status(400).json({ error: 'No address given' });
    const result = hideDead(email);
    res.json({ ...result, deadCount: deadCount() });
  } catch (err) {
    console.error('[keepwarm] dead hide failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /dead/hide-all — clears the whole list off the screen at once.
 */
router.post('/dead/hide-all', (req, res) => {
  try {
    const cleared = hideAllDead();
    res.json({ ok: true, cleared, deadCount: deadCount() });
  } catch (err) {
    console.error('[keepwarm] dead hide-all failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Subject lines the operator wrote
// ─────────────────────────────────────────────────────────────────────────────

router.get('/subjects', (req, res) => {
  try {
    res.json({ ideas: listIdeas() });
  } catch (err) {
    console.error('[keepwarm] subject list failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /subjects  { text }
 *
 * One line, or a pasted block with one per line. Adding nine at once is the
 * normal case, so the box takes the whole list rather than making the operator
 * press Add nine times.
 */
router.post('/subjects', (req, res) => {
  try {
    const result = addIdeas((req.body || {}).text);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ...result, ideas: listIdeas() });
  } catch (err) {
    console.error('[keepwarm] subject add failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/subjects/:id', (req, res) => {
  try {
    const result = deleteIdea(req.params.id);
    if (!result.ok) return res.status(404).json({ error: 'That line is not there.' });
    res.json({ ...result, ideas: listIdeas() });
  } catch (err) {
    console.error('[keepwarm] subject delete failed:', err);
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

  // Subject lines the operator ticked. Each one becomes exactly one draft,
  // carrying that line word for word; the rest of the batch is Studio's own
  // ideas as before. Ticking none is the original behaviour untouched.
  const { subjects: picked, error: pickError } = resolveIdeas((req.body || {}).subjectIds);
  if (pickError) return res.status(400).json({ error: pickError });

  // Refused rather than silently trimmed. Somebody who ticks four lines and
  // asks for three has made a decision the screen cannot make for them — which
  // of the four to drop is not a choice code should be inventing.
  if (picked.length > count) {
    return res.status(400).json({
      error: `You have picked ${picked.length} subject lines but asked for ${count} emails. Untick ${picked.length - count}, or ask for more.`,
    });
  }

  const batchId = createBatch(count);
  try {
    const previous = previousSubjects(30);

    // Written one at a time because each has its own fixed subject, and in
    // sequence rather than all at once so a rate limit surfaces as one clear
    // failure rather than a partial batch with a gap in the middle.
    const fromLines = [];
    for (const subject of picked) {
      fromLines.push(await generateFromSubject({ subject, avoid: previous }));
    }

    // The free ones are told about the picked lines as well, so Studio does not
    // invent a fourth email on the same joke the operator just chose.
    const remaining = count - picked.length;
    const invented = remaining > 0
      ? await generateEmails(remaining, [...previous, ...picked.map(subject => ({ subject, angle: null }))])
      : [];

    const drafts = [...fromLines, ...invented];
    insertDrafts(batchId, drafts);
    finishBatch(batchId);

    console.log(`[keepwarm] generated ${drafts.length} draft(s) (asked for ${count}, ${picked.length} from the operator's own lines)`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Schedule and sending
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /schedule
 * The Schedule tab: the run in flight if there is one, the next due date, and
 * the approved drafts queued behind it with a projected date and headcount.
 */
router.get('/schedule', (req, res) => {
  try {
    res.json(schedule(Number(req.query.limit) || 10));
  } catch (err) {
    console.error('[keepwarm] schedule failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /send  { draftId }
 *
 * Queues a run. Nothing is sent by this call — the run is dated a few seconds
 * ahead, and /undo cancels it outright during that window because there is
 * genuinely nothing out there yet.
 *
 * A 409 means the request was understood and deliberately not actioned. Each
 * reason is something the operator has to read and decide about:
 *   not_configured  — no from-address set, so it refuses rather than guessing
 *   not_approved    — the draft has not been ticked off
 *   already_sent    — this draft has gone before
 *   run_in_progress — one send at a time
 *   empty_audience  — nobody qualifies under the current stage rule
 *   over_cap        — more recipients than the safety cap allows
 */
router.post('/send', (req, res) => {
  try {
    const draftId = String((req.body || {}).draftId || '');
    if (!draftId) return res.status(400).json({ error: 'draftId required' });

    // The ticks arrive as whichever list is shorter: `only` when the operator
    // deselected everyone and ticked a few, `exclude` when they left the list
    // alone and unticked a few. Neither means everybody in the loop, which is
    // the ordinary case.
    const body = req.body || {};
    const only    = Array.isArray(body.only) ? body.only : null;
    const exclude = Array.isArray(body.exclude) ? body.exclude : null;

    const result = queueRun(draftId, { only, exclude });
    if (!result.ok) {
      const code = result.reason === 'no_draft' ? 404 : 409;
      return res.status(code).json({
        error: result.reason,
        count: result.count,
        cap:   result.cap,
        runId: result.runId,
      });
    }

    console.log(`[keepwarm] operator queued run ${result.runId} for draft ${draftId}`);
    res.json(result);
  } catch (err) {
    console.error('[keepwarm] send failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /drafts/bin
 *
 * Empties the bin. Rejected drafts stop appearing anywhere on the screen, but
 * their subject lines stay in the do-not-repeat list fed to the generator —
 * see the note in keepwarm-store.js. There is no DELETE /drafts/:id, so "bin"
 * cannot be read as an id; if a single-draft delete is ever added it must be
 * declared after this one.
 */
router.delete('/drafts/bin', (req, res) => {
  try {
    const cleared = emptyBin();
    res.json({ ok: true, cleared });
  } catch (err) {
    console.error('[keepwarm] empty bin failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /test  { draftId, toEmail }
 *
 * One copy, to one address, now. Not a run: nothing is recorded against the
 * draft or the schedule, so testing cannot quietly consume the email you were
 * about to send to everybody. The subject is prefixed [TEST] so the copy in
 * your inbox can never be mistaken for the real one later.
 */
router.post('/test', async (req, res) => {
  try {
    const { draftId, toEmail } = req.body || {};
    if (!draftId) return res.status(400).json({ error: 'draftId required' });

    const result = await sendTest({ draftId, toEmail });
    if (!result.ok) {
      const code = result.reason === 'no_draft' ? 404
        : result.reason === 'send_failed' ? 500 : 409;
      return res.status(code).json({ error: result.reason, detail: result.detail });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[keepwarm] test send failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /undo  { runId }
 * Only works while the run is still queued. Once the worker has claimed it the
 * first messages are with SES, and a 409 says so plainly rather than pretending
 * the send was stopped.
 */
router.post('/undo', (req, res) => {
  try {
    const runId = String((req.body || {}).runId || '');
    if (!runId) return res.status(400).json({ error: 'runId required' });

    const result = cancelRun(runId);
    if (!result.ok) return res.status(409).json({ error: result.reason });
    res.json({ ok: true });
  } catch (err) {
    console.error('[keepwarm] undo failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /active
 * Small and cheap, for polling while a send is running so the screen can show
 * progress without re-reading the whole schedule.
 */
router.get('/active', (req, res) => {
  try {
    const run = activeRun();
    res.json({ run: run ? { id: run.id, status: run.status, sendAfter: run.send_after } : null, config: cadenceConfig() });
  } catch (err) {
    console.error('[keepwarm] active failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /sent
 * The Sent tab: past runs with what went, what failed, and how many people
 * opted out afterwards.
 */
router.get('/sent', (req, res) => {
  try {
    res.json({ runs: sentRuns(Number(req.query.limit) || 20) });
  } catch (err) {
    console.error('[keepwarm] sent list failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /sent/:runId/recipients
 * Who one past send actually went to — the frozen list, not a recount.
 */
router.get('/sent/:runId/recipients', (req, res) => {
  try {
    res.json({ rows: runRecipients(req.params.runId, Number(req.query.limit) || 1000) });
  } catch (err) {
    console.error('[keepwarm] recipients failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
