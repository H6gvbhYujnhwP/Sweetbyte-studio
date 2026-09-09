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

// Slot dates arrive as plain YYYY-MM-DD with no time and no zone. Parsing them
// as UTC and printing them as UTC keeps the day the server meant — read as
// local time, a date can slide back to the previous evening.
function fmtDate(d) {
  if (!d) return '—';
  const x = new Date(d + 'T12:00:00Z');
  if (isNaN(x)) return d;
  return x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
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
function AudienceRow({ row, selectable = false, checked = true, onToggle }) {
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
      return 'That draft has not been approved yet. Approve it on the Drafts tab first.';
    case 'already_sent':
      return 'That draft has already gone out once.';
    case 'run_in_progress':
      return 'A send is already running. One at a time — wait for it to finish.';
    case 'empty_audience':
      return 'Nobody qualifies under the current stage rule, so there was nothing to send.';
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
  { key: 'drafts',   label: 'Drafts' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'sent',     label: 'Sent' },
];

function TabBar({ tab, onPick }) {
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

// ── Schedule ─────────────────────────────────────────────────────────────────

function SlotRow({ slot, canSend, onSend, sending, expanded, onToggle }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 14px', borderBottom: `1px solid ${BORDER}`,
    }}>
      <div style={{ width: 92, fontSize: 13, color: MUTED, whiteSpace: 'nowrap' }}>
        {fmtDate(slot.date)}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {slot.subject}
      </div>
      <span style={{
        fontSize: 12, background: GOOD_BG, color: GOOD,
        padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap',
      }}>Approved</span>

      {/* The headcount is the control on the sendable row — clicking the number
          you are about to commit to is where you would reach to check it.
          Later rows show the same number as plain text: their real audience is
          a fortnight away and genuinely unknowable, so offering a list there
          would be showing today's names as though they were next time's. */}
      {canSend ? (
        <button
          onClick={onToggle}
          style={{
            width: 108, textAlign: 'right', fontSize: 13, color: SB.dark,
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', padding: 0, whiteSpace: 'nowrap',
          }}
        >
          {slot.projectedCount} people {expanded ? '▴' : '▾'}
        </button>
      ) : (
        <div style={{ width: 108, textAlign: 'right', fontSize: 13, color: MUTED, whiteSpace: 'nowrap' }}>
          {slot.projectedCount} people
        </div>
      )}

      <div style={{ width: 96, textAlign: 'right' }}>
        {canSend
          ? <Button tone="primary" disabled={sending} onClick={() => onSend(slot)}>
              {sending ? 'Queuing…' : 'Send'}
            </Button>
          : <span style={{ fontSize: 12, color: TERTIARY }}>Queued</span>}
      </div>
    </div>
  );
}

// The people the next send would go to, read live rather than stored — this is
// the same audience endpoint the Audience tab uses, so the two can never drift
// into disagreeing about who is on the list.
function SlotList({ data, search, onSearch, isChecked, onToggle, onAll, onNone, selectedCount }) {
  return (
    <div style={{ background: BG, borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name, company or address"
          style={{
            flex: 1, minWidth: 200, padding: '7px 11px', fontSize: 13,
            border: `1px solid ${BORDER}`, borderRadius: 7, fontFamily: 'inherit', background: CARD,
          }}
        />
        <Button onClick={onAll}>Select all</Button>
        <Button onClick={onNone}>Deselect all</Button>
        <span style={{ fontSize: 12, color: TERTIARY }}>
          {data ? `${selectedCount} ticked · ${data.total} shown of ${data.includedCount}` : 'Loading…'}
        </span>
      </div>

      <div style={{ maxHeight: 320, overflowY: 'auto', borderTop: `1px solid ${BORDER}` }}>
        {!data && <div style={{ padding: '12px 14px', fontSize: 13, color: MUTED }}>Loading…</div>}
        {data && data.rows.length === 0 && (
          <div style={{ padding: '12px 14px', fontSize: 13, color: MUTED }}>Nobody matches that search.</div>
        )}
        {data && data.rows.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 14px', borderBottom: `1px solid ${BORDER}`,
          }}>
            <input
              type="checkbox"
              checked={isChecked(r.email)}
              onChange={() => onToggle(r.email)}
              aria-label={`Include ${r.email}`}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: SB.primary, flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0, opacity: isChecked(r.email) ? 1 : 0.45 }}>
              <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.contactName ? `${r.contactName} — ` : ''}{r.companyName || 'Unknown company'}
              </div>
              <div style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.email}
              </div>
            </div>
            <GreetingPill greeting={r.greeting} />
            <span style={{
              fontSize: 12, color: SB.dark, background: SB.tint,
              padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
            }}>{r.stageLabel}</span>
          </div>
        ))}
      </div>

      {data && data.truncated && (
        <div style={{ padding: '9px 14px', fontSize: 12, color: TERTIARY }}>
          Only the first 1,000 are listed. Search to narrow it down — the send still goes to all {data.includedCount}.
        </div>
      )}
    </div>
  );
}

function ScheduleView({ data, onSend, sending, sendError, listOpen, onToggleList, listData, listSearch, onListSearch,
                       isChecked, onToggleOne, onAll, onNone, selectedCount, handPicked,
                       testTo, onTestTo, onTest, testBusy, testNote, testError }) {
  if (!data) return <div style={{ color: MUTED, fontSize: 14 }}>Loading…</div>;

  const active = data.activeRun;
  const running = active && active.status === 'sending';

  return (
    <>
      {sendError && <Banner tone="bad">{sendError}</Banner>}

      {running && (
        <Card>
          <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Sending now</div>
          <div style={{ fontSize: 14, color: TEXT, marginBottom: 10 }}>{active.subject}</div>
          <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
            {active.progress.sent} of {active.progress.total} sent
            {active.progress.suppressed > 0 && `, ${active.progress.suppressed} skipped as unsubscribed`}
            {active.progress.failed > 0 && `, ${active.progress.failed} failed`}.
            {' '}A thousand takes a couple of minutes. You can leave this page — it carries on without you.
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: 0 }}>Next {data.slots.length || ''} sends</h2>
          <div style={{ fontSize: 13, color: MUTED }}>
            Every {data.config.cadenceDays} days
            {data.nextDueDate ? ` · next due ${fmtDate(data.nextDueDate)}` : ' · nothing sent yet, so the first is due whenever you are'}
          </div>
        </div>
      </Card>

      {handPicked && (
        <Banner tone="warn">
          You have hand-picked {selectedCount} of {data.audienceCount} for the next send.
          Everyone else stays in the loop for future ones. The ticks clear as soon as this send goes.
        </Banner>
      )}

      {data.slots.length === 0 ? (
        <Card><div style={{ fontSize: 14, color: MUTED }}>
          Nothing approved yet. Approve a draft on the Drafts tab and it will line up here.
        </div></Card>
      ) : (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
          {data.slots.map((s, i) => {
            const sendable = i === 0 && !active;
            return (
              <div key={s.draftId}>
                <SlotRow
                  slot={s}
                  // Only the top slot is sendable, and only when nothing else is
                  // in flight. One send at a time — two overlapping runs would
                  // land two emails on the same person within minutes, which
                  // reads as a fault whatever the copy says.
                  canSend={sendable}
                  onSend={onSend}
                  sending={sending}
                  expanded={sendable && listOpen}
                  onToggle={onToggleList}
                />
                {sendable && listOpen && (
                  <SlotList
                    data={listData}
                    search={listSearch}
                    onSearch={onListSearch}
                    isChecked={isChecked}
                    onToggle={onToggleOne}
                    onAll={onAll}
                    onNone={onNone}
                    selectedCount={selectedCount}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {data.slots.length > 0 && !active && (
        <Card>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: '0 0 4px' }}>Send yourself a test</h2>
          <p style={{ fontSize: 13, color: MUTED, margin: '0 0 12px', lineHeight: 1.6 }}>
            One copy of <strong>{data.slots[0].subject}</strong> to any address, exactly as it would go out.
            It does not use the draft up — the real send still goes to everybody afterwards.
            The subject arrives prefixed [TEST] so you cannot mix it up later.
          </p>

          {testError && <Banner tone="bad">{testError}</Banner>}
          {testNote && <Banner tone="good">{testNote}</Banner>}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={testTo}
              onChange={(e) => onTestTo(e.target.value)}
              placeholder="you@sweetbyte.co.uk"
              style={{
                minWidth: 260, padding: '7px 11px', fontSize: 13,
                border: `1px solid ${BORDER}`, borderRadius: 7, fontFamily: 'inherit', background: CARD,
              }}
            />
            <Button tone="primary" disabled={testBusy || !testTo.trim()} onClick={() => onTest(data.slots[0].draftId)}>
              {testBusy ? 'Sending…' : 'Send a test'}
            </Button>
          </div>
        </Card>
      )}

      <div style={{ fontSize: 12, color: TERTIARY, lineHeight: 1.6, paddingBottom: 40 }}>
        The headcount is who qualifies today. The real list is fixed at the moment you press send,
        because stages keep moving in WorkTrackr. Dates after the first are a projection —
        nothing goes out on its own, you press the button each time.
      </div>
    </>
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
  const [tab, setTab]             = useState('audience');
  const [overview, setOverview]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const [audience, setAudience]   = useState(null);
  const [showList, setShowList]   = useState(false);
  const [listMode, setListMode]   = useState('included');
  const [search, setSearch]       = useState('');

  const [count, setCount]         = useState(3);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError]   = useState(null);
  const [genNote, setGenNote]     = useState(null);

  const [drafts, setDrafts]       = useState([]);
  const [filter, setFilter]       = useState('all');
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

  // The "39 people" drop-down on the sendable row. Kept separate from the
  // Audience tab's own list state so opening one does not disturb the search
  // you had typed on the other.
  const [listOpen, setListOpen]     = useState(false);
  const [listData, setListData]     = useState(null);
  const [listSearch, setListSearch] = useState('');

  // Who the next send goes to.
  //
  // ONE selection, edited from two screens — the Audience tab and the Schedule
  // drop-down are two windows onto the same ticks, not two independent lists.
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

  const loadSchedule = useCallback(async () => {
    try {
      const r = await fetch('/api/keepwarm/schedule');
      const d = await r.json();
      if (r.ok) setSchedule(d);
    } catch { /* leave the previous view on screen rather than blanking it */ }
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
    if (tab === 'schedule') loadSchedule();
    if (tab === 'sent') loadSent();
  }, [tab, loadSchedule, loadSent]);

  // While a run is queued or sending, refresh every few seconds. Stops as soon
  // as the run finishes — no point polling an idle screen forever.
  useEffect(() => {
    const active = schedule && schedule.activeRun;
    if (tab !== 'schedule' || !active) return;
    const t = setInterval(() => {
      loadSchedule();
      loadDrafts();
    }, 3000);
    return () => clearInterval(t);
  }, [tab, schedule, loadSchedule, loadDrafts]);

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

  // Same debounce as the Audience tab's search — 250ms, so typing a company
  // name is one request at the end rather than one per keystroke.
  useEffect(() => {
    if (!listOpen) return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/keepwarm/audience?show=included&q=${encodeURIComponent(listSearch || '')}`);
        const d = await r.json();
        if (r.ok) setListData(d);
      } catch { /* leave what is on screen */ }
    }, 250);
    return () => clearTimeout(t);
  }, [listOpen, listSearch]);

  // Collapse the drop-down once a send is under way. The list it was showing
  // was a projection; the moment you press send the real list is frozen, and
  // leaving the projection open beside a running send invites reading it as
  // the thing that actually went.
  useEffect(() => {
    if (schedule && schedule.activeRun) setListOpen(false);
  }, [schedule]);

  async function sendSlot(slot) {
    setSendError(null);

    // A plain confirm rather than a styled modal. This is the one irreversible
    // button on the screen and the number in it is the whole point — a custom
    // dialog would be prettier and easier to click through without reading.
    const going = handPicked ? selectedCount : slot.projectedCount;
    const ok = window.confirm(
      `Send "${slot.subject}" to ${going} ${going === 1 ? 'person' : 'people'}?`
      + (handPicked ? `\n\nYou have hand-picked these — the other ${Math.max(0, slot.projectedCount - going)} in the loop will not get it.` : '')
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
      setFilter('all');
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

  // "All" now means everything still in play. Binned ideas are deliberately not
  // in it — the point of binning one is not to look at it again.
  const shown = drafts.filter(d => (
    filter === 'all' ? d.status !== 'rejected' : d.status === filter
  ));
  const binCount = drafts.filter(d => d.status === 'rejected').length;
  const cfg = overview?.config || {};

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: BG, padding: '28px 32px' }}>
      <div style={{ maxWidth: 1100 }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: '0 0 4px' }}>Keep-warm emails</h1>
        <p style={{ fontSize: 14, color: MUTED, margin: '0 0 22px', lineHeight: 1.6 }}>
          A short email every fortnight to everyone who has already had Billy's introduction, so
          Sweetbyte stays in mind while they are still deciding. Nothing goes out on a timer —
          Studio lines the next one up and you press send.
        </p>

        <TabBar tab={tab} onPick={setTab} />

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

        {loading ? (
          <div style={{ color: MUTED, fontSize: 14 }}>Loading…</div>
        ) : (
          <>
            {tab === 'audience' && (<>
            {/* ── Audience ─────────────────────────────────────────────── */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: 0 }}>Who is in the loop</h2>
                <div style={{ fontSize: 13, color: MUTED }}>
                  {overview.stageRefresh.at
                    ? `Stages last received from WorkTrackr: ${fmt(overview.stageRefresh.at)} · ${overview.stageRefresh.withStage} of ${overview.stageRefresh.held} companies have a stage`
                    : 'WorkTrackr has not sent any stages yet'}
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
                    {(audience?.rows || []).map(r => (
                      <AudienceRow
                        key={r.email}
                        row={r}
                        selectable={listMode === 'included'}
                        checked={isChecked(r.email)}
                        onToggle={toggleOne}
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
                </div>
              )}
            </Card>

            </>)}

            {tab === 'drafts' && (<>
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
                  {f === 'all' ? 'All' : f === 'rejected' ? `Bin${binCount ? ` (${binCount})` : ''}` : STATUS_STYLE[f].label}
                </Button>
              ))}

              {filter === 'rejected' && binCount > 0 && (
                <Button tone="danger" disabled={emptying} onClick={emptyTheBin}>
                  {emptying ? 'Emptying…' : `Delete all ${binCount}`}
                </Button>
              )}
            </div>

            {filter === 'rejected' && (
              <div style={{ fontSize: 12, color: TERTIARY, margin: '-4px 0 12px', lineHeight: 1.6 }}>
                Binned emails are out of the way and will never be sent. Emptying the bin clears them
                from here for good, but Studio still remembers the subject lines so the generator does
                not write the same ideas again.
              </div>
            )}

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
            </>)}

            {tab === 'schedule' && (<>
              {schedule && schedule.activeRun && schedule.activeRun.status === 'queued' && (
                <UndoBar
                  secondsLeft={secondsLeft}
                  count={schedule.activeRun.recipientCount}
                  onUndo={undoSend}
                  undoing={undoing}
                />
              )}
              <ScheduleView
                data={schedule}
                onSend={sendSlot}
                sending={sending}
                sendError={sendError}
                listOpen={listOpen}
                onToggleList={() => setListOpen(v => !v)}
                listData={listData}
                listSearch={listSearch}
                onListSearch={setListSearch}
                isChecked={isChecked}
                onToggleOne={toggleOne}
                onAll={selectAll}
                onNone={selectNone}
                selectedCount={selectedCount}
                handPicked={handPicked}
                testTo={testTo}
                onTestTo={setTestTo}
                onTest={sendTestEmail}
                testBusy={testBusy}
                testNote={testNote}
                testError={testError}
              />
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
