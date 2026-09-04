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
// Read-only on purpose. Resending would have to clear the dedup row first or it
// would refuse itself, and a resend button that silently does nothing is worse
// than no button. If resend is wanted later it needs designing properly.
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
