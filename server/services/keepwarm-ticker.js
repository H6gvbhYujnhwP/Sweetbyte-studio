/**
 * keepwarm-ticker.js — Sweeper for keep-warm sends.
 *
 * The queueing call sets its own timer for the moment the undo window closes,
 * so in the ordinary case a send starts without this ticker being involved at
 * all. This exists for the two cases where that timer is lost or a send does
 * not finish in one go:
 *
 *   1. A deploy or restart inside the undo window kills the setTimeout. Render
 *      redeploys whenever main moves, so this is not hypothetical.
 *   2. A run left half-sent by a restart. Recipients are claimed one at a time,
 *      so resuming means sending the ones still marked queued.
 *
 * 30 seconds, matching the service-email ticker: the undo window is measured in
 * seconds, so a lost timer should be picked up in well under a minute. The
 * query is one indexed lookup that matches nothing almost every time it runs.
 *
 * Deliberately separate from the service-email and drip tickers. A long
 * keep-warm send must not delay a follow-up to somebody who was called this
 * morning, and a campaign backlog must not delay this.
 */

import { processDue } from './keepwarm-sender.js';
import { reconcileBounces } from './bounce-store.js';
import { runReminderCheck } from './keepwarm-reminders.js';

const TICK_INTERVAL_MS = 30 * 1000;

let tickerHandle = null;
let isTicking = false;

export function startKeepwarmTicker() {
  if (tickerHandle) return;
  console.log('[keepwarm] ticker starting — interval ' + (TICK_INTERVAL_MS / 1000) + 's');

  // Delayed first tick so the rest of the process finishes booting, matching
  // the other two tickers.
  setTimeout(() => {
    tick();
    tickerHandle = setInterval(tick, TICK_INTERVAL_MS);
  }, 30_000);
}

export function stopKeepwarmTicker() {
  if (tickerHandle) clearInterval(tickerHandle);
  tickerHandle = null;
}

async function tick() {
  // A thousand-recipient run takes minutes. Without this guard the next tick
  // would start a second pass over the same run — safe, because recipients are
  // claimed before sending, but it would double the SES connections for no
  // reason and make the logs unreadable.
  if (isTicking) return;
  isTicking = true;
  try {
    // Bounce notifications first, and outside the send results. Two reasons it
    // rides on this ticker rather than getting one of its own: an address that
    // died since the last pass should be off the list before the next send
    // claims it, and the query is one indexed rowid scan that matches nothing
    // almost every time.
    //
    // The first pass after a deploy has a cursor of zero, so it walks the whole
    // notification log — that is the backfill of every bounce from before this
    // existed, with no special case to get wrong.
    try {
      reconcileBounces();
    } catch (err) {
      console.error('[keepwarm] bounce reconcile failed:', err && err.message);
    }

    // Send-day reminders. Two mornings a month this produces one email; every
    // other pass it is a date comparison and a single indexed lookup. It runs
    // before processDue() so a reminder is never delayed behind a batch send.
    try {
      await runReminderCheck();
    } catch (err) {
      console.error('[keepwarm] reminder check failed:', err && err.message);
    }

    const results = await processDue();
    if (results.runs) {
      console.log('[keepwarm] tick:', JSON.stringify(results));
    }
  } catch (err) {
    console.error('[keepwarm] tick failed:', err && err.stack ? err.stack : err);
  } finally {
    isTicking = false;
  }
}
