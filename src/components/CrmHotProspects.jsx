// ─────────────────────────────────────────────────────────────────────────────
// CrmHotProspects.jsx — Admin CRM screen for per-customer Hot Prospects.
//
// Mounted by Dashboard.jsx when activeView === 'crm-hot-prospects'.
//
// Layout, top to bottom:
//   - Page heading "Hot prospects" + currently-selected customer in the
//     strap-line.
//   - Customer-switcher badges row. Selected = solid green pill; others =
//     outlined white. Each badge shows initials + name + prospect-count.
//     The selected customer id is persisted in localStorage so the operator
//     returns to the last-viewed customer.
//   - Search input.
//   - Prospect list table. Click a row → detail modal.
//
// Detail modal:
//   - Header (initials avatar, name, email, "Remove from list" button)
//   - Editable follow-up date (debounced 1s auto-save, Clear button)
//   - Editable notes textarea (debounced 1s auto-save)
//   - Email history thread, built live from email_replies + email_outbound
//     by the /:id/thread endpoint. Inbound and outbound messages tagged with
//     a direction icon and sorted oldest-first.
//
// All endpoints under /api/email/hot-prospects/* and behind the standard
// admin Bearer-token middleware (handled by App.jsx's fetch interceptor).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import { SB } from '../brand.js';

// Theme — matches PortalAdmin.jsx exactly so the section feels native.
const GREEN     = SB.primary;
const GREEN_HI  = SB.strong;
const GREEN_BG  = SB.tint;
const TEXT      = '#1a1a1a';
const MUTED     = '#666';
const TERTIARY  = '#999';
const BORDER    = '#e0e0dc';
const BG        = '#f5f5f3';
const CARD      = '#ffffff';
const BLUE      = '#185FA5';
const BLUE_BG   = '#E6F1FB';
const AMBER     = '#854F0B';
const AMBER_BG  = '#FAEEDA';
const DANGER    = '#A32D2D';
const DANGER_BG = '#FCEBEB';

// localStorage key for the last-selected customer id. Scoped so a future
// CRM screen with a different table doesn't collide.
const LAST_CUSTOMER_KEY = 'studio.crm.hot_prospects.last_customer_id';
// One-shot key set by other screens (currently EmailSection.jsx's "Open in
// CRM" link in the Send-to-Hot-Prospects banner). We read it on mount,
// auto-open the matching prospect's detail modal, then clear the key so
// subsequent visits to the CRM screen don't repeatedly auto-open it.
const OPEN_PROSPECT_KEY = 'studio.crm.hot_prospects.open_prospect_id';

// ── Status + tag-colour helpers ──────────────────────────────────────────────
// Shared with the customer portal — see PortalApp.jsx for the mirror.
// Three fixed pipeline statuses; bounded palette of 8 colours for the
// customer-chosen override. Free hex was considered and rejected because
// nothing prevents an operator picking an unreadable colour pair.

const STATUS_OPTIONS = [
  { value: 'new',         label: 'New',         bg: '#E6F1FB', fg: '#0C447C' },
  { value: 'contacted',   label: 'Contacted',   bg: SB.tint, fg: SB.strong },
  { value: 'no_response', label: 'No response', bg: '#F1EFE8', fg: '#5F5E5A' },
];

// Bounded palette. The empty 'value: null' entry is the "no override" option
// in the colour picker — the row falls back to its status colour. All bg/fg
// pairs are tested for readability (4.5+ contrast).
const TAG_COLORS = [
  { value: null,     label: 'Default',  bg: null,      fg: null      },
  { value: 'red',    label: 'Red',      bg: '#FAECE7', fg: '#793F1F' },
  { value: 'orange', label: 'Orange',   bg: '#FAEEDA', fg: '#854F0B' },
  { value: 'yellow', label: 'Yellow',   bg: '#FFF7C2', fg: '#5C4A05' },
  { value: 'green',  label: 'Green',    bg: SB.tint, fg: SB.strong },
  { value: 'blue',   label: 'Blue',     bg: '#E6F1FB', fg: '#0C447C' },
  { value: 'purple', label: 'Purple',   bg: '#EEEDFE', fg: '#3C3489' },
  { value: 'pink',   label: 'Pink',     bg: '#FCE7F2', fg: '#83215E' },
  { value: 'grey',   label: 'Grey',     bg: '#EAEAE6', fg: '#3a3a3a' },
];

// Resolve the colour pair to use for a prospect's row tint / status pill.
// Custom tag_color wins when set; otherwise fall back to the status default.
// Returns { bg, fg, statusLabel } — bg/fg are the colours to paint the pill
// (or row tint), statusLabel is always the status label so the pill text is
// stable regardless of which colour palette we picked.
function resolveProspectChrome(prospect) {
  const statusEntry = STATUS_OPTIONS.find(s => s.value === (prospect?.status || 'new')) || STATUS_OPTIONS[0];
  if (prospect?.tag_color) {
    const colorEntry = TAG_COLORS.find(c => c.value === prospect.tag_color);
    if (colorEntry && colorEntry.bg) {
      return { bg: colorEntry.bg, fg: colorEntry.fg, statusLabel: statusEntry.label };
    }
  }
  return { bg: statusEntry.bg, fg: statusEntry.fg, statusLabel: statusEntry.label };
}

// ── Small visual helpers ─────────────────────────────────────────────────────

function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Stable pastel palette for avatar backgrounds. Same name → same colour.
const AVATAR_PALETTE = [
  { bg: SB.tint, fg: SB.dark },
  { bg: '#FAECE7', fg: '#712B13' },
  { bg: '#EEEDFE', fg: '#3C3489' },
  { bg: '#FBEAF0', fg: '#72243E' },
  { bg: '#E6F1FB', fg: '#0C447C' },
  { bg: '#FAEEDA', fg: '#633806' },
  { bg: '#EAF3DE', fg: '#27500A' },
];
function avatarColor(seed) {
  if (!seed) return AVATAR_PALETTE[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// Relative time helper. ISO-ish 'YYYY-MM-DD HH:MM:SS' (SQLite's
// datetime('now') format) is treated as UTC — append 'Z' before parsing.
// Browsers otherwise parse the space-format as local time and the "added"
// column reads in the wrong timezone.
function relativeTime(value) {
  if (!value) return '';
  let parsed = value;
  if (typeof parsed === 'string' && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(parsed)) {
    parsed = parsed.replace(' ', 'T') + 'Z';
  }
  const d = new Date(parsed);
  if (isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)       return 'just now';
  if (diff < 3600)     return `${Math.floor(diff/60)} min ago`;
  if (diff < 86400)    return `${Math.floor(diff/3600)} hour${Math.floor(diff/3600)===1?'':'s'} ago`;
  if (diff < 86400*7)  return `${Math.floor(diff/86400)} day${Math.floor(diff/86400)===1?'':'s'} ago`;
  if (diff < 86400*30) return `${Math.floor(diff/86400/7)} week${Math.floor(diff/86400/7)===1?'':'s'} ago`;
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

// Format a 'YYYY-MM-DD' follow-up date with today/overdue colouring.
function formatFollowUp(value) {
  if (!value) return { label: 'Not set', color: TERTIARY, urgent: false };
  // Parse as local-midnight so timezone slop doesn't shift the day.
  const d = new Date(value + 'T00:00:00');
  if (isNaN(d.getTime())) return { label: value, color: TEXT, urgent: false };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((d - today) / 86400000);
  if (days < 0)  return { label: `${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue`, color: DANGER, urgent: true };
  if (days === 0) return { label: 'Today',    color: AMBER, urgent: true };
  if (days === 1) return { label: 'Tomorrow', color: AMBER, urgent: true };
  if (days <= 7)  return { label: d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }), color: TEXT, urgent: false };
  return { label: d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }), color: TEXT, urgent: false };
}

// ── Top-level screen ────────────────────────────────────────────────────────

export default function CrmHotProspects() {
  const [customers, setCustomers] = useState(null);   // null = loading, [] = none, [...] = list
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [prospects, setProspects] = useState(null);   // null = loading, [] = none
  const [hasLinkedInboxes, setHasLinkedInboxes] = useState(false); // server signal: show Inbox column?
  // Sidebar/top-panel due counts — total across all customers. Refreshed
  // alongside the prospect list and any mutation in the detail modal so
  // marking-as-converted updates the panel without a page refresh.
  const [dueCounts, setDueCounts] = useState({ overdue: 0, due_today: 0, total: 0 });
  const [search, setSearch] = useState('');
  const [openProspectId, setOpenProspectId] = useState(null);
  const [error, setError] = useState(null);

  // Load the customer roster once on mount. Restore last-selected customer
  // from localStorage if present, otherwise pick the first one. Also handle
  // the one-shot OPEN_PROSPECT_KEY — if set by another screen (e.g.
  // EmailSection's "Open in CRM" link) we auto-open that prospect's detail
  // modal and clear the key so it only triggers once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/email/hot-prospects/customers');
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok || d.error) { setError(d.error || `HTTP ${r.status}`); setCustomers([]); return; }
        const list = d.customers || [];
        setCustomers(list);
        // Fire the due-counts fetch in parallel — independent of the
        // customer-roster fetch above, so a slow roster query doesn't hold
        // up the panel. Failure silently leaves dueCounts at zero.
        fetchDueCounts();
        if (list.length === 0) return;
        const stored = localStorage.getItem(LAST_CUSTOMER_KEY);
        const found  = stored && list.find(c => c.id === stored);
        setSelectedCustomerId(found ? stored : list[0].id);

        // Consume the one-shot open-prospect handoff. Clear the key as soon
        // as we read it so a later navigation back to this screen doesn't
        // re-open the same prospect.
        try {
          const openId = localStorage.getItem(OPEN_PROSPECT_KEY);
          if (openId) {
            localStorage.removeItem(OPEN_PROSPECT_KEY);
            setOpenProspectId(openId);
          }
        } catch {}
      } catch (e) {
        if (!cancelled) { setError(String(e.message || e)); setCustomers([]); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the global due-counts (overdue + today) used by the top panel.
  // Same endpoint feeds the sidebar badge but the sidebar polls separately;
  // here we call it directly so the panel updates the instant a mutation
  // refreshes the screen.
  async function fetchDueCounts() {
    try {
      const r = await fetch('/api/email/hot-prospects/due-counts');
      if (!r.ok) return;
      const d = await r.json();
      setDueCounts({
        overdue: Number(d.overdue || 0),
        due_today: Number(d.due_today || 0),
        total: Number(d.total || 0),
      });
    } catch {}
  }

  // Re-load prospects whenever the selected customer changes.
  useEffect(() => {
    if (!selectedCustomerId) return;
    localStorage.setItem(LAST_CUSTOMER_KEY, selectedCustomerId);
    setProspects(null);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/email/hot-prospects?email_client_id=${encodeURIComponent(selectedCustomerId)}`);
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok || d.error) { setProspects([]); setHasLinkedInboxes(false); return; }
        setProspects(d.prospects || []);
        setHasLinkedInboxes(!!d.has_linked_inboxes);
      } catch (e) {
        if (!cancelled) { setProspects([]); setHasLinkedInboxes(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCustomerId]);

  // Refresh both badges (for prospect_count) and prospect list after any
  // detail-modal mutation (add / update / delete / mark-converted / reopen).
  // Also re-fetches the global due-counts AND dispatches a cross-component
  // event so the sidebar badge updates the moment the mutation lands —
  // without waiting for the sidebar's own 30s poll.
  async function refreshAll() {
    try {
      const [cR, pR] = await Promise.all([
        fetch('/api/email/hot-prospects/customers'),
        selectedCustomerId
          ? fetch(`/api/email/hot-prospects?email_client_id=${encodeURIComponent(selectedCustomerId)}`)
          : Promise.resolve(null),
      ]);
      const cD = await cR.json();
      if (cR.ok && !cD.error) setCustomers(cD.customers || []);
      if (pR) {
        const pD = await pR.json();
        if (pR.ok && !pD.error) {
          setProspects(pD.prospects || []);
          setHasLinkedInboxes(!!pD.has_linked_inboxes);
        }
      }
      fetchDueCounts();
      try { window.dispatchEvent(new CustomEvent('studio:hot-prospects-changed')); } catch {}
    } catch {}
  }

  const selectedCustomer = customers?.find(c => c.id === selectedCustomerId) || null;

  const filteredProspects = (() => {
    if (!prospects) return null;
    const q = search.trim().toLowerCase();
    if (!q) return prospects;
    return prospects.filter(p =>
      (p.prospect_name || '').toLowerCase().includes(q)
      || (p.prospect_email || '').toLowerCase().includes(q)
    );
  })();

  return (
    <div style={{ flex:1, overflow:'auto', padding:28 }}>

      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:11, color:TERTIARY, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4 }}>
          CRM {selectedCustomer ? `· ${selectedCustomer.name}` : ''}
        </div>
        <h1 style={{ fontSize:20, fontWeight:500, color:TEXT, margin:0 }}>Hot prospects</h1>
      </div>

      {/* Customer-switcher badges */}
      <CustomerBadges
        customers={customers}
        selectedId={selectedCustomerId}
        onSelect={setSelectedCustomerId}
      />

      {/* Search input */}
      <div style={{ marginTop:18, marginBottom:14, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
        <input
          type="text"
          placeholder="Search prospects by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width:300, maxWidth:'100%', padding:'8px 12px',
            border:`0.5px solid ${BORDER}`, borderRadius:7, fontSize:13,
            color:TEXT, background:CARD, outline:'none',
          }}
        />
        {filteredProspects && (
          <div style={{ fontSize:12, color:MUTED }}>
            {filteredProspects.length} prospect{filteredProspects.length===1?'':'s'}
            {search.trim() && prospects && prospects.length !== filteredProspects.length && (
              <> (of {prospects.length})</>
            )}
          </div>
        )}
      </div>

      {/* Prospect list */}
      {error && (
        <div style={{ background:'#fdecea', borderLeft:`3px solid ${DANGER}`, borderRadius:6, padding:'10px 14px', marginBottom:14, fontSize:13, color:DANGER, lineHeight:1.5 }}>
          Couldn't load CRM: {error}
        </div>
      )}

      {/* Top-of-CRM follow-up panel. Only renders when there are active
          follow-ups due today or overdue across all customers — invisible
          when there's nothing urgent. Aggregated count from the same
          endpoint that drives the sidebar badge. */}
      <FollowUpPanel counts={dueCounts} />

      <ProspectList
        prospects={filteredProspects}
        onOpen={setOpenProspectId}
        empty={prospects && prospects.length === 0}
        showInboxColumn={hasLinkedInboxes}
      />

      {/* Detail modal */}
      {openProspectId && (
        <ProspectDetailModal
          prospectId={openProspectId}
          onClose={() => setOpenProspectId(null)}
          onChange={refreshAll}
        />
      )}

    </div>
  );
}

// ── Customer-switcher badges ─────────────────────────────────────────────────

function CustomerBadges({ customers, selectedId, onSelect }) {
  if (customers === null) {
    return <div style={{ fontSize:13, color:MUTED }}>Loading customers…</div>;
  }
  if (customers.length === 0) {
    return (
      <div style={{
        background:CARD, border:`0.5px dashed ${BORDER}`, borderRadius:8,
        padding:20, fontSize:13, color:MUTED, textAlign:'center',
      }}>
        No customers yet. Add an AWS-verified domain or enable a portal customer first.
      </div>
    );
  }
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
      {customers.map(c => {
        const isSelected = c.id === selectedId;
        const av = avatarColor(c.name || c.id);
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            style={{
              display:'flex', alignItems:'center', gap:8,
              padding:'7px 14px 7px 10px',
              background: isSelected ? GREEN_HI : CARD,
              border: isSelected ? `0.5px solid ${GREEN_HI}` : `0.5px solid ${BORDER}`,
              borderRadius:999,
              fontSize:13, fontWeight: isSelected ? 500 : 400,
              color: isSelected ? '#fff' : TEXT,
              cursor:'pointer',
              fontFamily:'inherit',
            }}
            title={c.name}
          >
            <div style={{
              width:22, height:22, borderRadius:'50%',
              background: isSelected ? 'rgba(255,255,255,0.18)' : av.bg,
              color: isSelected ? '#fff' : av.fg,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:10, fontWeight:500,
            }}>{initials(c.name)}</div>
            <span>{c.name}</span>
            <span style={{
              background: isSelected ? 'rgba(255,255,255,0.22)' : BG,
              color: isSelected ? '#fff' : MUTED,
              fontSize:11, padding:'1px 7px', borderRadius:999,
            }}>{c.prospect_count || 0}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Prospect list (table) ────────────────────────────────────────────────────

function ProspectList({ prospects, onOpen, empty, showInboxColumn }) {
  if (prospects === null) {
    return <div style={{ fontSize:13, color:MUTED, padding:'20px 0' }}>Loading prospects…</div>;
  }
  if (empty) {
    return (
      <div style={{
        background:CARD, border:`0.5px dashed ${BORDER}`, borderRadius:8,
        padding:'48px 24px', textAlign:'center', fontSize:14, color:MUTED,
      }}>
        <div style={{ fontSize:15, color:TEXT, marginBottom:6 }}>No prospects yet</div>
        <div style={{ fontSize:13, color:MUTED, lineHeight:1.5, maxWidth:480, margin:'0 auto' }}>
          Open an email in the Mailboxes inbox and click <strong style={{ fontWeight:500 }}>Send to Hot Prospects</strong> to add the sender here.
        </div>
      </div>
    );
  }
  if (prospects.length === 0) {
    return <div style={{ fontSize:13, color:MUTED, padding:'20px 0' }}>No matches.</div>;
  }
  // Grid template: a Status column is always shown (after Email). When the
  // Inbox column is also visible we squeeze the proportions a little.
  const gridCols = showInboxColumn
    ? '1.5fr 1.5fr 0.9fr 1.1fr 0.85fr 0.85fr 32px'
    : '1.8fr 1.7fr 1.0fr 1.1fr 1.1fr 32px';
  return (
    <div style={{
      background:CARD, border:`0.5px solid ${BORDER}`, borderRadius:8,
      overflow:'hidden',
    }}>
      {/* Header row */}
      <div style={{
        display:'grid',
        gridTemplateColumns: gridCols,
        gap:12, padding:'10px 16px',
        background:BG, borderBottom:`0.5px solid ${BORDER}`,
        fontSize:11, fontWeight:500, color:MUTED,
        textTransform:'uppercase', letterSpacing:'0.5px',
      }}>
        <div>Name</div>
        <div>Email</div>
        <div>Status</div>
        {showInboxColumn && <div>Inbox</div>}
        <div>Added</div>
        <div>Follow up</div>
        <div />
      </div>

      {(() => {
        // Find the index of the first converted prospect — server already
        // orders converted rows last, so this is just the first row with
        // closed_at !== null. If none are converted, firstClosed === -1 and
        // the divider isn't rendered.
        const firstClosed = prospects.findIndex(p => p.closed_at);
        const convertedCount = firstClosed >= 0 ? (prospects.length - firstClosed) : 0;
        return prospects.map((p, idx) => {
          const showDividerBefore = firstClosed >= 0 && idx === firstClosed;
          return (
            <React.Fragment key={p.id}>
              {showDividerBefore && (
                <div style={{
                  padding:'8px 16px',
                  background:'#f9faf7',
                  fontSize:11,
                  textTransform:'uppercase',
                  letterSpacing:'0.5px',
                  color:TERTIARY,
                  borderTop:`0.5px solid ${BORDER}`,
                  borderBottom:`0.5px solid ${BORDER}`,
                }}>Converted ({convertedCount})</div>
              )}
              <ProspectRow
                prospect={p}
                isLast={idx === prospects.length - 1}
                onOpen={() => onOpen(p.id)}
                showInboxColumn={showInboxColumn}
                gridCols={gridCols}
              />
            </React.Fragment>
          );
        });
      })()}
    </div>
  );
}

function ProspectRow({ prospect, isLast, onOpen, showInboxColumn, gridCols }) {
  const av = avatarColor(prospect.prospect_name || prospect.prospect_email);
  const fu = formatFollowUp(prospect.follow_up_date);
  const isConverted = !!prospect.closed_at;
  const chrome = resolveProspectChrome(prospect);
  // NEW pill — shown until the admin opens this prospect's modal for the
  // first time. Suppressed on converted rows (they're terminal — "NEW
  // Converted" reads weird) and on follow-up-overdue rows where the urgency
  // signal is already in the Follow-up column.
  const isUnviewed = !prospect.admin_first_viewed_at && !isConverted;
  return (
    <div
      onClick={onOpen}
      style={{
        display:'grid',
        gridTemplateColumns: gridCols,
        gap:12, padding:'14px 16px', alignItems:'center',
        borderBottom: isLast ? 'none' : `0.5px solid ${BORDER}`,
        cursor:'pointer',
        // Faint tint on converted rows so they're visually de-emphasised
        // without being hidden. Matches the mockup.
        background: isConverted ? '#f9faf7' : 'transparent',
      }}
    >
      <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
        <div style={{
          width:32, height:32, borderRadius:'50%',
          background: av.bg, color: av.fg,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:12, fontWeight:500, flexShrink:0,
        }}>{initials(prospect.prospect_name || prospect.prospect_email)}</div>
        <div style={{
          display:'flex', alignItems:'center', gap:8, minWidth:0, flex:1,
        }}>
          <div style={{
            fontSize:14, fontWeight:500, color:TEXT,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
            minWidth:0, flex:'0 1 auto',
          }}>{prospect.prospect_name || <span style={{ color:MUTED, fontWeight:400 }}>(no name)</span>}</div>
          {isUnviewed && (
            <span style={{
              background: '#DC2626', color: '#fff',
              fontSize:10, padding:'1px 6px', borderRadius:4,
              fontWeight:600, letterSpacing:'0.3px',
              flexShrink:0,
            }}>NEW</span>
          )}
          {isConverted && (
            <span style={{
              background: GREEN_BG, color: GREEN_HI,
              fontSize:11, padding:'1px 7px', borderRadius:999,
              fontWeight:500, flexShrink:0,
            }}>✓ Converted</span>
          )}
        </div>
      </div>
      <div style={{
        fontSize:13, color:MUTED,
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
      }}>{prospect.prospect_email}</div>
      <div>
        <span style={{
          background: chrome.bg, color: chrome.fg,
          fontSize:11, padding:'2px 8px', borderRadius:999,
          fontWeight:500, display:'inline-block', whiteSpace:'nowrap',
        }}>{chrome.statusLabel}</span>
      </div>
      {showInboxColumn && (
        <div style={{ minWidth:0 }}>
          {prospect.source_inbox_name && (
            <span style={{
              background: GREEN_BG, color: GREEN_HI,
              fontSize:11, padding:'2px 8px', borderRadius:999,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
              display:'inline-block', maxWidth:'100%',
            }}>{prospect.source_inbox_name}</span>
          )}
        </div>
      )}
      <div style={{ fontSize:13, color:MUTED }}>{relativeTime(prospect.added_at)}</div>
      <div style={{ fontSize:13, color: fu.color, fontWeight: fu.urgent ? 500 : 400 }}>{fu.label}</div>
      <div style={{ textAlign:'right', color:TERTIARY, fontSize:18 }}>›</div>
    </div>
  );
}

// ── Top-of-CRM follow-up panel ───────────────────────────────────────────────
// Renders the urgent-count summary above the prospect list. Hidden entirely
// when there's nothing to action — no value in showing "0 follow-ups". Counts
// here are global (across all customers) to match the sidebar badge.

function FollowUpPanel({ counts }) {
  const { overdue, due_today: dueToday, total } = counts || { overdue:0, due_today:0, total:0 };
  if (!total) return null;
  // Color: red if anything overdue, amber if only-today.
  const urgent = overdue > 0;
  const bg = urgent ? DANGER_BG : AMBER_BG;
  const borderColor = urgent ? '#F09595' : '#EF9F27';
  const textColor = urgent ? '#501313' : '#412402';
  // Compose a single sentence describing the state.
  const parts = [];
  if (overdue > 0)  parts.push(`${overdue} overdue`);
  if (dueToday > 0) parts.push(`${dueToday} due today`);
  return (
    <div style={{
      background: bg, border:`0.5px solid ${borderColor}`,
      borderRadius:8, padding:'12px 16px', marginBottom:14,
      fontSize:13, color: textColor,
    }}>
      <strong style={{ fontWeight:500 }}>{total} follow-up{total===1?'':'s'} need{total===1?'s':''} attention.</strong>{' '}
      {parts.join(', ')}.
    </div>
  );
}

// ── Prospect detail modal ────────────────────────────────────────────────────

function ProspectDetailModal({ prospectId, onClose, onChange }) {
  const [data, setData] = useState(null);   // { prospect, thread }
  const [busy, setBusy] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [notes, setNotes] = useState('');
  // Status + tag colour — same debounced-save pipeline as follow-up/notes.
  const [status, setStatus] = useState('new');
  const [tagColor, setTagColor] = useState(null);
  const [savingState, setSavingState] = useState(''); // '', 'saving', 'saved'
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState(null);
  // Tracks the mark-as-converted / reopen network call. Single state — only
  // one of the two buttons is visible at a time (depends on closed_at), so
  // one busy flag covers both transitions.
  const [markBusy, setMarkBusy] = useState(false);
  const [markError, setMarkError] = useState(null);

  // Fetch the prospect + its thread on open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/email/hot-prospects/${encodeURIComponent(prospectId)}/thread`);
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok || d.error) { setData({ error: d.error || `HTTP ${r.status}` }); return; }
        setData(d);
        setFollowUp(d.prospect.follow_up_date || '');
        setNotes(d.prospect.notes || '');
        setStatus(d.prospect.status || 'new');
        setTagColor(d.prospect.tag_color || null);

        // Fire-and-forget mark-viewed. Only meaningful on the FIRST open of
        // a prospect that's never been viewed on the admin side — but it's
        // idempotent so we don't need to gate. After it stamps, the row's
        // NEW pill disappears on the next list refresh. Notify the parent
        // so the underlying list re-fetches if the prospect was previously
        // unviewed (silent no-op if already viewed).
        if (!d.prospect.admin_first_viewed_at) {
          try {
            await fetch(`/api/email/hot-prospects/${encodeURIComponent(prospectId)}/mark-viewed`, { method: 'POST' });
            onChange();
          } catch {}
        }
      } catch (e) {
        if (!cancelled) setData({ error: String(e.message || e) });
      }
    })();
    return () => { cancelled = true; };
  }, [prospectId, onChange]);

  // Debounced auto-save for follow-up date and notes. 1-second window —
  // generous enough that the operator can finish typing a date or sentence
  // without spamming the API.
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (!data || data.error) return;
    if (initialLoadRef.current) {
      // First effect fires from the initial setFollowUp/setNotes inside the
      // fetch — skip that so we don't no-op-save the values we just loaded.
      initialLoadRef.current = false;
      return;
    }
    const original = data.prospect;
    const nextFollowUp = followUp || null;
    const nextNotes    = notes    || null;
    const nextStatus   = status   || 'new';
    const nextTagColor = tagColor || null;
    const fuChanged     = (original.follow_up_date || null) !== nextFollowUp;
    const noteChanged   = (original.notes          || null) !== nextNotes;
    const statusChanged = (original.status         || 'new') !== nextStatus;
    const colorChanged  = (original.tag_color      || null)  !== nextTagColor;
    if (!fuChanged && !noteChanged && !statusChanged && !colorChanged) return;

    setSavingState('saving');
    const t = setTimeout(async () => {
      try {
        const body = {};
        if (fuChanged)     body.follow_up_date = nextFollowUp;
        if (noteChanged)   body.notes          = nextNotes;
        if (statusChanged) body.status         = nextStatus;
        if (colorChanged)  body.tag_color      = nextTagColor;
        const r = await fetch(`/api/email/hot-prospects/${encodeURIComponent(prospectId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok || d.error) {
          setSavingState('error');
          return;
        }
        // Update the local data so the change-detect on the next keystroke
        // compares against the saved value, not the original-load value.
        setData(prev => prev ? { ...prev, prospect: d.prospect } : prev);
        setSavingState('saved');
        onChange();   // refresh badges + list underneath
        // Clear the "Saved" indicator after a moment.
        setTimeout(() => setSavingState(s => s === 'saved' ? '' : s), 1500);
      } catch (e) {
        setSavingState('error');
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [followUp, notes, status, tagColor, prospectId, data, onChange]);

  async function markAsConverted() {
    if (markBusy) return;
    setMarkBusy(true);
    setMarkError(null);
    try {
      const r = await fetch(`/api/email/hot-prospects/${encodeURIComponent(prospectId)}/mark-converted`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok || d.error) {
        setMarkError(d.error || `HTTP ${r.status}`);
        setMarkBusy(false);
        return;
      }
      // Update the local data in-place so the modal swaps to its converted
      // state (banner + Reopen button) without re-fetching.
      setData(prev => prev ? { ...prev, prospect: d.prospect } : prev);
      setMarkBusy(false);
      onChange();   // refresh badges + list + sidebar event
    } catch (e) {
      setMarkError(String(e.message || e));
      setMarkBusy(false);
    }
  }

  async function reopenAsActive() {
    if (markBusy) return;
    setMarkBusy(true);
    setMarkError(null);
    try {
      const r = await fetch(`/api/email/hot-prospects/${encodeURIComponent(prospectId)}/reopen`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok || d.error) {
        setMarkError(d.error || `HTTP ${r.status}`);
        setMarkBusy(false);
        return;
      }
      setData(prev => prev ? { ...prev, prospect: d.prospect } : prev);
      setMarkBusy(false);
      onChange();
    } catch (e) {
      setMarkError(String(e.message || e));
      setMarkBusy(false);
    }
  }

  async function removeFromList() {
    if (!confirm('Remove this prospect from your Hot Prospects list?')) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      const r = await fetch(`/api/email/hot-prospects/${encodeURIComponent(prospectId)}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok || d.error) {
        setRemoveError(d.error || `HTTP ${r.status}`);
        setRemoveBusy(false);
        return;
      }
      onChange();
      onClose();
    } catch (e) {
      setRemoveError(String(e.message || e));
      setRemoveBusy(false);
    }
  }

  // Re-subscribe handler. Only invoked from a button that's only shown when
  // p.contact_unsubscribed === true. Flips the prospect back to subscribed
  // across the customer's linked set; locally updates the prospect copy on
  // success so the banner + button disappear without a refetch. Mirror of
  // the portal handler.
  const [resubBusy, setResubBusy] = useState(false);
  const [resubStatus, setResubStatus] = useState(null);
  async function resubscribeProspect() {
    if (resubBusy || !data?.prospect) return;
    if (!confirm(`Re-subscribe ${data.prospect.prospect_email} to your mailing lists?`)) return;
    setResubBusy(true);
    setResubStatus(null);
    try {
      const r = await fetch(`/api/email/hot-prospects/${encodeURIComponent(prospectId)}/resubscribe`, {
        method: 'POST',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok && !d.code) {
        setResubStatus({ kind:'error', text: d.error || `Re-subscribe failed (HTTP ${r.status})` });
        setResubBusy(false);
        return;
      }
      if (d.ok) {
        setResubStatus({ kind:'success', text: `✓ Re-subscribed to ${d.lists_affected} list${d.lists_affected===1?'':'s'}` });
        setData(prev => prev ? { ...prev, prospect: { ...prev.prospect, contact_unsubscribed: false } } : prev);
      } else if (d.code) {
        setResubStatus({ kind:'info', text: d.message });
        if (d.code === 'already_subscribed' || d.code === 'not_on_lists') {
          setData(prev => prev ? { ...prev, prospect: { ...prev.prospect, contact_unsubscribed: false } } : prev);
        }
      }
    } catch (e) {
      setResubStatus({ kind:'error', text: `Re-subscribe failed: ${e.message || e}` });
    } finally {
      setResubBusy(false);
    }
  }

  // Unsubscribe handler — opposite direction. Only invoked from a button
  // that's only shown when contact_on_list && !contact_unsubscribed. Same
  // three-shape response handling; on success flips contact_unsubscribed
  // locally so the banner swaps from "Unsubscribe" to "Re-subscribe" in
  // place without a refetch.
  const [unsubBusy, setUnsubBusy] = useState(false);
  const [unsubStatus, setUnsubStatus] = useState(null);
  async function unsubscribeProspect() {
    if (unsubBusy || !data?.prospect) return;
    if (!confirm(`Unsubscribe ${data.prospect.prospect_email} from all of your mailing lists?`)) return;
    setUnsubBusy(true);
    setUnsubStatus(null);
    try {
      const r = await fetch(`/api/email/hot-prospects/${encodeURIComponent(prospectId)}/unsubscribe`, {
        method: 'POST',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok && !d.code) {
        setUnsubStatus({ kind:'error', text: d.error || `Unsubscribe failed (HTTP ${r.status})` });
        setUnsubBusy(false);
        return;
      }
      if (d.ok) {
        setUnsubStatus({ kind:'success', text: `✓ Unsubscribed from ${d.lists_affected} list${d.lists_affected===1?'':'s'}` });
        setData(prev => prev ? { ...prev, prospect: { ...prev.prospect, contact_unsubscribed: true } } : prev);
      } else if (d.code) {
        setUnsubStatus({ kind:'info', text: d.message });
        // If server says already_unsubscribed, sync local state so the
        // Unsubscribe banner disappears (and Re-subscribe appears).
        if (d.code === 'already_unsubscribed') {
          setData(prev => prev ? { ...prev, prospect: { ...prev.prospect, contact_unsubscribed: true } } : prev);
        } else if (d.code === 'not_on_lists') {
          setData(prev => prev ? { ...prev, prospect: { ...prev.prospect, contact_on_list: false } } : prev);
        }
      }
    } catch (e) {
      setUnsubStatus({ kind:'error', text: `Unsubscribe failed: ${e.message || e}` });
    } finally {
      setUnsubBusy(false);
    }
  }

  return (
    <ModalShell onClose={onClose} wide>
      {!data ? (
        <div style={{ textAlign:'center', padding:30, color:MUTED, fontSize:13 }}>Loading prospect…</div>
      ) : data.error ? (
        <div style={{ background:'#fdecea', borderLeft:`3px solid ${DANGER}`, borderRadius:6, padding:'10px 14px', fontSize:13, color:DANGER }}>
          Couldn't load prospect: {data.error}
        </div>
      ) : (
        <DetailBody
          data={data}
          followUp={followUp} setFollowUp={setFollowUp}
          notes={notes} setNotes={setNotes}
          status={status} setStatus={setStatus}
          tagColor={tagColor} setTagColor={setTagColor}
          savingState={savingState}
          onRemove={removeFromList}
          removeBusy={removeBusy}
          removeError={removeError}
          onMarkConverted={markAsConverted}
          onReopen={reopenAsActive}
          markBusy={markBusy}
          markError={markError}
          onResubscribe={resubscribeProspect}
          resubBusy={resubBusy}
          resubStatus={resubStatus}
          onUnsubscribe={unsubscribeProspect}
          unsubBusy={unsubBusy}
          unsubStatus={unsubStatus}
        />
      )}
    </ModalShell>
  );
}

function DetailBody({ data, followUp, setFollowUp, notes, setNotes, status, setStatus, tagColor, setTagColor, savingState, onRemove, removeBusy, removeError, onMarkConverted, onReopen, markBusy, markError, onResubscribe, resubBusy, resubStatus, onUnsubscribe, unsubBusy, unsubStatus }) {
  const p = data.prospect;
  const av = avatarColor(p.prospect_name || p.prospect_email);
  const isConverted = !!p.closed_at;

  // Pretty-print the closed_at for the banner. Stored as 'YYYY-MM-DD HH:MM:SS'
  // in UTC; the relativeTime helper already handles that format gracefully.
  // We also include a friendly absolute date.
  function formatClosedAt(s) {
    if (!s) return '';
    try {
      const d = new Date(String(s).replace(' ', 'T') + 'Z');
      if (isNaN(d.getTime())) return s;
      return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }) +
             ' at ' +
             d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    } catch { return s; }
  }

  return (
    <div>
      {/* Converted banner — only when the prospect is closed. Shows when +
          by whom. Hidden while active. */}
      {isConverted && (
        <div style={{
          background: GREEN_BG, border:`0.5px solid ${SB.light}`,
          borderRadius:8, padding:'10px 14px', marginBottom:14,
          fontSize:13, color: GREEN_HI,
        }}>
          <strong style={{ fontWeight:500 }}>✓ Converted</strong> on {formatClosedAt(p.closed_at)}
          {p.closed_by && (
            <> by {(p.closed_by || '').startsWith('portal:') ? 'customer' : 'admin'}</>
          )}.
        </div>
      )}

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:14, minWidth:0 }}>
          <div style={{
            width:48, height:48, borderRadius:'50%',
            background: av.bg, color: av.fg,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:16, fontWeight:500, flexShrink:0,
          }}>{initials(p.prospect_name || p.prospect_email)}</div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:500, color:TEXT, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {p.prospect_name || <span style={{ color:MUTED, fontWeight:400 }}>(no name)</span>}
            </div>
            <div style={{ fontSize:13, color:MUTED, marginTop:2 }}>{p.prospect_email}</div>
            {/* Source-inbox subtitle: only shown when this prospect is part
                of a linked-inbox customer (i.e. there's something useful to
                disambiguate). Hidden for single-inbox customers. */}
            {p.has_linked_inboxes && p.source_inbox_name && (
              <div style={{ marginTop:4 }}>
                <span style={{
                  background: GREEN_BG, color: GREEN_HI,
                  fontSize:11, padding:'2px 7px', borderRadius:999,
                }}>From {p.source_inbox_name}</span>
              </div>
            )}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          {isConverted ? (
            <button
              onClick={onReopen}
              disabled={markBusy}
              style={{
                background:'transparent', color: GREEN_HI,
                border:`0.5px solid ${GREEN_HI}`,
                borderRadius:7, padding:'7px 12px', fontSize:13, fontWeight:500,
                cursor: markBusy ? 'not-allowed' : 'pointer',
                opacity: markBusy ? 0.6 : 1,
                fontFamily:'inherit',
              }}
            >
              {markBusy ? 'Reopening…' : 'Reopen as active'}
            </button>
          ) : (
            <button
              onClick={onMarkConverted}
              disabled={markBusy}
              style={{
                background: GREEN_HI, color:'#fff',
                border:'none',
                borderRadius:7, padding:'7px 12px', fontSize:13, fontWeight:500,
                cursor: markBusy ? 'not-allowed' : 'pointer',
                opacity: markBusy ? 0.6 : 1,
                display:'flex', alignItems:'center', gap:6,
                fontFamily:'inherit',
              }}
            >
              {markBusy ? 'Saving…' : '✓ Mark as converted'}
            </button>
          )}
          <button
            onClick={onRemove}
            disabled={removeBusy}
            style={{
              background:'#fdecea', color:DANGER, border:'none',
              borderRadius:7, padding:'7px 14px', fontSize:13, fontWeight:500,
              cursor: removeBusy ? 'not-allowed' : 'pointer',
              opacity: removeBusy ? 0.6 : 1,
              display:'flex', alignItems:'center', gap:6,
              fontFamily:'inherit',
            }}
          >
            🗑 Remove
          </button>
        </div>
      </div>

      {markError && (
        <div style={{ background:'#fdecea', borderLeft:`3px solid ${DANGER}`, borderRadius:6, padding:'8px 12px', marginBottom:12, fontSize:12, color:DANGER }}>
          {markError}
        </div>
      )}

      {removeError && (
        <div style={{ background:'#fdecea', borderLeft:`3px solid ${DANGER}`, borderRadius:6, padding:'8px 12px', marginBottom:12, fontSize:12, color:DANGER }}>
          {removeError}
        </div>
      )}

      {/* Re-subscribe banner — only shown when the prospect's email is
          currently unsubscribed from at least one of the customer's mailing
          lists (contact_unsubscribed === true). Hidden for prospects with no
          subscriber rows at all (website-form leads etc.) — those need the
          Subscribers admin section to be added, not a re-toggle here. The
          status line below mirrors the per-reply modal pattern. */}
      {p.contact_unsubscribed && (
        <div style={{
          marginBottom:12,
          padding:'10px 14px',
          background: AMBER_BG,
          borderLeft: `3px solid ${AMBER}`,
          borderRadius:6,
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
          flexWrap:'wrap',
        }}>
          <div style={{ fontSize:12, color:'#5F5E5A', lineHeight:1.5 }}>
            <b style={{fontWeight:500, color:TEXT}}>🚫 Unsubscribed from your mailing list.</b>{' '}
            Re-subscribe them if you'd like to include them in future campaigns.
          </div>
          <button
            onClick={onResubscribe}
            disabled={resubBusy}
            style={{
              background: AMBER, color:'#fff', border:'none',
              borderRadius:7, padding:'7px 12px', fontSize:13, fontWeight:500,
              cursor: resubBusy ? 'not-allowed' : 'pointer',
              opacity: resubBusy ? 0.6 : 1,
              fontFamily:'inherit', whiteSpace:'nowrap',
            }}
          >{resubBusy ? 'Re-subscribing…' : 'Re-subscribe'}</button>
        </div>
      )}
      {resubStatus && (
        <div style={{
          marginBottom:12, fontSize:12,
          color: resubStatus.kind === 'success' ? SB.dark
               : resubStatus.kind === 'error'   ? DANGER
               : '#5F5E5A',
          fontStyle: resubStatus.kind === 'info' ? 'italic' : 'normal',
        }}>{resubStatus.text}</div>
      )}

      {/* Unsubscribe banner — opposite direction. Only shown when the
          prospect IS on at least one of the customer's mailing lists AND
          currently subscribed (contact_on_list && !contact_unsubscribed).
          Mutually exclusive with the Re-subscribe banner above. Hidden for
          prospects not on any list (Formspree leads etc.) so they don't
          see a button that would refuse on click. */}
      {p.contact_on_list && !p.contact_unsubscribed && (
        <div style={{
          marginBottom:12,
          padding:'10px 14px',
          background: DANGER_BG,
          borderLeft: `3px solid ${DANGER}`,
          borderRadius:6,
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
          flexWrap:'wrap',
        }}>
          <div style={{ fontSize:12, color:'#5F5E5A', lineHeight:1.5 }}>
            <b style={{fontWeight:500, color:TEXT}}>📬 On your mailing list.</b>{' '}
            Unsubscribe them if they've asked not to be emailed.
          </div>
          <button
            onClick={onUnsubscribe}
            disabled={unsubBusy}
            style={{
              background: DANGER, color:'#fff', border:'none',
              borderRadius:7, padding:'7px 12px', fontSize:13, fontWeight:500,
              cursor: unsubBusy ? 'not-allowed' : 'pointer',
              opacity: unsubBusy ? 0.6 : 1,
              fontFamily:'inherit', whiteSpace:'nowrap',
            }}
          >{unsubBusy ? 'Unsubscribing…' : 'Unsubscribe'}</button>
        </div>
      )}
      {unsubStatus && (
        <div style={{
          marginBottom:12, fontSize:12,
          color: unsubStatus.kind === 'success' ? SB.dark
               : unsubStatus.kind === 'error'   ? DANGER
               : '#5F5E5A',
          fontStyle: unsubStatus.kind === 'info' ? 'italic' : 'normal',
        }}>{unsubStatus.text}</div>
      )}

      {/* Meta row: added / follow-up */}
      <div style={{
        display:'grid', gridTemplateColumns:'1fr 1fr', gap:16,
        padding:'14px 0', borderTop:`0.5px solid ${BORDER}`, borderBottom:`0.5px solid ${BORDER}`,
        marginBottom:16,
      }}>
        <div>
          <div style={{ fontSize:11, color:TERTIARY, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Added to list</div>
          <div style={{ fontSize:14, color:TEXT }}>
            {relativeTime(p.added_at)}
            <span style={{ color:MUTED, marginLeft:6, fontSize:12 }}>
              ({(p.added_by || '').startsWith('portal:') ? 'by customer' : 'by admin'})
            </span>
          </div>
        </div>
        <div>
          <div style={{ fontSize:11, color:TERTIARY, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Follow up on</div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <input
              type="date"
              value={followUp}
              onChange={e => setFollowUp(e.target.value)}
              style={{
                fontSize:13, padding:'6px 10px',
                border:`0.5px solid ${BORDER}`, borderRadius:6,
                color:TEXT, background:CARD, outline:'none',
                fontFamily:'inherit',
              }}
            />
            {followUp && (
              <button
                onClick={() => setFollowUp('')}
                style={{
                  fontSize:12, padding:'6px 10px',
                  background:BG, color:MUTED, border:`0.5px solid ${BORDER}`,
                  borderRadius:6, cursor:'pointer', fontFamily:'inherit',
                }}
              >Clear</button>
            )}
          </div>
        </div>
      </div>

      {/* Status + Tag colour — both editable, saved via the same
          debounced PUT pipeline as follow-up/notes (one save state
          indicator covers all four fields). */}
      <div style={{ display:'flex', gap:24, marginBottom:18, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:11, color:TERTIARY, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Status</div>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            disabled={isConverted}
            style={{
              fontSize:13, padding:'6px 28px 6px 10px',
              border:`0.5px solid ${BORDER}`, borderRadius:6,
              color:TEXT, background:CARD, outline:'none',
              fontFamily:'inherit', cursor: isConverted ? 'not-allowed' : 'pointer',
              opacity: isConverted ? 0.55 : 1,
              appearance:'auto',
            }}
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize:11, color:TERTIARY, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Tag colour</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
            {TAG_COLORS.map(c => {
              const isSelected = (tagColor || null) === (c.value || null);
              const isDefault = c.value === null;
              return (
                <button
                  key={String(c.value)}
                  onClick={() => !isConverted && setTagColor(c.value)}
                  disabled={isConverted}
                  title={c.label}
                  style={{
                    width:24, height:24, borderRadius:'50%',
                    background: isDefault ? CARD : c.bg,
                    border: isSelected ? `2px solid ${TEXT}` : `0.5px solid ${BORDER}`,
                    cursor: isConverted ? 'not-allowed' : 'pointer',
                    padding:0,
                    fontSize:11, color: isDefault ? MUTED : c.fg,
                    fontFamily:'inherit',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    opacity: isConverted ? 0.55 : 1,
                  }}
                >{isDefault ? '∅' : (isSelected ? '✓' : '')}</button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div style={{ marginBottom:18 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontSize:11, color:TERTIARY, textTransform:'uppercase', letterSpacing:'0.5px' }}>Notes</div>
          <div style={{ fontSize:11, color: savingState==='error' ? DANGER : savingState==='saving' ? AMBER : savingState==='saved' ? GREEN : 'transparent' }}>
            {savingState === 'saving' && 'Saving…'}
            {savingState === 'saved'  && '✓ Saved'}
            {savingState === 'error'  && 'Save failed — will retry on next change'}
          </div>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add a note about this prospect…"
          style={{
            width:'100%', minHeight:80, padding:'10px 12px',
            border:`0.5px solid ${BORDER}`, borderRadius:7,
            fontSize:13, color:TEXT, background:CARD, outline:'none',
            boxSizing:'border-box', fontFamily:'inherit',
            resize:'vertical', lineHeight:1.5,
          }}
        />
      </div>

      {/* Campaign subscriptions panel — per-campaign tickboxes so the
          operator can stop a specific campaign from continuing its drip
          to this contact, OR tick "Unsubscribe from ALL" as a master
          switch. Identical UI in the inbox open-email modal. */}
      <CampaignSubscriptionsPanel
        source="hot_prospect"
        sourceId={p.id}
      />

      {/* Thread */}
      <ThreadList thread={data.thread || []} />

    </div>
  );
}

// ── Email thread ─────────────────────────────────────────────────────────────

function ThreadList({ thread }) {
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ fontSize:13, fontWeight:500, color:TEXT }}>Email history with this prospect</div>
        <div style={{ fontSize:11, color:TERTIARY }}>
          {thread.length} message{thread.length===1?'':'s'} · auto-updates
        </div>
      </div>
      {thread.length === 0 ? (
        <div style={{
          background:CARD, border:`0.5px dashed ${BORDER}`, borderRadius:7,
          padding:'20px 14px', fontSize:13, color:MUTED, textAlign:'center',
        }}>
          No messages found. The thread builds itself from inbox replies and
          sent replies — new mail will appear here automatically.
        </div>
      ) : (
        thread.map(msg => <ThreadMessage key={`${msg.direction}-${msg.id}`} msg={msg} />)
      )}
    </div>
  );
}

function ThreadMessage({ msg }) {
  const isInbound = msg.direction === 'inbound';
  const arrow = isInbound ? '↩' : '↑';
  const label = isInbound
    ? `From ${msg.from_name || msg.from_address} · ${relativeTime(msg.at)}`
    : `From us · ${relativeTime(msg.at)}`;
  const date = (() => {
    if (!msg.at) return '';
    let v = msg.at;
    if (typeof v === 'string' && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) v = v.replace(' ', 'T') + 'Z';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })
      + ', ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  })();

  return (
    <div style={{
      border:`0.5px solid ${BORDER}`, borderRadius:7,
      padding:'12px 14px', marginBottom:10,
    }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6, gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:MUTED }}>
          <span style={{ color: isInbound ? BLUE : GREEN }}>{arrow}</span>
          <span>{label}</span>
        </div>
        <div style={{ fontSize:11, color:TERTIARY, whiteSpace:'nowrap' }}>{date}</div>
      </div>
      {msg.subject && (
        <div style={{ fontSize:12, color:TEXT, fontWeight:500, marginBottom:6 }}>{msg.subject}</div>
      )}
      <div style={{
        fontSize:13, color:MUTED, lineHeight:1.6,
        whiteSpace:'pre-wrap',
        maxHeight:240, overflowY:'auto',
      }}>
        {msg.body_text || <em style={{ color:TERTIARY }}>(no plain text body)</em>}
      </div>
      {msg.error && (
        <div style={{ marginTop:8, fontSize:11, color:DANGER }}>
          Send failed: {msg.error}
        </div>
      )}
    </div>
  );
}

// ── Local modal shell ────────────────────────────────────────────────────────
// Self-contained so this file doesn't reach into EmailSection.jsx for its
// Modal primitive — same visual style though.

// ── Campaign subscriptions panel ─────────────────────────────────────────────
// Per-campaign opt-out widget. Identical to the one in EmailSection.jsx
// (kept as a duplicate rather than imported across components — same
// convention as resolveLinkedSet being duplicated in portal.js).
//
// Props:
//   source      — 'reply' | 'hot_prospect' (chooses the endpoint base)
//   sourceId    — the reply ID or hot prospect ID
//
// Endpoints used:
//   GET  /api/email/{replies|hot-prospects}/:id/subscriptions
//   PUT  /api/email/{replies|hot-prospects}/:id/subscriptions
function CampaignSubscriptionsPanel({ source, sourceId }) {
  const [state, setState]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [savingKey, setSavingKey] = useState(null);

  const basePath = source === 'hot_prospect'
    ? `/api/email/hot-prospects/${sourceId}/subscriptions`
    : `/api/email/replies/${sourceId}/subscriptions`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(basePath)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (!cancelled) { setState(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, source]);

  async function applyChange(body, rowKey) {
    if (!state) return;
    setSavingKey(rowKey);
    try {
      const r = await fetch(basePath, {
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState(await r.json());
    } catch (e) {
      try {
        const rr = await fetch(basePath);
        if (rr.ok) setState(await rr.json());
      } catch {}
      alert(`Could not save change: ${e.message || e}`);
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return (
      <div style={{
        background: BG, border: `0.5px solid ${BORDER}`, borderRadius: 7,
        padding: '10px 14px', marginBottom: 14, fontSize: 12, color: MUTED,
      }}>Loading campaign subscriptions…</div>
    );
  }
  if (error) {
    return (
      <div style={{
        background: '#fff3cd', borderLeft: `3px solid ${AMBER}`, borderRadius: 7,
        padding: '8px 12px', marginBottom: 14, fontSize: 12, color: AMBER,
      }}>Could not load campaign subscriptions: {error}</div>
    );
  }
  if (!state) return null;

  const masterOn = !!state.unsubscribed_from_all;
  const campaigns = state.campaigns || [];

  return (
    <div style={{
      background: BG, border: `0.5px solid ${BORDER}`, borderRadius: 7,
      padding: '12px 14px', marginBottom: 14,
    }}>
      <div style={{
        display:'flex', justifyContent:'space-between', alignItems:'center',
        marginBottom: 8,
      }}>
        <div style={{fontSize: 12, fontWeight: 500, color: TEXT}}>
          📭 Campaign subscriptions
        </div>
        <div style={{fontSize: 10, color: TERTIARY}}>Synced admin ↔ portal</div>
      </div>

      <label style={{
        display:'flex', alignItems:'center', gap: 8,
        padding: '6px 10px', borderRadius: 6,
        background: CARD, border: `0.5px solid ${BORDER}`,
        marginBottom: campaigns.length > 0 ? 8 : 0,
        cursor: savingKey === '__master__' ? 'wait' : 'pointer',
        opacity: savingKey === '__master__' ? 0.6 : 1,
      }}>
        <input
          type="checkbox"
          checked={masterOn}
          disabled={savingKey === '__master__'}
          onChange={e => applyChange({ unsubscribed_from_all: e.target.checked }, '__master__')}
          style={{width: 14, height: 14, flexShrink: 0, cursor: 'inherit'}}
        />
        <div style={{flex: 1, fontSize: 12, fontWeight: 500, color: TEXT}}>
          Unsubscribe from ALL campaigns
        </div>
        <div style={{fontSize: 10, color: TERTIARY}}>includes future</div>
      </label>

      {campaigns.length === 0 && !masterOn && (
        <div style={{
          fontSize: 11, color: TERTIARY, padding: '8px 4px 2px',
          fontStyle: 'italic',
        }}>No campaigns at this customer yet.</div>
      )}

      {campaigns.map(c => {
        const isAuto = c.unsub_source === 'hot_prospect_auto';
        const isArchived = c.status === 'archived';
        const checked = masterOn || c.unsubscribed;
        const disabled = masterOn || savingKey === c.campaign_id;

        const parts = [];
        if (isArchived) parts.push('Archived');
        if (!c.on_audience_list) parts.push('not on audience list');
        if (c.sends_to_contact > 0) {
          parts.push(`${c.sends_to_contact} of ${c.total_steps} sent`);
        } else if (c.on_audience_list && !isArchived) {
          parts.push(`${c.total_steps} step${c.total_steps===1?'':'s'} planned`);
        }
        if (isAuto) parts.push('auto-stopped when added to Hot Prospects');
        const subLabel = parts.join(' · ') || 'Subscribed';

        return (
          <label
            key={c.campaign_id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 6,
              border: `0.5px solid ${isAuto ? '#E8C896' : BORDER}`,
              background: isAuto ? AMBER_BG : CARD,
              marginBottom: 4, cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled && !masterOn ? 0.6 : 1,
              filter: isArchived ? 'opacity(0.65)' : 'none',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={e => applyChange({
                campaigns: [{ campaign_id: c.campaign_id, unsubscribed: e.target.checked }],
              }, c.campaign_id)}
              style={{width: 14, height: 14, flexShrink: 0, cursor: 'inherit'}}
            />
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{
                fontSize: 12,
                fontWeight: isAuto ? 500 : 400,
                color: isAuto ? '#412402' : TEXT,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.title || '(untitled campaign)'}
                {c.list_name && <span style={{color: isAuto ? '#633806' : TERTIARY, fontWeight: 400}}> · {c.list_name}</span>}
              </div>
              <div style={{fontSize: 10, color: isAuto ? '#633806' : TERTIARY}}>
                {subLabel}
              </div>
            </div>
            {isAuto && (
              <span style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 8,
                background: '#BA7517', color: '#fff', flexShrink: 0,
                fontWeight: 500,
              }}>Auto</span>
            )}
          </label>
        );
      })}

      {masterOn && campaigns.length > 0 && (
        <div style={{
          fontSize: 10, color: TERTIARY, marginTop: 6, fontStyle: 'italic',
        }}>
          All campaigns blocked via master switch — untick "Unsubscribe from ALL" to control campaigns individually.
        </div>
      )}
    </div>
  );
}

function ModalShell({ children, onClose, wide }) {
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000,
    }}>
      <div style={{
        background:CARD, borderRadius:12, padding:28,
        width: wide ? 800 : 480, maxWidth:'95vw', maxHeight:'90vh',
        overflowY:'auto', boxShadow:'0 8px 40px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h2 style={{ fontSize:16, fontWeight:500, color:TEXT, margin:0 }}>Hot prospect</h2>
          <button
            onClick={onClose}
            style={{ background:'none', border:'none', fontSize:22, color:MUTED, cursor:'pointer', lineHeight:1 }}
          >×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
