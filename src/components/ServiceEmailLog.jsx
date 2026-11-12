// ─────────────────────────────────────────────────────────────────────────────
// ServiceEmailLog.jsx — read-only log of every WorkTrackr service email.
//
// Mounted by Dashboard.jsx when activeView === 'email-service-log'.
//
// Exists because service emails had no screen at all: the only way to find out
// whether one had sent was to read the Render log. That is fine for one person
// debugging and useless for a sales team. Every send is already recorded in
// service_email_sends; this just shows it.
//
// Read-only on purpose, with one exception: the "Follow-ups due" list at the
// top has a Cancel per row. Replies go to Outlook, which Studio cannot see, so
// this is where a follow-up to someone who has already answered gets stopped.
// Resending would have to clear the dedup row first or it would refuse itself,
// and a resend button that silently does nothing is worse than no button.
//
// Auto-refreshes every 20s so a send made in WorkTrackr appears here without a
// manual reload — the common case is having this open on a second monitor while
// someone else is calling.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from 'react';
import { SB } from '../brand.js';

const TEXT     = '#1a1a1a';
const MUTED    = '#666';
const TERTIARY = '#999';
const BORDER   = '#e0e0dc';
const BG       = '#f5f5f3';
const CARD     = '#ffffff';
const GREEN    = '#1D7A54';
const GREEN_BG = '#E4F3EC';
const AMBER    = '#854F0B';
const AMBER_BG = '#FAEEDA';
const DANGER   = '#A32D2D';
const DANGER_BG= '#FBEAEA';
const REFRESH_MS = 20000;

const STATUS_STYLE = {
  sent:      { fg: GREEN,  bg: GREEN_BG,  label: 'Sent' },
  queued:    { fg: AMBER,  bg: AMBER_BG,  label: 'Queued' },
  failed:    { fg: DANGER, bg: DANGER_BG, label: 'Failed' },
  cancelled: { fg: MUTED,  bg: '#eeeeec', label: 'Cancelled' },
};

// ── Module-level sub-components ──────────────────────────────────────────────

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || { fg: MUTED, bg: '#eeeeec', label: status || '—' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 999,
      fontSize: 12, fontWeight: 600, color: s.fg, background: s.bg, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

function Stat({ label, value, tone }) {
  const colour = tone === 'bad' && value > 0 ? DANGER : tone === 'good' ? GREEN : TEXT;
  return (
    <div style={{
      flex: 1, minWidth: 130, background: CARD, border: `1px solid ${BORDER}`,
      borderRadius: 8, padding: '12px 14px',
    }}>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: colour }}>{value}</div>
    </div>
  );
}

// Timestamps are stored as UTC by SQLite's datetime('now'). Appending 'Z' makes
// the browser parse them as UTC rather than local, which otherwise shifts every
// row by an hour through British Summer Time.
function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

const TH = {
  textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700,
  color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em',
  borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap',
};
const TD = {
  padding: '10px 12px', fontSize: 13, color: TEXT,
  borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top',
};

// "Today", "Tomorrow", else "Fri 14 Nov". Compared in UK local days, because
// that is how the operator reads the list over a morning coffee.
function dueLabel(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = (x) => x.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  if (day(d) <= day(now)) return 'Today';
  if (day(d) === day(tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}

function DueRow({ r, confirming, busy, onAsk, onConfirm, onKeep }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '10px 14px', borderTop: `1px solid ${BORDER}`, flexWrap: 'wrap',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TEXT }}>
          <span style={{ fontWeight: 700 }}>{dueLabel(r.dueAt)}</span>
          {' · '}{r.companyName || '—'}
          {r.contactName && <span style={{ color: MUTED }}> ({r.contactName})</span>}
        </div>
        <div style={{ fontSize: 12, color: TERTIARY, wordBreak: 'break-all' }}>
          {r.toEmail} · intro sent {when(r.introSentAt)}
        </div>
      </div>
      {confirming ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: MUTED }}>Stop this follow-up?</span>
          <button type="button" onClick={onConfirm} disabled={busy} style={{
            background: DANGER, color: '#fff', border: 'none', borderRadius: 6,
            padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
          }}>{busy ? 'Cancelling…' : 'Yes, cancel it'}</button>
          <button type="button" onClick={onKeep} disabled={busy} style={{
            background: 'transparent', color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 6,
            padding: '5px 11px', fontSize: 12, cursor: 'pointer',
          }}>Keep</button>
        </div>
      ) : (
        <button type="button" onClick={onAsk} style={{
          background: 'transparent', color: DANGER, border: `1px solid ${DANGER}`, borderRadius: 6,
          padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>Cancel</button>
      )}
    </div>
  );
}

function FollowupsDue({ rows, error, onCancelled }) {
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState(null);

  const cancel = async (id) => {
    setBusyId(id);
    setNote(null);
    try {
      const r = await fetch(`/api/service-email-log/followups/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      if (r.status === 409) setNote('Too late, that follow-up has already gone.');
      else if (!r.ok) setNote('Could not cancel that follow-up. Try again.');
    } catch {
      setNote('Could not cancel that follow-up. Try again.');
    } finally {
      setBusyId(null);
      setConfirmId(null);
      onCancelled();
    }
  };

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: SB.dark }}>
          Follow-ups due{rows.length ? ` (${rows.length})` : ''}
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
          Replies go to Outlook, not here. If any of these have replied, cancel them.
        </div>
        {note && <div style={{ fontSize: 12, color: DANGER, marginTop: 6 }}>{note}</div>}
      </div>
      {error ? (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER}`, fontSize: 13, color: DANGER }}>{error}</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER}`, fontSize: 13, color: MUTED }}>
          No follow-ups waiting to go.
        </div>
      ) : rows.map((r) => (
        <DueRow
          key={r.id}
          r={r}
          confirming={confirmId === r.id}
          busy={busyId === r.id}
          onAsk={() => setConfirmId(r.id)}
          onKeep={() => setConfirmId(null)}
          onConfirm={() => cancel(r.id)}
        />
      ))}
    </div>
  );
}

// "Fri 14 Nov" — the day a follow-up goes or went, in UK time.
function dayLabel(iso) {
  if (!iso) return 'an unknown date';
  const d = new Date(`${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}

// Every answer the server can give, as one sentence and a tone. Each refusal is
// spelled out because each one is a way this could otherwise fail quietly.
function bookingMessage(d) {
  const co = d.company || 'that company';
  switch (d.result) {
    case 'booked':
      return { tone: 'good', text: `Booked. ${co} will get the follow-up on ${dayLabel(d.dueAt)}.` };
    case 'already_booked':
      return { tone: 'warn', text: `Already booked for ${dayLabel(d.dueAt)}. Nothing changed.` };
    case 'already_sent':
      return { tone: 'warn', text: `The follow-up already went on ${dayLabel(d.sentAt)}. Nothing booked.` };
    case 'no_intro':
      return { tone: 'bad', text: 'No introduction has ever been sent to that address. Nothing booked.' };
    case 'intro_pending':
      return { tone: 'warn', text: 'The introduction to that address is still sending. Try again in a minute.' };
    case 'too_old':
      return { tone: 'bad', text: `That introduction went on ${dayLabel(d.introAt)}, so its follow-up date has passed. Too old to follow up automatically.` };
    case 'blocked':
      return { tone: 'bad', text: 'That address has unsubscribed or bounced. Nothing booked.' };
    case 'cancelled_before':
      return { tone: 'bad', text: `A follow-up to that address was cancelled${d.reason ? ` (${d.reason})` : ''}. Nothing booked.` };
    case 'company_dead':
      return { tone: 'bad', text: `${co} is dead in WorkTrackr. Nothing booked.` };
    case 'company_customer':
      return { tone: 'bad', text: `${co} is a customer in WorkTrackr. Nothing booked.` };
    case 'no_email':
      return { tone: 'bad', text: 'Enter an email address first.' };
    default:
      return { tone: 'bad', text: 'Could not book that follow-up. Try again.' };
  }
}

const TONE = {
  good: { fg: GREEN,  bg: GREEN_BG },
  warn: { fg: AMBER,  bg: AMBER_BG },
  bad:  { fg: DANGER, bg: DANGER_BG },
};

function BookByHand({ onBooked }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const book = async () => {
    if (!email.trim()) { setMsg(bookingMessage({ result: 'no_email' })); return; }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/service-email-log/followups/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const d = r.ok ? await r.json() : { result: 'error' };
      setMsg(bookingMessage(d));
      if (d.result === 'booked') { setEmail(''); onBooked(); }
    } catch {
      setMsg(bookingMessage({ result: 'error' }));
    } finally {
      setBusy(false);
    }
  };

  const t = msg ? TONE[msg.tone] : null;

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: SB.dark }}>Book a follow-up by hand</div>
      <div style={{ fontSize: 12, color: MUTED, marginTop: 2, marginBottom: 10 }}>
        For an introduction sent without the box ticked. It goes out 7 days after the introduction, the same as ticking it would have.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={email}
          onChange={(e) => { setEmail(e.target.value); setMsg(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) book(); }}
          placeholder="dave@acme.co.uk"
          aria-label="Email address the introduction was sent to"
          style={{
            flex: 1, minWidth: 240, padding: '8px 11px', fontSize: 13,
            border: `1px solid ${BORDER}`, borderRadius: 8, background: CARD, color: TEXT,
          }}
        />
        <button type="button" onClick={book} disabled={busy} style={{
          background: SB.dark, color: '#fff', border: 'none', borderRadius: 8,
          padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
        }}>{busy ? 'Booking…' : 'Book follow-up'}</button>
      </div>
      {msg && (
        <div style={{ marginTop: 10, fontSize: 13, color: t.fg, background: t.bg, borderRadius: 6, padding: '8px 11px' }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function Row({ r }) {
  return (
    <tr>
      <td style={TD}>
        <div style={{ fontWeight: 600 }}>{r.companyName || '—'}</div>
        {r.contactName && (
          <div style={{ fontSize: 12, color: TERTIARY }}>{r.contactName}</div>
        )}
      </td>
      <td style={{ ...TD, wordBreak: 'break-all' }}>{r.toEmail}</td>
      <td style={TD}>
        <StatusPill status={r.status} />
        {r.step === 2 && (
          <div style={{ fontSize: 11, color: TERTIARY, marginTop: 4 }}>Follow-up</div>
        )}
        {r.status === 'failed' && r.error && (
          <div style={{ fontSize: 12, color: DANGER, marginTop: 4, maxWidth: 380 }}>
            {r.error}
          </div>
        )}
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap', color: MUTED }}>
        {when(r.sentAt || r.createdAt)}
      </td>
    </tr>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ServiceEmailLog() {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [due, setDue] = useState([]);
  const [dueError, setDueError] = useState(null);

  // Loaded separately from the log so the log's filters never hide a follow-up
  // that is about to go.
  const loadDue = useCallback(async () => {
    try {
      const r = await fetch('/api/service-email-log/followups-due');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setDue(d.rows || []);
      setDueError(null);
    } catch {
      setDueError('Could not load follow-ups due.');
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      const r = await fetch(`/api/service-email-log/recent?${params.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setRows(d.rows || []);
      setCounts(d.counts || null);
      setError(null);
    } catch (err) {
      setError('Could not load the log.');
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  // Debounced on the filters so typing in the search box doesn't fire a request
  // per keystroke.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    loadDue();
    const t = setInterval(loadDue, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadDue]);

  return (
    <div style={{ flex: 1, overflow: 'auto', background: BG, padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: SB.dark }}>
          Service emails
        </h1>
        <span style={{ fontSize: 13, color: TERTIARY }}>
          Introduction emails sent from WorkTrackr
        </span>
      </div>
      <div style={{ fontSize: 12, color: TERTIARY, marginBottom: 18 }}>
        Refreshes automatically every 20 seconds.
      </div>

      {counts && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <Stat label="Sent (last 24h)"   value={counts.sent24}   tone="good" />
          <Stat label="Failed (last 24h)" value={counts.failed24} tone="bad" />
          <Stat label="Waiting to send"   value={counts.queued} />
          <Stat label="Sent all time"     value={counts.sent} />
        </div>
      )}

      {counts && counts.failed24 > 0 && (
        <div style={{
          background: DANGER_BG, border: `1px solid ${DANGER}`, color: DANGER,
          borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 18,
        }}>
          {counts.failed24} email{counts.failed24 === 1 ? '' : 's'} failed in the last 24 hours.
          The reason is shown against each one below.
        </div>
      )}

      <FollowupsDue rows={due} error={dueError} onCancelled={() => { loadDue(); load(); }} />

      <BookByHand onBooked={() => { loadDue(); load(); }} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search company, contact or address…"
          style={{
            flex: 1, minWidth: 240, padding: '8px 11px', fontSize: 13,
            border: `1px solid ${BORDER}`, borderRadius: 8, background: CARD, color: TEXT,
          }}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{
            padding: '8px 11px', fontSize: 13, border: `1px solid ${BORDER}`,
            borderRadius: 8, background: CARD, color: TEXT,
          }}
        >
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="queued">Queued</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 28, color: MUTED, fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 28, color: DANGER, fontSize: 13 }}>{error}</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 28, color: MUTED, fontSize: 13 }}>
            {q || status
              ? 'Nothing matches that filter.'
              : 'No service emails have been sent yet.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Company</th>
                <th style={TH}>Sent to</th>
                <th style={TH}>Status</th>
                <th style={TH}>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <Row key={r.id} r={r} />)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
