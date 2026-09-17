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

// Every card is shown. They used to fold away after six, from when they were
// taller: a "Show all 8" button under two rows of compact cards hid less than
// it cost to understand.

// The list scrolls rather than growing the page. A lane of a hundred people
// would otherwise push the tabs and everything below them off the screen.
const LIST_MAX_HEIGHT = 300;

// The lane labels, for naming the topic somebody has gone to instead. Keys are
// permanent, which is what makes a local copy safe; an unrecognised one falls
// back to the key rather than blanking the line.
// The lanes a topic can be set to by hand, in the order they are worked
// through. Kept in step with INTEREST_KEYS on the server, which is the one that
// decides; an unknown key is refused there rather than stored.
const INTEREST_ORDER = [
  'cyber_security', 'internet', 'wifi', 'website',
  'domains', 'microsoft_365', 'voip', 'custom_apps',
];

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

const ROW_COLUMNS = '34px minmax(0, 0.9fr) 120px minmax(0, 1.1fr) minmax(0, 1.3fr) 118px 62px';

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

// ── One tab ──────────────────────────────────────────────────────────────────
//
// The lane panel does three separate jobs — read the email, check who it is
// going to, keep the examples list — and doing all three in one column is what
// made the screen feel cramped. One at a time, with the count on the tab so
// nothing is hidden, only set aside.
function Tab({ children, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        font: 'inherit', fontSize: 13, fontWeight: active ? 600 : 400,
        color: active ? TEXT : MUTED,
        background: 'none', border: 'none',
        borderBottom: `2px solid ${active ? SB.primary : 'transparent'}`,
        padding: '11px 13px', marginBottom: -1, cursor: 'pointer',
      }}
    >
      {children}
      {count !== undefined && count !== null && (
        <span style={{ marginLeft: 7, fontSize: 12, fontWeight: 400, color: TERTIARY }}>{count}</span>
      )}
    </button>
  );
}

// ── Small print, folded away ─────────────────────────────────────────────────
//
// The rules about rotation and stages are worth reading once and in the way
// while you are working. Kept in full, closed by default.
function Disclosure({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          font: 'inherit', fontSize: 12, color: SB.strong, background: 'none',
          border: 'none', padding: 0, cursor: 'pointer',
        }}
      >
        {open ? '▾' : '▸'} {title}
      </button>
      {open && (
        <div style={{ fontSize: 12, color: TERTIARY, lineHeight: 1.7, marginTop: 8 }}>{children}</div>
      )}
    </div>
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
function ExamplesBox({ laneKey, label, reloadKey, onMeta }) {
  const [rows, setRows]   = useState(null);
  const [next, setNext]   = useState([]);
  const [meta, setMeta]   = useState(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  // Something has been typed into the box and not saved yet. Writing an email
  // moves the rotation on, so the box re-reads itself afterwards to keep "next
  // up" honest — but not while there is half-typed work in it, because
  // refreshing that away would lose an address somebody was in the middle of.
  const [dirty, setDirty] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/keepwarm/interests/${encodeURIComponent(laneKey)}/examples`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not read the examples');
      setMeta(d);
      // The panel needs this to decide whether to draw the tab at all, and what
      // number to put on it.
      if (onMeta) onMeta(d);
      setRows(d.sites || []);
      setNext(d.next || []);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err.message);
      setMeta(null);
      setRows([]);
    }
  }, [laneKey]);

  useEffect(() => { setSaved(false); load(); }, [load]);

  // An email has just been written for this lane, so the pair it took is gone
  // and "next up" is a pair behind. Re-read, unless the box is mid-edit.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    if (!dirty) load();
    // `dirty` is deliberately not a dependency: this runs when an email is
    // written, not every time a character is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, load]);

  function edit(index, field, value) {
    setSaved(false);
    setDirty(true);
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    setSaved(false);
    setDirty(true);
    setRows(prev => [...prev, { name: '', url: '' }]);
  }

  function removeRow(index) {
    setSaved(false);
    setDirty(true);
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
      setMeta(d);
      if (onMeta) onMeta(d);
      setRows(d.sites || []);
      setNext(d.next || []);
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err.message);
      setSaved(false);
    } finally {
      setBusy(false);
    }
  }

  // A lane that carries no examples draws no box at all, rather than an empty
  // one explaining what it does not do.
  if (!meta || !meta.supported) return null;

  const noun = meta.noun === 'apps' ? 'apps' : 'sites';

  // How short the list can get before an email starts repeating the one before
  // it. Two go in each email and the list is walked two at a time without ever
  // resetting, so four or more never repeats. Three cannot avoid it — two
  // different pairs out of three must share one — and two gives the same pair
  // every time. Said here rather than silently allowed, because a repeat is
  // only visible a fortnight later in somebody's inbox.
  const onList = (rows || []).filter(x => (x.name || '').trim() && (x.url || '').trim()).length;
  const tooFew = onList > 0 && onList < meta.perEmail * 2;
  const COLUMNS = '1fr 1.3fr 30px';
  const inputStyle = {
    width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, color: TEXT,
    background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '7px 9px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: MUTED }}>
          {next.length
            ? `Next up: ${next.map(s => s.name).join(', ')}`
            : `No ${noun} saved yet`}
        </span>
      </div>

      <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
        Two of these go at the foot of every {label} email, just above the signature, taken in turn
        so two emails running do not show the same pair. The reader sees the client name and clicks
        it. Studio writes the sentence that introduces them fresh each time, in words that suit this
        lane. Leave the list empty and the email simply has no examples line.
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
                Nothing on the list yet, so this email will have no examples line.
              </div>
            )}
          </div>
        )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <SmallButton onClick={addRow} disabled={rows === null}>
          {noun === 'apps' ? 'Add an app' : 'Add a site'}
        </SmallButton>
        <SmallButton tone="primary" onClick={save} disabled={busy || rows === null}>
          {busy ? 'Saving…' : 'Save list'}
        </SmallButton>
        {saved && <span style={{ fontSize: 12, color: SB.dark }}>Saved.</span>}
      </div>

      {tooFew && (
        <div style={{ fontSize: 12, color: '#854F0B', background: '#FBF3E4', borderRadius: 6, padding: '8px 10px', lineHeight: 1.6 }}>
          {onList === 1
            ? `Only one on the list, so every email shows the same one. Save ${meta.perEmail * 2} or more and no email repeats the one before it.`
            : `Only ${onList} on the list, so emails will share one with the email before them. Save ${meta.perEmail * 2} or more and that stops.`}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 13, color: '#A32D2D', lineHeight: 1.6 }}>
          {error} Nothing was saved, so the list on screen is still what you typed.
        </div>
      )}
    </div>
  );
}

// ── One person in the lane ───────────────────────────────────────────────────
function PersonRow({ person, ticked, onToggle, last, onChanged }) {
  const seen = fmtDate(person.seenAt);
  const dim = !ticked || person.lockedOut;
  const [open, setOpen] = useState(false);

  return (
    <div style={{ borderBottom: last && !open ? 'none' : `1px solid ${ROW_LINE}` }}>
    <label
      style={{
        display: 'grid', gridTemplateColumns: ROW_COLUMNS, gap: 10, alignItems: 'center',
        padding: '10px 12px',
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

      {/* Inside the label, so the button has to say plainly that it is not a
          tick. Without both of these, opening the topics panel would also tick
          or untick the person, which is the last thing you want on a screen
          that decides who gets emailed. */}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v); }}
        title="Set what this person is interested in"
        style={{
          font: 'inherit', fontSize: 12,
          color: (person.handSet || []).length ? SB.dark : TERTIARY,
          background: (person.handSet || []).length ? SB.tint : 'none',
          border: `1px solid ${(person.handSet || []).length ? SB.light : BORDER}`,
          borderRadius: 6, padding: '3px 8px', cursor: 'pointer', justifySelf: 'start',
        }}
      >
        {open ? 'Close' : 'Topics'}
      </button>
    </label>

    {open && <TopicsPanel person={person} onChanged={onChanged} />}
    </div>
  );
}

// ── What one person is interested in ─────────────────────────────────────────
//
// Two lists, never merged on screen: what WorkTrackr says, and what has been
// set here by hand. Shown side by side because the one thing that must never
// happen is Studio quietly disagreeing with the CRM and neither screen saying
// so.
//
// Ticking a topic here ADDS it. It does not cancel anything WorkTrackr says,
// and it is kept where a push cannot overwrite it. Nothing is sent back to
// WorkTrackr — the link only runs one way, and a chip over there belongs to the
// whole company while this belongs to one person.
function TopicsPanel({ person, onChanged }) {
  const fromWorkTrackr = person.fromWorkTrackr || [];
  const [handSet, setHandSet] = useState(() => new Set(person.handSet || []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(next) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/keepwarm/people/${encodeURIComponent(person.email)}/interests`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interests: Array.from(next) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save that');
      setHandSet(new Set(d.interests || []));
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
      setHandSet(new Set(person.handSet || []));
    } finally {
      setBusy(false);
    }
  }

  function toggle(key) {
    const next = new Set(handSet);
    if (next.has(key)) next.delete(key); else next.add(key);
    setHandSet(next);
    save(next);
  }

  return (
    <div style={{ background: '#FBFDFE', padding: '12px 14px 14px 46px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
        WorkTrackr says: <span style={{ color: TEXT }}>
          {fromWorkTrackr.length ? fromWorkTrackr.map(laneLabel).join(', ') : 'nothing ticked'}
        </span>. Ticking here adds a topic for this person only. It is kept in Studio and is never
        sent back to WorkTrackr.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {INTEREST_ORDER.map(key => {
          const fromCrm = fromWorkTrackr.includes(key);
          const byHand = handSet.has(key);
          return (
            <button
              key={key}
              type="button"
              disabled={busy || fromCrm}
              onClick={() => toggle(key)}
              title={fromCrm ? 'Already ticked in WorkTrackr' : undefined}
              style={{
                font: 'inherit', fontSize: 12,
                color: fromCrm ? MUTED : (byHand ? SB.onPrimary : SB.strong),
                background: fromCrm ? '#f2f2ee' : (byHand ? SB.primary : CARD),
                border: `1px solid ${fromCrm ? BORDER : (byHand ? SB.cyanDeep : BORDER)}`,
                borderRadius: 999, padding: '4px 11px',
                cursor: fromCrm || busy ? 'default' : 'pointer',
              }}
            >
              {laneLabel(key)}{fromCrm ? ' · in WorkTrackr' : ''}
            </button>
          );
        })}
      </div>

      {handSet.size > 0 && (
        <div>
          <SmallButton onClick={() => { setHandSet(new Set()); save(new Set()); }} disabled={busy}>
            Put back to what WorkTrackr says
          </SmallButton>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: '#A32D2D', lineHeight: 1.6 }}>{error}</div>}
    </div>
  );
}

// ── The panel under the cards ────────────────────────────────────────────────
export default function KeepWarmLanes({ selected, onSelect, onOpenDraft, onDraftsChanged }) {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);

  const [people, setPeople]   = useState(null);
  const [search, setSearch]   = useState('');
  const [unticked, setUnticked] = useState(() => new Set());
  const [busy, setBusy]       = useState(false);
  const [writing, setWriting] = useState(null);
  const [note, setNote]       = useState(null);
  // Counts the emails written in this session. Nothing reads the number; it
  // exists so the examples box knows an email has just been written and its
  // "next up" pair has moved on.
  const [written, setWritten] = useState(0);

  // Which of the panel's three jobs is on screen. Opens on the email, because
  // that is the thing you act on; the other two keep their counts on the tab so
  // nothing is out of sight without saying so.
  const [tab, setTab] = useState('email');
  // What the examples box found for this lane. The panel cannot know whether a
  // lane carries examples without asking, and the box is the thing that asks.
  const [examplesMeta, setExamplesMeta] = useState(null);
  // Bumped when a topic is set by hand. The lane's membership changes the
  // moment that happens — somebody can join this lane, or be pushed into
  // another one — so the list and the counts are both re-read rather than left
  // showing what was true before the change.
  const [refreshTick, setRefreshTick] = useState(0);

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

  // A new lane is a new set of three jobs. Back to the email, and forget what
  // the last lane's examples box said — otherwise a lane that carries no
  // examples would briefly show the previous lane's tab.
  useEffect(() => { setTab('email'); setExamplesMeta(null); }, [selected]);

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
  }, [selected, search, draftId, refreshTick]);

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
      setWritten(n => n + 1);
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

  const examplesTab = examplesMeta && examplesMeta.supported ? examplesMeta : null;
  const showTab = examplesTab || tab !== 'examples' ? tab : 'email';

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

      {/* Every card, all the time. They are compact enough now that folding
          five of them behind a button hid less than the button cost. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))', gap: 10 }}>
        {keys.map(({ key, label }) => (
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

      {error && (
        <p style={{ fontSize: 13, color: '#A32D2D', margin: '12px 0 0', lineHeight: 1.6 }}>{error}</p>
      )}

      {selected && (
        <div style={{ border: `1px solid ${SB.light}`, background: CARD, borderRadius: 10, marginTop: 14, overflow: 'hidden' }}>

          {/* The header stays put whichever tab is open, so the numbers that
              decide whether to send are never the thing you have to go and
              look for. */}
          <div style={{ background: '#FBFDFE', borderBottom: `1px solid ${SB.light}`, padding: '13px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: TEXT }}>{currentLabel}</div>
                <div style={{ fontSize: 13, color: MUTED, marginTop: 3 }}>
                  {laneAvailable} {laneAvailable === 1 ? 'person' : 'people'} this time
                  {' · '}{tickedCount} ticked
                  {laneTotal !== laneAvailable && ` · ${laneTotal} ticked for it altogether`}
                </div>
              </div>
              {note && <div style={{ fontSize: 13, color: SB.dark }}>{note}</div>}
            </div>

            {people && (people.heldBack > 0 || people.elsewhere > 0) && (
              <div style={{ fontSize: 12, color: '#854F0B', background: '#FBF3E4', borderRadius: 7, padding: '8px 10px', marginTop: 10, lineHeight: 1.6 }}>
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

          <div style={{ display: 'flex', gap: 2, padding: '0 10px', borderBottom: `1px solid ${BORDER}` }}>
            <Tab active={showTab === 'email'} onClick={() => setTab('email')}>The email</Tab>
            <Tab active={showTab === 'people'} onClick={() => setTab('people')} count={laneAvailable}>
              Who it goes to
            </Tab>
            {examplesTab && (
              <Tab active={showTab === 'examples'} onClick={() => setTab('examples')} count={examplesTab.sites.length}>
                {examplesTab.heading.replace(' for this email', '')}
              </Tab>
            )}
          </div>

          <div style={{ padding: '16px' }}>

            <div style={{ display: showTab === 'email' ? 'block' : 'none' }}>
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
            </div>

            <div style={{ display: showTab === 'people' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6, flex: '1 1 260px' }}>
                  Unticking somebody skips this send only — it does not remove them from the loop or change what
                  they are interested in.
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <SmallButton onClick={tickAll}>Tick all {laneAvailable}</SmallButton>
                  <SmallButton onClick={untickAll}>Untick all</SmallButton>
                </div>
              </div>

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
                      onChanged={() => { loadCounts(); setRefreshTick(v => v + 1); }}
                    />
                  ))}
                </div>
              </div>

              <Disclosure title="How this lane decides who gets what">
                {people && people.shown < people.total
                  ? `Showing ${people.shown} of ${people.total}. `
                  : ''}
                "Opens with" is the exact greeting each person will see; a company with nobody named against it
                opens "Hi there," — correct rather than a fault. Everybody ticked for this service is listed, but
                only the people whose turn it is are ticked: somebody due another of their topics this fortnight
                says so on their row and comes round to this one next time. The order topics are worked through is
                fixed and does not depend on which card you send first. The stage rule still applies — this list can
                only ever narrow, never add anybody back in.
              </Disclosure>
            </div>

            {/* Always mounted, hidden when another tab is open. It is the thing
                that knows whether this lane carries examples at all, so the tab
                above cannot be drawn until it has asked — and keeping it mounted
                means a half-typed address survives a look at the people list. */}
            <div style={{ display: showTab === 'examples' ? 'block' : 'none' }}>
              <ExamplesBox
                laneKey={selected}
                label={currentLabel}
                reloadKey={written}
                onMeta={setExamplesMeta}
              />
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
