// ─────────────────────────────────────────────────────────────────────────────
// Customer portal — front-end only (mock data). Renders when the URL path
// starts with /c/<customer-slug>. App.jsx detects this and mounts <PortalApp/>
// instead of the admin Studio.
//
// All data is FAKE in this file. The next chat wires real APIs by replacing
// the `mockClient`, `mockPosts`, etc. constants with fetch calls to
// /api/portal/* endpoints. The component shapes don't change.
//
// Sections:
//   - utility constants & tiny helpers
//   - PortalApp: the route shell + auth gate
//   - PortalLogin: login form
//   - PortalChrome: shared sidebar + header layout used by every authenticated page
//   - PortalPosts: LinkedIn posts grid + edit modal + regen confirmation
//   - PortalInbox: replies table + reply detail + compose
//   - PortalCampaigns: read-only campaign list with stats
//   - PortalSettings: change password, manage users, view branding
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useRef } from 'react';

// Brand colours — match the admin Studio for visual consistency.
// Sweetbyte palette (2026-09-02). Constant names kept for minimal diff:
// TGA_GREEN = sidebar navy, TGA_GREEN_HI = primary cyan, TGA_GREEN_LO = muted.
const TGA_GREEN     = '#0F1D3F';
const TGA_GREEN_HI  = '#1EA4C9';
const TGA_GREEN_LO  = '#B9CEDF';
const TEXT          = '#1a1a1a';
const MUTED         = '#5f5e5a';
const TERTIARY_TEXT = '#888780';
const BORDER        = '#e5e3dd';
const CARD          = '#ffffff';
const BG            = '#f5f5f3';
const BLUE          = '#185FA5';
const BLUE_BG       = '#E6F1FB';
const DANGER        = '#A32D2D';
const GREEN         = '#135AA0';  // strong blue — status text on tint
const GREEN_BG      = '#E4F4FA';
const AMBER         = '#854F0B';
const AMBER_BG      = '#FAEEDA';

// ── Status + tag-colour helpers (mirror of CrmHotProspects.jsx) ──────────────
// Three fixed pipeline statuses + bounded 8-colour palette for the
// customer-chosen override. Kept in step with the admin file — when one
// changes, change the other.

const PORTAL_STATUS_OPTIONS = [
  { value: 'new',         label: 'New',         bg: '#E6F1FB', fg: '#0C447C' },
  { value: 'contacted',   label: 'Contacted',   bg: '#E4F4FA', fg: '#135AA0' },
  { value: 'no_response', label: 'No response', bg: '#F1EFE8', fg: '#5F5E5A' },
];

const PORTAL_TAG_COLORS = [
  { value: null,     label: 'Default',  bg: null,      fg: null      },
  { value: 'red',    label: 'Red',      bg: '#FAECE7', fg: '#793F1F' },
  { value: 'orange', label: 'Orange',   bg: '#FAEEDA', fg: '#854F0B' },
  { value: 'yellow', label: 'Yellow',   bg: '#FFF7C2', fg: '#5C4A05' },
  { value: 'green',  label: 'Green',    bg: '#E4F4FA', fg: '#135AA0' },
  { value: 'blue',   label: 'Blue',     bg: '#E6F1FB', fg: '#0C447C' },
  { value: 'purple', label: 'Purple',   bg: '#EEEDFE', fg: '#3C3489' },
  { value: 'pink',   label: 'Pink',     bg: '#FCE7F2', fg: '#83215E' },
  { value: 'grey',   label: 'Grey',     bg: '#EAEAE6', fg: '#3a3a3a' },
];

function portalResolveProspectChrome(prospect) {
  const statusEntry = PORTAL_STATUS_OPTIONS.find(s => s.value === (prospect?.status || 'new')) || PORTAL_STATUS_OPTIONS[0];
  if (prospect?.tag_color) {
    const colorEntry = PORTAL_TAG_COLORS.find(c => c.value === prospect.tag_color);
    if (colorEntry && colorEntry.bg) {
      return { bg: colorEntry.bg, fg: colorEntry.fg, statusLabel: statusEntry.label };
    }
  }
  return { bg: statusEntry.bg, fg: statusEntry.fg, statusLabel: statusEntry.label };
}

// ── MOCK DATA ────────────────────────────────────────────────────────────────
// These get replaced with fetch calls in the backend chat. The shapes here
// are what the API will need to return.

const mockClient = {
  slug: 'tower-leasing',
  name: 'Tower Leasing',
  audience: 'Asset finance · authority brand',
  logo_initial: 'TL',
  logo_color: '#1a4d8c',
};

const mockPosts = Array.from({ length: 12 }).map((_, i) => ({
  id: `post_${i + 1}`,
  order: i + 1,
  scheduled_for: ['Tue 08:00', 'Thu 08:30', 'Fri 09:00', 'Mon 08:00', 'Wed 09:30',
                  'Thu 08:00', 'Mon 09:00', 'Wed 08:30', 'Fri 09:00', 'Tue 08:30',
                  'Thu 09:00', 'Mon 08:30'][i],
  category: ['Authority', 'Authority', 'Education', 'Commercial', 'Education',
             'Authority', 'Commercial', 'Education', 'Authority', 'Commercial',
             'Education', 'Authority'][i],
  title: ['Cost of delay — real numbers',
          'Banks assess SMEs like spreadsheets',
          'How asset finance actually works',
          'Objection handling — debt is risky',
          'Six-month window to act',
          'Hidden cost of waiting',
          'When leasing beats cash',
          'Reading the fine print',
          'What the FD won\'t tell you',
          'A simple test before you sign',
          'The depreciation curve',
          'One question to ask your accountant'][i],
  body: 'A manufacturing business I spoke to last month had a packaging line that kept jamming.\n\nThree months of overtime. Missed delivery windows. A major client starting to look elsewhere.\n\nThey could have replaced it for £80k. They didn\'t. The cost of delay was £500k.\n\nMost SMEs underestimate the cost of doing nothing. The real risk isn\'t the new investment — it\'s the lost revenue from holding off.',
  image_color: ['#1a3a4d', '#4d2a1a', '#2a4d2a', '#4d1a3a', '#3a4d1a',
                '#1a4d3a', '#4d3a1a', '#1a3a4d', '#3a1a4d', '#4d1a2a',
                '#1a4d2a', '#2a1a4d'][i],
  approved: i < 3,  // first 3 are approved in the demo
}));

const mockReplies = [
  { id: 'r1', from_name: 'Nikhil Mundada', from_addr: 'nik@fronthunt-australia.com', subject: 'Streamlining your home sale process — quick question', snippet: 'Thanks for reaching out — could you share a bit more about how this would integrate with our existing CRM?', received_at: '2026-04-29T10:23:00Z', classification: 'positive', auto_unsubscribed: false, campaign_title: 'Q1 Asset finance authority', step_number: 2 },
  { id: 'r2', from_name: 'Jinsong Guo',     from_addr: 'jinsong@unlimidata.co',       subject: 'Logo design process — a few clarifications needed', snippet: 'Yes, very interested. Can we book in a 20 minute call this week?', received_at: '2026-04-29T08:11:00Z', classification: 'positive', auto_unsubscribed: false, campaign_title: 'Q1 Asset finance authority', step_number: 1 },
  { id: 'r3', from_name: 'Cole',             from_addr: 'cole@formspree.io',          subject: 'Route your submissions with form rules', snippet: 'Please remove me from this list. Not interested.', received_at: '2026-05-03T14:50:00Z', classification: 'hard_negative', auto_unsubscribed: true, campaign_title: 'Q1 Asset finance authority', step_number: 1 },
  { id: 'r4', from_name: 'Google',           from_addr: 'no-reply@accounts.google.com',subject: 'Security alert', snippet: 'A new sign-in was detected on your Google account.', received_at: '2026-05-06T07:33:00Z', classification: 'neutral', auto_unsubscribed: false, campaign_title: null, step_number: null },
  { id: 'r5', from_name: 'Lauren Squitieri', from_addr: 'lauren@joincubesoftware.com', subject: 'Boost your lead game — automated emails', snippet: 'Out of office until 8 May.', received_at: '2026-04-30T09:00:00Z', classification: 'auto_reply', auto_unsubscribed: false, campaign_title: 'Q1 Asset finance authority', step_number: 1 },
];

const mockCampaigns = [
  { id: 'c1', title: 'Q1 Asset finance authority', status: 'sending', sent: 412, queued: 123, opens: 12, clicks: 3, replies: 7, tracking_off: false, started_at: '2026-04-12' },
  { id: 'c2', title: 'Q4 Construction sector',     status: 'sent',    sent: 535, queued: 0,   opens: 0,  clicks: 0, replies: 9, tracking_off: true,  started_at: '2026-01-08' },
  { id: 'c3', title: 'Hospitality decision-maker outreach', status: 'sent', sent: 300, queued: 0, opens: 0, clicks: 0, replies: 8, tracking_off: true,  started_at: '2025-11-20' },
];

// Aggregate stats — what the dashboard headline shows.
function aggregateStats(campaigns) {
  const sent = campaigns.reduce((a, c) => a + c.sent, 0);
  const trackable = campaigns.filter(c => !c.tracking_off).reduce((a, c) => a + c.sent, 0);
  const opens = campaigns.reduce((a, c) => a + c.opens, 0);
  const clicks = campaigns.reduce((a, c) => a + c.clicks, 0);
  const replies = campaigns.reduce((a, c) => a + c.replies, 0);
  const untracked = sent - trackable;
  const openRate  = trackable > 0 ? Math.round((opens / trackable) * 1000) / 10 : 0;
  const clickRate = trackable > 0 ? Math.round((clicks / trackable) * 1000) / 10 : 0;
  return { sent, trackable, opens, clicks, replies, untracked, openRate, clickRate };
}

// ── ROOT ─────────────────────────────────────────────────────────────────────
export default function PortalApp({ slug }) {
  // null = checking session, false = need login, object = authenticated user
  const [authUser, setAuthUser] = useState(null);
  const [client,   setClient]   = useState(null);
  const [services, setServices] = useState(null);

  // If the URL has ?reset=<token>, we're on the reset-password leg of the flow.
  // The reset screen takes priority over login/dashboard until the user either
  // submits successfully (returns to login) or navigates away.
  const [resetToken] = useState(() => {
    const m = window.location.search.match(/[?&]reset=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  });

  // Real auth check — calls /api/portal/auth/check which validates the
  // HttpOnly session cookie set by the login route.
  useEffect(() => {
    if (resetToken) { setAuthUser(false); return; }  // skip; reset screen will mount
    fetch('/api/portal/auth/check', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.user) {
          setAuthUser(d.user);
          setClient(d.client);
          setServices(d.services);
        } else {
          setAuthUser(false);
        }
      })
      .catch(() => setAuthUser(false));
  }, [slug, resetToken]);

  function handleLogin({ user, client, services }) {
    setAuthUser(user);
    setClient(client);
    setServices(services);
  }
  async function handleLogout() {
    try { await fetch('/api/portal/auth/logout', { method:'POST', credentials:'include' }); } catch {}
    setAuthUser(false);
    setClient(null);
    setServices(null);
  }

  if (resetToken) {
    return <PortalResetPassword slug={slug} token={resetToken} />;
  }

  if (authUser === null) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:BG }}>
        <div style={{ width:32, height:32, border:`3px solid ${TGA_GREEN_HI}`, borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!authUser) {
    return <PortalLogin slug={slug} onLogin={handleLogin} />;
  }

  return <PortalChrome user={authUser} client={client} services={services} onLogout={handleLogout} />;
}

// ── LOGIN ────────────────────────────────────────────────────────────────────
function PortalLogin({ slug, onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');
  const [clientName, setClientName] = useState('');
  const [showForgot, setShowForgot] = useState(false);

  // Resolve the slug → client name from /api/portal/by-slug/:slug. If the
  // slug doesn't match any client, fall back to a Title-Case rendering of
  // the slug so the page still looks reasonable. We don't show an explicit
  // "client not found" error here because that would let an attacker probe
  // for valid slugs from outside the portal.
  useEffect(() => {
    fetch(`/api/portal/by-slug/${encodeURIComponent(slug)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.client_name) setClientName(d.client_name);
        else setClientName(slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '));
      })
      .catch(() => setClientName(slug));
  }, [slug]);

  async function submit(e) {
    e?.preventDefault();
    if (!username || !password) {
      setErr('Username and password required');
      return;
    }
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/portal/auth/login', {
        method:'POST',
        credentials:'include',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ slug, username, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setErr(d.error || 'Invalid credentials');
        setBusy(false);
        return;
      }
      onLogin({ user: d.user, client: d.client, services: d.services });
    } catch (e2) {
      setErr('Network error — try again.');
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:BG, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <form onSubmit={submit} style={{
        maxWidth:400, width:'100%', padding:'32px 28px',
        background:CARD, borderRadius:12, border:`0.5px solid ${BORDER}`,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:28 }}>
          <div style={{
            width:36, height:36, borderRadius:8, background:TGA_GREEN_HI,
            color:'white', display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:16, fontWeight:500,
          }}>G</div>
          <div>
            <div style={{ fontSize:18, fontWeight:500, color:TEXT }}>Sweetbyte</div>
            <div style={{ fontSize:12, color:MUTED, marginTop:2 }}>Studio · {clientName} portal</div>
          </div>
        </div>

        <Field label="Username">
          <input type="text" value={username} onChange={e => setUsername(e.target.value)}
            autoFocus disabled={busy}
            placeholder="your username"
            style={loginInputStyle()}
          />
        </Field>

        <Field label="Password">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            disabled={busy}
            style={loginInputStyle()}
          />
        </Field>

        {err && <div style={{ color:DANGER, fontSize:12, marginTop:8 }}>{err}</div>}

        <button type="submit" disabled={busy} style={{
          width:'100%', padding:10, fontSize:13, fontWeight:500,
          background: busy ? TGA_GREEN_LO : TGA_GREEN_HI, color:'#0F1D3F',
          border:'none', borderRadius:8, cursor: busy ? 'default' : 'pointer',
          marginTop:12,
        }}>{busy ? 'Signing in…' : 'Sign in'}</button>

        <a onClick={() => setShowForgot(true)}
          style={{ display:'block', textAlign:'center', marginTop:14, fontSize:12, color:BLUE, cursor:'pointer' }}
        >Forgot password?</a>
      </form>

      {showForgot && <ForgotPasswordModal slug={slug} onClose={() => setShowForgot(false)} />}
    </div>
  );
}

// ── FORGOT-PASSWORD MODAL ────────────────────────────────────────────────────
// Asks for an email, posts to /api/portal/auth/forgot-password, and shows a
// confirmation message regardless of whether the email matched a real user
// (the backend always returns 200 to avoid leaking whether an email exists).
function ForgotPasswordModal({ slug, onClose }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy]   = useState(false);
  const [done, setDone]   = useState(false);

  async function submit() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await fetch('/api/portal/auth/forgot-password', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ slug, email: email.trim() }),
      });
    } catch {}
    setBusy(false);
    setDone(true);
  }

  return (
    <Modal title="Reset your password" onClose={onClose}>
      {done ? (
        <div>
          <p style={{ fontSize:13, color:TEXT, lineHeight:1.5, margin:'0 0 16px' }}>
            If an account exists for <strong>{email}</strong>, we've sent a reset link to it.
            Check your inbox in the next minute or two — the link is valid for 1 hour.
          </p>
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <BtnPrimary onClick={onClose}>Done</BtnPrimary>
          </div>
        </div>
      ) : (
        <div>
          <p style={{ fontSize:13, color:TEXT, lineHeight:1.5, margin:'0 0 14px' }}>
            Enter the email address tied to your portal account. We'll send a reset link.
          </p>
          <Field label="Email address">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              autoFocus disabled={busy} style={loginInputStyle()}
              placeholder="you@yourcompany.co.uk"
            />
          </Field>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
            <BtnSecondary onClick={onClose} disabled={busy}>Cancel</BtnSecondary>
            <BtnPrimary onClick={submit} disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send reset link'}
            </BtnPrimary>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── RESET-PASSWORD SCREEN ────────────────────────────────────────────────────
// Mounted when the URL is /c/<slug>?reset=<token>. Validates locally that
// the new password meets minimum length, then posts to the backend. On success,
// strips the ?reset= query and reloads to land on the login page so the user
// signs in fresh (per the locked-in pre-decision: reset kills all sessions).
function PortalResetPassword({ slug, token }) {
  const [pw1, setPw1]   = useState('');
  const [pw2, setPw2]   = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [done, setDone] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    if (pw1.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (pw1 !== pw2)    { setErr('Passwords don\'t match'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/portal/auth/reset-password', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ token, new: pw1 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setErr(d.error || 'Could not reset password.');
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setErr('Network error — try again.');
      setBusy(false);
    }
  }

  function goToLogin() {
    // Strip the ?reset= param and reload so PortalApp lands on PortalLogin.
    window.location.href = `/c/${encodeURIComponent(slug)}`;
  }

  return (
    <div style={{ minHeight:'100vh', background:BG, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <form onSubmit={submit} style={{
        maxWidth:400, width:'100%', padding:'32px 28px',
        background:CARD, borderRadius:12, border:`0.5px solid ${BORDER}`,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:24 }}>
          <div style={{
            width:36, height:36, borderRadius:8, background:TGA_GREEN_HI,
            color:'white', display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:16, fontWeight:500,
          }}>G</div>
          <div>
            <div style={{ fontSize:18, fontWeight:500, color:TEXT }}>Set a new password</div>
            <div style={{ fontSize:12, color:MUTED, marginTop:2 }}>Sweetbyte Studio portal</div>
          </div>
        </div>

        {done ? (
          <div>
            <div style={{
              padding:'10px 12px', background:GREEN_BG, color:GREEN,
              borderRadius:8, fontSize:13, marginBottom:16, lineHeight:1.5,
            }}>
              Password updated. Sign in with your new password to continue.
            </div>
            <button type="button" onClick={goToLogin} style={{
              width:'100%', padding:10, fontSize:13, fontWeight:500,
              background: TGA_GREEN_HI, color:'#0F1D3F',
              border:'none', borderRadius:8, cursor:'pointer',
            }}>Go to sign in</button>
          </div>
        ) : (
          <>
            <Field label="New password (8+ characters)">
              <input type="password" value={pw1} onChange={e => setPw1(e.target.value)}
                autoFocus disabled={busy} style={loginInputStyle()} />
            </Field>
            <Field label="Confirm new password">
              <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
                disabled={busy} style={loginInputStyle()} />
            </Field>
            {err && <div style={{ color:DANGER, fontSize:12, marginTop:6 }}>{err}</div>}
            <button type="submit" disabled={busy} style={{
              width:'100%', padding:10, fontSize:13, fontWeight:500,
              background: busy ? TGA_GREEN_LO : TGA_GREEN_HI, color:'#0F1D3F',
              border:'none', borderRadius:8, cursor: busy ? 'default' : 'pointer',
              marginTop:12,
            }}>{busy ? 'Updating…' : 'Set new password'}</button>
          </>
        )}
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:12, color:MUTED, marginBottom:4 }}>{label}</label>
      {children}
    </div>
  );
}

function loginInputStyle() {
  return {
    width:'100%', boxSizing:'border-box', padding:'9px 10px', fontSize:13,
    border:`0.5px solid ${BORDER}`, borderRadius:8, outline:'none',
    color:TEXT, background:CARD,
  };
}

// ── CHROME (sidebar + header + page router) ──────────────────────────────────
function PortalChrome({ user, client, services, onLogout }) {
  const [page, setPage] = useState('posts');  // posts | inbox | campaigns | settings | facebook (future) | hot_prospects
  // Cross-page handoff: when the customer clicks "Open in CRM" from inside an
  // inbox email's Hot-Prospects banner, we set this state to the prospect id
  // then flip the page to 'hot_prospects'. PortalHotProspects reads it on
  // mount, opens the matching prospect's detail modal, and calls the clearer
  // so subsequent visits don't auto-open it again. State is lifted to the
  // chrome (not localStorage) because everything lives inside one component
  // tree — simpler and survives a stale tab.
  const [crmOpenProspectId, setCrmOpenProspectId] = useState(null);
  function navigateToCrmWithProspect(prospectId) {
    setCrmOpenProspectId(prospectId || null);
    setPage('hot_prospects');
  }

  // Live due-follow-ups badge for the Hot Prospects nav item. Counts overdue
  // + due-today across this customer's linked email rows (scoped by the
  // server, not aggregated like admin). Refreshes on a 30s tick and also
  // listens for an in-app event the CRM screen dispatches when prospects are
  // mutated, so the badge drops the instant the customer marks a prospect
  // converted (no waiting for the next tick).
  const [hotProspectsDue, setHotProspectsDue] = useState(0);
  // Unread count — prospects this portal session hasn't opened yet. Drives
  // the green badge on the Hot Prospects nav item. Separate state from the
  // due-counts above because the two signals mean different things and a
  // prospect can be both (overdue follow-up AND not yet viewed).
  const [hotProspectsUnread, setHotProspectsUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function fetchDue() {
      try {
        const r = await fetch('/api/portal/hot-prospects/due-counts', { credentials:'include' });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setHotProspectsDue(Number(d.total || 0));
      } catch {} // backend not yet deployed — silently ignore
    }
    async function fetchUnread() {
      try {
        const r = await fetch('/api/portal/hot-prospects/unread-count', { credentials:'include' });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setHotProspectsUnread(Number(d.count || 0));
      } catch {} // backend not yet deployed — silently ignore
    }
    fetchDue();
    fetchUnread();
    const t = setInterval(() => { fetchDue(); fetchUnread(); }, 30_000);
    function onMutation() { fetchDue(); fetchUnread(); }
    window.addEventListener('studio:hot-prospects-changed', onMutation);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener('studio:hot-prospects-changed', onMutation);
    };
  }, []);

  // The portal sidebar always shows EVERY service (per Wez's locked-in
  // pre-decision — discoverability over hidden tabs). What changes is what
  // each tab renders inside, based on the `services` object from the server.
  // Each entry is { state, label, pitch }. State is one of: 'enabled' /
  // 'not_required' / 'coming_soon'. ServiceGate handles the latter two with
  // service-specific sales pitch text from `pitch`.
  const svc = services || {
    email:           { state:'enabled',     label:'Email',           pitch:null },
    linkedin:        { state:'enabled',     label:'LinkedIn Posts',  pitch:null },
    instagram:       { state:'coming_soon', label:'Instagram',       pitch:null },
    tiktok:          { state:'coming_soon', label:'TikTok',          pitch:null },
    facebook_pixels: { state:'coming_soon', label:'Meta Pixels', pitch:null },
    facebook_ads:    { state:'not_required', label:'Facebook Ads',   pitch:null },
  };

  return (
    <div style={{ display:'flex', height:'100vh', background:BG, fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Global keyframes for spinner overlays used across the portal
          (post regen, approve buttons, etc.). Injected once at chrome level
          so every authenticated page can use animation: spin without
          re-declaring the @keyframes. */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {/* Sidebar */}
      <aside style={{
        width:220, background:TGA_GREEN, color:TGA_GREEN_LO,
        display:'flex', flexDirection:'column', flexShrink:0,
      }}>
        {/* Brand block — clearly delineated from nav with a divider below */}
        <div style={{
          padding:'20px 18px', borderBottom:'0.5px solid rgba(255,255,255,0.1)',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <div style={{
            width:30, height:30, borderRadius:7, background:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center',
            flexShrink:0, padding:3, boxSizing:'border-box',
          }}>
            <img src="/sweetbyte-logo.png" alt="Sweetbyte"
              style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }}
            />
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:500, color:'white', lineHeight:1.2 }}>Sweetbyte</div>
            <div style={{ fontSize:11, color:TGA_GREEN_LO, marginTop:2 }}>Studio</div>
          </div>
        </div>

        {/* Nav — three sections (Social media, Email, Account). Each has a
            small-caps heading, then nav items. Generous gap between sections
            so the eye can group them. */}
        <nav style={{ flex:1, padding:'14px 0', display:'flex', flexDirection:'column', gap:18 }}>
          <NavSection heading="Social media">
            <NavItem label="LinkedIn Posts"
              active={page==='posts'}
              onClick={() => setPage('posts')}
              dim={svc.linkedin?.state === 'not_required'}
            />
            <NavItem label="Instagram"
              active={page==='instagram'}
              onClick={() => setPage('instagram')}
              dim={svc.instagram?.state !== 'enabled'}
            />
            <NavItem label="TikTok"
              active={page==='tiktok'}
              onClick={() => setPage('tiktok')}
              dim={svc.tiktok?.state !== 'enabled'}
            />
            <NavItem label="Meta Pixels"
              active={page==='facebook_pixels'}
              onClick={() => setPage('facebook_pixels')}
              dim={svc.facebook_pixels?.state !== 'enabled'}
            />
            <NavItem label="Facebook Ads"
              active={page==='facebook_ads'}
              onClick={() => setPage('facebook_ads')}
              dim={svc.facebook_ads?.state !== 'enabled'}
            />
          </NavSection>

          <NavSection heading="Email">
            <NavItem label="Inbox"
              active={page==='inbox'}
              onClick={() => setPage('inbox')}
              dim={svc.email?.state === 'not_required'}
            />
            <NavItem label="Campaigns"
              active={page==='campaigns'}
              onClick={() => setPage('campaigns')}
              dim={svc.email?.state === 'not_required'}
            />
          </NavSection>

          {/* CRM — currently one entry (Hot Prospects). Section heading set
              up so adding more lists later (Warm prospects, Lost deals,
              etc.) is a single NavItem addition with no sidebar rearrange.
              Visible regardless of Email subscription state — Hot Prospects
              is its own feature, decoupled from cold-email sending. */}
          <NavSection heading="CRM">
            <NavItem label="Hot Prospects"
              active={page==='hot_prospects'}
              onClick={() => setPage('hot_prospects')}
              badge={hotProspectsDue}
              unreadBadge={hotProspectsUnread}
            />
          </NavSection>

          <NavSection heading="Account">
            <NavItem label="Settings"
              active={page==='settings'}
              onClick={() => setPage('settings')}
            />
          </NavSection>
        </nav>

        {/* Sign out — pinned to the bottom, its own visual zone via top border */}
        <div style={{
          padding:'14px 18px', borderTop:'0.5px solid rgba(255,255,255,0.1)',
        }}>
          <button onClick={onLogout} style={{
            background:'transparent', border:'none', color:TGA_GREEN_LO,
            fontSize:12, padding:0, cursor:'pointer',
          }}>Sign out</button>
        </div>
      </aside>

      {/* Workspace */}
      <main style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        <header style={{
          padding:'18px 22px', borderBottom:`0.5px solid ${BORDER}`,
          display:'flex', alignItems:'center', gap:14, background:CARD,
        }}>
          {/* Customer logo — uses the uploaded logo URL if available, falls
              back to initials on the brand colour. Box is fixed-size so both
              states have the same footprint. */}
          {client?.logo_url ? (
            <img src={client.logo_url} alt={`${client.name} logo`}
              style={{
                width:72, height:72, borderRadius:10,
                objectFit:'contain', flexShrink:0, display:'block',
              }}
            />
          ) : (
            <div style={{
              width:72, height:72, borderRadius:10, background:client?.logo_color || '#1a4d8c',
              color:'white', display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:22, fontWeight:500, flexShrink:0,
            }}>{client?.logo_initial || 'C'}</div>
          )}
          <div>
            <div style={{ fontSize:17, fontWeight:500, color:TEXT }}>{client?.name}</div>
            <div style={{ fontSize:11, color:MUTED }}>{client?.audience}</div>
          </div>
          {/* "Refine my posts" — customer-facing override-rules editor.
              Only shown when LinkedIn is enabled for this customer, because
              the rules are LinkedIn-post-specific. The button opens a modal
              (RefinePostsModal) for adding/editing/deleting numbered
              constraints. Future generations apply the latest rules; existing
              posts in awaiting_approval don't change. */}
          {svc.linkedin?.state === 'enabled' && (
            <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
              <RefinePostsButton />
              <div style={{
                padding:'5px 10px', fontSize:11, color:MUTED,
                border:`0.5px solid ${BORDER}`, borderRadius:999,
              }}>{user.email || user.username}</div>
            </div>
          )}
          {svc.linkedin?.state !== 'enabled' && (
            <div style={{
              marginLeft:'auto', padding:'5px 10px', fontSize:11, color:MUTED,
              border:`0.5px solid ${BORDER}`, borderRadius:999,
            }}>{user.email || user.username}</div>
          )}
        </header>

        <div style={{ flex:1, overflow:'auto', padding:'20px 22px' }}>
          {page === 'posts' && (
            <ServiceGate svc={svc.linkedin} serviceName="LinkedIn Posts">
              <PortalPosts />
            </ServiceGate>
          )}
          {page === 'inbox' && (
            <ServiceGate svc={svc.email} serviceName="Inbox">
              <PortalInbox onNavigateToCrm={navigateToCrmWithProspect} />
            </ServiceGate>
          )}
          {page === 'campaigns' && (
            <ServiceGate svc={svc.email} serviceName="Campaigns">
              <PortalCampaigns />
            </ServiceGate>
          )}
          {/* CRM Hot Prospects — not gated by ServiceGate. Hot Prospects is
              its own feature, available regardless of email-service state. */}
          {page === 'hot_prospects' && (
            <PortalHotProspects
              autoOpenProspectId={crmOpenProspectId}
              onAutoOpenConsumed={() => setCrmOpenProspectId(null)}
            />
          )}
          {page === 'instagram' && (
            <ServiceGate svc={svc.instagram} serviceName="Instagram">
              <div />
            </ServiceGate>
          )}
          {page === 'tiktok' && (
            <ServiceGate svc={svc.tiktok} serviceName="TikTok">
              <div />
            </ServiceGate>
          )}
          {page === 'facebook_pixels' && (
            <ServiceGate svc={svc.facebook_pixels} serviceName="Meta Pixels">
              <PortalMetaPixels />
            </ServiceGate>
          )}
          {page === 'facebook_ads' && (
            <ServiceGate svc={svc.facebook_ads} serviceName="Facebook Ads">
              <PortalFacebookAds />
            </ServiceGate>
          )}
          {page === 'settings'  && <PortalSettings user={user} client={client} services={svc} />}
        </div>
      </main>
    </div>
  );
}

// ── SERVICE GATE ─────────────────────────────────────────────────────────────
// Wraps each service tab so customers who aren't subscribed see service-
// specific sales copy instead of empty data. Reads the new services object
// shape from /api/portal/auth/check: { state, label, pitch }.
//
// From the customer's perspective there are only two visible states: enabled
// (they have the service, render the real tab) or not subscribed (show the
// sales pitch). The DB-level distinction between 'coming_soon' (no admin
// tools yet, can't be subscribed) and 'not_required' (admin tools exist but
// this customer hasn't subscribed) only matters to the admin's Manage panel.
// The customer doesn't need to care — they just see "Not Subscribed" with a
// sales pitch explaining what they'd get.
function ServiceGate({ svc, serviceName, children }) {
  // Defensive — if /auth/check ever returns the legacy string shape (e.g. an
  // older browser tab cached it), behave as if the service is gated.
  const state = (svc && typeof svc === 'object') ? svc.state : svc;
  const pitch = (svc && typeof svc === 'object') ? svc.pitch : null;

  if (state === 'enabled') return children;

  return (
    <div>
      <h2 style={pageTitle()}>{serviceName}</h2>
      <div style={{
        marginTop:18, padding:'40px 32px', background:CARD,
        borderRadius:8, border:`0.5px dashed ${BORDER}`,
        textAlign:'center',
      }}>
        <div style={{
          display:'inline-block', padding:'5px 11px', fontSize:11,
          background:'#f4f1e8', color:MUTED,
          borderRadius:4, fontWeight:500, marginBottom:18,
        }}>Not Subscribed</div>

        <div style={{
          fontSize:15, color:TEXT, lineHeight:1.6, maxWidth:540, margin:'0 auto', fontWeight:400,
        }}>
          {pitch || `${serviceName} isn't part of your current plan.`}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar primitives ──────────────────────────────────────────────────────
//
// Three-section layout (Social posts / Email / Account):
//   - NavSection  : section heading + the items beneath it
//   - NavItem     : single nav row, with active accent bar on the left edge
//                   matching the admin sidebar's visual language
//
// `dim` softens an item that's not subscribed (so Andrea sees Inbox/Campaigns
// in the sidebar even when her plan doesn't include email — but they read as
// secondary, with the gate panel explaining "Not required" when she clicks).
// `suffix` appends a small label like "Soon" for coming_soon services.
function NavSection({ heading, children }) {
  return (
    <div>
      <div style={{
        // Bolder section headings — more weight, brighter colour, slightly
        // larger so they read as proper structural labels rather than a hint.
        fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em',
        color:'rgba(255,255,255,0.85)', padding:'0 18px', marginBottom:8,
      }}>{heading}</div>
      <div style={{ display:'flex', flexDirection:'column' }}>{children}</div>
    </div>
  );
}

function NavItem({ label, active, onClick, dim, suffix, badge, unreadBadge }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display:'flex', alignItems:'center', gap:8,
        padding:'7px 18px',
        background: active ? 'rgba(255,255,255,0.1)' : (hover ? 'rgba(255,255,255,0.04)' : 'transparent'),
        // Left accent bar — matches the admin sidebar style. Always 2px so
        // hover/active don't change layout, just colour.
        borderLeft: active ? '2px solid #1EA4C9' : '2px solid transparent',
        borderTop:'none', borderRight:'none', borderBottom:'none',
        color: active ? '#fff' : (dim ? 'rgba(255,255,255,0.4)' : TGA_GREEN_LO),
        fontSize:12.5, textAlign:'left', cursor:'pointer', userSelect:'none',
        width:'100%',
      }}>
      <span style={{ flex:1 }}>{label}</span>
      {/* Unread count badge — green pill, lower priority than urgent. Shows
          when there are prospects the portal session hasn't viewed yet.
          Separate from the urgent badge because they signal different things
          (unread = "look at this", urgent = "act now") and a row can be both. */}
      {unreadBadge > 0 && (
        <span style={{
          background:'#135AA0', color:'#fff', fontSize:10, fontWeight:600,
          padding:'1px 6px', borderRadius:8, minWidth:14, textAlign:'center',
          lineHeight:1.4,
        }}>{unreadBadge}</span>
      )}
      {/* Urgent count badge — red pill (matches admin sidebar's urgent badge
          variant). Only renders when badge > 0. Used by Hot Prospects to
          surface overdue + due-today follow-ups. */}
      {badge > 0 && (
        <span style={{
          background:'#A32D2D', color:'#fff', fontSize:10, fontWeight:600,
          padding:'1px 6px', borderRadius:8, minWidth:14, textAlign:'center',
          lineHeight:1.4,
        }}>{badge}</span>
      )}
      {suffix && (
        <span style={{
          fontSize:9, fontWeight:500, padding:'1px 6px',
          background:'rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.7)',
          borderRadius:3, letterSpacing:'0.04em', textTransform:'uppercase',
        }}>{suffix}</span>
      )}
    </button>
  );
}

// ── REFINE MY POSTS ──────────────────────────────────────────────────────────
// The "Refine my posts" button + modal that live in the portal header.
// Customers add numbered constraints ("Don't mention machinery breakdowns",
// "Don't talk about stress") that override the LinkedIn algorithm and the
// RAG document. Rules apply to FUTURE post generation only — existing posts
// keep what they have. Edits/deletes invalidate any cached prompt context on
// the backend (rules are read fresh on every generate/regen call).
//
// Limits: max 50 rules, each up to 500 characters. Server-enforced via the
// PUT /api/portal/content-rules endpoint; UI enforces too so the user doesn't
// hit a 400 by accident.
const REFINE_RULE_MAX_LEN    = 500;
const REFINE_RULES_MAX_COUNT = 50;

function RefinePostsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        padding:'6px 12px', fontSize:11, fontWeight:500,
        background:GREEN_BG, color:GREEN,
        border:`0.5px solid ${GREEN}33`, borderRadius:999, cursor:'pointer',
        display:'flex', alignItems:'center', gap:6,
      }}>
        <span style={{ fontSize:12 }}>✦</span>
        Refine my posts
      </button>
      {open && <RefinePostsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function RefinePostsModal({ onClose }) {
  // Lifecycle: null = loading, [] = loaded empty, [...] = loaded with rules.
  const [rules, setRules]   = useState(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);
  const [draft, setDraft]   = useState(''); // new-rule input

  useEffect(() => {
    fetch('/api/portal/content-rules', { credentials:'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => setRules(Array.isArray(d.rules) ? d.rules : []))
      .catch(e => { setError(`Couldn't load rules: ${e}`); setRules([]); });
  }, []);

  function addRule() {
    const text = draft.trim();
    if (!text) return;
    if (text.length > REFINE_RULE_MAX_LEN) {
      setError(`Each rule can be at most ${REFINE_RULE_MAX_LEN} characters.`);
      return;
    }
    if ((rules || []).length >= REFINE_RULES_MAX_COUNT) {
      setError(`You can have at most ${REFINE_RULES_MAX_COUNT} rules.`);
      return;
    }
    if ((rules || []).some(r => r.text.trim().toLowerCase() === text.toLowerCase())) {
      setError('That rule already exists.');
      return;
    }
    setError(null);
    setRules(prev => [...(prev || []), { id: cryptoRandomId(), text }]);
    setDraft('');
  }

  function updateRule(id, text) {
    setRules(prev => (prev || []).map(r => r.id === id ? { ...r, text } : r));
  }

  function deleteRule(id) {
    setRules(prev => (prev || []).filter(r => r.id !== id));
  }

  async function save() {
    if (busy) return;
    // Validate before sending.
    const cleaned = (rules || [])
      .map(r => ({ id: r.id, text: (r.text || '').trim() }))
      .filter(r => r.text.length > 0);
    for (const r of cleaned) {
      if (r.text.length > REFINE_RULE_MAX_LEN) {
        setError(`Each rule can be at most ${REFINE_RULE_MAX_LEN} characters.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/portal/content-rules', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: cleaned }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onClose();
    } catch (e) {
      setError(`Couldn't save: ${e.message}`);
      setBusy(false);
    }
  }

  return (
    <div onClick={busy ? null : onClose} style={{
      position:'fixed', inset:0, background:'rgba(20,20,18,0.45)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:CARD, borderRadius:12, padding:'24px 28px',
        width:'min(640px, 100%)', maxHeight:'80vh', display:'flex', flexDirection:'column',
        boxShadow:'0 8px 28px rgba(0,0,0,0.18)',
      }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontSize:16, fontWeight:500, color:TEXT }}>Refine my posts</div>
          <button onClick={busy ? null : onClose} disabled={busy} style={{
            background:'transparent', border:'none', fontSize:18, color:MUTED, cursor:busy?'default':'pointer', padding:'2px 6px',
          }} aria-label="Close">×</button>
        </div>
        <div style={{ fontSize:12, color:MUTED, lineHeight:1.5, marginBottom:14 }}>
          Add rules that tell the AI what to avoid in your LinkedIn posts.
          Each rule overrides the LinkedIn algorithm and your RAG document.
          Changes apply to future posts — your existing posts won't change.
        </div>

        {error && (
          <div style={{
            padding:'8px 12px', background:'#fbe9e9', color:DANGER,
            borderRadius:6, fontSize:12, marginBottom:12,
          }}>{error}</div>
        )}

        <div style={{ overflow:'auto', flex:1, marginBottom:14, paddingRight:4 }}>
          {rules === null ? (
            <div style={{ fontSize:12, color:MUTED, padding:'12px 0' }}>Loading…</div>
          ) : rules.length === 0 ? (
            <div style={{
              fontSize:12, color:MUTED, padding:'18px 0',
              borderTop:`0.5px dashed ${BORDER}`, borderBottom:`0.5px dashed ${BORDER}`,
              textAlign:'center',
            }}>
              No rules yet. Add your first below.
            </div>
          ) : (
            rules.map((r, idx) => (
              <RefineRuleRow
                key={r.id}
                number={idx + 1}
                rule={r}
                onChange={text => updateRule(r.id, text)}
                onDelete={() => deleteRule(r.id)}
                disabled={busy}
              />
            ))
          )}
        </div>

        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          <input
            type="text"
            value={draft}
            onChange={e => { setDraft(e.target.value); if (error) setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') addRule(); }}
            placeholder={'e.g. "Don\'t mention our machines breaking down"'}
            disabled={busy || (rules || []).length >= REFINE_RULES_MAX_COUNT}
            style={{
              flex:1, padding:'8px 10px', fontSize:13,
              border:`0.5px solid ${BORDER}`, borderRadius:6,
              background: busy ? '#fafaf8' : CARD, color:TEXT,
            }}
          />
          <button onClick={addRule} disabled={busy || !draft.trim()} style={{
            padding:'8px 14px', fontSize:12, fontWeight:500,
            background: (busy || !draft.trim()) ? '#f4f1e8' : GREEN, color: (busy || !draft.trim()) ? MUTED : '#fff',
            border:'none', borderRadius:6, cursor:(busy || !draft.trim())?'default':'pointer',
          }}>Add rule</button>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, borderTop:`0.5px solid ${BORDER}`, paddingTop:14 }}>
          <div style={{ fontSize:11, color:MUTED }}>
            {(rules || []).length} / {REFINE_RULES_MAX_COUNT} rules
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={busy ? null : onClose} disabled={busy} style={{
              padding:'8px 14px', fontSize:12, background:CARD, color:TEXT,
              border:`0.5px solid ${BORDER}`, borderRadius:6, cursor:busy?'default':'pointer',
            }}>Cancel</button>
            <button onClick={save} disabled={busy || rules === null} style={{
              padding:'8px 16px', fontSize:12, fontWeight:500,
              background:(busy || rules === null) ? '#A9DEF0' : GREEN, color:'#fff',
              border:'none', borderRadius:6, cursor:(busy || rules === null)?'default':'pointer',
            }}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RefineRuleRow({ number, rule, onChange, onDelete, disabled }) {
  // Auto-grow the textarea to fit its content. Without this, long rules get
  // clipped INSIDE the textarea (using its own internal scrollbar) and the
  // outer rules-list container's scrollbar never engages — even when many
  // rules are present. By letting the textarea grow to its full content
  // height, overflow shifts to the outer list, which is what the operator
  // and customer actually want (one scrollbar for the whole list, not one
  // per row).
  //
  // Strategy: on each render and on every change, set the element's height
  // to its scrollHeight. The temporary 'auto' assignment is important — it
  // collapses the textarea so scrollHeight reflects the content's true
  // height, not the previous render's stretched height (otherwise the
  // textarea would only ever grow, never shrink when text is deleted).
  const taRef = useRef(null);

  function resize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => { resize(); }, [rule.text]);

  return (
    <div style={{
      display:'flex', alignItems:'flex-start', gap:10,
      padding:'10px 0', borderBottom:`0.5px solid ${BORDER}`,
    }}>
      <div style={{
        flexShrink:0, width:24, textAlign:'right',
        fontSize:12, color:MUTED, paddingTop:8, fontVariantNumeric:'tabular-nums',
      }}>{number}.</div>
      <textarea
        ref={taRef}
        value={rule.text}
        onChange={e => { onChange(e.target.value); resize(); }}
        disabled={disabled}
        rows={1}
        maxLength={REFINE_RULE_MAX_LEN}
        style={{
          flex:1, padding:'6px 10px', fontSize:13, lineHeight:1.5,
          border:`0.5px solid ${BORDER}`, borderRadius:6,
          background: disabled ? '#fafaf8' : CARD, color:TEXT,
          resize:'none', minHeight:32, overflow:'hidden',
          fontFamily:'inherit',
        }}
      />
      <button onClick={onDelete} disabled={disabled} aria-label="Delete rule" style={{
        flexShrink:0, padding:'6px 10px', fontSize:11, color:DANGER,
        background:'transparent', border:`0.5px solid ${BORDER}`, borderRadius:6,
        cursor: disabled ? 'default' : 'pointer',
      }}>Delete</button>
    </div>
  );
}

// Stable client-side id generator for new rules. Server validates and may
// regenerate, but we want a stable React `key` immediately so the row doesn't
// re-mount on every keystroke. crypto.randomUUID is available in all
// browsers we target (Safari 15.4+, Chrome 92+). Falls back to Math.random
// for the rare older browser.
function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `r_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

// ── POSTS PAGE ───────────────────────────────────────────────────────────────
function PortalPosts() {
  // Loading lifecycle: null = not yet loaded, [] = loaded but empty, [...] = posts.
  const [posts, setPosts]               = useState(null);
  const [campaign, setCampaign]         = useState(null);
  const [notSubscribed, setNotSubscribed] = useState(false);
  const [loadError, setLoadError]       = useState(null);
  const [editing, setEditing]           = useState(null);
  const [regenConfirm, setRegenConfirm] = useState(null);
  // Per-post UI state. busy[postId] = 'regen-text' | 'regen-image' | 'approving' | 'saving'.
  // Used to show the spinner overlay on the matching card and disable buttons.
  // These hooks MUST live above the early returns below so React's hook order
  // stays stable across renders.
  const [busy, setBusy]                 = useState({});
  const [expandedId, setExpandedId]     = useState(null);
  const [bulkBusy, setBulkBusy]         = useState(false);
  const [bulkResult, setBulkResult]     = useState(null);
  const [actionError, setActionError]   = useState(null);
  // History — past campaigns (deployed by customer or admin). Loaded in
  // parallel with the current batch so the page renders both without a
  // second wait. expandedHistoryId tracks which past campaign card is open.
  const [history, setHistory]                   = useState(null);  // null=loading, []=none, [...]=campaigns
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [expandedHistoryPostId, setExpandedHistoryPostId] = useState(null);

  // Initial load. The ServiceGate upstream usually filters out the
  // not_subscribed case before we even mount, but we still respond cleanly
  // here in case the gate is bypassed or the services state is stale.
  // History fetch runs in parallel so the past-campaigns section appears
  // shortly after the current-batch grid.
  useEffect(() => {
    fetch('/api/portal/posts', { credentials:'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => {
        setPosts(d.posts || []);
        setCampaign(d.campaign);
        setNotSubscribed(!!d.not_subscribed);
      })
      .catch(e => {
        setLoadError(String(e));
        setPosts([]);
      });

    fetch('/api/portal/campaigns-history', { credentials:'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => setHistory(d.campaigns || []))
      .catch(_ => setHistory([])); // silent — history is non-critical
  }, []);

  // ─── Loading / empty / error states ───
  if (loadError) {
    return (
      <div>
        <h2 style={pageTitle()}>LinkedIn Posts</h2>
        <div style={{
          padding:'12px 16px', background:'#fbe9e9', color:DANGER,
          borderRadius:8, fontSize:13, marginTop:18,
        }}>Couldn't load posts: {loadError}</div>
      </div>
    );
  }
  if (posts === null) {
    return (
      <div>
        <h2 style={pageTitle()}>LinkedIn Posts</h2>
        <p style={pageSub()}>Loading your posts…</p>
      </div>
    );
  }
  if (posts.length === 0) {
    return (
      <div>
        <h2 style={pageTitle()}>LinkedIn Posts — review &amp; approve</h2>
        <div style={{
          marginTop:18, padding:'40px 32px', background:CARD,
          borderRadius:8, border:`0.5px dashed ${BORDER}`,
          textAlign:'center',
        }}>
          <div style={{ fontSize:14, color:TEXT, marginBottom:6, fontWeight:500 }}>
            Nothing to review right now
          </div>
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.5, maxWidth:440, margin:'0 auto' }}>
            Your next batch will appear here when it's ready. We'll let you know.
          </div>
        </div>

        <HistorySection
          history={history}
          expandedHistoryId={expandedHistoryId}
          setExpandedHistoryId={setExpandedHistoryId}
          expandedHistoryPostId={expandedHistoryPostId}
          setExpandedHistoryPostId={setExpandedHistoryPostId}
        />
      </div>
    );
  }

  // ─── Loaded — main review grid ───
  const approvedCount = posts.filter(p => p.approved).length;
  const allApproved   = approvedCount === posts.length;

  function setPostBusy(id, kind) {
    setBusy(prev => kind ? { ...prev, [id]: kind } : (() => { const n = { ...prev }; delete n[id]; return n; })());
  }

  // Reload everything from the server — used after regen, edit, approve, and
  // approve-all so the displayed state matches the database without us
  // guessing. Posts shown on the grid come from the current awaiting_approval
  // campaign (may be empty after approve-all). History refreshes too so a
  // newly-deployed campaign appears in the past-campaigns section.
  async function reloadAll() {
    try {
      const [pr, hr] = await Promise.all([
        fetch('/api/portal/posts', { credentials:'include' }),
        fetch('/api/portal/campaigns-history', { credentials:'include' }),
      ]);
      if (pr.ok) {
        const d = await pr.json();
        setPosts(d.posts || []);
        setCampaign(d.campaign);
      }
      if (hr.ok) {
        const d = await hr.json();
        setHistory(d.campaigns || []);
      }
    } catch (_) {}
  }

  async function approveOne(id) {
    setActionError(null);
    setPostBusy(id, 'approving');
    try {
      const r = await fetch(`/api/portal/posts/${encodeURIComponent(id)}/approve`, {
        method:'POST', credentials:'include',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setActionError(d.error || `Couldn't approve post (HTTP ${r.status})`);
        setPostBusy(id, null);
        return;
      }
      setPosts(prev => (prev || []).map(p => p.id === id ? d.post : p));
    } catch (e) {
      setActionError(`Network error: ${e.message}`);
    } finally {
      setPostBusy(id, null);
    }
  }

  async function approveAllRemaining() {
    if (!campaign?.id) {
      setActionError('Campaign not loaded — refresh and try again.');
      return;
    }
    if (!confirm(`Approve all ${posts.length - approvedCount} remaining posts? They'll be sent to LinkedIn's scheduled queue immediately.`)) return;
    setActionError(null); setBulkResult(null); setBulkBusy(true);
    try {
      const r = await fetch(`/api/portal/campaigns/${encodeURIComponent(campaign.id)}/posts/approve-all`, {
        method:'POST', credentials:'include',
      });
      const d = await r.json().catch(() => ({}));
      // 207 = partial failure (some posts queued, some failed). We still
      // refresh from the server to show the new approval state of the ones
      // that DID get queued.
      if (r.ok && d.ok) {
        setBulkResult({ ok:true, total:d.total, succeeded:d.succeeded });
        await reloadAll();
      } else {
        setBulkResult({ ok:false, total:d.total || posts.length, succeeded:d.succeeded || 0, error: d.error || `Push failed (HTTP ${r.status})` });
        await reloadAll();
      }
    } catch (e) {
      setBulkResult({ ok:false, error:`Network error: ${e.message}` });
    } finally {
      setBulkBusy(false);
    }
  }

  async function saveEdit(id, newBody, newTitle) {
    setActionError(null);
    setPostBusy(id, 'saving');
    try {
      const r = await fetch(`/api/portal/posts/${encodeURIComponent(id)}`, {
        method:'PUT', credentials:'include',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ title: newTitle, body: newBody }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setActionError(d.error || `Couldn't save post (HTTP ${r.status})`);
        setPostBusy(id, null);
        return;
      }
      setPosts(prev => (prev || []).map(p => p.id === id ? d.post : p));
      setEditing(null);
    } catch (e) {
      setActionError(`Network error: ${e.message}`);
    } finally {
      setPostBusy(id, null);
    }
  }

  async function regenText(id) {
    setActionError(null);
    setPostBusy(id, 'regen-text');
    try {
      const r = await fetch(`/api/portal/posts/${encodeURIComponent(id)}/regenerate-text`, {
        method:'POST', credentials:'include',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setActionError(d.error || `Couldn't rewrite post (HTTP ${r.status})`);
        return;
      }
      setPosts(prev => (prev || []).map(p => p.id === id ? d.post : p));
    } catch (e) {
      setActionError(`Network error: ${e.message}`);
    } finally {
      setPostBusy(id, null);
    }
  }

  async function regenImage(id) {
    setActionError(null);
    setPostBusy(id, 'regen-image');
    try {
      const r = await fetch(`/api/portal/posts/${encodeURIComponent(id)}/regenerate-image`, {
        method:'POST', credentials:'include',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setActionError(d.error || `Couldn't regenerate image (HTTP ${r.status})`);
        return;
      }
      setPosts(prev => (prev || []).map(p => p.id === id ? d.post : p));
    } catch (e) {
      setActionError(`Network error: ${e.message}`);
    } finally {
      setPostBusy(id, null);
    }
  }

  // Per-post logo re-composite. Triggered by the Position/Size dropdowns
  // on each post card — passes one or both override fields. The server
  // re-runs ONLY the compositor on the post's stored pre-logo image (no
  // Gemini call), uploads the new composited image to R2, returns the
  // updated post.
  //
  // Distinct busy kind ('recomp-logo') so the image-only spinner overlay
  // appears rather than the card-wide 'rewriting' overlay.
  //
  // 400 with error='pre_logo_unavailable' means the post was generated
  // before pre-logo storage shipped — we show a more specific message
  // pointing the customer at the New image button.
  async function recompositeLogo(id, fields) {
    setActionError(null);
    setPostBusy(id, 'recomp-logo');
    try {
      const r = await fetch(`/api/portal/posts/${encodeURIComponent(id)}/recomposite-logo`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields || {}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        if (d.error === 'pre_logo_unavailable') {
          setActionError(d.message || 'Click "New image" first to enable logo controls on this post.');
        } else {
          setActionError(d.error || `Couldn't re-composite logo (HTTP ${r.status})`);
        }
        return;
      }
      setPosts(prev => (prev || []).map(p => p.id === id ? d.post : p));
    } catch (e) {
      setActionError(`Network error: ${e.message}`);
    } finally {
      setPostBusy(id, null);
    }
  }

  return (
    <div>
      <h2 style={pageTitle()}>LinkedIn Posts — review &amp; approve</h2>
      <p style={pageSub()}>
        {posts.length} posts ready for your review. Edit text, regenerate any post, or approve.
        Order shown is the order they'll publish.
      </p>

      {/* Inline error toast — appears for any failed action and persists until
          the user dismisses or triggers another action. */}
      {actionError && (
        <div style={{
          padding:'10px 14px', background:'#fbe9e9', color:DANGER,
          borderRadius:8, marginBottom:12, fontSize:12, display:'flex', alignItems:'center', gap:10,
        }}>
          <span style={{ flex:1 }}>{actionError}</span>
          <button onClick={() => setActionError(null)} style={{
            background:'transparent', border:'none', color:DANGER, cursor:'pointer', fontSize:14, padding:0,
          }} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Approve-all result banner. Success: green; partial failure: amber. */}
      {bulkResult && bulkResult.ok && (
        <div style={{
          padding:'10px 14px', background:GREEN_BG, color:GREEN,
          borderRadius:8, marginBottom:12, fontSize:12,
        }}>
          <strong style={{ fontWeight:500 }}>All {bulkResult.total} posts approved and queued to LinkedIn.</strong> They'll publish in the scheduled order.
        </div>
      )}
      {bulkResult && !bulkResult.ok && (
        <div style={{
          padding:'10px 14px', background:AMBER_BG, color:AMBER,
          borderRadius:8, marginBottom:12, fontSize:12,
        }}>
          <strong style={{ fontWeight:500 }}>{bulkResult.succeeded || 0} of {bulkResult.total || posts.length} posts queued.</strong>{' '}
          {bulkResult.error || 'The remaining posts can be retried by clicking Approve all remaining again.'}
        </div>
      )}

      {/* Approval progress bar */}
      <div style={{
        display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
        background: allApproved ? GREEN_BG : BLUE_BG,
        color:      allApproved ? GREEN    : BLUE,
        borderRadius:8, marginBottom:16, fontSize:12,
      }}>
        <strong style={{ fontWeight:500 }}>{approvedCount} of {posts.length} approved.</strong>
        {!allApproved && <span>Once all {posts.length} are approved, posts go straight to LinkedIn's scheduled queue in this order.</span>}
        {allApproved  && <span>All posts approved — they'll publish in the scheduled order.</span>}
        {!allApproved && (
          <button onClick={approveAllRemaining} disabled={bulkBusy} style={{
            marginLeft:'auto', padding:'6px 12px',
            background: bulkBusy ? TGA_GREEN_LO : TGA_GREEN_HI, color:'#0F1D3F',
            border:'none', borderRadius:6, fontSize:12,
            cursor: bulkBusy ? 'not-allowed' : 'pointer', fontWeight:500,
          }}>{bulkBusy ? 'Sending to LinkedIn…' : 'Approve all remaining'}</button>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:16 }}>
        {posts.map(p => (
          <PostCard key={p.id} post={p} totalPosts={posts.length}
            busy={busy[p.id] || null}
            expanded={expandedId === p.id}
            onToggleExpand={() => setExpandedId(expandedId === p.id ? null : p.id)}
            onEdit={() => setEditing(p)}
            onRegenText={() => regenText(p.id)}
            onRegenImage={() => regenImage(p.id)}
            onRecompositeLogo={(fields) => recompositeLogo(p.id, fields)}
            onApprove={() => approveOne(p.id)}
          />
        ))}
      </div>

      <HistorySection
        history={history}
        expandedHistoryId={expandedHistoryId}
        setExpandedHistoryId={setExpandedHistoryId}
        expandedHistoryPostId={expandedHistoryPostId}
        setExpandedHistoryPostId={setExpandedHistoryPostId}
      />

      {editing && (
        <EditPostModal
          post={editing}
          busy={busy[editing.id] === 'saving'}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}
    </div>
  );
}

function PostCard({ post, totalPosts, busy, expanded, readOnly, onToggleExpand, onEdit, onRegenText, onRegenImage, onRecompositeLogo, onApprove }) {
  const isRegenText  = busy === 'regen-text';
  const isRegenImage = busy === 'regen-image';
  const isRecompLogo = busy === 'recomp-logo';
  const isApproving  = busy === 'approving';
  const isAnyBusy    = !!busy;

  const metaLine = [post.content_pillar, post.format].filter(Boolean).join(' · ');

  return (
    <div style={{
      background:CARD, borderRadius:8, border:`0.5px solid ${BORDER}`, overflow:'hidden',
      display:'flex', flexDirection:'column',
      opacity: isAnyBusy ? 0.85 : 1, transition:'opacity 0.2s',
      position:'relative',
    }}>
      {/* Card-wide overlay shown while text is regenerating. Image stays
          visible underneath; the body section is what changes. We put the
          overlay on the WHOLE CARD so the spinner sits centred regardless
          of which part is updating. */}
      {isRegenText && (
        <div style={{
          position:'absolute', inset:0, background:'rgba(255,255,255,0.92)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:5,
          flexDirection:'column', gap:10, padding:20, textAlign:'center',
        }}>
          <div style={{
            width:30, height:30, border:`2.5px solid ${TGA_GREEN_HI}`,
            borderTopColor:'transparent', borderRadius:'50%',
            animation:'spin 0.8s linear infinite',
          }} />
          <div style={{ fontSize:12, fontWeight:500, color:TEXT }}>Rewriting your post…</div>
          <div style={{ fontSize:11, color:MUTED, lineHeight:1.4, maxWidth:240 }}>
            Please wait while your text is being regenerated. This usually takes 5–15 seconds.
          </div>
        </div>
      )}

      {/* Image — admin uses natural aspect with objectFit:contain. We mirror
          that so customers see exactly what the post will look like.
          maxHeight:300 caps oversized images so the card doesn't go rogue. */}
      <div style={{ position:'relative', background:'#f5f5f3' }}>
        {post.image_url ? (
          <img src={post.image_url} alt={`Post ${post.order}`}
            style={{
              width:'100%', height:'auto', maxHeight:300,
              objectFit:'contain', display:'block', background:'#f5f5f3',
            }}
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div style={{
            height:80, display:'flex', alignItems:'center', justifyContent:'center',
            color:MUTED, fontSize:11,
          }}>
            {post.image_error ? 'Image generation failed — click "New image" to retry' : 'No image generated yet'}
          </div>
        )}
        {/* Image-only spinner overlay. Sits ON the image so the customer
            knows specifically that the IMAGE is being updated (vs the
            post text). Appears for both 'regen-image' (full Gemini regen,
            5-30s) and 'recomp-logo' (re-composite only, ~½ sec) — same
            visual treatment with different wording. */}
        {(isRegenImage || isRecompLogo) && (
          <div style={{
            position:'absolute', inset:0, background:'rgba(255,255,255,0.85)',
            display:'flex', alignItems:'center', justifyContent:'center',
            flexDirection:'column', gap:8, padding:12, textAlign:'center',
          }}>
            <div style={{
              width:26, height:26, border:`2.5px solid ${TGA_GREEN_HI}`,
              borderTopColor:'transparent', borderRadius:'50%',
              animation:'spin 0.8s linear infinite',
            }} />
            <div style={{ fontSize:11, fontWeight:500, color:TEXT }}>
              {isRecompLogo ? 'Updating logo…' : 'Generating image…'}
            </div>
            <div style={{ fontSize:10, color:MUTED, lineHeight:1.4, maxWidth:200 }}>
              {isRecompLogo
                ? 'Repositioning logo — no charge.'
                : 'Please wait while your image is being regenerated.'}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding:'12px 14px', flex:1, display:'flex', flexDirection:'column' }}>
        <div style={{
          display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6,
        }}>
          <div>
            <div style={{ fontSize:12, fontWeight:500, color:TEXT }}>Post {post.order}</div>
            {metaLine && (
              <div style={{ fontSize:10, color:MUTED, marginTop:1 }}>{metaLine}</div>
            )}
            {(post.suggested_day || post.suggested_time) && (
              <div style={{ fontSize:10, color:GREEN, marginTop:2 }}>
                📅 {post.suggested_day} {post.suggested_time}
              </div>
            )}
          </div>
          {post.approved && (
            <span style={{
              fontSize:10, padding:'2px 7px', borderRadius:4,
              background:GREEN_BG, color:GREEN, fontWeight:500, whiteSpace:'nowrap',
            }}>✓ Approved</span>
          )}
        </div>

        {post.topic && (
          <div style={{ fontSize:12, fontWeight:500, color:TEXT, marginBottom:6 }}>{post.topic}</div>
        )}

        {/* Validation warning badge — shown when the AI couldn't fully obey
            a customer rule, even after a retry. Tells the customer which
            rule was likely violated so they can refine their rules or
            regenerate this post. Multiple violations shown stacked.

            HIDDEN at operator request (2026-05-14) — warnings were firing too
            often due to Haiku interpreting rules thematically rather than
            literally. Validation pass still runs server-side and attaches
            validation_warnings to posts; this block just doesn't render
            them. To re-enable, change `false &&` below back to a plain
            check. The data is still being captured so re-enabling is a
            one-line change. */}
        {false && Array.isArray(post.validation_warnings) && post.validation_warnings.length > 0 && (
          <div style={{
            background:AMBER_BG, color:AMBER, border:`0.5px solid ${AMBER}33`,
            borderRadius:6, padding:'8px 10px', marginBottom:8, fontSize:11, lineHeight:1.5,
          }}>
            <div style={{ fontWeight:500, marginBottom:4 }}>
              ⚠ This post may conflict with {post.validation_warnings.length === 1 ? 'one of your rules' : `${post.validation_warnings.length} of your rules`}.
            </div>
            {post.validation_warnings.map((w, i) => (
              <div key={i} style={{ marginTop:4 }}>
                <div style={{ fontWeight:500 }}>Rule: <span style={{ fontWeight:400 }}>{w.ruleText}</span></div>
                {w.reason && <div style={{ opacity:0.85 }}>{w.reason}</div>}
              </div>
            ))}
            <div style={{ marginTop:6, opacity:0.8 }}>
              Edit your rules from <strong style={{ fontWeight:500 }}>Refine my posts</strong> at the top, or click <strong style={{ fontWeight:500 }}>Rewrite post</strong> below.
            </div>
          </div>
        )}

        {/* Full body, with mask-fade fallback when collapsed (admin pattern). */}
        <div style={{
          fontSize:11, color:MUTED, lineHeight:1.6, flex:1,
          maxHeight: expanded ? 'none' : 96, overflow:'hidden',
          maskImage: expanded ? 'none' : 'linear-gradient(to bottom, black 50%, transparent 100%)',
          WebkitMaskImage: expanded ? 'none' : 'linear-gradient(to bottom, black 50%, transparent 100%)',
          whiteSpace:'pre-wrap',
        }}>{post.body}</div>
        <button onClick={onToggleExpand} style={{
          marginTop:8, fontSize:11, color:TGA_GREEN_HI, background:'none', border:'none',
          cursor:'pointer', padding:0, textAlign:'left', fontWeight:500,
        }}>{expanded ? '▲ Collapse' : '▼ Read full post'}</button>

        {/* Action row — four buttons, mirroring admin's Edit / Rewrite / New image
            plus the customer-only Approve. Hidden in readOnly (history) view.
            Style choice: all four buttons solid TGA brand green with white text,
            same size and weight. Disabled state dims to ~55% opacity. */}
        {!readOnly && (
          <>
            {/* Per-post logo controls. Three dropdowns (Position, Size,
                Background) that let the customer fine-tune logo placement
                on each individual post's image. Each is a per-post override
                that defaults to the customer-level setting set by the
                operator on the admin side; changing any of them runs a
                fast re-composite (no AI call) on the post's stored
                pre-logo image.
                
                When logo_controls_enabled is false (post has no stored
                pre-logo image — generated before this feature shipped),
                the controls render disabled with a hint pointing the
                customer at the New image button. */}
            <LogoControls
              post={post}
              disabled={isAnyBusy}
              onRecompositeLogo={onRecompositeLogo}
            />
            <div style={{ display:'flex', gap:5, marginTop:10, paddingTop:10, borderTop:`0.5px solid ${BORDER}` }}>
              <button onClick={onEdit} disabled={isAnyBusy} style={cardBtn(isAnyBusy)}>
                Edit text
              </button>
              <button onClick={onRegenText} disabled={isAnyBusy} style={cardBtn(isAnyBusy)}>
                Rewrite post
              </button>
              <button onClick={onRegenImage} disabled={isAnyBusy} style={cardBtn(isAnyBusy)}>
                New image
              </button>
              {post.approved
                ? <button disabled style={{
                    ...cardBtn(false),
                    background: TGA_GREEN_LO, cursor:'default', opacity: 1,
                  }}>✓ Approved</button>
                : <button onClick={onApprove} disabled={isAnyBusy} style={cardBtn(isAnyBusy)}>
                    {isApproving ? 'Approving…' : 'Approve'}
                  </button>
              }
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// All four post-card action buttons share this style: solid TGA brand green
// background, white text, no border (the green provides the affordance).
// Disabled state dims to 55% opacity so the user can see what they clicked.
function cardBtn(disabled) {
  return {
    flex: 1,
    padding: '7px 5px',
    fontSize: 11,
    fontWeight: 500,
    border: 'none',
    background: TGA_GREEN,
    color: '#ffffff',
    borderRadius: 5,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  };
}

// ── PER-POST LOGO CONTROLS ───────────────────────────────────────────────────
// Three dropdowns (Position, Size, Background) sitting on every post card
// between the post body and the four green action buttons. Changing any
// dropdown immediately calls the recomposite endpoint, which re-runs only
// the compositor on the post's stored pre-logo image — no AI call, ~½ sec.
//
// Initial values come from the per-post overrides (post.logo_position,
// post.logo_size, post.logo_panel). If null, fall back to the customer-
// level defaults (post.default_logo_*) set by the operator on the admin
// side.
//
// Disabled state: shown when the post was generated before the pre-logo
// storage feature shipped — post.logo_controls_enabled is false. We grey
// out the controls and show a small hint pointing the customer at the
// New image button.
function LogoControls({ post, disabled, onRecompositeLogo }) {
  const enabled  = !!post.logo_controls_enabled;
  const position = post.logo_position || post.default_logo_position || 'bottom-right';
  const size     = post.logo_size     || post.default_logo_size     || 'small';
  const panel    = post.logo_panel    || post.default_logo_panel    || 'white';

  function handleChange(field, value) {
    if (!enabled || disabled) return;
    onRecompositeLogo({ [field]: value });
  }

  const allDisabled = disabled || !enabled;

  return (
    <div style={{
      marginTop: 10, paddingTop: 10,
      borderTop: '0.5px dashed #e8b04a',
      opacity: allDisabled ? 0.6 : 1,
    }}>
      <div style={{
        fontSize: 10, color: '#9a6f00', textTransform: 'uppercase',
        letterSpacing: '0.05em', fontWeight: 500, marginBottom: 6,
      }}>Logo on this image</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 3 }}>Position</div>
          <select
            value={position}
            disabled={allDisabled}
            onChange={e => handleChange('logo_position', e.target.value)}
            style={logoSelectStyle(allDisabled)}
          >
            <option value="top-right">Top right</option>
            <option value="top-left">Top left</option>
            <option value="bottom-right">Bottom right</option>
            <option value="bottom-left">Bottom left</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 3 }}>Size</div>
          <select
            value={size}
            disabled={allDisabled}
            onChange={e => handleChange('logo_size', e.target.value)}
            style={logoSelectStyle(allDisabled)}
          >
            <option value="large">Large</option>
            <option value="medium">Medium</option>
            <option value="small">Small</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 3 }}>Background</div>
          <select
            value={panel}
            disabled={allDisabled}
            onChange={e => handleChange('logo_panel', e.target.value)}
            style={logoSelectStyle(allDisabled)}
          >
            <option value="white">White panel</option>
            <option value="none">No panel</option>
          </select>
        </div>
      </div>
      {!enabled && (
        <div style={{
          fontSize: 10, color: MUTED, marginTop: 6, lineHeight: 1.4, fontStyle: 'italic',
        }}>
          Click <span style={{ fontWeight: 500, fontStyle: 'normal' }}>New image</span> to enable these controls on this post.
        </div>
      )}
    </div>
  );
}

function logoSelectStyle(disabled) {
  return {
    width: '100%',
    fontSize: 11,
    padding: '4px 6px',
    border: '0.5px solid #d0d0cc',
    borderRadius: 5,
    background: disabled ? '#f5f5f3' : '#fff',
    color: TEXT,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

// ── EDIT MODAL ───────────────────────────────────────────────────────────────
function EditPostModal({ post, busy, onClose, onSave }) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody]   = useState(post.body);

  return (
    <Modal title="Edit post" onClose={() => !busy && onClose()} wide>
      <div style={{ display:'grid', gridTemplateColumns:'180px 1fr', gap:18 }}>
        <div>
          <div style={{ fontSize:11, color:MUTED, marginBottom:6 }}>Image (read-only)</div>
          <div style={{
            borderRadius:6, overflow:'hidden', background:'#f5f5f3',
            minHeight:120, display:'flex', alignItems:'center', justifyContent:'center',
            color:MUTED, fontSize:11,
          }}>
            {post.image_url
              ? <img src={post.image_url} alt=""
                  style={{ width:'100%', height:'auto', maxHeight:240, objectFit:'contain', display:'block', background:'#f5f5f3' }} />
              : 'No image'
            }
          </div>
          <div style={{ fontSize:11, color:TERTIARY_TEXT, marginTop:8, lineHeight:1.4 }}>
            Want a new image? Cancel and click <strong style={{ color:TEXT }}>New image</strong> on the post.
          </div>
        </div>
        <div>
          <div style={{ fontSize:11, color:MUTED, marginBottom:4 }}>Title</div>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus disabled={busy}
            style={{ ...loginInputStyle(), marginBottom:14 }}
          />
          <div style={{ fontSize:11, color:MUTED, marginBottom:4 }}>Body</div>
          <textarea value={body} onChange={e => setBody(e.target.value)} disabled={busy}
            style={{
              ...loginInputStyle(),
              fontFamily:'inherit', minHeight:240, resize:'vertical', lineHeight:1.5,
            }}
          />
          <div style={{ fontSize:11, color:TERTIARY_TEXT, marginTop:6 }}>
            Saving marks this post approved. To rewrite from scratch, click <strong style={{ color:TEXT }}>Rewrite post</strong> instead.
          </div>
        </div>
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:18 }}>
        <BtnSecondary onClick={onClose} disabled={busy}>Cancel</BtnSecondary>
        <BtnPrimary onClick={() => onSave(post.id, body, title)} disabled={busy || !body.trim()}>
          {busy ? 'Saving…' : 'Save & approve'}
        </BtnPrimary>
      </div>
    </Modal>
  );
}

// ── PAST CAMPAIGNS (history) ─────────────────────────────────────────────────
// Read-only history of campaigns the customer has previously approved (or that
// admin pushed direct to Supergrow before the portal existed). Each card
// expands to show every post in the campaign in the same admin-mirrored layout
// — full image, full text, "Read full post" expand — but with no Edit /
// Rewrite / New image / Approve buttons. Read-only by design.
function HistorySection({ history, expandedHistoryId, setExpandedHistoryId,
                         expandedHistoryPostId, setExpandedHistoryPostId }) {
  // Loading: render nothing (the current-batch grid is the visible feature
  // anyway; history will appear once it lands without flicker).
  if (history === null) return null;
  // Empty: skip the section entirely. The customer doesn't need to see
  // "No past campaigns" — that's noise.
  if (history.length === 0) return null;

  return (
    <div style={{ marginTop:32 }}>
      <h3 style={{ fontSize:14, fontWeight:500, color:TEXT, margin:'0 0 4px' }}>Past campaigns</h3>
      <p style={{ fontSize:12, color:MUTED, margin:'0 0 12px' }}>
        Read-only — these are the campaigns we've previously published for you.
      </p>

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {history.map(c => (
          <HistoryCampaignCard key={c.id} campaign={c}
            expanded={expandedHistoryId === c.id}
            onToggle={() => setExpandedHistoryId(expandedHistoryId === c.id ? null : c.id)}
            expandedHistoryPostId={expandedHistoryPostId}
            setExpandedHistoryPostId={setExpandedHistoryPostId}
          />
        ))}
      </div>
    </div>
  );
}

function HistoryCampaignCard({ campaign, expanded, onToggle,
                               expandedHistoryPostId, setExpandedHistoryPostId }) {
  const date = campaign.completed_at || campaign.created_at;
  const dateLabel = date
    ? new Date(date.includes('Z') ? date : date.replace(' ', 'T') + 'Z')
        .toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
    : '';

  return (
    <div style={{
      background:CARD, border:`0.5px solid ${BORDER}`, borderRadius:8, overflow:'hidden',
    }}>
      {/* Header strip — always visible, click to toggle. */}
      <button onClick={onToggle} style={{
        width:'100%', display:'flex', alignItems:'center', gap:14, padding:'12px 14px',
        background:'transparent', border:'none', cursor:'pointer', textAlign:'left',
      }}>
        {/* Cover image — first post's image, if any. Falls back to a calm
            neutral block so the layout doesn't jump. */}
        <div style={{
          width:64, height:64, borderRadius:6, flexShrink:0, overflow:'hidden',
          background:'#f5f5f3', display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          {campaign.cover_url
            ? <img src={campaign.cover_url} alt=""
                style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
            : <span style={{ fontSize:10, color:MUTED }}>No image</span>
          }
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:500, color:TEXT, marginBottom:2,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {campaign.first_topic || `Campaign of ${campaign.post_count} posts`}
          </div>
          <div style={{ fontSize:11, color:MUTED }}>
            {dateLabel} · {campaign.post_count} post{campaign.post_count === 1 ? '' : 's'}
          </div>
        </div>
        <span style={{
          fontSize:10, padding:'2px 8px', borderRadius:4,
          background:GREEN_BG, color:GREEN, fontWeight:500,
        }}>Published</span>
        <span style={{ fontSize:11, color:MUTED, marginLeft:8 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded grid — read-only PostCards. Same component as the current-
          batch grid but readOnly=true hides the action row. */}
      {expanded && (
        <div style={{ padding:'0 14px 14px', borderTop:`0.5px solid ${BORDER}` }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:16, marginTop:14 }}>
            {campaign.posts.map(p => (
              <PostCard key={p.id} post={p} totalPosts={campaign.post_count}
                readOnly
                expanded={expandedHistoryPostId === `${campaign.id}:${p.id}`}
                onToggleExpand={() =>
                  setExpandedHistoryPostId(expandedHistoryPostId === `${campaign.id}:${p.id}` ? null : `${campaign.id}:${p.id}`)
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── INBOX PAGE ───────────────────────────────────────────────────────────────
function PortalInbox({ onNavigateToCrm } = {}) {
  const [replies, setReplies]         = useState(null);  // null=loading, []=none, [...]=list
  const [notSubscribed, setNotSubscribed] = useState(false);
  const [loadError, setLoadError]     = useState(null);
  const [openReply, setOpenReply]     = useState(null);   // full reply detail (after fetch)
  const [openLoading, setOpenLoading] = useState(false);
  const [composing, setComposing]     = useState(null);
  const [sendError, setSendError]     = useState(null);

  useEffect(() => {
    fetch('/api/portal/inbox', { credentials:'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => {
        setReplies(d.replies || []);
        setNotSubscribed(!!d.not_subscribed);
      })
      .catch(e => {
        setLoadError(String(e));
        setReplies([]);
      });
  }, []);

  // Click on a reply row → fetch full detail (with body_html) before showing
  // the modal. The list endpoint only returns the snippet for performance,
  // so the modal needs a second call to get the full message body.
  async function openReplyDetail(reply) {
    setOpenLoading(true);
    try {
      const r = await fetch(`/api/portal/replies/${encodeURIComponent(reply.id)}`, { credentials:'include' });
      if (!r.ok) {
        setLoadError(`Couldn't load reply (HTTP ${r.status})`);
        return;
      }
      const d = await r.json();
      setOpenReply(d);
    } catch (e) {
      setLoadError(`Network error: ${e.message}`);
    } finally {
      setOpenLoading(false);
    }
  }

  if (loadError && !replies) {
    return (
      <div>
        <h2 style={pageTitle()}>Inbox</h2>
        <div style={{
          padding:'12px 16px', background:'#fbe9e9', color:DANGER,
          borderRadius:8, fontSize:13, marginTop:18,
        }}>Couldn't load inbox: {loadError}</div>
      </div>
    );
  }

  if (replies === null) {
    return (
      <div>
        <h2 style={pageTitle()}>Inbox</h2>
        <p style={pageSub()}>Loading replies…</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={pageTitle()}>Inbox</h2>
      <p style={pageSub()}>Replies received to your campaigns. Click any row to read or reply.</p>

      {loadError && (
        <div style={{
          padding:'10px 14px', background:'#fbe9e9', color:DANGER,
          borderRadius:8, marginBottom:12, fontSize:12, display:'flex', alignItems:'center', gap:10,
        }}>
          <span style={{ flex:1 }}>{loadError}</span>
          <button onClick={() => setLoadError(null)} style={{
            background:'transparent', border:'none', color:DANGER, cursor:'pointer', fontSize:14, padding:0,
          }} aria-label="Dismiss">×</button>
        </div>
      )}

      {sendError && (
        <div style={{
          padding:'10px 14px', background:'#fbe9e9', color:DANGER,
          borderRadius:8, marginBottom:12, fontSize:12, display:'flex', alignItems:'center', gap:10,
        }}>
          <span style={{ flex:1 }}>{sendError}</span>
          <button onClick={() => setSendError(null)} style={{
            background:'transparent', border:'none', color:DANGER, cursor:'pointer', fontSize:14, padding:0,
          }} aria-label="Dismiss">×</button>
        </div>
      )}

      {replies.length === 0 ? (
        <div style={{
          marginTop:18, padding:'40px 32px', background:CARD,
          borderRadius:8, border:`0.5px dashed ${BORDER}`,
          textAlign:'center',
        }}>
          <div style={{ fontSize:14, color:TEXT, marginBottom:6, fontWeight:500 }}>
            No replies yet
          </div>
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.5, maxWidth:440, margin:'0 auto' }}>
            When someone replies to one of your campaigns, it will land here.
          </div>
        </div>
      ) : (
        <div style={{
          background:CARD, borderRadius:8, border:`0.5px solid ${BORDER}`, overflow:'hidden',
          opacity: openLoading ? 0.7 : 1, transition:'opacity 0.15s',
        }}>
          <div style={{
            fontSize:11, color:MUTED, textTransform:'uppercase', letterSpacing:'0.06em',
            padding:'14px 14px 8px', borderBottom:`0.5px solid ${BORDER}`,
          }}>Recent replies — click to read &amp; reply</div>
          {replies.map(r => (
            <ReplyRow key={r.id} reply={r} onClick={() => openReplyDetail(r)}
              onNavigateToCrm={(prospectId) => {
                // Row-level "On Hot Prospects list" pill click: bypass the
                // row's onClick (stopPropagation in the badge) and jump
                // straight to CRM via the chrome's in-tree handoff.
                if (onNavigateToCrm) onNavigateToCrm(prospectId);
              }}
            />
          ))}
        </div>
      )}

      {openReply && !composing && (
        <ReplyDetailModal reply={openReply}
          onClose={() => setOpenReply(null)}
          onCompose={() => setComposing(openReply)}
          onNavigateToCrm={(prospectId) => {
            // Close the inbox detail then navigate to the CRM page with the
            // matching prospect's detail modal auto-opened. The chrome holds
            // the cross-page handoff state — we just call its setter and
            // close ourselves.
            setOpenReply(null);
            if (onNavigateToCrm) onNavigateToCrm(prospectId);
          }}
        />
      )}
      {composing && (
        <ComposeReplyModal reply={composing}
          onClose={() => setComposing(null)}
          onSend={async (payload) => {
            setSendError(null);
            try {
              const r = await fetch(`/api/portal/replies/${encodeURIComponent(composing.id)}/send`, {
                method:'POST', credentials:'include',
                headers:{ 'Content-Type':'application/json' },
                body: JSON.stringify({ cc: payload.cc, body: payload.body }),
              });
              const d = await r.json().catch(() => ({}));
              if (!r.ok || !d.ok) {
                setSendError(d.error || `Send failed (HTTP ${r.status})`);
                return false;
              }
              setComposing(null);
              setOpenReply(null);
              return true;
            } catch (e) {
              setSendError(`Network error: ${e.message}`);
              return false;
            }
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ padding:'12px 14px', background:'#f1efe8', borderRadius:8 }}>
      <p style={{ fontSize:11, color:MUTED, textTransform:'uppercase', letterSpacing:'0.04em', margin:'0 0 4px' }}>{label}</p>
      <p style={{ fontSize:20, fontWeight:500, margin:0, color:TEXT }}>{value}</p>
      {sub && <p style={{ fontSize:11, color:MUTED, margin:'2px 0 0' }}>{sub}</p>}
    </div>
  );
}

function ReplyRow({ reply, onClick, onNavigateToCrm }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display:'grid', gridTemplateColumns:'220px 1fr 160px 90px',
        gap:10, alignItems:'center', padding:'10px 14px',
        borderBottom:`0.5px solid ${BORDER}`, fontSize:12, cursor:'pointer',
        background: hover ? '#fafaf8' : 'transparent',
      }}
    >
      <div style={{ fontWeight:500, color:TEXT, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
        {reply.from_name}
        <div style={{ fontWeight:400, color:TERTIARY_TEXT, fontSize:11 }}>{reply.from_address}</div>
      </div>
      <div style={{ color:MUTED, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
        <div style={{ color:TEXT, marginBottom:2 }}>{reply.subject}</div>
        <div>{reply.snippet}</div>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:4, justifyContent:'flex-start', alignItems:'center' }}>
        <ClassifyBadge reply={reply} />
        <PortalActionBadges reply={reply} onNavigateToCrm={onNavigateToCrm} />
      </div>
      <div style={{ color:TERTIARY_TEXT, fontSize:11, textAlign:'right' }}>{relTime(reply.received_at)}</div>
    </div>
  );
}

// ── Customer-portal action-taken badges ──────────────────────────────────────
// Mirror of the admin ActionBadges in EmailSection.jsx — kept in step per
// decision #92 (admin/portal classification surfaces show the same data
// with same labels by default).
//
//   • On Hot Prospects list  — amber pill, clickable. Closes the inbox row's
//     click bubble (stopPropagation) so it doesn't ALSO trigger the row's
//     detail-modal open, then routes to the CRM page with the matching
//     prospect's detail modal auto-opened. Uses the in-tree navigation
//     callback chain (not localStorage like admin) since the portal lives
//     in one component tree.
//   • Unsubscribed           — grey pill, not clickable. Customer-portal
//     audiences don't have a contacts page to land on; the badge IS the
//     answer.
//
// Backend fills hot_prospect_id + hot_prospect_crm_customer_id +
// contact_unsubscribed via attachInboxBadges in server/routes/portal.js.
// (crm_customer_id isn't used here — the portal is single-tenant — but it
// IS returned for endpoint-shape symmetry with admin.)
function PortalActionBadges({ reply, onNavigateToCrm }) {
  const onList = !!reply?.hot_prospect_id;
  const unsubd = !!reply?.contact_unsubscribed;
  if (!onList && !unsubd) return null;
  return (
    <>
      {onList && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (onNavigateToCrm) onNavigateToCrm(reply.hot_prospect_id);
          }}
          title="Open in CRM"
          style={{
            fontSize:10, padding:'2px 7px', borderRadius:4, fontWeight:500,
            background: BADGE_UNSUB_BG, color: BADGE_UNSUB_FG, whiteSpace:'nowrap',
            border:'none', cursor:'pointer', fontFamily:'inherit',
          }}
        >On Hot Prospects list</button>
      )}
      {unsubd && (
        <span style={{
          fontSize:10, padding:'2px 7px', borderRadius:4, fontWeight:500,
          background: BADGE_GREY_BG, color: BADGE_GREY_FG, whiteSpace:'nowrap',
        }}>Unsubscribed</span>
      )}
    </>
  );
}

// Classification badge.
//
// Three layers, in priority order — kept in step with admin's classifyBadge
// in EmailSection.jsx so the two surfaces show the same information. The
// only deliberate divergences are:
//
//   (a) Non-campaign mail collapses to "Normal email" here. On admin it
//       still shows the bare classifier label. Reasoning: a vendor's OOO
//       isn't a lead going cold — it's just a vendor — so its
//       classification is meaningless to the customer.
//
//   (b) Missing/null classification shows "Classifying…" here instead of
//       admin's "Unclassified". It's a transient state (resolves to a
//       real label in ~10s); "Unclassified" reads as a failure to the
//       customer, "Classifying…" reads as in-progress.
//
// Decision history (blueprint reference for next chat): this used to
// collapse soft_negative / hard_negative / forwarding all to "Neutral"
// and OOO was shown as "OOO". Operator chose full parity with admin labels
// 2026-05-20 fifth session, deliberately amending decisions #36 and #69.
// Admin Badge colour palette mirrored locally so the portal renders
// the same chrome. Greens/blues come from the existing portal vars; the
// negatives/forwarded/auto-unsub colours are admin-side and copied verbatim.
const BADGE_NEG_FG  = '#793F1F';
const BADGE_NEG_BG  = '#FAECE7';
const BADGE_FWD_FG  = '#3C3489';
const BADGE_FWD_BG  = '#EEEDFE';
const BADGE_GREY_FG = '#5F5E5A';
const BADGE_GREY_BG = '#F1EFE8';
const BADGE_UNSUB_FG = '#633806';
const BADGE_UNSUB_BG = '#FAEEDA';

function ClassifyBadge({ reply }) {
  const mk = (label, bg, color) => (
    <span style={{ ...badgeStyle(), background: bg, color }}>{label}</span>
  );

  // 1. Formspree website-form submission — own label, bypasses classifier.
  //    Driven by is_website_prospect from the backend (single source of truth
  //    — see isFormspreeLeadRow in formspree-flagger.js). Shown on BOTH portal
  //    and admin even with no campaign_title, because the submission IS the
  //    prospect signal.
  if (reply?.is_website_prospect) {
    return mk('Website Prospect', GREEN_BG, GREEN);
  }

  // 2. Non-campaign mail — see comment (a) above.
  if (!reply.campaign_title) {
    return mk('Normal email', '#eef0f2', MUTED);
  }

  // 3. Campaign-matched: prefixed, full label set.
  const prefix = 'Campaign · ';
  if (reply.auto_unsubscribed) {
    return mk(`${prefix}Auto-unsubscribed`, BADGE_UNSUB_BG, BADGE_UNSUB_FG);
  }
  switch (reply.classification) {
    case 'positive':      return mk(`${prefix}New prospect`,  BLUE_BG,        BLUE);
    case 'hard_negative': return mk(`${prefix}Negative`,      BADGE_NEG_BG,   BADGE_NEG_FG);
    case 'soft_negative': return mk(`${prefix}Soft negative`, BADGE_NEG_BG,   BADGE_NEG_FG);
    case 'auto_reply':    return mk(`${prefix}Out of Office`, '#FBEAF0',      '#72243E');
    case 'forwarding':    return mk(`${prefix}Forwarded`,     BADGE_FWD_BG,   BADGE_FWD_FG);
    case 'neutral':       return mk(`${prefix}Neutral`,       BADGE_GREY_BG,  BADGE_GREY_FG);
    default:              return mk('Classifying…',           BADGE_GREY_BG,  BADGE_GREY_FG);
  }
}

function badgeStyle() {
  return {
    fontSize:10, padding:'2px 7px', borderRadius:4, textAlign:'center',
    fontWeight:500, display:'inline-block',
  };
}

// ── REPLY DETAIL MODAL ───────────────────────────────────────────────────────
// Renders a received reply in a full-body, email-client-style layout. When
// body_html is available we use it directly (dangerouslySetInnerHTML) so the
// sender's formatting — paragraph breaks, links, signatures — comes through
// as it would in Gmail/Outlook. Falls back to body_text in pre-wrap when no
// HTML body was captured by the IMAP poller.
//
// The HTML is content the customer received in their own inbox — there's no
// new untrusted vector here that didn't already exist in their mail client.
// We do still want the rendered HTML scoped (no global style bleed), so we
// wrap it in a div with isolation styles.
function ReplyDetailModal({ reply: replyProp, onClose, onCompose, onNavigateToCrm }) {
  // Hot Prospects state. addingProspect = button is mid-POST. hotProspectBanner
  // holds the success/already-on-list message after a successful add:
  //   { kind: 'added' | 'already', prospect_id: '<uuid>' }
  // Banners stay until the modal closes — the customer should be able to keep
  // reading the email after they've added the prospect, then click "Open in
  // CRM" if they want to jump.
  const [addingProspect, setAddingProspect] = useState(false);
  const [hotProspectBanner, setHotProspectBanner] = useState(null);
  const [addError, setAddError] = useState(null);

  // Local copy of the reply object so sub/resub clicks can mutate
  // contact_unsubscribed in place without refetching the inbox list. Falls
  // back to the prop on first render. A separate `subResubStatus` carries
  // the inline status line that appears after each click.
  const [replyOverride, setReplyOverride] = useState(null);
  const reply = replyOverride || replyProp;
  const [subResubBusy, setSubResubBusy] = useState(false);
  const [subResubStatus, setSubResubStatus] = useState(null);

  // Unsubscribe / Re-subscribe handler. Same three-shape response handling
  // as the admin side. Updates contact_unsubscribed locally so the badge +
  // button row swap state without a network round-trip.
  async function manualSubResub(action) {
    if (!reply || subResubBusy) return;
    setSubResubBusy(true);
    setSubResubStatus(null);
    try {
      const r = await fetch(`/api/portal/replies/${encodeURIComponent(reply.id)}/${action}`, {
        method: 'POST', credentials: 'include',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok && !d.code) {
        setSubResubStatus({ kind:'error', text: d.error || `${action} failed (HTTP ${r.status})` });
        setSubResubBusy(false);
        return;
      }
      if (d.ok) {
        const what = action === 'manual-unsubscribe' ? 'Unsubscribed' : 'Re-subscribed';
        setSubResubStatus({ kind:'success', text: `✓ ${what} from ${d.lists_affected} list${d.lists_affected===1?'':'s'}` });
        // Flip the local copy so the badges + buttons update in place. The
        // grey "Unsubscribed" pill reads from contact_unsubscribed; flipping
        // it here means the next render shows the right state.
        setReplyOverride({
          ...reply,
          contact_unsubscribed: action === 'manual-unsubscribe',
        });
      } else if (d.code) {
        setSubResubStatus({ kind:'info', text: d.message });
      }
    } catch (e) {
      setSubResubStatus({ kind:'error', text: `${action} failed: ${e.message || e}` });
    } finally {
      setSubResubBusy(false);
    }
  }

  async function addToHotProspects() {
    if (!reply || addingProspect) return;
    setAddingProspect(true);
    setAddError(null);
    setHotProspectBanner(null);
    try {
      const r = await fetch('/api/portal/hot-prospects', {
        method:'POST', credentials:'include',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          prospect_email: reply.from_address,
          prospect_name:  reply.from_name || null,
          source_reply_id: reply.id,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        setAddError(d.error || `Couldn't add to Hot Prospects (HTTP ${r.status})`);
        setAddingProspect(false);
        return;
      }
      setHotProspectBanner({
        kind: d.was_new ? 'added' : 'already',
        prospect_id: d.prospect && d.prospect.id,
      });
      setAddingProspect(false);
    } catch (e) {
      setAddError(`Couldn't add to Hot Prospects: ${e.message || e}`);
      setAddingProspect(false);
    }
  }

  return (
    // Custom layout (not the shared <Modal>) so the action buttons stay
    // pinned at the top while the email body scrolls. Mirrors the admin-side
    // ReplyDetailModal in EmailSection.jsx.
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.45)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:50, padding:20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:CARD, borderRadius:12,
        maxWidth:720, width:'100%',
        height:'90vh', maxHeight:'90vh',
        display:'flex', flexDirection:'column',
        overflow:'hidden',
      }}>

        {/* Pinned header: title close-button + sender/subject/meta + actions */}
        <div style={{ padding:'22px 26px 14px', borderBottom:`0.5px solid ${BORDER}`, flexShrink:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12, gap:12 }}>
            <div style={{ minWidth:0, flex:1 }}>
              <h3 style={{ fontSize:15, fontWeight:500, margin:'0 0 10px', color:TEXT }}>Reply</h3>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8, flexWrap:'wrap', marginBottom:6 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:500, color:TEXT }}>{reply.from_name}</div>
                  <div style={{ fontSize:12, color:MUTED }}>{reply.from_address}</div>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4, alignItems:'center', justifyContent:'flex-end' }}>
                  <ClassifyBadge reply={reply} />
                  <PortalActionBadges reply={reply} onNavigateToCrm={(prospectId) => {
                    // Modal-level "On Hot Prospects list" click: close
                    // this modal first then jump to CRM, mirroring how the
                    // Open-in-CRM banner link behaves.
                    if (onNavigateToCrm) onNavigateToCrm(prospectId);
                  }} />
                </div>
              </div>
              <div style={{ fontSize:13, color:TEXT, marginTop:8, fontWeight:500 }}>{reply.subject}</div>
              <div style={{ fontSize:11, color:MUTED, marginTop:4 }}>
                Received {relTime(reply.received_at)}
                {reply.campaign_title && <> · in reply to <em>{reply.campaign_title}</em></>}
                {reply.mailbox_address && <> · to {reply.mailbox_address}</>}
              </div>
            </div>
            <button onClick={onClose} style={{
              background:'transparent', border:'none', fontSize:20, color:MUTED,
              cursor:'pointer', lineHeight:1, padding:0, marginLeft:4,
            }} aria-label="Close">×</button>
          </div>

          {/* Action buttons — pinned. Hot Prospects sits between Reply and
              Close so the most common positive action stays leftmost. */}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <BtnPrimary onClick={onCompose}>Reply</BtnPrimary>
            {/* Send to Hot Prospects — amber pill-style button. Inline-styled
                (no shared BtnAmber primitive on the portal side) so the look
                matches the admin amber variant. */}
            <button
              onClick={addToHotProspects}
              disabled={addingProspect}
              style={{
                padding:'8px 14px', fontSize:13, fontWeight:500,
                background: AMBER_BG, color: AMBER,
                border:'none', borderRadius:6,
                cursor: addingProspect ? 'default' : 'pointer',
                opacity: addingProspect ? 0.7 : 1,
                fontFamily:'inherit',
              }}
            >{addingProspect ? 'Adding…' : '🔥 Send to Hot Prospects'}</button>
            {/* Unsubscribe / Re-subscribe — toggles based on contact's
                current state in email_subscribers. When contact_unsubscribed
                is true, replaces the Unsubscribe button with a confirmation
                label + Re-subscribe button. Same three-shape backend
                response handling (success/info/error) as the admin side. */}
            {reply.contact_unsubscribed ? (
              <>
                <span style={{
                  padding:'8px 12px', fontSize:12,
                  background:'#F1EFE8', color:'#5F5E5A',
                  borderRadius:6, alignSelf:'center',
                }}>✓ Already unsubscribed</span>
                <button
                  onClick={() => {
                    if (confirm(`Re-subscribe ${reply.from_address} to your mailing lists?`)) {
                      manualSubResub('manual-resubscribe');
                    }
                  }}
                  disabled={subResubBusy}
                  style={{
                    padding:'8px 14px', fontSize:13,
                    background:CARD, color:TEXT, border:`0.5px solid ${BORDER}`, borderRadius:6,
                    cursor: subResubBusy ? 'default' : 'pointer',
                    opacity: subResubBusy ? 0.7 : 1,
                    fontFamily:'inherit',
                  }}
                >Re-subscribe</button>
              </>
            ) : (
              <button
                onClick={() => {
                  if (confirm(`Unsubscribe ${reply.from_address} from all of your mailing lists?`)) {
                    manualSubResub('manual-unsubscribe');
                  }
                }}
                disabled={subResubBusy}
                style={{
                  padding:'8px 14px', fontSize:13, fontWeight:500,
                  background:'#fdecea', color:'#a73a30',
                  border:'none', borderRadius:6,
                  cursor: subResubBusy ? 'default' : 'pointer',
                  opacity: subResubBusy ? 0.7 : 1,
                  fontFamily:'inherit',
                }}
              >Unsubscribe</button>
            )}
            <BtnSecondary onClick={onClose}>Close</BtnSecondary>
          </div>

          {/* Inline status line for the most recent unsub/resub action.
              Three flavours: success (green), info (grey italic, e.g. "not on
              any list"), error (red). Stays visible until the next click so
              the customer sees confirmation of what happened. */}
          {subResubStatus && (
            <div style={{
              marginTop:8, fontSize:12,
              color: subResubStatus.kind === 'success' ? '#0F2E5C'
                   : subResubStatus.kind === 'error'   ? '#a73a30'
                   : '#5F5E5A',
              fontStyle: subResubStatus.kind === 'info' ? 'italic' : 'normal',
            }}>{subResubStatus.text}</div>
          )}
        </div>

        {/* Scrolling body — preserves sender's formatting like a real email
            client. The body div fills the remaining flex space and scrolls
            internally, so the header above stays put. */}
        <div style={{
          padding:'14px 26px 24px', overflowY:'auto', flex:1,
          fontSize:13, color:TEXT, lineHeight:1.6,
        }}>

          {/* Hot Prospects banner — shown above the email body after a click
              on "Send to Hot Prospects". Two variants: 'added' (new row) and
              'already' (the prospect was already on the list). Both offer
              "Open in CRM" which closes the inbox modal and navigates to
              the CRM page with the matching prospect's detail auto-opened. */}
          {hotProspectBanner && (
            <div style={{
              background: hotProspectBanner.kind === 'added' ? GREEN_BG : BLUE_BG,
              borderLeft: `3px solid ${hotProspectBanner.kind === 'added' ? TGA_GREEN_HI : BLUE}`,
              borderRadius:6, padding:'8px 12px', marginBottom:14,
              fontSize:12, color: hotProspectBanner.kind === 'added' ? '#0F2E5C' : '#0C447C',
              lineHeight:1.5,
              display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
            }}>
              <span>
                {hotProspectBanner.kind === 'added'
                  ? <><b style={{fontWeight:500}}>✓ Added to Hot Prospects.</b> The full email thread is attached automatically.</>
                  : <><b style={{fontWeight:500}}>Already on the list.</b> No duplicate created — existing follow-up date and notes were kept.</>
                }
              </span>
              {onNavigateToCrm && (
                <button
                  onClick={() => onNavigateToCrm(hotProspectBanner.prospect_id)}
                  style={{
                    background:'transparent', border:'none', padding:0, cursor:'pointer',
                    fontSize:12, color:'inherit', textDecoration:'underline', fontFamily:'inherit',
                    whiteSpace:'nowrap',
                  }}
                >Open in CRM →</button>
              )}
            </div>
          )}

          {/* Error banner if the add itself failed (network / 500 / etc.). */}
          {addError && (
            <div style={{
              background:'#fdecea', borderLeft:`3px solid ${DANGER}`,
              borderRadius:6, padding:'8px 12px', marginBottom:14,
              fontSize:12, color:DANGER, lineHeight:1.5,
            }}>{addError}</div>
          )}

          {/* Campaign subscriptions panel — per-campaign tickboxes so the
              customer can stop a specific campaign from continuing its drip
              to this contact, OR tick "Unsubscribe from ALL" as a master
              switch. Identical UI in the Hot Prospect detail modal. */}
          <PortalCampaignSubscriptionsPanel
            source="reply"
            sourceId={reply.id}
          />

          {reply.body_html ? (
            <div className="portal-email-body" dangerouslySetInnerHTML={{ __html: reply.body_html }} />
          ) : (
            <div style={{ whiteSpace:'pre-wrap', fontFamily:'inherit' }}>
              {reply.body_text || '(empty message)'}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── COMPOSE REPLY ────────────────────────────────────────────────────────────
function ComposeReplyModal({ reply, onClose, onSend }) {
  const [cc, setCc]     = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const ok = await onSend({ cc: cc.trim(), body });
      // Parent closes the modal on success; on failure we stay open so the
      // customer can fix and resend, and the parent surfaces the error banner.
      if (!ok) setBusy(false);
    } catch (_) {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Reply to ${reply.from_name}`} onClose={() => !busy && onClose()} wide>
      <div style={{ fontSize:11, color:MUTED, marginBottom:10 }}>
        To: <strong style={{ color:TEXT, fontWeight:500 }}>{reply.from_address}</strong> ·
        {' '}Subject: <strong style={{ color:TEXT, fontWeight:500 }}>Re: {reply.subject}</strong>
      </div>

      <Field label="CC (optional)">
        <input type="text" value={cc} onChange={e => setCc(e.target.value)}
          placeholder="someone@yourcompany.co.uk"
          disabled={busy}
          style={loginInputStyle()}
        />
      </Field>

      <Field label="Your reply">
        <textarea value={body} onChange={e => setBody(e.target.value)}
          autoFocus disabled={busy}
          placeholder="Type your reply…"
          style={{
            ...loginInputStyle(),
            fontFamily:'inherit', minHeight:200, resize:'vertical', lineHeight:1.5,
          }}
        />
      </Field>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
        <BtnSecondary onClick={onClose} disabled={busy}>Cancel</BtnSecondary>
        <BtnPrimary onClick={send} disabled={busy || !body.trim()}>{busy ? 'Sending…' : 'Send reply'}</BtnPrimary>
      </div>
    </Modal>
  );
}

// ── CRM HOT PROSPECTS PAGE (customer-portal mirror of admin's CrmHotProspects)
// Single-tenant from the customer's point of view — no customer-switcher (they
// see only their own list). Reads /api/portal/hot-prospects and supports the
// same edit-follow-up / edit-notes / delete / view-thread flow as the admin
// screen. Auto-opens a specific prospect's detail modal when the chrome
// passes `autoOpenProspectId` — used by the inbox's "Open in CRM" link.
function PortalHotProspects({ autoOpenProspectId, onAutoOpenConsumed }) {
  const [prospects, setProspects] = useState(null);  // null = loading
  const [hasLinkedInboxes, setHasLinkedInboxes] = useState(false);
  // Top-of-CRM panel counts. Same shape as the admin side. Scoped to this
  // customer (server enforces). Fetched in parallel with the list and again
  // on any mutation refresh.
  const [dueCounts, setDueCounts] = useState({ overdue: 0, due_today: 0, total: 0 });
  const [search, setSearch]       = useState('');
  const [openProspectId, setOpenProspectId] = useState(null);
  const [error, setError]         = useState(null);

  async function load() {
    try {
      const r = await fetch('/api/portal/hot-prospects', { credentials:'include' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) { setError(d.error || `HTTP ${r.status}`); setProspects([]); setHasLinkedInboxes(false); return; }
      setProspects(d.prospects || []);
      setHasLinkedInboxes(!!d.has_linked_inboxes);
    } catch (e) {
      setError(String(e.message || e));
      setProspects([]);
      setHasLinkedInboxes(false);
    }
  }
  async function loadDueCounts() {
    try {
      const r = await fetch('/api/portal/hot-prospects/due-counts', { credentials:'include' });
      if (!r.ok) return;
      const d = await r.json();
      setDueCounts({
        overdue: Number(d.overdue || 0),
        due_today: Number(d.due_today || 0),
        total: Number(d.total || 0),
      });
    } catch {}
  }
  // Combined refresh after any detail-modal mutation. Also dispatches the
  // sidebar event so the PortalChrome NavItem badge updates immediately
  // (no waiting for its own 30s tick).
  async function refreshAll() {
    await Promise.all([load(), loadDueCounts()]);
    try { window.dispatchEvent(new CustomEvent('studio:hot-prospects-changed')); } catch {}
  }
  useEffect(() => { load(); loadDueCounts(); }, []);

  // Consume the one-shot auto-open prospect id passed in by the chrome
  // (originating from the inbox's "Open in CRM" link). Clear the handoff
  // immediately so coming back to this page later doesn't re-open the same
  // prospect. The detail modal can be reopened by clicking the row again.
  useEffect(() => {
    if (autoOpenProspectId) {
      setOpenProspectId(autoOpenProspectId);
      if (onAutoOpenConsumed) onAutoOpenConsumed();
    }
    // Run once when the prop arrives non-null; rerun if it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenProspectId]);

  const filtered = (() => {
    if (!prospects) return null;
    const q = search.trim().toLowerCase();
    if (!q) return prospects;
    return prospects.filter(p =>
      (p.prospect_name || '').toLowerCase().includes(q)
      || (p.prospect_email || '').toLowerCase().includes(q)
    );
  })();

  return (
    <div>
      <h2 style={pageTitle()}>Hot prospects</h2>
      <p style={pageSub()}>Prospects you've flagged from your inbox. Open a row to add notes, set a follow-up date, or review the conversation.</p>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginTop:14, marginBottom:14 }}>
        <input
          type="text"
          placeholder="Search prospects by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width:300, maxWidth:'100%', padding:'8px 12px',
            border:`0.5px solid ${BORDER}`, borderRadius:7, fontSize:13,
            color:TEXT, background:CARD, outline:'none', fontFamily:'inherit',
          }}
        />
        {filtered && (
          <div style={{ fontSize:12, color:MUTED }}>
            {filtered.length} prospect{filtered.length===1?'':'s'}
            {search.trim() && prospects && prospects.length !== filtered.length && (
              <> (of {prospects.length})</>
            )}
          </div>
        )}
      </div>

      {error && (
        <div style={{
          background:'#fdecea', borderLeft:`3px solid ${DANGER}`,
          borderRadius:6, padding:'10px 14px', marginBottom:14,
          fontSize:13, color:DANGER, lineHeight:1.5,
        }}>Couldn't load Hot Prospects: {error}</div>
      )}

      {/* Top-of-CRM follow-up panel. Renders only when there are urgent
          (overdue or due-today) follow-ups for this customer. Invisible
          when there's nothing to action. */}
      <PortalFollowUpPanel counts={dueCounts} />

      {prospects === null ? (
        <div style={{ fontSize:13, color:MUTED, padding:'20px 0' }}>Loading prospects…</div>
      ) : prospects.length === 0 ? (
        <div style={{
          background:CARD, border:`0.5px dashed ${BORDER}`, borderRadius:8,
          padding:'48px 24px', textAlign:'center', fontSize:14, color:MUTED,
        }}>
          <div style={{ fontSize:15, color:TEXT, marginBottom:6 }}>No prospects yet</div>
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.5, maxWidth:480, margin:'0 auto' }}>
            Open an email in your Inbox and click <strong style={{ fontWeight:500 }}>Send to Hot Prospects</strong> to add the sender here.
          </div>
        </div>
      ) : filtered && filtered.length === 0 ? (
        <div style={{ fontSize:13, color:MUTED, padding:'20px 0' }}>No matches.</div>
      ) : (
        <PortalProspectList prospects={filtered} onOpen={setOpenProspectId} showInboxColumn={hasLinkedInboxes} />
      )}

      {openProspectId && (
        <PortalProspectDetailModal
          prospectId={openProspectId}
          onClose={() => setOpenProspectId(null)}
          onChange={refreshAll}
        />
      )}
    </div>
  );
}

// Top-of-CRM follow-up panel (portal mirror of CrmHotProspects' FollowUpPanel).
// Renders red when anything's overdue, amber when only today is due. Hidden
// when total === 0.
function PortalFollowUpPanel({ counts }) {
  const { overdue, due_today: dueToday, total } = counts || { overdue:0, due_today:0, total:0 };
  if (!total) return null;
  const urgent = overdue > 0;
  const bg = urgent ? '#FCEBEB' : '#FAEEDA';
  const borderColor = urgent ? '#F09595' : '#EF9F27';
  const textColor = urgent ? '#501313' : '#412402';
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

// Customer-side avatar helpers — duplicate of CrmHotProspects' versions but
// inlined here so PortalApp.jsx stays standalone (no cross-import to an admin
// component, which lives outside the customer-portal subtree).
const PORTAL_AVATAR_PALETTE = [
  { bg: '#E4F4FA', fg: '#0F2E5C' },
  { bg: '#FAECE7', fg: '#712B13' },
  { bg: '#EEEDFE', fg: '#3C3489' },
  { bg: '#FBEAF0', fg: '#72243E' },
  { bg: '#E6F1FB', fg: '#0C447C' },
  { bg: '#FAEEDA', fg: '#633806' },
  { bg: '#EAF3DE', fg: '#27500A' },
];
function portalAvatarColor(seed) {
  if (!seed) return PORTAL_AVATAR_PALETTE[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PORTAL_AVATAR_PALETTE[h % PORTAL_AVATAR_PALETTE.length];
}
function portalInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function portalRelativeTime(value) {
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
function portalFollowUpFormat(value) {
  if (!value) return { label: 'Not set', color: '#999', urgent: false };
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

function PortalProspectList({ prospects, onOpen, showInboxColumn }) {
  if (!prospects || prospects.length === 0) return null;
  // Grid template: mirrors CrmHotProspects.jsx's ProspectList — adds the
  // Grid now always includes a Status column (between Email and Inbox/Added).
  // Inbox column appears for linked-inbox customers only — adds 0.85fr there.
  const gridCols = showInboxColumn
    ? '1.5fr 1.5fr 0.9fr 1.1fr 0.85fr 0.85fr 32px'
    : '1.8fr 1.7fr 1.0fr 1.1fr 1.1fr 32px';
  return (
    <div style={{
      background:CARD, border:`0.5px solid ${BORDER}`, borderRadius:8,
      overflow:'hidden',
    }}>
      <div style={{
        display:'grid', gridTemplateColumns: gridCols,
        gap:12, padding:'10px 16px',
        background:'#fafaf8', borderBottom:`0.5px solid ${BORDER}`,
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
        // Server orders converted rows last — find the index of the first
        // converted row to insert the "Converted (N)" divider. If none are
        // converted, firstClosed === -1 and the divider isn't rendered.
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
                  color:'#888780',
                  borderTop:`0.5px solid ${BORDER}`,
                  borderBottom:`0.5px solid ${BORDER}`,
                }}>Converted ({convertedCount})</div>
              )}
              <PortalProspectRow
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
function PortalProspectRow({ prospect, isLast, onOpen, showInboxColumn, gridCols }) {
  const av = portalAvatarColor(prospect.prospect_name || prospect.prospect_email);
  const fu = portalFollowUpFormat(prospect.follow_up_date);
  const isConverted = !!prospect.closed_at;
  const chrome = portalResolveProspectChrome(prospect);
  // NEW pill — shown until the customer opens this prospect on the portal
  // side for the first time. Tracks separately from admin's view state by
  // design (each audience has its own "have I seen this" signal).
  const isUnviewed = !prospect.portal_first_viewed_at && !isConverted;
  return (
    <div onClick={onOpen} style={{
      display:'grid', gridTemplateColumns: gridCols,
      gap:12, padding:'14px 16px', alignItems:'center',
      borderBottom: isLast ? 'none' : `0.5px solid ${BORDER}`,
      cursor:'pointer',
      // Faint tint on converted rows so they're visually de-emphasised
      // without being hidden. Matches the admin side.
      background: isConverted ? '#f9faf7' : 'transparent',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
        <div style={{
          width:32, height:32, borderRadius:'50%',
          background: av.bg, color: av.fg,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:12, fontWeight:500, flexShrink:0,
        }}>{portalInitials(prospect.prospect_name || prospect.prospect_email)}</div>
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
              background: GREEN_BG, color: GREEN,
              fontSize:11, padding:'1px 7px', borderRadius:999,
              fontWeight:500, flexShrink:0,
            }}>✓ Converted</span>
          )}
        </div>
      </div>
      <div style={{ fontSize:13, color:MUTED, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{prospect.prospect_email}</div>
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
              background: GREEN_BG, color: GREEN,
              fontSize:11, padding:'2px 8px', borderRadius:999,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
              display:'inline-block', maxWidth:'100%',
            }}>{prospect.source_inbox_name}</span>
          )}
        </div>
      )}
      <div style={{ fontSize:13, color:MUTED }}>{portalRelativeTime(prospect.added_at)}</div>
      <div style={{ fontSize:13, color: fu.color, fontWeight: fu.urgent ? 500 : 400 }}>{fu.label}</div>
      <div style={{ textAlign:'right', color:'#999', fontSize:18 }}>›</div>
    </div>
  );
}

function PortalProspectDetailModal({ prospectId, onClose, onChange }) {
  const [data, setData] = useState(null);  // { prospect, thread } or { error }
  const [followUp, setFollowUp] = useState('');
  const [notes, setNotes] = useState('');
  // Status + tag colour state — matches admin's modal pattern. Saved via
  // the same debounced PUT pipeline as follow-up/notes.
  const [status, setStatus] = useState('new');
  const [tagColor, setTagColor] = useState(null);
  const [savingState, setSavingState] = useState(''); // '', 'saving', 'saved', 'error'
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState(null);
  // Mark-as-converted / Reopen network state. Single busy flag covers both
  // transitions — only one of the two buttons is visible at a time depending
  // on closed_at.
  const [markBusy, setMarkBusy] = useState(false);
  const [markError, setMarkError] = useState(null);

  // Fetch the prospect + thread on open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/portal/hot-prospects/${encodeURIComponent(prospectId)}/thread`, { credentials:'include' });
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || d.error) { setData({ error: d.error || `HTTP ${r.status}` }); return; }
        setData(d);
        setFollowUp(d.prospect.follow_up_date || '');
        setNotes(d.prospect.notes || '');
        setStatus(d.prospect.status || 'new');
        setTagColor(d.prospect.tag_color || null);

        // Fire-and-forget mark-viewed if not yet viewed on the portal side.
        // Idempotent server-side. Notify parent so the sidebar unread badge
        // + per-row NEW pill refresh.
        if (!d.prospect.portal_first_viewed_at) {
          try {
            await fetch(`/api/portal/hot-prospects/${encodeURIComponent(prospectId)}/mark-viewed`, {
              method:'POST', credentials:'include',
            });
            if (onChange) onChange();
          } catch {}
        }
      } catch (e) {
        if (!cancelled) setData({ error: String(e.message || e) });
      }
    })();
    return () => { cancelled = true; };
  }, [prospectId, onChange]);

  // Debounced auto-save (1s) for follow-up, notes, status, tag colour.
  // Mirrors admin behaviour.
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (!data || data.error) return;
    if (initialLoadRef.current) {
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
        const r = await fetch(`/api/portal/hot-prospects/${encodeURIComponent(prospectId)}`, {
          method:'PUT', credentials:'include',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) { setSavingState('error'); return; }
        setData(prev => prev ? { ...prev, prospect: d.prospect } : prev);
        setSavingState('saved');
        if (onChange) onChange();
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
      const r = await fetch(`/api/portal/hot-prospects/${encodeURIComponent(prospectId)}/mark-converted`, {
        method:'POST', credentials:'include',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        setMarkError(d.error || `HTTP ${r.status}`);
        setMarkBusy(false);
        return;
      }
      setData(prev => prev ? { ...prev, prospect: d.prospect } : prev);
      setMarkBusy(false);
      if (onChange) onChange();
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
      const r = await fetch(`/api/portal/hot-prospects/${encodeURIComponent(prospectId)}/reopen`, {
        method:'POST', credentials:'include',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        setMarkError(d.error || `HTTP ${r.status}`);
        setMarkBusy(false);
        return;
      }
      setData(prev => prev ? { ...prev, prospect: d.prospect } : prev);
      setMarkBusy(false);
      if (onChange) onChange();
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
      const r = await fetch(`/api/portal/hot-prospects/${encodeURIComponent(prospectId)}`, {
        method:'DELETE', credentials:'include',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        setRemoveError(d.error || `HTTP ${r.status}`);
        setRemoveBusy(false);
        return;
      }
      if (onChange) onChange();
      onClose();
    } catch (e) {
      setRemoveError(String(e.message || e));
      setRemoveBusy(false);
    }
  }

  // Re-subscribe handler. Only triggered from a button that's only shown
  // when prospect.contact_unsubscribed === true. Flips the prospect back to
  // subscribed across the customer's linked set; updates the local prospect
  // copy in-place on success so the button disappears.
  const [resubBusy, setResubBusy] = useState(false);
  const [resubStatus, setResubStatus] = useState(null);
  async function resubscribeProspect() {
    if (resubBusy || !data?.prospect) return;
    if (!confirm(`Re-subscribe ${data.prospect.prospect_email} to your mailing lists?`)) return;
    setResubBusy(true);
    setResubStatus(null);
    try {
      const r = await fetch(`/api/portal/hot-prospects/${encodeURIComponent(prospectId)}/resubscribe`, {
        method:'POST', credentials:'include',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok && !d.code) {
        setResubStatus({ kind:'error', text: d.error || `Re-subscribe failed (HTTP ${r.status})` });
        setResubBusy(false);
        return;
      }
      if (d.ok) {
        setResubStatus({ kind:'success', text: `✓ Re-subscribed to ${d.lists_affected} list${d.lists_affected===1?'':'s'}` });
        // Flip the prospect locally so the button disappears.
        setData(prev => prev ? { ...prev, prospect: { ...prev.prospect, contact_unsubscribed: false } } : prev);
      } else if (d.code) {
        setResubStatus({ kind:'info', text: d.message });
        // Edge-case: prospect was flagged as unsubbed at fetch time but is
        // somehow already subscribed now (another tab? admin action?). Clear
        // the local flag so the UI re-syncs.
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

  // Unsubscribe handler — opposite direction. Only triggered from a button
  // that's only shown when contact_on_list && !contact_unsubscribed. Same
  // three-shape response handling; on success flips contact_unsubscribed
  // locally so the banner swaps to Re-subscribe in place.
  const [unsubBusy, setUnsubBusy] = useState(false);
  const [unsubStatus, setUnsubStatus] = useState(null);
  async function unsubscribeProspect() {
    if (unsubBusy || !data?.prospect) return;
    if (!confirm(`Unsubscribe ${data.prospect.prospect_email} from all of your mailing lists?`)) return;
    setUnsubBusy(true);
    setUnsubStatus(null);
    try {
      const r = await fetch(`/api/portal/hot-prospects/${encodeURIComponent(prospectId)}/unsubscribe`, {
        method:'POST', credentials:'include',
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
    <Modal title="Hot prospect" onClose={onClose} wide>
      {!data ? (
        <div style={{ textAlign:'center', padding:30, color:MUTED, fontSize:13 }}>Loading prospect…</div>
      ) : data.error ? (
        <div style={{ background:'#fdecea', borderLeft:`3px solid ${DANGER}`, borderRadius:6, padding:'10px 14px', fontSize:13, color:DANGER }}>
          Couldn't load prospect: {data.error}
        </div>
      ) : (
        <PortalProspectDetailBody
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
    </Modal>
  );
}

function PortalProspectDetailBody({ data, followUp, setFollowUp, notes, setNotes, status, setStatus, tagColor, setTagColor, savingState, onRemove, removeBusy, removeError, onMarkConverted, onReopen, markBusy, markError, onResubscribe, resubBusy, resubStatus, onUnsubscribe, unsubBusy, unsubStatus }) {
  const p = data.prospect;
  const av = portalAvatarColor(p.prospect_name || p.prospect_email);
  const isConverted = !!p.closed_at;

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
      {/* Converted banner — only when the prospect is closed. */}
      {isConverted && (
        <div style={{
          background: GREEN_BG, border:`0.5px solid #A9DEF0`,
          borderRadius:8, padding:'10px 14px', marginBottom:14,
          fontSize:13, color: GREEN,
        }}>
          <strong style={{ fontWeight:500 }}>✓ Converted</strong> on {formatClosedAt(p.closed_at)}
          {p.closed_by && (
            <> by {(p.closed_by || '').startsWith('portal:') ? 'you' : 'admin'}</>
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
          }}>{portalInitials(p.prospect_name || p.prospect_email)}</div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:500, color:TEXT, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {p.prospect_name || <span style={{ color:MUTED, fontWeight:400 }}>(no name)</span>}
            </div>
            <div style={{ fontSize:13, color:MUTED, marginTop:2 }}>{p.prospect_email}</div>
            {/* Source-inbox subtitle, only shown when this prospect's customer
                has linked inboxes (i.e. there's something useful to show).
                Hidden for single-inbox customers. */}
            {p.has_linked_inboxes && p.source_inbox_name && (
              <div style={{ marginTop:4 }}>
                <span style={{
                  background: GREEN_BG, color: GREEN,
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
                background:'transparent', color: GREEN,
                border:`0.5px solid ${GREEN}`,
                borderRadius:7, padding:'7px 12px', fontSize:13, fontWeight:500,
                cursor: markBusy ? 'not-allowed' : 'pointer',
                opacity: markBusy ? 0.6 : 1,
                fontFamily:'inherit',
              }}
            >{markBusy ? 'Reopening…' : 'Reopen as active'}</button>
          ) : (
            <button
              onClick={onMarkConverted}
              disabled={markBusy}
              style={{
                background: GREEN, color:'#fff',
                border:'none',
                borderRadius:7, padding:'7px 12px', fontSize:13, fontWeight:500,
                cursor: markBusy ? 'not-allowed' : 'pointer',
                opacity: markBusy ? 0.6 : 1,
                display:'flex', alignItems:'center', gap:6,
                fontFamily:'inherit',
              }}
            >{markBusy ? 'Saving…' : '✓ Mark as converted'}</button>
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
          >🗑 Remove</button>
        </div>
      </div>

      {/* Re-subscribe — only appears when the contact is currently
          unsubscribed from at least one of the customer's mailing lists.
          Hidden for prospects who came in via website forms (no subscriber
          rows at all) — those need the Subscribers admin section, not a
          toggle button. Status line below the button mirrors the per-reply
          modal's pattern. */}
      {p.contact_unsubscribed && (
        <div style={{
          marginBottom:12,
          padding:'10px 14px',
          background: '#FFF8E6',
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
          color: resubStatus.kind === 'success' ? '#0F2E5C'
               : resubStatus.kind === 'error'   ? DANGER
               : '#5F5E5A',
          fontStyle: resubStatus.kind === 'info' ? 'italic' : 'normal',
        }}>{resubStatus.text}</div>
      )}

      {/* Unsubscribe — opposite direction. Only appears when the contact IS
          on at least one of the customer's lists AND currently subscribed.
          Mutually exclusive with the Re-subscribe banner. Hidden for
          prospects not on any list so they don't see a button that would
          refuse on click. */}
      {p.contact_on_list && !p.contact_unsubscribed && (
        <div style={{
          marginBottom:12,
          padding:'10px 14px',
          background: '#FCEBEB',
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
          color: unsubStatus.kind === 'success' ? '#0F2E5C'
               : unsubStatus.kind === 'error'   ? DANGER
               : '#5F5E5A',
          fontStyle: unsubStatus.kind === 'info' ? 'italic' : 'normal',
        }}>{unsubStatus.text}</div>
      )}

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

      <div style={{
        display:'grid', gridTemplateColumns:'1fr 1fr', gap:16,
        padding:'14px 0', borderTop:`0.5px solid ${BORDER}`, borderBottom:`0.5px solid ${BORDER}`,
        marginBottom:16,
      }}>
        <div>
          <div style={{ fontSize:11, color:'#999', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Added to list</div>
          <div style={{ fontSize:14, color:TEXT }}>
            {portalRelativeTime(p.added_at)}
            <span style={{ color:MUTED, marginLeft:6, fontSize:12 }}>
              ({(p.added_by || '').startsWith('portal:') ? 'by you' : 'by Sweetbyte'})
            </span>
          </div>
        </div>
        <div>
          <div style={{ fontSize:11, color:'#999', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Follow up on</div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <input
              type="date"
              value={followUp}
              onChange={e => setFollowUp(e.target.value)}
              style={{
                fontSize:13, padding:'6px 10px',
                border:`0.5px solid ${BORDER}`, borderRadius:6,
                color:TEXT, background:CARD, outline:'none', fontFamily:'inherit',
              }}
            />
            {followUp && (
              <button
                onClick={() => setFollowUp('')}
                style={{
                  fontSize:12, padding:'6px 10px',
                  background:'#fafaf8', color:MUTED, border:`0.5px solid ${BORDER}`,
                  borderRadius:6, cursor:'pointer', fontFamily:'inherit',
                }}
              >Clear</button>
            )}
          </div>
        </div>
      </div>

      {/* Status + Tag colour pickers — same debounced PUT pipeline. */}
      <div style={{ display:'flex', gap:24, marginBottom:18, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:11, color:'#999', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Status</div>
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
            {PORTAL_STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize:11, color:'#999', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Tag colour</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
            {PORTAL_TAG_COLORS.map(c => {
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

      <div style={{ marginBottom:18 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontSize:11, color:'#999', textTransform:'uppercase', letterSpacing:'0.5px' }}>Notes</div>
          <div style={{ fontSize:11, color: savingState==='error' ? DANGER : savingState==='saving' ? AMBER : savingState==='saved' ? TGA_GREEN_HI : 'transparent' }}>
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
          customer can stop a specific campaign from continuing its drip
          to this contact, OR tick "Unsubscribe from ALL" as a master
          switch. Identical UI in the inbox open-email modal. */}
      <PortalCampaignSubscriptionsPanel
        source="hot_prospect"
        sourceId={p.id}
      />

      <PortalThreadList thread={data.thread || []} />
    </div>
  );
}

// ── Campaign subscriptions panel (portal copy) ───────────────────────────────
// Per-campaign opt-out widget. Identical behaviour and look to the admin
// CampaignSubscriptionsPanel components in EmailSection.jsx and
// CrmHotProspects.jsx. Hits portal-scoped endpoints instead of admin ones.
//
// Props:
//   source   — 'reply' | 'hot_prospect' (chooses the endpoint base)
//   sourceId — the reply ID or hot prospect ID
//
// Endpoints used:
//   GET  /api/portal/{replies|hot-prospects}/:id/subscriptions
//   PUT  /api/portal/{replies|hot-prospects}/:id/subscriptions
function PortalCampaignSubscriptionsPanel({ source, sourceId }) {
  const [state, setState]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [savingKey, setSavingKey] = useState(null);

  const basePath = source === 'hot_prospect'
    ? `/api/portal/hot-prospects/${sourceId}/subscriptions`
    : `/api/portal/replies/${sourceId}/subscriptions`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(basePath, { credentials: 'include' })
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
        credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState(await r.json());
    } catch (e) {
      try {
        const rr = await fetch(basePath, { credentials: 'include' });
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
        <div style={{fontSize: 10, color: TERTIARY_TEXT}}>Synced admin ↔ portal</div>
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
        <div style={{fontSize: 10, color: TERTIARY_TEXT}}>includes future</div>
      </label>

      {campaigns.length === 0 && !masterOn && (
        <div style={{
          fontSize: 11, color: TERTIARY_TEXT, padding: '8px 4px 2px',
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
                {c.list_name && <span style={{color: isAuto ? '#633806' : TERTIARY_TEXT, fontWeight: 400}}> · {c.list_name}</span>}
              </div>
              <div style={{fontSize: 10, color: isAuto ? '#633806' : TERTIARY_TEXT}}>
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
          fontSize: 10, color: TERTIARY_TEXT, marginTop: 6, fontStyle: 'italic',
        }}>
          All campaigns blocked via master switch — untick "Unsubscribe from ALL" to control campaigns individually.
        </div>
      )}
    </div>
  );
}

function PortalThreadList({ thread }) {
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ fontSize:13, fontWeight:500, color:TEXT }}>Email history with this prospect</div>
        <div style={{ fontSize:11, color:'#999' }}>
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
        thread.map(msg => <PortalThreadMessage key={`${msg.direction}-${msg.id}`} msg={msg} />)
      )}
    </div>
  );
}
function PortalThreadMessage({ msg }) {
  const isInbound = msg.direction === 'inbound';
  const arrow = isInbound ? '↩' : '↑';
  const label = isInbound
    ? `From ${msg.from_name || msg.from_address} · ${portalRelativeTime(msg.at)}`
    : `From us · ${portalRelativeTime(msg.at)}`;
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
          <span style={{ color: isInbound ? BLUE : TGA_GREEN_HI }}>{arrow}</span>
          <span>{label}</span>
        </div>
        <div style={{ fontSize:11, color:'#999', whiteSpace:'nowrap' }}>{date}</div>
      </div>
      {msg.subject && (
        <div style={{ fontSize:12, color:TEXT, fontWeight:500, marginBottom:6 }}>{msg.subject}</div>
      )}
      <div style={{
        fontSize:13, color:MUTED, lineHeight:1.6,
        whiteSpace:'pre-wrap',
        maxHeight:240, overflowY:'auto',
      }}>
        {msg.body_text || <em style={{ color:'#999' }}>(no plain text body)</em>}
      </div>
      {msg.error && (
        <div style={{ marginTop:8, fontSize:11, color:DANGER }}>
          Send failed: {msg.error}
        </div>
      )}
    </div>
  );
}

// ── CAMPAIGNS PAGE (read-only) ───────────────────────────────────────────────
// ── PORTAL CAMPAIGNS (redesigned 2026-05-20, decision #87) ───────────────────
// Read-only view of email campaigns the customer has had run on their behalf.
// Four UX choices locked across the mockup rounds (see decision #87):
//
//   1. Inline accordion — clicking a campaign row expands a detail panel
//      below the row in the same table. NOT a side drawer or full-page view.
//   2. Dual tracking surface — every campaign row carries a "Tracking" pill
//      AND every open/click stat carries a "X / Y tracked" denominator label
//      when tracking_split_available is true. Honest 0/0 omitted on historic
//      campaigns (tracking_split_available=false) — we just show the pill.
//   3. Drip tabs matching admin — multi-step drips render their per-step
//      breakdown as a "1st contact / 2nd contact / 3rd contact" tab strip
//      inside the accordion panel, matching the admin CampaignModal pattern.
//   4. Combined headline + per-step breakdown — table row shows combined
//      totals across all steps; expanded panel tabs show per-step rollup.
//
// Plus a dismissable amber explainer banner above the KPI tiles about what
// tracking means and why some emails aren't tracked. Dismissed state lives in
// localStorage (try/catch-wrapped per the project pattern — same as the CRM
// localStorage usage in #79 / #81).
//
// Three honesty caveats baked into the design (data model doesn't carry these
// distinctions, so the frontend doesn't pretend to either):
//   - No hard vs soft bounce split. One "Bounces" number per campaign.
//   - No unsubscribe source breakdown. One "Unsubscribes" number.
//   - No per-step reply attribution. Reply count shown at campaign level
//     only; per-step tabs do NOT show a reply stat.
//
// The detail endpoint (GET /api/portal/campaigns/:id) is only hit when a row
// is expanded — keeps the initial list fast.

const PORTAL_CAMPAIGNS_BANNER_KEY = 'studio.portal.campaigns.banner_dismissed';

function PortalCampaigns() {
  const [campaigns, setCampaigns]     = useState(null);  // null=loading, []=none, [...]=list
  const [loadError, setLoadError]     = useState(null);
  const [expandedId, setExpandedId]   = useState(null);
  // Detail payload cache keyed by campaign id. Once a row is expanded we keep
  // the detail in memory so reopening the same row is instant.
  const [details, setDetails]         = useState({});    // { [id]: { loading, error, data } }
  // Banner dismiss state — read once on mount so a stale tab doesn't fight
  // a tab that just dismissed it. We re-read localStorage on dismiss to write.
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return localStorage.getItem(PORTAL_CAMPAIGNS_BANNER_KEY) === '1'; }
    catch { return false; }
  });

  useEffect(() => {
    fetch('/api/portal/campaigns', { credentials:'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => setCampaigns(d.campaigns || []))
      .catch(e => {
        setLoadError(String(e));
        setCampaigns([]);
      });
  }, []);

  // Toggle expand. When opening a row we kick off a fetch for the detail
  // payload (per-step html_body + replies list) if not already cached. The
  // table row stays visible — the detail panel renders below it.
  function toggleExpand(id) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (details[id]?.data) return;  // cached
    setDetails(prev => ({ ...prev, [id]: { loading: true, error: null, data: null } }));
    fetch(`/api/portal/campaigns/${encodeURIComponent(id)}`, { credentials:'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => setDetails(prev => ({ ...prev, [id]: { loading:false, error:null, data:d } })))
      .catch(e => setDetails(prev => ({ ...prev, [id]: { loading:false, error:String(e), data:null } })));
  }

  function dismissBanner() {
    setBannerDismissed(true);
    try { localStorage.setItem(PORTAL_CAMPAIGNS_BANNER_KEY, '1'); } catch {}
  }

  if (loadError) {
    return (
      <div>
        <h2 style={pageTitle()}>Campaigns</h2>
        <div style={{
          padding:'12px 16px', background:'#fbe9e9', color:DANGER,
          borderRadius:8, fontSize:13, marginTop:18,
        }}>Couldn't load campaigns: {loadError}</div>
      </div>
    );
  }
  if (campaigns === null) {
    return (
      <div>
        <h2 style={pageTitle()}>Campaigns</h2>
        <p style={pageSub()}>Loading campaigns…</p>
      </div>
    );
  }
  if (campaigns.length === 0) {
    return (
      <div>
        <h2 style={pageTitle()}>Campaigns</h2>
        <div style={{
          marginTop:18, padding:'40px 32px', background:CARD,
          borderRadius:8, border:`0.5px dashed ${BORDER}`,
          textAlign:'center',
        }}>
          <div style={{ fontSize:14, color:TEXT, marginBottom:6, fontWeight:500 }}>
            No campaigns yet
          </div>
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.5, maxWidth:440, margin:'0 auto' }}>
            Email campaigns run for your account will show up here with delivery and engagement stats.
          </div>
        </div>
      </div>
    );
  }

  // Aggregate strip — totals across all campaigns.
  const totalSent      = campaigns.reduce((a, c) => a + (c.sent || 0), 0);
  const totalReplies   = campaigns.reduce((a, c) => a + (c.replies || 0), 0);
  const inProgressCount = campaigns.filter(c =>
    c.status === 'sending' || c.status === 'in_progress'
  ).length;

  return (
    <div>
      <h2 style={pageTitle()}>Campaigns</h2>
      <p style={pageSub()}>Read-only view of every email campaign we've run for your account.</p>

      {!bannerDismissed && <TrackingExplainerBanner onDismiss={dismissBanner} />}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10, marginBottom:16 }}>
        <StatCard label="Total campaigns"   value={campaigns.length} />
        <StatCard label="Total sent"        value={totalSent.toLocaleString()} />
        <StatCard label="Replies received"  value={totalReplies} />
        <StatCard label="In progress"       value={inProgressCount} />
      </div>

      <div style={{
        background:CARD, borderRadius:8, border:`0.5px solid ${BORDER}`, overflow:'hidden',
      }}>
        <CampaignsTableHeader />
        {campaigns.map(c => (
          <CampaignRowAndPanel
            key={c.id}
            campaign={c}
            isExpanded={expandedId === c.id}
            detail={details[c.id]}
            onToggle={() => toggleExpand(c.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Tracking explainer banner ────────────────────────────────────────────────
// Dismissable amber strip explaining what "tracked" means in the per-stat
// denominators. Once dismissed the customer doesn't see it again on this
// device (localStorage). Other devices/browsers will still show it once.
function TrackingExplainerBanner({ onDismiss }) {
  return (
    <div style={{
      marginBottom:14, padding:'12px 14px',
      background:AMBER_BG, color:AMBER,
      borderRadius:8, fontSize:12, lineHeight:1.55,
      display:'flex', gap:12, alignItems:'flex-start',
    }}>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:600, marginBottom:4 }}>About these numbers</div>
        <div>
          Open and click tracking is only switched on for emails sent to people you've
          already been in touch with — it's deliberately off for cold first-touch sends
          to protect your domain reputation. Each stat shows how many emails were tracked
          (e.g. <strong style={{ fontWeight:600 }}>"12 / 50 tracked"</strong> means 50 emails
          were sent and 12 of those had tracking applied). Reply counts and bounces are
          always accurate.
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{
          flexShrink:0, background:'transparent', border:'none',
          color:AMBER, cursor:'pointer', fontSize:14, fontWeight:500,
          padding:'2px 4px', lineHeight:1, opacity:0.7,
        }}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

// ── Table header ─────────────────────────────────────────────────────────────
// Grid columns: Campaign title (flex) | Tracking pill | Status pill |
//               Sent | Opens | Clicks | Replies | Started date | chevron
function CAMPAIGNS_GRID() {
  return '1.6fr 88px 110px 60px 60px 60px 60px 80px 24px';
}
function CampaignsTableHeader() {
  return (
    <div style={{
      display:'grid', gridTemplateColumns:CAMPAIGNS_GRID(),
      gap:10, alignItems:'center', padding:'10px 14px',
      borderBottom:`0.5px solid ${BORDER}`,
      fontSize:11, color:MUTED, textTransform:'uppercase', letterSpacing:'0.04em',
    }}>
      <div>Campaign</div>
      <div>Tracking</div>
      <div>Status</div>
      <div style={{ textAlign:'right' }}>Sent</div>
      <div style={{ textAlign:'right' }}>Opens</div>
      <div style={{ textAlign:'right' }}>Clicks</div>
      <div style={{ textAlign:'right' }}>Replies</div>
      <div style={{ textAlign:'right' }}>Started</div>
      <div></div>
    </div>
  );
}

// ── Row + expanded panel ─────────────────────────────────────────────────────
// One unit so the row's bottom-border collapses into the panel when expanded,
// giving the visual feel of one continuous card.
function CampaignRowAndPanel({ campaign, isExpanded, detail, onToggle }) {
  const c = campaign;

  // Format started_at — SQLite "YYYY-MM-DD HH:MM:SS" without Z is parsed as
  // local time by browsers; force UTC interpretation so it matches admin.
  let startedDisplay = '';
  if (c.started_at) {
    const ts = c.started_at.includes('Z') ? c.started_at : c.started_at.replace(' ', 'T') + 'Z';
    startedDisplay = new Date(ts).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
  }

  return (
    <>
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        style={{
          display:'grid', gridTemplateColumns:CAMPAIGNS_GRID(),
          gap:10, alignItems:'center', padding:'12px 14px',
          borderBottom: isExpanded ? 'none' : `0.5px solid ${BORDER}`,
          fontSize:12, color:TEXT, cursor:'pointer',
          background: isExpanded ? '#f9f8f4' : CARD,
          transition:'background 80ms ease-in',
        }}
        onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = '#fafaf8'; }}
        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = CARD; }}
      >
        <div style={{ minWidth:0 }}>
          <div style={{ fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {c.title}
          </div>
          {c.is_drip && (
            <div style={{ fontSize:10.5, color:MUTED, marginTop:2 }}>
              Drip · {c.steps_sent} of {c.steps_total} contacts sent
            </div>
          )}
        </div>
        <div><TrackingPill mode={c.tracking_mode} /></div>
        <div><StatusPill status={c.status} stepsSent={c.steps_sent} stepsTotal={c.steps_total} /></div>
        <StatCell value={c.sent} alwaysShow />
        <StatCell value={c.opens}   tracked={c.tracked} splitAvailable={c.tracking_split_available} muted={c.tracking_mode === 'off'} />
        <StatCell value={c.clicks}  tracked={c.tracked} splitAvailable={c.tracking_split_available} muted={c.tracking_mode === 'off'} />
        <div style={{
          textAlign:'right',
          color: c.replies > 0 ? GREEN : TEXT,
          fontWeight: c.replies > 0 ? 500 : 400,
        }}>{c.replies || 0}</div>
        <div style={{ textAlign:'right', color:MUTED, fontSize:11 }}>{startedDisplay}</div>
        <div style={{
          color:MUTED, fontSize:14, textAlign:'center',
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition:'transform 120ms ease-in',
        }}>›</div>
      </div>

      {isExpanded && (
        <CampaignDetailPanel campaign={c} detail={detail} />
      )}
    </>
  );
}

// ── Stat cell with optional "X / Y tracked" denominator ─────────────────────
// `value` is the open / click count. When splitAvailable is true AND tracking
// is on, we show "value / tracked" stacked tightly. When tracking is off we
// dim and show "—" (open/click numbers are meaningless when not instrumented).
function StatCell({ value, tracked, splitAvailable, muted, alwaysShow }) {
  if (muted && !alwaysShow) {
    return (
      <div style={{ textAlign:'right', color:TERTIARY_TEXT }}>—</div>
    );
  }
  return (
    <div style={{ textAlign:'right' }}>
      <div>{(value || 0).toLocaleString()}</div>
      {!alwaysShow && splitAvailable && typeof tracked === 'number' && (
        <div style={{ fontSize:10, color:MUTED, marginTop:1, lineHeight:1 }}>
          of {tracked.toLocaleString()} tracked
        </div>
      )}
    </div>
  );
}

// ── Tracking pill ────────────────────────────────────────────────────────────
// Three modes from the data model: 'off' | 'smart' | 'all'. Shown as a small
// pill so the customer can scan tracking state down the column.
function TrackingPill({ mode }) {
  const cfg = {
    off:   { label: 'Off',   bg:'#f1efe8', color: MUTED },
    smart: { label: 'Smart', bg: BLUE_BG,  color: BLUE  },
    all:   { label: 'All',   bg: GREEN_BG, color: GREEN },
  }[mode || 'off'] || { label: 'Off', bg:'#f1efe8', color: MUTED };
  return (
    <span style={{ ...badgeStyle(), background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

// ── Status pill ──────────────────────────────────────────────────────────────
// Six possible statuses normalised by the backend:
//   'scheduled' | 'sending' | 'sent' | 'failed' | 'in_progress'
// in_progress = a drip campaign part-way through its steps. Amber per #87.
function StatusPill({ status, stepsSent, stepsTotal }) {
  const cfg = {
    scheduled:   { label: 'Scheduled',                                      bg: '#f4f1e8',  color: MUTED },
    sending:     { label: 'Sending',                                        bg: BLUE_BG,    color: BLUE  },
    sent:        { label: 'Sent',                                           bg: '#f4f1e8',  color: MUTED },
    failed:      { label: 'Failed',                                         bg: '#fbe9e9',  color: DANGER },
    in_progress: { label: `In progress · ${stepsSent || 0}/${stepsTotal || 0}`, bg: AMBER_BG, color: AMBER },
  }[status] || { label: 'Sent', bg: '#f4f1e8', color: MUTED };
  return (
    <span style={{ ...badgeStyle(), background: cfg.bg, color: cfg.color, whiteSpace:'nowrap' }}>
      {cfg.label}
    </span>
  );
}

// ── Detail panel (inline accordion contents) ─────────────────────────────────
// Shown below the row when expanded. Contains:
//   - Combined-stats strip (mirrors the row, denser)
//   - Timeline strip showing each step's send date (or "Upcoming")
//   - Drip tabs (one per step) if is_drip, otherwise a single panel
//   - Per-tab: subject + sender + delay + stats + email body preview
//   - Recent replies list at the bottom (last 30, matched to this campaign)
function CampaignDetailPanel({ campaign, detail }) {
  const c = campaign;
  const [activeTab, setActiveTab] = useState(0);

  if (!detail || detail.loading) {
    return (
      <div style={{
        padding:'24px 14px', background:'#f9f8f4',
        borderBottom:`0.5px solid ${BORDER}`,
        fontSize:12, color:MUTED, textAlign:'center',
      }}>Loading campaign details…</div>
    );
  }
  if (detail.error) {
    return (
      <div style={{
        padding:'12px 14px', background:'#f9f8f4',
        borderBottom:`0.5px solid ${BORDER}`,
        fontSize:12, color:DANGER,
      }}>Couldn't load details: {detail.error}</div>
    );
  }

  const d = detail.data;
  const steps = d.steps || [];
  const replies = d.replies_list || [];
  const safeTab = Math.min(activeTab, Math.max(0, steps.length - 1));
  const currentStep = steps[safeTab];

  return (
    <div style={{
      background:'#f9f8f4',
      borderBottom:`0.5px solid ${BORDER}`,
      padding:'18px 18px 22px',
    }}>
      {/* Combined headline */}
      <div style={{ marginBottom:14 }}>
        <div style={{
          fontSize:10, color:MUTED, textTransform:'uppercase', letterSpacing:'0.04em',
          marginBottom:6,
        }}>Overall — across all contacts</div>
        <CombinedStatsStrip campaign={c} />
      </div>

      {/* Timeline strip — sent / scheduled / upcoming dots per step */}
      {c.is_drip && steps.length > 1 && (
        <div style={{ marginBottom:16 }}>
          <TimelineStrip steps={steps} stepsSent={c.steps_sent} />
        </div>
      )}

      {/* Step tabs — only for drips */}
      {steps.length > 1 && (
        <div style={{
          display:'flex', gap:2, borderBottom:`0.5px solid ${BORDER}`,
          marginBottom:14,
        }}>
          {steps.map((s, i) => (
            <button
              key={s.step_number}
              onClick={() => setActiveTab(i)}
              style={tabBtnStyle(i === safeTab)}
            >
              {ordinal(s.step_number)} contact
              {s.status === 'pending' && (
                <span style={{ marginLeft:6, color:MUTED, fontSize:10 }}>· not yet sent</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Per-step panel */}
      {currentStep && (
        <StepPanel
          step={currentStep}
          isFirst={currentStep.step_number === 1}
          campaign={c}
          trackingSplitAvailable={c.tracking_split_available}
        />
      )}

      {/* Replies list */}
      {replies.length > 0 && (
        <div style={{ marginTop:20 }}>
          <div style={{
            fontSize:10, color:MUTED, textTransform:'uppercase', letterSpacing:'0.04em',
            marginBottom:8,
          }}>Recent replies ({replies.length})</div>
          <RepliesList replies={replies} />
        </div>
      )}
    </div>
  );
}

// ── Combined stats strip (inside the detail panel) ───────────────────────────
// Mirrors the row's stats at higher density — adds Bounces and Unsubscribes
// (the row was too narrow). All "—" treatment for off-tracking matches the
// row's behaviour, so the customer never sees inconsistent figures.
function CombinedStatsStrip({ campaign }) {
  const c = campaign;
  const trackingOff = c.tracking_mode === 'off';
  const split = c.tracking_split_available;
  const items = [
    { label: 'Sent',         value: c.sent,    sub: null },
    { label: 'Opens',        value: c.opens,   sub: !trackingOff && split ? `of ${(c.tracked||0).toLocaleString()} tracked` : null, muted: trackingOff },
    { label: 'Clicks',       value: c.clicks,  sub: !trackingOff && split ? `of ${(c.tracked||0).toLocaleString()} tracked` : null, muted: trackingOff },
    { label: 'Replies',      value: c.replies, sub: null, highlight: c.replies > 0 },
    { label: 'Bounces',      value: c.bounces, sub: null },
    { label: 'Unsubscribes', value: c.unsubs,  sub: null },
  ];
  return (
    <div style={{
      display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:10,
      background:CARD, borderRadius:8, border:`0.5px solid ${BORDER}`,
      padding:'12px 14px',
    }}>
      {items.map((it, i) => (
        <div key={i}>
          <div style={{ fontSize:10, color:MUTED, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:4 }}>
            {it.label}
          </div>
          <div style={{
            fontSize:18, fontWeight:500,
            color: it.muted ? TERTIARY_TEXT : (it.highlight ? GREEN : TEXT),
            lineHeight:1.1,
          }}>
            {it.muted ? '—' : (it.value || 0).toLocaleString()}
          </div>
          {it.sub && (
            <div style={{ fontSize:10, color:MUTED, marginTop:3 }}>{it.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Timeline strip ───────────────────────────────────────────────────────────
// Visual row of dots, one per step. Sent steps = filled green dot + actual
// send date. Pending steps = outline dot + "Upcoming". Steps connect with a
// thin line, the line up to the current step is green, after is dashed grey.
function TimelineStrip({ steps, stepsSent }) {
  return (
    <div style={{
      display:'flex', alignItems:'flex-start', gap:0,
      background:CARD, borderRadius:8, border:`0.5px solid ${BORDER}`,
      padding:'12px 14px',
    }}>
      {steps.map((s, i) => {
        const isSent = s.status === 'sent';
        const isLast = i === steps.length - 1;
        let dateLabel = 'Upcoming';
        if (s.sent_at) {
          const ts = s.sent_at.includes('Z') ? s.sent_at : s.sent_at.replace(' ', 'T') + 'Z';
          dateLabel = new Date(ts).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
        } else if (s.delay_days > 0) {
          dateLabel = `+${s.delay_days}d after previous`;
        }
        return (
          <div key={s.step_number} style={{ flex:1, display:'flex', alignItems:'flex-start' }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', minWidth:0, flex:'0 0 auto' }}>
              <div style={{
                width:14, height:14, borderRadius:'50%',
                background: isSent ? GREEN : CARD,
                border: isSent ? `0.5px solid ${GREEN}` : `1.5px solid ${BORDER}`,
                marginBottom:6,
              }} />
              <div style={{ fontSize:10, color:MUTED, fontWeight:500, whiteSpace:'nowrap' }}>
                {ordinal(s.step_number)} contact
              </div>
              <div style={{ fontSize:10, color: isSent ? TEXT : MUTED, marginTop:2, whiteSpace:'nowrap' }}>
                {dateLabel}
              </div>
            </div>
            {!isLast && (
              <div style={{
                flex:1, height:1, marginTop:7,
                background: isSent ? GREEN : 'transparent',
                borderTop: isSent ? 'none' : `1px dashed ${BORDER}`,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Per-step panel ───────────────────────────────────────────────────────────
// Shown below the tab strip. Header line with subject + from address + delay,
// per-step stats grid, and the email body preview rendered as the recipient
// would have seen it (the html_body is the same body that went to SES).
function StepPanel({ step, isFirst, campaign, trackingSplitAvailable }) {
  const trackingOff = campaign.tracking_mode === 'off';
  let sentAtDisplay = null;
  if (step.sent_at) {
    const ts = step.sent_at.includes('Z') ? step.sent_at : step.sent_at.replace(' ', 'T') + 'Z';
    sentAtDisplay = new Date(ts).toLocaleString('en-GB', {
      day:'numeric', month:'short', year:'numeric',
      hour:'2-digit', minute:'2-digit',
    });
  }

  return (
    <div style={{
      background:CARD, borderRadius:8, border:`0.5px solid ${BORDER}`,
      padding:'14px 16px',
    }}>
      {/* Header */}
      <div style={{ marginBottom:12, paddingBottom:12, borderBottom:`0.5px solid ${BORDER}` }}>
        <div style={{ fontSize:13, fontWeight:500, color:TEXT, marginBottom:4 }}>
          {step.subject || '(no subject set)'}
        </div>
        <div style={{ fontSize:11, color:MUTED, lineHeight:1.5 }}>
          {step.from_name && <span>From <strong style={{ fontWeight:500, color:TEXT }}>{step.from_name}</strong> </span>}
          {step.from_email && <span>&lt;{step.from_email}&gt;</span>}
          {!isFirst && step.delay_days > 0 && (
            <span> · sent {step.delay_days} day{step.delay_days === 1 ? '' : 's'} after previous contact</span>
          )}
          {sentAtDisplay && <span> · {sentAtDisplay}</span>}
          {step.status === 'pending' && <span style={{ color:AMBER }}> · not yet sent</span>}
        </div>
      </div>

      {/* Per-step stats — only when this step has actually sent */}
      {step.sent > 0 && (
        <div style={{
          display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:14,
          marginBottom:14,
        }}>
          <StepStat label="Sent" value={step.sent} />
          <StepStat
            label="Opens"
            value={step.opens}
            sub={!trackingOff && trackingSplitAvailable ? `of ${(step.tracked||0).toLocaleString()} tracked` : null}
            muted={trackingOff}
          />
          <StepStat
            label="Clicks"
            value={step.clicks}
            sub={!trackingOff && trackingSplitAvailable ? `of ${(step.tracked||0).toLocaleString()} tracked` : null}
            muted={trackingOff}
          />
          <StepStat label="Bounces" value={step.bounces} />
        </div>
      )}

      {/* Email body preview */}
      {step.html_body && (
        <div>
          <div style={{ fontSize:10, color:MUTED, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>
            Email body
          </div>
          <div style={{
            border:`0.5px solid ${BORDER}`, borderRadius:6,
            background:'#fafaf8', padding:'14px 16px',
            maxHeight:360, overflow:'auto',
            fontSize:13, lineHeight:1.55, color:TEXT,
          }}>
            <div
              style={{ isolation:'isolate' }}
              dangerouslySetInnerHTML={{ __html: step.html_body }}
            />
          </div>
        </div>
      )}
      {!step.html_body && (
        <div style={{ fontSize:12, color:MUTED, fontStyle:'italic' }}>
          (No body stored for this contact.)
        </div>
      )}
    </div>
  );
}

function StepStat({ label, value, sub, muted }) {
  return (
    <div>
      <div style={{ fontSize:10, color:MUTED, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:3 }}>
        {label}
      </div>
      <div style={{
        fontSize:16, fontWeight:500, lineHeight:1.1,
        color: muted ? TERTIARY_TEXT : TEXT,
      }}>
        {muted ? '—' : (value || 0).toLocaleString()}
      </div>
      {sub && <div style={{ fontSize:10, color:MUTED, marginTop:2 }}>{sub}</div>}
    </div>
  );
}

// ── Replies list (inside detail panel) ───────────────────────────────────────
// Compact list of inbound replies matched to this campaign. Click-through to
// the inbox view isn't wired here — customers can find the same replies in
// their inbox page. Showing the snippet inline keeps the detail self-contained.
function RepliesList({ replies }) {
  return (
    <div style={{
      background:CARD, borderRadius:8, border:`0.5px solid ${BORDER}`,
      overflow:'hidden',
    }}>
      {replies.map((r, i) => {
        let when = '';
        if (r.received_at) {
          const ts = r.received_at.includes('Z') ? r.received_at : r.received_at.replace(' ', 'T') + 'Z';
          when = relTime(ts);
        }
        return (
          <div key={r.id} style={{
            padding:'10px 14px',
            borderBottom: i === replies.length - 1 ? 'none' : `0.5px solid ${BORDER}`,
            fontSize:12, color:TEXT,
          }}>
            <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:3 }}>
              <span style={{ fontWeight:500 }}>
                {r.from_name || r.from_address || '(no sender)'}
              </span>
              <ReplyClassifyChip cls={r.classification} />
              <span style={{ marginLeft:'auto', color:MUTED, fontSize:11 }}>{when}</span>
            </div>
            <div style={{ color:MUTED, fontSize:11, marginBottom:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {r.subject || '(no subject)'}
            </div>
            <div style={{ color:TEXT, lineHeight:1.45, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {r.snippet || '(no preview)'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Tiny classification chip. We deliberately avoid hard/soft splits in the UI
// elsewhere, but on the replies list the existing classification labels are
// already in the customer's mental model from the inbox page (decision #36),
// so we surface them here too.
function ReplyClassifyChip({ cls }) {
  if (!cls) return null;
  const cfg = {
    positive:      { label: 'Positive',      bg: GREEN_BG, color: GREEN  },
    soft_negative: { label: 'Soft negative', bg: AMBER_BG, color: AMBER  },
    hard_negative: { label: 'Hard negative', bg: '#fbe9e9', color: DANGER },
    auto_reply:    { label: 'Out of Office', bg: BLUE_BG, color: BLUE   },
    neutral:       { label: 'Neutral',       bg: '#f1efe8', color: MUTED },
  }[cls];
  if (!cfg) return null;
  return (
    <span style={{
      ...badgeStyle(), background: cfg.bg, color: cfg.color, fontSize:9.5,
    }}>{cfg.label}</span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function tabBtnStyle(active) {
  return {
    background:'transparent', border:'none',
    padding:'8px 14px', cursor:'pointer',
    fontSize:12, color: active ? TEXT : MUTED, fontWeight: active ? 500 : 400,
    borderBottom: active ? `2px solid ${GREEN}` : '2px solid transparent',
    marginBottom:-1,
    transition:'color 80ms ease-in',
  };
}

// ── META PIXELS PAGE (read-only website tracking, decision #107) ─────────────
// Portal mirror of the admin Live tracking view, scoped server-side to the
// logged-in customer's pixel. Anonymous aggregate website events only (page
// views, leads, …) — no personal or contact data. Reads GET /api/portal/
// meta-pixels. Clean states: no_pixel → empty; ok:false → soft notice; ok:true
// → status line + activity graph + plain-English event list.
const PX_WINDOWS = [ {key:'7d',label:'Last 7 days'}, {key:'30d',label:'Last 30 days'}, {key:'lifetime',label:'Lifetime'} ];

function pxTimeAgo(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  return `${Math.floor(mo / 12)} year${Math.floor(mo / 12) === 1 ? '' : 's'} ago`;
}
function pxShortDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}`;
}

function PortalPixelChart({ series }) {
  const pts = Array.isArray(series) ? series : [];
  const max = pts.reduce((m, p) => Math.max(m, Number(p.count) || 0), 0);
  if (pts.length === 0 || max === 0) {
    return <div style={{ fontSize:13, color:TERTIARY_TEXT, padding:'8px 0' }}>Not enough history to chart yet — it&rsquo;ll build up as visitors arrive.</div>;
  }
  const W = 600, H = 100, base = 90, top = 8;
  const slot = W / pts.length;
  const barW = Math.max(1, slot * 0.6);
  return (
    <div>
      <svg width="100%" height="100" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display:'block' }}>
        <line x1="0" y1={base} x2={W} y2={base} stroke={BORDER} strokeWidth="1" />
        {pts.map((p, i) => {
          const h = ((Number(p.count) || 0) / max) * (base - top);
          return <rect key={p.date} x={i * slot + (slot - barW) / 2} y={base - h} width={barW} height={h} fill={TGA_GREEN} rx="1" />;
        })}
      </svg>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:TERTIARY_TEXT, marginTop:4 }}>
        <span>{pxShortDate(pts[0].date)}</span>
        <span>{pxShortDate(pts[pts.length - 1].date)}</span>
      </div>
    </div>
  );
}

function PortalMetaPixels() {
  const [window, setWindow] = useState('30d');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetch(`/api/portal/meta-pixels?window=${encodeURIComponent(window)}`, { credentials:'include' })
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError('Could not load your tracking just now. Please try again in a moment.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [window]);

  const card = { background:CARD, border:`0.5px solid ${BORDER}`, borderRadius:8, padding:'16px 18px' };
  const fmtNum = (n) => Number(n || 0).toLocaleString('en-GB');

  const emptyState = (
    <div style={{ ...card, border:`0.5px dashed ${BORDER}`, textAlign:'center', padding:'40px 32px', color:MUTED, fontSize:14 }}>
      Tracking will appear here once your pixel is live.
    </div>
  );

  const Heading = (
    <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
      <div>
        <h2 style={pageTitle()}>Website Tracking</h2>
        <p style={pageSub()}>See what your Meta Pixel is picking up on your website.</p>
      </div>
      <div style={{ display:'inline-flex', border:`0.5px solid ${BORDER}`, borderRadius:6, overflow:'hidden', marginBottom:16 }}>
        {PX_WINDOWS.map((w,i)=>(
          <button key={w.key} onClick={()=>setWindow(w.key)} style={{ padding:'6px 12px', fontSize:12, cursor:'pointer', border:'none', borderLeft:i===0?'none':`0.5px solid ${BORDER}`, background:window===w.key?GREEN:'#fff', color:window===w.key?'#fff':MUTED, fontWeight:window===w.key?500:400 }}>{w.label}</button>
        ))}
      </div>
    </div>
  );

  if (!loading && data && data.no_pixel) {
    return (<div>{Heading}{emptyState}</div>);
  }
  if (error || (!loading && data && data.ok === false)) {
    const msg = error || (data && data.error) || 'Tracking is unavailable right now.';
    return (
      <div>{Heading}
        <div style={{ ...card, background:AMBER_BG, border:`0.5px solid ${AMBER}`, color:AMBER, fontSize:13 }}>{msg}</div>
      </div>
    );
  }

  if (loading) {
    return (<div>{Heading}<div style={{ ...card, color:TERTIARY_TEXT, fontSize:13 }}>Loading your tracking…</div></div>);
  }

  const events = Array.isArray(data.events) ? data.events : [];
  const series = Array.isArray(data.series) ? data.series : [];
  const noActivity = events.length === 0 && series.length === 0;
  if (noActivity) {
    return (<div>{Heading}{emptyState}</div>);
  }

  const STATUS_TEXT = {
    active:  { dot: GREEN,         text: 'Your tracking is active' },
    quiet:   { dot: AMBER,         text: 'Your tracking is connected' },
    no_data: { dot: TERTIARY_TEXT, text: 'Waiting for activity' },
  };
  const st = STATUS_TEXT[data.status] || STATUS_TEXT.no_data;
  const last = pxTimeAgo(data.pixel && data.pixel.last_fired_time);

  return (
    <div>
      {Heading}

      <div style={{ ...card, marginBottom:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
          <span style={{ width:9, height:9, borderRadius:'50%', background:st.dot, display:'inline-block' }} />
          <span style={{ fontSize:14, fontWeight:500, color:TEXT }}>{st.text}</span>
          {last && <span style={{ fontSize:13, color:TERTIARY_TEXT }}>— last activity {last}</span>}
        </div>

        <div style={{ fontSize:13, color:MUTED, marginBottom:8 }}>Activity over time</div>
        <PortalPixelChart series={series} />
      </div>

      <div style={card}>
        <div style={{ fontSize:13, color:MUTED, marginBottom:10 }}>What&rsquo;s being tracked</div>
        {events.length === 0 ? (
          <div style={{ fontSize:13, color:TERTIARY_TEXT }}>No events tracked in this window yet.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {events.map(e => (
              <div key={e.type} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:14, padding:'6px 0', borderBottom:`0.5px solid ${BG}` }}>
                <span style={{ color:TEXT }}>{e.label}</span>
                <span style={{ color:TEXT, fontWeight:500 }}>{fmtNum(e.count)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── FACEBOOK ADS PAGE (read-only, decision #107) ─────────────────────────────
// Portal mirror of the admin Facebook Ads read view, scoped server-side to the
// logged-in customer's ad account. Read-only — nothing here writes to Facebook
// (Manus makes/manages the campaigns). Reads GET /api/portal/facebook-ads.
// Three clean states from the response flags:
//   • no_account → "Your ads will appear here once they're live."
//   • ok:false   → a soft notice (Facebook unreachable / Meta error)
//   • ok:true    → four headline stat cards + a card per live ad (may be empty)
const FA_WINDOWS = [ {key:'7d',label:'Last 7 days'}, {key:'30d',label:'Last 30 days'}, {key:'lifetime',label:'Lifetime'} ];

function faStatusPill(eff, status) {
  const s = (eff || status || '').toUpperCase();
  if (s === 'ACTIVE') return { label:'Active', fg:'#135AA0', bg:'#E4F4FA' };
  if (s === 'PAUSED' || s === 'ADSET_PAUSED' || s === 'CAMPAIGN_PAUSED') return { label:'Paused', fg:'#854F0B', bg:'#FAEEDA' };
  if (s === 'IN_PROCESS' || s === 'PENDING_REVIEW') return { label:'In review', fg:'#185FA5', bg:'#E6F1FB' };
  if (s === 'DISAPPROVED' || s === 'WITH_ISSUES' || s === 'ADSET_DISAPPROVED') return { label:'Has issues', fg:'#A32D2D', bg:'#FCEBEB' };
  if (s === 'ARCHIVED' || s === 'DELETED') return { label:'Archived', fg:'#5F5E5A', bg:'#F1EFE8' };
  const label = (eff || status || 'Unknown').toLowerCase().replace(/_/g,' ').replace(/^\w/, c=>c.toUpperCase());
  return { label, fg:'#5F5E5A', bg:'#F1EFE8' };
}

function PortalFacebookAds() {
  const [window, setWindow] = useState('30d');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetch(`/api/portal/facebook-ads?window=${encodeURIComponent(window)}`, { credentials:'include' })
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError('Could not load your ads just now. Please try again in a moment.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [window]);

  const card = { background:CARD, border:`0.5px solid ${BORDER}`, borderRadius:8, padding:'14px 16px' };
  const currency = (data && data.account && data.account.currency) || 'GBP';
  const fmtMoney = (n) => (n===null||n===undefined) ? '—' : (()=>{ try { return new Intl.NumberFormat('en-GB',{style:'currency',currency}).format(n); } catch { return `£${Number(n).toFixed(2)}`; } })();
  const fmtNum   = (n) => (n===null||n===undefined) ? '—' : Number(n).toLocaleString('en-GB');

  const emptyState = (
    <div style={{ ...card, border:`0.5px dashed ${BORDER}`, textAlign:'center', padding:'40px 32px', color:MUTED, fontSize:14 }}>
      Your ads will appear here once they&rsquo;re live.
    </div>
  );

  const Heading = (
    <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
      <div>
        <h2 style={pageTitle()}>Facebook Ads</h2>
        <p style={pageSub()}>Your live ad performance, straight from Facebook.</p>
      </div>
      {/* Window filter — read-only; changes what you see, never the ads themselves. */}
      <div style={{ display:'inline-flex', border:`0.5px solid ${BORDER}`, borderRadius:6, overflow:'hidden', marginBottom:16 }}>
        {FA_WINDOWS.map((w,i)=>(
          <button key={w.key} onClick={()=>setWindow(w.key)} style={{ padding:'6px 12px', fontSize:12, cursor:'pointer', border:'none', borderLeft:i===0?'none':`0.5px solid ${BORDER}`, background:window===w.key?GREEN:'#fff', color:window===w.key?'#fff':MUTED, fontWeight:window===w.key?500:400 }}>{w.label}</button>
        ))}
      </div>
    </div>
  );

  // States that don't show the stat grid: no account yet, or a Meta/network error.
  if (!loading && data && data.no_account) {
    return (<div>{Heading}{emptyState}</div>);
  }
  if (error || (!loading && data && data.ok === false)) {
    const msg = error || (data && data.error) || 'Facebook is unavailable right now.';
    return (
      <div>
        {Heading}
        <div style={{ ...card, background:AMBER_BG, border:`0.5px solid ${AMBER}`, color:AMBER, fontSize:13 }}>{msg}</div>
      </div>
    );
  }

  const totals = (data && data.totals) || { spend:0, reach:0, leads:0, cost_per_lead:null };
  const ads    = (data && Array.isArray(data.ads)) ? data.ads : [];
  const statCell = (label, value) => (<div><div style={{ fontSize:11, color:TERTIARY_TEXT }}>{label}</div><div style={{ fontSize:14, fontWeight:500, color:TEXT }}>{value}</div></div>);

  return (
    <div>
      {Heading}

      {/* Four headline stat cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:12, marginBottom:14 }}>
        <div style={card}><div style={{ fontSize:13, color:MUTED }}>Spend</div><div style={{ fontSize:24, fontWeight:500, color:TEXT }}>{loading?'…':fmtMoney(totals.spend)}</div></div>
        <div style={card}><div style={{ fontSize:13, color:MUTED }}>Reach</div><div style={{ fontSize:24, fontWeight:500, color:TEXT }}>{loading?'…':fmtNum(totals.reach)}</div></div>
        <div style={card}><div style={{ fontSize:13, color:MUTED }}>Leads</div><div style={{ fontSize:24, fontWeight:500, color:TEXT }}>{loading?'…':fmtNum(totals.leads)}</div></div>
        <div style={card}><div style={{ fontSize:13, color:MUTED }}>Cost per lead</div><div style={{ fontSize:24, fontWeight:500, color:TEXT }}>{loading?'…':fmtMoney(totals.cost_per_lead)}</div></div>
      </div>

      {loading && <div style={{ fontSize:13, color:TERTIARY_TEXT, padding:'12px 0' }}>Loading your ads…</div>}

      {!loading && ads.length === 0 && emptyState}

      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {!loading && ads.map(ad => {
          const pill = faStatusPill(ad.effective_status, ad.status);
          const s = ad.stats || {};
          return (
            <div key={ad.id} style={{ ...card, display:'flex', gap:14 }}>
              <div style={{ width:120, height:120, flex:'none', borderRadius:8, background:'#F1EFE8', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
                {ad.image_url
                  ? <img src={ad.image_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={(e)=>{e.target.style.display='none';}} />
                  : <span style={{ color:TERTIARY_TEXT, fontSize:11 }}>No image</span>}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                  <div style={{ fontWeight:500, fontSize:15, color:TEXT, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ad.title || ad.name}</div>
                  <span style={{ fontSize:11, padding:'3px 8px', borderRadius:6, background:pill.bg, color:pill.fg, flex:'none' }}>{pill.label}</span>
                </div>
                {(ad.body || ad.title) && <div style={{ fontSize:13, color:MUTED, margin:'4px 0 10px', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{ad.body || ad.name}</div>}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:8 }}>
                  {statCell('Spend', fmtMoney(s.spend))}{statCell('Reach', fmtNum(s.reach))}{statCell('Leads', fmtNum(s.leads))}{statCell('Cost / lead', fmtMoney(s.cost_per_lead))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── SETTINGS PAGE ────────────────────────────────────────────────────────────
function PortalSettings({ user, client, services }) {
  const [pw1, setPw1]       = useState('');
  const [pw2, setPw2]       = useState('');
  const [pwOld, setPwOld]   = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg]   = useState(null);

  async function changePassword() {
    if (!pwOld || !pw1 || !pw2) { setPwMsg({ ok:false, text:'All fields required' }); return; }
    if (pw1 !== pw2) { setPwMsg({ ok:false, text:'New passwords don\'t match' }); return; }
    if (pw1.length < 8) { setPwMsg({ ok:false, text:'Password must be at least 8 characters' }); return; }
    setSavingPw(true); setPwMsg(null);
    try {
      const r = await fetch('/api/portal/auth/change-password', {
        method:'POST',
        credentials:'include',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ old: pwOld, new: pw1 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setPwMsg({ ok:false, text: d.error || 'Could not update password' });
        setSavingPw(false);
        return;
      }
      setSavingPw(false);
      setPwOld(''); setPw1(''); setPw2('');
      setPwMsg({ ok:true, text:'Password updated. Other sessions have been signed out.' });
    } catch {
      setSavingPw(false);
      setPwMsg({ ok:false, text:'Network error — try again.' });
    }
  }

  return (
    <div>
      <h2 style={pageTitle()}>Settings</h2>
      <p style={pageSub()}>Manage your account and your organisation's users.</p>

      <SettingsCard title="Change password">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <Field label="Current password">
            <input type="password" value={pwOld} onChange={e => setPwOld(e.target.value)} disabled={savingPw} style={loginInputStyle()} />
          </Field>
          <div />
          <Field label="New password">
            <input type="password" value={pw1} onChange={e => setPw1(e.target.value)} disabled={savingPw} style={loginInputStyle()} />
          </Field>
          <Field label="Confirm new password">
            <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} disabled={savingPw} style={loginInputStyle()} />
          </Field>
        </div>
        {pwMsg && (
          <div style={{ fontSize:12, color: pwMsg.ok ? GREEN : DANGER, marginBottom:10 }}>{pwMsg.text}</div>
        )}
        <BtnPrimary onClick={changePassword} disabled={savingPw}>{savingPw ? 'Saving…' : 'Update password'}</BtnPrimary>
      </SettingsCard>

      {user.role === 'admin' && (
        <SettingsCard title="Organisation users">
          <p style={{ fontSize:12, color:MUTED, margin:'0 0 12px' }}>
            People at your company who can sign in to this portal. Only admins can add or remove users.
          </p>
          <div style={{ border:`0.5px solid ${BORDER}`, borderRadius:6, overflow:'hidden' }}>
            {/* Until the data routes ship (next chunk), we just show the
                signed-in user themselves. Once GET /api/portal/users is wired
                up this becomes a real list with Add / Remove controls. */}
            <UserRow username={user.username} email={user.email || ''} role={user.role} isYou />
          </div>
          <div style={{ marginTop:12, fontSize:11, color:TERTIARY_TEXT }}>
            Adding more users from this portal is coming soon. In the meantime, contact Sweetbyte to add a teammate.
          </div>
        </SettingsCard>
      )}

      <SettingsCard title="Branding">
        <p style={{ fontSize:12, color:MUTED, margin:'0 0 12px' }}>
          Your logo and audience profile are managed by Sweetbyte. Contact us if you need them updated.
        </p>
        <div style={{ display:'flex', alignItems:'center', gap:14, padding:'10px 12px', border:`0.5px solid ${BORDER}`, borderRadius:6 }}>
          {client?.logo_url ? (
            <img src={client.logo_url} alt={`${client.name || 'Client'} logo`}
              style={{
                width:48, height:48, borderRadius:8,
                objectFit:'contain', flexShrink:0, display:'block',
              }}
            />
          ) : (
            <div style={{
              width:48, height:48, borderRadius:8, background:client?.logo_color || '#1a4d8c', color:'white',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:500, flexShrink:0,
            }}>{client?.logo_initial || (client?.name || 'C').charAt(0).toUpperCase()}</div>
          )}
          <div>
            <div style={{ fontSize:13, fontWeight:500, color:TEXT }}>{client?.name || '—'}</div>
            {client?.audience && (
              <div style={{ fontSize:11, color:MUTED }}>{client.audience}</div>
            )}
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

function SettingsCard({ title, children }) {
  return (
    <div style={{
      background:CARD, borderRadius:8, border:`0.5px solid ${BORDER}`,
      padding:'16px 18px', marginBottom:12,
    }}>
      <div style={{ fontSize:13, fontWeight:500, color:TEXT, marginBottom:12 }}>{title}</div>
      {children}
    </div>
  );
}

function UserRow({ username, email, role, isYou }) {
  return (
    <div style={{
      display:'grid', gridTemplateColumns:'1fr 1fr 80px 80px',
      gap:10, alignItems:'center', padding:'10px 12px',
      borderBottom:`0.5px solid ${BORDER}`, fontSize:12,
    }}>
      <div>
        <span style={{ color:TEXT, fontWeight:500 }}>{username}</span>
        {isYou && <span style={{ color:TERTIARY_TEXT, fontSize:11, marginLeft:6 }}>(you)</span>}
      </div>
      <div style={{ color:MUTED }}>{email}</div>
      <div>
        <span style={{
          ...badgeStyle(),
          background: role === 'admin' ? BLUE_BG : '#f4f1e8',
          color:      role === 'admin' ? BLUE : MUTED,
        }}>{role}</span>
      </div>
      <div style={{ textAlign:'right' }}>
        {!isYou && (
          <a onClick={() => alert('(Demo) Remove user flow.')} style={{ color:DANGER, fontSize:11, cursor:'pointer' }}>Remove</a>
        )}
      </div>
    </div>
  );
}

// ── SHARED PRIMITIVES ────────────────────────────────────────────────────────
function pageTitle() { return { fontSize:18, fontWeight:500, margin:'0 0 4px', color:TEXT }; }
function pageSub()   { return { fontSize:12, color:MUTED, margin:'0 0 16px' }; }

function Modal({ title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.45)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:50, padding:20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:CARD, borderRadius:12, padding:'22px 26px',
        maxWidth: wide ? 720 : 460, width:'100%',
        maxHeight:'90vh', overflow:'auto',
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <h3 style={{ fontSize:15, fontWeight:500, margin:0, color:TEXT }}>{title}</h3>
          <button onClick={onClose} style={{
            background:'transparent', border:'none', fontSize:20, color:MUTED,
            cursor:'pointer', lineHeight:1, padding:0,
          }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BtnPrimary({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding:'8px 14px', fontSize:13, fontWeight:500,
      background: disabled ? TGA_GREEN_LO : TGA_GREEN_HI,
      color:'white', border:'none', borderRadius:6,
      cursor: disabled ? 'default' : 'pointer',
    }}>{children}</button>
  );
}
function BtnSecondary({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding:'8px 14px', fontSize:13,
      background:CARD, color:TEXT, border:`0.5px solid ${BORDER}`, borderRadius:6,
      cursor: disabled ? 'default' : 'pointer',
    }}>{children}</button>
  );
}

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}
