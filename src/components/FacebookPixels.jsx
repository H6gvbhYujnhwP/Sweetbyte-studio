// ─────────────────────────────────────────────────────────────────────────────
// FacebookPixels.jsx — Admin screen for managing per-customer Meta Pixel setup.
//
// Mounted by Dashboard.jsx when activeView === 'facebook-pixels'.
//
// Layout, top to bottom:
//   - Page heading "Facebook pixels" + "Add pixel customer" button.
//   - Summary cards (total / active / in setup / not started).
//   - Roster: one row per pixel customer (name, goal, status). Click a row to
//     open its setup panel inline below.
//   - Setup panel: editable Meta details, a setup checklist, a status control,
//     a "Remove from list" action, and a Phase-2 placeholder for the live
//     campaign numbers (pulled from Meta once the account is out of review).
//
// Endpoints under /api/facebook-pixels/* — behind the standard admin
// Bearer-token middleware (handled by the app's fetch interceptor, so plain
// fetch() works here). Live performance numbers are NOT shown yet — Phase B.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import { SB } from '../brand.js';

const GREEN=SB.primary, GREEN_HI=SB.strong, GREEN_BG=SB.tint;
const TEXT='#1a1a1a', MUTED='#666', TERTIARY='#999', BORDER='#e0e0dc', BG='#f5f5f3', CARD='#ffffff';
const BLUE='#185FA5', BLUE_BG='#E6F1FB';
const AMBER='#854F0B', AMBER_BG='#FAEEDA';
const GREY='#5F5E5A', GREY_BG='#F1EFE8';
const RED='#A32D2D';

const GOAL_LABELS = { leads: 'Leads', sales: 'Sales' };
const STATUS_META = {
  not_started: { label: 'Not started', fg: GREY,     bg: GREY_BG  },
  in_setup:    { label: 'In setup',    fg: AMBER,    bg: AMBER_BG },
  active:      { label: 'Active',      fg: GREEN_HI, bg: GREEN_BG },
};
const STATUS_ORDER = ['not_started', 'in_setup', 'active'];
const CHECKLIST = [
  ['pixel_created',     'Pixel created'],
  ['pixel_installed',   'Pixel installed'],
  ['conversions_api',   'Conversions API'],
  ['domain_verified',   'Domain verified'],
  ['lead_event',        'Lead event live'],
  ['audiences',         'Audiences'],
  ['testing_campaign',  'Testing campaign'],
  ['scaling_campaign',  'Scaling campaign'],
];

function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]).join('').toUpperCase();
}

function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.not_started;
  return (
    <span style={{ background:m.bg, color:m.fg, fontSize:12, fontWeight:500, padding:'3px 10px', borderRadius:8, whiteSpace:'nowrap' }}>
      {m.label}
    </span>
  );
}

export default function FacebookPixels() {
  const [list, setList]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [available, setAvailable] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd]     = useState(false);
  const [saving, setSaving]       = useState(false);

  async function loadList() {
    setLoading(true);
    try { const r = await fetch('/api/facebook-pixels'); if (r.ok) setList(await r.json()); }
    catch (e) { console.error('[fb-pixels] loadList', e); }
    setLoading(false);
  }
  async function loadAvailable() {
    try { const r = await fetch('/api/facebook-pixels/available-customers'); if (r.ok) setAvailable(await r.json()); }
    catch (e) { console.error('[fb-pixels] loadAvailable', e); }
  }
  useEffect(() => { loadList(); loadAvailable(); }, []);

  const selected = list.find(p => p.id === selectedId) || null;

  async function patch(id, body) {
    setSaving(true);
    try {
      const r = await fetch(`/api/facebook-pixels/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (r.ok) { const updated = await r.json(); setList(prev => prev.map(p => p.id === id ? updated : p)); }
    } catch (e) { console.error('[fb-pixels] patch', e); }
    setSaving(false);
  }

  async function addCustomer(form) {
    try {
      const r = await fetch('/api/facebook-pixels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      if (r.ok) { const row = await r.json(); setShowAdd(false); await loadList(); await loadAvailable(); setSelectedId(row.id); }
      else { const e = await r.json().catch(() => ({})); alert(e.error || 'Could not add pixel customer'); }
    } catch (e) { console.error('[fb-pixels] add', e); }
  }

  async function removeCustomer(id) {
    if (!window.confirm('Remove this pixel customer? Their setup record and the portal service are removed. The customer record itself is kept.')) return;
    try { const r = await fetch(`/api/facebook-pixels/${id}`, { method: 'DELETE' }); if (r.ok) { setSelectedId(null); await loadList(); await loadAvailable(); } }
    catch (e) { console.error('[fb-pixels] remove', e); }
  }

  const counts = {
    total: list.length,
    active: list.filter(p => p.status === 'active').length,
    in_setup: list.filter(p => p.status === 'in_setup').length,
    not_started: list.filter(p => p.status === 'not_started').length,
  };

  const cardStyle = { background:CARD, border:`1px solid ${BORDER}`, borderRadius:10, padding:'14px 16px' };
  const fieldLab = { fontSize:12, color:TERTIARY, marginBottom:3, display:'block' };
  const fieldInput = { width:'100%', boxSizing:'border-box', padding:'7px 9px', border:`1px solid ${BORDER}`, borderRadius:6, fontSize:13, color:TEXT, background:'#fff' };

  return (
    <div style={{ flex:1, overflow:'auto', padding:28, background:BG }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <h1 style={{ fontSize:20, fontWeight:500, color:TEXT, margin:0 }}>Meta Pixels</h1>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {saving && <span style={{ fontSize:12, color:TERTIARY }}>Saving…</span>}
          <button onClick={()=>setShowAdd(true)} style={{ background:GREEN_HI, color:'#fff', border:'none', borderRadius:6, padding:'8px 14px', fontSize:13, fontWeight:500, cursor:'pointer' }}>
            + Add pixel customer
          </button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:20 }}>
        <div style={{ ...cardStyle, background:'#fff' }}><div style={{ fontSize:13, color:MUTED }}>Pixel customers</div><div style={{ fontSize:24, fontWeight:500, color:TEXT }}>{counts.total}</div></div>
        <div style={cardStyle}><div style={{ fontSize:13, color:MUTED }}>Active</div><div style={{ fontSize:24, fontWeight:500, color:GREEN_HI }}>{counts.active}</div></div>
        <div style={cardStyle}><div style={{ fontSize:13, color:MUTED }}>In setup</div><div style={{ fontSize:24, fontWeight:500, color:AMBER }}>{counts.in_setup}</div></div>
        <div style={cardStyle}><div style={{ fontSize:13, color:MUTED }}>Not started</div><div style={{ fontSize:24, fontWeight:500, color:GREY }}>{counts.not_started}</div></div>
      </div>

      {loading ? (
        <div style={{ color:MUTED, fontSize:14 }}>Loading…</div>
      ) : list.length === 0 ? (
        <div style={{ ...cardStyle, color:MUTED, fontSize:14 }}>No pixel customers yet. Click “Add pixel customer” to set one up.</div>
      ) : (
        <div>
          {list.map(p => {
            const isSel = p.id === selectedId;
            return (
              <div key={p.id}
                onClick={() => setSelectedId(isSel ? null : p.id)}
                style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'12px 14px',
                         border:`${isSel?2:1}px solid ${isSel?BLUE:BORDER}`, borderRadius:8, background:CARD, marginBottom:8, cursor:'pointer' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:30, height:30, borderRadius:6, background:BLUE_BG, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:500, color:BLUE }}>{initials(p.customer_name)}</div>
                  <div>
                    <div style={{ fontSize:14, fontWeight:500, color:TEXT }}>{p.customer_name}</div>
                    <div style={{ fontSize:12, color:TERTIARY }}>{GOAL_LABELS[p.goal] || p.goal}{p.domain ? ` · ${p.domain}` : ''}</div>
                  </div>
                </div>
                <StatusPill status={p.status} />
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div style={{ ...cardStyle, marginTop:16, borderRadius:12 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <span style={{ fontSize:16, fontWeight:500, color:TEXT }}>{selected.customer_name} — setup</span>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <select value={selected.status} onChange={e=>patch(selected.id,{status:e.target.value})}
                style={{ ...fieldInput, width:'auto', padding:'6px 9px' }}>
                {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
              <button onClick={()=>removeCustomer(selected.id)} style={{ background:'#fff', color:RED, border:`1px solid ${RED}`, borderRadius:6, padding:'6px 12px', fontSize:13, fontWeight:500, cursor:'pointer' }}>
                Remove from list
              </button>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12, marginBottom:18 }}>
            <div><label style={fieldLab}>Pixel ID</label><PixelPicker value={selected.pixel_id||''} onChange={(id,name)=>patch(selected.id, (name && !selected.pixel_name) ? {pixel_id:id, pixel_name:name} : {pixel_id:id})} style={fieldInput} /></div>
            <div><label style={fieldLab}>Pixel name</label><input style={fieldInput} defaultValue={selected.pixel_name||''} onBlur={e=>patch(selected.id,{pixel_name:e.target.value})} /></div>
            <div><label style={fieldLab}>Website domain</label><input style={fieldInput} defaultValue={selected.domain||''} onBlur={e=>patch(selected.id,{domain:e.target.value})} /></div>
            <div><label style={fieldLab}>Facebook page</label><input style={fieldInput} defaultValue={selected.facebook_page||''} onBlur={e=>patch(selected.id,{facebook_page:e.target.value})} /></div>
          </div>

          <PixelLiveTracking key={selected.id} recordId={selected.id} />
        </div>
      )}

      {showAdd && <AddPixelModal available={available} onAdd={addCustomer} onClose={()=>setShowAdd(false)} />}
    </div>
  );
}

function AddPixelModal({ available, onAdd, onClose }) {
  const [f, setF] = useState({ email_client_id:'', goal:'leads', business_id:'', ad_account_id:'', pixel_id:'', pixel_name:'', domain:'', facebook_page:'', conversion_event:'' });
  const set = (k,v) => setF(prev => ({ ...prev, [k]:v }));
  const lab = { fontSize:12, color:'#999', marginBottom:3, display:'block' };
  const inp = { width:'100%', boxSizing:'border-box', padding:'7px 9px', border:'1px solid #e0e0dc', borderRadius:6, fontSize:13, color:'#1a1a1a', background:'#fff' };

  function submit() {
    if (!f.email_client_id) { alert('Pick a customer first'); return; }
    onAdd(f);
  }

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:12, padding:24, width:560, maxWidth:'92vw', maxHeight:'88vh', overflow:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <span style={{ fontSize:17, fontWeight:500, color:'#1a1a1a' }}>Add pixel customer</span>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, color:'#999', cursor:'pointer', lineHeight:1 }}>×</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div style={{ gridColumn:'1 / -1' }}><label style={lab}>Customer</label>
            <select style={inp} value={f.email_client_id} onChange={e=>set('email_client_id', e.target.value)}>
              <option value="">Select existing customer…</option>
              {available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label style={lab}>Website domain</label><input style={inp} value={f.domain} onChange={e=>set('domain', e.target.value)} placeholder="wedoyourquotes.com" /></div>
          <div><label style={lab}>Pixel ID</label><PixelPicker value={f.pixel_id} onChange={(id,name)=>{ set('pixel_id', id); if (name && !f.pixel_name) set('pixel_name', name); }} style={inp} /></div>
          <div><label style={lab}>Pixel name</label><input style={inp} value={f.pixel_name} onChange={e=>set('pixel_name', e.target.value)} placeholder="Client — Main Pixel" /></div>
          <div><label style={lab}>Facebook page</label><input style={inp} value={f.facebook_page} onChange={e=>set('facebook_page', e.target.value)} /></div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ background:'#fff', color:'#666', border:'1px solid #e0e0dc', borderRadius:6, padding:'8px 16px', fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={submit} style={{ background:SB.strong, color:'#fff', border:'none', borderRadius:6, padding:'8px 16px', fontSize:13, fontWeight:500, cursor:'pointer' }}>Add customer</button>
        </div>
      </div>
    </div>
  );
}

// ── LIVE TRACKING (read-only pixel activity, Option A) ───────────────────────
// Anonymous aggregate event counts pulled live from the customer's Meta Pixel —
// no personal or contact data (Meta doesn't expose that through the pixel).
// Self-contained: owns its window toggle + fetch. Remounted (via key) when the
// selected customer changes, so it always reflects the open pixel.
const PIXEL_WINDOWS = [ {key:'7d',label:'7 days'}, {key:'30d',label:'30 days'}, {key:'lifetime',label:'Lifetime'} ];

function timeAgo(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);   if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);   if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);   if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  return `${Math.floor(mo / 12)} year${Math.floor(mo / 12) === 1 ? '' : 's'} ago`;
}

const PIXEL_STATUS = {
  active:  { label: 'Active',  fg: GREEN_HI, dot: GREEN_HI },
  quiet:   { label: 'Quiet',   fg: AMBER,    dot: AMBER },
  no_data: { label: 'No data', fg: GREY,     dot: TERTIARY },
};

// Short date label for the chart axis: '2026-06-09' → '9 Jun'.
function fmtShortDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}`;
}

// Dependency-free daily-activity bar chart. series = [{date, count}] sorted asc.
// Renders nothing meaningful until there's some history, in which case it shows
// a tidy note instead of an empty box.
function PixelBarChart({ series }) {
  const pts = Array.isArray(series) ? series : [];
  const max = pts.reduce((m, p) => Math.max(m, Number(p.count) || 0), 0);
  if (pts.length === 0 || max === 0) {
    return <div style={{ fontSize:12, color:TERTIARY, padding:'8px 0' }}>Not enough history to chart yet — it&rsquo;ll build up as activity comes in.</div>;
  }
  const W = 600, H = 90, base = 82, top = 8;
  const slot = W / pts.length;
  const barW = Math.max(1, slot * 0.6);
  return (
    <div>
      <svg width="100%" height="90" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display:'block' }}>
        <line x1="0" y1={base} x2={W} y2={base} stroke={BORDER} strokeWidth="1" />
        {pts.map((p, i) => {
          const h = ((Number(p.count) || 0) / max) * (base - top);
          return <rect key={p.date} x={i * slot + (slot - barW) / 2} y={base - h} width={barW} height={h} fill={GREEN_HI} rx="1" />;
        })}
      </svg>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:TERTIARY, marginTop:4 }}>
        <span>{fmtShortDate(pts[0].date)}</span>
        <span>{fmtShortDate(pts[pts.length - 1].date)}</span>
      </div>
    </div>
  );
}

function PixelLiveTracking({ recordId }) {
  const [window, setWindow] = useState('30d');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/facebook-pixels/${recordId}/stats?window=${encodeURIComponent(window)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({ ok:false, error:'Could not reach Studio. Try again in a moment.' }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [recordId, window]);

  const box = { border:`1px solid ${BORDER}`, borderRadius:8, padding:14, background:'#fff' };
  const fmtNum = (n) => Number(n || 0).toLocaleString('en-GB');

  const header = (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:10, flexWrap:'wrap' }}>
      <span style={{ fontSize:13, fontWeight:500, color:TEXT }}>Live tracking</span>
      <div style={{ display:'inline-flex', border:`1px solid ${BORDER}`, borderRadius:6, overflow:'hidden' }}>
        {PIXEL_WINDOWS.map((w,i)=>(
          <button key={w.key} onClick={()=>setWindow(w.key)} style={{ padding:'5px 11px', fontSize:12, cursor:'pointer', border:'none', borderLeft:i===0?'none':`1px solid ${BORDER}`, background:window===w.key?GREEN_HI:'#fff', color:window===w.key?'#fff':MUTED, fontWeight:window===w.key?500:400 }}>{w.label}</button>
        ))}
      </div>
    </div>
  );

  if (loading) {
    return <div style={box}>{header}<div style={{ fontSize:12, color:TERTIARY }}>Loading live activity…</div></div>;
  }
  if (data && data.no_pixel) {
    return <div style={box}>{header}<div style={{ fontSize:12, color:TERTIARY }}>Add this customer&rsquo;s Pixel ID above to see live tracking.</div></div>;
  }
  if (!data || data.ok === false) {
    const msg = (data && data.error) || 'Could not load pixel activity from Meta.';
    return (
      <div style={box}>{header}
        <div style={{ fontSize:12, color:AMBER, background:AMBER_BG, borderRadius:6, padding:'8px 10px' }}>{msg}</div>
      </div>
    );
  }

  const st = PIXEL_STATUS[data.status] || PIXEL_STATUS.no_data;
  const events = Array.isArray(data.events) ? data.events : [];
  const last = timeAgo(data.pixel && data.pixel.last_fired_time);

  return (
    <div style={box}>
      {header}

      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background:st.dot, display:'inline-block' }} />
        <span style={{ fontSize:12, fontWeight:500, color:st.fg }}>{st.label}</span>
        {last && <span style={{ fontSize:12, color:TERTIARY }}>· last activity {last}</span>}
      </div>

      <div style={{ fontSize:12, color:MUTED, marginBottom:6 }}>Activity over time</div>
      <div style={{ marginBottom:16 }}><PixelBarChart series={data.series} /></div>

      <div style={{ fontSize:12, color:MUTED, marginBottom:6 }}>What your pixel is tracking</div>
      {events.length === 0 ? (
        <div style={{ fontSize:12, color:TERTIARY }}>No events fired in this window yet.</div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {events.map(e => (
            <div key={e.type} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:13, padding:'4px 0', borderBottom:`1px solid ${BG}` }}>
              <span style={{ color:TEXT }}>{e.label}</span>
              <span style={{ color:MUTED, fontWeight:500 }}>{fmtNum(e.count)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PIXEL PICKER ─────────────────────────────────────────────────────────────
// Lets the operator choose a Meta Pixel from the business (via the Graph API)
// instead of typing its ID. Falls back to a plain text input if the list is
// empty or Meta is unreachable, and always offers a "type manually" escape.
// Commits on select (dropdown) or on blur (manual typing) so the setup panel
// doesn't fire a save on every keystroke.
let _pixelListPromise = null;
function fetchPixelList() {
  if (!_pixelListPromise) {
    _pixelListPromise = fetch('/api/facebook-pixels/available-pixels')
      .then(r => r.json())
      .catch(() => ({ ok: false, pixels: [] }));
  }
  return _pixelListPromise;
}

function PixelPicker({ value, onChange, style }) {
  const [pixels, setPixels] = useState(null); // null = loading
  const [manual, setManual] = useState(false);
  const [text, setText]     = useState(value || '');

  useEffect(() => { setText(value || ''); }, [value]);

  useEffect(() => {
    let cancelled = false;
    fetchPixelList().then(d => {
      if (cancelled) return;
      const list = (d && Array.isArray(d.pixels)) ? d.pixels : [];
      setPixels(list);
      // A value already saved but not in the list (e.g. another business) →
      // start in manual mode so it stays visible/editable.
      if (value && !list.some(p => String(p.id) === String(value))) setManual(true);
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const linkBtn = { background:'none', border:'none', color:GREEN_HI, fontSize:11, cursor:'pointer', padding:'4px 0 0', display:'inline-block' };

  if (pixels === null) {
    return <input style={style} value={text} readOnly placeholder="Loading pixels…" />;
  }

  if (manual || pixels.length === 0) {
    return (
      <div>
        <input
          style={style} value={text}
          onChange={e => setText(e.target.value)}
          onBlur={() => { if (text !== (value || '')) onChange(text); }}
          placeholder="Pixel ID (digits only)"
        />
        {pixels.length > 0 && (
          <button type="button" onClick={() => setManual(false)} style={linkBtn}>↤ Pick from list</button>
        )}
      </div>
    );
  }

  const known = pixels.some(p => String(p.id) === String(value));
  return (
    <select
      style={style}
      value={known ? value : ''}
      onChange={e => {
        if (e.target.value === '__manual__') { setManual(true); return; }
        const p = pixels.find(x => String(x.id) === e.target.value);
        onChange(e.target.value, p ? p.name : undefined);
      }}>
      <option value="">Select a pixel…</option>
      {pixels.map(p => (
        <option key={p.id} value={p.id}>{p.name ? `${p.name} — ${p.id}` : p.id}</option>
      ))}
      <option value="__manual__">✏️ Type ID manually…</option>
    </select>
  );
}
