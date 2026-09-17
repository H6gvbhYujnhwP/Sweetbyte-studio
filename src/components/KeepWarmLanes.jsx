// ─────────────────────────────────────────────────────────────────────────────
// KeepWarmLanes.jsx — the service-interest lanes on the Keep-warm screen.
//
// One card per service interest ticked on a company in WorkTrackr, plus one for
// everybody with nothing ticked. Clicking a card opens a panel underneath it
// holding the people in that lane, each with a tickbox, and the draft written
// for that lane.
//
// WHAT A LANE IS. A lane is a topic and the people who said they were
// interested in it. Press Write on Microsoft 365 and Studio writes an email
// about Microsoft 365; approving it sends it to the ticked people in that lane
// and to nobody else. Nine lanes means nine separate emails, each parked with
// its own list.
//
// INTEREST NEVER OVERRULES STAGE. Every list here comes from the audience the
// stage rule has already decided, so a lane can never show somebody who is
// dead, opted out or at an excluded stage. Stage decides who is in the loop at
// all; interest only decides which of them gets which topic.
//
// THE TICKS LIVE ON THE DRAFT, NOT IN THIS COMPONENT. Unticking somebody is
// saved against the lane's draft on the server the moment you do it. That is
// deliberate: a fortnight is several lane sends going out on the same day, each
// with its own list, and a single selection held in the browser cannot hold
// nine different lists at once. It also means the server, not the screen,
// decides who a lane email reaches — a tab left open since this morning cannot
// send the Microsoft 365 email to everybody.
//
// UNTICKING IS FOR THIS SEND ONLY. It does not remove anybody from the loop and
// it does not change what they are interested in. Those ticks live in
// WorkTrackr and Studio never writes to them.
//
// SUB-COMPONENT RULE, same as KeepWarm.jsx: everything is defined at module
// level. A component defined inside a render is a new type on every keystroke,
// which remounts it and loses focus.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SB } from '../brand.js';

const TEXT     = '#1a1a1a';
const MUTED    = '#666';
const TERTIARY = '#999';
const BORDER   = '#e0e0dc';
const CARD     = '#ffffff';
const ROW_LINE = '#f0f0ec';

// How many cards are shown before the rest are folded away. Ten cards plus the
// "nothing ticked" one is a wall; six is roughly one row and a bit on a normal
// window, and the link says exactly how many are hidden.
const COLLAPSED_COUNT = 6;

// The list scrolls rather than growing the page. A lane of a hundred people
// would otherwise push the tabs and everything below them off the screen.
const LIST_MAX_HEIGHT = 300;

// The lane labels, for naming the topic somebody has gone to instead. Keys are
// permanent, which is what makes a local copy safe; an unrecognised one falls
// back to the key rather than blanking the line.
const LANE_LABELS = {
  // Retired as a lane of its own and merged into the general email. Kept here
  // so a draft written before the merge still names itself in plain words.
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

// The lanes that end their email with example websites. Kept in step with
// LANES_WITH_EXAMPLES in server/services/keepwarm-examples.js, which is the one
// that decides; this list only decides whether the box is drawn. A lane named
// here and not there gets a box that saves nothing, so they move together.
const LANES_WITH_EXAMPLES = ['website'];

const ROW_COLUMNS = '34px minmax(0, 0.9fr) 120px minmax(0, 1.1fr) minmax(0, 1.4fr) 128px';

// The colours the Audience list uses for the same pill, so a greeting reads the
// same wherever it is shown.
const GOOD    = '#1D7A54';
const GOOD_BG = '#E4F3EC';

// What the email will open with for one person, shown beside their name so a
// wrong greeting is caught here rather than in somebody's inbox. A company with
// nobody named against it opens "Hi there," — which is correct, not a fault, so
// it is shown in grey rather than flagged as a problem.
function GreetingPill({ greeting }) {
  const known = Boolean(greeting);
  return (
    <span style={{
      fontSize: 12, whiteSpace: 'nowrap', padding: '2px 9px', borderRadius: 999,
      background: known ? GOOD_BG : '#eeeeec',
      color: known ? GOOD : MUTED,
      overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
      justifySelf: 'start',
    }}>
      Hi {greeting || 'there'},
    </span>
  );
}

function fmtDate(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function SmallButton({ children, onClick, tone = 'plain', disabled = false, title }) {
  const primary = tone === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        font: 'inherit',
        fontSize: 13,
        fontWeight: primary ? 600 : 500,
        color: disabled ? TERTIARY : (primary ? SB.onPrimary : SB.strong),
        background: disabled ? '#f4f4f0' : (primary ? SB.primary : CARD),
        border: `1px solid ${disabled ? BORDER : (primary ? SB.cyanDeep : BORDER)}`,
        borderRadius: 7,
        padding: '8px 13px',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ── One card ─────────────────────────────────────────────────────────────────
//
// The card says three things: how many people, which topic, and whether an
// email has been written for it yet. The Write button sits on the card rather
// than inside the panel so that writing nine emails is nine presses in one
// place, without opening and closing nine panels.
function LaneCard({ label, count, selected, muted, dashed, draft, busy, onSelect, onWrite }) {
  const status = draft
    ? (draft.status === 'approved' ? 'Approved, queued'
      : draft.status === 'sent'    ? 'Already sent'
      : 'Draft ready')
    : (muted ? 'Everyone else' : 'No draft yet');

  const statusColour = draft && draft.status !== 'sent' ? SB.dark : TERTIARY;
  const writeLabel = busy ? 'Writing…' : (draft && draft.status !== 'sent' ? 'Open' : 'Write');

  return (
    <div
      style={{
        background: dashed ? '#fafaf8' : CARD,
        border: selected ? `2px solid ${SB.primary}` : `1px ${dashed ? 'dashed' : 'solid'} ${BORDER}`,
        borderRadius: 10,
        padding: selected ? '11px 13px' : '12px 14px',
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 600, color: muted ? MUTED : TEXT, lineHeight: 1.2 }}>
          {count}
        </div>
        <div style={{ fontSize: 14, color: muted ? MUTED : TEXT, margin: '2px 0 8px' }}>
          {label}
        </div>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: statusColour, fontWeight: draft ? 600 : 400 }}>{status}</span>
        <button
          type="button"
          onClick={onWrite}
          disabled={busy || count === 0}
          title={count === 0 ? 'Nobody is in this lane yet' : undefined}
          style={{
            font: 'inherit', fontSize: 12, fontWeight: 600,
            color: count === 0 ? TERTIARY : (selected ? SB.onPrimary : SB.dark),
            background: count === 0 ? '#f4f4f0' : (selected ? SB.primary : SB.tint),
            border: `1px solid ${count === 0 ? BORDER : (selected ? SB.cyanDeep : SB.light)}`,
            borderRadius: 6,
            padding: '5px 11px',
            cursor: busy || count === 0 ? 'default' : 'pointer',
          }}
        >
          {writeLabel}
        </button>
      </div>
    </div>
  );
}

// ── The draft standing against a lane ────────────────────────────────────────
function LaneDraft({ draft, label, ticked, busy, onOpen, onApprove, onBin, onRewrite }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: SB.dark, background: SB.tint, borderRadius: 999, padding: '3px 10px',
        }}>
          {label}
        </span>
        <span style={{ fontSize: 12, color: TERTIARY }}>
          {draft.status === 'approved' ? 'Approved and waiting in the queue'
            : draft.status === 'sent'  ? 'Already sent'
            : 'Written, not yet approved'}
          {draft.edited ? ' · edited' : ''}
        </span>
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>{draft.subject}</div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 2 }}>
        <SmallButton tone="primary" onClick={onOpen}>Open and edit</SmallButton>
        {draft.status === 'draft' && <SmallButton onClick={onApprove} disabled={busy}>Approve</SmallButton>}
        {draft.status !== 'sent' && <SmallButton onClick={onBin} disabled={busy}>Bin it</SmallButton>}
        {draft.status !== 'sent' && <SmallButton onClick={onRewrite} disabled={busy}>Write another</SmallButton>}
      </div>

      <div style={{ fontSize: 12, color: TERTIARY, lineHeight: 1.6 }}>
        {draft.status === 'sent'
          ? 'This one has gone. Write another to send this lane a different email.'
          : `Approving puts it in the queue. It goes to the ${ticked} ticked ${ticked === 1 ? 'person' : 'people'} in this lane and nobody else.`}
      </div>
    </div>
  );
}

// ── The example websites for a lane ──────────────────────────────────────────
//
// The list Billy keeps himself, rather than a list hardcoded in a file, so a
// site can be added or dropped without asking for a code change.
//
// Two of them go at the foot of every email this lane writes, taken in turn
// from the top of the list, and the link the reader sees is the CLIENT'S NAME
// rather than the address. The panel says which two are next, because the
// rotation is somewhere in the middle of a list shown in the order it was typed
// and "press Write and find out" is not a good answer.
//
// Only shown on lanes that carry examples. Everything else has no box at all
// rather than an empty one.
function ExamplesBox({ laneKey, label }) {
  const [rows, setRows]   = useState(null);
  const [next, setNext]   = useState([]);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/keepwarm/interests/${encodeURIComponent(laneKey)}/examples`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not read the example sites');
      setRows(d.sites || []);
      setNext(d.next || []);
      setError(null);
    } catch (err) {
      setError(err.message);
      setRows([]);
    }
  }, [laneKey]);

  useEffect(() => { setSaved(false); load(); }, [load]);

  function edit(index, field, value) {
    setSaved(false);
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    setSaved(false);
    setRows(prev => [...prev, { name: '', url: '' }]);
  }

  function removeRow(index) {
    setSaved(false);
    setRows(prev => prev.filter((_, i) => i !== index));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/keepwarm/interests/${encodeURIComponent(laneKey)}/examples`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sites: rows.filter(x => (x.name || '').trim() || (x.url || '').trim()) }),
      });
      const d = await r.json();
      // A refused address refuses the whole save and says which one. Nothing is
      // stored, so the box still shows exactly what was typed and the line that
      // needs fixing is still on screen.
      if (!r.ok) throw new Error(d.error || 'Could not save the list');
      setRows(d.sites || []);
      setNext(d.next || []);
      setSaved(true);
    } catch (err) {
      setError(err.message);
      setSaved(false);
    } finally {
      setBusy(false);
    }
  }

  const COLUMNS = '1fr 1.3fr 30px';
  const inputStyle = {
    width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, color: TEXT,
    background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '7px 9px',
  };

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Example sites for this email</span>
        <span style={{ fontSize: 12, color: MUTED }}>
          {next.length
            ? `Next up: ${next.map(s => s.name).join(', ')}`
            : 'No sites saved yet'}
        </span>
      </div>

      <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
        Two of these go at the foot of every {label} email, just above the signature, taken in turn
        so two emails running do not show the same pair. The reader sees the client name and clicks
        it. Studio writes the sentence that introduces them fresh each time. Leave the list empty and
        the email simply has no examples line.
      </div>

      {rows === null
        ? <div style={{ fontSize: 13, color: MUTED }}>Loading…</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLUMNS, gap: 8, fontSize: 12, color: MUTED }}>
              <span>Client name</span>
              <span>Address</span>
              <span />
            </div>

            {rows.map((row, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: COLUMNS, gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  value={row.name || ''}
                  onChange={e => edit(i, 'name', e.target.value)}
                  placeholder="Kent Garage Equipment"
                  style={inputStyle}
                />
                <input
                  type="text"
                  value={row.url || ''}
                  onChange={e => edit(i, 'url', e.target.value)}
                  placeholder="kentgarageequipment.co.uk"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  title="Take this one off the list"
                  style={{
                    font: 'inherit', fontSize: 15, lineHeight: 1, color: TERTIARY,
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                  }}
                >
                  ×
                </button>
              </div>
            ))}

            {rows.length === 0 && (
              <div style={{ fontSize: 13, color: MUTED, padding: '4px 0' }}>
                Nothing on the list yet.
              </div>
            )}
          </div>
        )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <SmallButton onClick={addRow} disabled={rows === null}>Add a site</SmallButton>
        <SmallButton tone="primary" onClick={save} disabled={busy || rows === null}>
          {busy ? 'Saving…' : 'Save list'}
        </SmallButton>
        {saved && <span style={{ fontSize: 12, color: SB.dark }}>Saved.</span>}
      </div>

      {error && (
        <div style={{ fontSize: 13, color: '#A32D2D', lineHeight: 1.6 }}>
          {error} Nothing was saved, so the list on screen is still what you typed.
        </div>
      )}
    </div>
  );
}

// ── One person in the lane ───────────────────────────────────────────────────
function PersonRow({ person, ticked, onToggle, last }) {
  const seen = fmtDate(person.seenAt);
  const dim = !ticked || person.lockedOut;

  return (
    <label
      style={{
        display: 'grid', gridTemplateColumns: ROW_COLUMNS, gap: 10, alignItems: 'center',
        padding: '10px 12px',
        borderBottom: last ? 'none' : `1px solid ${ROW_LINE}`,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={ticked}
        onChange={onToggle}
        disabled={person.lockedOut}
        title={person.lockedOut ? 'Already had a keep-warm email this fortnight' : undefined}
        style={{ width: 17, height: 17, accentColor: SB.primary, margin: 0, cursor: person.lockedOut ? 'not-allowed' : 'pointer' }}
      />
      <span style={{ fontSize: 13, color: dim ? TERTIARY : TEXT, fontStyle: person.contactName ? 'normal' : 'italic' }}>
        {person.contactName || 'no name'}
        {/* Why this row is greyed, in words. A greyed line with no explanation
            reads as a fault; "they are getting Website this time" reads as the
            rotation doing its job. */}
        {!person.sendable && !person.hadOneAt && person.nextTopic && (
          <span style={{ display: 'block', fontSize: 11, color: TERTIARY, marginTop: 2, lineHeight: 1.4 }}>
            Getting {laneLabel(person.nextTopic)} this time
          </span>
        )}
        {person.hadOneAt && (
          <span style={{ display: 'block', fontSize: 11, color: TERTIARY, marginTop: 2, lineHeight: 1.4 }}>
            Already had one this fortnight
          </span>
        )}
      </span>
      <GreetingPill greeting={person.greeting} />
      <span style={{ fontSize: 13, color: dim ? TERTIARY : MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {person.companyName || '—'}
      </span>
      <span style={{ fontSize: 13, color: dim ? TERTIARY : MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {person.email}
      </span>
      {/* Three different things can be true of a row and only one of them can be
          shown, so they are ordered by what stops a send. Already had an email
          this fortnight is the one that cannot be overridden, so it wins. */}
      <span style={{
        fontSize: 12,
        color: person.lockedOut ? '#854F0B' : (seen ? MUTED : SB.dark),
        background: person.lockedOut ? '#FBF3E4' : (seen ? '#f2f2ee' : SB.tint),
        borderRadius: 999, padding: '3px 9px', justifySelf: 'start',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
      }}>
        {person.hadOneAt
          ? `Had one ${fmtDate(person.hadOneAt) || 'this fortnight'}`
          : seen
            ? `Had this ${seen}`
            : !person.sendable
              ? `${laneLabel(person.nextTopic)} first`
              : (person.stageLabel || 'No stage')}
      </span>
    </label>
  );
}

// ── The panel under the cards ────────────────────────────────────────────────
export default function KeepWarmLanes({ selected, onSelect, onOpenDraft, onDraftsChanged }) {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [showAll, setShowAll] = useState(false);

  const [people, setPeople]   = useState(null);
  const [search, setSearch]   = useState('');
  const [unticked, setUnticked] = useState(() => new Set());
  const [busy, setBusy]       = useState(false);
  const [writing, setWriting] = useState(null);
  const [note, setNote]       = useState(null);

  // The lane the ticks on screen belong to. Without this, switching from
  // Microsoft 365 to Website for a moment before the new list arrives would
  // apply Microsoft 365's ticks to Website's people.
  const ticksFor = useRef(null);

  const draft = selected ? (data?.drafts?.[selected] || null) : null;
  const draftId = draft && draft.status !== 'sent' ? draft.id : null;

  const loadCounts = useCallback(async () => {
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

  useEffect(() => { loadCounts(); }, [loadCounts]);

  // The people in the open lane. Re-read whenever the lane, the search or the
  // draft changes, because the draft is where the ticks are stored.
  useEffect(() => {
    if (!selected) { setPeople(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const q = encodeURIComponent(search || '');
        const d = draftId ? `&draftId=${encodeURIComponent(draftId)}` : '';
        const r = await fetch(`/api/keepwarm/interests/${encodeURIComponent(selected)}/people?q=${q}${d}`);
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(body.error || 'Could not load this lane');
        setPeople(body);
        // The server is the authority on who is ticked, so the screen takes its
        // answer rather than keeping its own running total across lanes.
        if (ticksFor.current !== `${selected}:${draftId || ''}`) {
          setUnticked(new Set(body.rows.filter(p => !p.ticked).map(p => p.email.toLowerCase())));
          ticksFor.current = `${selected}:${draftId || ''}`;
        }
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }, search ? 220 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [selected, search, draftId]);

  // Save the ticks against the draft. Only possible once a draft exists — until
  // then the ticks are held on screen and written the moment one does.
  const saveTicks = useCallback(async (id, set) => {
    if (!id) return;
    try {
      await fetch(`/api/keepwarm/drafts/${id}/recipients`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip: Array.from(set) }),
      });
    } catch { /* the ticks stay on screen; the next change tries again */ }
  }, []);

  const toggleOne = useCallback((email) => {
    const e = String(email || '').toLowerCase();
    setUnticked(prev => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e); else next.add(e);
      saveTicks(draftId, next);
      return next;
    });
  }, [draftId, saveTicks]);

  // Tick all and untick all work on the whole lane, not on the rows a search
  // happens to be showing. "Untick all" while three rows are filtered must mean
  // everybody, or it quietly sends to the ones that scrolled out of view.
  const tickAll = useCallback(() => {
    // Everybody who can actually receive it. Somebody who has had their one
    // email this fortnight stays unticked, because ticking them would show a
    // tick beside a person the send is going to skip anyway.
    const next = new Set(
      (people?.rows || []).filter(p => !p.sendable || p.hadOneAt).map(p => String(p.email).toLowerCase()),
    );
    setUnticked(next);
    saveTicks(draftId, next);
  }, [draftId, saveTicks, people]);

  const untickAll = useCallback(async () => {
    if (!selected) return;
    try {
      const r = await fetch(`/api/keepwarm/interests/${encodeURIComponent(selected)}/people`);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Could not read the lane');
      const next = new Set(body.rows.map(p => p.email.toLowerCase()));
      setUnticked(next);
      saveTicks(draftId, next);
    } catch (err) {
      setError(err.message);
    }
  }, [selected, draftId, saveTicks]);

  async function write(key) {
    setWriting(key);
    setNote(null);
    setError(null);
    try {
      const r = await fetch(`/api/keepwarm/interests/${encodeURIComponent(key)}/generate`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not write this one');
      await loadCounts();
      // Whatever was unticked on screen before the draft existed now has
      // somewhere to be stored.
      if (d.draftId) await saveTicks(d.draftId, unticked);
      ticksFor.current = null;
      if (onDraftsChanged) onDraftsChanged();
      setNote(`Written. Open it to read it before approving.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setWriting(null);
    }
  }

  async function setStatus(id, status) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/keepwarm/drafts/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not update this one');
      await loadCounts();
      if (onDraftsChanged) onDraftsChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleCardPress(key) {
    setSearch('');
    setNote(null);
    onSelect(selected === key ? null : key);
  }

  function handleWrite(key) {
    const existing = data?.drafts?.[key];
    if (existing && existing.status !== 'sent') {
      // A lane that already has a draft opens it rather than quietly writing a
      // second one nobody asked for.
      if (selected !== key) onSelect(key);
      if (onOpenDraft) onOpenDraft(existing.id);
      return;
    }
    if (selected !== key) onSelect(key);
    write(key);
  }

  if (error && !data) {
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
  // nine zeroes, because nine zeroes look like a bug in Studio when they are
  // actually a bridge that has not been switched on yet.
  const neverReceived = !data.everReceived;

  const currentLabel = selected === '__none'
    ? 'General IT support'
    : (keys.find(k => k.key === selected)?.label || selected);

  const laneTotal = people?.total ?? 0;
  const laneAvailable = people?.available ?? 0;
  // Only the people this send can actually reach count towards the tick total.
  const tickedCount = Math.max(0, laneAvailable - unticked.size);

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '16px 18px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: TEXT, margin: 0 }}>Send by service interest</h3>
        <span style={{ fontSize: 13, color: MUTED }}>{data.audienceTotal} in the loop</span>
      </div>

      <p style={{ fontSize: 13, color: MUTED, margin: '6px 0 14px', lineHeight: 1.6 }}>
        {neverReceived
          ? 'WorkTrackr has not sent any service interests yet, so everybody is on the General IT support card. The tags are ticked on a company in WorkTrackr and arrive with the sales stages.'
          : 'Press Write on a card and Studio writes an email about that one service. It goes to the ticked people in that card and nobody else.'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {shown.map(({ key, label }) => (
          <LaneCard
            key={key}
            label={label}
            count={data.counts?.[key] ?? 0}
            selected={selected === key}
            draft={data.drafts?.[key] || null}
            busy={writing === key}
            onSelect={() => handleCardPress(key)}
            onWrite={() => handleWrite(key)}
          />
        ))}

        {/* The general email. Named for what it is rather than for what these
            people lack: it covers every Sweetbyte service, it is where anybody
            with nothing ticked belongs, and since IT support was merged in it is
            also where a company ticked only for IT support lands. */}
        <LaneCard
          label="General IT support"
          count={data.none ?? 0}
          selected={selected === '__none'}
          muted
          dashed
          draft={data.drafts?.__none || null}
          busy={writing === '__none'}
          onSelect={() => handleCardPress('__none')}
          onWrite={() => handleWrite('__none')}
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

      {error && (
        <p style={{ fontSize: 13, color: '#A32D2D', margin: '12px 0 0', lineHeight: 1.6 }}>{error}</p>
      )}

      {selected && (
        <div style={{ border: `1px solid ${SB.light}`, background: '#FBFDFE', borderRadius: 10, padding: '14px 16px', marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>
                {currentLabel} — {laneAvailable} {laneAvailable === 1 ? 'person' : 'people'} this time
                {laneTotal !== laneAvailable && (
                  <span style={{ fontWeight: 400, fontSize: 13, color: MUTED }}>
                    {' '}· {laneTotal} ticked for it altogether
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
                {tickedCount} ticked for the next send. Unticking somebody skips this send only — it does not
                remove them from the loop or change what they are interested in.
              </div>
              {people && (people.heldBack > 0 || people.elsewhere > 0) && (
                <div style={{ fontSize: 12, color: '#854F0B', marginTop: 4, lineHeight: 1.6 }}>
                  {people.elsewhere > 0 && (
                    <div>
                      {people.elsewhere} of them are ticked for this as well, but another of their topics comes
                      first this time, so they are not on this send. They will come round to this one.
                    </div>
                  )}
                  {people.heldBack > 0 && (
                    <div>
                      {people.heldBack} already had a keep-warm email this fortnight, so this send passes them
                      over. Nobody gets two in a fortnight.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <SmallButton onClick={tickAll}>Tick all {laneAvailable}</SmallButton>
              <SmallButton onClick={untickAll}>Untick all</SmallButton>
            </div>
          </div>

          {note && <div style={{ fontSize: 13, color: SB.dark }}>{note}</div>}

          {/* Website only for now. The list is stored per lane on the server, so
              switching Custom apps on later is a key on a list and not a
              rebuild — this line is the only thing the screen needs to know. */}
          {LANES_WITH_EXAMPLES.includes(selected) && (
            <ExamplesBox laneKey={selected} label={currentLabel} />
          )}

          {draft
            ? (
              <LaneDraft
                draft={draft}
                label={currentLabel}
                ticked={tickedCount}
                busy={busy}
                onOpen={() => onOpenDraft && onOpenDraft(draft.id)}
                onApprove={() => setStatus(draft.id, 'approved')}
                onBin={() => setStatus(draft.id, 'rejected')}
                onRewrite={() => write(selected)}
              />
            )
            : (
              <div style={{ background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: '14px 16px', fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
                No email written for {currentLabel} yet. Press Write on the card above and Studio writes one about
                this service, in the usual shape.
              </div>
            )}

          <label style={{ display: 'block' }}>
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Search the people in this lane
            </span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, company or address"
              style={{
                width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, color: TEXT,
                background: CARD, border: `1px solid ${BORDER}`, borderRadius: 7, padding: '9px 11px',
              }}
            />
          </label>

          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: ROW_COLUMNS, gap: 10, alignItems: 'center',
              padding: '9px 12px', background: '#fafaf8', borderBottom: `1px solid ${BORDER}`,
              fontSize: 12, color: MUTED,
            }}>
              <span />
              <span>Name</span>
              <span>Opens with</span>
              <span>Company</span>
              <span>Email</span>
              <span>Stage</span>
            </div>

            <div style={{ maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto' }}>
              {!people && (
                <div style={{ padding: '14px 12px', fontSize: 13, color: MUTED }}>Loading…</div>
              )}
              {people && people.rows.length === 0 && (
                <div style={{ padding: '14px 12px', fontSize: 13, color: MUTED }}>
                  {search ? 'Nobody in this lane matches that.' : 'Nobody is due this topic at the moment.'}
                </div>
              )}
              {people && people.rows.map((p, i) => (
                <PersonRow
                  key={p.email}
                  person={p}
                  ticked={!unticked.has(String(p.email).toLowerCase())}
                  onToggle={() => toggleOne(p.email)}
                  last={i === people.rows.length - 1}
                />
              ))}
            </div>
          </div>

          <div style={{ fontSize: 12, color: TERTIARY, lineHeight: 1.6 }}>
            {people && people.shown < people.total
              ? `Showing ${people.shown} of ${people.total}. `
              : ''}
            "Opens with" is the exact greeting each person will see; a company with nobody named against it
            opens "Hi there," — correct rather than a fault. Everybody ticked for this service is listed, but
            only the people whose turn it is are ticked: somebody due another of their topics this fortnight
            says so on their row and comes round to this one next time. The order topics are worked through is
            fixed and does not depend on which card you send first. The stage rule still applies — this list can
            only ever narrow, never add anybody back in.
          </div>
        </div>
      )}
    </div>
  );
}
