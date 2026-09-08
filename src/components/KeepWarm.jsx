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
import React, { useState, useEffect, useCallback } from 'react';
import { SB } from '../brand.js';

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

// Strip tags for the card preview. Only ever used for the two-line teaser on a
// card — the full email is rendered properly in the read view.
function teaser(html, len = 150) {
  const t = String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > len ? t.slice(0, len) + '…' : t;
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

function AudienceRow({ row }) {
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
      </div>
      <span style={{
        fontSize: 12, color: row.reason ? MUTED : SB.dark,
        background: row.reason ? '#eeeeec' : SB.tint,
        padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      }}>{row.reason || row.stageLabel}</span>
    </div>
  );
}

function DraftCard({ draft, onOpen, onStatus, busy }) {
  return (
    <div style={{
      background: CARD,
      border: `1px solid ${draft.status === 'approved' ? SB.primary : BORDER}`,
      borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Pill status={draft.status} />
        {draft.edited ? <span style={{ fontSize: 12, color: TERTIARY }}>edited</span> : null}
      </div>
      {draft.angle ? (
        <div style={{ fontSize: 12, color: TERTIARY, marginBottom: 5 }}>{draft.angle}</div>
      ) : null}
      <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, lineHeight: 1.4, marginBottom: 8 }}>
        {draft.subject}
      </div>
      <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, flex: 1, marginBottom: 12 }}>
        {teaser(draft.html_body)}
      </div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <Button onClick={() => onOpen(draft.id)}>Read it</Button>
        {draft.status !== 'approved' && (
          <Button tone="primary" disabled={busy} onClick={() => onStatus(draft.id, 'approved')}>Approve</Button>
        )}
        {draft.status === 'approved' && (
          <Button disabled={busy} onClick={() => onStatus(draft.id, 'draft')}>Un-approve</Button>
        )}
        {draft.status !== 'rejected' && (
          <Button tone="danger" disabled={busy} onClick={() => onStatus(draft.id, 'rejected')}>Bin</Button>
        )}
      </div>
    </div>
  );
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
function ReadPanel({ state, onClose, onChange, onSave, onStatus, saving }) {
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
          <div style={{ fontSize: 12, color: draft.subject.length > 60 ? AMBER : TERTIARY, marginBottom: 16 }}>
            {draft.subject.length} characters{draft.subject.length > 60 ? ' — long subjects get cut off in most inboxes' : ''}
          </div>

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
            value={draft.html_body}
            onChange={(e) => onChange({ html_body: e.target.value })}
            rows={10}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 12,
              border: `1px solid ${BORDER}`, borderRadius: 7, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              lineHeight: 1.6, resize: 'vertical',
            }}
          />
          <div style={{ fontSize: 12, color: TERTIARY, marginTop: 6, marginBottom: 16 }}>
            Keep each paragraph wrapped in its {'<p style="…">'} tag — that styling is what makes it
            render correctly in Outlook. Saving an edit clears the approval, so re-approve afterwards.
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

// ── Screen ───────────────────────────────────────────────────────────────────

export default function KeepWarm() {
  const [overview, setOverview]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const [audience, setAudience]   = useState(null);
  const [showList, setShowList]   = useState(false);
  const [listMode, setListMode]   = useState('included');
  const [search, setSearch]       = useState('');

  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState(null);

  const [count, setCount]         = useState(3);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError]   = useState(null);
  const [genNote, setGenNote]     = useState(null);

  const [drafts, setDrafts]       = useState([]);
  const [filter, setFilter]       = useState('all');
  const [busyId, setBusyId]       = useState(null);

  const [open, setOpen]           = useState(null);
  const [saving, setSaving]       = useState(false);

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

  useEffect(() => { loadOverview(); loadDrafts(); }, [loadOverview, loadDrafts]);

  useEffect(() => {
    if (!showList) return;
    const t = setTimeout(() => loadAudience(listMode, search), 250);
    return () => clearTimeout(t);
  }, [showList, listMode, search, loadAudience]);

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

  async function refreshStages() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const r = await fetch('/api/keepwarm/refresh-stages', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Refresh failed');
      setRefreshMsg({ tone: 'info', text: `Read ${d.count} companies from WorkTrackr.` });
      await loadOverview();
      if (showList) loadAudience(listMode, search);
    } catch (err) {
      setRefreshMsg({ tone: 'bad', text: err.message });
    } finally {
      setRefreshing(false);
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
        body: JSON.stringify({ count }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Generation failed');
      if (d.short) setGenNote(`Asked for ${d.requested}, got ${d.generated} back.`);
      setFilter('draft');
      await loadDrafts();
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
      await loadDrafts();
      if (open && open.draft.id === id) setOpen(o => ({ ...o, draft: d.draft }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function openDraft(id) {
    try {
      const r = await fetch(`/api/keepwarm/drafts/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not open');
      setOpen({ draft: d.draft, preview: d.preview });
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveOpen() {
    if (!open) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/keepwarm/drafts/${open.draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: open.draft.subject, html: open.draft.html_body }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save');
      setOpen({ draft: d.draft, preview: d.preview });
      await loadDrafts();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const shown = drafts.filter(d => filter === 'all' || d.status === filter);
  const cfg = overview?.config || {};

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: BG, padding: '28px 32px' }}>
      <div style={{ maxWidth: 1100 }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: '0 0 4px' }}>Keep-warm emails</h1>
        <p style={{ fontSize: 14, color: MUTED, margin: '0 0 22px', lineHeight: 1.6 }}>
          A short email every fortnight to everyone who has already had Billy's introduction, so
          Sweetbyte stays in mind while they are still deciding. Nothing is sent from this screen —
          generate, read, edit and approve here.
        </p>

        {error && <Banner tone="bad">{error}</Banner>}

        {!loading && !cfg.stagePullConfigured && (
          <Banner tone="warn">
            Studio cannot read sales stages from WorkTrackr yet — set <strong>WORKTRACKR_BASE_URL</strong> on
            the Sweetbyte Studio service, and <strong>STUDIO_BRIDGE_ORG_ID</strong> on WorkTrackr. Until
            then every company shows as "no stage" and the audience will be empty.
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

        {loading ? (
          <div style={{ color: MUTED, fontSize: 14 }}>Loading…</div>
        ) : (
          <>
            {/* ── Audience ─────────────────────────────────────────────── */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: 0 }}>Who is in the loop</h2>
                <div style={{ fontSize: 13, color: MUTED }}>
                  Stages last read from WorkTrackr: {fmt(overview.stageRefresh.at)}
                </div>
              </div>

              <div style={{ fontSize: 34, fontWeight: 700, color: SB.strong, margin: '10px 0 2px' }}>
                {overview.audienceCount}
              </div>
              <div style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>
                would receive the next email. {overview.excludedCount} excluded
                {overview.suppressedCount > 0 ? `, of which ${overview.suppressedCount} have unsubscribed` : ''}.
              </div>

              <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>
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

              {refreshMsg && <Banner tone={refreshMsg.tone}>{refreshMsg.text}</Banner>}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button onClick={refreshStages} disabled={refreshing || !cfg.stagePullConfigured}>
                  {refreshing ? 'Reading WorkTrackr…' : 'Refresh stages from WorkTrackr'}
                </Button>
                <Button onClick={() => setShowList(v => !v)}>
                  {showList ? 'Hide the list' : 'Show the list'}
                </Button>
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
                  </div>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, company or address"
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 14,
                      border: `1px solid ${BORDER}`, borderRadius: 7, fontFamily: 'inherit', marginBottom: 10,
                    }}
                  />
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', maxHeight: 380, overflowY: 'auto' }}>
                    {(audience?.rows || []).map(r => <AudienceRow key={r.email} row={r} />)}
                    {audience && audience.rows.length === 0 && (
                      <div style={{ padding: '16px 12px', fontSize: 13, color: MUTED }}>Nobody matches.</div>
                    )}
                  </div>
                  {audience?.truncated && (
                    <div style={{ fontSize: 12, color: TERTIARY, marginTop: 6 }}>
                      Showing the first 1,000 — narrow the search to find someone specific.
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* ── Generate ─────────────────────────────────────────────── */}
            <Card>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: '0 0 4px' }}>Write some emails</h2>
              <p style={{ fontSize: 13, color: MUTED, margin: '0 0 14px', lineHeight: 1.6 }}>
                Each one is a complete, separate email with its own subject line and its own angle —
                these are alternatives to choose between, not a sequence. Anything you have already
                approved, sent or binned is fed back in so the same idea does not come round again.
              </p>

              {genError && <Banner tone="bad">{genError}</Banner>}
              {genNote && <Banner tone="warn">{genNote}</Banner>}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  style={{
                    padding: '7px 11px', fontSize: 13, border: `1px solid ${BORDER}`,
                    borderRadius: 7, fontFamily: 'inherit', background: CARD,
                  }}
                >
                  {(overview.allowedCounts || [3, 6, 9]).map(n => (
                    <option key={n} value={n}>{n} emails</option>
                  ))}
                </select>
                <Button tone="primary" onClick={generate} disabled={generating || !cfg.ragLoaded || !cfg.anthropicConfigured}>
                  {generating ? 'Writing…' : 'Generate'}
                </Button>
                {generating && (
                  <span style={{ fontSize: 13, color: MUTED }}>
                    This takes up to a minute for nine. Leave the page open.
                  </span>
                )}
              </div>
            </Card>

            {/* ── Drafts ───────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 12px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: 0, marginRight: 6 }}>Drafts</h2>
              {['all', 'draft', 'approved', 'rejected'].map(f => (
                <Button key={f} tone={filter === f ? 'primary' : 'plain'} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : STATUS_STYLE[f].label}
                </Button>
              ))}
            </div>

            {shown.length === 0 ? (
              <Card><div style={{ fontSize: 14, color: MUTED }}>
                Nothing here yet. Pick a number above and press Generate.
              </div></Card>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, paddingBottom: 40 }}>
                {shown.map(d => (
                  <DraftCard
                    key={d.id}
                    draft={d}
                    busy={busyId === d.id}
                    onOpen={openDraft}
                    onStatus={setStatus}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <ReadPanel
        state={open}
        saving={saving}
        onClose={() => setOpen(null)}
        onChange={(patch) => setOpen(o => ({ ...o, draft: { ...o.draft, ...patch } }))}
        onSave={saveOpen}
        onStatus={setStatus}
      />
    </div>
  );
}
