/**
 * server/services/service-email-ticker.js — Sweeper for WorkTrackr service emails.
 *
 * Two jobs, both handled by the same processDue() call:
 *   1. Initial emails whose 10-second undo window has closed but whose
 *      setTimeout was lost to a restart or deploy.
 *   2. Follow-ups that have come due, 7 days after their parent went out.
 *
 * 30 seconds rather than the drip ticker's 60: the undo window is 10 seconds,
 * so a lost timeout should be picked up in well under a minute. The query is
 * a single indexed lookup on (status, send_after) that matches nothing almost
 * every time it runs, so the cost of the shorter interval is negligible.
 *
 * Deliberately separate from drip-ticker.js. That one paces bulk campaigns
 * across send windows with per-day quotas and jitter; this one sends a handful
 * of one-to-one emails the moment they're due. Sharing a loop would mean a
 * campaign backlog could delay a follow-up, or a service-email failure could
 * disturb a campaign mid-send.
 */

import { processDue } from './service-email-sender.js';

const TICK_INTERVAL_MS = 30 * 1000;

let tickerHandle = null;
let isTicking = false;

export function startServiceEmailTicker() {
  if (tickerHandle) return;
  console.log('[service-email] ticker starting — interval ' + (TICK_INTERVAL_MS / 1000) + 's');

  // Delay the first tick so the rest of the process finishes booting, matching
  // the drip ticker's behaviour.
  setTimeout(() => {
    tick();
    tickerHandle = setInterval(tick, TICK_INTERVAL_MS);
  }, 30_000);
}

export function stopServiceEmailTicker() {
  if (tickerHandle) clearInterval(tickerHandle);
  tickerHandle = null;
}

async function tick() {
  // A slow SES call must not let two sweeps overlap — processDue() claims rows
  // before sending so it would be safe either way, but skipping keeps the logs
  // readable and avoids piling up connections.
  if (isTicking) return;
  isTicking = true;
  try {
    const results = await processDue();
    if (results.sent || results.failed || results.suppressed) {
      console.log('[service-email] tick:', JSON.stringify(results));
    }
  } catch (err) {
    console.error('[service-email] tick failed:', err && err.stack ? err.stack : err);
  } finally {
    isTicking = false;
  }
}
