// ─────────────────────────────────────────────────────────────────────────────
// KeepWarm.jsx — keep-warm emails: audience, generation, review.
//
// Mounted by Dashboard.jsx when activeView === 'keepwarm'.
//
// The people on this screen are everyone Sweetbyte has already sent Billy's
// introduction email to, minus anyone who has since gone dead, been marked
// contacted, or opted out. Keep-warm is the fortnightly note that keeps them
// remembering us while they are still deciding.
//
// PHASE 1. Audience, stage rule, generation and review only. There is no send
// button anywhere on this screen and no route behind it that could mail
// anybody — choosing recipients and sending are Phase 2. A half-built send
// path behind a button is exactly the accident worth designing out.
//
// SUB-COMPONENT RULE. Every piece of this screen is defined at module level,
// never inside the KeepWarm function body. A component defined inside the
// render is a brand-new component type on every keystroke, so React unmounts
// and remounts it — and the subject box loses focus after every character
// typed. This has bitten the WorkTrackr panel before; do not move these.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SB } from '../brand.js';
import KeepWarmLanes from './KeepWarmLanes.jsx';

const TEXT      = '#1a1a1a';
const MUTED     = '#666';
const TERTIARY  = '#999';
const BORDER    = '#e0e0dc';
const BG        = '#f5f5f3';
const CARD      = '#ffffff';
const GOOD      = '#1D7A54';
const GOOD_BG   = '#E4F3EC';
const AMBER     = '#854F0B';
const AMBER_BG  = '#FAEEDA';
const DANGER    = '#A32D2D';
const DANGER_BG = '#FBEAEA';

const STATUS_STYLE = {
  draft:    { fg: MUTED,  bg: '#eeeeec', label: 'Not reviewed' },
  approved: { fg: GOOD,   bg: GOOD_BG,   label: 'Approved' },
  rejected: { fg: DANGER, bg: DANGER_BG, label: 'Rejected' },
  sent:     { fg: SB.dark, bg: SB.tint,  label: 'Sent' },
};

// SQLite stores datetime('now') as UTC without a zone marker. Appending 'Z'
// makes the browser parse it as UTC rather than local, which otherwise shifts
// every row by an hour through British Summer Time.
function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return ts;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Slot dates arrive as plain YYYY-MM-DD with no time and no zone. Parsing them
// as UTC and printing them as UTC keeps the day the server meant — read as
// local time, a date can slide back to the previous evening.
function fmtDate(d) {
  if (!d) return '—';
  const x = new Date(d + 'T12:00:00Z');
  if (isNaN(x)) return d;
  return x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ── Module-level sub-components ──────────────────────────────────────────────

function Card({ children, style }) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10,
      padding: '16px 18px', marginBottom: 16, ...style,
    }}>{children}</div>
  );
}

function Pill({ status }) {
  const s = STATUS_STYLE[status] || { fg: MUTED, bg: '#eeeeec', label: status || '—' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 999,
      fontSize: 12, fontWeight: 600, color: s.fg, background: s.bg, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

function Button({ children, onClick, tone = 'plain', disabled, style }) {
  const tones = {
    plain:   { bg: CARD,       fg: TEXT,          bd: BORDER },
    primary: { bg: SB.primary, fg: SB.onPrimary,  bd: SB.primary },
    danger:  { bg: CARD,       fg: DANGER,        bd: '#e9c9c9' },
    ghost:   { bg: 'transparent', fg: MUTED,      bd: 'transparent' },
  };
  const t = tones[tone] || tones.plain;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
        borderRadius: 7, padding: '7px 13px', fontSize: 13, fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        fontFamily: 'inherit', ...style,
      }}
    >{children}</button>
  );
}

function Banner({ tone, children }) {
  const map = {
    bad:  { fg: DANGER, bg: DANGER_BG, bd: '#efd4d4' },
    warn: { fg: AMBER,  bg: AMBER_BG,  bd: '#eeddba' },
    info: { fg: SB.dark, bg: SB.tint,  bd: '#c6e6f2' },
  };
  const t = map[tone] || map.info;
  return (
    <div style={{
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, borderRadius: 8,
      padding: '10px 13px', fontSize: 13, lineHeight: 1.55, marginBottom: 14,
    }}>{children}</div>
  );
}

function StageChip({ stage, onToggle }) {
  const on = stage.selected;

  // A locked stage still shows its number — the operator wants to see how many
  // people are sitting there — but it is not a control. Rendered as a span, not
  // a disabled button, so there is nothing to click and nothing to double-click
  // through. The padlock and the tooltip say why.
  if (stage.locked) {
    return (
      <span
        title="Customers are never sent keep-warm emails. This copy is written to win new business."
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          color: TERTIARY,
          borderRadius: 999, padding: '6px 13px', fontSize: 13, fontWeight: 600,
          fontFamily: 'inherit', cursor: 'default', opacity: 0.72,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        {stage.label}
        <span style={{ fontWeight: 500, color: TERTIARY }}>{stage.count}</span>
      </span>
    );
  }

  return (
    <button
      onClick={() => onToggle(stage.key)}
      style={{
        background: on ? SB.tint : CARD,
        border: `1px solid ${on ? SB.primary : BORDER}`,
        color: on ? SB.dark : MUTED,
        borderRadius: 999, padding: '6px 13px', fontSize: 13, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      {stage.label}
      <span style={{ marginLeft: 7, fontWeight: 500, color: on ? SB.strong : TERTIARY }}>
        {stage.count}
      </span>
    </button>
  );
}

// `selectable` is only ever true for the in-the-loop list. The excluded list
// has nothing to tick — those people are already out, and a tickbox beside
// somebody who has unsubscribed would suggest you could tick them back in.
function AudienceRow({ row, selectable = false, checked = true, onToggle, onRemove, onRestore, busy }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 12px', borderBottom: `1px solid ${BORDER}`,
    }}>
      {selectable && (
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(row.email)}
          aria-label={`Include ${row.email}`}
          style={{ width: 15, height: 15, cursor: 'pointer', accentColor: SB.primary, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0, opacity: selectable && !checked ? 0.45 : 1 }}>
        <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.contactName ? `${row.contactName} — ` : ''}{row.companyName || 'Unknown company'}
        </div>
        <div style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.email}
        </div>
      </div>
      {!row.reason && <GreetingPill greeting={row.greeting} />}
      <span style={{
        fontSize: 12, color: row.reason ? MUTED : SB.dark,
        background: row.reason ? '#eeeeec' : SB.tint,
        padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      }}>{row.reason || row.stageLabel}</span>
      {row.removedByHand && onRestore && (
        <button
          onClick={() => onRestore(row.email)}
          disabled={busy}
          title="Put this person back into the loop"
          style={{
            fontSize: 13, color: busy ? TERTIARY : SB.dark, background: 'none', border: 'none',
            cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', padding: 0, whiteSpace: 'nowrap',
          }}
        >
          Put back
        </button>
      )}
      {!row.removedByHand && onRemove && (
        <button
          onClick={() => onRemove(row.email)}
          disabled={busy}
          title="Take this person out of the loop"
          style={{
            fontSize: 13, color: busy ? TERTIARY : DANGER, background: 'none', border: 'none',
            cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', padding: 0, whiteSpace: 'nowrap',
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
}

// One address on the "By hand" list. Mirrors DeadRow deliberately: same shape,
// same Remove on the right, because the two lists do the same kind of job and a
// second layout to learn is a cost with no benefit.
function ManualRow({ row, onRemove, busy }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 12px', borderBottom: `1px solid ${BORDER}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.contactName ? `${row.contactName} — ` : ''}{row.companyName || 'No company recorded'}
        </div>
        <div style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.email}
        </div>
      </div>
      <GreetingPill greeting={row.greeting} />
      <span style={{
        fontSize: 12, color: row.stage ? SB.dark : AMBER,
        background: row.stage ? SB.tint : AMBER_BG,
        padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      }}>{row.stage ? row.stageLabel : 'No stage — not in the loop'}</span>
      <button
        onClick={() => onRemove(row.email)}
        disabled={busy}
        style={{
          fontSize: 13, color: busy ? TERTIARY : DANGER, background: 'none', border: 'none',
          cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', padding: 0, whiteSpace: 'nowrap',
        }}
      >
        Remove
      </button>
    </div>
  );
}

// The four numbers that decide whether to send anything, as tiles.
//
// They were a 34px figure with three more numbers buried in the sentence under
// it. Pulled out so the page answers "how many, and how many are not getting
// it" before anything has to be read.
function LoopTiles({ overview }) {
  const tiles = [
    { label: 'In the loop',   value: overview.audienceCount,   hint: 'would receive the next email' },
    { label: 'Excluded',      value: overview.excludedCount,   hint: 'wrong stage, removed, or no stage' },
    { label: 'Unsubscribed',  value: overview.suppressedCount, hint: 'never emailed again' },
    { label: 'Bounced',       value: overview.deadInAudience,  hint: 'address does not work' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
      {tiles.map(t => (
        <div key={t.label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: MUTED }}>{t.label}</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: t.label === 'In the loop' ? SB.strong : TEXT, lineHeight: 1.2, margin: '2px 0 2px' }}>
            {t.value}
          </div>
          <div style={{ fontSize: 11, color: TERTIARY, lineHeight: 1.4 }}>{t.hint}</div>
        </div>
      ))}
    </div>
  );
}

// A drawer. Shut by default, and its heading readable while it is shut, so
// nothing is hidden — only set aside.
function Fold({ title, note, children, defaultOpen = false, last = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: last ? 'none' : `1px solid ${BORDER}` }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          padding: '13px 16px', cursor: 'pointer', font: 'inherit',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>
          <span style={{ color: TERTIARY, marginRight: 8 }}>{open ? '▾' : '▸'}</span>
          {title}
        </span>
        {note && <span style={{ fontSize: 12, color: MUTED }}>{note}</span>}
      </button>
      {open && <div style={{ padding: '0 16px 16px' }}>{children}</div>}
    </div>
  );
}

// The catch-up list.
//
// Everybody carrying a topic that was set here rather than in WorkTrackr. The
// point of the list is to empty it: tick these across in the CRM when you are
// next in there, and Studio stops having an opinion of its own. A row that has
// been mirrored says so and can be cleared, because Studio's copy is then doing
// nothing at all.
//
// Draws nothing when there is nothing on it, which is the normal state.
function HandSetTopicsCard({ reloadKey, bare = false, onCount }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/keepwarm/people/hand-set');
      const d = await r.json();
      if (r.ok) setRows(d.rows || []);
    } catch { /* the card just stays hidden */ }
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  // The drawer's heading needs the number while the drawer is shut.
  useEffect(() => { if (onCount) onCount(rows ? rows.length : 0); }, [rows, onCount]);

  async function clearOne(email) {
    setBusy(email);
    try {
      await fetch(`/api/keepwarm/people/${encodeURIComponent(email)}/interests`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interests: [] }),
      });
      await load();
    } catch { /* leave the row alone; pressing again tries again */ }
    finally { setBusy(null); }
  }

  if (!rows || !rows.length) return null;

  const Wrap = bare ? React.Fragment : Card;

  return (
    <Wrap>
      {!bare && (
        <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: '0 0 4px' }}>
          Topics set here, not in WorkTrackr ({rows.length})
        </h2>
      )}
      <p style={{ fontSize: 13, color: MUTED, margin: '0 0 12px', lineHeight: 1.6 }}>
        These people are in a lane because of a tick made in Studio. Nothing is sent to WorkTrackr,
        so the CRM still says what it always said. Tick them across over there when you get a
        chance and clear the row here, and the two agree again.
      </p>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div
            key={r.email}
            style={{
              display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) 110px',
              gap: 10, alignItems: 'center', padding: '10px 12px', fontSize: 13,
              borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
            }}
          >
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <div style={{ color: TEXT }}>{r.companyName || r.email}</div>
              <div style={{ fontSize: 12, color: TERTIARY }}>{r.contactName || r.email}</div>
            </div>
            <div style={{ fontSize: 12, color: MUTED }}>
              WorkTrackr: {r.fromWorkTrackr.length ? r.fromWorkTrackr.join(', ') : 'nothing'}
            </div>
            <div style={{ fontSize: 12, color: TEXT }}>
              Set here: {r.handSet.join(', ')}
              {!r.inLoop && (
                <span style={{ display: 'block', color: '#854F0B', marginTop: 2 }}>
                  Not in the loop, so this is doing nothing
                </span>
              )}
              {r.mirrored && (
                <span style={{ display: 'block', color: TERTIARY, marginTop: 2 }}>
                  Now ticked in WorkTrackr too
                </span>
              )}
            </div>
            <div style={{ justifySelf: 'end' }}>
              <Button onClick={() => clearOne(r.email)} disabled={busy === r.email}>
                {busy === r.email ? 'Clearing…' : 'Clear'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Wrap>
  );
}

// Adding ONE person, by searching for their company rather than typing its id.
//
// The paste box below is still the right tool for a list. This is for the
// ordinary case of one address off a business card, where hunting down a
// WorkTrackr id in order to type it out is the entire difficulty — and getting
// it wrong, or leaving it out, means the person joins the loop with no sales
// stage and is then silently left out of every send.
//
// Studio already holds every company WorkTrackr has ever sent, so it can find
// the id itself. That is all this box does.
function AddOnePersonCard({ onAdded, bare = false }) {
  const [email, setEmail]     = useState('');
  const [contact, setContact] = useState('');
  const [query, setQuery]     = useState('');
  const [hits, setHits]       = useState([]);
  const [picked, setPicked]   = useState(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [done, setDone]       = useState(null);

  useEffect(() => {
    if (picked || query.trim().length < 2) { setHits([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/keepwarm/companies?q=${encodeURIComponent(query.trim())}`);
        const d = await r.json();
        if (!cancelled && r.ok) setHits(d.companies || []);
      } catch { /* the box just shows nothing */ }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, picked]);

  async function add() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await fetch('/api/keepwarm/loop/add-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          contactName: contact.trim(),
          companyId: picked?.id || '',
          companyName: picked?.name || '',
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not add them');
      setDone(d.restored ? 'Put back into the loop.' : 'Added to the loop.');
      setEmail(''); setContact(''); setQuery(''); setPicked(null); setHits([]);
      if (onAdded) onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const field = {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13,
    border: `1px solid ${BORDER}`, borderRadius: 8, background: BG, color: TEXT, font: 'inherit',
  };

  const Wrap = bare ? React.Fragment : Card;

  return (
    <Wrap>
      {!bare && (
        <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: '0 0 4px' }}>
          Add one person
        </h2>
      )}
      <p style={{ fontSize: 13, color: MUTED, margin: '0 0 12px', lineHeight: 1.6 }}>
        Search for the company instead of typing its WorkTrackr id. Adding somebody here does not
        email them — they join the audience for the next keep-warm send.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>Email</div>
          <input type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="anna@sentek.co.uk" style={field} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>Contact name</div>
          <input type="text" value={contact} onChange={e => setContact(e.target.value)} placeholder="Anna Smith" style={field} />
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>Company in WorkTrackr</div>
        {picked
          ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 11px', border: `1px solid ${BORDER}`, borderRadius: 8, background: BG }}>
              <span style={{ fontSize: 13, color: TEXT }}>{picked.name}</span>
              <span style={{ fontSize: 12, color: MUTED }}>{picked.stageLabel}</span>
              <button
                type="button"
                onClick={() => { setPicked(null); setQuery(''); }}
                style={{ font: 'inherit', fontSize: 12, color: TERTIARY, background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}
              >
                change
              </button>
            </div>
          )
          : (<>
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Start typing a company name" style={field} />
            {hits.length > 0 && (
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
                {hits.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setPicked(c); setHits([]); if (!contact.trim() && c.contact) setContact(c.contact); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', font: 'inherit', fontSize: 13,
                      padding: '9px 11px', background: 'none', border: 'none', borderTop: `1px solid ${BORDER}`,
                      cursor: 'pointer', color: TEXT,
                    }}
                  >
                    {c.name} <span style={{ color: MUTED }}>· {c.stageLabel}</span>
                  </button>
                ))}
              </div>
            )}
          </>)}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <Button tone="primary" disabled={busy || !email.trim() || !picked} onClick={add}>
          {busy ? 'Adding…' : 'Add to the loop'}
        </Button>
        {!picked && (
          <span style={{ fontSize: 12, color: '#854F0B', background: '#FBF3E4', borderRadius: 7, padding: '5px 9px', lineHeight: 1.5 }}>
            A company is needed. Without one there is no sales stage, and anybody with no stage is
            left out of every send.
          </span>
        )}
        {done && <span style={{ fontSize: 12, color: SB.dark }}>{done}</span>}
      </div>

      {error && <p style={{ fontSize: 13, color: '#A32D2D', margin: '10px 0 0', lineHeight: 1.6 }}>{error}</p>}
    </Wrap>
  );
}

// The paste box. Kept as its own component so the Audience card does not grow a
// third responsibility inline.
function AddByHandCard({ text, onText, onAdd, busy, result, bare = false }) {
  const Wrap = bare ? React.Fragment : Card;
  return (
    <Wrap>
      {!bare && (
        <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: '0 0 4px' }}>
          Add a list of addresses
        </h2>
      )}
      <p style={{ fontSize: 13, color: MUTED, margin: '0 0 12px', lineHeight: 1.6 }}>
        For people whose address you have but who have never been sent an introduction email —
        addresses that were only ever written into WorkTrackr notes, for instance. One per line.
        Paste the WorkTrackr company id, company and contact name alongside if you have them, in any
        order, separated by tabs or commas. <strong>The company id is what gives somebody a sales
        stage</strong>, and without a stage they will not appear in the loop.
      </p>
      <p style={{ fontSize: 13, color: MUTED, margin: '0 0 12px', lineHeight: 1.6 }}>
        Anything already in the loop, unsubscribed or bounced is skipped, and you will be told which.
        Nothing is emailed by adding somebody here — they simply join the audience for the next
        keep-warm send.
      </p>

      <textarea
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder={'dale.storrer@storrerandco.co.uk\n6c412c97-45c1-46a4-bfca-223e3b1f33eb\tStorrer & Co\tDale'}
        rows={6}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 11px',
          fontSize: 12, lineHeight: 1.5, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          border: `1px solid ${BORDER}`, borderRadius: 8, background: BG, color: TEXT, resize: 'vertical',
        }}
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <Button tone="primary" disabled={busy || !text.trim()} onClick={onAdd}>
          {busy ? 'Adding…' : 'Add to the loop'}
        </Button>
        {text.trim() && !busy && (
          <span style={{ fontSize: 12, color: TERTIARY }}>
            {text.trim().split(/\r?\n/).filter(l => l.trim()).length} lines pasted
          </span>
        )}
      </div>

      {result && <ManualResult result={result} />}
    </Wrap>
  );
}

// What happened, in full. A count on its own invites "which ones?", and the
// answer changes what the operator does next.
function ManualResult({ result }) {
  const groups = {};
  for (const s of result.skipped || []) {
    (groups[s.reason] = groups[s.reason] || []).push(s.email);
  }
  return (
    <div style={{ marginTop: 12 }}>
      <Banner tone={(result.added || result.restored) ? 'good' : 'warn'}>
        {[
          result.added
            ? `${result.added} ${result.added === 1 ? 'address' : 'addresses'} added to the loop.`
            : null,
          // Somebody who had been taken out of the loop by hand and has now been
          // pasted back in. Said separately from "added", because nothing new
          // was created and no introduction will be sent to them.
          result.restored
            ? `${result.restored} ${result.restored === 1 ? 'address' : 'addresses'} put back into the loop.`
            : null,
        ].filter(Boolean).join(' ') || 'Nothing was added.'}
        {result.noCompanyId > 0 && ` ${result.noCompanyId} of them had no company id, so they have no sales
           stage — tick "No stage set" above to include them, or add the company id and they will pick
           up their stage from WorkTrackr automatically.`}
      </Banner>

      {Object.keys(groups).map(reason => (
        <div key={reason} style={{ fontSize: 13, color: MUTED, marginBottom: 6, lineHeight: 1.6 }}>
          <strong style={{ color: TEXT }}>
            {groups[reason].length} skipped — {reason}:
          </strong>{' '}
          {groups[reason].slice(0, 8).join(', ')}
          {groups[reason].length > 8 && ` and ${groups[reason].length - 8} more`}
        </div>
      ))}

      {(result.unreadable || []).length > 0 && (
        <div style={{ fontSize: 13, color: DANGER, marginTop: 6, lineHeight: 1.6 }}>
          <strong>{result.unreadable.length} lines had no email address in them</strong> and were
          ignored: {result.unreadable.slice(0, 4).map(l => `"${l}"`).join(', ')}
          {result.unreadable.length > 4 && ` and ${result.unreadable.length - 4} more`}
        </div>
      )}
    </div>
  );
}

// One address on the Dead list. The reason is the plain-English version; the
// raw diagnostic from the mail server sits underneath in small type, because
// the person deciding whether to delete a prospect should not have to read
// "smtp; 550 5.1.1 user unknown" to find out what happened, but should be able
// to if they want to.
//
// Defined at module level like everything else on this screen — see the
// SUB-COMPONENT RULE at the top of the file.
function DeadRow({ row, onRemove, busy }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 12px', borderBottom: `1px solid ${BORDER}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.contactName ? `${row.contactName} — ` : ''}{row.companyName || 'Unknown company'}
        </div>
        <div style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.email}
        </div>
        {row.diagnostic && (
          <div style={{ fontSize: 11, color: TERTIARY, whiteSpace: 'nowrap', overflow: 'hidden',
                        textOverflow: 'ellipsis', marginTop: 2 }}>
            {row.diagnostic}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: DANGER }}>{row.reason}</div>
        <div style={{ fontSize: 12, color: TERTIARY }}>
          Bounced {fmt(row.lastSeenAt)}{row.source ? ` · ${row.source}` : ''}
        </div>
      </div>
      <Button tone="plain" disabled={busy} onClick={() => onRemove(row.email)} style={{ flexShrink: 0 }}>
        Remove
      </Button>
    </div>
  );
}

// One of the operator's own subject lines. A line that has been sent, or that
// is already sitting in a draft, is shown struck through and cannot be ticked —
// visible rather than hidden, so it is obvious the line was used rather than
// lost. Module level, per the SUB-COMPONENT RULE at the top of the file.
// The send-day banner. Three states and nothing in between: today is the day
// and it has not gone, today is the day and it has, or it is neither and the
// next date is worth knowing quietly.
//
// The "sent" state names the next date rather than just saying well done,
// because the useful half of "that is done" is "and the next one is when".
function SendDayBanner({ r }) {
  if (!r) return null;

  const box = (bg, border, fg, children) => (
    <div style={{
      background: bg, border: `1px solid ${border}`, color: fg,
      borderRadius: 8, padding: '11px 13px', marginBottom: 14,
      fontSize: 13, lineHeight: 1.6,
    }}>{children}</div>
  );

  if (r.isSendDay && r.sentToday) {
    return box(GOOD_BG, GOOD, GOOD, (
      <>
        <strong>Sent today.</strong>{' '}
        {r.sentSubject ? `"${r.sentSubject}" has gone out. ` : ''}
        Next send day is {fmtDate(r.nextSendDay)}.
      </>
    ));
  }

  if (r.isSendDay) {
    return box(AMBER_BG, AMBER, AMBER, (
      <>
        <strong>Send day.</strong>{' '}
        {r.approvedCount > 0
          ? <>“{r.topSubject}” is approved and top of the queue. {r.audienceCount} people are in the loop — open the Emails tab and press Send in step 3.</>
          : <>Nothing is approved, so nothing will go out. Generate a few below and approve one.</>}
      </>
    ));
  }

  if (r.isEveOfSend) {
    return box(AMBER_BG, AMBER, AMBER, (
      <>
        <strong>Send day is tomorrow.</strong>{' '}
        {r.approvedCount > 0
          ? <>“{r.topSubject}” is ready. Nothing to do today.</>
          : <>Nothing is approved yet — today is the day to get one written and approved.</>}
      </>
    ));
  }

  return (
    <div style={{ fontSize: 12, color: TERTIARY, marginBottom: 14 }}>
      Next send day: {fmtDate(r.nextSendDay)}. A reminder goes to {r.remindTo} the day before and again at {r.remindAt}.
    </div>
  );
}

// The lane labels, for the badge on a draft card and nowhere else.
//
// A copy of the labels rather than a fetch, because this is one word on a badge
// and a second network call to render it would be out of proportion. The keys
// are permanent — that is the whole point of them — so the copy cannot drift in
// the way that matters. An unrecognised key falls back to the key itself, which
// reads oddly but never blanks the badge.
// it_support is kept here on purpose even though it is no longer a lane. A
// draft written before the merge still carries the key, and a badge reading
// "it_support" would be worse than one reading "IT support (retired)".
const LANE_LABELS = {
  it_support:     'IT support (retired)',
  cyber_security: 'Cyber security',
  internet:       'Business internet',
  wifi:           'Managed Wi-Fi',
  website:        'Website',
  domains:        'Domains & hosting',
  microsoft_365:  'Microsoft 365',
  voip:           'VoIP telephony',
  custom_apps:    'Custom apps',
  __none:         'General IT support',
};

function laneLabel(key) {
  return LANE_LABELS[key] || key;
}

/**
 * The read view. Shows the whole email exactly as it would be delivered —
 * greeting, body, Billy's signature, address block, opt-out line — because the
 * stored body is only the middle of that, and approving an email you have only
 * seen two thirds of is not approving it.
 *
 * The body edit box is raw HTML rather than a rich editor. Paragraphs come out
 * of the generator already carrying the exact inline styles Outlook needs, and
 * a rich editor would quietly rewrite them into something that renders
 * differently in Word's mail renderer.
 */
function ReadPanel({
  state, onClose, onChange, onSave, onStatus, saving,
  onRegenerate, regenerating, subjectHistory, onPickSubject, bodyUndo, onUndoBody, regenError,
}) {
  if (!state) return null;
  const { draft, preview } = state;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,29,63,0.45)', zIndex: 50,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px',
      overflowY: 'auto',
    }}>
      <div style={{
        background: BG, borderRadius: 12, width: '100%', maxWidth: 860,
        border: `1px solid ${BORDER}`, overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
          background: CARD, borderBottom: `1px solid ${BORDER}`,
        }}>
          <Pill status={draft.status} />
          <div style={{ flex: 1, fontSize: 13, color: MUTED }}>
            Generated {fmt(draft.created_at)}
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 5 }}>Subject line</div>
          <input
            value={draft.subject}
            onChange={(e) => onChange({ subject: e.target.value })}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 15,
              border: `1px solid ${BORDER}`, borderRadius: 7, fontFamily: 'inherit', marginBottom: 4,
            }}
          />
          <div style={{ fontSize: 12, color: draft.subject.length > 60 ? AMBER : TERTIARY, marginBottom: 8 }}>
            {draft.subject.length} characters{draft.subject.length > 60 ? ' — long subjects get cut off in most inboxes' : ''}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <Button
              disabled={regenerating || saving}
              onClick={() => onRegenerate('subject')}
            >
              {regenerating === 'subject' ? 'Writing a new subject…' : 'New subject line'}
            </Button>
            <span style={{ fontSize: 12, color: TERTIARY }}>Rewrites the subject only. The email below stays as it is.</span>
          </div>

          {subjectHistory.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: TERTIARY, marginBottom: 5 }}>Earlier subject lines — click one to put it back</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {subjectHistory.map((sub, i) => (
                  <button
                    key={i}
                    onClick={() => onPickSubject(sub)}
                    style={{
                      background: CARD, border: `1px solid ${BORDER}`, color: MUTED,
                      borderRadius: 999, padding: '4px 11px', fontSize: 12,
                      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >{sub}</button>
                ))}
              </div>
            </div>
          )}

          {regenError && <Banner tone="bad">{regenError}</Banner>}

          <div style={{ fontSize: 12, color: MUTED, marginBottom: 5 }}>How it will look</div>
          <div
            style={{
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8,
              padding: '18px 20px', marginBottom: 18, maxHeight: 420, overflowY: 'auto',
            }}
            dangerouslySetInnerHTML={{ __html: preview }}
          />

          <div style={{ fontSize: 12, color: MUTED, marginBottom: 5 }}>
            Body — edit the wording here, then save
          </div>
          <textarea
            value={state.bodyText}
            onChange={(e) => onChange({ bodyText: e.target.value })}
            rows={12}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 14,
              border: `1px solid ${BORDER}`, borderRadius: 7, fontFamily: 'inherit',
              lineHeight: 1.7, resize: 'vertical', color: TEXT,
            }}
          />
          <div style={{ fontSize: 12, color: TERTIARY, marginTop: 6, marginBottom: 10 }}>
            Leave a blank line between paragraphs. The fonts and sizing are handled for you.
            Saving an edit clears the approval, so re-approve afterwards.
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            <Button
              disabled={regenerating || saving}
              onClick={() => onRegenerate('body')}
            >
              {regenerating === 'body' ? 'Rewriting the email…' : 'Rewrite the email'}
            </Button>
            {bodyUndo && (
              <Button disabled={regenerating || saving} onClick={onUndoBody}>Put the old one back</Button>
            )}
            <span style={{ fontSize: 12, color: TERTIARY }}>Rewrites the email only, on the same subject line above.</span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button tone="primary" disabled={saving} onClick={onSave}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            {draft.status !== 'approved' && (
              <Button disabled={saving} onClick={() => onStatus(draft.id, 'approved')}>Approve</Button>
            )}
            <Button tone="danger" disabled={saving} onClick={() => onStatus(draft.id, 'rejected')}>Bin this one</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The Read view, opened from any email on the Emails tab. An email exactly as one real person on
 * its list will receive it: From, To, subject, then the whole message —
 * greeting with their name, bullets, example websites, signature, opt-out line
 * and disclaimer — built by the server with the same call the real send uses.
 *
 * Deliberately read only. Editing an approved email clears its approval and
 * takes it off the schedule, which is not something to do by accident while
 * just looking. "Change it in Drafts" opens the normal editing view instead.
 */
// The "Who gets it" list inside the Read view. Its own component so the search
// box and the tick keep their own state, and so the panel above can still
// return nothing when it is closed. Module level, per the rule at the top.
function WhoGetsIt({ people, selected, switching, onPick }) {
  const [search, setSearch] = useState('');
  const [onlyThere, setOnlyThere] = useState(false);

  const q = search.trim().toLowerCase();
  const thereCount = people.filter(p => p.greeting === 'there').length;
  const shown = people.filter(p =>
    (!onlyThere || p.greeting === 'there')
    && (!q || `${p.name || ''} ${p.email} ${p.company || ''}`.toLowerCase().includes(q)));

  const cell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>Who gets it</span>
        <span style={{ fontSize: 12, color: TERTIARY }}>{people.length} on this email's list today</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or company"
          style={{
            flex: 1, minWidth: 180, padding: '6px 9px', fontSize: 13, fontFamily: 'inherit',
            border: `1px solid ${BORDER}`, borderRadius: 7,
          }}
        />
        <label style={{ fontSize: 12.5, color: AMBER, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyThere} onChange={(e) => setOnlyThere(e.target.checked)}
                 style={{ accentColor: SB.primary }} />
          Only “Hi there” ({thereCount})
        </label>
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 7, maxHeight: 240, overflow: 'auto' }}>
        {shown.length === 0 && (
          <div style={{ padding: '9px 10px', fontSize: 13, color: MUTED }}>
            {people.length === 0 ? 'Nobody is on this email\'s list right now.' : 'Nobody matches.'}
          </div>
        )}
        {shown.map(p => {
          const isSel = p.email === selected;
          const isLoading = p.email === switching;
          return (
            <div
              key={p.email}
              onClick={() => { if (!isSel && !switching) onPick(p.email); }}
              style={{
                display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) minmax(170px,1.4fr) minmax(130px,1.2fr) 120px',
                gap: 10, alignItems: 'center', padding: '7px 10px', fontSize: 12.5, minWidth: 580,
                borderBottom: `1px solid ${BORDER}`, background: isSel ? SB.tint : CARD,
                cursor: isSel || switching ? 'default' : 'pointer',
              }}
            >
              <span style={{ ...cell, color: p.name ? TEXT : TERTIARY }}>{p.name || 'no name'}</span>
              <span style={{ ...cell, color: MUTED }}>{p.email}</span>
              <span style={{ ...cell, color: MUTED }}>{p.company || '—'}</span>
              <span style={{ justifySelf: 'start', whiteSpace: 'nowrap' }}>
                {isLoading
                  ? <span style={{ color: TERTIARY }}>Loading…</span>
                  : p.greeting === 'there'
                    ? <span style={{ color: AMBER, background: AMBER_BG, borderRadius: 999, padding: '1px 8px' }}>Hi there,</span>
                    : <span style={{ color: SB.dark, fontWeight: 600 }}>Hi {p.greeting},</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: TERTIARY, marginTop: 8, lineHeight: 1.5 }}>
        Click anyone to see their copy below. Names come from the contact name in WorkTrackr. To fix one, change it there.
        The final list is fixed when you press Send.
      </div>
    </div>
  );
}

function ReadCopyPanel({
  state, onClose, onEdit, onPick, onApprove, onBin, onRestore, busy,
  testTo, onTestTo, onTest, testBusy, testNote, testError,
}) {
  if (!state) return null;
  const { slot, copy, loading, error, switching } = state;

  // Status comes from the server once the copy arrives; until then, from
  // whichever column the email was opened from.
  const status = copy ? copy.status : (slot.status || 'approved');

  const who = (p) => p.name ? `${p.name} <${p.email}>` : p.email;
  const headLabel = { fontSize: 12, color: MUTED, width: 64, flexShrink: 0 };
  const headRow   = { display: 'flex', gap: 10, alignItems: 'baseline', padding: '3px 0', fontSize: 13, color: TEXT, minWidth: 0 };

  const whenLine =
    status === 'approved' && slot.date
      ? `Goes out ${fmtDate(slot.date)} · ${slot.projectedCount} ${slot.projectedCount === 1 ? 'person' : 'people'}`
    : status === 'approved' ? 'Approved'
    : status === 'draft'    ? `Waiting for you to review${copy ? ` · ${copy.listSize} on its list today` : ''}`
    : status === 'rejected' ? 'In the bin. It will never send.'
    : status === 'sent'     ? 'Already sent'
    : '';

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,29,63,0.45)', zIndex: 50,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px',
        overflowY: 'auto',
      }}
    >
      <div style={{
        background: BG, borderRadius: 12, width: '100%', maxWidth: 860,
        border: `1px solid ${BORDER}`, overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
          background: CARD, borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap',
        }}>
          <Pill status={status} />
          <div style={{ flex: 1, fontSize: 13, color: MUTED, minWidth: 200 }}>{whenLine}</div>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div style={{ padding: 18 }}>
          {loading && <div style={{ fontSize: 14, color: MUTED }}>Loading the email…</div>}
          {error && <Banner tone="bad">{error}</Banner>}

          {copy && (<>
            {/* Inbox-style header — what sits above the email in Outlook. */}
            <div style={{
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8,
              padding: '10px 14px', marginBottom: 10,
            }}>
              <div style={headRow}>
                <span style={headLabel}>From</span>
                <span style={{ overflowWrap: 'anywhere' }}>
                  {copy.from ? who(copy.from) : <span style={{ color: DANGER }}>No from-address set on Render</span>}
                </span>
              </div>
              <div style={headRow}>
                <span style={headLabel}>To</span>
                <span style={{ overflowWrap: 'anywhere' }}>
                  {copy.to
                    ? <>{who(copy.to)}{copy.to.company && <span style={{ color: MUTED }}> · {copy.to.company}</span>}</>
                    : <span style={{ color: MUTED }}>Nobody on this email's list right now</span>}
                </span>
              </div>
              <div style={{ ...headRow, borderTop: `1px solid ${BORDER}`, marginTop: 6, paddingTop: 8 }}>
                <span style={headLabel}>Subject</span>
                <span style={{ fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>{copy.subject}</span>
              </div>
            </div>

            <WhoGetsIt
              key={copy.draftId}
              people={copy.people || []}
              selected={copy.to ? copy.to.email : null}
              switching={switching}
              onPick={onPick}
            />

            <div style={{ fontSize: 12, color: TERTIARY, marginBottom: 10, lineHeight: 1.5 }}>
              {copy.to
                ? <>This is {copy.to.name || copy.to.email}'s copy. Everyone else's is the same apart from the name after “Hi”.</>
                : <>Nobody is on this email's list at the moment, so it is shown with “Hi there”.</>}
              {' '}The unsubscribe link is switched off here so it cannot be clicked by mistake.
            </div>

            {/* The email itself, full length — no inner scroll box. */}
            <div
              style={{
                background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 8,
                padding: '22px 24px', marginBottom: 16, overflowX: 'auto',
              }}
              dangerouslySetInnerHTML={{ __html: copy.html }}
            />

            {/* What you can do with it depends on where it is. */}
            {status === 'draft' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button tone="primary" disabled={busy} onClick={() => onApprove(copy.draftId)}>Approve</Button>
                <Button disabled={busy} onClick={() => onEdit(copy.draftId)}>Edit</Button>
                <Button tone="ghost" disabled={busy} onClick={() => onBin(copy.draftId)}>Bin</Button>
              </div>
            )}

            {status === 'approved' && (<>
              {testError && <Banner tone="bad">{testError}</Banner>}
              {testNote && <Banner tone="good">{testNote}</Banner>}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={testTo}
                  onChange={(e) => onTestTo(e.target.value)}
                  placeholder="you@sweetbyte.co.uk"
                  aria-label="Address for a test copy"
                  style={{
                    minWidth: 230, padding: '7px 11px', fontSize: 13,
                    border: `1px solid ${BORDER}`, borderRadius: 7, fontFamily: 'inherit', background: CARD,
                  }}
                />
                <Button disabled={testBusy || !testTo.trim()} onClick={() => onTest(copy.draftId)}>
                  {testBusy ? 'Sending…' : 'Send me a test'}
                </Button>
                <Button tone="ghost" onClick={() => onEdit(copy.draftId)}>Change it</Button>
              </div>
              <div style={{ fontSize: 12, color: TERTIARY, marginTop: 8, lineHeight: 1.5 }}>
                A test arrives with [TEST] in front of the subject and doesn't use the email up.
                Changing the wording un-approves it until you approve it again.
              </div>
            </>)}

            {status === 'rejected' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button disabled={busy} onClick={() => onRestore(copy.draftId)}>Restore</Button>
                <span style={{ fontSize: 12, color: TERTIARY }}>Puts it back in step 2 to review again.</span>
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}

// The send route refuses in six named ways. Each one is a decision for the
// operator rather than a fault to retry, so each gets a sentence saying what to
// do about it — a bare "not_configured" on screen is a support call.
function sendReason(d) {
  const n = d && d.count;
  const cap = d && d.cap;
  switch (d && d.error) {
    case 'not_configured':
      return 'No from-address is set, so nothing was sent. SERVICE_EMAIL_FROM and SERVICE_EMAIL_FROM_NAME need filling in on Render.';
    case 'not_approved':
      return 'That draft has not been approved yet. Approve it in step 2 first.';
    case 'already_sent':
      return 'That draft has already gone out once.';
    case 'run_in_progress':
      return 'A send is already running. One at a time — wait for it to finish.';
    case 'empty_audience':
      return 'Nobody qualifies under the current stage rule, so there was nothing to send.';
    case 'retired_lane':
      return 'That email is for a service lane Studio no longer has — IT support was merged into the general email, and backups was removed. Nothing was sent, and nothing can be. Bin it and write it on the General IT support card instead.';
    case 'unknown_lane':
      return 'That email is tagged to a service Studio does not recognise, so nothing was sent. Bin it and write a new one from a card.';
    case 'all_had_one':
      return 'Everybody in that lane has already had a keep-warm email this fortnight, so there was nobody left to send it to. Nobody gets two in a fortnight — this one can go out next time.';
    case 'empty_lane':
      return 'Nobody is in that service lane any more, so there was nothing to send. Interests come from WorkTrackr and may have changed since the email was written.';
    case 'over_cap':
      return `The audience is ${n} people, above the safety limit of ${cap}. That usually means stages have come across wrong from WorkTrackr. Nothing was sent — check the Audience tab.`;
    case 'no_draft':
      return 'That draft no longer exists.';
    default:
      return (d && d.error) || 'Could not send.';
  }
}

function testReason(d) {
  switch (d && d.error) {
    case 'bad_email':      return 'That does not look like an email address.';
    case 'not_configured': return 'No from-address is set on Render, so nothing could be sent.';
    case 'no_draft':       return 'That draft no longer exists.';
    case 'suppressed':     return 'That address has unsubscribed, so Studio will not email it — not even a test.';
    case 'send_failed':    return 'SES refused it: ' + (d.detail || 'no reason given');
    default:               return (d && d.error) || 'Could not send the test.';
  }
}

// What the email will open with, shown beside every recipient so a wrong
// greeting is caught on screen rather than in somebody's inbox.
function GreetingPill({ greeting }) {
  const known = Boolean(greeting);
  return (
    <span style={{
      fontSize: 12, whiteSpace: 'nowrap', padding: '2px 9px', borderRadius: 999,
      background: known ? GOOD_BG : '#eeeeec',
      color: known ? GOOD : MUTED,
    }}>
      Hi {greeting || 'there'},
    </span>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
//
// Module level, like everything else here — see the SUB-COMPONENT RULE at the
// top of the file.

const TABS = [
  { key: 'audience', label: 'Audience' },
  { key: 'emails',   label: 'Emails' },
  { key: 'sent',     label: 'Sent' },
];

// `badges` is { tabKey: number } — the Emails tab shows how many need you.
function TabBar({ tab, onPick, badges = {} }) {
  return (
    <div style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${BORDER}`, marginBottom: 22 }}>
      {TABS.map(t => (
        <button
          key={t.key}
          onClick={() => onPick(t.key)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 14, padding: '0 0 9px', color: tab === t.key ? TEXT : MUTED,
            fontWeight: tab === t.key ? 700 : 500,
            borderBottom: `2px solid ${tab === t.key ? SB.primary : 'transparent'}`,
          }}
        >
          {t.label}
          {badges[t.key] > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, background: SB.primary, color: SB.onPrimary,
              borderRadius: 8, padding: '1px 6px', marginLeft: 6, verticalAlign: 1,
            }}>{badges[t.key]}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Undo bar ─────────────────────────────────────────────────────────────────
//
// Shown while a run is queued but not yet started. The countdown is honest: at
// zero the worker picks the run up, and the button genuinely stops working,
// because from that point the first messages are with SES. Better to watch a
// number run out than to press Undo and be told afterwards it was too late.

function UndoBar({ secondsLeft, count, onUndo, undoing }) {
  return (
    <div style={{
      background: AMBER_BG, border: `1px solid ${AMBER}`, borderRadius: 10,
      padding: '13px 16px', marginBottom: 16,
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <div style={{ fontSize: 14, color: AMBER, flex: 1, minWidth: 200 }}>
        <strong>Sending to {count} {count === 1 ? 'person' : 'people'} in {secondsLeft}s.</strong>
        {' '}Nothing has left yet.
      </div>
      <Button tone="danger" disabled={undoing} onClick={onUndo}>
        {undoing ? 'Stopping…' : 'Undo'}
      </Button>
    </div>
  );
}

// ── Emails tab: Write → Review → Send ────────────────────────────────────────
//
// Drafts and Schedule used to be two tabs. They are one now, laid out in the
// order the work actually happens: step 1 writes, step 2 is a column of emails
// waiting to be read and approved, step 3 is a column of approved emails
// grouped by the Tuesday they go out, and a short Sent column shows the last
// few that went. Whichever column needs you is drawn in blue.
//
// Nothing about sending changed. The Send button, the confirm, the ten-second
// undo, the one-run-at-a-time rule and the lane narrowing are exactly what the
// Schedule tab did — this is the same buttons in a different arrangement.
//
// Every piece is module level, per the SUB-COMPONENT RULE at the top.

const SMALL = { padding: '4px 9px', fontSize: 12 };

function StepNum({ n, tone = 'idle' }) {
  const map = {
    need: [SB.primary, SB.onPrimary],
    done: [GOOD_BG, GOOD],
    idle: ['#e6e6e2', MUTED],
  };
  const [bg, fg] = map[tone] || map.idle;
  return (
    <span style={{
      width: 24, height: 24, borderRadius: '50%', display: 'inline-grid', placeItems: 'center',
      fontSize: 12, fontWeight: 700, background: bg, color: fg, flexShrink: 0,
    }}>{n}</span>
  );
}

function LaneTag({ interest }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
      color: interest ? SB.dark : MUTED, background: interest ? SB.tint : '#f2f2ee',
      borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
    }}>
      {interest ? laneLabel(interest) : 'General'}
    </span>
  );
}

function Column({ n, tone, title, note, need, children }) {
  return (
    <div style={{
      background: need ? SB.tint : '#efefec',
      border: `2px solid ${need ? SB.primary : 'transparent'}`,
      borderRadius: 10, padding: 10, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '2px 2px 4px' }}>
        <StepNum n={n} tone={need ? 'need' : tone} />
        <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{title}</span>
      </div>
      <div style={{
        fontSize: 12, margin: '0 2px 10px', lineHeight: 1.4,
        color: need ? SB.dark : MUTED, fontWeight: need ? 600 : 400,
      }}>{note}</div>
      {children}
    </div>
  );
}

function Tile({ children, faded = false }) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8,
      padding: 10, marginBottom: 8, opacity: faded ? 0.75 : 1,
    }}>{children}</div>
  );
}

function TileSubject({ children, struck = false }) {
  return (
    <div style={{
      fontSize: 13, fontWeight: 600, lineHeight: 1.35, margin: '6px 0 4px',
      color: struck ? MUTED : TEXT, textDecoration: struck ? 'line-through' : 'none',
      overflowWrap: 'anywhere',
    }}>{children}</div>
  );
}

function TileActions({ children }) {
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, position: 'relative' }}>
      {children}
    </div>
  );
}

function EmptyNote({ children }) {
  return (
    <div style={{
      fontSize: 12.5, color: MUTED, textAlign: 'center', padding: '16px 8px',
      border: '1px dashed #d6d6d0', borderRadius: 8, lineHeight: 1.5,
    }}>{children}</div>
  );
}

// Step 1. One line, with your own subject lines folded away underneath until
// you want them.
//
// The lines are sorted into sections by the kind of email they are for:
// General (everyone in the loop) and one section per service. Ticking a
// Website line writes a Website email that only reaches the Website people —
// the server does that; this screen only shows which section a line is in.
//
// Lines that have already gone out are hidden — they are kept on the server so
// the same subject can never be sent twice, but there is no reason to look at
// them. Lines sitting in a draft stay, greyed.
function SubjectLineRow({ idea, types, checked, onToggle, onDelete, onSetLane, onEditText, busy }) {
  const usable = idea.usable;
  const current = idea.lane || 'general';
  const known = types.some(t => t.key === current);

  // Editing the wording. Local to the row, so typing in one line never
  // disturbs another. Only unused lines can be edited — see editIdea().
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(idea.text);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  const startEdit = () => { setDraftText(idea.text); setEditError(null); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setEditError(null); };
  const saveEdit = async () => {
    const text = draftText.replace(/\s+/g, ' ').trim();
    if (!text) { setEditError('The line cannot be empty.'); return; }
    if (text === idea.text) { setEditing(false); return; }
    setSaving(true);
    setEditError(null);
    const result = await onEditText(idea.id, text);
    setSaving(false);
    if (result && result.error) setEditError(result.error);
    else setEditing(false);
  };

  if (editing) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '7px 12px', borderTop: `1px solid ${BORDER}`, background: '#fcfcfb',
      }}>
        <input
          autoFocus
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          }}
          aria-label="Subject line wording"
          maxLength={200}
          style={{
            flex: 1, minWidth: 200, fontSize: 13, padding: '6px 9px', fontFamily: 'inherit',
            border: `1px solid ${SB.primary}`, borderRadius: 6, color: TEXT,
          }}
        />
        <Button tone="primary" disabled={saving} onClick={saveEdit} style={{ padding: '4px 10px', fontSize: 12 }}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button tone="ghost" disabled={saving} onClick={cancelEdit} style={{ padding: '4px 10px', fontSize: 12 }}>
          Cancel
        </Button>
        {editError && (
          <div style={{ flexBasis: '100%', fontSize: 12, color: DANGER }}>{editError}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '7px 12px', borderTop: `1px solid ${BORDER}`,
    }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!usable || busy}
        onChange={() => onToggle(idea.id)}
        aria-label={`Use “${idea.text}”`}
        style={{ width: 15, height: 15, cursor: usable ? 'pointer' : 'default', flexShrink: 0, accentColor: SB.primary }}
      />
      <span style={{
        flex: 1, minWidth: 160, fontSize: 13,
        color: usable ? TEXT : TERTIARY,
        textDecoration: usable ? 'none' : 'line-through',
        overflowWrap: 'anywhere',
      }}>
        {idea.text}
      </span>
      {!usable && <span style={{ fontSize: 12, color: TERTIARY, flexShrink: 0 }}>{idea.state}</span>}
      {idea.suggested && (
        <span style={{
          fontSize: 10.5, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap',
          background: AMBER_BG, color: AMBER, flexShrink: 0,
        }}>suggested</span>
      )}
      <select
        value={current}
        disabled={busy}
        onChange={(e) => onSetLane(idea.id, e.target.value)}
        aria-label="What kind of email this line is for"
        style={{
          fontSize: 12, padding: '3px 6px', border: `1px solid ${BORDER}`, borderRadius: 6,
          fontFamily: 'inherit', background: CARD, color: TEXT, flexShrink: 0, maxWidth: 190,
        }}
      >
        {!known && <option value={current}>{laneLabel(current)} (no longer used)</option>}
        {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <Button
        tone="ghost"
        disabled={busy || !usable}
        onClick={startEdit}
        style={{ flexShrink: 0, padding: '3px 9px', fontSize: 12 }}
      >
        <span title={usable ? 'Change the wording' : 'In a draft — bin or approve that draft first'}>Edit</span>
      </Button>
      <Button tone="ghost" disabled={busy} onClick={() => onDelete(idea.id)} style={{ flexShrink: 0, padding: '3px 9px', fontSize: 12 }}>
        Bin
      </Button>
    </div>
  );
}

// ── Suggest lines ───────────────────────────────────────────────────────────
//
// Sits inside "Use my own subject lines". Studio offers a handful of new lines
// in the operator's voice for one type; nothing is saved until Keep is pressed,
// and a kept line goes onto the list exactly as if it had been typed in the
// Add box, under the type picked here. Leaving the page clears the box.
//
// `shown` remembers every line offered this sitting, including the ones turned
// down, and is sent with the next request so pressing Suggest again brings new
// lines rather than the same ones.
function SuggestLines({ types, disabled, onSuggest, onKeep, onKept }) {
  const [lane, setLane]       = useState('general');
  const [howMany, setHowMany] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [items, setItems]     = useState([]);   // { text, state: 'new' | 'kept' | 'already' }
  const [forLane, setForLane] = useState('general');
  const [note, setNote]       = useState(null);
  const [shown, setShown]     = useState([]);
  const [keeping, setKeeping] = useState(false);

  const labelOf = (key) => (types.find(t => t.key === key) || {}).label || laneLabel(key);
  const waiting = items.filter(i => i.state === 'new');

  const suggest = async () => {
    setLoading(true);
    setError(null);
    setNote(null);
    const result = await onSuggest(lane, howMany, shown);
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    const lines = result.suggestions || [];
    setItems(lines.map(text => ({ text, state: 'new' })));
    setForLane(lane);
    setNote(result.note || null);
    setShown(prev => [...prev, ...lines]);
  };

  const keep = async (texts) => {
    if (!texts.length) return;
    setKeeping(true);
    setError(null);
    const result = await onKeep(texts, forLane);
    setKeeping(false);
    if (result.error) { setError(result.error); return; }
    // The add path skips a line that is already on the list. With one line
    // that can only mean it is a duplicate; with several the server does not
    // say which, so all are shown as kept — they are on the list either way.
    const dup = texts.length === 1 && result.added === 0;
    setItems(prev => prev.map(i => (texts.includes(i.text) ? { ...i, state: dup ? 'already' : 'kept' } : i)));
    onKept(forLane);
  };

  const noThanks = (text) => setItems(prev => prev.filter(i => i.text !== text));
  const close = () => { setItems([]); setNote(null); setError(null); };

  const selectStyle = {
    fontSize: 13, padding: '5px 8px', border: `1px solid ${BORDER}`, borderRadius: 7,
    fontFamily: 'inherit', background: CARD,
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: '#fafaf8', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '9px 12px',
      }}>
        <span style={{ fontSize: 13, color: TEXT }}><b>Need ideas?</b> Suggest</span>
        <select value={howMany} onChange={(e) => setHowMany(Number(e.target.value))}
          aria-label="How many lines to suggest" style={selectStyle} disabled={loading}>
          <option value={5}>5</option>
          <option value={10}>10</option>
        </select>
        <span style={{ fontSize: 13, color: TEXT }}>lines for</span>
        <select value={lane} onChange={(e) => setLane(e.target.value)}
          aria-label="Which type of email to suggest lines for" style={{ ...selectStyle, maxWidth: 220 }} disabled={loading}>
          {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <Button tone="primary" disabled={disabled || loading || keeping} onClick={suggest}
          style={{ padding: '5px 11px', fontSize: 12.5 }}>
          {loading ? 'Thinking…' : 'Suggest lines'}
        </Button>
        <span style={{ flexBasis: '100%', fontSize: 11.5, color: TERTIARY }}>
          Written in the style of your own lines, within the house rules. Takes about 15 seconds.
        </span>
      </div>

      {error && <div style={{ fontSize: 12, color: DANGER, marginTop: 6 }}>{error}</div>}

      {items.length > 0 && (
        <div style={{ border: `1px solid ${SB.primary}`, borderRadius: 8, marginTop: 8, overflow: 'hidden' }}>
          <div style={{ background: SB.tint, color: SB.dark, padding: '9px 12px', fontSize: 12.5, lineHeight: 1.45 }}>
            <b>{items.length} {items.length === 1 ? 'suggestion' : 'suggestions'} for {labelOf(forLane)}.</b>{' '}
            Nothing is saved until you press Keep. Leaving the page clears them.
            {note && <div style={{ marginTop: 3, color: MUTED }}>{note}</div>}
          </div>
          {items.map(i => (
            <div key={i.text} style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '7px 12px', borderTop: `1px solid ${BORDER}`, fontSize: 13,
              opacity: i.state === 'new' ? 1 : 0.6,
            }}>
              <span style={{ flex: 1, minWidth: 200, color: TEXT, overflowWrap: 'anywhere' }}>{i.text}</span>
              {i.state === 'new' && (
                <>
                  <Button tone="primary" disabled={keeping} onClick={() => keep([i.text])}
                    style={{ padding: '3px 10px', fontSize: 12 }}>Keep</Button>
                  <Button tone="ghost" disabled={keeping} onClick={() => noThanks(i.text)}
                    style={{ padding: '3px 9px', fontSize: 12 }}>No thanks</Button>
                </>
              )}
              {i.state === 'kept' && (
                <span style={{ fontSize: 12, color: GOOD }}>✓ Kept — now in {labelOf(forLane)}</span>
              )}
              {i.state === 'already' && (
                <span style={{ fontSize: 12, color: MUTED }}>Already on your list</span>
              )}
            </div>
          ))}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '8px 12px', borderTop: `1px solid ${BORDER}`,
          }}>
            <Button disabled={keeping || waiting.length === 0} onClick={() => keep(waiting.map(i => i.text))}
              style={{ padding: '4px 10px', fontSize: 12 }}>
              {keeping ? 'Saving…' : 'Keep all'}
            </Button>
            <span style={{ marginRight: 'auto' }} />
            <Button tone="ghost" disabled={keeping} onClick={close} style={{ padding: '3px 9px', fontSize: 12 }}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function WriteStep({
  count, counts, onCount, onGenerate, generating, canGenerate,
  ideas, picked, onToggleIdea, onBinIdea, ideaBusy, ideaText, onIdeaText, onAddIdeas,
  laneData, onSetLane, onConfirmTypes, newLane, onNewLane, onEditText,
  onSuggest, onKeepSuggested,
}) {
  const [foldOpen, setFoldOpen] = useState(false);
  // Which sections are open. General starts open: it is the one most used.
  const [openSecs, setOpenSecs] = useState(() => new Set(['general']));

  const types = reviewTypes(laneData);
  const live = ideas.filter(i => i.state !== 'sent');
  const sentHidden = ideas.length - live.length;
  const unused = ideas.filter(i => i.usable).length;
  const anySuggested = live.some(i => i.suggested);
  const keyOf = (i) => i.lane || 'general';
  const labelOf = (key) => (types.find(t => t.key === key) || {}).label || laneLabel(key);

  // Sections in the usual order, plus any type a line still carries that
  // Studio no longer has, so nothing is ever hidden by being mis-filed.
  const sectionKeys = [
    ...types.map(t => t.key),
    ...Array.from(new Set(live.map(keyOf))).filter(k => !types.some(t => t.key === k)),
  ].filter(k => live.some(i => keyOf(i) === k));

  // What pressing Write will produce, in words.
  const pickedIdeas = ideas.filter(i => picked.includes(i.id));
  const byType = {};
  for (const i of pickedIdeas) byType[labelOf(keyOf(i))] = (byType[labelOf(keyOf(i))] || 0) + 1;
  const mix = Object.entries(byType).map(([label, n]) => `${n} ${label}`).join(', ');

  const toggleSec = (k) => setOpenSecs(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const ppl = (n) => (n === null || n === undefined ? '' : `${n} ${n === 1 ? 'person' : 'people'}`);

  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10,
      padding: '12px 14px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginRight: 'auto' }}>
          <StepNum n={1} />
          <span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>Write</span>
        </div>
        <select
          value={count}
          onChange={(e) => onCount(Number(e.target.value))}
          aria-label="How many emails to write"
          style={{
            padding: '6px 9px', fontSize: 13, border: `1px solid ${BORDER}`,
            borderRadius: 7, fontFamily: 'inherit', background: CARD,
          }}
        >
          {counts.map(n => <option key={n} value={n}>{n} emails</option>)}
        </select>
        <Button tone="primary" onClick={onGenerate} disabled={generating || !canGenerate}>
          {generating ? 'Writing…' : 'Write new emails'}
        </Button>
      </div>

      {generating && (
        <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
          This takes up to a minute for nine. Leave the page open — they appear in step 2.
        </div>
      )}
      {!generating && picked.length > 0 && (
        <div style={{ fontSize: 12, marginTop: 8, color: picked.length > count ? DANGER : TERTIARY }}>
          {picked.length > count
            ? `${picked.length} lines ticked but only ${count} emails asked for — untick ${picked.length - count}, or ask for more.`
            : `${picked.length} from your lines (${mix})${count - picked.length > 0 ? `, ${count - picked.length} General from Studio's own ideas` : ''}.`}
        </div>
      )}

      <button
        onClick={() => setFoldOpen(v => !v)}
        style={{
          background: 'none', border: 'none', padding: 0, marginTop: 10, cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 13, color: SB.strong,
        }}
      >
        {foldOpen ? '▾' : '▸'} Use my own subject lines{' '}
        <span style={{ color: TERTIARY }}>
          {unused} unused{picked.length ? ` · ${picked.length} ticked` : ''}
        </span>
      </button>

      {/* Always mounted, only hidden when the fold is shut, so closing the fold
          does not throw away suggestions that have not been looked at yet. */}
      <div style={{ marginTop: 8, display: foldOpen ? 'block' : 'none' }}>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
          Tick a line and Studio writes an email around it, word for word. A line in a service
          section becomes an email for that service, and only goes to the people ticked for it.
        </div>

        <SuggestLines
          types={types}
          disabled={!canGenerate || generating}
          onSuggest={onSuggest}
          onKeep={onKeepSuggested}
          onKept={(lane) => setOpenSecs(prev => new Set(prev).add(lane))}
        />
      </div>

      {foldOpen && (
        <div>
          {anySuggested && (
            <div style={{
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
              background: SB.tint, color: SB.dark, borderRadius: 8, padding: '9px 11px',
              marginBottom: 10, fontSize: 12.5, lineHeight: 1.45,
            }}>
              <span style={{ flex: 1, minWidth: 220 }}>
                <b>Studio has sorted your lines by their wording.</b> The ones marked “suggested” are
                its guesses. Change any that are wrong, then press “These look right”.
              </span>
              <Button style={{ padding: '4px 10px', fontSize: 12 }} disabled={ideaBusy} onClick={onConfirmTypes}>
                These look right
              </Button>
            </div>
          )}

          {sectionKeys.map(k => {
            const t = types.find(x => x.key === k);
            const rows = live.filter(i => keyOf(i) === k);
            const free = rows.filter(i => i.usable).length;
            const ticked = rows.filter(i => picked.includes(i.id)).length;
            const isOpen = openSecs.has(k);
            return (
              <div key={k} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
                <button
                  onClick={() => toggleSec(k)}
                  aria-expanded={isOpen}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%',
                    background: '#fafaf8', border: 'none', padding: '9px 12px', cursor: 'pointer',
                    textAlign: 'left', fontFamily: 'inherit', fontSize: 13, color: TEXT,
                  }}
                >
                  <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  <b style={{ flex: 1, minWidth: 120 }}>{t ? t.label : `${laneLabel(k)} (no longer used)`}</b>
                  {t && (
                    <span style={{ fontSize: 11.5, color: TERTIARY }}>
                      {k === 'general' ? 'Everyone in the loop' : k === '__none' ? 'No service ticked' : 'Only those ticked'}
                      {t.people !== null ? ` · ${ppl(t.people)}` : ''}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: MUTED }}>
                    {free} unused{ticked ? ` · ${ticked} ticked` : ''}
                  </span>
                </button>
                {isOpen && rows.map(i => (
                  <SubjectLineRow
                    key={i.id}
                    idea={i}
                    types={types}
                    checked={picked.includes(i.id)}
                    onToggle={onToggleIdea}
                    onDelete={onBinIdea}
                    onSetLane={(id, lane) => {
                      // Open the section it moved to, so it does not vanish from view.
                      setOpenSecs(prev => new Set(prev).add(lane));
                      onSetLane(id, lane);
                    }}
                    onEditText={onEditText}
                    busy={ideaBusy || generating}
                  />
                ))}
              </div>
            );
          })}

          {sentHidden > 0 && (
            <div style={{ fontSize: 12, color: TERTIARY, marginBottom: 8 }}>
              {sentHidden} already sent, hidden. {sentHidden === 1 ? 'It' : 'They'} can't be used again.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <textarea
              value={ideaText}
              onChange={(e) => onIdeaText(e.target.value)}
              placeholder="Add a subject line — or paste several, one per line"
              rows={ideaText.includes('\n') ? 4 : 1}
              style={{
                flex: 1, minWidth: 220, boxSizing: 'border-box', padding: '7px 10px', fontSize: 13,
                border: `1px solid ${BORDER}`, borderRadius: 7, fontFamily: 'inherit', resize: 'vertical',
              }}
            />
            <select
              value={newLane}
              onChange={(e) => onNewLane(e.target.value)}
              aria-label="What kind of email the new lines are for"
              style={{
                fontSize: 13, padding: '6px 8px', border: `1px solid ${BORDER}`, borderRadius: 7,
                fontFamily: 'inherit', background: CARD, maxWidth: 200,
              }}
            >
              <option value="auto">Let Studio suggest</option>
              {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <Button onClick={onAddIdeas} disabled={ideaBusy || !ideaText.trim()}>
              {ideaBusy ? 'Saving…' : 'Add'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// The "Showing" picker at the top of the Review column.
//
// Every email type is listed, including ones with no drafts — those say
// "needs writing", so a gap is visible rather than silently absent. Each type
// also shows how many people it would go to right now, the same numbers the
// service cards at the top of the page show.
//
// The types are WHO an email goes to, not what it is about: "General" is the
// everyone-in-the-loop email from step 1, the rest are the service lanes. A
// general email that happens to be about cyber security is still General.
// The service lanes in their usual order, for when the people counts have not
// loaded yet — so a Website line still has a Website section to sit in.
const FALLBACK_LANES = Object.keys(LANE_LABELS)
  .filter(k => k !== 'it_support' && k !== '__none')
  .map(k => ({ key: k, label: LANE_LABELS[k] }));

function reviewTypes(laneData) {
  const keys = (laneData && laneData.keys) || FALLBACK_LANES;
  const counts = (laneData && laneData.counts) || {};
  return [
    {
      key: 'general', label: 'General', group: 'everyone',
      people: laneData ? laneData.audienceTotal : null,
      match: (d) => !d.interest,
      note: 'Goes to everyone in the loop',
    },
    {
      key: '__none', label: 'General IT support', group: 'service',
      people: laneData ? laneData.none : null,
      match: (d) => d.interest === '__none',
      note: 'Goes to people with no service ticked',
    },
    ...keys.map(k => ({
      key: k.key, label: k.label, group: 'service',
      people: laneData ? (counts[k.key] || 0) : null,
      match: (d) => d.interest === k.key,
      note: null,
    })),
  ];
}

// `approved` is the email-type keys that already have an approved email lined
// up in step 3, so an empty type there reads "approved", not "needs writing".
function TypePicker({ types, selected, onSelect, drafts, approved }) {
  const [openList, setOpenList] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!openList) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpenList(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpenList(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [openList]);

  const people = (n) => n === null || n === undefined ? '' : `${n} ${n === 1 ? 'person' : 'people'}`;
  const draftWord = (n) => `${n} ${n === 1 ? 'draft' : 'drafts'}`;
  const countFor = (t) => (t ? drafts.filter(t.match).length : drafts.length);
  const current = types.find(t => t.key === selected) || null;

  const option = (t, label, ppl) => {
    const n = countFor(t);
    const isOn = (t ? t.key : 'all') === selected;
    const lined = !n && t && approved.has(t.key);
    return (
      <button
        key={t ? t.key : 'all'}
        role="option"
        aria-selected={isOn}
        onClick={() => { onSelect(t ? t.key : 'all'); setOpenList(false); }}
        style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 10, alignItems: 'center',
          width: '100%', background: isOn ? BG : 'none', border: 'none', borderRadius: 6,
          padding: '8px 10px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
          fontSize: 13, color: TEXT, fontWeight: isOn ? 600 : 400,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>{ppl}</span>
        <span style={{
          fontSize: 11.5, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
          background: n ? SB.tint : lined ? GOOD_BG : AMBER_BG,
          color: n ? SB.dark : lined ? GOOD : AMBER,
        }}>{n ? draftWord(n) : lined ? 'approved' : 'needs writing'}</span>
      </button>
    );
  };

  const heading = (text) => (
    <div style={{
      fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: TERTIARY,
      fontWeight: 700, padding: '8px 10px 3px',
    }}>{text}</div>
  );

  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: 10 }}>
      <button
        onClick={() => setOpenList(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={openList}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: CARD,
          border: '1px solid #c6e6f2', borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit', fontSize: 13, color: TEXT,
        }}
      >
        <span style={{ fontSize: 12, color: MUTED }}>Showing</span>
        <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current ? current.label : 'All types'}
        </b>
        <span style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
          {current
            ? [people(current.people), draftWord(countFor(current))].filter(Boolean).join(' · ')
            : draftWord(drafts.length)}
        </span>
        <span aria-hidden="true">▾</span>
      </button>

      {openList && (
        <div role="listbox" style={{
          position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 6,
          background: CARD, border: `1px solid ${BORDER}`, borderRadius: 9, padding: 4,
          boxShadow: '0 10px 28px rgba(15,29,63,0.16)', maxHeight: 420, overflowY: 'auto',
        }}>
          {option(null, 'All types', '')}
          <div style={{ height: 1, background: BORDER, margin: '4px 6px' }} />
          {heading('Goes to everyone')}
          {types.filter(t => t.group === 'everyone').map(t => option(t, t.label, people(t.people)))}
          {heading('By service')}
          {types.filter(t => t.group === 'service').map(t => option(t, t.label, people(t.people)))}
        </div>
      )}
    </div>
  );
}

// Step 2. Every draft not yet approved. The bin sits under a small link at the
// bottom so binned emails are out of the way but can still be brought back.
function ReviewColumn({ waiting, binned, need, busyId, onRead, onApprove, onBin, onRestore, onEmptyBin, emptying, laneData, scheduledSlots }) {
  const [showBin, setShowBin] = useState(false);
  const [type, setType] = useState('all');
  const note = waiting.length
    ? `${waiting.length} waiting for you. Read, then approve or bin.`
    : 'All caught up.';

  const types = reviewTypes(laneData);
  const current = types.find(t => t.key === type) || null;
  const shown = current ? waiting.filter(current.match) : waiting;
  const ppl = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
  // Which types already have an approved email waiting in step 3.
  const approved = new Set((scheduledSlots || []).map(sl => sl.interest || 'general'));

  return (
    <Column n={2} title="Review" note={note} need={need}>
      <TypePicker types={types} selected={type} onSelect={setType} drafts={waiting} approved={approved} />

      {/* What the picked type means, or what to do when it has nothing. */}
      {current && shown.length > 0 && (
        <div style={{ fontSize: 12, color: MUTED, margin: '-2px 2px 10px', lineHeight: 1.45 }}>
          {current.note || (current.people !== null ? `Only the ${ppl(current.people)} whose turn it is for ${current.label}` : current.label)}.
          {' '}{shown.length} {shown.length === 1 ? 'draft' : 'drafts'} waiting.
        </div>
      )}
      {current && shown.length === 0 && approved.has(current.key) && (
        <div style={{
          fontSize: 12.5, color: GOOD, background: GOOD_BG, borderRadius: 7,
          padding: '9px 11px', marginBottom: 10, lineHeight: 1.5,
        }}>
          <b>Nothing to review for {current.label}.</b> One is already approved and lined up in step 3.
        </div>
      )}
      {current && shown.length === 0 && !approved.has(current.key) && (
        <div style={{
          fontSize: 12.5, color: AMBER, background: AMBER_BG, borderRadius: 7,
          padding: '9px 11px', marginBottom: 10, lineHeight: 1.5,
        }}>
          <b>No {current.label} drafts.</b>{' '}
          {current.people === null ? ''
            : current.people > 0 ? `It would go to ${ppl(current.people)}. `
            : 'Nobody is due this one right now, so it would go to no one. '}
          {current.key === 'general'
            ? 'Write one in step 1 above.'
            : `Press Write on the ${current.label} card at the top of the page.`}
        </div>
      )}

      {!current && waiting.length === 0 && <EmptyNote>Nothing to review. Write some new emails in step 1.</EmptyNote>}
      {shown.map(d => (
        <Tile key={d.id}>
          <LaneTag interest={d.interest} />
          <TileSubject>{d.subject}</TileSubject>
          {d.edited ? <div style={{ fontSize: 11.5, color: TERTIARY }}>edited</div> : null}
          <TileActions>
            <Button style={SMALL} onClick={() => onRead(d)}>Read</Button>
            <Button style={SMALL} tone="primary" disabled={busyId === d.id} onClick={() => onApprove(d.id)}>Approve</Button>
            <Button style={SMALL} tone="ghost" disabled={busyId === d.id} onClick={() => onBin(d.id)}>Bin</Button>
          </TileActions>
        </Tile>
      ))}

      {binned.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button
            onClick={() => setShowBin(v => !v)}
            style={{
              background: 'none', border: 'none', padding: '4px 2px', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, color: MUTED, textDecoration: 'underline',
            }}
          >
            {showBin ? 'Hide the bin' : `Bin (${binned.length})`}
          </button>
          {showBin && (
            <div style={{ marginTop: 6 }}>
              {binned.map(d => (
                <Tile key={d.id} faded>
                  <TileSubject struck>{d.subject}</TileSubject>
                  <TileActions>
                    <Button style={SMALL} onClick={() => onRead(d)}>Read</Button>
                    <Button style={SMALL} tone="ghost" disabled={busyId === d.id} onClick={() => onRestore(d.id)}>Restore</Button>
                  </TileActions>
                </Tile>
              ))}
              <div style={{ fontSize: 12, color: TERTIARY, margin: '2px 2px 8px', lineHeight: 1.5 }}>
                Binned emails never send. Emptying the bin clears them for good, but Studio still
                remembers the subject lines so it does not write the same ideas again.
              </div>
              <Button style={SMALL} tone="danger" disabled={emptying} onClick={onEmptyBin}>
                {emptying ? 'Emptying…' : 'Empty the bin'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Column>
  );
}

// The ⋯ menu on a Send tile: change the day, move up or down, take it off the
// schedule. Tucked away because they are occasional; Read and Send are the two
// buttons pressed every fortnight.
function SlotMenu({ slot, sendDays, busy, onSetDay, onMove, onRemove }) {
  const [openMenu, setOpenMenu] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpenMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenu]);

  const item = (danger, disabled) => ({
    display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
    padding: '7px 10px', fontSize: 13, borderRadius: 5, fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? TERTIARY : (danger ? DANGER : TEXT),
  });

  const days = (sendDays || []).concat((sendDays || []).includes(slot.date) ? [] : [slot.date]).sort();

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Button style={SMALL} tone="ghost" onClick={() => setOpenMenu(v => !v)} disabled={busy}>⋯</Button>
      {openMenu && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 5, minWidth: 210,
          background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 4,
          boxShadow: '0 8px 24px rgba(15,29,63,0.14)',
        }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 13, color: TEXT }}>
            Send on
            <select
              value={slot.date}
              disabled={busy}
              onChange={(e) => { setOpenMenu(false); onSetDay(slot.draftId, e.target.value); }}
              style={{ fontSize: 13, fontFamily: 'inherit', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 6px', background: CARD }}
            >
              {days.map(d => <option key={d} value={d}>{fmtDate(d)}</option>)}
            </select>
          </label>
          <button style={item(false, busy || !slot.canMoveUp)} disabled={busy || !slot.canMoveUp}
                  onClick={() => { setOpenMenu(false); onMove(slot.draftId, 'up'); }}>Move up</button>
          <button style={item(false, busy || !slot.canMoveDown)} disabled={busy || !slot.canMoveDown}
                  onClick={() => { setOpenMenu(false); onMove(slot.draftId, 'down'); }}>Move down</button>
          <button style={item(true, busy)} disabled={busy}
                  onClick={() => { setOpenMenu(false); onRemove(slot); }}>Take off the schedule</button>
        </div>
      )}
    </div>
  );
}

// Step 3. Approved emails, grouped by the Tuesday they go out. Send lights up
// on the day. The headcount on the general email links to the Audience tab's
// tick list, which is the one list that decides who a general send reaches.
function SendColumn({
  data, need, sending, onRead, onSend, onSetDay, onMove, onRemove, slotBusy,
  handPicked, selectedCount, onHandPick,
}) {
  if (!data) {
    return <Column n={3} title="Send" note="Loading…" need={false}><div /></Column>;
  }
  const active = data.activeRun;
  const slots = data.slots || [];
  const due = slots.filter(s => s.dueNow);
  const note = (need && due.length)
    ? `Send day. ${due.length} to send today — press Send on each.`
    : 'Approved and lined up. Press Send on the day. Nothing goes on its own.';

  return (
    <Column n={3} title="Send" note={note} need={need}>
      {slots.length === 0 && <EmptyNote>Nothing approved yet. Approve an email in step 2 and it lines up here.</EmptyNote>}
      {slots.map((s, i) => {
        const firstOfDay = i === 0 || slots[i - 1].date !== s.date;
        const sameDay = slots.filter(x => x.date === s.date);
        const sendable = s.dueNow && !active;
        const lane = s.interest;
        const reach = (!lane && handPicked && sendable) ? selectedCount : s.projectedCount;
        return (
          <React.Fragment key={s.draftId}>
            {firstOfDay && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap',
                fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                color: s.dueNow ? GOOD : MUTED, margin: i === 0 ? '0 2px 6px' : '12px 2px 6px',
              }}>
                <span>{s.dueNow ? 'Today · ' : ''}{fmtDate(s.date)}</span>
                <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: TERTIARY }}>
                  {sameDay.length} {sameDay.length === 1 ? 'email' : 'emails'}
                  {sameDay.length > 1 ? ' · nobody gets two' : ''}
                </span>
              </div>
            )}
            <Tile>
              <LaneTag interest={lane} />
              <TileSubject>{s.subject}</TileSubject>
              <div style={{ fontSize: 11.5, color: TERTIARY, lineHeight: 1.45 }}>
                {lane
                  ? <>Only the {s.projectedCount} ticked for {laneLabel(lane)}</>
                  : sendable
                    ? (
                      <button
                        onClick={onHandPick}
                        title="Choose exactly who gets it, on the Audience tab"
                        style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          fontFamily: 'inherit', fontSize: 11.5, color: SB.strong, textDecoration: 'underline',
                        }}
                      >
                        {reach} {reach === 1 ? 'person' : 'people'}{handPicked ? ' (hand-picked)' : ''}
                      </button>
                    )
                    : <>{s.projectedCount} {s.projectedCount === 1 ? 'person' : 'people'} · everybody in the loop</>}
                {typeof s.countAlone === 'number' && s.countAlone > s.projectedCount && (
                  <span style={{ color: AMBER }}> · {s.countAlone - s.projectedCount} already get an earlier email that day</span>
                )}
              </div>
              <TileActions>
                <Button style={SMALL} onClick={() => onRead(s)}>Read</Button>
                <Button
                  style={SMALL}
                  tone={sendable ? 'primary' : 'plain'}
                  disabled={!sendable || sending}
                  onClick={() => onSend(s)}
                >
                  {sending && sendable ? 'Queuing…' : 'Send'}
                </Button>
                <SlotMenu
                  slot={s}
                  sendDays={data.sendDays || []}
                  busy={Boolean(active) || slotBusy}
                  onSetDay={onSetDay}
                  onMove={onMove}
                  onRemove={onRemove}
                />
              </TileActions>
            </Tile>
          </React.Fragment>
        );
      })}
    </Column>
  );
}

// The last few that went. The full history, with who each one reached, stays
// on the Sent tab.
function SentColumn({ runs }) {
  const real = (runs || []).filter(r => r.status === 'sent').slice(0, 3);
  return (
    <Column n="✓" tone="done" title="Sent" note="The last 3. The full history is on the Sent tab." need={false}>
      {runs === null && <EmptyNote>Loading…</EmptyNote>}
      {runs !== null && real.length === 0 && <EmptyNote>Nothing sent yet.</EmptyNote>}
      {real.map(r => (
        <Tile key={r.id}>
          <TileSubject>{r.subject}</TileSubject>
          <div style={{ fontSize: 11.5, color: TERTIARY }}>
            Sent {fmt(r.sentAt)} · {r.sent} {r.sent === 1 ? 'person' : 'people'}
          </div>
        </Tile>
      ))}
    </Column>
  );
}

// ── Sent ─────────────────────────────────────────────────────────────────────

function SentRow({ run, onOpen, open, recipients }) {
  return (
    <div style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div
        onClick={() => onOpen(run.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer' }}
      >
        <div style={{ width: 92, fontSize: 13, color: MUTED, whiteSpace: 'nowrap' }}>{fmt(run.sentAt)}</div>
        <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.subject}
        </div>
        {run.status === 'cancelled'
          ? <span style={{ fontSize: 12, background: '#eeeeec', color: MUTED, padding: '3px 10px', borderRadius: 999 }}>Undone</span>
          : <div style={{ width: 76, textAlign: 'right', fontSize: 13, color: MUTED }}>{run.sent} sent</div>}
        <div style={{ width: 92, textAlign: 'right', fontSize: 13, color: run.optOuts > 0 ? AMBER : MUTED, whiteSpace: 'nowrap' }}>
          {run.optOuts} opt-{run.optOuts === 1 ? 'out' : 'outs'}
        </div>
        <i style={{ fontSize: 12, color: TERTIARY, fontStyle: 'normal', width: 14, textAlign: 'right' }}>{open ? '▴' : '▾'}</i>
      </div>

      {open && (
        <div style={{ background: BG, borderTop: `1px solid ${BORDER}`, maxHeight: 320, overflowY: 'auto' }}>
          {run.failed > 0 && (
            <div style={{ padding: '9px 14px', fontSize: 13, color: DANGER }}>
              {run.failed} did not send. They are marked below with the reason.
            </div>
          )}
          {!recipients && <div style={{ padding: '12px 14px', fontSize: 13, color: MUTED }}>Loading…</div>}
          {recipients && recipients.length === 0 && (
            <div style={{ padding: '12px 14px', fontSize: 13, color: MUTED }}>No recipients recorded.</div>
          )}
          {recipients && recipients.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.contact_name ? `${r.contact_name} — ` : ''}{r.company_name || 'Unknown company'}
                </div>
                <div style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</div>
              </div>
              <GreetingPill greeting={r.greeting} />
              <span style={{
                fontSize: 12, whiteSpace: 'nowrap', padding: '2px 9px', borderRadius: 999,
                background: r.status === 'sent' ? GOOD_BG : r.status === 'failed' ? DANGER_BG : '#eeeeec',
                color:      r.status === 'sent' ? GOOD    : r.status === 'failed' ? DANGER    : MUTED,
              }}>
                {r.status === 'sent' ? 'Sent'
                  : r.status === 'failed' ? 'Failed'
                    : r.status === 'suppressed' ? 'Unsubscribed'
                      : r.status === 'cancelled' ? 'Undone' : r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SentView({ runs, openId, onOpen, recipients }) {
  if (!runs) return <div style={{ color: MUTED, fontSize: 14 }}>Loading…</div>;

  const real = runs.filter(r => r.status === 'sent');
  const totalSent = real.reduce((n, r) => n + r.sent, 0);
  const totalOut  = real.reduce((n, r) => n + r.optOuts, 0);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Card style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}>Emails sent</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: SB.strong }}>{totalSent}</div>
        </Card>
        <Card style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}>Sends so far</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: SB.strong }}>{real.length}</div>
        </Card>
        <Card style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}>Opted out since</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: totalOut > 0 ? AMBER : SB.strong }}>{totalOut}</div>
        </Card>
      </div>

      {runs.length === 0 ? (
        <Card><div style={{ fontSize: 14, color: MUTED }}>Nothing has been sent yet.</div></Card>
      ) : (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
          {runs.map(r => (
            <SentRow
              key={r.id}
              run={r}
              open={openId === r.id}
              recipients={openId === r.id ? recipients : null}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: TERTIARY, lineHeight: 1.6, padding: '12px 0 40px' }}>
        There is no open tracking on these emails, by choice — Apple Mail and Gmail load images by
        themselves, so an open rate mostly counts software, not readers. Opt-outs are exact, and they
        are the number that tells you a piece of copy misfired. Replies land in the normal inbox.
      </div>
    </>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function KeepWarm() {
  // Opens on Emails: it is where the fortnightly work happens.
  const [tab, setTab]             = useState('emails');
  const [readCopy, setReadCopy]   = useState(null);
  // Which service-interest lane is selected, or null for all of them. Held
  // here rather than inside the cards because the audience list below has to
  // narrow to match, and two pieces of the screen reading one value is the
  // only way they cannot disagree about which lane is showing.
  const [lane, setLane]           = useState(null);
  const [overview, setOverview]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const [audience, setAudience]   = useState(null);
  const [showList, setShowList]   = useState(false);
  const [listMode, setListMode]   = useState('included');
  const [ideas, setIdeas]         = useState([]);
  const [pickedIdeas, setPicked]  = useState([]);
  const [ideaText, setIdeaText]   = useState('');
  const [ideaBusy, setIdeaBusy]   = useState(false);
  // The type picked beside the Add box for new subject lines.
  const [ideaLane, setIdeaLane]   = useState('auto');
  const [dead, setDead]           = useState(null);
  const [deadBusy, setDeadBusy]   = useState(false);
  const [search, setSearch]       = useState('');

  const [count, setCount]         = useState(3);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError]   = useState(null);
  const [genNote, setGenNote]     = useState(null);

  const [drafts, setDrafts]       = useState([]);
  const [busyId, setBusyId]       = useState(null);

  const [open, setOpen]           = useState(null);
  const [saving, setSaving]       = useState(false);

  // Regeneration is per-half, so this holds which half is running rather than
  // a plain boolean — otherwise both buttons grey out and neither says why.
  const [regenerating, setRegenerating] = useState(null);
  const [regenError, setRegenError]     = useState(null);

  // Nothing a regenerate replaces is thrown away. Old subjects come back as
  // clickable chips and the previous body can be restored, so pressing the
  // button is never a decision you have to be sure about before you press it.
  const [subjectHistory, setSubjectHistory] = useState([]);
  const [bodyUndo, setBodyUndo]             = useState(null);

  // ── Sending ────────────────────────────────────────────────────────────────
  const [schedule, setSchedule]     = useState(null);
  const [sentList, setSentList]     = useState(null);
  const [sending, setSending]       = useState(false);
  const [sendError, setSendError]   = useState(null);
  const [undoing, setUndoing]       = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [openRun, setOpenRun]       = useState(null);
  const [runRows, setRunRows]       = useState(null);

  // How many people carry a topic set here rather than in WorkTrackr. Held up
  // here so the drawer's heading can show it while the drawer is shut.
  const [handSetCount, setHandSetCount] = useState(0);

  // Who the next send goes to.
  //
  // ONE selection, edited from two screens — the Audience tab's list and the
  // general email's Send button are two windows onto the same ticks, not two independent lists.
  // Two lists would eventually disagree about who is getting an email, and the
  // one that lost would lose silently.
  //
  // Held as a base plus exceptions rather than a list of the ticked, because a
  // search filters the rows on screen: "deselect all" while a search is active
  // must mean everybody, not just the six currently visible.
  const [selBase, setSelBase] = useState('all');       // 'all' | 'none'
  const [selExcept, setSelExcept] = useState(() => new Set());

  const isChecked = useCallback(
    (email) => {
      const e = String(email || '').toLowerCase();
      return selBase === 'all' ? !selExcept.has(e) : selExcept.has(e);
    },
    [selBase, selExcept],
  );

  const toggleOne = useCallback((email) => {
    const e = String(email || '').toLowerCase();
    setSelExcept(prev => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e); else next.add(e);
      return next;
    });
  }, []);

  const selectAll  = useCallback(() => { setSelBase('all');  setSelExcept(new Set()); }, []);
  const selectNone = useCallback(() => { setSelBase('none'); setSelExcept(new Set()); }, []);

  // Exact, not an estimate: exceptions only ever hold addresses that were in
  // the loop when they were ticked.
  const audienceTotal = (overview && overview.audienceCount) || 0;
  const selectedCount = selBase === 'all'
    ? Math.max(0, audienceTotal - selExcept.size)
    : selExcept.size;
  const handPicked = selBase === 'none' || selExcept.size > 0;

  const [emptying, setEmptying]   = useState(false);

  // Test sends
  const [testTo, setTestTo]       = useState('');
  const [testBusy, setTestBusy]   = useState(false);
  const [testNote, setTestNote]   = useState(null);
  const [testError, setTestError] = useState(null);

  const loadOverview = useCallback(async () => {
    try {
      const r = await fetch('/api/keepwarm/overview');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load');
      setOverview(d);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDrafts = useCallback(async () => {
    try {
      const r = await fetch('/api/keepwarm/drafts');
      const d = await r.json();
      if (r.ok) setDrafts(d.drafts || []);
    } catch { /* leave the previous list on screen rather than blanking it */ }
  }, []);

  const loadAudience = useCallback(async (mode, q) => {
    try {
      const r = await fetch(`/api/keepwarm/audience?show=${mode}&q=${encodeURIComponent(q || '')}`);
      const d = await r.json();
      if (r.ok) setAudience(d);
    } catch { /* ignore */ }
  }, []);

  const loadIdeas = useCallback(async () => {
    try {
      const r = await fetch('/api/keepwarm/subjects');
      const d = await r.json();
      if (r.ok) setIdeas(d.ideas || []);
    } catch { /* ignore */ }
  }, []);

  const loadDead = useCallback(async (q) => {
    try {
      const r = await fetch(`/api/keepwarm/dead?q=${encodeURIComponent(q || '')}`);
      const d = await r.json();
      if (r.ok) setDead(d);
    } catch { /* ignore */ }
  }, []);

  // Adding addresses to the loop by hand.
  const [manualText, setManualText] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  // Locks the Remove and Put back links on the audience list while one is in
  // flight, so a double click cannot fire two removals at the same address.
  const [loopBusy, setLoopBusy] = useState(false);
  const [manualResult, setManualResult] = useState(null);
  const [manualRows, setManualRows] = useState(null);

  // Reordering and removing on the Schedule tab. One busy flag for both,
  // because both change the running order and pressing a second while the
  // first is in flight would be acting on a list that is about to change.
  const [slotBusy, setSlotBusy] = useState(false);
  const [slotError, setSlotError] = useState(null);

  const loadSchedule = useCallback(async () => {
    try {
      // Every approved email, not just the next few: the Send column shows them all.
      const r = await fetch('/api/keepwarm/schedule?limit=50');
      const d = await r.json();
      if (r.ok) setSchedule(d);
    } catch { /* leave the previous view on screen rather than blanking it */ }
  }, []);

  // People per email type, for the Review column's picker — the same numbers
  // the service cards show.
  const [laneData, setLaneData] = useState(null);
  const [lanesKey, setLanesKey] = useState(0);
  const loadLaneData = useCallback(async () => {
    try {
      const r = await fetch('/api/keepwarm/interests');
      const d = await r.json();
      if (r.ok) setLaneData(d);
    } catch { /* the picker shows types without people counts */ }
  }, []);

  const loadSent = useCallback(async () => {
    try {
      const r = await fetch('/api/keepwarm/sent');
      const d = await r.json();
      if (r.ok) setSentList(d.runs || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadOverview(); loadDrafts(); }, [loadOverview, loadDrafts]);

  // Load a tab's data when you land on it, so switching back after a send shows
  // the new state rather than a stale one.
  useEffect(() => {
    if (tab === 'emails') { loadSchedule(); loadIdeas(); loadSent(); loadLaneData(); }
    if (tab === 'sent') loadSent();
  }, [tab, loadSchedule, loadSent, loadIdeas, loadLaneData]);

  // While a run is queued or sending, refresh every few seconds. Stops as soon
  // as the run finishes — no point polling an idle screen forever.
  useEffect(() => {
    const active = schedule && schedule.activeRun;
    if (tab !== 'emails' || !active) return;
    const t = setInterval(() => {
      loadSchedule();
      loadDrafts();
      loadSent();
    }, 3000);
    return () => clearInterval(t);
  }, [tab, schedule, loadSchedule, loadDrafts, loadSent]);

  // The undo countdown. Driven off the run's own send_after rather than a local
  // timer started when the button was pressed, so a page refresh mid-window
  // shows the true time left instead of restarting the clock.
  useEffect(() => {
    const active = schedule && schedule.activeRun;
    if (!active || active.status !== 'queued') { setSecondsLeft(0); return; }
    const target = new Date(active.sendAfter.replace(' ', 'T') + 'Z').getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [schedule]);

  // Move one approved email onto a different Tuesday. Studio groups them
  // itself; this overrules the grouping for one email and leaves the rest where
  // they are.
  async function setSlotDay(draftId, date) {
    setSlotBusy(true);
    setSlotError(null);
    try {
      const r = await fetch(`/api/keepwarm/drafts/${encodeURIComponent(draftId)}/send-day`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not move that email');
      await loadSchedule();
    } catch (err) {
      setSlotError(err.message);
    } finally {
      setSlotBusy(false);
    }
  }

  async function sendSlot(slot) {
    setSendError(null);

    // A plain confirm rather than a styled modal. This is the one irreversible
    // button on the screen and the number in it is the whole point — a custom
    // dialog would be prettier and easier to click through without reading.
    // A lane email's headcount comes from the server, which has already narrowed
    // to that lane and applied the ticks saved against the draft. The Audience
    // tab's hand-picked selection is about the general email and must not be
    // read as though it applied here — it would put the wrong number in the one
    // dialog that cannot be taken back.
    const going = (!slot.interest && handPicked) ? selectedCount : slot.projectedCount;
    const ok = window.confirm(
      `Send "${slot.subject}" to ${going} ${going === 1 ? 'person' : 'people'}?`
      + (slot.interest
          ? `\n\nThis is the ${laneLabel(slot.interest)} email. It goes only to the people ticked for ${laneLabel(slot.interest)} — nobody else in the loop will get it.`
          : '')
      + ((!slot.interest && handPicked) ? `\n\nYou have hand-picked these — the other ${Math.max(0, slot.projectedCount - going)} in the loop will not get it.` : '')
      + `\n\nYou will have ${(schedule && schedule.config.undoSeconds) || 10} seconds to undo before anything leaves.`
    );
    if (!ok) return;

    setSending(true);
    try {
      // Send whichever tick list is the shorter and truer description of what
      // was asked for, and let the server resolve it against the live audience.
      const payload = { draftId: slot.draftId };
      if (selBase === 'none') payload.only = Array.from(selExcept);
      else if (selExcept.size) payload.exclude = Array.from(selExcept);

      const r = await fetch('/api/keepwarm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(sendReason(d));
      // The ticks were for this send only, so they go once it is queued. Left
      // in place they would silently narrow the next fortnight's send too.
      selectAll();
      await loadSchedule();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  const loadManual = useCallback(async () => {
    try {
      const r = await fetch('/api/keepwarm/manual');
      const d = await r.json();
      if (r.ok) setManualRows(d.rows || []);
    } catch { /* leave what is on screen */ }
  }, []);

  async function addByHand() {
    setManualBusy(true);
    setManualResult(null);
    try {
      const r = await fetch('/api/keepwarm/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: manualText }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error === 'nothing_pasted' ? 'Nothing to add.' : (d.error || 'Could not add'));
      setManualResult(d);
      // Clear the box only when something actually went in. Leaving a paste
      // that was entirely skipped on screen means the addresses are still there
      // to copy out and look at.
      if (d.added > 0) setManualText('');
      await loadOverview();
      await loadAudience(listMode, search);
      await loadManual();
    } catch (err) {
      setManualResult({ added: 0, skipped: [], unreadable: [], error: err.message });
    } finally {
      setManualBusy(false);
    }
  }

  async function removeByHand(email) {
    setManualBusy(true);
    try {
      const r = await fetch('/api/keepwarm/manual/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) throw new Error('Could not remove');
      await loadOverview();
      await loadAudience(listMode, search);
      await loadManual();
    } catch { /* the reload below shows the truth either way */ }
    finally { setManualBusy(false); }
  }

  // Taking somebody out of the loop.
  //
  // The confirmation is built from what the server says about that address, not
  // from what the row happens to show, because the thing that decides whether
  // this is a delete or a hide — whether an introduction was ever sent — is not
  // on the row. Asking first also means the sentence the operator reads comes
  // from the same place as the behaviour behind it.
  async function removeFromLoop(email) {
    setLoopBusy(true);
    try {
      const infoRes = await fetch(`/api/keepwarm/loop/removal-info?email=${encodeURIComponent(email)}`);
      if (!infoRes.ok) throw new Error('Could not look that address up');
      const info = await infoRes.json();

      const who = [info.contactName, info.companyName].filter(Boolean).join(' at ');
      const lines = [`Remove ${email} from the loop?`, ''];
      if (who) lines.push(who, '');

      if (info.introSent) {
        const sent = info.introSentAt ? ` on ${fmtDate(info.introSentAt)}` : '';
        const kw = info.keepWarmSent;
        lines.push(
          `An introduction email was sent${sent}` +
          (kw ? `, and ${kw} keep-warm ${kw === 1 ? 'email' : 'emails'} since.` : '.') +
          ' Those records stay exactly as they are.',
          '',
          'They stop receiving keep-warm emails. Add them back later and they will not be sent a second introduction.',
        );
      } else {
        lines.push(
          'No email has ever been sent to this address.',
          '',
          'It will be deleted and the address freed, so you can paste a corrected line straight away.',
        );
      }

      if (!window.confirm(lines.join('\n'))) return;

      const r = await fetch('/api/keepwarm/loop/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) throw new Error('Could not remove');
      await loadOverview();
      await loadAudience(listMode, search);
      await loadManual();
    } catch (err) {
      window.alert(err.message || 'Could not remove that address.');
    } finally {
      setLoopBusy(false);
    }
  }

  // Undoing a hide. Nothing to confirm — it puts somebody back where they were
  // and sends nothing.
  async function putBackInLoop(email) {
    setLoopBusy(true);
    try {
      const r = await fetch('/api/keepwarm/loop/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) throw new Error('Could not put that address back');
      await loadOverview();
      await loadAudience(listMode, search);
      await loadManual();
    } catch (err) {
      window.alert(err.message || 'Could not put that address back.');
    } finally {
      setLoopBusy(false);
    }
  }

  async function moveSlot(draftId, direction) {
    setSlotBusy(true);
    setSlotError(null);
    try {
      const r = await fetch(`/api/keepwarm/drafts/${draftId}/schedule-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(
        d.error === 'at_end'          ? 'That one is already at the end of the queue.'
        : d.error === 'not_in_schedule' ? 'That email is no longer in the schedule — the list has been refreshed.'
        : d.error || 'Could not move it',
      );
      await loadSchedule();
    } catch (err) {
      setSlotError(err.message);
      // Whatever went wrong, the list on screen is the suspect. Reload it so
      // the operator is looking at the real order rather than a stale one.
      await loadSchedule();
    } finally {
      setSlotBusy(false);
    }
  }

  async function removeSlot(slot) {
    if (!window.confirm(
      `Remove "${slot.subject}" from the schedule?\n\n`
      + 'It goes back to step 2 (Review) un-approved, and everything behind it '
      + 'moves up a slot. You can approve it again whenever you like.',
    )) return;

    setSlotBusy(true);
    setSlotError(null);
    try {
      const r = await fetch(`/api/keepwarm/drafts/${slot.draftId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error === 'already_sent'
        ? 'That email has already gone out, so it cannot be removed.'
        : d.error || 'Could not remove it');
      // Both lists change: one loses a row, the other gains one back.
      await loadSchedule();
      await loadDrafts();
    } catch (err) {
      setSlotError(err.message);
      await loadSchedule();
    } finally {
      setSlotBusy(false);
    }
  }

  async function emptyTheBin() {
    const n = drafts.filter(d => d.status === 'rejected').length;
    if (!n) return;
    if (!window.confirm(`Delete all ${n} binned ${n === 1 ? 'email' : 'emails'}?\n\nThey will not come back.`)) return;

    setEmptying(true);
    try {
      const r = await fetch('/api/keepwarm/drafts/bin', { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Could not empty the bin');
      }
      await loadDrafts();
    } catch (err) {
      setError(err.message);
    } finally {
      setEmptying(false);
    }
  }

  async function sendTestEmail(draftId) {
    setTestError(null);
    setTestNote(null);
    setTestBusy(true);
    try {
      const r = await fetch('/api/keepwarm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, toEmail: testTo }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(testReason(d));
      setTestNote(`Test sent to ${testTo}. The draft is untouched and still due to go to everyone.`);
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTestBusy(false);
    }
  }

  async function undoSend() {
    const active = schedule && schedule.activeRun;
    if (!active) return;
    setUndoing(true);
    try {
      const r = await fetch('/api/keepwarm/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: active.id }),
      });
      if (!r.ok) {
        setSendError('Too late to undo — the first emails have already gone.');
      }
      await loadSchedule();
      await loadDrafts();
    } catch (err) {
      setSendError('Could not undo: ' + err.message);
    } finally {
      setUndoing(false);
    }
  }

  async function openRunDetail(id) {
    if (openRun === id) { setOpenRun(null); return; }
    setOpenRun(id);
    setRunRows(null);
    try {
      const r = await fetch(`/api/keepwarm/sent/${id}/recipients`);
      const d = await r.json();
      if (r.ok) setRunRows(d.rows || []);
      else setRunRows([]);
    } catch { setRunRows([]); }
  }

  useEffect(() => {
    if (!showList) return;
    // The dead list is its own endpoint rather than a third `show=` value on
    // the audience one. The audience is derived from sends and carries stages
    // and greetings; the dead list is keyed on the address and carries bounce
    // reasons. Forcing them through one shape would mean half the fields being
    // null on either side of the toggle.
    if (listMode === 'dead') {
      const t = setTimeout(() => loadDead(search), 250);
      return () => clearTimeout(t);
    }
    if (listMode === 'manual') { loadManual(); return; }
    const t = setTimeout(() => loadAudience(listMode, search), 250);
    return () => clearTimeout(t);
  }, [showList, listMode, search, loadAudience, loadDead]);

  // Removing is a soft delete, the same as emptying the drafts bin: the row is
  // hidden but keeps doing its job, so the address can never be mailed again.
  // The confirm says that in as many words, because "remove" on every other
  // screen in Studio means the thing is gone.
  async function removeDead(email) {
    if (!window.confirm(
      `Remove ${email} from the list?\n\n` +
      `It stays blocked — Studio will never email this address again. ` +
      `This only clears it off the screen.`
    )) return;
    setDeadBusy(true);
    try {
      const r = await fetch('/api/keepwarm/dead/hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) throw new Error('remove failed');
      await loadDead(search);
      await loadOverview();
    } catch (err) {
      setError('Could not remove that address: ' + err.message);
    } finally {
      setDeadBusy(false);
    }
  }

  async function removeAllDead() {
    const n = dead?.total || 0;
    if (!n) return;
    if (!window.confirm(
      `Remove all ${n} dead ${n === 1 ? 'address' : 'addresses'} from the list?\n\n` +
      `They stay blocked — Studio will never email them again. ` +
      `This only clears the screen.`
    )) return;
    setDeadBusy(true);
    try {
      const r = await fetch('/api/keepwarm/dead/hide-all', { method: 'POST' });
      if (!r.ok) throw new Error('remove failed');
      await loadDead(search);
      await loadOverview();
    } catch (err) {
      setError('Could not clear the list: ' + err.message);
    } finally {
      setDeadBusy(false);
    }
  }

  async function toggleStage(key) {
    if (!overview) return;
    const next = overview.settings.stages.includes(key)
      ? overview.settings.stages.filter(s => s !== key)
      : [...overview.settings.stages, key];
    try {
      const r = await fetch('/api/keepwarm/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: next }),
      });
      if (!r.ok) throw new Error('save failed');
      await loadOverview();
      if (showList) loadAudience(listMode, search);
    } catch (err) {
      setError('Could not save the stage rule: ' + err.message);
    }
  }

  async function toggleNoStage() {
    if (!overview) return;
    try {
      await fetch('/api/keepwarm/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeNoStage: !overview.settings.includeNoStage }),
      });
      await loadOverview();
      if (showList) loadAudience(listMode, search);
    } catch (err) {
      setError('Could not save: ' + err.message);
    }
  }

  function toggleIdea(id) {
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function addIdeaLines() {
    const text = ideaText.trim();
    if (!text) return;
    setIdeaBusy(true);
    setGenError(null);
    try {
      const r = await fetch('/api/keepwarm/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lane: ideaLane }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'could not add');
      setIdeas(d.ideas || []);
      setIdeaText('');
      if (d.skipped) setGenNote(`${d.added} added. ${d.skipped} were already on the list.`);
    } catch (err) {
      setGenError(err.message);
    } finally {
      setIdeaBusy(false);
    }
  }

  // Ask Studio for subject-line suggestions. Saves nothing — see SuggestLines.
  // Returns { suggestions, note } or { error } for the box to show in place.
  async function suggestIdeaLines(lane, count, avoid) {
    try {
      const r = await fetch('/api/keepwarm/subjects/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lane, count, avoid }),
      });
      const d = await r.json();
      if (!r.ok) return { error: d.error || 'Could not suggest lines' };
      return d;
    } catch (err) {
      return { error: err.message };
    }
  }

  // Keep one or more suggestions. The same add path as the Add box, with the
  // type picked in the Suggest bar, so a kept line is an ordinary line.
  async function keepSuggestedLines(texts, lane) {
    setIdeaBusy(true);
    try {
      const r = await fetch('/api/keepwarm/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texts.join('\n'), lane }),
      });
      const d = await r.json();
      if (!r.ok) return { error: d.error || 'Could not keep that line' };
      setIdeas(d.ideas || []);
      return { added: d.added, skipped: d.skipped };
    } catch (err) {
      return { error: err.message };
    } finally {
      setIdeaBusy(false);
    }
  }

  // Move a subject line to another type ('general' or a service key).
  async function changeIdeaLane(id, lane) {
    setIdeaBusy(true);
    setGenError(null);
    try {
      const r = await fetch(`/api/keepwarm/subjects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lane }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not change the type');
      setIdeas(d.ideas || []);
    } catch (err) {
      setGenError(err.message);
    } finally {
      setIdeaBusy(false);
    }
  }

  // Change a line's wording. Returns { error } for the row to show beside the
  // box, rather than a banner at the top of the page the eye is nowhere near.
  async function editIdeaText(id, text) {
    try {
      const r = await fetch(`/api/keepwarm/subjects/${id}/text`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!r.ok) return { error: d.error || 'Could not save the change' };
      setIdeas(d.ideas || []);
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  // "These look right" — keep Studio's suggested types.
  async function confirmIdeaLanes() {
    setIdeaBusy(true);
    setGenError(null);
    try {
      const r = await fetch('/api/keepwarm/subjects/confirm-types', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save');
      setIdeas(d.ideas || []);
    } catch (err) {
      setGenError(err.message);
    } finally {
      setIdeaBusy(false);
    }
  }

  async function binIdea(id) {
    setIdeaBusy(true);
    try {
      const r = await fetch(`/api/keepwarm/subjects/${id}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'could not remove');
      setIdeas(d.ideas || []);
      setPicked(prev => prev.filter(x => x !== id));
    } catch (err) {
      setGenError(err.message);
    } finally {
      setIdeaBusy(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setGenError(null);
    setGenNote(null);
    try {
      const r = await fetch('/api/keepwarm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, subjectIds: pickedIdeas }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Generation failed');
      // The server says why, in plain English, when it can. The bare count is
      // the fallback for an older reply that has no note on it.
      if (d.short) setGenNote(d.note || `Asked for ${d.requested}, got ${d.generated} back.`);
      // The ticks clear because those lines are now spoken for by a draft. They
      // are not used up yet — bin the draft and the line comes back.
      setPicked([]);
      await loadDrafts();
      await loadIdeas();
      // A ticked service line makes a service email, so the service cards at
      // the top and the Review picker's counts both need re-reading. The cards
      // keep their own data, so they are re-mounted to make them fetch again.
      await loadLaneData();
      setLanesKey(k => k + 1);
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function setStatus(id, status) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/keepwarm/drafts/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not update');
      // Approving or un-approving moves an email between the Review and Send
      // columns, so both lists are reloaded.
      await loadDrafts();
      await loadSchedule();
      if (open && open.draft.id === id) setOpen(o => ({ ...o, draft: d.draft }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  // Read, from any email on the Emails tab. `slot` is a Send-column slot (so
  // the header can say when it goes and to how many) or a plain draft from the
  // Review column or the bin, carrying its id and status. The copy itself
  // always comes from the server.
  // With an email address it switches to that person's copy and leaves the
  // email on screen while the new one loads, so the list does not jump about.
  async function openReadCopy(slot, email = null) {
    if (email) {
      setReadCopy(s => s ? { ...s, switching: email, error: null } : s);
    } else {
      setTestNote(null);
      setTestError(null);
      setReadCopy({ slot, copy: null, loading: true, switching: null, error: null });
    }
    try {
      const q = email ? `?email=${encodeURIComponent(email)}` : '';
      const r = await fetch(`/api/keepwarm/drafts/${slot.draftId}/read${q}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error === 'no_draft' ? 'That email no longer exists.' : (d.error || 'Could not open'));
      setReadCopy(s => (s && s.slot.draftId === slot.draftId) ? { ...s, copy: d, loading: false, switching: null } : s);
    } catch (err) {
      setReadCopy(s => (s && s.slot.draftId === slot.draftId) ? { ...s, loading: false, switching: null, error: err.message } : s);
    }
  }

  // The buttons inside the Read view. Each changes the email's status and
  // closes the view, so the board underneath shows where it went.
  async function statusFromRead(id, status) {
    await setStatus(id, status);
    setReadCopy(null);
  }

  async function openDraft(id) {
    try {
      const r = await fetch(`/api/keepwarm/drafts/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not open');
      setSubjectHistory([]);
      setBodyUndo(null);
      setRegenError(null);
      setOpen({ draft: d.draft, bodyText: d.bodyText, preview: d.preview });
    } catch (err) {
      setError(err.message);
    }
  }

  async function regenerate(part) {
    if (!open) return;
    setRegenerating(part);
    setRegenError(null);

    // Captured before the call so the undo target is what was on screen when
    // the button was pressed, not whatever state has become by the time the
    // response lands.
    const priorSubject = open.draft.subject;
    const priorBody    = open.bodyText;

    try {
      const r = await fetch(`/api/keepwarm/drafts/${open.draft.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          part,
          subject: open.draft.subject,
          text: open.bodyText,
          avoid: part === 'subject' ? subjectHistory : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not regenerate');

      if (part === 'subject') {
        setSubjectHistory(h => (h.includes(priorSubject) ? h : [priorSubject, ...h]).slice(0, 8));
      } else {
        setBodyUndo(priorBody);
      }
      setOpen({ draft: d.draft, bodyText: d.bodyText, preview: d.preview });
      await loadDrafts();
    } catch (err) {
      setRegenError(err.message);
    } finally {
      setRegenerating(null);
    }
  }

  // Restoring is an ordinary save of the old text, so it goes down the same
  // path as any other edit and behaves identically — including clearing the
  // approval, which is right: the draft has changed again.
  async function restoreBody() {
    if (!open || !bodyUndo) return;
    const restore = bodyUndo;
    setBodyUndo(null);
    setSaving(true);
    try {
      const r = await fetch(`/api/keepwarm/drafts/${open.draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: open.draft.subject, text: restore }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not restore');
      setOpen({ draft: d.draft, bodyText: d.bodyText, preview: d.preview });
      await loadDrafts();
    } catch (err) {
      setRegenError(err.message);
      setBodyUndo(restore);
    } finally {
      setSaving(false);
    }
  }

  async function saveOpen() {
    if (!open) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/keepwarm/drafts/${open.draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: open.draft.subject, text: open.bodyText }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save');
      setOpen({ draft: d.draft, bodyText: d.bodyText, preview: d.preview });
      await loadDrafts();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const cfg = overview?.config || {};

  // The board's columns, and which one needs you. Send wins on a send day,
  // because that is the job with a clock on it.
  const reviewDrafts = drafts.filter(d => d.status === 'draft');
  const binnedDrafts = drafts.filter(d => d.status === 'rejected');
  const dueSlots = (schedule && !schedule.activeRun) ? (schedule.slots || []).filter(s => s.dueNow) : [];
  const sendNeedsYou = dueSlots.length > 0;
  const reviewNeedsYou = !sendNeedsYou && reviewDrafts.length > 0;
  const emailsBadge = sendNeedsYou ? dueSlots.length : reviewDrafts.length;

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: BG, padding: '28px 32px' }}>
      <div style={{ maxWidth: 1100 }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: '0 0 4px' }}>Keep-warm emails</h1>
        <p style={{ fontSize: 14, color: MUTED, margin: '0 0 22px', lineHeight: 1.6 }}>
          A short email every fortnight to everyone who has already had Billy's introduction, so
          Sweetbyte stays in mind while they are still deciding. Nothing goes out on a timer —
          Studio lines the next one up and you press send.
        </p>

        <KeepWarmLanes
          key={lanesKey}
          selected={lane}
          onSelect={setLane}
          onOpenDraft={openDraft}
          onDraftsChanged={() => { loadDrafts(); loadOverview(); loadSchedule(); loadLaneData(); }}
        />

        <TabBar tab={tab} onPick={setTab} badges={{ emails: emailsBadge }} />

        {error && <Banner tone="bad">{error}</Banner>}

        {!loading && !cfg.stagesEverReceived && (
          <Banner tone="warn">
            WorkTrackr has not sent any sales stages across yet, so everyone below shows as
            "no stage set" and the audience is empty. WorkTrackr pushes them on its own — every time
            somebody changes a stage, and as a full sweep every half hour. If this is still showing
            an hour after the WorkTrackr deploy, check its logs for lines beginning <strong>[stage-sync]</strong>.
          </Banner>
        )}
        {!loading && !cfg.ragLoaded && (
          <Banner tone="bad">
            The Sweetbyte knowledge base is missing from the server, so generation will refuse to run.
            Check that <strong>server/assets/sweetbyte-company-rag.md</strong> made it into the deploy.
          </Banner>
        )}
        {!loading && !cfg.anthropicConfigured && (
          <Banner tone="bad">ANTHROPIC_API_KEY is not set — generation will fail.</Banner>
        )}

        {!loading && <SendDayBanner r={overview.reminder} />}

        {loading ? (
          <div style={{ color: MUTED, fontSize: 14 }}>Loading…</div>
        ) : (
          <>
            {tab === 'audience' && (<>
            {/* ── Audience ─────────────────────────────────────────────── */}
            <LoopTiles overview={overview} />
            <Card>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: 0 }}>Who is in the loop</h2>
                <div style={{ fontSize: 13, color: MUTED }}>
                  {overview.stageRefresh.at
                    ? `Stages last received from WorkTrackr: ${fmt(overview.stageRefresh.at)} · ${overview.stageRefresh.withStage} of ${overview.stageRefresh.held} companies have a stage`
                    : 'WorkTrackr has not sent any stages yet'}
                </div>
              </div>

              {/* The four numbers that used to live here are the tiles above.
                  Said once, at the top, rather than twice. */}
              <div style={{ fontSize: 13, color: MUTED, margin: '12px 0 8px' }}>
                Tick the sales stages that stay in the loop. The number on each is how many people
                you have already emailed who are sitting at that stage right now.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {overview.stages.map(s => <StageChip key={s.key} stage={s} onToggle={toggleStage} />)}
                <button
                  onClick={toggleNoStage}
                  style={{
                    background: overview.settings.includeNoStage ? SB.tint : CARD,
                    border: `1px dashed ${overview.settings.includeNoStage ? SB.primary : BORDER}`,
                    color: overview.settings.includeNoStage ? SB.dark : MUTED,
                    borderRadius: 999, padding: '6px 13px', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  No stage set
                  <span style={{ marginLeft: 7, fontWeight: 500, color: TERTIARY }}>{overview.noStageCount}</span>
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button onClick={() => setShowList(v => !v)}>
                  {showList ? 'Hide the list' : 'Show the list'}
                </Button>
                <span style={{ fontSize: 12, color: TERTIARY }}>
                  Stages come from WorkTrackr automatically — nothing to press.
                  Customers are locked out — these emails are written to win new business.
                </span>
              </div>

              {showList && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <Button tone={listMode === 'included' ? 'primary' : 'plain'} onClick={() => setListMode('included')}>
                      In the loop{audience ? ` (${audience.includedCount})` : ''}
                    </Button>
                    <Button tone={listMode === 'excluded' ? 'primary' : 'plain'} onClick={() => setListMode('excluded')}>
                      Excluded{audience ? ` (${audience.excludedCount})` : ''}
                    </Button>
                    <Button tone={listMode === 'dead' ? 'primary' : 'plain'} onClick={() => setListMode('dead')}>
                      Dead{overview.deadCount ? ` (${overview.deadCount})` : ''}
                    </Button>
                    <Button tone={listMode === 'manual' ? 'primary' : 'plain'} onClick={() => setListMode('manual')}>
                      By hand{manualRows && manualRows.length ? ` (${manualRows.length})` : ''}
                    </Button>
                    {listMode === 'included' && (
                      <>
                        <Button onClick={selectAll}>Select all</Button>
                        <Button onClick={selectNone}>Deselect all</Button>
                        <span style={{ fontSize: 12, color: TERTIARY, alignSelf: 'center' }}>
                          {selectedCount} ticked for the next send
                        </span>
                      </>
                    )}
                  </div>

                  {listMode === 'included' && handPicked && (
                    <div style={{ fontSize: 12, color: AMBER, background: AMBER_BG, border: `1px solid ${AMBER}`,
                                  borderRadius: 7, padding: '8px 11px', marginBottom: 10, lineHeight: 1.5 }}>
                      These ticks apply to the next send only, and clear once it goes. Nobody is removed
                      from the loop — unticking somebody here does not change their stage or exclude them
                      from future emails.
                    </div>
                  )}

                  {listMode === 'dead' && (
                    <div style={{ fontSize: 12, color: DANGER, background: DANGER_BG, border: `1px solid ${DANGER}`,
                                  borderRadius: 7, padding: '8px 11px', marginBottom: 10, lineHeight: 1.5 }}>
                      These addresses rejected mail permanently. They are already out of the loop and
                      Studio will not email them again. Removing one only clears it off this screen —
                      it stays blocked. Their send history is untouched, so you can still see what that
                      company was sent.
                    </div>
                  )}

                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, company or address"
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 14,
                      border: `1px solid ${BORDER}`, borderRadius: 7, fontFamily: 'inherit', marginBottom: 10,
                    }}
                  />
                  {listMode === 'manual' ? (<>
                    <div style={{ fontSize: 12, color: MUTED, background: BG, border: `1px solid ${BORDER}`,
                                  borderRadius: 7, padding: '8px 11px', marginBottom: 10, lineHeight: 1.5 }}>
                      Addresses you typed in rather than ones Studio has emailed. They sit in the loop
                      on the same terms as everybody else. Removing one takes them out of the loop and
                      nothing more — it does not unsubscribe them, and you can add them again.
                      Anyone here who is later sent a real introduction email drops off this list,
                      because from then on the send record is what keeps them in.
                    </div>
                    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', maxHeight: 380, overflowY: 'auto' }}>
                      {(manualRows || []).map(r => (
                        <ManualRow key={r.email} row={r} onRemove={removeByHand} busy={manualBusy} />
                      ))}
                      {manualRows && manualRows.length === 0 && (
                        <div style={{ padding: '16px 12px', fontSize: 13, color: MUTED }}>
                          Nobody has been added by hand.
                        </div>
                      )}
                    </div>
                  </>) : listMode === 'dead' ? (<>
                    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', maxHeight: 380, overflowY: 'auto' }}>
                      {(dead?.rows || []).map(r => (
                        <DeadRow key={r.email} row={r} onRemove={removeDead} busy={deadBusy} />
                      ))}
                      {dead && dead.rows.length === 0 && (
                        <div style={{ padding: '16px 12px', fontSize: 13, color: MUTED }}>
                          {search ? 'Nobody matches.' : 'No dead addresses. Nothing has bounced permanently.'}
                        </div>
                      )}
                    </div>
                    {dead?.truncated && (
                      <div style={{ fontSize: 12, color: TERTIARY, marginTop: 6 }}>
                        Showing the first 500 — narrow the search to find one.
                      </div>
                    )}
                    {dead && dead.rows.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                        <Button tone="plain" disabled={deadBusy} onClick={removeAllDead}>
                          {deadBusy ? 'Working…' : `Remove all ${dead.total}`}
                        </Button>
                      </div>
                    )}
                  </>) : (<>
                    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', maxHeight: 380, overflowY: 'auto' }}>
                      {(audience?.rows || []).map(r => (
                        <AudienceRow
                          key={r.email}
                          row={r}
                          selectable={listMode === 'included'}
                          checked={isChecked(r.email)}
                          onToggle={toggleOne}
                          onRemove={removeFromLoop}
                          onRestore={putBackInLoop}
                          busy={loopBusy}
                        />
                      ))}
                      {audience && audience.rows.length === 0 && (
                        <div style={{ padding: '16px 12px', fontSize: 13, color: MUTED }}>Nobody matches.</div>
                      )}
                    </div>
                    {audience?.truncated && (
                      <div style={{ fontSize: 12, color: TERTIARY, marginTop: 6 }}>
                        Showing the first 1,000 — narrow the search to find someone specific.
                      </div>
                    )}
                  </>)}
                </div>
              )}
            </Card>

            </>)}

            {tab === 'audience' && (
              /* Three jobs that are done occasionally, shut until they are
                 wanted. The headings stay readable while they are shut, so
                 nothing is hidden — a first look at this page still says what
                 can be done on it. */
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <Fold title="Add one person" note="search for their company">
                  <AddOnePersonCard bare onAdded={() => { loadManual(); loadAudience(listMode, search); }} />
                </Fold>
                <Fold title="Add a list of addresses" note="paste, one per line" last={handSetCount === 0}>
                  <AddByHandCard
                    bare
                    text={manualText}
                    onText={setManualText}
                    onAdd={addByHand}
                    busy={manualBusy}
                    result={manualResult}
                  />
                </Fold>
                {handSetCount > 0 && (
                  <Fold title="Topics set here, not in WorkTrackr" note={`${handSetCount} ${handSetCount === 1 ? 'person' : 'people'}`} last>
                    <HandSetTopicsCard bare reloadKey={manualRows ? manualRows.length : 0} onCount={setHandSetCount} />
                  </Fold>
                )}
                {/* Mounted while the drawer is shut as well, because it is the
                    thing that knows whether there is anything to show. */}
                {handSetCount === 0 && (
                  <div style={{ display: 'none' }}>
                    <HandSetTopicsCard bare reloadKey={manualRows ? manualRows.length : 0} onCount={setHandSetCount} />
                  </div>
                )}
              </Card>
            )}

            {tab === 'emails' && (<>
              {/* ── Sending in progress ────────────────────────────────── */}
              {schedule && schedule.activeRun && schedule.activeRun.status === 'queued' && (
                <UndoBar
                  secondsLeft={secondsLeft}
                  count={schedule.activeRun.recipientCount}
                  onUndo={undoSend}
                  undoing={undoing}
                />
              )}
              {schedule && schedule.activeRun && schedule.activeRun.status === 'sending' && (
                <Card>
                  <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Sending now</div>
                  <div style={{ fontSize: 14, color: TEXT, marginBottom: 10 }}>{schedule.activeRun.subject}</div>
                  <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
                    {schedule.activeRun.progress.sent} of {schedule.activeRun.progress.total} sent
                    {schedule.activeRun.progress.suppressed > 0 && `, ${schedule.activeRun.progress.suppressed} skipped as unsubscribed`}
                    {schedule.activeRun.progress.failed > 0 && `, ${schedule.activeRun.progress.failed} failed`}.
                    {' '}A thousand takes a couple of minutes. You can leave this page — it carries on without you.
                  </div>
                </Card>
              )}

              {sendError && <Banner tone="bad">{sendError}</Banner>}
              {slotError && <Banner tone="bad">{slotError}</Banner>}
              {genError && <Banner tone="bad">{genError}</Banner>}
              {genNote && <Banner tone="warn">{genNote}</Banner>}
              {handPicked && (
                <Banner tone="warn">
                  You have hand-picked {selectedCount} of {audienceTotal} on the Audience tab for the
                  next general email. The ticks clear as soon as it goes.
                </Banner>
              )}

              {/* ── Step 1 ─────────────────────────────────────────────── */}
              <WriteStep
                count={count}
                counts={overview.allowedCounts || [3, 6, 9]}
                onCount={setCount}
                onGenerate={generate}
                generating={generating}
                canGenerate={Boolean(cfg.ragLoaded && cfg.anthropicConfigured)}
                ideas={ideas}
                picked={pickedIdeas}
                onToggleIdea={toggleIdea}
                onBinIdea={binIdea}
                ideaBusy={ideaBusy}
                ideaText={ideaText}
                onIdeaText={setIdeaText}
                onAddIdeas={addIdeaLines}
                laneData={laneData}
                onSetLane={changeIdeaLane}
                onConfirmTypes={confirmIdeaLanes}
                newLane={ideaLane}
                onNewLane={setIdeaLane}
                onEditText={editIdeaText}
                onSuggest={suggestIdeaLines}
                onKeepSuggested={keepSuggestedLines}
              />

              {/* ── Steps 2 and 3, and what went last ──────────────────── */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
                gap: 12, alignItems: 'start',
              }}>
                <ReviewColumn
                  waiting={reviewDrafts}
                  binned={binnedDrafts}
                  need={reviewNeedsYou}
                  busyId={busyId}
                  onRead={(d) => openReadCopy({ draftId: d.id, status: d.status })}
                  onApprove={(id) => setStatus(id, 'approved')}
                  onBin={(id) => setStatus(id, 'rejected')}
                  onRestore={(id) => setStatus(id, 'draft')}
                  onEmptyBin={emptyTheBin}
                  emptying={emptying}
                  laneData={laneData}
                  scheduledSlots={schedule ? schedule.slots : []}
                />
                <SendColumn
                  data={schedule}
                  need={sendNeedsYou}
                  sending={sending}
                  onRead={(slot) => openReadCopy({ ...slot, status: 'approved' })}
                  onSend={sendSlot}
                  onSetDay={setSlotDay}
                  onMove={moveSlot}
                  onRemove={removeSlot}
                  slotBusy={slotBusy}
                  handPicked={handPicked}
                  selectedCount={selectedCount}
                  onHandPick={() => { setTab('audience'); setListMode('included'); setShowList(true); }}
                />
                <SentColumn runs={sentList} />
              </div>

              <div style={{ fontSize: 12, color: TERTIARY, lineHeight: 1.6, padding: '14px 0 40px' }}>
                Nothing goes out on its own — you press Send each time. Headcounts are who qualifies
                today; the real list is fixed the moment you press Send, because stages keep moving in WorkTrackr.
              </div>
            </>)}

            {tab === 'sent' && (
              <SentView
                runs={sentList}
                openId={openRun}
                onOpen={openRunDetail}
                recipients={runRows}
              />
            )}
          </>
        )}
      </div>

      <ReadCopyPanel
        state={readCopy}
        onClose={() => setReadCopy(null)}
        onEdit={(id) => { setReadCopy(null); openDraft(id); }}
        onPick={(email) => readCopy && openReadCopy(readCopy.slot, email)}
        onApprove={(id) => statusFromRead(id, 'approved')}
        onBin={(id) => statusFromRead(id, 'rejected')}
        onRestore={(id) => statusFromRead(id, 'draft')}
        busy={Boolean(readCopy && busyId && readCopy.slot.draftId === busyId)}
        testTo={testTo}
        onTestTo={setTestTo}
        onTest={sendTestEmail}
        testBusy={testBusy}
        testNote={testNote}
        testError={testError}
      />

      <ReadPanel
        state={open}
        saving={saving}
        onClose={() => setOpen(null)}
        onChange={(patch) => setOpen(o => {
          // bodyText is the editable plain-text form and lives beside the draft,
          // not on it — the draft row holds the styled HTML the server built.
          const { bodyText, ...onDraft } = patch;
          return {
            ...o,
            ...(bodyText !== undefined ? { bodyText } : {}),
            draft: { ...o.draft, ...onDraft },
          };
        })}
        onSave={saveOpen}
        onStatus={setStatus}
        onRegenerate={regenerate}
        regenerating={regenerating}
        regenError={regenError}
        subjectHistory={subjectHistory}
        onPickSubject={(sub) => setOpen(o => ({ ...o, draft: { ...o.draft, subject: sub } }))}
        bodyUndo={bodyUndo}
        onUndoBody={restoreBody}
      />
    </div>
  );
}
