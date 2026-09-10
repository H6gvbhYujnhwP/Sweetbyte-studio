/**
 * server/services/keepwarm-reminders.js — send-day calendar and reminders.
 *
 * WHAT THIS DOES
 * Keep-warm goes out on the 2nd and 4th Tuesday of the month. Nothing here
 * sends a keep-warm email to anybody — that stays a button a person presses.
 * This works out which days those are, emails the operator the day before so
 * there is time to write and approve something, emails again on the morning
 * itself, and tells the screen what to say.
 *
 * WHY A CALENDAR RATHER THAN "EVERY 14 DAYS"
 * Counting fortnights from the last send drifts: a send that slips to Thursday
 * moves every send after it to a Thursday. A named day does not drift, and a
 * rhythm people half-recognise is worth more than an exact interval. The cost
 * is that it is not quite fortnightly — a month with five Tuesdays puts three
 * weeks between the 4th and the next 2nd. That is inherent to the rule, not a
 * fault, and the operator chose it knowing.
 *
 * TIME ZONES — THE BIT THAT WOULD OTHERWISE BE WRONG HALF THE YEAR
 * Render runs on UTC. "09:30" scheduled naively arrives at 09:30 in winter and
 * 10:30 through British Summer Time. Every decision here is made against the
 * London wall clock via Intl, which knows when the clocks change, so 09:30
 * means 09:30 in October and in June.
 *
 * WHY IT RIDES THE EXISTING TICKER
 * The keep-warm ticker already runs every thirty seconds. A reminder is a
 * date comparison and, on two mornings a month, one email. That does not
 * warrant a scheduler, a queue, or a second process. It also means a deploy at
 * 09:29 cannot lose the reminder: the check asks "is it past 09:30 on a day
 * that has not been reminded yet", so the next tick after the server comes back
 * sends it. Late is recoverable, missed is not.
 *
 * Env:
 *   KEEPWARM_REMINDER_TO    default billy@sweetbyte.co.uk
 *   KEEPWARM_REMINDER_CC    optional, no default
 *   KEEPWARM_REMINDER_HOUR  default 9
 *   KEEPWARM_REMINDER_MIN   default 30
 * Sending uses SERVICE_EMAIL_FROM / SERVICE_EMAIL_FROM_NAME, the addresses
 * already verified and already set in Render.
 */

import db from '../db.js';
import { sendEmail } from './ses.js';

const ZONE = 'Europe/London';

const TO   = process.env.KEEPWARM_REMINDER_TO || 'billy@sweetbyte.co.uk';
const CC   = process.env.KEEPWARM_REMINDER_CC || null;
const HOUR = clampNum(process.env.KEEPWARM_REMINDER_HOUR, 9, 0, 23);
const MIN  = clampNum(process.env.KEEPWARM_REMINDER_MIN, 30, 0, 59);

function clampNum(raw, fallback, lo, hi) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

db.exec(`
  CREATE TABLE IF NOT EXISTS keepwarm_reminders_sent (
    key     TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─────────────────────────────────────────────────────────────────────────────
// The London wall clock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What day and time is it in London right now?
 *
 * Read out of Intl rather than calculated, so the clock change is somebody
 * else's problem — specifically the platform's, which is kept up to date.
 */
export function londonNow(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
    hour12: false,
  }).formatToParts(at).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  return {
    date:    `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    // Midnight comes back as "24" from some runtimes; normalised so comparisons
    // against the reminder hour cannot go haywire in the small hours.
    hour:    Number(parts.hour) % 24,
    minute:  Number(parts.minute),
  };
}

// Date maths on plain YYYY-MM-DD strings, done at midday UTC so that no
// arithmetic can slide a date into the previous evening.
function toDate(ymd) { return new Date(ymd + 'T12:00:00Z'); }
function toYmd(d)    { return d.toISOString().slice(0, 10); }

function addDays(ymd, n) {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return toYmd(d);
}

/**
 * The 2nd and 4th Tuesday of a given month, as YYYY-MM-DD.
 */
export function sendDaysIn(year, month) {
  const out = [];
  const d = new Date(Date.UTC(year, month - 1, 1, 12));
  while (d.getUTCMonth() === month - 1) {
    if (d.getUTCDay() === 2) out.push(toYmd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return [out[1], out[3]].filter(Boolean);
}

export function isSendDay(ymd) {
  const d = toDate(ymd);
  return sendDaysIn(d.getUTCFullYear(), d.getUTCMonth() + 1).includes(ymd);
}

/**
 * The next send day on or after `ymd`. Looks into the following month as well,
 * because after the 4th Tuesday there are none left in the current one.
 */
export function nextSendDay(ymd) {
  const d = toDate(ymd);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const candidates = [
    ...sendDaysIn(y, m),
    ...sendDaysIn(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1),
  ];
  return candidates.find(c => c >= ymd) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// What the screen and the emails need to know
// ─────────────────────────────────────────────────────────────────────────────

function sentOnLondonDay(ymd) {
  try {
    const row = db.prepare(`
      SELECT id, subject FROM keepwarm_runs
       WHERE status = 'sent'
         AND date(COALESCE(finished_at, created_at)) = ?
       ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 1
    `).get(ymd);
    return row || null;
  } catch {
    return null;
  }
}

function approvedCount() {
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS n FROM keepwarm_drafts
       WHERE status = 'approved' AND deleted_at IS NULL
    `).get();
    return row?.n || 0;
  } catch {
    return 0;
  }
}

function topApprovedSubject() {
  try {
    const row = db.prepare(`
      SELECT subject FROM keepwarm_drafts
       WHERE status = 'approved' AND deleted_at IS NULL
       ORDER BY COALESCE(approved_at, created_at) ASC LIMIT 1
    `).get();
    return row ? row.subject : null;
  } catch {
    return null;
  }
}

/**
 * The state of play, used by the banner on the screen and by the emails, so the
 * two can never say different things.
 *
 * `audienceCount` is passed in rather than imported. keepwarm-store imports
 * service-email-sender, which is a chain this module has no business joining
 * just to count rows — the route already has the number to hand.
 */
export function reminderStatus(audienceCount = null) {
  const now   = londonNow();
  const today = now.date;
  const sendDay = isSendDay(today);
  const sentRun = sendDay ? sentOnLondonDay(today) : null;
  const next = nextSendDay(sendDay && sentRun ? addDays(today, 1) : today);

  return {
    today,
    isSendDay:     sendDay,
    sentToday:     !!sentRun,
    sentSubject:   sentRun ? sentRun.subject : null,
    isEveOfSend:   isSendDay(addDays(today, 1)),
    nextSendDay:   next,
    approvedCount: approvedCount(),
    topSubject:    topApprovedSubject(),
    audienceCount,
    remindAt:      `${String(HOUR).padStart(2, '0')}:${String(MIN).padStart(2, '0')}`,
    remindTo:      TO,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The emails
// ─────────────────────────────────────────────────────────────────────────────

const WRAP = (inner) => `<div style="font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;color:#1a1a1a;line-height:1.6;">${inner}</div>`;
const P = (t) => `<p style="margin:0 0 1em;">${t}</p>`;

function prettyDate(ymd) {
  return toDate(ymd).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function eveEmail(st) {
  const ready = st.approvedCount > 0;
  const subject = ready
    ? 'Keep-warm goes out tomorrow — one is ready'
    : 'Keep-warm goes out tomorrow — nothing approved yet';

  const body = ready
    ? P(`Tomorrow is a keep-warm send day. You have ${st.approvedCount} approved and ready to go, top of the queue being "${st.topSubject}".`)
      + P('Nothing to do tonight. You will get another note in the morning.')
    : P('Tomorrow is a keep-warm send day and there is nothing approved.')
      + P('If you want one to go out, it needs writing and approving before then. Open the Drafts tab, generate a few, and approve the one you like.');

  return {
    subject,
    html: WRAP(P(`<strong>${prettyDate(st.nextSendDay)}</strong>`) + body + P(`${st.audienceCount == null ? 'The audience' : st.audienceCount + ' people'} would receive it.`)),
  };
}

function dayEmail(st) {
  const ready = st.approvedCount > 0;
  const subject = ready
    ? 'Keep-warm send day — ready when you are'
    : 'Keep-warm send day — nothing approved';

  const body = ready
    ? P(`Today is a keep-warm send day. "${st.topSubject}" is top of the schedule and ready.`)
      + P('Open Studio, go to Keep-warm, then the Schedule tab, and press Send. You have ten seconds to undo afterwards.')
    : P('Today is a keep-warm send day and nothing is approved, so nothing will go unless you write one.')
      + P('If today is a write-off, the next send day is the one after this — no harm done.');

  return {
    subject,
    html: WRAP(P(`<strong>${prettyDate(st.today)}</strong>`) + body + P(`${st.audienceCount == null ? 'The audience' : st.audienceCount + ' people'} are in the loop.`)),
  };
}

function alreadySent(key) {
  return !!db.prepare('SELECT 1 FROM keepwarm_reminders_sent WHERE key = ?').get(key);
}

function markSent(key) {
  db.prepare('INSERT OR IGNORE INTO keepwarm_reminders_sent (key) VALUES (?)').run(key);
}

/**
 * Called by the ticker. Sends at most one email per pass.
 *
 * The marker row goes in BEFORE the send, not after. If SES times out having
 * actually accepted the message, the alternative is a reminder every thirty
 * seconds until the operator disables the feature in irritation. A reminder
 * that fails to arrive is a missed nudge; a reminder that arrives a hundred
 * times is worse than the problem it solves.
 */
export async function runReminderCheck(audienceCount = null) {
  const now = londonNow();
  const mins = now.hour * 60 + now.minute;
  if (mins < HOUR * 60 + MIN) return { sent: null };

  const st = reminderStatus(audienceCount);

  let kind = null;
  if (st.isSendDay && !st.sentToday) kind = 'day';
  else if (st.isEveOfSend) kind = 'eve';
  if (!kind) return { sent: null };

  const key = `${st.today}:${kind}`;
  if (alreadySent(key)) return { sent: null };

  const from     = process.env.SERVICE_EMAIL_FROM;
  const fromName = process.env.SERVICE_EMAIL_FROM_NAME;
  if (!from || !fromName) {
    console.error('[keepwarm] reminder not sent — SERVICE_EMAIL_FROM is not set');
    return { sent: null, error: 'no_from' };
  }

  const { subject, html } = kind === 'eve' ? eveEmail(st) : dayEmail(st);

  markSent(key);

  try {
    await sendEmail({
      to: TO,
      cc: CC,
      fromName,
      fromEmail: from,
      replyTo: from,
      subject,
      htmlBody: html,
      plainBody: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
    console.log(`[keepwarm] ${kind === 'eve' ? 'day-before' : 'send-day'} reminder sent to ${TO}`);
    return { sent: kind };
  } catch (err) {
    console.error('[keepwarm] reminder failed to send:', err && err.message);
    return { sent: null, error: err && err.message };
  }
}
