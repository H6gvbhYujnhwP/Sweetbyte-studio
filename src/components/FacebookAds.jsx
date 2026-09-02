// ─────────────────────────────────────────────────────────────────────────────
// FacebookAds.jsx — Admin Facebook Ads screen.
//
// Two tabs:
//   • Results      — READ-ONLY live performance from Facebook (one account / customer)
//   • Ad approvals — generate ad copy + designed-ad images from the customer's
//                    FACEBOOK RAG (gpt-image-2, on-brand), review with the same
//                    controls as LinkedIn (text/image regen, logo position/size/
//                    background, approve). Nothing here writes to Facebook yet —
//                    pushing approved drafts is the next stage.
//
// Facebook is standalone: its RAG, brand colours, logo and ads are all separate
// from the LinkedIn side.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import { SB } from '../brand.js';

const GREEN_HI=SB.strong, GREEN_BG=SB.tint;
const TEXT='#1a1a1a', MUTED='#666', TERTIARY='#999', BORDER='#e0e0dc', BG='#f5f5f3', CARD='#ffffff';
const BLUE='#185FA5', BLUE_BG='#E6F1FB';
const AMBER='#854F0B', AMBER_BG='#FAEEDA';
const GREY='#5F5E5A', GREY_BG='#F1EFE8';
const RED='#A32D2D', RED_BG='#FCEBEB';
const GREEN=SB.primary;

const WINDOWS = [ {key:'7d',label:'Last 7 days'}, {key:'30d',label:'Last 30 days'}, {key:'lifetime',label:'Lifetime'} ];
const cardStyle = { background:CARD, border:`1px solid ${BORDER}`, borderRadius:10, padding:'14px 16px' };
const btn = (bg, fg, extra={}) => ({ background:bg, color:fg, border:'none', borderRadius:6, padding:'6px 12px', fontSize:12, fontWeight:500, cursor:'pointer', ...extra });
const fieldStyle = { width:'100%', fontSize:12, padding:'6px 8px', border:`1px solid ${BORDER}`, borderRadius:6, background:'#fff', color:TEXT, fontFamily:'inherit', boxSizing:'border-box' };

function statusPill(eff, status) {
  const s = (eff || status || '').toUpperCase();
  if (s === 'ACTIVE') return { label:'Active', fg:GREEN_HI, bg:GREEN_BG };
  if (s === 'PAUSED' || s === 'ADSET_PAUSED' || s === 'CAMPAIGN_PAUSED') return { label:'Paused', fg:AMBER, bg:AMBER_BG };
  if (s === 'IN_PROCESS' || s === 'PENDING_REVIEW') return { label:'In review', fg:BLUE, bg:BLUE_BG };
  if (s === 'DISAPPROVED' || s === 'WITH_ISSUES' || s === 'ADSET_DISAPPROVED') return { label:'Has issues', fg:RED, bg:RED_BG };
  if (s === 'ARCHIVED' || s === 'DELETED') return { label:'Archived', fg:GREY, bg:GREY_BG };
  const label = (eff || status || 'Unknown').toLowerCase().replace(/_/g,' ').replace(/^\w/, c=>c.toUpperCase());
  return { label, fg:GREY, bg:GREY_BG };
}

export default function FacebookAds() {
  const [customers, setCustomers] = useState([]);
  const [available, setAvailable] = useState([]);
  const [selId, setSelId] = useState('');
  const [tab, setTab] = useState('results');
  const [window, setWindow] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addSel, setAddSel] = useState('');
  const [addName, setAddName] = useState('');
  const [addAcct, setAddAcct] = useState('');
  const [editAcct, setEditAcct] = useState(false);
  const [acctInput, setAcctInput] = useState('');
  const [savingAcct, setSavingAcct] = useState(false);

  const [permTest, setPermTest] = useState(null);
  const [permLoading, setPermLoading] = useState(false);

  const selected = customers.find(c => c.id === selId) || null;

  async function loadCustomers() { try { const r = await fetch('/api/facebook-ads/customers'); if (r.ok) setCustomers(await r.json()); } catch {} }
  async function loadAvailable() { try { const r = await fetch('/api/facebook-ads/available-customers'); if (r.ok) setAvailable(await r.json()); } catch {} }

  async function loadAds(customerId, win) {
    if (!customerId) { setData(null); return; }
    setLoading(true); setError(null);
    try { const r = await fetch(`/api/facebook-ads/ads?customer=${encodeURIComponent(customerId)}&window=${encodeURIComponent(win)}`); setData(await r.json()); }
    catch { setError('Could not reach Studio. Try again in a moment.'); setData(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadCustomers(); loadAvailable(); }, []);
  useEffect(() => { if (tab === 'results') loadAds(selId, window); }, [selId, window, tab]);

  async function saveAccount(id, acct) {
    setSavingAcct(true); setError(null);
    try {
      const r = await fetch(`/api/facebook-ads/${id}/account`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ad_account_id: acct }) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || 'Could not save the ad account ID');
      await loadCustomers();
      return true;
    } catch (e) { setError(e.message); return false; }
    finally { setSavingAcct(false); }
  }

  async function onAddCustomer() {
    const name = addName.trim();
    if (!addSel && !name) { setError('Pick a customer or enter a new customer name.'); return; }
    setSavingAcct(true); setError(null);
    try {
      const r = await fetch('/api/facebook-ads/add-customer', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email_client_id: addSel||undefined, name: name||undefined, ad_account_id: addAcct.trim()||undefined }),
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || 'Could not add customer');
      await loadCustomers(); await loadAvailable();
      setSelId(j.id); setAddOpen(false); setAddSel(''); setAddName(''); setAddAcct('');
    } catch(e){ setError(e.message); } finally { setSavingAcct(false); }
  }

  async function onSaveEditAcct() {
    if (!selId) return;
    const okSaved = await saveAccount(selId, acctInput.trim());
    if (okSaved) { setEditAcct(false); loadAds(selId, window); }
  }

  async function runPermTest() {
    if (!selId) return;
    setPermLoading(true); setPermTest(null);
    try {
      const r = await fetch(`/api/facebook-ads/test-create-permission?customer=${encodeURIComponent(selId)}`);
      setPermTest(await r.json());
    } catch {
      setPermTest({ verdict: 'Could not reach Studio. Try again in a moment.' });
    } finally {
      setPermLoading(false);
    }
  }

  const currency = (data && data.account && data.account.currency) || 'GBP';
  const fmtMoney = (n) => (n===null||n===undefined) ? '—' : (()=>{ try { return new Intl.NumberFormat('en-GB',{style:'currency',currency}).format(n); } catch { return `£${Number(n).toFixed(2)}`; } })();
  const fmtNum = (n) => (n===null||n===undefined) ? '—' : Number(n).toLocaleString('en-GB');

  const connected = !!(data && data.ok && data.account);
  const totals = (data && data.totals) || { spend:0, reach:0, leads:0, cost_per_lead:null };
  const ads = (data && Array.isArray(data.ads)) ? data.ads : [];
  const nothingSpent = connected && (!totals.spend || totals.spend === 0);
  const noAccount = data && data.no_account;
  const statCell = (label, value) => (<div><div style={{ fontSize:11, color:TERTIARY }}>{label}</div><div style={{ fontSize:14, fontWeight:500, color:TEXT }}>{value}</div></div>);

  const tabBtn = (key, label) => (
    <button onClick={()=>setTab(key)} style={{ padding:'8px 16px', fontSize:13, cursor:'pointer', border:'none', background:'none', color: tab===key?GREEN_HI:MUTED, fontWeight: tab===key?600:400, borderBottom: tab===key?`2px solid ${GREEN_HI}`:'2px solid transparent' }}>{label}</button>
  );

  return (
    <div style={{ flex:1, overflow:'auto', padding:28, background:BG }}>
      <div style={{ marginBottom:16 }}>
        <h1 style={{ fontSize:20, fontWeight:500, color:TEXT, margin:0 }}>Facebook Ads</h1>
        <div style={{ fontSize:13, color:MUTED, marginTop:3 }}>Live performance plus ad generation and approvals — one ad account per customer.</div>
      </div>

      {/* Customer selector */}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:12 }}>
        <select value={selId} onChange={e=>{ setSelId(e.target.value); setEditAcct(false); setPermTest(null); }} style={{ minWidth:240, padding:'8px 9px', border:`1px solid ${BORDER}`, borderRadius:6, fontSize:13, background:'#fff', color:TEXT }}>
          <option value="">{customers.length ? 'Select a customer…' : 'No Facebook Ads customers yet'}</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.has_account ? '' : ' (no account)'}</option>)}
        </select>
        <button onClick={()=>{ setAddOpen(o=>!o); setError(null); }} style={btn(GREEN_BG, GREEN_HI, { border:`1px solid ${GREEN}` })}>+ Add customer</button>
        {selected && selected.has_account && (
          <button onClick={runPermTest} disabled={permLoading} style={btn(BLUE_BG, BLUE, { border:`1px solid ${BLUE}`, ...(permLoading?{opacity:0.6}:{}) })}>
            {permLoading ? 'Testing…' : 'Test create-ad permission'}
          </button>
        )}
        <div style={{ flex:1 }} />
        {selected && tab==='results' && (connected
          ? <span style={{ fontSize:12, padding:'5px 10px', borderRadius:6, background:GREEN_BG, color:GREEN_HI }}>● Connected</span>
          : (!noAccount && data && data.ok===false ? <span style={{ fontSize:12, padding:'5px 10px', borderRadius:6, background:RED_BG, color:RED }}>● Not connected</span> : null))}
      </div>

      {/* Create-ad permission test result */}
      {permTest && (() => {
        const pass = !!permTest.create_ok;
        const c = pass ? { fg:GREEN_HI, bg:GREEN_BG, br:GREEN } : { fg:RED, bg:RED_BG, br:RED };
        return (
          <div style={{ ...cardStyle, background:c.bg, border:`1px solid ${c.br}`, marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:500, color:c.fg }}>{permTest.verdict}</div>
            <div style={{ fontSize:12, color:MUTED, marginTop:6, lineHeight:1.6 }}>
              {permTest.ad_account_id && <div>Ad account: {permTest.ad_account_id}</div>}
              {permTest.has_ads_management !== null && permTest.has_ads_management !== undefined &&
                <div>Manage-ads permission: {permTest.has_ads_management === true ? 'yes' : (permTest.has_ads_management === false ? 'no' : '—')}</div>}
              {permTest.account_status !== null && permTest.account_status !== undefined &&
                <div>Account status: {permTest.account_status === 1 ? 'active' : permTest.account_status}</div>}
              {permTest.error && <div style={{ color:RED }}>Detail: {permTest.error}</div>}
            </div>
          </div>
        );
      })()}

      {addOpen && (
        <div style={{ ...cardStyle, marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:500, marginBottom:8 }}>Add a Facebook Ads customer</div>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <select value={addSel} onChange={e=>{ setAddSel(e.target.value); if(e.target.value) setAddName(''); }} style={{ minWidth:190, padding:'8px 9px', border:`1px solid ${BORDER}`, borderRadius:6, fontSize:13, background:'#fff' }}>
              <option value="">Choose existing…</option>
              {available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span style={{ fontSize:12, color:TERTIARY }}>or</span>
            <input value={addName} onChange={e=>{ setAddName(e.target.value); if(e.target.value) setAddSel(''); }} placeholder="New customer name (e.g. Sunbear Care)" style={{ width:240, padding:'8px 9px', border:`1px solid ${BORDER}`, borderRadius:6, fontSize:13 }} />
            <input value={addAcct} onChange={e=>setAddAcct(e.target.value)} placeholder="Ad account ID — optional" style={{ width:200, padding:'8px 9px', border:`1px solid ${BORDER}`, borderRadius:6, fontSize:13 }} />
            <button disabled={savingAcct} onClick={onAddCustomer} style={btn(GREEN_HI, '#fff', savingAcct?{opacity:0.6}:{})}>{savingAcct?'Saving…':'Add'}</button>
            <button onClick={()=>{ setAddOpen(false); setAddSel(''); setAddName(''); setAddAcct(''); }} style={btn('#fff', MUTED, { border:`1px solid ${BORDER}` })}>Cancel</button>
          </div>
          <div style={{ fontSize:11, color:TERTIARY, marginTop:8 }}>Pick an existing customer or type a new name. <strong>Ad account is optional</strong> — leave it blank for a generate-only customer (generate the ads, then save the images and copy the text yourself). You can add an ad account later if you ever want to push.</div>
        </div>
      )}

      {error && <div style={{ ...cardStyle, background:RED_BG, border:`1px solid ${RED}`, color:RED, marginBottom:14, fontSize:13 }}>{error}</div>}

      {!selected && !addOpen && <div style={{ ...cardStyle, color:MUTED, fontSize:13 }}>Select a customer to see their Facebook Ads performance and approvals, or add one.</div>}

      {/* Selected customer: account line (shared) */}
      {selected && (
        <div style={{ ...cardStyle, marginBottom:14, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ fontSize:13, color:MUTED }}>Ad account:</div>
          {editAcct ? (
            <>
              <input value={acctInput} onChange={e=>setAcctInput(e.target.value)} placeholder="Ad account ID" style={{ width:260, padding:'7px 9px', border:`1px solid ${BORDER}`, borderRadius:6, fontSize:13 }} />
              <button disabled={savingAcct} onClick={onSaveEditAcct} style={btn(GREEN_HI,'#fff', savingAcct?{opacity:0.6}:{})}>{savingAcct?'Saving…':'Save'}</button>
              <button onClick={()=>setEditAcct(false)} style={btn('#fff',MUTED,{border:`1px solid ${BORDER}`})}>Cancel</button>
            </>
          ) : (
            <>
              <span style={{ fontSize:13, color:TEXT }}>{selected.ad_account_id ? `act_${selected.ad_account_id}` : <span style={{ color:RED }}>not set</span>}</span>
              <button onClick={()=>{ setAcctInput(selected.ad_account_id||''); setEditAcct(true); }} style={btn(GREY_BG, GREY, { border:`1px solid ${BORDER}` })}>{selected.ad_account_id?'Edit':'Set account'}</button>
              {data && data.account && tab==='results' && <span style={{ fontSize:12, color:TERTIARY }}>· {data.account.name} · {currency}</span>}
            </>
          )}
        </div>
      )}

      {/* Tabs */}
      {selected && (
        <div style={{ display:'flex', gap:4, borderBottom:`1px solid ${BORDER}`, marginBottom:16 }}>
          {tabBtn('results','Results')}
          {tabBtn('approvals','Ad approvals')}
          {tabBtn('setup','Setup')}
          {tabBtn('history','History')}
        </div>
      )}

      {/* ── RESULTS TAB ─────────────────────────────────────────────────────── */}
      {selected && tab==='results' && (
        <>
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}>
            <div style={{ display:'inline-flex', border:`1px solid ${BORDER}`, borderRadius:6, overflow:'hidden' }}>
              {WINDOWS.map((w,i)=>(
                <button key={w.key} onClick={()=>setWindow(w.key)} style={{ padding:'6px 12px', fontSize:12, cursor:'pointer', border:'none', borderLeft:i===0?'none':`1px solid ${BORDER}`, background:window===w.key?GREEN_HI:'#fff', color:window===w.key?'#fff':MUTED, fontWeight:window===w.key?500:400 }}>{w.label}</button>
              ))}
            </div>
          </div>

          {data && data.ok===false && !noAccount && (
            <div style={{ ...cardStyle, background:AMBER_BG, border:`1px solid ${AMBER}`, color:AMBER, marginBottom:14 }}>
              <div style={{ fontWeight:500, marginBottom:4 }}>Couldn't load ads from Facebook</div>
              <div style={{ fontSize:13 }}>{data.error || 'Unknown error from the Meta API.'}</div>
            </div>
          )}

          {noAccount && !editAcct && (
            <div style={{ ...cardStyle, color:MUTED, fontSize:13 }}>Set this customer's ad account ID above to see their performance.</div>
          )}

          {selected.ad_account_id && !noAccount && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:12, marginBottom:12 }}>
                <div style={cardStyle}><div style={{ fontSize:13, color:MUTED }}>Total spent</div><div style={{ fontSize:24, fontWeight:500 }}>{loading?'…':fmtMoney(totals.spend)}</div></div>
                <div style={cardStyle}><div style={{ fontSize:13, color:MUTED }}>Reach</div><div style={{ fontSize:24, fontWeight:500 }}>{loading?'…':fmtNum(totals.reach)}</div></div>
                <div style={cardStyle}><div style={{ fontSize:13, color:MUTED }}>Leads</div><div style={{ fontSize:24, fontWeight:500 }}>{loading?'…':fmtNum(totals.leads)}</div></div>
                <div style={cardStyle}><div style={{ fontSize:13, color:MUTED }}>Cost per lead</div><div style={{ fontSize:24, fontWeight:500 }}>{loading?'…':fmtMoney(totals.cost_per_lead)}</div></div>
              </div>

              {!loading && nothingSpent && (
                <div style={{ display:'flex', gap:8, fontSize:12, color:BLUE, background:BLUE_BG, borderRadius:6, padding:'8px 12px', marginBottom:18 }}>
                  <span>ℹ️</span><span>No spend in this window yet, so the numbers are zero. Leads start counting once an ad is running and the pixel's lead event is live.</span>
                </div>
              )}

              {!loading && connected && <div style={{ fontSize:13, color:MUTED, margin:'6px 0 8px' }}>{ads.length} {ads.length===1?'ad':'ads'}</div>}
              {loading && <div style={{ fontSize:13, color:TERTIARY, padding:'12px 0' }}>Loading ads from Facebook…</div>}
              {!loading && connected && ads.length===0 && <div style={{ ...cardStyle, color:MUTED, fontSize:13 }}>No ads in this account yet.</div>}

              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {!loading && ads.map(ad => {
                  const pill = statusPill(ad.effective_status, ad.status); const s = ad.stats || {};
                  return (
                    <div key={ad.id} style={{ ...cardStyle, display:'flex', gap:14 }}>
                      <div style={{ width:120, height:120, flex:'none', borderRadius:8, background:GREY_BG, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {ad.image_url ? <img src={ad.image_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={(e)=>{e.target.style.display='none';}} /> : <span style={{ color:TERTIARY, fontSize:11 }}>No image</span>}
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
            </>
          )}
        </>
      )}

      {/* ── AD APPROVALS / SETUP TABS ───────────────────────────────────────── */}
      {selected && (tab==='approvals' || tab==='setup') && (
        <AdApprovals key={selId} customerId={selId} customerName={selected.name} view={tab} />
      )}

      {/* ── HISTORY TAB ─────────────────────────────────────────────────────── */}
      {selected && tab==='history' && (
        <AdHistory key={selId+':hist'} customerId={selId} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// History tab — every ad that's been pushed to Facebook for this customer,
// grouped by push (each push = one dated campaign), newest first. Read-only.
// ─────────────────────────────────────────────────────────────────────────────
const CTA_LABELS = { LEARN_MORE:'Learn more', SIGN_UP:'Sign up', GET_QUOTE:'Get quote', SUBSCRIBE:'Subscribe', APPLY_NOW:'Apply now', DOWNLOAD:'Download' };
// Mirror the server's push-time CTA rule so History shows the button the ad
// ACTUALLY went out with (anything not lead-form-valid becomes "Learn more").
function ctaLabel(cta) {
  const t = String(cta || '').toUpperCase().trim();
  return CTA_LABELS[t] || 'Learn more';
}
function fmtPushed(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return String(s);
  return d.toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function AdHistory({ customerId }) {
  const [loading, setLoading] = useState(true);
  const [ads, setAds] = useState([]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/facebook-ads/${customerId}/history`)
      .then(r => r.ok ? r.json() : { ads: [] })
      .then(j => { if (live) { setAds(j.ads || []); setLoading(false); } })
      .catch(() => { if (live) { setAds([]); setLoading(false); } });
    return () => { live = false; };
  }, [customerId]);

  // Group by campaign (fall back to a per-date bucket for ads pushed before the
  // campaign was recorded). Ads arrive newest-first, so first-seen order = newest.
  const groups = [];
  const byKey = new Map();
  for (const a of ads) {
    const key = a.pushed_campaign_id || ('date:' + String(a.pushed_at || '').slice(0, 10));
    let g = byKey.get(key);
    if (!g) { g = { key, name: a.pushed_campaign_name || 'Earlier push', pushed_at: a.pushed_at, ads: [] }; byKey.set(key, g); groups.push(g); }
    g.ads.push(a);
  }

  if (loading) return <div style={{ ...cardStyle, color:TERTIARY, fontSize:13 }}>Loading history…</div>;

  if (!ads.length) return (
    <div style={{ ...cardStyle, textAlign:'center', padding:'32px 16px' }}>
      <div style={{ fontSize:14, fontWeight:500, color:TEXT, marginBottom:6 }}>No ads pushed yet</div>
      <div style={{ fontSize:12, color:TERTIARY, maxWidth:420, margin:'0 auto' }}>Approve ads on the Ad approvals tab and push them to Facebook — every ad shows here with the date it was pushed.</div>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize:12, color:MUTED, marginBottom:16 }}>
        {ads.length} {ads.length===1?'ad':'ads'} pushed across {groups.length} {groups.length===1?'push':'pushes'} · everything paused on Facebook
      </div>

      {groups.map(g => (
        <div key={g.key} style={{ marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <span style={{ fontSize:13, fontWeight:500, color:TEXT }}>{fmtPushed(g.pushed_at)}</span>
            <span style={{ fontSize:12, color:TERTIARY }}>· {g.name}</span>
            <span style={{ marginLeft:'auto', fontSize:11, padding:'3px 8px', borderRadius:6, background:AMBER_BG, color:AMBER }}>{g.ads.length} {g.ads.length===1?'ad':'ads'} · paused</span>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {g.ads.map(a => (
              <div key={a.id} style={{ display:'flex', gap:12, padding:10, border:`1px solid ${BORDER}`, borderRadius:8 }}>
                {a.image_url
                  ? <img src={a.image_url} alt="" style={{ width:64, height:64, objectFit:'cover', borderRadius:6, flex:'none', background:BG }} />
                  : <div style={{ width:64, height:64, borderRadius:6, flex:'none', background:BG, display:'flex', alignItems:'center', justifyContent:'center', color:TERTIARY, fontSize:18 }}>▦</div>}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500, color:TEXT, marginBottom:2 }}>{a.headline || 'Untitled ad'}</div>
                  {a.hook_label && <div style={{ fontSize:11, color:TERTIARY, marginBottom:6 }}>{a.hook_label}</div>}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                    <span style={{ fontSize:11, padding:'2px 7px', borderRadius:6, background:BLUE_BG, color:BLUE }}>Button: {ctaLabel(a.cta)}</span>
                    {a.fb_ad_id && <span style={{ fontSize:11, color:TERTIARY }}>ad {a.fb_ad_id}</span>}
                    <a href="https://business.facebook.com/adsmanager" target="_blank" rel="noreferrer" style={{ marginLeft:'auto', fontSize:11, color:BLUE, textDecoration:'none' }}>View in Ads Manager ↗</a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ad approvals tab — the Facebook overview (RAG + brand + logo + generate) and
// the generated ad cards. Self-contained; owns its own data for the selected
// customer. Card layout mirrors the LinkedIn post cards.
// ─────────────────────────────────────────────────────────────────────────────
const LOGO_POSITIONS = [ ['bottom-right','Bottom right'], ['bottom-left','Bottom left'], ['top-right','Top right'], ['top-left','Top left'] ];
const LOGO_SIZES = [ ['small','Small'], ['medium','Medium'], ['large','Large'] ];
const LOGO_PANELS = [ ['white','White panel'], ['none','No panel'] ];
const AD_COUNTS = [3,4,5,6,8,10];
const GEN_STAGES = ['Reading the RAG', 'Writing the ad copy', 'Designing the images', 'Adding the logo'];

function AdApprovals({ customerId, customerName, view='approvals' }) {
  const [ov, setOv] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [count, setCount] = useState(6);
  const [generating, setGenerating] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genStage, setGenStage] = useState(0);
  const [genError, setGenError] = useState(null);
  const genTimer = useRef(null);
  const [newRag, setNewRag] = useState(null);
  const [uploadingRag, setUploadingRag] = useState(false);
  const [newLogo, setNewLogo] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [extractMsg, setExtractMsg] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [busyKind, setBusyKind] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({ headline:'', primary_text:'' });
  const [brand, setBrand] = useState({ brand_colors:'', logo_description:'', type_style:'', visual_style:'' });
  const saveTimer = useRef(null);

  // ── Push-to-Facebook setup state ──────────────────────────────────────────
  const [pagePick, setPagePick] = useState({ loading:false, ok:null, pages:[], error:null });
  const [formPick, setFormPick] = useState({ loading:false, ok:null, forms:[], error:null, no_page:false });
  const [manualPage, setManualPage] = useState(false);
  const [manualForm, setManualForm] = useState(false);
  const [budget, setBudget] = useState('');
  const [website, setWebsite] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState(null);
  const [mPage, setMPage] = useState('');
  const [mForm, setMForm] = useState('');
  const budgetTimer = useRef(null);
  const websiteTimer = useRef(null);

  async function loadPages() {
    setPagePick(p=>({ ...p, loading:true, error:null }));
    try {
      const r = await fetch('/api/facebook-ads/pages');
      const j = await r.json().catch(()=>({}));
      setPagePick({ loading:false, ok:!!j.ok, pages:j.pages||[], error:j.ok?null:(j.error||'Could not list Pages') });
    } catch { setPagePick({ loading:false, ok:false, pages:[], error:'Could not reach Studio.' }); }
  }
  async function loadForms(pageId) {
    if (!pageId) { setFormPick({ loading:false, ok:null, forms:[], error:null, no_page:true }); return; }
    setFormPick(p=>({ ...p, loading:true, error:null }));
    try {
      const r = await fetch(`/api/facebook-ads/${customerId}/lead-forms?page_id=${encodeURIComponent(pageId)}`);
      const j = await r.json().catch(()=>({}));
      setFormPick({ loading:false, ok:!!j.ok, forms:j.forms||[], error:j.ok?null:(j.error||'Could not list forms'), no_page:!!j.no_page });
    } catch { setFormPick({ loading:false, ok:false, forms:[], error:'Could not reach Studio.', no_page:false }); }
  }

  function saveSetup(patch) {
    setOv(o=>o?({ ...o, ...patch }):o);
    saveOverview(patch);
  }
  function onPickPage(id, name) {
    saveSetup({ page_id:id, page_name:name, lead_form_id:null, lead_form_name:null });
    setManualForm(false);
    loadForms(id);
  }
  function onManualPageInput(id) {
    saveSetup({ page_id:id||null, page_name:null, lead_form_id:null, lead_form_name:null });
  }
  function onBudgetChange(v) {
    setBudget(v);
    clearTimeout(budgetTimer.current);
    budgetTimer.current = setTimeout(()=>{
      const pounds = parseFloat(String(v).replace(/[^0-9.]/g,''));
      const pence = Number.isFinite(pounds) && pounds>0 ? Math.round(pounds*100) : null;
      saveSetup({ daily_budget_pence: pence });
    }, 700);
  }
  function onWebsiteChange(v) {
    setWebsite(v);
    clearTimeout(websiteTimer.current);
    websiteTimer.current = setTimeout(()=>{
      saveSetup({ website_url: String(v).trim() || null });
    }, 700);
  }
  async function doPush() {
    setPushing(true); setErr(null); setPushResult(null);
    try {
      const r = await fetch(`/api/facebook-ads/${customerId}/push`, { method:'POST' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || 'Push failed');
      setPushResult(j);
      await load();
    } catch(e){ setErr(e.message); } finally { setPushing(false); }
  }

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/facebook-ads/${customerId}/overview`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load this customer.');
      setOv(j);
      setCount(j.ad_count || 6);
      setBrand({ brand_colors:j.brand_colors||'', logo_description:j.logo_description||'', type_style:j.type_style||'', visual_style:j.visual_style||'' });
      setBudget(j.daily_budget_pence ? (j.daily_budget_pence/100).toFixed(2) : '');
      setWebsite(j.website_url || '');
      if (j.page_id) loadForms(j.page_id); else setFormPick({ loading:false, ok:null, forms:[], error:null, no_page:true });
    } catch(e){ setErr(e.message); setOv(null); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ load(); }, [customerId]);
  useEffect(()=>{ loadPages(); }, []);

  function saveOverview(patch) {
    fetch(`/api/facebook-ads/${customerId}/overview`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) }).catch(()=>{});
  }
  function onBrandChange(field, value) {
    setBrand(b=>({ ...b, [field]: value }));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(()=>saveOverview({ [field]: value }), 800);
  }
  function setCountAndSave(v){ setCount(v); saveOverview({ ad_count: v }); }

  async function uploadRag() {
    if (!newRag) return; setUploadingRag(true); setErr(null);
    try {
      const fd = new FormData(); fd.append('rag', newRag);
      const r = await fetch(`/api/facebook-ads/${customerId}/overview`, { method:'PUT', body:fd });
      if (!r.ok){ const j=await r.json().catch(()=>({})); throw new Error(j.error||'RAG upload failed'); }
      setNewRag(null); await load();
    } catch(e){ setErr(e.message); } finally { setUploadingRag(false); }
  }
  async function uploadLogo() {
    if (!newLogo) return; setUploadingLogo(true); setErr(null);
    try {
      const fd = new FormData(); fd.append('logo', newLogo);
      const r = await fetch(`/api/facebook-ads/${customerId}/logo`, { method:'POST', body:fd });
      if (!r.ok){ const j=await r.json().catch(()=>({})); throw new Error(j.error||'Logo upload failed'); }
      setNewLogo(null); await load();
    } catch(e){ setErr(e.message); } finally { setUploadingLogo(false); }
  }
  async function pullBrand() {
    if (extracting) return; setExtracting(true); setExtractMsg('');
    try {
      const r = await fetch(`/api/facebook-ads/${customerId}/extract-brand`, { method:'POST' });
      const j = await r.json().catch(()=>({}));
      if (r.ok){ setExtractMsg(j.found?`✓ Pulled ${j.found} field${j.found===1?'':'s'} from the RAG`:'No branding found in the RAG'); await load(); }
      else setExtractMsg(j.error||'Extraction failed');
    } catch { setExtractMsg('Extraction failed'); }
    finally { setExtracting(false); setTimeout(()=>setExtractMsg(''),4000); }
  }
  // Advance the indicative stages while generating (the backend does it all in
  // one call, so these are timed cues, not a live feed). Stops on error/done.
  useEffect(() => {
    clearInterval(genTimer.current);
    if (genOpen && generating && !genError) {
      genTimer.current = setInterval(() => {
        setGenStage(s => Math.min(s + 1, GEN_STAGES.length - 1));
      }, 5000);
    }
    return () => clearInterval(genTimer.current);
  }, [genOpen, generating, genError]);

  async function generate() {
    setGenOpen(true); setGenError(null); setGenStage(0); setGenerating(true); setErr(null);
    try {
      const r = await fetch(`/api/facebook-ads/${customerId}/generate`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ count }) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || 'Generation failed');
      await load();
      setGenStage(GEN_STAGES.length); // all ticks + Done
      setGenerating(false);
      setTimeout(()=>setGenOpen(false), 1200);
    } catch(e){
      setGenError(e.message || 'Generation failed');
      setGenerating(false);
    }
  }

  async function creativeAction(id, kind, path, body) {
    setBusyId(id); setBusyKind(kind); setErr(null);
    try {
      const opts = body!==undefined
        ? { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }
        : { method:'POST' };
      const r = await fetch(`/api/facebook-ads/${customerId}/creatives/${id}/${path}`, opts);
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error||j.message||'Action failed');
      if (j.creative) setOv(o=>({ ...o, creatives: o.creatives.map(c=>c.id===id?j.creative:c) }));
      else if (j.status) setOv(o=>({ ...o, creatives: o.creatives.map(c=>c.id===id?{...c, status:j.status}:c) }));
      return j;
    } catch(e){ setErr(e.message); return null; }
    finally { setBusyId(null); setBusyKind(null); }
  }

  function startEdit(c){ setEditId(c.id); setEditDraft({ headline:c.headline||'', primary_text:c.primary_text||'' }); }
  async function saveEdit(id){
    setBusyId(id); setBusyKind('save');
    try {
      await fetch(`/api/facebook-ads/${customerId}/creatives/${id}/text`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(editDraft) });
      setOv(o=>({ ...o, creatives: o.creatives.map(c=>c.id===id?{...c, ...editDraft}:c) }));
      setEditId(null);
    } catch(e){ setErr(e.message); } finally { setBusyId(null); setBusyKind(null); }
  }

  const creatives = (ov && Array.isArray(ov.creatives)) ? ov.creatives : [];
  const approvedCount = creatives.filter(c=>c.status==='approved').length;
  const hasRag = ov && ov.has_rag;
  const ctrl = { width:'100%', fontSize:11, padding:'5px 4px', border:'1px solid #ddd', borderRadius:5, background:'#fff', color:'#333', cursor:'pointer' };

  if (loading && !ov) return <div style={{ ...cardStyle, color:TERTIARY, fontSize:13 }}>Loading…</div>;

  return (
    <div>
      {genOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <style>{`@keyframes fbspin{to{transform:rotate(360deg)}}`}</style>
          <div style={{ background:'#fff', borderRadius:12, padding:'22px 26px', width:460, maxWidth:'90vw', boxShadow:'0 12px 44px rgba(0,0,0,0.22)' }}>
            {genError ? (
              <>
                <div style={{ fontSize:15, fontWeight:600, color:RED, marginBottom:6 }}>Generation failed</div>
                <div style={{ fontSize:12, color:MUTED, marginBottom:10 }}>No ads were created. The error from the server:</div>
                <div style={{ fontSize:12, color:RED, background:RED_BG, border:`1px solid ${RED}`, borderRadius:8, padding:'10px 12px', whiteSpace:'pre-wrap', fontFamily:'ui-monospace, Menlo, monospace', wordBreak:'break-word', marginBottom:14 }}>{genError}</div>
                <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                  <button onClick={()=>{ setGenOpen(false); setGenError(null); }} style={btn('#fff', MUTED, { border:`1px solid ${BORDER}` })}>Close</button>
                  <button onClick={generate} style={btn(GREEN_HI,'#fff')}>Try again</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize:15, fontWeight:600, color:TEXT, marginBottom:3 }}>{genStage>=GEN_STAGES.length ? 'Done — ads ready' : `Generating ${count} Facebook ad${count===1?'':'s'}…`}</div>
                <div style={{ fontSize:12, color:MUTED, marginBottom:16 }}>From the RAG. This usually takes about a minute.</div>
                <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
                  {GEN_STAGES.map((label, i) => {
                    const done = i < genStage || genStage>=GEN_STAGES.length;
                    const active = i === genStage && genStage < GEN_STAGES.length;
                    return (
                      <div key={label} style={{ display:'flex', alignItems:'center', gap:11 }}>
                        {done
                          ? <span style={{ width:22,height:22,borderRadius:'50%',background:GREEN_BG,color:GREEN_HI,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flex:'none' }}>✓</span>
                          : active
                          ? <span style={{ width:22,height:22,borderRadius:'50%',border:`2px solid ${BLUE}`,borderTopColor:'transparent',display:'inline-block',flex:'none',animation:'fbspin 0.8s linear infinite' }} />
                          : <span style={{ width:22,height:22,borderRadius:'50%',background:GREY_BG,color:TERTIARY,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,flex:'none' }}>{i+1}</span>}
                        <span style={{ fontSize:13, color: done?MUTED:(active?TEXT:TERTIARY), fontWeight: active?500:400 }}>{label}</span>
                      </div>
                    );
                  })}
                  <div style={{ display:'flex', alignItems:'center', gap:11 }}>
                    <span style={{ width:22,height:22,borderRadius:'50%',background: genStage>=GEN_STAGES.length?GREEN_BG:GREY_BG, color: genStage>=GEN_STAGES.length?GREEN_HI:TERTIARY, display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flex:'none' }}>{genStage>=GEN_STAGES.length?'✓':GEN_STAGES.length+1}</span>
                    <span style={{ fontSize:13, color: genStage>=GEN_STAGES.length?MUTED:TERTIARY }}>Done</span>
                  </div>
                </div>
                <div style={{ fontSize:11, color:TERTIARY, marginTop:16 }}>Keep this tab open — your ads will appear below when they’re ready.</div>
              </>
            )}
          </div>
        </div>
      )}

      {err && <div style={{ ...cardStyle, background:RED_BG, border:`1px solid ${RED}`, color:RED, marginBottom:14, fontSize:13 }}>{err}</div>}

      {/* ── SETUP VIEW ──────────────────────────────────────────────────── */}
      {view==='setup' && (<>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
        {/* RAG */}
        <div style={cardStyle}>
          <div style={{ fontSize:12, fontWeight:500, color:MUTED, marginBottom:8 }}>Facebook RAG document</div>
          {ov && ov.rag_filename ? (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:12, color:GREEN_HI, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ov.rag_filename}</span>
              <span style={{ flex:1 }} />
              <label style={{ fontSize:11, color:MUTED, cursor:'pointer' }}>Replace<input type="file" accept=".md,.txt,.pdf" onChange={e=>setNewRag(e.target.files[0])} style={{ display:'none' }} /></label>
            </div>
          ) : (
            <label style={{ ...btn(GREEN_BG, GREEN_HI, { border:`1px solid ${GREEN}`, display:'inline-block' }) }}>Upload RAG document<input type="file" accept=".md,.txt,.pdf" onChange={e=>setNewRag(e.target.files[0])} style={{ display:'none' }} /></label>
          )}
          {newRag && (
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8 }}>
              <span style={{ fontSize:12, color:GREEN_HI, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{newRag.name}</span>
              <button onClick={uploadRag} disabled={uploadingRag} style={btn(GREEN_HI,'#fff', uploadingRag?{opacity:0.6}:{})}>{uploadingRag?'Saving…':'Save'}</button>
            </div>
          )}
          <div style={{ fontSize:11, color:TERTIARY, marginTop:8 }}>Separate from LinkedIn. Drives this customer's ad text and brand colours.</div>
          {!hasRag && !newRag && <div style={{ fontSize:11, color:RED, marginTop:6 }}>A RAG document is required before generating ads.</div>}
        </div>

        {/* Logo */}
        <div style={cardStyle}>
          <div style={{ fontSize:12, fontWeight:500, color:MUTED, marginBottom:8 }}>Logo (Facebook)</div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:48, height:48, flex:'none', borderRadius:6, background:GREY_BG, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {ov && ov.logo_url ? <img src={ov.logo_url} alt="" style={{ width:'100%', height:'100%', objectFit:'contain' }} /> : <span style={{ fontSize:9, color:TERTIARY }}>None</span>}
            </div>
            <label style={{ fontSize:11, color:GREEN_HI, cursor:'pointer', fontWeight:500 }}>{ov && ov.logo_url ? 'Replace logo' : 'Upload logo'}<input type="file" accept="image/*" onChange={e=>setNewLogo(e.target.files[0])} style={{ display:'none' }} /></label>
          </div>
          {newLogo && (
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8 }}>
              <span style={{ fontSize:12, color:GREEN_HI, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{newLogo.name}</span>
              <button onClick={uploadLogo} disabled={uploadingLogo} style={btn(GREEN_HI,'#fff', uploadingLogo?{opacity:0.6}:{})}>{uploadingLogo?'Saving…':'Save'}</button>
            </div>
          )}
          <div style={{ fontSize:11, color:TERTIARY, marginTop:8 }}>Added on top of every generated ad image.</div>
        </div>

      </div>

      {/* Default logo placement — the default for every newly generated ad */}
      <div style={{ ...cardStyle, marginBottom:12 }}>
        <div style={{ fontSize:12, fontWeight:500, color:MUTED, marginBottom:3 }}>Default logo placement</div>
        <div style={{ fontSize:11, color:TERTIARY, marginBottom:10 }}>Applied to every newly generated ad. You can still adjust any single ad on the Ad approvals tab.</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, maxWidth:480 }}>
          <div>
            <div style={{ fontSize:11, color:TERTIARY, marginBottom:3 }}>Position</div>
            <select value={(ov&&ov.logo_position)||'bottom-right'} onChange={e=>saveSetup({ logo_position:e.target.value })} style={fieldStyle}>
              {LOGO_POSITIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize:11, color:TERTIARY, marginBottom:3 }}>Size</div>
            <select value={(ov&&ov.logo_size)||'small'} onChange={e=>saveSetup({ logo_size:e.target.value })} style={fieldStyle}>
              {LOGO_SIZES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize:11, color:TERTIARY, marginBottom:3 }}>Background</div>
            <select value={(ov&&ov.logo_panel)||'white'} onChange={e=>saveSetup({ logo_panel:e.target.value })} style={fieldStyle}>
              {LOGO_PANELS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Brand block */}
      <div style={{ ...cardStyle, marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontSize:12, fontWeight:500, color:MUTED }}>Brand kit (from the Facebook RAG)</div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {extractMsg && <span style={{ fontSize:11, color: extractMsg.startsWith('✓')?GREEN_HI:MUTED }}>{extractMsg}</span>}
            <button onClick={pullBrand} disabled={!hasRag || extracting} style={btn('#fff', hasRag?GREEN_HI:'#aaa', { border:`1px solid ${hasRag?GREEN:'#d0d0cc'}`, cursor:(!hasRag||extracting)?'not-allowed':'pointer' })}>{extracting?'Pulling…':'Pull brand from RAG'}</button>
          </div>
        </div>
        <div style={{ fontSize:11, color:TERTIARY, marginBottom:10 }}>Pulled automatically when you upload a RAG. Edit any field by hand; it feeds every generated image.</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <div style={{ fontSize:11, color:TERTIARY, marginBottom:3 }}>Brand colours</div>
            <textarea rows={2} value={brand.brand_colors} placeholder="graphite #1a1a1a background, vivid green #77A734 accent, white text" onChange={e=>onBrandChange('brand_colors', e.target.value)} style={{ ...fieldStyle, resize:'vertical' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:TERTIARY, marginBottom:3 }}>Typography style</div>
            <input value={brand.type_style} placeholder="bold condensed all-caps headlines, clean sans body" onChange={e=>onBrandChange('type_style', e.target.value)} style={fieldStyle} />
          </div>
          <div>
            <div style={{ fontSize:11, color:TERTIARY, marginBottom:3 }}>Logo description</div>
            <textarea rows={2} value={brand.logo_description} placeholder="green circular emblem with RGS in white letters" onChange={e=>onBrandChange('logo_description', e.target.value)} style={{ ...fieldStyle, resize:'vertical' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:TERTIARY, marginBottom:3 }}>Visual style &amp; what to avoid</div>
            <textarea rows={2} value={brand.visual_style} placeholder="dark canvas, fleet/job-site hero, green CTA. Avoid white/pastel backgrounds." onChange={e=>onBrandChange('visual_style', e.target.value)} style={{ ...fieldStyle, resize:'vertical' }} />
          </div>
        </div>
      </div>
      </>)}

      {/* ── AD APPROVALS VIEW ───────────────────────────────────────────── */}
      {view!=='setup' && (<>

      {/* Generate */}
      <div style={{ ...cardStyle, marginBottom:14, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ fontSize:12, fontWeight:500, color:MUTED }}>Generate ads</div>
        <span style={{ fontSize:12, color:TERTIARY }}>How many:</span>
        <select value={count} onChange={e=>setCountAndSave(parseInt(e.target.value,10))} style={{ fontSize:12, padding:'5px 8px', border:`1px solid ${BORDER}`, borderRadius:6, background:'#fff', color:TEXT }}>
          {AD_COUNTS.map(n=><option key={n} value={n}>{n}</option>)}
        </select>
        <span style={{ fontSize:11, padding:'3px 8px', borderRadius:999, background:BLUE_BG, color:BLUE }}>Leads</span>
        <span style={{ flex:1 }} />
        <button onClick={generate} disabled={generating || !hasRag} style={btn(hasRag?GREEN_HI:'#ccc','#fff', { padding:'8px 18px', cursor:(generating||!hasRag)?'not-allowed':'pointer', ...(generating?{opacity:0.7}:{}) })}>
          {generating ? 'Generating…' : 'Generate ads from RAG'}
        </button>
        {!hasRag && <div style={{ fontSize:11, color:RED, width:'100%' }}>Upload a Facebook RAG in the Setup tab to start.</div>}
        {generating && <div style={{ fontSize:11, color:TERTIARY, width:'100%' }}>Writing copy and designing images — this can take a minute.</div>}
      </div>

      {/* Generated ads */}
      {creatives.length > 0 && <div style={{ fontSize:13, color:MUTED, margin:'4px 0 10px' }}>{creatives.length} {creatives.length===1?'ad':'ads'} · {approvedCount} approved</div>}
      {creatives.length === 0 && (
        <div style={{ ...cardStyle, color:MUTED, fontSize:13 }}>{hasRag ? 'No ads yet — choose how many and click “Generate ads from RAG”.' : 'Upload a Facebook RAG in the Setup tab to start generating ads.'}</div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:16 }}>
        {creatives.map(c => {
          const isBusy = busyId===c.id;
          const logoEnabled = !!c.pre_logo_image_url;
          const isEditing = editId===c.id;
          const approved = c.status==='approved';
          const pushed = c.status==='pushed';
          const pos = c.logo_position || (ov && ov.logo_position) || 'bottom-right';
          const size = c.logo_size || (ov && ov.logo_size) || 'small';
          const panel = c.logo_panel || (ov && ov.logo_panel) || 'white';
          return (
            <div key={c.id} style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:10, overflow:'hidden', display:'flex', flexDirection:'column' }}>
              <div style={{ position:'relative' }}>
                {c.image_url
                  ? <img src={c.image_url} alt="" style={{ width:'100%', height:'auto', maxHeight:340, objectFit:'contain', background:'#f5f5f3', display:'block' }} onError={e=>{e.target.style.display='none';}} />
                  : <div style={{ height:120, background:'#f5f5f3', display:'flex', alignItems:'center', justifyContent:'center' }}><span style={{ fontSize:11, color:'#bbb' }}>No image generated</span></div>}
                {isBusy && (busyKind==='regenerate-image') && (
                  <div style={{ position:'absolute', inset:0, background:'rgba(255,255,255,0.80)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <span style={{ fontSize:12, color:GREEN_HI }}>Designing image…</span>
                  </div>
                )}
              </div>

              <div style={{ padding:'12px 14px', flex:1, display:'flex', flexDirection:'column' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
                  <span style={{ fontSize:11, padding:'2px 8px', borderRadius:6, background:GREY_BG, color:GREY, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.hook_label || 'Ad'}</span>
                  <span style={{ fontSize:11, padding:'3px 8px', borderRadius:6, flex:'none', background: pushed?BLUE_BG:(approved?GREEN_BG:GREY_BG), color: pushed?BLUE:(approved?GREEN_HI:GREY) }}>{pushed?'Pushed · paused':(approved?'Approved':'Draft')}</span>
                </div>

                {isEditing ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, flex:1 }}>
                    <input value={editDraft.headline} onChange={e=>setEditDraft(d=>({...d, headline:e.target.value}))} placeholder="Headline" style={{ ...fieldStyle, fontWeight:600 }} />
                    <textarea value={editDraft.primary_text} onChange={e=>setEditDraft(d=>({...d, primary_text:e.target.value}))} placeholder="Primary text" rows={5} style={{ ...fieldStyle, resize:'vertical', flex:1 }} />
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={()=>saveEdit(c.id)} disabled={isBusy} style={btn(GREEN_HI,'#fff',{ flex:1 })}>{isBusy&&busyKind==='save'?'Saving…':'✓ Save'}</button>
                      <button onClick={()=>setEditId(null)} style={btn(GREY_BG,GREY,{ border:`1px solid ${BORDER}` })}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize:14, fontWeight:600, color:TEXT, marginBottom:4 }}>{c.headline || '—'}</div>
                    <div style={{ fontSize:12, color:MUTED, lineHeight:1.5, whiteSpace:'pre-wrap', flex:1 }}>{c.primary_text || ''}</div>

                    {pushed ? (
                      <div style={{ marginTop:10, borderTop:'1px solid #f0f0ec', paddingTop:10, fontSize:11, color:BLUE }}>
                        On Facebook as a paused draft. Finish in Ads Manager.{c.fb_ad_id ? ` · ad ${c.fb_ad_id}` : ''}
                      </div>
                    ) : (
                    <>
                    {c.push_error && (
                      <div style={{ marginTop:10, fontSize:11, color:RED, background:RED_BG, borderRadius:6, padding:'6px 8px' }}>
                        Last push failed — {c.push_error}
                      </div>
                    )}

                    {/* Logo controls */}
                    <div style={{ marginTop:10 }}>
                      <div style={{ fontSize:10, color:TERTIARY, marginBottom:4, fontWeight:500 }}>LOGO ON THIS IMAGE</div>
                      {logoEnabled ? (
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
                          <div>
                            <div style={{ fontSize:10, color:'#999', marginBottom:3 }}>Position</div>
                            <select value={pos} disabled={isBusy} onChange={e=>creativeAction(c.id,'recomposite-logo','recomposite-logo',{ logo_position:e.target.value })} style={{ ...ctrl, cursor:isBusy?'not-allowed':'pointer' }}>
                              {LOGO_POSITIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize:10, color:'#999', marginBottom:3 }}>Size</div>
                            <select value={size} disabled={isBusy} onChange={e=>creativeAction(c.id,'recomposite-logo','recomposite-logo',{ logo_size:e.target.value })} style={{ ...ctrl, cursor:isBusy?'not-allowed':'pointer' }}>
                              {LOGO_SIZES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize:10, color:'#999', marginBottom:3 }}>Background</div>
                            <select value={panel} disabled={isBusy} onChange={e=>creativeAction(c.id,'recomposite-logo','recomposite-logo',{ logo_panel:e.target.value })} style={{ ...ctrl, cursor:isBusy?'not-allowed':'pointer' }}>
                              {LOGO_PANELS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize:11, color:TERTIARY, fontStyle:'italic' }}>Click <span style={{ fontWeight:500, fontStyle:'normal' }}>New image</span> to enable these controls.</div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display:'flex', gap:6, marginTop:10, borderTop:'1px solid #f0f0ec', paddingTop:10 }}>
                      <button onClick={()=>startEdit(c)} disabled={isBusy} style={{ flex:1, fontSize:11, padding:'5px 0', background:'#f5f5f3', border:'1px solid #ddd', borderRadius:6, cursor:isBusy?'not-allowed':'pointer', color:'#333' }}>✏️ Edit text</button>
                      <button onClick={()=>creativeAction(c.id,'regenerate-text','regenerate-text')} disabled={isBusy} style={{ flex:1, fontSize:11, padding:'5px 0', background:'#f5f5f3', border:'1px solid #ddd', borderRadius:6, cursor:isBusy?'not-allowed':'pointer', color:'#333' }}>{isBusy&&busyKind==='regenerate-text'?'Writing…':'🔄 Rewrite'}</button>
                      <button onClick={()=>creativeAction(c.id,'regenerate-image','regenerate-image')} disabled={isBusy} style={{ flex:1, fontSize:11, padding:'5px 0', background:'#f5f5f3', border:'1px solid #ddd', borderRadius:6, cursor:isBusy?'not-allowed':'pointer', color:'#333' }}>{isBusy&&busyKind==='regenerate-image'?'Imaging…':'🖼️ New image'}</button>
                    </div>
                    <button onClick={()=>creativeAction(c.id,'approve','approve',{ approved: !approved })} disabled={isBusy} style={btn(approved?GREY_BG:GREEN_HI, approved?GREY:'#fff', { marginTop:6, width:'100%', border: approved?`1px solid ${BORDER}`:'none' })}>
                      {approved ? '✓ Approved — click to unapprove' : 'Approve'}
                    </button>
                    </>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── PUSH TO FACEBOOK ──────────────────────────────────────────────── */}
      {creatives.length > 0 && (() => {
        const canPush = !!(ov && ov.page_id && ov.lead_form_id && Number(ov.daily_budget_pence) > 0 && ov.website_url && approvedCount > 0 && !pushing);
        const pushedCount = creatives.filter(c=>c.status==='pushed').length;
        const COUNTRIES = [ ['GB','United Kingdom'], ['IE','Ireland'], ['US','United States'] ];
        const country = (ov && ov.target_countries) || 'GB';
        const pageVal = pagePick.pages.find(p=>p.id===(ov&&ov.page_id)) ? ov.page_id : '';
        const formVal = formPick.forms.find(f=>f.id===(ov&&ov.lead_form_id)) ? ov.lead_form_id : '';
        return (
          <div style={{ ...cardStyle, marginTop:18 }}>
            <div style={{ fontSize:14, fontWeight:600, color:TEXT, marginBottom:2 }}>Push to Facebook</div>
            <div style={{ fontSize:12, color:MUTED, marginBottom:14 }}>Creates one Leads campaign with all approved ads inside it. Everything lands <strong>paused</strong> — you publish in Ads Manager.</div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              {/* Facebook Page */}
              <div>
                <div style={{ fontSize:11, color:TERTIARY, marginBottom:4 }}>Facebook Page</div>
                {manualPage ? (
                  <div style={{ display:'flex', gap:6 }}>
                    <input value={mPage} onChange={e=>setMPage(e.target.value)} placeholder="Page ID" style={fieldStyle} />
                    <button onClick={()=>onManualPageInput(mPage.trim())} style={btn(GREEN_HI,'#fff')}>Save</button>
                    <button onClick={()=>setManualPage(false)} style={btn('#fff',MUTED,{border:`1px solid ${BORDER}`})}>×</button>
                  </div>
                ) : (
                  <select value={pageVal} onChange={e=>{ const p=pagePick.pages.find(x=>x.id===e.target.value); if(p) onPickPage(p.id,p.name); }} style={fieldStyle}>
                    <option value="">{pagePick.loading?'Loading Pages…':(pagePick.pages.length?'Choose a Page…':'No Pages found')}</option>
                    {pagePick.pages.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:5 }}>
                  <span style={{ fontSize:10, color:(ov&&ov.page_id)?GREEN_HI:RED }}>{ov && ov.page_id ? `Set: ${ov.page_name || ov.page_id}` : 'Required'}</span>
                  <span style={{ flex:1 }} />
                  <button onClick={()=>{ setManualPage(m=>!m); setMPage((ov&&ov.page_id)||''); }} style={{ fontSize:10, padding:'3px 9px', border:`1px solid ${BORDER}`, borderRadius:5, background:'#fff', color:BLUE, cursor:'pointer' }}>{manualPage?'↩ Pick from list':'⌨ Enter ID manually'}</button>
                </div>
                {pagePick.error && !manualPage && <div style={{ fontSize:10, color:AMBER, marginTop:3 }}>{pagePick.error} — enter the ID manually.</div>}
                {!manualPage && pagePick.ok && pagePick.pages.length===0 && <div style={{ fontSize:10, color:TERTIARY, marginTop:3 }}>No Pages visible to Studio yet — use “Enter ID manually”.</div>}
              </div>

              {/* Lead form */}
              <div>
                <div style={{ fontSize:11, color:TERTIARY, marginBottom:4 }}>Lead form</div>
                {manualForm ? (
                  <div style={{ display:'flex', gap:6 }}>
                    <input value={mForm} onChange={e=>setMForm(e.target.value)} placeholder="Lead form ID" style={fieldStyle} />
                    <button onClick={()=>saveSetup({ lead_form_id:mForm.trim()||null, lead_form_name:null })} style={btn(GREEN_HI,'#fff')}>Save</button>
                    <button onClick={()=>setManualForm(false)} style={btn('#fff',MUTED,{border:`1px solid ${BORDER}`})}>×</button>
                  </div>
                ) : (
                  <select value={formVal} disabled={!(ov&&ov.page_id)} onChange={e=>{ const f=formPick.forms.find(x=>x.id===e.target.value); if(f) saveSetup({ lead_form_id:f.id, lead_form_name:f.name }); }} style={{ ...fieldStyle, ...(!(ov&&ov.page_id)?{background:'#f5f5f3',color:'#aaa'}:{}) }}>
                    <option value="">{!(ov&&ov.page_id)?'Choose a Page first':(formPick.loading?'Loading forms…':(formPick.forms.length?'Choose a form…':'No forms found'))}</option>
                    {formPick.forms.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                )}
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:5 }}>
                  <span style={{ fontSize:10, color:(ov&&ov.lead_form_id)?GREEN_HI:RED }}>{ov && ov.lead_form_id ? `Set: ${ov.lead_form_name || ov.lead_form_id}` : 'Required'}</span>
                  <span style={{ flex:1 }} />
                  <button onClick={()=>{ setManualForm(m=>!m); setMForm((ov&&ov.lead_form_id)||''); }} style={{ fontSize:10, padding:'3px 9px', border:`1px solid ${BORDER}`, borderRadius:5, background:'#fff', color:BLUE, cursor:'pointer' }}>{manualForm?'↩ Pick from list':'⌨ Enter ID manually'}</button>
                </div>
                {formPick.ok && !manualForm && (ov&&ov.page_id) && formPick.forms.length===0 && <div style={{ fontSize:10, color:AMBER, marginTop:3 }}>No forms came back for this Page — enter the form ID manually.</div>}
              </div>

              {/* Daily budget */}
              <div>
                <div style={{ fontSize:11, color:TERTIARY, marginBottom:4 }}>Daily budget (paused)</div>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:13, color:MUTED }}>£</span>
                  <input value={budget} onChange={e=>onBudgetChange(e.target.value)} placeholder="10.00" inputMode="decimal" style={fieldStyle} />
                </div>
                <div style={{ fontSize:10, color: (Number(ov&&ov.daily_budget_pence)>0)?TERTIARY:RED, marginTop:3 }}>
                  {Number(ov&&ov.daily_budget_pence)>0 ? 'Per day. Won’t spend while paused.' : 'Required — set a daily budget.'}
                </div>
              </div>

              {/* Target location */}
              <div>
                <div style={{ fontSize:11, color:TERTIARY, marginBottom:4 }}>Target location</div>
                <select value={country} onChange={e=>saveSetup({ target_countries:e.target.value })} style={fieldStyle}>
                  {COUNTRIES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
                <div style={{ fontSize:10, color:TERTIARY, marginTop:3 }}>Broad targeting — location + age 18–65.</div>
              </div>
            </div>

            {/* Website URL — Meta requires lead ads to link to the advertiser's
                own site, not a Facebook page. Required; no silent default. */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:TERTIARY, marginBottom:4 }}>Website URL</div>
              <input value={website} onChange={e=>onWebsiteChange(e.target.value)} placeholder="regangroupservices.co.uk" style={fieldStyle} />
              <div style={{ fontSize:10, color:(ov&&ov.website_url)?TERTIARY:RED, marginTop:3 }}>
                {(ov&&ov.website_url)
                  ? 'Where the ad’s button links. Meta requires a real website here.'
                  : 'Required — Meta rejects lead ads that link to a Facebook page.'}
              </div>
            </div>

            <div style={{ display:'flex', gap:8, fontSize:12, color:AMBER, background:AMBER_BG, borderRadius:6, padding:'9px 11px', marginBottom:14 }}>
              <span>⏸</span><span>Everything is created <strong>paused</strong>. No spend and nothing live until you activate it yourself in Ads Manager.</span>
            </div>

            <button onClick={doPush} disabled={!canPush} style={btn(canPush?BLUE:'#ccc','#fff',{ width:'100%', padding:'10px 0', fontSize:14, cursor:canPush?'pointer':'not-allowed' })}>
              {pushing ? 'Pushing to Facebook…' : `Push ${approvedCount} approved ad${approvedCount===1?'':'s'} to Facebook (paused)`}
            </button>
            <div style={{ fontSize:11, color:TERTIARY, textAlign:'center', marginTop:8 }}>
              {creatives.length} generated · {approvedCount} approved {approvedCount>0?'(ready)':''} · {pushedCount} already pushed
            </div>

            {pushResult && (
              <div style={{ marginTop:16, borderTop:`1px solid ${BORDER}`, paddingTop:14 }}>
                {pushResult.top_error ? (
                  <div style={{ ...cardStyle, background:RED_BG, border:`1px solid ${RED}`, color:RED, fontSize:13 }}>
                    Couldn’t create the campaign — {pushResult.top_error}
                  </div>
                ) : (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:TEXT }}>Push result</span>
                      <span style={{ fontSize:12, padding:'3px 9px', borderRadius:6, background: pushResult.failed?AMBER_BG:GREEN_BG, color: pushResult.failed?AMBER:GREEN_HI }}>{pushResult.pushed} pushed{pushResult.failed?` · ${pushResult.failed} failed`:''}</span>
                    </div>
                    <div style={{ fontSize:12, color:MUTED, marginBottom:10 }}>Campaign “{pushResult.campaign_name}” created paused in Ads Manager. Finish there.</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {(pushResult.results||[]).map(r=>(
                        <div key={r.id} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'8px 10px', border:`1px solid ${r.ok?BORDER:RED}`, borderRadius:6, background:r.ok?'#fff':RED_BG }}>
                          <span style={{ flex:'none' }}>{r.ok?'✅':'⚠️'}</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:12, color: r.ok?TEXT:RED }}>{r.label}</div>
                            {r.ok
                              ? <div style={{ fontSize:11, color:TERTIARY }}>Pushed · paused · ad {r.ad_id}</div>
                              : <div style={{ fontSize:11, color:RED }}>Failed at {r.error}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })()}
      </>)}
    </div>
  );
}
