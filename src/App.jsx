import React, { useState, useEffect } from 'react';
import Login     from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import PortalApp from './components/customer-portal/PortalApp.jsx';
import { SB } from './brand.js';

// ─── Global fetch patch ───────────────────────────────────────────────────────
// Automatically adds Authorization: Bearer <token> to every /api/ request.
// This means Dashboard, CampaignProgress, ClientDetail etc. need zero changes.
//
// Customer-portal endpoints (/api/portal/*) are EXCLUDED from this — they use
// their own session cookie set by the portal login route. Including the admin
// token on portal calls would be a privilege-escalation risk.
const _originalFetch = window.fetch.bind(window);
window.fetch = function (url, opts = {}) {
  if (typeof url === 'string' && url.startsWith('/api/') && !url.startsWith('/api/portal/')) {
    const token = localStorage.getItem('studioToken') || '';
    opts = {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };
  }
  return _originalFetch(url, opts);
};

// ─── Route resolution ─────────────────────────────────────────────────────────
// Hand-rolled route detection: if the URL path starts with /c/<slug>, mount
// the customer portal. Otherwise fall through to the existing admin auth flow.
// This is set ONCE at mount time — full page reload to switch between modes,
// which is exactly what we want (admin and customer auth must not bleed).
function getPortalSlug() {
  const m = window.location.pathname.match(/^\/c\/([^\/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // Decide ONCE at mount whether this is a portal session or admin session.
  // Stored in state so it doesn't recompute on every render.
  const [portalSlug] = useState(() => getPortalSlug());

  // ── Portal mode ────────────────────────────────────────────────────────────
  if (portalSlug) {
    return <PortalApp slug={portalSlug} />;
  }

  // ── Admin Studio mode (existing) ───────────────────────────────────────────
  return <AdminApp />;
}

function AdminApp() {
  const [auth, setAuth] = useState(null); // null = checking, true = in, false = out
  const [user, setUser] = useState(null); // { username, is_super, access } once known

  // Validate the stored token against the server AND pull back who we are +
  // which sections we're allowed to see. Used on first load and after login.
  async function checkAuth() {
    const token = localStorage.getItem('studioToken');
    if (!token) { setAuth(false); setUser(null); return; }
    try {
      const r = await fetch('/api/auth/check');
      const d = await r.json();
      setAuth(!!d.authenticated);
      setUser(d.authenticated ? (d.user || null) : null);
    } catch {
      setAuth(false); setUser(null);
    }
  }

  useEffect(() => { checkAuth(); }, []);

  function handleLogin(token) {
    localStorage.setItem('studioToken', token);
    setAuth(true);
    checkAuth(); // fetch our user + access map
  }

  function handleLogout() {
    try { fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem('studioToken');
    setAuth(false); setUser(null);
  }

  if (auth === null) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f5f5f3' }}>
      <div style={{ width: 32, height: 32, border: `3px solid ${SB.primary}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!auth) return <Login onLogin={handleLogin} />;
  return <Dashboard onLogout={handleLogout} user={user} />;
}
