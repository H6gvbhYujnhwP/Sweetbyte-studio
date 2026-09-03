// ─────────────────────────────────────────────────────────────────────────────
// IDYQAdmin.jsx — Embeds the IdoYourQuotes admin panel inside Studio.
//
// Mounted by Dashboard.jsx when activeView === 'apps-idyq'.
//
// How auth works (no double-login):
//   1. On mount, this component calls GET /api/idyq-bridge/url on the Studio
//      backend. That endpoint requires the Studio admin Bearer token (already
//      auto-injected by App.jsx's fetch interceptor).
//   2. The Studio backend signs a 60-second HMAC ticket with the shared
//      IDYQ_BRIDGE_SECRET env var and returns a URL like:
//      https://idoyourquotes.com/admin-bridge?ticket=<signed>
//   3. We set the iframe's src to that URL. The IDYQ server's /admin-bridge
//      endpoint verifies the ticket with the same secret, mints an IDYQ
//      session cookie for the dedicated bridge admin user
//      (STUDIO_BRIDGE_ADMIN_EMAIL on IDYQ's Render env), and 302-redirects
//      to /manage-7k9x2m4q8r — the existing IDYQ admin panel route.
//   4. The iframe ends up on the admin panel, fully signed in.
//
// If you ever want to swap which IDYQ environment Studio points at (e.g.
// staging vs production), set IDYQ_BASE_URL on Studio's Render env. Defaults
// to https://idoyourquotes.com.
//
// Failure modes:
//   - Bridge env vars missing → backend returns 500 with a message; we render
//     an error card naming the missing var so it's obvious where to look.
//   - Ticket expired (>60s between mint and use, e.g. slow network) → IDYQ
//     returns 403; the iframe shows IDYQ's error page. Reload the iframe
//     (toggle the sidebar away and back) to get a fresh ticket.
//   - The bridge admin user doesn't exist or isn't admin role → IDYQ returns
//     403 "Bridge user invalid". Re-run the SQL setup from the integration
//     handover to recreate the user.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import { SB } from '../../brand.js';

export default function IDYQAdmin() {
  const [url, setUrl]     = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchTicket() {
      try {
        const r = await fetch('/api/idyq-bridge/url');
        if (!r.ok) {
          // Try to surface the backend's error message if it's JSON
          let detail = `HTTP ${r.status}`;
          try {
            const body = await r.json();
            if (body?.error) detail = body.error;
          } catch {} // not JSON, keep generic detail
          throw new Error(detail);
        }
        const data = await r.json();
        if (!cancelled && data?.url) setUrl(data.url);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Unknown error');
      }
    }
    fetchTicket();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#f5f5f3', padding:32 }}>
        <div style={{
          background:'#fff', border:'0.5px solid #FAC775',
          borderRadius:8, padding:'24px 28px', maxWidth:520,
        }}>
          <div style={{ fontSize:14, fontWeight:500, color:'#854F0B', marginBottom:8 }}>
            Could not open IDYQ admin
          </div>
          <div style={{ fontSize:13, color:'#1a1a1a', marginBottom:12 }}>
            {error}
          </div>
          <div style={{ fontSize:12, color:'#666', lineHeight:1.5 }}>
            Check that <code style={{ background:'#f5f5f3', padding:'1px 5px', borderRadius:3 }}>IDYQ_BRIDGE_SECRET</code> is set on Studio's Render service and matches <code style={{ background:'#f5f5f3', padding:'1px 5px', borderRadius:3 }}>STUDIO_BRIDGE_SECRET</code> on IDYQ's. If the secret is right, check that the bridge admin user exists in the IDYQ users table.
          </div>
        </div>
      </div>
    );
  }

  if (!url) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#f5f5f3' }}>
        <div style={{
          width:28, height:28, border:`2.5px solid ${SB.primary}`, borderTopColor:'transparent',
          borderRadius:'50%', animation:'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <iframe
      src={url}
      title="IdoYourQuotes Admin"
      style={{ flex:1, width:'100%', height:'100vh', border:'none', display:'block' }}
    />
  );
}
