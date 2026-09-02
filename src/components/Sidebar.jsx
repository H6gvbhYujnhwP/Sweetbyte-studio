import React, { useState, useEffect } from 'react';
import { SB, BRAND_NAME } from '../brand.js';

const SECTION = { padding:'10px 16px 4px', fontSize:10, fontWeight:700, color:SB.sidebarHeading, letterSpacing:'0.08em', textTransform:'uppercase' };
const DIVIDER = { margin:'6px 16px 2px', borderTop:'0.5px solid rgba(255,255,255,0.1)', border:'none' };

export default function Sidebar({ onLogout, activeView, onNavigate, user }) {
  // Per-user access. Super-admins (the env break-glass login or an is_super
  // staff member) see everything. Everyone else sees only the sidebar items
  // ticked for them. If `user` hasn't loaded yet, fail OPEN (show all) so the
  // sidebar never flashes empty — the server still gates staff management.
  const isSuper = !user || user.is_super || user.access === 'ALL';
  function can(key) { return isSuper || !!(user && user.access && user.access[key]); }
  const showSocial = can('linkedin_posts') || can('instagram') || can('tiktok') || can('meta_pixels') || can('facebook_ads');
  const showEmail  = can('customers') || can('domain_health') || can('mailboxes');
  const showPortal = can('portal_customers');
  const showCrm    = can('email_hot_prospects') || can('crm_companies') || can('crm_tasks') || can('crm_deals') || can('crm_orders') || can('crm_approvals') || can('crm_purchasing');
  const showApp    = can('idyq');
  // Live prospect-count badge for the Mailboxes menu item.
  // Refreshes every 30s while the app is open. Gracefully handles failure
  // (e.g. backend not yet deployed) by hiding the badge.
  const [prospectCount, setProspectCount] = useState(0);
  // Live due-follow-up badge for the Hot Prospects menu item — total of
  // overdue + due-today, across all customers (admin-side is mission-control
  // across the whole roster, so the badge aggregates rather than scoping to
  // a single customer). Marked-converted prospects are excluded from the
  // count automatically by the server-side WHERE closed_at IS NULL.
  const [hotProspectsDue, setHotProspectsDue] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function fetchCount() {
      try {
        const r = await fetch('/api/email/mailboxes/badge-count');
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setProspectCount(d.new_prospects || 0);
      } catch {} // backend not yet deployed — silently ignore
    }
    async function fetchHotProspectsDue() {
      try {
        const r = await fetch('/api/email/hot-prospects/due-counts');
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setHotProspectsDue(Number(d.total || 0));
      } catch {}
    }
    fetchCount();
    fetchHotProspectsDue();
    const t = setInterval(() => {
      fetchCount();
      fetchHotProspectsDue();
    }, 30_000);
    // Also listen for an in-app event that other screens can dispatch when
    // they mutate hot-prospects (mark converted, add, delete, etc.) so the
    // badge updates without waiting for the next 30s tick.
    function onMutation() { fetchHotProspectsDue(); }
    window.addEventListener('studio:hot-prospects-changed', onMutation);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener('studio:hot-prospects-changed', onMutation);
    };
  }, []);

  return (
    <div style={{ width:210, background:SB.sidebarBg, display:'flex', flexDirection:'column', flexShrink:0 }}>

      {/* Logo — the Sweetbyte spiral mark on a white tile, mirrored exactly in
          the customer portal sidebar (PortalApp.jsx) so admin and portal look
          identical at the top-left. Image lives at /sweetbyte-logo.png. */}
      <div style={{ padding:'16px 14px', borderBottom:'0.5px solid rgba(255,255,255,0.1)', display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ width:30, height:30, background:'#fff', borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, padding:3, boxSizing:'border-box' }}>
          <img src="/sweetbyte-logo.png" alt={BRAND_NAME}
            style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }}
          />
        </div>
        <div>
          <div style={{ color:'#fff', fontSize:13, fontWeight:500, lineHeight:1.2 }}>{BRAND_NAME}</div>
          <div style={{ color:SB.sidebarText, fontSize:11 }}>Studio</div>
        </div>
      </div>

      {/* Nav — scrolls on its own when the list is taller than the screen, so
          the lower items and the Sign out footer are never clipped on short
          viewports. minHeight:0 lets this flex child shrink below its content. */}
      <div style={{ flex:1, minHeight:0, overflowY:'auto', paddingTop:10 }}>

        {showSocial && <>
          <div style={SECTION}>Social Media</div>
          {can('linkedin_posts') && <NavItem id="clients"          label="LinkedIn Posts"   active={activeView==='clients'}          onNavigate={onNavigate} icon={<UsersIcon />} />}
          {can('instagram')      && <NavItem id="instagram"        label="Instagram"        active={activeView==='instagram'}        onNavigate={onNavigate} icon={<UsersIcon />} dim suffix="Soon" />}
          {can('tiktok')         && <NavItem id="tiktok"           label="TikTok"           active={activeView==='tiktok'}           onNavigate={onNavigate} icon={<UsersIcon />} dim suffix="Soon" />}
          {can('meta_pixels')    && <NavItem id="facebook-pixels"  label="Meta Pixels"      active={activeView==='facebook-pixels'}  onNavigate={onNavigate} icon={<UsersIcon />} />}
          {can('facebook_ads')   && <NavItem id="facebook-ads"     label="Facebook Ads"     active={activeView==='facebook-ads'}     onNavigate={onNavigate} icon={<UsersIcon />} />}
        </>}

        {showEmail && <>
          <hr style={DIVIDER} />
          <div style={SECTION}>Email Campaigns</div>
          {can('customers')     && <SubItem id="email-customers"     label="Customers"     active={activeView==='email-customers'}     onNavigate={onNavigate} icon={<CustomersIcon />} />}
          {can('domain_health') && <SubItem id="email-domain-health" label="Domain Health" active={activeView==='email-domain-health'} onNavigate={onNavigate} icon={<DomainIcon />} />}
          {can('mailboxes')     && <SubItem id="email-mailboxes"     label="Mailboxes"     active={activeView==='email-mailboxes'}     onNavigate={onNavigate} icon={<MailboxIcon />} badge={prospectCount} />}
        </>}

        {showPortal && <>
          <hr style={DIVIDER} />
          <div style={SECTION}>Customer Portal</div>
          <SubItem id="portal-customers"    label="Portal Customers" active={activeView==='portal-customers'}  onNavigate={onNavigate} icon={<PortalIcon />} />
        </>}

        {showCrm && <>
          <hr style={DIVIDER} />
          {/* CRM — the section heading makes it cheap to add more entries later
              (Sales CRM screens land here as later phases ship). */}
          <div style={SECTION}>CRM</div>
          {can('crm_companies')      && <SubItem id="crm-companies"      label="Sales CRM"                     active={activeView==='crm-companies'}     onNavigate={onNavigate} icon={<UsersIcon />} />}
          {can('crm_tasks')          && <SubItem id="crm-tasks"          label="Tasks"                         active={activeView==='crm-tasks'}         onNavigate={onNavigate} icon={<HotProspectsIcon />} />}
          {can('crm_deals')          && <SubItem id="crm-deals"          label="Deals"                         active={activeView==='crm-deals'}         onNavigate={onNavigate} icon={<UsersIcon />} />}
          {can('crm_orders')         && <SubItem id="crm-orders"         label="Orders"                        active={activeView==='crm-orders'}        onNavigate={onNavigate} icon={<UsersIcon />} />}
          {can('crm_approvals')      && <SubItem id="crm-approvals"      label="Approval queue"                active={activeView==='crm-approvals'}     onNavigate={onNavigate} icon={<UsersIcon />} />}
          {can('crm_purchasing')     && <SubItem id="crm-purchasing"     label="Purchasing queue"              active={activeView==='crm-purchasing'}    onNavigate={onNavigate} icon={<UsersIcon />} />}
          {can('email_hot_prospects') && <SubItem id="crm-hot-prospects"   label="E-Mail Campaign Hot Prospects" active={activeView==='crm-hot-prospects'} onNavigate={onNavigate} icon={<HotProspectsIcon />} badge={hotProspectsDue} badgeUrgent />}
        </>}

        {showApp && <>
          <hr style={DIVIDER} />
          {/* App integration — external admin panels embedded inside Studio. */}
          <div style={SECTION}>App</div>
          <SubItem id="apps-idyq"           label="IDYQ"             active={activeView==='apps-idyq'}         onNavigate={onNavigate} icon={<IdyqIcon />} />
        </>}

        {isSuper && <>
          <hr style={DIVIDER} />
          {/* Settings — super-admin only. Staff accounts + per-section access. */}
          <div style={SECTION}>Settings</div>
          <SubItem id="staff-access"        label="Staff & access"   active={activeView==='staff-access'}      onNavigate={onNavigate} icon={<UsersIcon />} />
        </>}

      </div>

      <div style={{ padding:'14px 16px', borderTop:'0.5px solid rgba(255,255,255,0.1)' }}>
        <button onClick={onLogout} style={{ background:'transparent', border:'none', color:SB.sidebarText, fontSize:12, padding:0, cursor:'pointer' }}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function NavItem({ id, label, active, onNavigate, icon, dim, suffix }) {
  return (
    <button onClick={()=>onNavigate(id)} style={{
      display:'flex', alignItems:'center', gap:9, width:'100%',
      padding:'8px 16px', background:active?SB.primary:'transparent',
      border:'none',
      color:active?SB.onPrimary:(dim?'rgba(255,255,255,0.45)':SB.sidebarText),
      fontSize:12, textAlign:'left', cursor:'pointer'
    }}>
      {icon}<span style={{flex:1}}>{label}</span>
      {suffix && <span style={{ fontSize:9, fontWeight:600, padding:'1px 6px', borderRadius:8, background:'rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.7)', letterSpacing:'0.05em', textTransform:'uppercase' }}>{suffix}</span>}
    </button>
  );
}

function SubItem({ id, label, active, onNavigate, icon, badge, badgeUrgent }) {
  // badgeUrgent uses the danger-red colour to signal "needs attention" (used
  // by Hot Prospects for overdue + due-today follow-ups). Default badge style
  // is the original calm green (used by Mailboxes for new-prospect counts).
  const badgeBg = badgeUrgent ? '#A32D2D' : SB.primary;
  return (
    <button onClick={()=>onNavigate(id)} style={{
      display:'flex', alignItems:'center', gap:9, width:'100%',
      padding:'6px 16px 6px 32px',
      background:active?SB.sidebarHover:'transparent',
      borderLeft:active?('2px solid '+SB.primary):'2px solid transparent',
      borderTop:'none', borderRight:'none', borderBottom:'none',
      color:active?'#fff':SB.sidebarText, fontSize:11, textAlign:'left', cursor:'pointer'
    }}>
      {icon}<span style={{flex:1}}>{label}</span>
      {badge>0 && <span style={{ background:badgeBg, color:'#fff', fontSize:10, fontWeight:600, padding:'1px 6px', borderRadius:8, minWidth:14, textAlign:'center', lineHeight:1.4 }}>{badge}</span>}
    </button>
  );
}

function UsersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm0 2.5a2 2 0 110 4 2 2 0 010-4zM8 13a5 5 0 01-3.9-1.87C4.1 9.92 6.08 9 8 9s3.9.92 3.9 2.13A5 5 0 018 13z"/>
    </svg>
  );
}

function CustomersIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 8a3 3 0 100-6 3 3 0 000 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H1zm11-6a2 2 0 100-4 2 2 0 000 4zm4 6s0 .5-.5.5H13c.12-.5.16-1 .12-1.5.34.15.64.36.88.6.4.45.5.9.5.9a1 1 0 01-1 1z"/>
    </svg>
  );
}

function DomainIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5c.34 0 .9.4 1.4 1.5H6.6c.5-1.1 1.06-1.5 1.4-1.5zm-2.1.4C5.4 3.7 5 4.6 4.8 5.5H3.2A5.53 5.53 0 015.9 2.9zm4.2 0A5.53 5.53 0 0112.8 5.5h-1.6c-.2-.9-.6-1.8-1.1-2.6zM2.8 7h2c-.05.33-.08.66-.08 1s.03.67.08 1H2.8A5.46 5.46 0 012.5 8c0-.34.1-.67.3-1zm2.2 0h6c.06.32.1.65.1 1s-.04.68-.1 1H5c-.06-.32-.1-.65-.1-1s.04-.68.1-1zm6.2 0h2c.2.33.3.66.3 1s-.1.67-.3 1h-2c.05-.33.08-.66.08-1S11.25 7.33 11.2 7zM3.2 10.5h1.6c.2.9.6 1.8 1.1 2.6A5.53 5.53 0 013.2 10.5zm2.8 0h4c-.5 1.1-1.06 1.5-1.4 1.5-.34 0-.9-.4-1.4-1.5H6zm5.2 0h1.6a5.53 5.53 0 01-2.7 2.6c.5-.8.9-1.7 1.1-2.6z"/>
    </svg>
  );
}

function MailboxIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 3a1 1 0 00-1 1v8a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H2zm0 1h12v.4l-6 3.5L2 4.4V4zm0 1.6l5.7 3.3a.6.6 0 00.6 0L14 5.6V12H2V5.6z"/>
    </svg>
  );
}

function PortalIcon() {
  // Door-with-arrow icon — represents a customer "entering" their portal.
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 1.5A.5.5 0 013.5 1h6a.5.5 0 01.5.5v3.5h-1V2H4v12h5v-3h1v3.5a.5.5 0 01-.5.5h-6a.5.5 0 01-.5-.5v-13z"/>
      <path d="M11.5 5.5a.5.5 0 01.354.146l2.5 2.5a.5.5 0 010 .708l-2.5 2.5a.5.5 0 11-.708-.708L13.293 8.5H6.5a.5.5 0 010-1h6.793l-1.647-1.646A.5.5 0 0111.5 5.5z"/>
    </svg>
  );
}

function HotProspectsIcon() {
  // Flame icon — represents "hot" prospects. Single-path SVG to match the
  // other sidebar icons (currentColor fill, 16x16 viewBox).
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.3s-3.5 2.5-3.5 6c0 1.93 1.57 3.5 3.5 3.5s3.5-1.57 3.5-3.5C11.5 6.2 10 4.5 10 4.5S9.5 6 8.5 6c0-2 .5-3.2-.5-4.7zM8 9c-1.1 0-2-.9-2-2 0-.55.22-1.05.59-1.41C7 6 7.5 6.5 8 6.5S9 6 9.41 5.59C9.78 5.95 10 6.45 10 7c0 1.1-.9 2-2 2zM4.5 13c0 .83.67 1.5 1.5 1.5h4c.83 0 1.5-.67 1.5-1.5V12h-7v1z"/>
    </svg>
  );
}

function IdyqIcon() {
  // Document-with-checkmark icon — IDYQ is a quoting platform and its logo
  // theme is a checkmark over a document. Same hand-rolled SVG style as the
  // other sidebar icons (single path, currentColor fill, 16x16 viewBox).
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.5 1.5h5.79L13 5.21V14a.5.5 0 01-.5.5h-9A.5.5 0 013 14V2a.5.5 0 01.5-.5zm.5 1V13.5h8V5.71L9 2.5H4zm5.5 0v2.5h2.5L9.5 2.5zM5.4 8.6l-.7.7 2 2 4-4-.7-.7-3.3 3.3-1.3-1.3z"/>
    </svg>
  );
}
