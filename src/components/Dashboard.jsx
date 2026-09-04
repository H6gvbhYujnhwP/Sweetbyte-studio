import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar.jsx';
import ClientCard from './ClientCard.jsx';
import NewClientModal from './NewClientModal.jsx';
import ClientDetail from './ClientDetail.jsx';
import EmailSection from './EmailSection.jsx';
import PortalAdmin from './PortalAdmin.jsx';
import ServiceEmailLog from './ServiceEmailLog.jsx';
import IDYQAdmin from './apps/IDYQAdmin.jsx';
import CrmHotProspects from './CrmHotProspects.jsx';
import FacebookPixels from './FacebookPixels.jsx';
import FacebookAds from './FacebookAds.jsx';
import StaffAccess from './StaffAccess.jsx';
import CrmCompanies from './CrmCompanies.jsx';
import CrmTasks from './CrmTasks.jsx';
import CrmDeals from './CrmDeals.jsx';
import CrmOrders from './CrmOrders.jsx';
import { SB } from '../brand.js';

// Which section the operator is on is remembered across a browser refresh.
// We store the current top-level view and read it back on first load, so a
// refresh keeps you on the section you were viewing instead of snapping back
// to the default (LinkedIn Posts). VALID_VIEWS guards against a stale or
// garbage stored value ever rendering a broken screen — anything not on the
// list falls back to 'clients'.
const VALID_VIEWS = [
  'clients',
  'email-customers', 'email-domain-health', 'email-mailboxes', 'email-service-log',
  'portal-customers',
  'crm-hot-prospects',
  'crm-companies',
  'crm-tasks',
  'crm-deals',
  'crm-orders', 'crm-approvals', 'crm-purchasing',
  'apps-idyq',
  'instagram', 'tiktok', 'facebook-pixels', 'facebook-ads',
  'staff-access',
];
const LAST_VIEW_KEY = 'studio.admin.last_view';

// Map each top-level view to the access section key a staff member needs ticked
// to reach it. Views not listed (e.g. client detail) are always allowed once
// you can see the parent LinkedIn screen. 'staff-access' is super-admin only.
const VIEW_SECTION = {
  'clients': 'linkedin_posts',
  'instagram': 'instagram',
  'tiktok': 'tiktok',
  'facebook-pixels': 'meta_pixels',
  'facebook-ads': 'facebook_ads',
  'email-customers': 'customers',
  'email-domain-health': 'domain_health',
  'email-mailboxes': 'mailboxes',
  'email-service-log': 'customers',
  'portal-customers': 'portal_customers',
  'crm-hot-prospects': 'email_hot_prospects',
  'crm-companies': 'crm_companies',
  'crm-tasks': 'crm_tasks',
  'crm-deals': 'crm_deals',
  'crm-orders': 'crm_orders',
  'crm-approvals': 'crm_approvals',
  'crm-purchasing': 'crm_purchasing',
  'apps-idyq': 'idyq',
};
const VIEW_ORDER = [
  'clients', 'instagram', 'tiktok', 'facebook-pixels', 'facebook-ads',
  'email-customers', 'email-domain-health', 'email-mailboxes', 'email-service-log',
  'portal-customers', 'crm-hot-prospects', 'crm-companies', 'crm-tasks', 'crm-deals', 'crm-orders', 'crm-approvals', 'crm-purchasing', 'apps-idyq',
];

function isSuperUser(u) { return !u || u.is_super || u.access === 'ALL'; }
function canView(u, v) {
  if (v === 'staff-access') return !!(u && (u.is_super || u.access === 'ALL'));
  if (isSuperUser(u)) return true;
  const key = VIEW_SECTION[v];
  if (!key) return true; // unmapped view — allow once signed in
  return !!(u.access && u.access[key]);
}

function readInitialView() {
  try {
    const v = localStorage.getItem(LAST_VIEW_KEY);
    if (v && VALID_VIEWS.includes(v)) return v;
  } catch (e) { /* private browsing / storage disabled — fall through to default */ }
  return 'clients';
}

export default function Dashboard({ onLogout, user }) {
  const [clients, setClients]           = useState([]);
  const [view, setView]                 = useState(readInitialView);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showNewClient, setShowNewClient]   = useState(false);
  const [loading, setLoading]           = useState(true);
  const [brief, setBrief]               = useState(null);
  const [briefRunning, setBriefRunning] = useState(false);
  const [briefUpdatedAt, setBriefUpdatedAt] = useState(null);
  const [showBrief, setShowBrief]       = useState(false);

  async function loadClients() {
    setLoading(true);
    try {
      const res = await fetch('/api/clients');
      if (res.ok) setClients(await res.json());
    } catch (e) { console.error('loadClients error:', e); }
    setLoading(false);
  }

  async function loadBrief() {
    try {
      const res = await fetch('/api/algorithm/brief');
      if (res.ok) {
        const data = await res.json();
        setBrief(data.brief);
        setBriefRunning(data.running);
        setBriefUpdatedAt(data.updatedAt);
      }
    } catch (e) { console.warn('loadBrief error:', e.message); }
  }

  async function runAnalysis() {
    setBriefRunning(true);
    try {
      await fetch('/api/algorithm/run', { method: 'POST' });
      // Poll every 5 seconds until complete
      const poll = setInterval(async () => {
        const res = await fetch('/api/algorithm/brief');
        if (res.ok) {
          const data = await res.json();
          if (!data.running) {
            setBrief(data.brief);
            setBriefRunning(false);
            setBriefUpdatedAt(data.updatedAt);
            clearInterval(poll);
          }
        }
      }, 5000);
    } catch (e) {
      setBriefRunning(false);
      console.error('runAnalysis error:', e.message);
    }
  }

  async function syncAndLoad() {
    try {
      const res = await fetch('/api/clients/sync', { method:'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.added > 0) console.log(`[sync] Added ${data.added} new workspace(s)`);
      }
    } catch (e) { console.warn('[sync] sync request failed:', e.message); }
    await loadClients();
  }

  useEffect(()=>{ syncAndLoad(); loadBrief(); }, []);

  // Cross-component navigation. Other components (e.g. EmailSection's
  // "Send to Hot Prospects" banner) dispatch a custom DOM event with a target
  // view id, and we switch the dashboard view in response. Lets us route
  // between top-level screens without lifting view state out of Dashboard or
  // wiring callbacks through every intermediate component.
  useEffect(() => {
    function onNavigateEvent(e) {
      const target = e && e.detail && e.detail.view;
      if (typeof target === 'string') handleNavigate(target);
    }
    window.addEventListener('studio:navigate', onNavigateEvent);
    return () => window.removeEventListener('studio:navigate', onNavigateEvent);
  }, []);

  function handleNavigate(v) {
    setView(v);
    setSelectedClient(null);
    try { localStorage.setItem(LAST_VIEW_KEY, v); } catch (e) { /* storage disabled — non-fatal */ }
  }

  // Once we know who's signed in, bounce them off any view they can't see
  // (e.g. a refresh landed them on a remembered section that's no longer
  // ticked for them, or a staff member typed a URL). Super-admins always pass.
  useEffect(() => {
    if (!user) return;
    if (!canView(user, view)) {
      const first = VIEW_ORDER.find(v => canView(user, v));
      if (first) handleNavigate(first);
    }
  }, [user, view]);

  // ── No-access guard ────────────────────────────────────────────────────────
  // A staff member with zero sections ticked has nowhere to go. Show a calm
  // message instead of an empty shell. Super-admins never hit this.
  if (user && !isSuperUser(user) && !VIEW_ORDER.some(v => canView(user, v))) {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:28 }}>
          <div style={{ background:'#fff', border:'0.5px solid #e0e0dc', borderRadius:12, padding:'40px 32px', maxWidth:440, textAlign:'center' }}>
            <div style={{ fontSize:15, fontWeight:500, color:'#1a1a1a', marginBottom:8 }}>No sections enabled yet</div>
            <div style={{ fontSize:13, color:'#666', lineHeight:1.6 }}>Your account doesn't have access to any sections. Ask your administrator to enable what you need.</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Email Campaigns views ──────────────────────────────────────────────────
  if (view === 'email-customers' || view === 'email-domain-health' || view === 'email-mailboxes') {
    const initialTab = view === 'email-domain-health' ? 'domains'
                     : view === 'email-mailboxes'     ? 'mailboxes'
                     : 'customers';
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <EmailSection initialTab={initialTab} />
      </div>
    );
  }

  // ── Service emails — read-only log of WorkTrackr introduction emails ──────
  if (view === 'email-service-log') {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <ServiceEmailLog />
      </div>
    );
  }

  // ── Customer Portal admin ──────────────────────────────────────────────────
  if (view === 'portal-customers') {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <PortalAdmin />
      </div>
    );
  }

  // ── CRM — Hot Prospects (admin) ───────────────────────────────────────────
  // Per-customer prospect list with customer-switcher badges at the top.
  // The component itself fetches /api/email/hot-prospects/customers and
  // /api/email/hot-prospects?email_client_id=... to drive the screen.
  if (view === 'crm-hot-prospects') {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <CrmHotProspects />
      </div>
    );
  }

  // ── CRM — Sales CRM companies (admin) ─────────────────────────────────────
  if (view === 'crm-companies') {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <CrmCompanies user={user} />
      </div>
    );
  }

  // ── CRM — Tasks dashboard (admin) ─────────────────────────────────────────
  if (view === 'crm-tasks') {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <CrmTasks />
      </div>
    );
  }

  // ── CRM — Deals forecast (admin) ──────────────────────────────────────────
  if (view === 'crm-deals') {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <CrmDeals />
      </div>
    );
  }

  // ── CRM — Orders / Approval / Purchasing (admin) ──────────────────────────
  if (view === 'crm-orders' || view === 'crm-approvals' || view === 'crm-purchasing') {
    const q = view === 'crm-approvals' ? 'approval' : view === 'crm-purchasing' ? 'purchasing' : 'orders';
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <CrmOrders user={user} queue={q} />
      </div>
    );
  }

  // ── App integration: IDYQ admin embed ─────────────────────────────────────
  // Mounts the IdoYourQuotes admin panel inside Studio via an iframe. Auth
  // happens via the bridge endpoint (server/routes/idyq-bridge.js mints a
  // short-lived signed ticket; idoyourquotes.com/admin-bridge consumes it
  // and sets a session cookie for the dedicated bridge admin user). When
  // the view changes away from 'apps-idyq' the component unmounts; when it
  // comes back, IDYQAdmin remounts and fetches a fresh ticket. That's the
  // right behaviour — old tickets are 60s expiry so we always want a new
  // one on re-entry.
  if (view === 'apps-idyq') {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <IDYQAdmin />
      </div>
    );
  }

  // ── Facebook Pixels (admin) ────────────────────────────────────────────────
  if (view === 'facebook-pixels') {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <FacebookPixels />
      </div>
    );
  }

  // ── Facebook Ads (admin) ───────────────────────────────────────────────────
  if (view === 'facebook-ads') {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <FacebookAds />
      </div>
    );
  }

  // ── Settings: Staff & access (super-admin only) ───────────────────────────
  if (view === 'staff-access') {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <StaffAccess user={user} />
      </div>
    );
  }

  // ── Coming-soon placeholder views ─────────────────────────────────────────
  // Four sidebar items for services not yet built on the admin side. Each one
  // points to this same screen with the title varying. When a real admin
  // screen lands for any of these, replace the branch with a real component
  // mount (same pattern as PortalAdmin above).
  const COMING_SOON_TITLES = {
    'instagram':       'Instagram',
    'tiktok':          'TikTok',
  };
  if (COMING_SOON_TITLES[view]) {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />
        <AdminComingSoon title={COMING_SOON_TITLES[view]} />
      </div>
    );
  }

  // ── Client detail view ────────────────────────────────────────────────────
  if (selectedClient) {
    return (
      <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
        <Sidebar onLogout={onLogout} activeView="clients" onNavigate={handleNavigate} user={user} />
        <ClientDetail clientId={selectedClient} onBack={()=>setSelectedClient(null)} onRefresh={loadClients} />
      </div>
    );
  }

  // ── Social Media Posts (Supergrow) ────────────────────────────────────────
  const totalPosts = clients.reduce((acc,c)=>acc+(c.campaign_count||0)*96, 0);
  const activeRuns = clients.filter(c=>c.last_status==='running').length;

  return (
    <div style={{ display:'flex', height:'100vh', background:'#f5f5f3' }}>
      <Sidebar onLogout={onLogout} activeView={view} onNavigate={handleNavigate} user={user} />

      <div style={{ flex:1, overflow:'auto', padding:28 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <h1 style={{ fontSize:20, fontWeight:500, color:'#1a1a1a' }}>LinkedIn Posts</h1>
          <div style={{ display:'flex', gap:8 }}>
            <button
              onClick={briefRunning ? null : runAnalysis}
              disabled={briefRunning}
              title={briefUpdatedAt ? `Last updated: ${new Date(briefUpdatedAt).toLocaleString('en-GB')}` : 'No brief yet — click to run'}
              style={{
                background: briefRunning ? '#f0f0ec' : brief ? SB.tint : '#fff',
                color: briefRunning ? '#999' : brief ? SB.dark : '#555',
                border: `0.5px solid ${brief ? SB.light : '#d0d0cc'}`,
                padding:'8px 14px', borderRadius:8, fontWeight:500, cursor: briefRunning ? 'not-allowed' : 'pointer',
                fontSize:13, display:'flex', alignItems:'center', gap:6
              }}
            >
              {briefRunning ? (
                <><span style={{ width:12, height:12, border:`1.5px solid ${SB.primary}`, borderTopColor:'transparent', borderRadius:'50%', display:'inline-block', animation:'spin 0.8s linear infinite' }} /> Running analysis...</>
              ) : brief ? (
                <span onClick={e => { e.stopPropagation(); setShowBrief(true); }}>
                  ✓ Algorithm brief {briefUpdatedAt ? `(${new Date(briefUpdatedAt).toLocaleDateString('en-GB', {day:'numeric',month:'short'})})` : ''} — click to view
                </span>
              ) : (
                'Run weekly LinkedIn analysis'
              )}
            </button>
            <button onClick={()=>setShowNewClient(true)} style={{ background:SB.primary, color:SB.darkest, border:'none', padding:'8px 18px', borderRadius:8, fontWeight:500, cursor:'pointer' }}>
              + New client
            </button>
          </div>
        </div>

        {/* Algorithm Brief Modal */}
        {showBrief && brief && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}
               onClick={() => setShowBrief(false)}>
            <div style={{ background:'#fff', borderRadius:12, padding:28, width:'min(720px, 90vw)', maxHeight:'80vh', overflow:'auto', boxShadow:'0 4px 24px rgba(0,0,0,0.15)' }}
                 onClick={e => e.stopPropagation()}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <div style={{ fontSize:15, fontWeight:600, color:'#1a1a1a' }}>LinkedIn Algorithm Brief</div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  {briefUpdatedAt && <span style={{ fontSize:11, color:'#888' }}>Updated {new Date(briefUpdatedAt).toLocaleString('en-GB')}</span>}
                  <button onClick={() => runAnalysis()} disabled={briefRunning} style={{ fontSize:12, padding:'5px 12px', background:SB.primary, color:SB.darkest, border:'none', borderRadius:6, cursor:'pointer' }}>
                    Refresh
                  </button>
                  <button onClick={() => setShowBrief(false)} style={{ fontSize:12, padding:'5px 10px', background:'#f5f5f3', border:'0.5px solid #d0d0cc', borderRadius:6, cursor:'pointer', color:'#555' }}>
                    Close
                  </button>
                </div>
              </div>
              <pre style={{ fontSize:12, lineHeight:1.7, whiteSpace:'pre-wrap', color:'#333', fontFamily:'inherit' }}>{brief}</pre>
            </div>
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:28 }}>
          {[
            { label:'Total clients',      value:clients.length, sub:`${activeRuns} active run${activeRuns!==1?'s':''}` },
            { label:'Posts queued',       value:totalPosts.toLocaleString(), sub:'all time' },
            { label:'Images generated',   value:totalPosts.toLocaleString(), sub:'via Nano Banana' },
            { label:'Campaigns run',      value:clients.reduce((a,c)=>a+(c.campaign_count||0),0), sub:'all time' }
          ].map(s=>(
            <div key={s.label} style={{ background:'#fff', border:'0.5px solid #e0e0dc', borderRadius:8, padding:'14px 16px' }}>
              <div style={{ fontSize:12, color:'#888', marginBottom:4 }}>{s.label}</div>
              <div style={{ fontSize:26, fontWeight:500, color:'#1a1a1a' }}>{s.value}</div>
              <div style={{ fontSize:11, color:SB.primary, marginTop:3 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize:11, fontWeight:500, color:'#999', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>Clients</div>

        {loading ? (
          <div style={{ color:'#888', padding:'40px 0', textAlign:'center' }}>Loading...</div>
        ) : clients.length === 0 ? (
          <div style={{ background:'#fff', border:'0.5px dashed #d0d0cc', borderRadius:12, padding:48, textAlign:'center' }}>
            <div style={{ fontSize:15, color:'#888', marginBottom:12 }}>No clients yet</div>
            <button onClick={()=>setShowNewClient(true)} style={{ background:SB.primary, color:SB.darkest, border:'none', padding:'8px 18px', borderRadius:8, fontWeight:500, cursor:'pointer' }}>
              Add your first client
            </button>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12 }}>
            {clients.map(client=>(
              <ClientCard key={client.id} client={client} onClick={()=>setSelectedClient(client.id)} />
            ))}
          </div>
        )}
      </div>

      {showNewClient && (
        <NewClientModal onClose={()=>setShowNewClient(false)} onCreated={()=>{ setShowNewClient(false); loadClients(); }} />
      )}
    </div>
  );
}

// ── Admin coming-soon placeholder ────────────────────────────────────────────
// Single re-usable screen for sidebar items whose admin side hasn't been built
// yet. Used by the Instagram + TikTok admin tabs.
// When any of those gets a real admin UI, replace its branch in Dashboard's
// view router with a real component mount and this stays for the rest.
function AdminComingSoon({ title }) {
  return (
    <div style={{ flex:1, overflow:'auto', padding:28 }}>
      <h1 style={{ fontSize:20, fontWeight:500, color:'#1a1a1a', marginBottom:24 }}>{title}</h1>
      <div style={{
        background:'#fff', borderRadius:8, border:'0.5px solid #d0d0cc',
        padding:'56px 32px', textAlign:'center',
      }}>
        <div style={{
          display:'inline-block', padding:'5px 11px', fontSize:11,
          background:'#E6F1FB', color:'#0C447C',
          borderRadius:4, fontWeight:500, marginBottom:18,
        }}>Coming soon</div>
        <div style={{ fontSize:15, color:'#1a1a1a', fontWeight:500, marginBottom:8 }}>
          Feature in development
        </div>
        <div style={{ fontSize:13, color:'#666', lineHeight:1.5, maxWidth:480, margin:'0 auto' }}>
          The admin tools for {title.toLowerCase()} will appear here once the service ships. Customer-portal customers already see a sales pitch on this service.
        </div>
      </div>
    </div>
  );
}
