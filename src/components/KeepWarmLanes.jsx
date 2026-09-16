// ─────────────────────────────────────────────────────────────────────────────
// KeepWarmLanes.jsx — the service-interest cards above the keep-warm tabs.
//
// One card per service interest ticked on a person in WorkTrackr, showing how
// many people in the loop it covers, plus one card for everybody with nothing
// ticked.
//
// WHAT THIS DOES NOT DO YET. Nothing here sends, drafts, or changes who
// receives anything. The cards count and they filter the audience list below.
// Per-topic drafts and the rotation — everybody getting their next unseen
// topic each fortnight — are the second half, and they depend on interest data
// that has not started arriving yet. Counting first means the data can be
// checked on screen before anything is built on top of it.
//
// INTEREST NEVER OVERRULES STAGE. The counts come from the audience endpoint,
// which has already applied the stage rule, so a lane can never show somebody
// who is dead, opted out or at an excluded stage. Stage decides who is in the
// loop; interest only decides the topic.
//
// SUB-COMPONENT RULE, same as KeepWarm.jsx: everything is defined at module
// level. A component defined inside a render is a new type on every keystroke,
// which remounts it and loses focus.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from 'react';
import { SB } from '../brand.js';

const TEXT     = '#1a1a1a';
const MUTED    = '#666';
const TERTIARY = '#999';
const BORDER   = '#e0e0dc';
const CARD     = '#ffffff';

// How many cards are shown before the rest are folded away. Ten cards plus the
// "nothing ticked" one is a wall; six is roughly one row and a bit on a normal
// window, and the link says exactly how many are hidden.
const COLLAPSED_COUNT = 6;

function LaneCard({ label, count, selected, muted, dashed, status, statusTone, onClick }) {
  const tone = statusTone === 'good' ? '#1D7A54'
             : statusTone === 'warn' ? '#854F0B'
             : statusTone === 'bad'  ? '#A32D2D'
             : TERTIARY;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: dashed ? '#fafaf8' : CARD,
        border: selected ? `2px solid ${SB.primary}` : `1px ${dashed ? 'dashed' : 'solid'} ${BORDER}`,
        borderRadius: 10,
        padding: selected ? '11px 13px' : '12px 14px',
        cursor: 'pointer',
        font: 'inherit',
        display: 'block',
        width: '100%',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 600, color: muted ? MUTED : TEXT, lineHeight: 1.2 }}>
        {count}
      </div>
      <div style={{ fontSize: 14, color: muted ? MUTED : TEXT, margin: '2px 0 6px' }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: tone }}>{status}</div>
    </button>
  );
}

export default function KeepWarmLanes({ selected, onSelect }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/keepwarm/interests');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load the interest counts');
      setData(d);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 18px', marginBottom: 18 }}>
        <p style={{ fontSize: 13, color: '#A32D2D', margin: 0 }}>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 18px', marginBottom: 18 }}>
        <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>Loading service interests…</p>
      </div>
    );
  }

  const keys = data.keys || [];
  const shown = showAll ? keys : keys.slice(0, COLLAPSED_COUNT);
  const hidden = keys.length - shown.length;

  // Nobody has ever been sent an interest, which is a different problem from
  // everybody having nothing ticked. Said in plain words rather than shown as
  // ten zeroes, because ten zeroes look like a bug in Studio when they are
  // actually a bridge that has not been switched on yet.
  const neverReceived = !data.everReceived;

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '16px 18px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: TEXT, margin: 0 }}>Send by service interest</h3>
        <span style={{ fontSize: 13, color: MUTED }}>
          {data.audienceTotal} in the loop
        </span>
      </div>

      <p style={{ fontSize: 13, color: MUTED, margin: '6px 0 14px', lineHeight: 1.6 }}>
        {neverReceived
          ? 'WorkTrackr has not sent any service interests yet, so everybody is in the last card. The tags are ticked on a person in WorkTrackr and arrive with the sales stages.'
          : 'What each person has been ticked as interested in, in WorkTrackr. Somebody ticked for three topics appears in three cards.'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {shown.map(({ key, label }) => (
          <LaneCard
            key={key}
            label={label}
            count={data.counts?.[key] ?? 0}
            selected={selected === key}
            status="No draft yet"
            statusTone="plain"
            onClick={() => onSelect(selected === key ? null : key)}
          />
        ))}

        <LaneCard
          label="Nothing ticked"
          count={data.none ?? 0}
          selected={selected === '__none'}
          muted
          dashed
          status="General IT support"
          statusTone="plain"
          onClick={() => onSelect(selected === '__none' ? null : '__none')}
        />
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{ background: 'none', border: 'none', padding: '12px 0 0', cursor: 'pointer', font: 'inherit', fontSize: 13, color: SB.strong }}
        >
          Show all {keys.length}
        </button>
      )}

      {selected && (
        <p style={{ fontSize: 13, color: MUTED, margin: '12px 0 0', lineHeight: 1.6 }}>
          The list below is filtered to this interest. The stage rule still applies —
          this only narrows who is shown, it never adds anybody back in.
        </p>
      )}
    </div>
  );
}
