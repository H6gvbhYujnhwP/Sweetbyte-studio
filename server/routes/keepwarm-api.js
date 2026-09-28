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
  moveDraftInSchedule,
  addManualToLoop,
  removeManual,
  removeAllManual,
  listManual,
  loopRemovalInfo,
  removeFromLoop,
  restoreToLoop,
  emptyBin,
  previousSubjects,
  interestCounts,
  laneAudience,
  setDraftSkips,
  INTEREST_KEYS,
  setHandInterests,
  handInterestRows,
  searchCompanies,
} from '../services/keepwarm-store.js';
import {
  generateEmails,
  generateForInterest,
  generateFromSubject,
  generateSubject,
  generateBody,
  renderEmailHtml,
  htmlToText,
  textToHtml,
  ragLoaded,
  ALLOWED_COUNTS,
} from '../services/keepwarm-generator.js';
import {
  getLaneExamples,
  setLaneExamples,
  peekNextExamples,
  takeNextExamples,
  writeLeadSentence,
  freezeExamplesForDraft,
  examplesHtmlForDraft,
  laneTakesExamples,
  laneExampleWording,
  EXAMPLES_PER_EMAIL,
} from '../services/keepwarm-examples.js';
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
  setDraftSendDay,
} from '../services/keepwarm-sender.js';

// A lane key Studio recognises. '__none' is the people with nothing ticked, who
// are a real group of 291 and not an absence. Anything else is refused rather
// than guessed at — a mistyped key that fell through to a general email would
// produce a plausible-looking draft about the wrong thing.
function isLaneKey(key) {
  return key === '__none' || INTEREST_KEYS.some(x => x.key === key);
}

function interestLabelFor(key) {
  return INTEREST_KEYS.find(x => x.key === key)?.label || key;
}

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
/**
 * GET /api/keepwarm/interests
 *
 * The lane cards: how many people in the loop are interested in each topic,
 * and how many have nothing ticked.
 *
 * Counted over the audience that would actually receive an email, so the stage
 * rule is already applied — a lane never shows somebody who is dead, opted out
 * or at an excluded stage. Interest decides the topic; stage decides who is in
 * the loop at all, and this endpoint never reverses that order.
 *
 * `everReceived` is the honest answer to "is this working yet". Zero means
 * WorkTrackr has never sent the field, which is a different thing from
 * everybody genuinely having nothing ticked, and the screen says so in those
 * words rather than showing ten empty cards.
 */
router.get('/interests', (req, res) => {
  try {
    res.json(interestCounts());
  } catch (err) {
    console.error('[keepwarm] interest counts failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /interests/:key/people?q=&draftId=
 *
 * The people in one lane, for the list inside the lane panel. Every row says
 * whether it is ticked for the next send and when that person last had this
 * lane's email.
 *
 * The stage rule has already been applied before this narrows anything, so a
 * lane can never contain somebody who is dead, opted out or at an excluded
 * stage. Interest decides the topic; it never decides who is in the loop.
 */
router.get('/interests/:key/people', (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!isLaneKey(key)) return res.status(404).json({ error: 'unknown_interest' });

    const data = laneAudience(key, {
      q: String(req.query.q || ''),
      draftId: String(req.query.draftId || '') || null,
    });

    res.json({
      interest: key,
      label: key === '__none' ? 'Nothing ticked' : interestLabelFor(key),
      ...data,
      shown: data.rows.length,
    });
  } catch (err) {
    console.error('[keepwarm] lane people failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /interests/:key/generate
 *
 * Write one email for this lane. The topic is the lane itself — press Write on
 * Microsoft 365 and it writes about Microsoft 365 — and the draft is stamped
 * with the lane, which is what stops it ever being sent to anybody outside it.
 *
 * Everything else is the ordinary engine: same prompt, same paragraph style,
 * same bold-label bullets, same checks. A lane with no writing brief is refused
 * in plain words rather than quietly producing a general email under a service
 * heading.
 */
router.post('/interests/:key/generate', async (req, res) => {
  const key = String(req.params.key || '').trim();
  if (!isLaneKey(key)) return res.status(404).json({ error: 'unknown_interest' });

  const batchId = createBatch(1);
  try {
    const draft = await generateForInterest({ interestKey: key, avoid: previousSubjects(30) });

    // The example websites, before the draft exists rather than after.
    //
    // Both halves have to be in hand before anything is saved: if the sentence
    // that introduces them cannot be written, there is no half-finished draft
    // sitting in the queue with a dangling pair of links and nothing to
    // introduce them. The error says what went wrong and pressing Write again
    // is the whole of the recovery.
    //
    // A lane with no saved sites simply gets no line. That is the state every
    // lane is in until somebody fills the list in, and refusing to write the
    // email over it would lock the lane shut.
    let frozen = null;
    if (laneTakesExamples(key)) {
      const sites = takeNextExamples(key, EXAMPLES_PER_EMAIL);
      if (sites.length) {
        const lead = await writeLeadSentence({ lane: key, count: sites.length });
        frozen = { lane: key, lead, sites };
      }
    }

    const { ids } = insertDrafts(batchId, [draft], { interest: key });
    if (frozen && ids[0]) freezeExamplesForDraft(ids[0], frozen);
    finishBatch(batchId);

    console.log(`[keepwarm] wrote a ${key} lane draft`);
    res.json({
      interest: key,
      draft: listDrafts({ limit: 1, interest: key })[0] || null,
      draftId: ids[0] || null,
    });
  } catch (err) {
    finishBatch(batchId, err.message);
    console.error('[keepwarm] lane generation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /companies?q=
 *
 * Companies Studio already knows about, for the box that adds somebody to the
 * loop by hand. Searching by name is the whole point: the WorkTrackr id is what
 * makes adding somebody by hand a chore, and Studio already holds it.
 */
router.get('/companies', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ companies: [] });
    res.json({ companies: searchCompanies(q) });
  } catch (err) {
    console.error('[keepwarm] company search failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /loop/add-one  { email, contactName, companyId, companyName }
 *
 * One person, from the form rather than the paste box.
 *
 * Goes through exactly the same door as a paste — bounced, unsubscribed,
 * already in the loop and previously removed by hand are all decided in one
 * place, and this route is not allowed its own opinion about any of them.
 *
 * A company is required. Without one there is no sales stage, and no stage
 * means the person is excluded from every send; adding somebody who can never
 * be emailed and saying nothing would be the worst kind of quiet failure.
 */
router.post('/loop/add-one', (req, res) => {
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim();
    const companyId = String(body.companyId || '').trim();
    const companyName = String(body.companyName || '').trim();
    const contactName = String(body.contactName || '').trim();

    if (!email) return res.status(400).json({ error: 'An email address is needed.' });
    if (!companyId || !companyName) {
      return res.status(400).json({
        error: 'Pick the company this person is at. Without one Studio has no sales stage for them, and anybody with no stage is left out of every send.',
      });
    }

    // The reader that takes this line treats tabs, commas, semicolons and runs
    // of two or more spaces as column separators, so any of those left inside a
    // name would split it in half — and the half that landed in the second
    // column would be read as the person's first name. "Sentek Engineering,
    // Ltd" greeting somebody as "Hi Ltd," is a real way for this to go wrong,
    // so the separators are taken out of the names before the line is built.
    const clean = (v) => v.replace(/[\t\r\n,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    const line = [clean(companyName), clean(contactName), email, companyId].filter(Boolean).join('\t');

    const result = addManualToLoop(line);
    if (!result.added && !result.restored) {
      const why = result.skipped?.[0]?.reason || (result.unreadable?.length ? 'that address could not be read' : 'nothing was added');
      return res.status(400).json({ error: `Not added — ${why}.` });
    }
    res.json(result);
  } catch (err) {
    console.error('[keepwarm] add one to loop failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /people/:email/interests  { interests: [key, ...] }
 *
 * The topics held against one person BY HAND, here in Studio.
 *
 * Added to whatever WorkTrackr says rather than replacing it, and kept in their
 * own table so a push can never wipe them. An empty list clears them, which is
 * the "put it back to what WorkTrackr says" button.
 *
 * Nothing is sent to WorkTrackr. The link between the two only runs one way,
 * and a chip in WorkTrackr belongs to the company while this belongs to one
 * person, so there is no honest way to mirror it from here.
 */
router.put('/people/:email/interests', (req, res) => {
  try {
    const email = String(req.params.email || '').trim();
    const wanted = (req.body || {}).interests;
    if (!Array.isArray(wanted)) return res.status(400).json({ error: 'A list of topics is needed.' });

    const unknown = wanted.filter(k => !INTEREST_KEYS.some(x => x.key === k));
    if (unknown.length) return res.status(400).json({ error: `Studio has no lane called "${unknown[0]}".` });

    const result = setHandInterests(email, wanted);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[keepwarm] set hand interests failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /people/hand-set
 *
 * The catch-up list: everybody carrying a topic set here rather than in the
 * CRM, with what WorkTrackr says beside it. Work through it in WorkTrackr and
 * the list empties itself.
 */
router.get('/people/hand-set', (_req, res) => {
  try {
    const rows = handInterestRows();
    res.json({
      rows,
      total: rows.length,
      // Already ticked in WorkTrackr since, so Studio's copy is doing nothing
      // and can be cleared without changing who gets what.
      mirrored: rows.filter(r => r.mirrored).length,
    });
  } catch (err) {
    console.error('[keepwarm] hand-set list failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /interests/:key/examples
 *
 * The example websites saved against this lane, and the ones the next email
 * would use. Both, because "next up" is the only thing that makes pressing
 * Write predictable — the list is in the order it was typed, and the rotation
 * is somewhere in the middle of it.
 *
 * A lane that does not carry examples answers with an empty list and says so,
 * rather than 404ing. The screen asks about whichever card is open.
 */
router.get('/interests/:key/examples', (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!isLaneKey(key)) return res.status(404).json({ error: 'unknown_interest' });

    if (!laneTakesExamples(key)) {
      return res.json({ interest: key, supported: false, sites: [], next: [], perEmail: EXAMPLES_PER_EMAIL });
    }

    const wording = laneExampleWording(key);
    res.json({
      interest: key,
      supported: true,
      // The screen takes its heading and its wording from here rather than
      // keeping its own copy, so a lane added on the server needs no change on
      // the screen at all.
      noun: wording.noun,
      heading: wording.heading,
      sites: getLaneExamples(key).sites,
      next: peekNextExamples(key, EXAMPLES_PER_EMAIL),
      perEmail: EXAMPLES_PER_EMAIL,
    });
  } catch (err) {
    console.error('[keepwarm] lane examples failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /interests/:key/examples  { sites: [{ name, url }, ...] }
 *
 * Save the list. Every address is checked here and a bad one refuses the whole
 * save with a plain reason — a dead link in an email over Billy's name is worse
 * than being made to retype an address, and half a saved list is worse than
 * both.
 *
 * Saving does not touch any draft already written. Those carry their own frozen
 * copy, so what was approved is what goes out.
 */
router.put('/interests/:key/examples', (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!isLaneKey(key)) return res.status(404).json({ error: 'unknown_interest' });

    const sites = (req.body || {}).sites;
    if (!Array.isArray(sites)) return res.status(400).json({ error: 'The list of sites is missing.' });

    const result = setLaneExamples(key, sites);
    if (result.error) return res.status(400).json({ error: result.error });

    const wording = laneExampleWording(key);
    res.json({
      interest: key,
      supported: true,
      noun: wording.noun,
      heading: wording.heading,
      sites: result.sites,
      next: peekNextExamples(key, EXAMPLES_PER_EMAIL),
      perEmail: EXAMPLES_PER_EMAIL,
    });
  } catch (err) {
    console.error('[keepwarm] save lane examples failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /drafts/:id/recipients  { skip: [address, ...] }
 *
 * Who the operator has unticked for this draft. Stored against the draft rather
 * than held in the browser, because a fortnight is several lane sends on the
 * same day and each one needs its own list — one selection shared across the
 * screen cannot hold nine lists at once.
 *
 * Unticking is for this send only. It does not remove anybody from the loop and
 * it does not change what they are interested in.
 */
router.put('/drafts/:id/recipients', (req, res) => {
  try {
    const skip = (req.body || {}).skip;
    if (!Array.isArray(skip)) return res.status(400).json({ error: 'skip must be a list of addresses' });

    const result = setDraftSkips(req.params.id, skip);
    if (result.error === 'no_draft') return res.status(404).json({ error: 'not_found' });
    if (result.error) return res.status(409).json({ error: result.error });

    res.json(result);
  } catch (err) {
    console.error('[keepwarm] draft recipients failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/audience', (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const show = req.query.show === 'excluded' ? 'excluded' : 'included';
    // Which service-interest lane the list is narrowed to. '__none' is the
    // people with nothing ticked, who are a real group and not an absence —
    // they are the ones who get the general IT support email.
    const interest = String(req.query.interest || '').trim();
    const { included, excluded } = buildAudience();

    let rows = show === 'excluded' ? excluded : included;

    // Interest narrows the list; it never widens it. Applied AFTER buildAudience
    // has had its say, so somebody excluded by the stage rule cannot reappear
    // because they happen to be interested in the topic. Stage decides who is
    // in the loop; interest only decides the topic.
    if (interest) {
      rows = interest === '__none'
        ? rows.filter(r => !(r.interests || []).length)
        : rows.filter(r => (r.interests || []).includes(interest));
    }

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
      // What the list is narrowed to, echoed back so the screen can never show
      // one lane's heading above another lane's rows.
      interest: interest || null,
      interestCount: interest
        ? (show === 'excluded' ? excluded : included).filter(r => interest === '__none'
            ? !(r.interests || []).length
            : (r.interests || []).includes(interest)).length
        : null,
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
    // Notes are collected rather than thrown. One email that cannot be written
    // is not a reason to lose the rest of the batch — the operator keeps what is
    // good and bins the rest, which is what the Drafts screen is for. Nothing
    // that failed its checks is ever saved; it is just reported instead.
    const notes = [];

    // Written one at a time because each has its own fixed subject, and in
    // sequence rather than all at once so a rate limit surfaces as one clear
    // failure rather than a partial batch with a gap in the middle.
    const fromLines = [];
    for (const subject of picked) {
      try {
        fromLines.push(await generateFromSubject({ subject, avoid: previous }));
      } catch (err) {
        notes.push(`Your own line "${subject}" could not be used: ${err.message}`);
      }
    }

    // The free ones are told about the picked lines as well, so Studio does not
    // invent a fourth email on the same joke the operator just chose.
    const remaining = count - picked.length;
    let invented = [];
    if (remaining > 0) {
      const batch = await generateEmails(
        remaining,
        [...previous, ...picked.map(subject => ({ subject, angle: null }))],
      );
      invented = batch.drafts;
      for (const item of batch.rejected) {
        notes.push(`One email about ${item.area || 'an unnamed area'} was dropped: ${item.errors[0]}`);
      }
      if (batch.extras > 0) {
        notes.push(`The model sent ${batch.extras} more than asked for; the extras were dropped.`);
      }
    }

    const drafts = [...fromLines, ...invented];
    if (drafts.length === 0) {
      throw new Error(`Nothing usable came back. ${notes.join(' ')}`.trim());
    }

    insertDrafts(batchId, drafts);
    finishBatch(batchId);

    const short = drafts.length < count;
    const note = short
      ? [`Asked for ${count}, kept ${drafts.length}.`, ...notes].join(' ')
      : (notes.length ? notes.join(' ') : null);

    console.log(`[keepwarm] generated ${drafts.length} draft(s) (asked for ${count}, ${picked.length} from the operator's own lines, ${notes.length} note(s))`);
    res.json({
      batchId,
      generated: drafts.length,
      requested: count,
      short: short || notes.length > 0,
      note,
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
    // `interest` narrows the list to one service lane; 'general' asks for the
    // drafts the 3/6/9 generator wrote, which belong to no lane.
    const interest = String(req.query.interest || '').trim() || null;
    res.json({ drafts: listDrafts({ status, limit: 200, interest }) });
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
      bodyText: htmlToText(row.html_body, { keepBold: true }),
      preview: renderEmailHtml({
        bodyHtml: row.html_body,
        firstName: null,
        // The example websites frozen onto this draft. Shown in the preview
        // because approving an email having never seen its last line is
        // exactly what the preview exists to prevent.
        examplesHtml: examplesHtmlForDraft(row.id),
      }),
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
      bodyText: htmlToText(result.html_body, { keepBold: true }),
      preview: renderEmailHtml({
        bodyHtml: result.html_body,
        firstName: null,
        examplesHtml: examplesHtmlForDraft(result.id),
      }),
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
      bodyText: htmlToText(result.html_body, { keepBold: true }),
      preview: renderEmailHtml({
        bodyHtml: result.html_body,
        firstName: null,
        examplesHtml: examplesHtmlForDraft(result.id),
      }),
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

/**
 * POST /manual  { text }
 *
 * Add addresses to the loop by hand. `text` is whatever was pasted in — the
 * parsing is server-side so the rules live in one place rather than being
 * reimplemented in the browser and drifting from it.
 *
 * Always 200 when the request was well formed, even when nothing was added.
 * "All nine of those were already in the loop" is a successful answer to the
 * question asked, not an error, and the screen needs the detail either way.
 */
router.post('/manual', (req, res) => {
  try {
    const text = String((req.body || {}).text || '');
    if (!text.trim()) return res.status(400).json({ error: 'nothing_pasted' });
    res.json(addManualToLoop(text));
  } catch (err) {
    console.error('[keepwarm] manual add failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /manual — everyone added by hand. */
router.get('/manual', (req, res) => {
  try {
    res.json({ rows: listManual() });
  } catch (err) {
    console.error('[keepwarm] manual list failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /manual/remove  { email }
 *
 * Removes the hand-typed row and nothing else. If that address had also been
 * sent a real introduction email at some point it stays in the loop on the
 * strength of the send, which is correct — the send is the better evidence.
 */
router.post('/manual/remove', (req, res) => {
  try {
    const result = removeManual((req.body || {}).email);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[keepwarm] manual remove failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /loop/removal-info?email=...
 *
 * What the confirmation box says before anything happens: who this is, whether
 * an introduction was ever sent to them, how many keep-warm emails they have
 * had, and which of the two removals pressing the button will perform.
 *
 * The decision is made here rather than on the screen so that the sentence the
 * operator reads and the thing that actually happens cannot drift apart.
 */
router.get('/loop/removal-info', (req, res) => {
  try {
    const result = loopRemovalInfo(req.query.email);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[keepwarm] removal info failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /loop/remove  { email }
 *
 * Take somebody out of the loop. Deletes a hand-typed row outright; hides an
 * address that has a real send behind it, leaving the send history alone.
 */
router.post('/loop/remove', (req, res) => {
  try {
    const result = removeFromLoop((req.body || {}).email);
    if (result.error) return res.status(400).json(result);
    console.log(`[keepwarm] removed ${result.info.email} from the loop (${result.action})`);
    res.json(result);
  } catch (err) {
    console.error('[keepwarm] loop remove failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /loop/restore  { email }
 *
 * Put a hidden address back. Only undoes a hide — a deleted hand-typed row is
 * put back by pasting it in again, which is the same thing you would do to
 * correct it.
 */
router.post('/loop/restore', (req, res) => {
  try {
    const result = restoreToLoop((req.body || {}).email);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[keepwarm] loop restore failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /drafts/:id/schedule-move  { direction: 'up' | 'down' }
 *
 * Move an approved draft one place up or down the schedule. Removing one from
 * the schedule is not a route of its own: it is the existing status route with
 * 'draft', which is the same thing the Un-approve button on the Drafts tab has
 * always done. A second way to un-approve would be a second thing to keep in
 * step with the first.
 *
 * 409 rather than 400 when it cannot move: "already at the top" and "no longer
 * in the queue" are both the screen being out of date rather than the request
 * being malformed, and the screen's own refresh is the fix.
 */
router.post('/drafts/:id/schedule-move', (req, res) => {
  try {
    const direction = String((req.body || {}).direction || '');
    const result = moveDraftInSchedule(req.params.id, direction);
    if (result.error) return res.status(409).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[keepwarm] schedule move failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /drafts/:id/send-day  { date }
 *
 * Move one approved email onto a particular Tuesday, or send an empty date to
 * put it back under the queue's own grouping.
 *
 * Grouping is what Studio does by default — lane emails together on the next
 * send day, a general email on a day of its own — and this is how that default
 * gets overruled for one email.
 */
router.put('/drafts/:id/send-day', (req, res) => {
  try {
    const result = setDraftSendDay(req.params.id, (req.body || {}).date || '');
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[keepwarm] set send day failed:', err);
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
