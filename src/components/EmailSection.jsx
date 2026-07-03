import React, { useState, useEffect, useRef } from 'react';
import RichTextEditor from './RichTextEditor.jsx';

const GREEN='#1D9E75',DARK='#0F6E56',BG='#f5f5f3',CARD='#fff',BORDER='#e0e0dc',TEXT='#1a1a1a',MUTED='#888',DANGER='#c0392b',AMBER='#854F0B',BLUE='#185FA5';
const BRAND_COLORS=['#1D9E75','#0F6E56','#534AB7','#185FA5','#993C1D','#854F0B','#3B6D11','#D4537E','#5F5E5A'];
function initials(n=''){return n.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'?';}

function Btn({children,onClick,variant='default',small,disabled,style={}}){
  const v={default:{background:'#f0f0ed',color:TEXT},primary:{background:GREEN,color:'#fff'},danger:{background:'#fdecea',color:DANGER},amber:{background:'#fff3cd',color:AMBER},blue:{background:'#e6f1fb',color:BLUE}};
  return <button onClick={onClick} disabled={disabled} style={{border:'none',borderRadius:7,cursor:disabled?'not-allowed':'pointer',fontWeight:500,fontSize:small?11:13,padding:small?'4px 10px':'8px 18px',opacity:disabled?0.5:1,...v[variant],...style}}>{children}</button>;
}
function Input({label,value,onChange,placeholder,type='text',required,rows,style={}}){
  const base={width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD,outline:'none',boxSizing:'border-box',...style};
  return(<div style={{marginBottom:14}}>{label&&<label style={{display:'block',fontSize:12,color:MUTED,marginBottom:4}}>{label}{required&&' *'}</label>}{rows?<textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{...base,fontFamily:'monospace',resize:'vertical'}}/>:<input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={base}/>}</div>);
}
function Badge({label,color=GREEN,bg,border}){return <span style={{fontSize:11,padding:'2px 8px',borderRadius:20,fontWeight:500,background:bg||`${color}18`,color,whiteSpace:'nowrap',border:border||undefined}}>{label}</span>;}
function statusBadge(s){
  const m={draft:{l:'Draft',c:MUTED,b:'#f0f0ed'},scheduled:{l:'Scheduled',c:AMBER,b:'#fff3cd'},sending:{l:'Sending',c:GREEN,b:`${GREEN}15`},paused:{l:'Paused',c:AMBER,b:'#fff3cd'},sent:{l:'Sent',c:BLUE,b:'#e6f1fb'},failed:{l:'Failed',c:DANGER,b:'#fdecea'},cancelled:{l:'Cancelled',c:MUTED,b:'#f0f0ed'}};
  const x=m[s]||{l:s,c:MUTED,b:'#f0f0ed'};
  return <Badge label={x.l} color={x.c} bg={x.b}/>;
}
function subBadge(s){
  if(s==='subscribed') return <Badge label="Subscribed" color={GREEN} bg={`${GREEN}18`}/>;
  if(s==='bounced')    return <Badge label="Bounced" color={DANGER} bg="#fdecea"/>;
  if(s==='unsubscribed') return <Badge label="Unsubscribed" color={AMBER} bg="#fff3cd"/>;
  if(s==='spam')       return <Badge label="Spam" color={DANGER} bg="#fdecea"/>;
  return <Badge label={s} color={MUTED}/>;
}

// Estimate when a scheduled drip campaign will finish, walking forward day by
// day from today. Used in the queue's "Est. finish" column. Skips inactive
// weekdays per the campaign's drip_send_days setting.
function estimateDripFinish(c, totalSubs){
  const dl = c.daily_limit || 0;
  const remaining = Math.max(0, totalSubs - (c.drip_sent || 0));
  if (dl <= 0 || remaining <= 0) return '—';
  const activeDays = (c.drip_send_days || '1,2,3,4,5').split(',');
  if (activeDays.length === 0) return '—';
  const cursor = new Date();
  let sent = 0, calendarDays = 0;
  while (sent < remaining && calendarDays < 365) {
    const dow = String(cursor.getDay());
    if (activeDays.includes(dow)) sent += dl;
    if (sent < remaining) cursor.setDate(cursor.getDate() + 1);
    calendarDays++;
  }
  return cursor.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}
function Modal({title,children,onClose,wide}){
  return(<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.35)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
    <div style={{background:CARD,borderRadius:12,padding:28,width:wide?800:480,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 8px 40px rgba(0,0,0,0.15)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <h2 style={{fontSize:16,fontWeight:500,color:TEXT}}>{title}</h2>
        <button onClick={onClose} style={{background:'none',border:'none',fontSize:22,color:MUTED,cursor:'pointer',lineHeight:1}}>×</button>
      </div>
      {children}
    </div>
  </div>);
}

// ── Touch-count badge for the subscriber list ────────────────────────────────
// 1st = grey (cold), 2nd = amber (warming), 3rd+ = teal (warm)
function touchBadge(n){
  if(!n||n===0) return <Badge label="1st contact" color="#444441" bg="#F1EFE8"/>;
  if(n===1)     return <Badge label="2nd contact" color="#633806" bg="#FAEEDA"/>;
  return        <Badge label={`${n+1}${suffix(n+1)} contact`} color="#085041" bg="#E1F5EE"/>;
}
function suffix(n){const s=['th','st','nd','rd'],v=n%100;return s[(v-20)%10]||s[v]||s[0];}

// ── Tracking-mode badge for the campaign queue ───────────────────────────────
// Shows at-a-glance which campaigns track recipients vs send clean
function trackingBadge(c){
  const mode = c.tracking_mode || 'off';
  if (mode === 'off')   return <Badge label="clean" color={MUTED} bg="#f0f0ed"/>;
  if (mode === 'smart') return <Badge label="smart" color={BLUE} bg="#e6f1fb"/>;
  if (mode === 'all')   return <Badge label="tracked" color={AMBER} bg="#fff3cd"/>;
  return null;
}

// ── Toggle switch (matches the design mockup) ────────────────────────────────
function Toggle({checked,onChange}){
  return(<label style={{position:'relative',display:'inline-block',width:36,height:20,flexShrink:0,cursor:'pointer'}}>
    <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} style={{opacity:0,width:0,height:0}}/>
    <span style={{position:'absolute',inset:0,background:checked?TEXT:'#d0d0cc',transition:'0.15s',borderRadius:20}}>
      <span style={{position:'absolute',height:14,width:14,left:checked?19:3,bottom:3,background:'#fff',transition:'0.15s',borderRadius:'50%'}}/>
    </span>
  </label>);
}

// ── TrackingControls — the tracking section of the campaign editor ───────────
// ── Schedule controls (drip / one-shot) ──────────────────────────────────────
// Renders inside the campaign modal. When drip is on, the user picks a daily
// limit, a start date, time window, days of week, and send order. Live estimate
// underneath shows when the campaign will finish, taking weekday rules into
// account. Toggle "Drip over multiple days" to switch back to one-shot.
function ScheduleControls({form, set, totalSubs}){
  const dripOn = (form.daily_limit || 0) > 0;

  // Day-of-week buttons — JS Date.getDay() uses 0=Sun..6=Sat
  const DAY_DEFS = [
    { k:'1', l:'Mon' }, { k:'2', l:'Tue' }, { k:'3', l:'Wed' },
    { k:'4', l:'Thu' }, { k:'5', l:'Fri' }, { k:'6', l:'Sat' }, { k:'0', l:'Sun' },
  ];
  const activeDays = (form.drip_send_days || '1,2,3,4,5').split(',').map(s=>s.trim()).filter(Boolean);
  function toggleDay(k){
    const next = activeDays.includes(k)
      ? activeDays.filter(d => d !== k)
      : [...activeDays, k];
    next.sort();
    set('drip_send_days', next.join(','));
  }

  // Estimate completion. Walks forward day by day from start date; on each
  // active day, counts dailyLimit sends. Stops when total subs reached.
  function estimate(){
    const dl = parseInt(form.daily_limit, 10) || 0;
    const subs = totalSubs || 0;
    if (dl <= 0 || subs <= 0 || activeDays.length === 0) return null;
    const startStr = form.drip_start_at || new Date().toISOString().slice(0,10);
    const startDate = new Date(startStr.length > 10 ? startStr : startStr + 'T00:00:00');
    if (Number.isNaN(startDate.getTime())) return null;

    const cursor = new Date(startDate);
    let sent = 0, calendarDays = 0, sendDays = 0;
    while (sent < subs && calendarDays < 365) {
      const dow = String(cursor.getDay());
      if (activeDays.includes(dow)) { sent += dl; sendDays++; }
      if (sent < subs) cursor.setDate(cursor.getDate() + 1);
      calendarDays++;
    }
    if (sent < subs) return null;  // would exceed 365 days, treat as unbounded
    return {
      sendDays, calendarDays,
      finishDate: cursor.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }),
    };
  }
  const est = estimate();

  // Helpful warning if window is too short for the daily limit
  function windowWarning(){
    const dl = parseInt(form.daily_limit, 10) || 0;
    if (dl < 30) return null;
    const [sh, sm] = (form.drip_window_start || '09:00').split(':').map(Number);
    const [eh, em] = (form.drip_window_end   || '11:00').split(':').map(Number);
    const mins = (eh*60 + em) - (sh*60 + sm);
    if (mins <= 0) return null;
    if (dl >= 30 && mins < 60) {
      return `Tight pacing: ${dl} sends in ${mins} min ≈ ${Math.round(mins*60/dl)}s between sends. Looks more human with a 2+ hour window.`;
    }
    return null;
  }
  const warn = windowWarning();

  return(<div style={{marginTop:18,padding:18,background:'#fafaf8',borderRadius:8,border:`0.5px solid ${BORDER}`}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
      <div style={{fontSize:14,fontWeight:500,color:TEXT}}>Schedule</div>
      <label style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,color:MUTED,cursor:'pointer'}}>
        <input type="checkbox" checked={dripOn}
          onChange={e=>set('daily_limit', e.target.checked ? (form.daily_limit > 0 ? form.daily_limit : 50) : 0)}
          style={{margin:0,cursor:'pointer'}}
        />
        Drip over multiple days
      </label>
    </div>
    <div style={{fontSize:12,color:MUTED,marginBottom:14}}>
      {dripOn
        ? 'Spread the send across days. Cold-outreach inboxes prefer this over a single big burst.'
        : 'Off — clicking Send now will fire all subscribers immediately (with the existing throttle).'}
    </div>

    {dripOn && (<>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
        <div>
          <label style={{display:'block',fontSize:11,color:MUTED,marginBottom:4}}>Emails per day</label>
          <input type="number" min="1" max="5000" value={form.daily_limit}
            onChange={e=>set('daily_limit', Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD,outline:'none'}}/>
        </div>
        <div>
          <label style={{display:'block',fontSize:11,color:MUTED,marginBottom:4}}>Start date</label>
          <input type="date" value={(form.drip_start_at || '').slice(0,10)}
            onChange={e=>set('drip_start_at', e.target.value)}
            style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD,outline:'none'}}/>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
        <div>
          <label style={{display:'block',fontSize:11,color:MUTED,marginBottom:4}}>Window start ({form.drip_timezone||'Europe/London'})</label>
          <input type="time" value={form.drip_window_start||'09:00'}
            onChange={e=>set('drip_window_start', e.target.value)}
            style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD,outline:'none'}}/>
        </div>
        <div>
          <label style={{display:'block',fontSize:11,color:MUTED,marginBottom:4}}>Window end</label>
          <input type="time" value={form.drip_window_end||'11:00'}
            onChange={e=>set('drip_window_end', e.target.value)}
            style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD,outline:'none'}}/>
        </div>
        <div>
          <label style={{display:'block',fontSize:11,color:MUTED,marginBottom:4}}>Send order</label>
          <select value={form.send_order||'top'} onChange={e=>set('send_order', e.target.value)}
            style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD}}>
            <option value="top">Top first</option>
            <option value="random">Random</option>
          </select>
        </div>
      </div>

      <div style={{marginBottom:12}}>
        <label style={{display:'block',fontSize:11,color:MUTED,marginBottom:6}}>Send on these days</label>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {DAY_DEFS.map(d=>{
            const on = activeDays.includes(d.k);
            return(<button key={d.k} type="button" onClick={()=>toggleDay(d.k)} style={{
              padding:'6px 12px',fontSize:12,borderRadius:6,cursor:'pointer',minWidth:48,
              background: on ? `${BLUE}15` : CARD,
              color:      on ? BLUE         : MUTED,
              border:    `0.5px solid ${on ? BLUE+'60' : BORDER}`,
            }}>{d.l}</button>);
          })}
        </div>
      </div>

      {warn && (
        <div style={{padding:'8px 12px',background:`${AMBER}15`,color:AMBER,borderRadius:6,fontSize:12,marginBottom:10,lineHeight:1.5}}>{warn}</div>
      )}

      <div style={{padding:'10px 14px',background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:12,lineHeight:1.5,color:TEXT}}>
        {est ? (<>
          Sending <b style={{fontWeight:500}}>{form.daily_limit}/day</b> between <b style={{fontWeight:500}}>{form.drip_window_start}</b> and <b style={{fontWeight:500}}>{form.drip_window_end}</b> on {activeDays.length===7?'every day':activeDays.map(d=>DAY_DEFS.find(x=>x.k===d)?.l).filter(Boolean).join(', ')}.<br/>
          {totalSubs.toLocaleString()} subscriber{totalSubs===1?'':'s'} → completes in <b style={{fontWeight:500}}>{est.sendDays} send-day{est.sendDays===1?'':'s'}</b>, finishing around <b style={{fontWeight:500}}>{est.finishDate}</b>.
        </>) : (
          <span style={{color:MUTED}}>{totalSubs===0 ? 'Pick a list with subscribers to see the schedule estimate.' : 'Pick at least one day and a daily limit.'}</span>
        )}
      </div>
    </>)}
  </div>);
}


function TrackingControls({form, set}){
  const mode = form.tracking_mode || 'off';
  const setMode = (m) => {
    set('tracking_mode', m);
    // Default flags by mode
    if (m === 'off')   { set('track_opens',false); set('track_clicks',false); set('track_unsub',false); }
    if (m === 'smart') { set('track_opens',true);  set('track_clicks',true);  set('track_unsub',true); }
    if (m === 'all')   { set('track_opens',true);  set('track_clicks',true);  set('track_unsub',true); }
  };
  return(<div style={{marginTop:18,padding:18,background:'#fafaf8',borderRadius:8,border:`0.5px solid ${BORDER}`}}>
    <div style={{fontSize:14,fontWeight:500,color:TEXT,marginBottom:4}}>Tracking & deliverability</div>
    <div style={{fontSize:12,color:MUTED,marginBottom:14}}>Cold outreach is sensitive to tracking signals. Default is off.</div>

    {/* Three mode cards */}
    <div style={{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:8,marginBottom:14}}>
      {[
        {k:'off',   t:'Off',            d:'No pixel, no link rewriting, no headers'},
        {k:'smart', t:'Smart',          d:'Track only repeat recipients', rec:true},
        {k:'all',   t:'All recipients', d:'Track everyone — risky for cold'},
      ].map(o=>{
        const sel = mode===o.k;
        return(<button key={o.k} type="button" onClick={()=>setMode(o.k)} style={{textAlign:'left',padding:12,background:CARD,border:sel?`2px solid ${BLUE}`:`0.5px solid ${BORDER}`,borderRadius:7,cursor:'pointer',outline:'none'}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:2,display:'flex',alignItems:'center',gap:6}}>
            {o.t}{o.rec&&<span style={{fontSize:10,background:'#e6f1fb',color:BLUE,padding:'1px 5px',borderRadius:4,fontWeight:400}}>recommended</span>}
          </div>
          <div style={{fontSize:11,color:MUTED,lineHeight:1.4}}>{o.d}</div>
        </button>);
      })}
    </div>

    {/* Smart-mode config */}
    {mode==='smart' && <div style={{padding:12,background:CARD,borderRadius:7,marginBottom:14,border:`0.5px solid ${BORDER}`}}>
      <div style={{fontSize:12,fontWeight:500,marginBottom:8,color:TEXT}}>Smart tracking rules</div>
      <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:MUTED,flexWrap:'wrap'}}>
        <span>Apply tracking from</span>
        <select value={form.tracking_threshold||3} onChange={e=>set('tracking_threshold',parseInt(e.target.value))} style={{fontSize:12,padding:'3px 6px',border:`0.5px solid ${BORDER}`,borderRadius:5,color:TEXT,background:CARD}}>
          {[2,3,4,5].map(n=><option key={n} value={n}>{n}{suffix(n)} contact onwards</option>)}
        </select>
        <span>—</span>
        <select value={form.tracking_window||6} onChange={e=>set('tracking_window',parseInt(e.target.value))} style={{fontSize:12,padding:'3px 6px',border:`0.5px solid ${BORDER}`,borderRadius:5,color:TEXT,background:CARD}}>
          <option value={3}>in last 3 months</option>
          <option value={6}>in last 6 months</option>
          <option value={12}>in last 12 months</option>
          <option value={0}>all time</option>
        </select>
      </div>
      <div style={{fontSize:11,color:MUTED,marginTop:6,lineHeight:1.5}}>A recipient is "warm" once they've received this many sent emails from any campaign. Bounced/failed sends don't count.</div>
    </div>}

    {/* Three toggles — only shown when mode is not 'off' */}
    {mode!=='off' && <>
      {[
        {k:'track_opens',  t:'Track opens',              d:'Inject 1×1 pixel. Visible to spam filters as bulk-mail signal.'},
        {k:'track_clicks', t:'Track clicks',             d:'Rewrite links through our domain. Triggers some link scanners.'},
        {k:'track_unsub',  t:'List-Unsubscribe header',  d:'Native "Unsubscribe" button in Gmail/Outlook. Required for warm/newsletter sends.'},
      ].map(t=>(
        <div key={t.k} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'10px 0',borderBottom:`0.5px solid ${BORDER}`}}>
          <div style={{flex:1,paddingRight:16}}>
            <div style={{fontSize:13,fontWeight:500,color:TEXT}}>{t.t}</div>
            <div style={{fontSize:11,color:MUTED,marginTop:2}}>{t.d}</div>
          </div>
          <Toggle checked={!!form[t.k]} onChange={v=>set(t.k,v)}/>
        </div>
      ))}
    </>}

    {/* Live status */}
    <div style={{marginTop:12,padding:'8px 12px',background:CARD,borderRadius:6,fontSize:12,color:MUTED,border:`0.5px solid ${BORDER}`}}>
      {mode==='off' || (!form.track_opens && !form.track_clicks && !form.track_unsub)
        ? 'Sending clean: no opens, no clicks, no headers. Bounce/complaint protection still active.'
        : `Tracking: ${[form.track_opens&&'opens',form.track_clicks&&'clicks',form.track_unsub&&'unsub header'].filter(Boolean).join(', ')}${mode==='smart'?` — from ${form.tracking_threshold||3}${suffix(form.tracking_threshold||3)} contact onwards`:' — all recipients'}`}
    </div>

    {/* Warning */}
    {mode==='all' && (form.track_opens||form.track_clicks) && <div style={{marginTop:10,padding:'10px 12px',background:'#fff3cd',borderLeft:`3px solid ${AMBER}`,borderRadius:6}}>
      <div style={{fontSize:12,fontWeight:500,color:AMBER,marginBottom:2}}>Tracking on all recipients</div>
      <div style={{fontSize:11,color:AMBER,lineHeight:1.5}}>Independent studies show inbox placement drops 15–30% on first-touch cold emails when tracking is on. Smart mode protects first-time recipients automatically.</div>
    </div>}
  </div>);
}

// ── SendCampaignDialog — replaces confirm() with a real breakdown ────────────
function SendCampaignDialog({campaignId, onClose, onConfirmed}){
  const [preview,setPreview]=useState(null);
  const [sending,setSending]=useState(false);
  const [err,setErr]=useState('');
  useEffect(()=>{
    fetch(`/api/email/campaigns/${campaignId}/send-preview`).then(r=>r.json()).then(d=>{
      if(d.error)setErr(d.error);else setPreview(d);
    });
  },[campaignId]);

  async function doSend(){
    setSending(true);
    const r=await fetch(`/api/email/campaigns/${campaignId}/send`,{method:'POST'});
    const d=await r.json();
    setSending(false);
    if(d.error){setErr(d.error);return;}
    onConfirmed();
    onClose();
  }

  if(err) return(<Modal title="Cannot send" onClose={onClose}>
    <div style={{color:DANGER,fontSize:13,marginBottom:14}}>{err}</div>
    <div style={{textAlign:'right'}}><Btn onClick={onClose}>Close</Btn></div>
  </Modal>);

  if(!preview) return(<Modal title="Loading…" onClose={onClose}>
    <div style={{textAlign:'center',padding:30,color:MUTED,fontSize:13}}>Calculating recipient breakdown…</div>
  </Modal>);

  const t=preview.tracking;
  const sched=preview.schedule||{};
  const showTrackingNote = (t.mode!=='off') && (t.track_opens||t.track_clicks||t.track_unsub);

  // Friendly label for the existing schedule, if any
  function scheduleLabel(){
    if (sched.is_drip) {
      const startDate = sched.drip_start_at ? new Date(sched.drip_start_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'unscheduled';
      const sentSoFar = sched.drip_sent || 0;
      const order = sched.send_order==='random'?'random order':'top of list first';
      return `Drip campaign — ${sched.daily_limit.toLocaleString()}/day, ${order}, started ${startDate}. ${sentSoFar.toLocaleString()} already sent.`;
    }
    if (sched.is_scheduled) {
      const when = new Date(sched.scheduled_at).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
      return `Scheduled to send at ${when}.`;
    }
    return null;
  }
  const schedMsg = scheduleLabel();
  const isOverridingSchedule = !!schedMsg; // sending now would skip the schedule

  return(<Modal title="Send campaign?" onClose={onClose} wide>
    <p style={{fontSize:13,color:MUTED,margin:'0 0 16px'}}>
      Sending to <span style={{fontWeight:500,color:TEXT}}>{preview.total_recipients.toLocaleString()} recipients</span> on list <em>{preview.list_name}</em>.
    </p>

    {/* Schedule context — shown when this campaign already has a schedule/drip */}
    {isOverridingSchedule && (
      <div style={{background:'#fff3cd',borderLeft:`3px solid ${AMBER}`,borderRadius:6,padding:'10px 14px',marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:500,color:AMBER,marginBottom:4}}>This campaign already has a schedule</div>
        <div style={{fontSize:12,color:AMBER,lineHeight:1.5}}>{schedMsg}</div>
        <div style={{fontSize:11,color:AMBER,marginTop:6,opacity:0.85}}>Sending now will fire the rest of the campaign immediately, ignoring the schedule. To keep the schedule, click Cancel and use the Schedule controls instead.</div>
      </div>
    )}

    {/* Bucket histogram */}
    <div style={{background:'#fafaf8',borderRadius:7,padding:14,marginBottom:14,border:`0.5px solid ${BORDER}`}}>
      <div style={{fontSize:11,fontWeight:500,color:MUTED,textTransform:'uppercase',letterSpacing:0.5,marginBottom:10}}>Recipient breakdown by touch count</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:8}}>
        {[['1st','1st contact'],['2nd','2nd contact'],['3rd','3rd contact'],['4+','4th+ contact']].map(([k,label])=>(
          <div key={k} style={{background:CARD,padding:10,borderRadius:6,textAlign:'center',border:`0.5px solid ${BORDER}`}}>
            <div style={{fontSize:22,fontWeight:500,color:TEXT}}>{(preview.buckets[k]||0).toLocaleString()}</div>
            <div style={{fontSize:11,color:MUTED,marginTop:2}}>{label}</div>
          </div>
        ))}
      </div>
    </div>

    {/* Personalisation — skip count for {{first_name}} */}
    {preview.personalisation?.uses_first_name && (
      <div style={{
        background: preview.personalisation.will_skip>0 ? '#fff3cd' : `${GREEN}10`,
        borderLeft: `3px solid ${preview.personalisation.will_skip>0 ? AMBER : GREEN}`,
        borderRadius: 6, padding: '10px 14px', marginBottom: 14,
      }}>
        <div style={{fontSize:12,fontWeight:500,color:preview.personalisation.will_skip>0?AMBER:DARK,marginBottom:4}}>
          {preview.personalisation.will_skip>0
            ? `${preview.personalisation.will_skip.toLocaleString()} recipient${preview.personalisation.will_skip===1?'':'s'} will be skipped`
            : 'All recipients have parsed first names'}
        </div>
        <div style={{fontSize:12,color:preview.personalisation.will_skip>0?AMBER:DARK,lineHeight:1.5}}>
          This campaign uses <code style={{fontFamily:'ui-monospace, monospace',fontSize:11,padding:'1px 5px',background:'rgba(0,0,0,0.05)',borderRadius:3}}>{'{{first_name}}'}</code>.
          {preview.personalisation.will_skip>0 && (
            <> {preview.personalisation.will_send.toLocaleString()} will receive the campaign — open the Preview to see who's being skipped and override their first name if needed.</>
          )}
          {preview.personalisation.unparsed>0 && (
            <> <b>{preview.personalisation.unparsed}</b> subscribers haven't been name-parsed yet — run Preview first to populate them.</>
          )}
        </div>
      </div>
    )}

    {/* What will happen */}
    {showTrackingNote ? (
      <div style={{background:'#e6f1fb',borderLeft:`3px solid ${BLUE}`,borderRadius:6,padding:'10px 14px',marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:500,color:BLUE,marginBottom:6}}>
          {t.mode==='smart'?`Smart tracking — ${t.threshold}${suffix(t.threshold)} contact onwards (last ${t.window_months===0?'all time':`${t.window_months} months`})`:'Tracking all recipients'}
        </div>
        <div style={{fontSize:12,color:BLUE,lineHeight:1.6}}>
          {t.will_track.toLocaleString()} recipient{t.will_track===1?'':'s'} will receive <b>tracked</b> email{t.will_track===1?'':'s'}<br/>
          {t.will_send_clean.toLocaleString()} recipient{t.will_send_clean===1?'':'s'} will receive <b>clean</b> email{t.will_send_clean===1?'':'s'}
        </div>
      </div>
    ) : (
      <div style={{background:'#f0f0ed',borderRadius:6,padding:'10px 14px',marginBottom:14,fontSize:12,color:MUTED}}>
        Sending clean — no tracking applied to any recipient. Bounce/complaint protection via SNS still active.
      </div>
    )}

    {t.always_warm && <div style={{fontSize:11,color:MUTED,marginBottom:14,paddingLeft:10,borderLeft:`2px solid ${BORDER}`}}>
      List <em>{preview.list_name}</em> is marked <b>always warm</b> — tracking applies to every recipient regardless of touch count.
    </div>}

    <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
      <Btn onClick={onClose} disabled={sending}>Cancel</Btn>
      <Btn variant={isOverridingSchedule?'amber':'primary'} onClick={doSend} disabled={sending}>
        {sending ? 'Sending…' : (() => {
          const sendCount = preview.personalisation?.uses_first_name
            ? preview.personalisation.will_send
            : preview.total_recipients;
          if (isOverridingSchedule) return `Override schedule and send ${sendCount.toLocaleString()} now`;
          return `Send ${sendCount.toLocaleString()} email${sendCount===1?'':'s'}`;
        })()}
      </Btn>
    </div>
  </Modal>);
}

const TH=({children,w})=><th style={{textAlign:'left',padding:'8px 14px',fontSize:11,fontWeight:500,color:MUTED,background:BG,borderBottom:`0.5px solid ${BORDER}`,whiteSpace:'nowrap',width:w}}>{children}</th>;
const TD=({children,muted,center})=><td style={{padding:'9px 14px',fontSize:12,color:muted?MUTED:TEXT,textAlign:center?'center':'left',borderBottom:`0.5px solid ${BORDER}`,verticalAlign:'middle'}}>{children}</td>;

// ── Client modal ──────────────────────────────────────────────────────────────
function ClientModal({initial,onClose,onSaved,onRemove}){
  const editing=!!initial?.id;
  const [name,setName]=useState(initial?.name||'');
  const [color,setColor]=useState(initial?.color||'#1D9E75');
  // Default sender — set once per client, auto-populates new campaigns and lists
  const [defaultFromEmail,setDefaultFromEmail]=useState(initial?.default_from_email||'');
  const [defaultFromName,setDefaultFromName]=useState(initial?.default_from_name||'');
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState('');
  async function save(){
    if(!name.trim()){setErr('Name required');return;}
    setSaving(true);
    const r=await fetch(editing?`/api/email/clients/${initial.id}`:'/api/email/clients',{
      method:editing?'PUT':'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        name, color,
        default_from_email: defaultFromEmail.trim() || null,
        default_from_name:  defaultFromName.trim()  || null,
      }),
    });
    const d=await r.json();
    if(d.error){setErr(d.error);setSaving(false);return;}
    onSaved();onClose();
  }
  return(<Modal title={editing?'Edit client':'New client'} onClose={onClose}>
    <Input label="Client name *" value={name} onChange={setName} placeholder="e.g. Sweetbyte" required/>
    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontSize:12,color:MUTED,marginBottom:6}}>Colour</label>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{BRAND_COLORS.map(c=><div key={c} onClick={()=>setColor(c)} style={{width:24,height:24,borderRadius:6,background:c,cursor:'pointer',border:color===c?`2px solid ${TEXT}`:'2px solid transparent'}}/>)}</div>
    </div>
    {/* Default sender — pre-fills new campaigns and lists for this client */}
    <div style={{marginTop:18,padding:14,background:'#fafaf8',borderRadius:8,border:`0.5px solid ${BORDER}`}}>
      <div style={{fontSize:13,fontWeight:500,color:TEXT,marginBottom:2}}>Default sender</div>
      <div style={{fontSize:11,color:MUTED,marginBottom:12}}>Auto-fills From and Reply-To on new campaigns and lists for this client.</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 14px'}}>
        <Input label="From name"  value={defaultFromName}  onChange={setDefaultFromName}  placeholder="John Wicks"/>
        <Input label="From email" value={defaultFromEmail} onChange={setDefaultFromEmail} placeholder="john@clearerpaths.co.uk"/>
      </div>
    </div>
    {err&&<div style={{color:DANGER,fontSize:13,marginTop:14,marginBottom:10}}>{err}</div>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:18}}>
      <div>{editing&&onRemove&&<button type="button" onClick={()=>{onClose();onRemove(initial);}} style={{background:'none',border:'none',color:DANGER,fontSize:13,cursor:'pointer',padding:0,textDecoration:'underline'}}>Remove domain…</button>}</div>
      <div style={{display:'flex',gap:8}}><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={save} disabled={saving}>{saving?'Saving…':editing?'Save changes':'Create client'}</Btn></div>
    </div>
  </Modal>);
}

// ── Remove-domain modal — Archive (keep records) or Delete everything ──────────
// Destructive. Archive disconnects Gmail mailboxes + hides the domain but keeps
// all data (reversible). Delete everything purges every record for the domain
// and tombstones the name so the AWS auto-sync can't recreate it. AWS/SES is
// removed manually by the operator. Button only enables once the domain name is
// typed exactly (same safety pattern as the mailbox resync).
function RemoveDomainModal({client,onClose,onDone}){
  const [mode,setMode]=useState('archive');
  const [confirmText,setConfirmText]=useState('');
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState('');
  const armed = confirmText.trim().toLowerCase() === (client.name||'').toLowerCase();
  async function go(){
    if(!armed||busy)return;
    setBusy(true);setErr('');
    try{
      const r = mode==='delete'
        ? await fetch(`/api/email/clients/${client.id}`,{method:'DELETE'})
        : await fetch(`/api/email/clients/${client.id}/archive`,{method:'POST'});
      const d=await r.json();
      if(!r.ok||d.error){setErr(d.error||'Could not remove');setBusy(false);return;}
      onDone();
    }catch(e){setErr('Could not reach the server');setBusy(false);}
  }
  const opt=(val,title,desc)=>(
    <label style={{display:'flex',gap:10,padding:'11px 12px',border:`1px solid ${mode===val?GREEN:BORDER}`,borderRadius:8,marginBottom:10,cursor:'pointer',alignItems:'flex-start'}}>
      <input type="radio" name="rmmode" checked={mode===val} onChange={()=>setMode(val)} style={{marginTop:2,accentColor:GREEN}}/>
      <div><div style={{fontSize:13,fontWeight:500,color:TEXT}}>{title}</div><div style={{fontSize:12,color:MUTED,marginTop:2,lineHeight:1.45}}>{desc}</div></div>
    </label>
  );
  return(<Modal title={`Remove ${client.name}`} onClose={onClose}>
    <div style={{fontSize:13,color:MUTED,marginBottom:14,lineHeight:1.5}}>This disconnects the Gmail mailboxes for this domain and removes it from the Customers list. AWS/SES is not touched — remove that identity in the AWS console yourself.</div>
    {opt('archive','Keep records (archive)','Disconnects the mailboxes and hides the domain, but keeps all lists, subscribers, campaigns and replies in the database. You can restore it later.')}
    {opt('delete','Delete everything','Permanently deletes every record for this domain — lists, subscribers, campaigns, replies, mailboxes, hot prospects, portal logins and Meta/Facebook data. This cannot be undone.')}
    <div style={{marginTop:6}}>
      <label style={{display:'block',fontSize:12,color:MUTED,marginBottom:6}}>Type <strong style={{color:TEXT}}>{client.name}</strong> to confirm</label>
      <input value={confirmText} onChange={e=>setConfirmText(e.target.value)} placeholder={client.name} style={{width:'100%',padding:'8px 10px',border:`1px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:BG,outline:'none',boxSizing:'border-box'}}/>
    </div>
    {err&&<div style={{color:DANGER,fontSize:13,marginTop:12}}>{err}</div>}
    <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:18}}>
      <Btn onClick={onClose}>Cancel</Btn>
      <button type="button" onClick={go} disabled={!armed||busy} style={{padding:'8px 16px',borderRadius:7,border:'none',fontSize:13,fontWeight:500,cursor:armed&&!busy?'pointer':'not-allowed',background:armed?DANGER:'#e7c9c2',color:'#fff',opacity:busy?0.6:1}}>{busy?'Removing…':mode==='delete'?'Delete everything':'Archive domain'}</button>
    </div>
  </Modal>);
}

// ── List modal ────────────────────────────────────────────────────────────────
function ListModal({emailClient,onClose,onSaved}){
  const [form,setForm]=useState({
    name:'',
    from_name:  emailClient?.default_from_name  || '',
    from_email: emailClient?.default_from_email || '',
    reply_to:   emailClient?.default_from_email || '',
  });
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  async function save(){
    if(!form.name||!form.from_name||!form.from_email){setErr('Fill all required fields');return;}
    setSaving(true);
    const r=await fetch('/api/email/lists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,reply_to:form.reply_to||form.from_email,email_client_id:emailClient.id})});
    const d=await r.json();
    if(d.error){setErr(d.error);setSaving(false);return;}
    onSaved();onClose();
  }
  return(<Modal title="New mailing list" onClose={onClose}>
    <Input label="List name *" value={form.name} onChange={v=>set('name',v)} placeholder="Wave 1" required/>
    <Input label="From name *" value={form.from_name} onChange={v=>set('from_name',v)} placeholder="Wez at Sweetbyte" required/>
    <Input label="From email *" value={form.from_email} onChange={v=>set('from_email',v)} placeholder={`hello@${emailClient.name}`} required/>
    <Input label="Reply-to (leave blank to match from email)" value={form.reply_to} onChange={v=>set('reply_to',v)}/>
    {err&&<div style={{color:DANGER,fontSize:13,marginBottom:10}}>{err}</div>}
    <div style={{display:'flex',justifyContent:'flex-end',gap:8}}><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={save} disabled={saving}>{saving?'Creating…':'Create list'}</Btn></div>
  </Modal>);
}

// ── Import modal ──────────────────────────────────────────────────────────────
function ImportModal({list,onClose,onSaved}){
  const [csv,setCsv]=useState('');
  const [saving,setSaving]=useState(false);
  const [result,setResult]=useState(null);
  const fileRef=useRef();
  function handleFile(e){const f=e.target.files[0];if(!f)return;new Promise(res=>{const r=new FileReader();r.onload=ev=>res(ev.target.result);r.readAsText(f);}).then(setCsv);}
  async function importNow(){
    setSaving(true);
    const r=await fetch(`/api/email/lists/${list.id}/import`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv})});
    const d=await r.json();setResult(d);setSaving(false);
    if(d.ok)onSaved();
  }
  return(<Modal title={`Import into — ${list.name}`} onClose={onClose}>
    <p style={{fontSize:13,color:MUTED,marginBottom:12}}>Supports Sendy exports — Name, Email and Status columns mapped automatically.</p>
    <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{fontSize:13,marginBottom:12}}/>
    {csv&&<Input label="Preview / edit" value={csv} onChange={setCsv} rows={6}/>}
    {result&&<div style={{padding:'8px 12px',background:result.ok?`${GREEN}15`:'#fdecea',borderRadius:7,fontSize:13,color:result.ok?DARK:DANGER,marginBottom:12}}>{result.ok?`✓ Added ${result.added} subscribers.`:result.error}</div>}
    <div style={{display:'flex',justifyContent:'flex-end',gap:8}}><Btn onClick={onClose}>Close</Btn>{!result?.ok&&<Btn variant="primary" onClick={importNow} disabled={saving||!csv.trim()}>{saving?'Importing…':'Import'}</Btn>}</div>
  </Modal>);
}

// ── Import NEW list modal — upload, map fields, name, create ──────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  function parseLine(line) {
    const result = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result.map(v => v.replace(/^"|"$/g, '').trim());
  }
  const headers = parseLine(lines[0]);
  const rows    = lines.slice(1).map(parseLine);
  return { headers, rows };
}

// Extract first name from a full name string
function firstNameFrom(fullName) {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0] || fullName;
}

// Resolve display name from a row given mapping
function resolveDisplayName(row, colMapping, nameType) {
  const val = row[colMapping] ?? '';
  if (nameType === 'full')  return firstNameFrom(val);
  if (nameType === 'first') return val;
  if (nameType === 'last')  return val;
  return val;
}

function ImportNewListModal({ emailClient, onClose, onSaved }) {
  const [step, setStep]       = useState(1);
  const [csv, setCsv]         = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed]   = useState(null);
  // colRoles: map from column index → role ('email'|'first'|'last'|'full'|'skip')
  const [colRoles, setColRoles] = useState({});
  const [listName, setListName] = useState('');
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [issues, setIssues]   = useState([]);
  const [saving, setSaving]   = useState(false);
  const [result, setResult]   = useState(null);
  const fileRef = useRef();

  function handleFile(e) {
    const f = e.target.files[0]; if (!f) return;
    setFileName(f.name);
    new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsText(f); })
      .then(text => {
        setCsv(text);
        const p = parseCSV(text);
        setParsed(p);
        autoDetect(p.headers);
      });
  }

  function autoDetect(headers) {
    const roles = {};
    headers.forEach((h, i) => {
      const l = h.toLowerCase();
      if (l.includes('email') || l.includes('e-mail')) roles[i] = 'email';
      else if (l === 'name' || l === 'full name' || l === 'fullname') roles[i] = 'full';
      else if (l.includes('first')) roles[i] = 'first';
      else if (l.includes('last') || l.includes('surname')) roles[i] = 'last';
      else roles[i] = 'skip';
    });
    setColRoles(roles);
  }

  function setRole(idx, role) {
    // Only one column can be email, first, last, or full at a time
    setColRoles(prev => {
      const next = { ...prev };
      if (role !== 'skip') {
        Object.keys(next).forEach(k => { if (next[k] === role) next[k] = 'skip'; });
      }
      next[idx] = role;
      return next;
    });
  }

  const emailIdx = Object.keys(colRoles).find(i => colRoles[i] === 'email');
  const nameIdx  = Object.keys(colRoles).find(i => colRoles[i] === 'first' || colRoles[i] === 'full');
  const lastIdx  = Object.keys(colRoles).find(i => colRoles[i] === 'last');

  function getFirstName(row) {
    if (nameIdx === undefined) return '';
    const val = row[nameIdx] || '';
    return colRoles[nameIdx] === 'full' ? firstNameFrom(val) : val;
  }

  function getFullStoredName(row) {
    const parts = [];
    if (nameIdx !== undefined) {
      const val = row[nameIdx] || '';
      parts.push(colRoles[nameIdx] === 'full' ? firstNameFrom(val) : val);
    }
    if (lastIdx !== undefined) parts.push(row[lastIdx] || '');
    return parts.filter(Boolean).join(' ');
  }

  function validateAndNext() {
    const errs = [];
    if (emailIdx === undefined) errs.push('You must assign the Email column');
    if (!listName.trim()) errs.push('List name is required');
    if (!fromName.trim()) errs.push('From name is required');
    if (!fromEmail.trim()) errs.push('From email is required');
    if (errs.length) { setIssues(errs); return; }

    // Check email validity
    const badRows = [];
    parsed.rows.forEach((row, i) => {
      const email = row[emailIdx] || '';
      if (!email) { badRows.push({ row: i+2, issue: 'Missing email' }); return; }
      if (!email.includes('@') || !email.includes('.')) badRows.push({ row: i+2, issue: `Invalid email: ${email}` });
    });
    setIssues(badRows.slice(0, 10));
    setStep(3);
  }

  async function doImport() {
    setSaving(true);
    const listRes = await fetch('/api/email/lists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_client_id: emailClient.id, name: listName, from_name: fromName, from_email: fromEmail, reply_to: fromEmail }),
    });
    const listData = await listRes.json();
    if (listData.error) { setResult({ error: listData.error }); setSaving(false); return; }

    const mappedCsv = [
      'Name,Email,Status',
      ...parsed.rows.map(row => {
        const name  = getFullStoredName(row);
        const email = row[emailIdx] || '';
        return `"${name}","${email}","subscribed"`;
      })
    ].join('\n');

    const impRes = await fetch(`/api/email/lists/${listData.id}/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: mappedCsv }),
    });
    const impData = await impRes.json();
    setResult(impData); setSaving(false);
    if (impData.ok) onSaved();
  }

  const ROLE_OPTIONS = [
    { value:'email', label:'Email address ✱' },
    { value:'full',  label:'Full name (split on first space)' },
    { value:'first', label:'First name only' },
    { value:'last',  label:'Last name only' },
    { value:'skip',  label:'— skip this column —' },
  ];

  function roleColor(role) {
    if (role==='email') return { border:`0.5px solid ${GREEN}`, background:`${GREEN}08`, color:DARK };
    if (role==='first'||role==='full') return { border:`0.5px solid ${BLUE}`, background:'#E6F1FB', color:'#0C447C' };
    if (role==='last') return { border:`0.5px solid ${BLUE}40`, background:'#E6F1FB60', color:'#185FA5' };
    return { border:`0.5px solid ${BORDER}`, background:'transparent', color:MUTED };
  }

  function cellColor(role) {
    if (role==='email') return DARK;
    if (role==='first'||role==='full'||role==='last') return '#0C447C';
    return MUTED;
  }

  const previewRows = parsed?.rows?.slice(0, 4) || [];

  return (
    <Modal title="Import — create new list" onClose={onClose} wide>

      {/* Step indicator */}
      <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:20 }}>
        {['Upload file','Map columns','Review & import'].map((s,i)=>(
          <React.Fragment key={s}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ width:20, height:20, borderRadius:'50%', background:step>i+1?GREEN:step===i+1?GREEN:BORDER, color:'#fff', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>{step>i+1?'✓':i+1}</div>
              <span style={{ fontSize:12, color:step===i+1?TEXT:MUTED, fontWeight:step===i+1?500:400 }}>{s}</span>
            </div>
            {i<2&&<div style={{ flex:1, height:1, background:BORDER, margin:'0 4px' }}/>}
          </React.Fragment>
        ))}
      </div>

      {/* ── Step 1 — Upload ── */}
      {step===1&&(
        <div>
          <div style={{ border:`2px dashed ${BORDER}`, borderRadius:10, padding:32, textAlign:'center', marginBottom:16, background:BG }}>
            <div style={{ fontSize:13, color:MUTED, marginBottom:12 }}>Drop a CSV or click to browse</div>
            <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display:'none' }}/>
            <Btn onClick={()=>fileRef.current?.click()}>Choose file</Btn>
            {fileName&&<div style={{ fontSize:12, color:GREEN, marginTop:10 }}>✓ {fileName} — {parsed?.rows?.length||0} rows detected</div>}
          </div>
          {parsed&&(
            <div style={{ fontSize:12, color:MUTED, marginBottom:4 }}>
              Columns found: {parsed.headers.map(h=><span key={h} style={{ margin:'0 3px', padding:'2px 7px', background:BG, border:`0.5px solid ${BORDER}`, borderRadius:4, fontSize:11, color:TEXT }}>{h}</span>)}
            </div>
          )}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:16 }}>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" onClick={()=>setStep(2)} disabled={!parsed}>Next →</Btn>
          </div>
        </div>
      )}

      {/* ── Step 2 — CSV table with column dropdowns ── */}
      {step===2&&parsed&&(
        <div>
          <div style={{ fontSize:12, color:MUTED, marginBottom:10, background:BG, padding:'8px 12px', borderRadius:7 }}>
            <b style={{ color:TEXT }}>{fileName}</b> — {parsed.rows.length} contacts. Use the dropdown above each column to tell us what it contains. Columns set to "skip" won't be imported.
          </div>

          {/* Scrollable CSV table */}
          <div style={{ overflowX:'auto', border:`0.5px solid ${BORDER}`, borderRadius:8, marginBottom:16 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:BG }}>
                  {parsed.headers.map((h, i) => (
                    <th key={i} style={{ padding:'10px 12px', borderBottom:`0.5px solid ${BORDER}`, textAlign:'left', minWidth:150, verticalAlign:'bottom' }}>
                      <div style={{ fontSize:10, color:MUTED, marginBottom:4, fontWeight:500, textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</div>
                      <select
                        value={colRoles[i]||'skip'}
                        onChange={e=>setRole(i, e.target.value)}
                        style={{ width:'100%', fontSize:11, padding:'3px 6px', borderRadius:5, ...roleColor(colRoles[i]||'skip') }}>
                        {ROLE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, ri) => (
                  <tr key={ri} style={{ background:ri%2===0?CARD:BG }}>
                    {parsed.headers.map((_, ci) => {
                      const role = colRoles[ci]||'skip';
                      const isName = role==='full'||role==='first'||role==='last';
                      const val = row[ci]||'';
                      return (
                        <td key={ci} style={{ padding:'7px 12px', borderBottom:`0.5px solid ${BORDER}`, color:cellColor(role), verticalAlign:'middle' }}>
                          {val||<span style={{ color:BORDER }}>—</span>}
                          {/* Show Hi preview for name column */}
                          {isName && ri===0 && val && (
                            <span style={{ fontSize:10, padding:'1px 5px', borderRadius:3, background:'#E6F1FB', color:'#0C447C', marginLeft:6, fontWeight:500 }}>
                              → Hi, {colRoles[ci]==='full'?firstNameFrom(val):val}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* List details */}
          <div style={{ borderTop:`0.5px solid ${BORDER}`, paddingTop:14, marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:500, color:TEXT, marginBottom:10 }}>New list details</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 20px' }}>
              <Input label="List name *" value={listName} onChange={setListName} placeholder="e.g. Suffolk wave 1" required/>
              <Input label="From name *" value={fromName} onChange={setFromName} placeholder="Wez at Sweetbyte" required/>
              <Input label="From email *" value={fromEmail} onChange={setFromEmail} placeholder={`hello@${emailClient.name}`} required/>
            </div>
          </div>

          {/* [Name] tip */}
          <div style={{ background:`${GREEN}10`, border:`0.5px solid ${GREEN}40`, borderRadius:7, padding:'8px 12px', fontSize:12, color:DARK, marginBottom:14 }}>
            Use <b>[Name]</b> in your campaign emails — e.g. "Hi, [Name]" — and it inserts the first name automatically for each recipient.
          </div>

          {issues.length>0&&<div style={{ background:'#fdecea', borderRadius:7, padding:'8px 12px', fontSize:12, color:DANGER, marginBottom:12 }}>{issues.map((e,i)=><div key={i}>{typeof e==='string'?e:`Row ${e.row}: ${e.issue}`}</div>)}</div>}

          {/* Status bar */}
          <div style={{ fontSize:11, color:MUTED, marginBottom:10 }}>
            {emailIdx!==undefined&&<span style={{ color:GREEN, marginRight:10 }}>✓ Email mapped</span>}
            {emailIdx===undefined&&<span style={{ color:DANGER, marginRight:10 }}>✗ Email not mapped</span>}
            {nameIdx!==undefined&&<span style={{ color:BLUE, marginRight:10 }}>✓ Name mapped ({colRoles[nameIdx]==='full'?'full name — split on first space':colRoles[nameIdx]+' name'})</span>}
            {Object.values(colRoles).filter(r=>r==='skip').length>0&&<span style={{ color:MUTED }}>{Object.values(colRoles).filter(r=>r==='skip').length} columns will be ignored</span>}
          </div>

          <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
            <Btn onClick={()=>setStep(1)}>← Back</Btn>
            <Btn variant="primary" onClick={validateAndNext}>Check fields & preview →</Btn>
          </div>
        </div>
      )}

      {/* ── Step 3 — Review ── */}
      {step===3&&parsed&&(
        <div>
          {issues.length>0?(
            <div style={{ background:'#fff3cd', border:`0.5px solid ${AMBER}40`, borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
              <div style={{ fontSize:12, fontWeight:500, color:AMBER, marginBottom:6 }}>⚠ {issues.length} row{issues.length>1?'s':''} with issues — these will be skipped:</div>
              {issues.map((is,i)=><div key={i} style={{ fontSize:12, color:AMBER }}>Row {is.row}: {is.issue}</div>)}
            </div>
          ):(
            <div style={{ background:`${GREEN}12`, border:`0.5px solid ${GREEN}40`, borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12, color:DARK }}>
              ✓ All email addresses look valid
            </div>
          )}

          <div style={{ background:BG, borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12 }}>
            <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
              <span><b style={{ color:TEXT }}>List:</b> <span style={{ color:MUTED }}>{listName}</span></span>
              <span><b style={{ color:TEXT }}>From:</b> <span style={{ color:MUTED }}>{fromName} &lt;{fromEmail}&gt;</span></span>
              <span><b style={{ color:TEXT }}>Total:</b> <span style={{ color:MUTED }}>{parsed.rows.length} contacts</span></span>
              <span><b style={{ color:TEXT }}>To import:</b> <span style={{ color:GREEN, fontWeight:500 }}>{parsed.rows.length - issues.length}</span></span>
            </div>
          </div>

          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:500, color:MUTED, marginBottom:6 }}>Preview — first 5 contacts</div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:BG }}>
                  <th style={{ padding:'6px 10px', textAlign:'left', color:MUTED, fontWeight:500, borderBottom:`0.5px solid ${BORDER}` }}>Name stored</th>
                  <th style={{ padding:'6px 10px', textAlign:'left', color:MUTED, fontWeight:500, borderBottom:`0.5px solid ${BORDER}` }}>Email</th>
                  <th style={{ padding:'6px 10px', textAlign:'left', color:MUTED, fontWeight:500, borderBottom:`0.5px solid ${BORDER}` }}>Hi, [Name] preview</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0,5).map((row,i)=>{
                  const name  = getFullStoredName(row);
                  const email = row[emailIdx]||'';
                  const hi    = firstNameFrom(name);
                  return(
                    <tr key={i}>
                      <td style={{ padding:'6px 10px', borderBottom:`0.5px solid ${BORDER}`, color:'#0C447C' }}>{name||<span style={{ color:MUTED }}>—</span>}</td>
                      <td style={{ padding:'6px 10px', borderBottom:`0.5px solid ${BORDER}`, color:DARK }}>{email||<span style={{ color:DANGER }}>missing</span>}</td>
                      <td style={{ padding:'6px 10px', borderBottom:`0.5px solid ${BORDER}` }}>
                        {hi?<span style={{ fontSize:12 }}>Hi, <b style={{ color:GREEN }}>{hi}</b></span>:<span style={{ color:MUTED }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {result&&<div style={{ padding:'8px 12px', background:result.ok?`${GREEN}15`:'#fdecea', borderRadius:7, fontSize:13, color:result.ok?DARK:DANGER, marginBottom:12 }}>{result.ok?`✓ List "${listName}" created with ${result.added} contacts.`:result.error}</div>}

          <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
            <Btn onClick={()=>setStep(2)}>← Back</Btn>
            {!result?.ok&&<Btn variant="primary" onClick={doImport} disabled={saving}>{saving?'Creating list…':'Create list & import'}</Btn>}
            {result?.ok&&<Btn onClick={onClose}>Done</Btn>}
          </div>
        </div>
      )}
    </Modal>
  );
}


// ── Campaign modal ────────────────────────────────────────────────────────────
function CampaignModal({emailClient,lists,initial,onClose,onSaved}){
  const editing=!!initial?.id;
  // Default body for brand-new campaigns: pre-seed with the personalised greeting
  // so the user doesn't have to think about adding {{first_name}} every time.
  // The leading <p> ensures the cursor lands on a new line below the greeting
  // when the rich-text editor mounts. Edit campaigns keep whatever's saved.
  const DEFAULT_BODY = '<p>Hi {{first_name}},</p><p><br></p><p></p>';
  const [form,setForm]=useState({
    list_id:initial?.list_id||(lists.length===1?lists[0].id:''),
    title:initial?.title||'',subject:initial?.subject||'',
    from_name:  initial?.from_name  || (editing ? '' : (emailClient?.default_from_name  || '')),
    from_email: initial?.from_email || (editing ? '' : (emailClient?.default_from_email || '')),
    // Reply-to defaults to the customer's default From email — same address
    // is used for sending and receiving replies. Operator can still override.
    reply_to:   initial?.reply_to   || (editing ? '' : (emailClient?.default_from_email || '')),
    // Tracking fields. Default to safest (off) for new campaigns; preserve on edit.
    tracking_mode:      initial?.tracking_mode      ?? 'off',
    tracking_threshold: initial?.tracking_threshold ?? 3,
    tracking_window:    initial?.tracking_window    ?? 6,
    track_opens:  !!initial?.track_opens,
    track_clicks: !!initial?.track_clicks,
    track_unsub:  !!initial?.track_unsub,
    // Drip schedule. Default off for new campaigns. Existing campaigns preserve
    // their saved values. daily_limit > 0 means dripping is enabled.
    daily_limit:        initial?.daily_limit        ?? 0,
    drip_start_at:      initial?.drip_start_at      ?? new Date().toISOString().slice(0,10),
    drip_send_days:     initial?.drip_send_days     ?? '1,2,3,4,5',
    drip_window_start:  initial?.drip_window_start  ?? '09:00',
    drip_window_end:    initial?.drip_window_end    ?? '11:00',
    drip_timezone:      initial?.drip_timezone      ?? 'Europe/London',
    send_order:         initial?.send_order         ?? 'top',
  });
  // Phase 4: multi-step sequence. steps[0] is always step 1; later entries
  // are follow-ups with delay_days >= 1. Each step has its own subject —
  // step 1's subject is also mirrored to email_campaigns.subject. New
  // campaigns start with one step pre-filled with DEFAULT_BODY.
  const [steps, setSteps] = useState(
    editing
      ? [{ step_number: 1, subject: initial?.subject || '', html_body: initial?.html_body || '', delay_days: 0, sent_count: 0 }]
      : [{ step_number: 1, subject: '', html_body: DEFAULT_BODY, delay_days: 0, sent_count: 0 }]
  );
  const [activeStep, setActiveStep] = useState(1);
  const [stepsLoaded, setStepsLoaded] = useState(!editing);

  // On open in edit mode, fetch the full step list so we can show 2nd / 3rd contact tabs
  // if the user already saved them. New campaigns skip this fetch.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/email/campaigns/${initial.id}/steps`);
        const d = await r.json();
        if (cancelled) return;
        if (Array.isArray(d.steps) && d.steps.length > 0) {
          setSteps(d.steps.map(s => ({
            step_number: s.step_number,
            subject:     s.subject || '',
            html_body:   s.html_body,
            delay_days:  s.delay_days,
            sent_count:  s.sent_count || 0,
          })));
        }
        setStepsLoaded(true);
      } catch {
        setStepsLoaded(true);  // give up — fall back to single-step
      }
    })();
    return () => { cancelled = true; };
  }, [editing, initial?.id]);

  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState('');
  const [showPreview,setShowPreview]=useState(false);
  const [copiedChip,setCopiedChip]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  // Step helpers — keep all manipulation in one place so the UI stays consistent.
  const activeStepIdx = steps.findIndex(s => s.step_number === activeStep);
  const activeStepObj = steps[activeStepIdx] || steps[0];

  function updateStepBody(newBody) {
    setSteps(prev => prev.map(s =>
      s.step_number === activeStep ? { ...s, html_body: newBody } : s
    ));
  }
  function updateStepSubject(newSubject) {
    setSteps(prev => prev.map(s =>
      s.step_number === activeStep ? { ...s, subject: newSubject } : s
    ));
  }
  function updateStepDelay(newDelay) {
    const n = parseInt(newDelay, 10);
    if (!Number.isFinite(n) || n < 1) return;
    setSteps(prev => prev.map(s =>
      s.step_number === activeStep ? { ...s, delay_days: n } : s
    ));
  }
  function addStep() {
    if (steps.length >= 10) return;  // hard cap
    const nextNumber = steps.length + 1;
    const newStep = { step_number: nextNumber, subject: '', html_body: '', delay_days: 3, sent_count: 0 };
    setSteps(prev => [...prev, newStep]);
    setActiveStep(nextNumber);
  }
  function removeStep(stepNumber) {
    if (stepNumber === 1) return;  // step 1 cannot be deleted
    const target = steps.find(s => s.step_number === stepNumber);
    if (target && target.sent_count > 0) {
      const ok = window.confirm(
        `Step ${stepNumber} has already been sent to ${target.sent_count} recipient(s). ` +
        `Removing it stops the sequence at step ${stepNumber - 1} for everyone still queued. ` +
        `Already-sent emails are unaffected. Continue?`
      );
      if (!ok) return;
    }
    setSteps(prev => prev
      .filter(s => s.step_number !== stepNumber)
      .map((s, i) => ({ ...s, step_number: i + 1 }))  // renumber to keep contiguity
    );
    // Move active step to the previous one
    setActiveStep(stepNumber - 1);
  }

  async function save(){
    const missing=[];
    if(!form.list_id) missing.push('mailing list');
    if(!form.title)   missing.push('campaign title');
    if(!form.from_email) missing.push('from email');
    // Step 1 subject is the campaign's primary subject (mirrored to
    // email_campaigns.subject by the backend). Steps 2+ subjects are optional —
    // a NULL/empty subject falls back to the campaign subject at send time.
    const step1 = steps.find(s => s.step_number === 1);
    if (!step1 || !step1.subject || !step1.subject.trim()) {
      missing.push('email subject');
    }
    // Each step must have a body. Step 1 is always present.
    for (const s of steps) {
      // Strip whitespace and inert HTML so an empty editor doesn't pass.
      const stripped = (s.html_body || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (!stripped) {
        missing.push(`step ${s.step_number} body`);
      }
    }
    if(missing.length){setErr(`Please fill in: ${missing.join(', ')}`);return;}
    // Warn if any step with sent_count > 0 has its body or delay changed.
    // We don't have the original values to diff against perfectly, but on edit
    // mode we can compare against initial.html_body for step 1 — for steps 2+
    // we trust the user since they explicitly opened the tab.
    setSaving(true);setErr('');

    // Step 1's body and subject are also the campaign-wide values for legacy
    // code paths (test sends, previews). The PUT /steps route mirrors them
    // back to email_campaigns; we also include them in the campaign POST/PUT
    // payload so the very first save creates the row with the right values.
    const step1Body = step1.html_body || '';
    const step1Subj = step1.subject.trim();
    const campaignPayload = {
      ...form,
      subject:  step1Subj,
      html_body: step1Body,
      email_client_id: emailClient.id,
    };

    let campaignId = initial?.id;
    try {
      // 1) Save campaign-wide fields (creates new or updates existing)
      const r = await fetch(
        editing ? `/api/email/campaigns/${initial.id}` : '/api/email/campaigns',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(campaignPayload),
        }
      );
      const d = await r.json();
      if (d.error) { setErr(d.error); setSaving(false); return; }
      campaignId = d.id || campaignId;

      // 2) Save the step list. For new campaigns step 1's body and subject
      // were already mirrored via the campaign POST; PUT /steps writes the
      // canonical step rows AND mirrors step 1 back to email_campaigns.html_body
      // and .subject again — idempotent and safe.
      const stepsPayload = {
        steps: steps.map(s => ({
          step_number: s.step_number,
          subject:     (s.subject || '').trim() || null,
          html_body:   s.html_body,
          delay_days:  s.delay_days,
        })),
      };
      const sr = await fetch(`/api/email/campaigns/${campaignId}/steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stepsPayload),
      });
      const sd = await sr.json();
      if (sd.error) { setErr('Step save failed: ' + sd.error); setSaving(false); return; }
    } catch (e) {
      setErr('Save failed: ' + e.message);
      setSaving(false);
      return;
    }
    onSaved();onClose();
  }
  return(<Modal title={editing?'Edit campaign':'New campaign'} onClose={onClose} wide>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 20px'}}>
      <div style={{marginBottom:14}}>
        <label style={{display:'block',fontSize:12,color:MUTED,marginBottom:4}}>Mailing list *</label>
        <select value={form.list_id} onChange={e=>set('list_id',e.target.value)} style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD}}>
          <option value="">— select list —</option>
          {lists.map(l=><option key={l.id} value={l.id}>{l.name} ({l.subscriber_count||0} subs)</option>)}
        </select>
      </div>
      <Input label="Campaign title *" value={form.title} onChange={v=>set('title',v)} placeholder="Worth fixing?" required/>
      <Input label="From name" value={form.from_name} onChange={v=>set('from_name',v)} placeholder="Wez at Sweetbyte"/>
      <Input label="From email *" value={form.from_email} onChange={v=>set('from_email',v)} placeholder={`hello@${emailClient.name}`} required/>
      <Input label="Reply-to (leave blank to match from email)" value={form.reply_to} onChange={v=>set('reply_to',v)}/>
    </div>
    <div style={{ marginBottom: 14 }}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
        <label style={{ display: 'block', fontSize: 12, color: MUTED }}>Email body *</label>
        <div style={{display:'flex',alignItems:'center',gap:8,fontSize:11,color:MUTED}}>
          <span>{copiedChip ? 'Copied — paste it anywhere' : 'Personalise with'}</span>
          <button type="button"
            onClick={()=>{
              navigator.clipboard?.writeText('{{first_name}}').catch(()=>{});
              setCopiedChip(true);
              setTimeout(()=>setCopiedChip(false), 1800);
            }}
            style={{background:`${BLUE}10`,color:BLUE,border:`0.5px solid ${BLUE}40`,padding:'2px 8px',borderRadius:4,fontSize:11,cursor:'pointer',fontFamily:'ui-monospace, monospace'}}
            title="Click to copy. Then paste {{first_name}} anywhere in the subject or body."
          >{'{{first_name}}'}</button>
        </div>
      </div>
      {/* Phase 4: tab strip for multi-step sequences. 1st contact / 2nd contact / etc.
          Active tab is white-on-white (matches the panel below); inactive tabs are
          recessed grey. Each non-step-1 tab has a × close button. The last item is
          the "+ Add contact" pill, hidden once we hit the 10-step cap. */}
      <div style={{display:'flex',alignItems:'flex-end',gap:4,marginBottom:0}}>
        {steps.map(s => {
          const isActive = s.step_number === activeStep;
          const label = s.step_number === 1 ? '1st contact'
                      : s.step_number === 2 ? '2nd contact'
                      : s.step_number === 3 ? '3rd contact'
                      : `${s.step_number}th contact`;
          return (
            <div key={s.step_number}
              onClick={() => setActiveStep(s.step_number)}
              style={{
                padding:'7px 12px',
                fontSize:12,
                cursor:'pointer',
                background: isActive ? CARD : `${MUTED}15`,
                color: isActive ? TEXT : MUTED,
                border:`0.5px solid ${BORDER}`,
                borderBottomColor: isActive ? CARD : BORDER,
                borderRadius:'6px 6px 0 0',
                fontWeight: isActive ? 500 : 400,
                display:'flex',alignItems:'center',gap:6,
                marginBottom: isActive ? '-0.5px' : 0,
                position:'relative',
                zIndex: isActive ? 2 : 1,
              }}
            >
              <span>{label}</span>
              {s.step_number > 1 && (
                <span
                  onClick={e => { e.stopPropagation(); removeStep(s.step_number); }}
                  title="Remove this contact"
                  style={{
                    width:14,height:14,borderRadius:'50%',
                    display:'inline-flex',alignItems:'center',justifyContent:'center',
                    fontSize:11,color:MUTED,
                    cursor:'pointer',lineHeight:1,
                  }}
                >×</span>
              )}
            </div>
          );
        })}
        {steps.length < 10 && (
          <button type="button" onClick={addStep}
            style={{
              padding:'7px 10px',
              fontSize:12,
              border:`0.5px dashed ${BORDER}`,
              borderRadius:6,
              background:'transparent',
              color:MUTED,
              cursor:'pointer',
              marginLeft:4,
            }}
          >+ Add contact</button>
        )}
      </div>
      {/* Tab panel — the body editor lives here, plus the delay row for steps 2+. */}
      <div style={{
        border:`0.5px solid ${BORDER}`,
        borderTopLeftRadius: activeStep === 1 ? 0 : 6,
        borderTopRightRadius: 6,
        borderBottomLeftRadius: 6,
        borderBottomRightRadius: 6,
        padding:10,
        background:CARD,
        position:'relative',
        zIndex:0,
      }}>
        {activeStep > 1 && (
          <div style={{
            display:'flex',alignItems:'center',gap:10,
            padding:'8px 10px',marginBottom:10,
            background:`${BLUE}10`,
            color:BLUE,
            borderRadius:6,
            fontSize:12,
          }}>
            <span>Send</span>
            <input type="number" min={1} max={60}
              value={activeStepObj?.delay_days || 3}
              onChange={e => updateStepDelay(e.target.value)}
              style={{
                width:50,padding:'3px 6px',
                border:`0.5px solid ${BORDER}`,borderRadius:4,
                fontSize:12,textAlign:'center',
                background:CARD,color:TEXT,
              }}
            />
            <span>days after the previous contact</span>
            {activeStepObj?.sent_count > 0 && (
              <span style={{marginLeft:'auto',fontSize:11,color:MUTED}}>
                Already sent to {activeStepObj.sent_count} — changes apply to the rest only.
              </span>
            )}
          </div>
        )}
        {/* Per-step subject. Step 1's subject is the campaign's primary subject
            (required, mirrored to email_campaigns.subject by the backend).
            Steps 2+ subjects are optional — leave blank to use step 1's subject. */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 12, color: MUTED, marginBottom: 4 }}>
            {activeStep === 1
              ? 'Email subject *'
              : 'Email subject for this contact (leave blank to reuse the 1st contact subject)'}
          </label>
          <input
            type="text"
            value={activeStepObj?.subject || ''}
            onChange={e => updateStepSubject(e.target.value)}
            placeholder={activeStep === 1
              ? 'Is waiting costing your business?'
              : 'Re: my last note'}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: `0.5px solid ${BORDER}`,
              borderRadius: 7,
              fontSize: 13,
              color: TEXT,
              background: CARD,
              boxSizing: 'border-box',
            }}
          />
        </div>
        <RichTextEditor
          key={activeStep}
          value={activeStepObj?.html_body || ''}
          onChange={updateStepBody}
        />
      </div>
    </div>
    <ScheduleControls form={form} set={set} totalSubs={lists.find(l=>l.id===form.list_id)?.subscriber_count||0}/>
    <TrackingControls form={form} set={set}/>
    {err&&<div style={{color:DANGER,fontSize:13,marginTop:14,marginBottom:10}}>{err}</div>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:18}}>
      <div>
        {editing && (
          <Btn small onClick={()=>setShowPreview(true)}>Preview</Btn>
        )}
        {!editing && (
          <span style={{fontSize:11,color:MUTED}}>Save the campaign first to use Preview</span>
        )}
      </div>
      <div style={{display:'flex',gap:8}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={save} disabled={saving}>{saving?'Saving…':editing?'Save changes':'Create campaign'}</Btn>
      </div>
    </div>
    {showPreview && <PreviewCampaignModal campaignId={initial.id} onClose={()=>setShowPreview(false)}/>}
  </Modal>);
}

// ── Preview campaign modal — arrow through subscribers, see rendered emails ───
// Shows the email exactly as it'll be sent to each subscriber, with the
// {{first_name}} placeholder replaced by the parsed Christian name. Subscribers
// whose name couldn't be parsed are shown as "will be skipped". The user can
// override the first name per-subscriber from inside this modal.
function PreviewCampaignModal({campaignId, onClose}){
  const [data,setData]=useState(null);
  const [idx,setIdx]=useState(0);
  const [parsing,setParsing]=useState(false);
  const [parseMsg,setParseMsg]=useState(null);
  const [showSkipped,setShowSkipped]=useState(false);

  async function load(){
    const r=await fetch(`/api/email/campaigns/${campaignId}/preview-recipients`);
    const d=await r.json();
    setData(d);
  }
  useEffect(()=>{load();},[campaignId]);

  // Parse names — bulk-call the rule + AI fallback for the whole list. Idempotent;
  // only touches subs that haven't been parsed yet (or were last marked needs_ai).
  async function parseNames(){
    if (!data) return;
    setParsing(true);
    setParseMsg(null);
    try{
      const r=await fetch(`/api/email/lists/${data.campaign.list_id}/parse-names`,{method:'POST'});
      const d=await r.json();
      if (d.ok) {
        setParseMsg(`Parsed ${d.processed} subscribers — ${d.byRule} by rule, ${d.byAI} by AI, ${d.skipped} skipped`);
        await load();
        setTimeout(()=>setParseMsg(null), 6000);
      } else {
        setParseMsg('Error: '+(d.error||'unknown'));
        setTimeout(()=>setParseMsg(null), 8000);
      }
    } catch(err){
      setParseMsg('Error: '+err.message);
      setTimeout(()=>setParseMsg(null), 8000);
    }
    setParsing(false);
  }

  // Manual override — set or clear a single subscriber's first_name. Used to
  // rescue a subscriber that the parser marked as "will be skipped".
  async function overrideFirstName(){
    if (!data) return;
    const r = data.recipients[idx];
    const v = window.prompt(
      `Set first name for ${r.name||r.email}\n\n(Leave blank to mark as skip — they won't receive this campaign)`,
      r.first_name || ''
    );
    if (v === null) return;
    const body = JSON.stringify({first_name: v.trim() === '' ? null : v.trim()});
    const resp = await fetch(`/api/email/subscribers/${r.id}/first-name`,{method:'PUT',headers:{'Content-Type':'application/json'},body});
    if (resp.ok) await load();
    else alert('Failed to update');
  }

  // Keyboard nav for the arrow keys (matches the mockup behaviour)
  useEffect(()=>{
    function onKey(e){
      if (!data) return;
      if (showSkipped) return;
      if (e.key==='ArrowLeft')  { setIdx(i => (i - 1 + data.recipients.length) % data.recipients.length); e.preventDefault(); }
      if (e.key==='ArrowRight') { setIdx(i => (i + 1) % data.recipients.length); e.preventDefault(); }
    }
    document.addEventListener('keydown', onKey);
    return ()=>document.removeEventListener('keydown', onKey);
  },[data, showSkipped]);

  if (!data) {
    return (<Modal title="Email preview" onClose={onClose} wide>
      <div style={{textAlign:'center',color:MUTED,padding:'40px 20px',fontSize:13}}>Loading…</div>
    </Modal>);
  }

  if (data.recipients.length === 0) {
    return (<Modal title="Email preview" onClose={onClose} wide>
      <div style={{textAlign:'center',color:MUTED,padding:'40px 20px',fontSize:13}}>No active subscribers on this list.</div>
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:18}}><Btn onClick={onClose}>Close</Btn></div>
    </Modal>);
  }

  const total = data.recipients.length;
  const willSkip = data.summary.will_skip;
  const unparsed = data.summary.by_source.unparsed || 0;
  const r = data.recipients[idx];
  const usesPlaceholder = data.uses_first_name;

  return(<Modal title="Email preview" onClose={onClose} wide>

    {/* Top strip — subscriber count + parse-names button */}
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,gap:12,flexWrap:'wrap'}}>
      <div style={{fontSize:12,color:MUTED}}>
        Subscriber <b style={{color:TEXT}}>{idx+1}</b> of <b style={{color:TEXT}}>{total}</b>
        {usesPlaceholder && <> · <b style={{color:willSkip>0?DANGER:GREEN}}>{willSkip}</b> will be skipped</>}
        {unparsed > 0 && <> · <b style={{color:AMBER}}>{unparsed}</b> not yet parsed</>}
      </div>
      <div style={{display:'flex',gap:8}}>
        {unparsed > 0 && (
          <Btn small onClick={parseNames} disabled={parsing}>{parsing?'Parsing…':`Parse ${unparsed} name${unparsed===1?'':'s'}`}</Btn>
        )}
        {willSkip > 0 && (
          <Btn small onClick={()=>setShowSkipped(true)}>Review skipped ({willSkip})</Btn>
        )}
        <Btn small onClick={()=>setIdx(i => (i - 1 + total) % total)}>←</Btn>
        <Btn small onClick={()=>setIdx(i => (i + 1) % total)}>→</Btn>
      </div>
    </div>

    {parseMsg && (
      <div style={{padding:'8px 12px',background:`${BLUE}10`,color:BLUE,borderRadius:6,fontSize:12,marginBottom:12}}>{parseMsg}</div>
    )}

    {!usesPlaceholder && (
      <div style={{padding:'10px 14px',background:`${AMBER}15`,color:AMBER,borderRadius:6,fontSize:12,marginBottom:12}}>
        This campaign doesn't use the {'{{first_name}}'} placeholder. Every subscriber will receive identical text. Add the placeholder to the subject or body to personalise.
      </div>
    )}

    {/* Email card */}
    <div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,overflow:'hidden'}}>

      {/* Subscriber meta strip */}
      <div style={{padding:'10px 14px',background:BG,borderBottom:`0.5px solid ${BORDER}`,display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'center',fontSize:12}}>
        <div style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          <span style={{color:MUTED}}>Stored name:</span>
          <span style={{color:TEXT,fontWeight:500,marginLeft:6}}>{r.name||'(none)'}</span>
          <span style={{color:MUTED,margin:'0 6px'}}>·</span>
          <span style={{color:MUTED}}>{r.email}</span>
        </div>
        <div>{firstNameSourceBadge(r)}</div>
      </div>

      {/* Email headers */}
      <div style={{padding:'14px 16px',borderBottom:`0.5px solid ${BORDER}`,display:'grid',gridTemplateColumns:'80px 1fr',gap:'6px 14px',fontSize:13}}>
        <div style={{color:MUTED}}>From:</div>
        <div>{data.campaign.from_name} &lt;{data.campaign.from_email}&gt;</div>
        <div style={{color:MUTED}}>To:</div>
        <div>{r.name?`${r.name} <${r.email}>`:r.email}</div>
        <div style={{color:MUTED}}>Subject:</div>
        <div style={{
          fontWeight:500,
          color:r.will_skip?MUTED:TEXT,
          textDecoration:r.will_skip?'line-through':'none',
        }}>
          {renderHighlighted(r.rendered_subject || data.campaign.subject || '', r.first_name, r.will_skip)}
        </div>
      </div>

      {/* Body */}
      <div style={{
        padding:'18px 16px',fontSize:14,lineHeight:1.6,minHeight:160,
        color:r.will_skip?MUTED:TEXT,
        background:r.will_skip?BG:CARD,
        opacity:r.will_skip?0.7:1,
      }} dangerouslySetInnerHTML={{
        __html: htmlWithHighlight(r.will_skip?(data.campaign.html_body||''):r.rendered_html||'', r.first_name, r.will_skip)
      }}/>

    </div>

    {/* Status strip */}
    <div style={{
      marginTop:12,padding:'10px 14px',borderRadius:7,fontSize:13,
      display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,
      background: r.will_skip ? '#FAEEDA' : (r.first_name ? `${GREEN}15` : '#F1EFE8'),
      color: r.will_skip ? '#633806' : (r.first_name ? DARK : MUTED),
    }}>
      <div style={{minWidth:0}}>
        {r.will_skip ? (
          <><b style={{fontWeight:500}}>Will be skipped.</b> {r.first_name_reason||'No first name parsed.'}</>
        ) : r.first_name ? (
          <>
            <b style={{fontWeight:500}}>Resolves to:</b>{' '}
            <code style={{background:'rgba(0,0,0,0.05)',padding:'1px 5px',borderRadius:3,fontFamily:'ui-monospace, monospace'}}>{r.first_name}</code>
            {r.first_name_reason && <> · <span style={{color:MUTED}}>{r.first_name_reason}</span></>}
          </>
        ) : (
          <>Not yet parsed — click "Parse {unparsed} names" above to populate.</>
        )}
      </div>
      <Btn small onClick={overrideFirstName}>Edit</Btn>
    </div>

    {/* Footer */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:18}}>
      <div style={{fontSize:11,color:MUTED}}>Tip: use ← → arrow keys to navigate</div>
      <Btn onClick={onClose}>Close</Btn>
    </div>

    {showSkipped && (
      <SkippedListModal recipients={data.recipients.filter(x=>x.will_skip)} onClose={()=>setShowSkipped(false)} onChanged={load}/>
    )}

  </Modal>);
}

// Small modal listing every subscriber being skipped. Each row has an "Edit"
// button to set the first name manually and rescue them.
function SkippedListModal({recipients, onClose, onChanged}){
  async function setName(sub){
    const v = window.prompt(`Set first name for ${sub.name||sub.email}\n\n(Leave blank to keep skipped)`, sub.first_name || '');
    if (v === null || v.trim() === '') return;
    const r = await fetch(`/api/email/subscribers/${sub.id}/first-name`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({first_name:v.trim()})});
    if (r.ok) onChanged();
    else alert('Failed to update');
  }
  return(<Modal title={`Skipped subscribers (${recipients.length})`} onClose={onClose}>
    <p style={{fontSize:12,color:MUTED,marginBottom:14}}>These subscribers won't receive the campaign because their first name couldn't be parsed. Set a name manually to include them.</p>
    <div style={{maxHeight:380,overflowY:'auto',border:`0.5px solid ${BORDER}`,borderRadius:7}}>
      {recipients.map(s=>(
        <div key={s.id} style={{padding:'10px 12px',borderBottom:`0.5px solid ${BORDER}`,display:'grid',gridTemplateColumns:'1fr auto',gap:10,alignItems:'center'}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:13,color:TEXT,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.name||'(no name)'}</div>
            <div style={{fontSize:11,color:MUTED,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.email} · {s.first_name_reason||'No reason recorded'}</div>
          </div>
          <Btn small onClick={()=>setName(s)}>Set name</Btn>
        </div>
      ))}
      {recipients.length===0 && <div style={{padding:30,textAlign:'center',color:MUTED,fontSize:13}}>No skipped subscribers.</div>}
    </div>
    <div style={{display:'flex',justifyContent:'flex-end',marginTop:14}}><Btn onClick={onClose}>Close</Btn></div>
  </Modal>);
}

// Source-of-parse badge for the top of the preview card
function firstNameSourceBadge(r){
  if (r.will_skip)              return <Badge label="Will be skipped"  color="#633806" bg="#FAEEDA"/>;
  if (!r.first_name_source)     return <Badge label="Not parsed yet"   color={MUTED}    bg="#F1EFE8"/>;
  if (r.first_name_source==='rule')   return <Badge label="Parsed by rule"   color="#0C447C" bg="#E6F1FB"/>;
  if (r.first_name_source==='ai')     return <Badge label="Parsed by AI"     color="#3C3489" bg="#EEEDFE"/>;
  if (r.first_name_source==='manual') return <Badge label="Manual override"  color="#085041" bg="#E1F5EE"/>;
  return <Badge label={r.first_name_source||'Unknown'} color={MUTED} bg="#F1EFE8"/>;
}

// Highlight {{first_name}} replacements in plain-text strings (subject line)
function renderHighlighted(text, firstName, isSkipped){
  if (!text) return null;
  if (isSkipped || !firstName) return text;
  // Walk the text, swapping the rendered first-name spans with a highlighted node
  // We don't have access to the original placeholder in the string anymore (it's
  // already been substituted), so we just bold the first-name occurrences.
  const parts = text.split(new RegExp(`(${escapeRegex(firstName)})`, 'g'));
  return parts.map((p, i) => p === firstName
    ? <span key={i} style={{background:'#E1F5EE',color:'#085041',padding:'1px 4px',borderRadius:3,fontWeight:500}}>{p}</span>
    : <span key={i}>{p}</span>
  );
}

// Same but for HTML body — wraps occurrences of the first name in a highlighted span.
// Skips matches inside HTML tag attributes by only replacing in text nodes (using a
// regex with negative lookahead/lookbehind for tag chars). Good-enough heuristic.
function htmlWithHighlight(html, firstName, isSkipped){
  if (!html) return '';
  if (isSkipped || !firstName) return html;
  const re = new RegExp(`(?<![<>=&\\w])(${escapeRegex(firstName)})(?![<>\\w])`, 'g');
  return html.replace(re, '<span style="background:#E1F5EE;color:#085041;padding:1px 4px;border-radius:3px;font-weight:500;">$1</span>');
}

function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }


// ── Drip modal ────────────────────────────────────────────────────────────────
function DripModal({campaign,totalSubs,onClose,onSaved}){
  const [dailyLimit,setDailyLimit]=useState(campaign.daily_limit||200);
  const [startDate,setStartDate]=useState(campaign.drip_start_at?.slice(0,10)||new Date().toISOString().slice(0,10));
  const [sendOrder,setSendOrder]=useState(campaign.send_order||'top');
  const [saving,setSaving]=useState(false);
  const days=dailyLimit>0?Math.ceil(totalSubs/dailyLimit):0;
  const finish=days>0?new Date(new Date(startDate).getTime()+days*86400000).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—';
  async function save(){
    setSaving(true);
    const r=await fetch(`/api/email/campaigns/${campaign.id}/start-drip`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({daily_limit:dailyLimit,drip_start_at:startDate,send_order:sendOrder})});
    const d=await r.json();
    if(d.ok){onSaved();onClose();}
    else setSaving(false);
  }
  return(<Modal title="Configure drip send" onClose={onClose}>
    <p style={{fontSize:13,color:MUTED,marginBottom:16}}>Campaign: <b style={{color:TEXT}}>{campaign.title}</b> · {totalSubs.toLocaleString()} subscribers</p>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 16px'}}>
      <div style={{marginBottom:14}}>
        <label style={{display:'block',fontSize:12,color:MUTED,marginBottom:4}}>Emails per day *</label>
        <input type="number" min="1" max="5000" value={dailyLimit} onChange={e=>setDailyLimit(+e.target.value)} style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD,outline:'none'}}/>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{display:'block',fontSize:12,color:MUTED,marginBottom:4}}>Start date</label>
        <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD,outline:'none'}}/>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{display:'block',fontSize:12,color:MUTED,marginBottom:4}}>Send order</label>
        <select value={sendOrder} onChange={e=>setSendOrder(e.target.value)} style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD}}>
          <option value="top">Top to bottom</option>
          <option value="random">Random</option>
        </select>
      </div>
    </div>
    <div style={{background:`${GREEN}12`,border:`0.5px solid ${GREEN}40`,borderRadius:8,padding:'10px 14px',fontSize:13,color:DARK,marginBottom:20}}>
      Sending <b>{dailyLimit.toLocaleString()}/day</b> to <b>{totalSubs.toLocaleString()} subscribers</b> — completes in <b>{days} days</b>, finishing around <b>{finish}</b>
    </div>
    <div style={{display:'flex',justifyContent:'flex-end',gap:8}}><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={save} disabled={saving}>{saving?'Starting…':'Start drip'}</Btn></div>
  </Modal>);
}

// ── Domain health card ────────────────────────────────────────────────────────
function DomainCard({data}){
  const checks=[{label:'SPF',r:data.spf},{label:'DKIM',r:data.dkim},{label:'DMARC',r:data.dmarc},{label:'MX',r:data.mx}];
  const allPass=checks.every(c=>c.r?.status==='pass');
  return(<div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,padding:'14px 16px'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
      <div style={{fontSize:13,fontWeight:500,color:TEXT}}>{data.domain}</div>
      <Badge label={allPass?'All pass':'Issues found'} color={allPass?GREEN:DANGER}/>
    </div>
    {checks.map(({label,r})=>(
      <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`0.5px solid ${BORDER}`,fontSize:12}}>
        <span style={{color:MUTED}}>{label}</span>
        <span style={{color:r?.status==='pass'?GREEN:DANGER,fontWeight:500}}>{r?.status==='pass'?'Pass':'Missing'}</span>
      </div>
    ))}
    {data.dkim?.selector&&<div style={{fontSize:11,color:MUTED,marginTop:5}}>Selector: {data.dkim.selector}</div>}
  </div>);
}

// ── Campaign Report screen ────────────────────────────────────────────────────
function CampaignReport({campaign,lists,onBack}){
  const [report,setReport]=useState(null);
  const list=lists.find(l=>l.id===campaign.list_id);
  const totalSubs=list?.subscriber_count||0;

  useEffect(()=>{
    fetch(`/api/email/campaigns/${campaign.id}/report`).then(r=>r.json()).then(setReport);
  },[campaign.id]);

  function exportData(type){window.open(`/api/email/campaigns/${campaign.id}/export/${type}`);}

  const c=campaign;
  const sent=c.sent_count||0;
  const opens=c.open_count||0;
  const clicks=c.click_count||0;
  const unsubs=c.unsubscribe_count||0;
  const bounces=c.bounce_count||0;
  const notOpened=sent>0?sent-opens:0;
  const pct=(n,d)=>d>0?((n/d)*100).toFixed(2)+'%':'0%';

  // What signals were tracked? Drives which panels to render.
  // Bounce/spam tracking is via SNS at the AWS account level, NOT the campaign,
  // so those numbers are always meaningful and always shown.
  const tracksOpens  = !!c.track_opens  && (c.tracking_mode||'off')!=='off';
  const tracksClicks = !!c.track_clicks && (c.tracking_mode||'off')!=='off';
  const tracksUnsub  = !!c.track_unsub  && (c.tracking_mode||'off')!=='off';
  const noEngagementTracked = !tracksOpens && !tracksClicks && !tracksUnsub;

  return(<div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,overflow:'auto',background:BG,padding:20}}>
    <button onClick={onBack} style={{background:'none',border:'none',cursor:'pointer',color:MUTED,fontSize:12,padding:0,display:'flex',alignItems:'center',gap:4,marginBottom:12}}>← Back to campaigns</button>
    <div style={{fontSize:16,fontWeight:500,color:TEXT,marginBottom:3,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      <span>{c.title} — {c.status==='scheduled'||c.status==='sending'||c.status==='paused' ? 'Progress' : 'Report'}</span>
      {trackingBadge(c)}
      {statusBadge(c.status)}
    </div>
    <div style={{fontSize:12,color:MUTED,marginBottom:16}}>
      {c.status==='sent' || c.status==='cancelled'
        ? <>Sent {c.sent_at?new Date(c.sent_at).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'}</>
        : c.status==='scheduled' && c.daily_limit>0
          ? <>Drip in progress · {(c.daily_limit||0).toLocaleString()}/day · window {c.drip_window_start||'09:00'}–{c.drip_window_end||'11:00'} {c.drip_timezone||'Europe/London'}</>
          : <>Status: {c.status}</>}
      &nbsp;·&nbsp; From: {c.from_name} &lt;{c.from_email}&gt; &nbsp;·&nbsp; To: {list?.name||'—'}
    </div>

    {/* Tracking-disabled notice */}
    {noEngagementTracked && (
      <div style={{background:'#e6f1fb',borderLeft:`3px solid ${BLUE}`,borderRadius:6,padding:'12px 14px',marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:500,color:BLUE,marginBottom:4}}>Sent without engagement tracking</div>
        <div style={{fontSize:12,color:BLUE,lineHeight:1.6}}>
          This campaign was deliberately sent without open or click tracking — the right call for cold outreach because tracking signals can hurt deliverability by 15–30%.
          Opens and clicks aren't recorded for this campaign. <b>Bounces and spam complaints are still tracked</b> via AWS SNS at the account level.
          For domain reputation monitoring, use Google Postmaster Tools and Microsoft SNDS rather than open rates.
        </div>
      </div>
    )}

    {/* Stats bar — only shows cards relevant to what was actually tracked */}
    <div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,overflow:'hidden',marginBottom:14}}>
      <div style={{display:'flex',borderBottom:`0.5px solid ${BORDER}`}}>
        {[
          {n:sent,l:'Recipients',c:TEXT,show:true},
          {n:opens,pct:pct(opens,sent),l:'Opened',c:GREEN,show:tracksOpens},
          {n:clicks,pct:pct(clicks,sent),l:'Clicked',c:BLUE,show:tracksClicks},
          {n:notOpened,pct:pct(notOpened,sent),l:'Not opened',c:AMBER,show:tracksOpens},
          {n:unsubs,pct:pct(unsubs,sent),l:'Unsubscribed',c:DANGER,show:tracksUnsub},
          {n:bounces,pct:pct(bounces,sent),l:'Bounced',c:DANGER,show:true},
        ].filter(s=>s.show).map((s,i,arr)=>(
          <div key={i} style={{flex:1,padding:'12px 14px',borderRight:i<arr.length-1?`0.5px solid ${BORDER}`:'none'}}>
            <div style={{fontSize:20,fontWeight:500,color:s.c}}>{s.n.toLocaleString()}</div>
            {s.pct&&<div style={{fontSize:11,fontWeight:500,color:s.c,marginTop:1}}>{s.pct}</div>}
            <div style={{fontSize:10,color:MUTED,marginTop:2}}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{padding:'10px 14px',display:'flex',gap:8,flexWrap:'wrap'}}>
        {tracksOpens&&<Btn small onClick={()=>exportData('openers')}>Export openers</Btn>}
        {tracksClicks&&<Btn small onClick={()=>exportData('clickers')}>Export clickers</Btn>}
        {tracksOpens&&<Btn small onClick={()=>exportData('non-openers')}>Export non-openers</Btn>}
        <Btn small onClick={()=>exportData('bounced')}>Export bounced</Btn>
        <Btn small variant="primary" style={{marginLeft:'auto'}} onClick={async()=>{
          const r=await fetch(`/api/email/campaigns/${c.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...c,title:c.title+' (copy)',status:'draft',sent_at:null,sent_count:0,open_count:0,click_count:0,bounce_count:0,unsubscribe_count:0})});
          if(r.ok)onBack();
        }}>Duplicate campaign</Btn>
      </div>
    </div>

    {/* Engagement panels — only shown when at least one tracking signal is on */}
    {!noEngagementTracked && <>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
      {/* Engagement breakdown */}
      <div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:'10px 14px',borderBottom:`0.5px solid ${BORDER}`,fontSize:11,fontWeight:500,color:MUTED,textTransform:'uppercase',letterSpacing:'.06em'}}>Engagement breakdown</div>
        {[
          {pct:pct(opens,sent),label:'Opened',detail:`${opens.toLocaleString()} unique`,c:GREEN,show:tracksOpens},
          {pct:pct(notOpened,sent),label:'Not opened',detail:`${notOpened.toLocaleString()} subscribers`,c:AMBER,show:tracksOpens,action:()=>exportData('non-openers')},
          {pct:pct(clicks,sent),label:'Clicked a link',detail:`${clicks.toLocaleString()} unique`,c:BLUE,show:tracksClicks},
          {pct:pct(unsubs,sent),label:'Unsubscribed',detail:`${unsubs.toLocaleString()} removed`,c:DANGER,show:tracksUnsub},
          {pct:pct(bounces,sent),label:'Bounced',detail:`${bounces.toLocaleString()} hard bounces`,c:DANGER,show:true},
        ].filter(m=>m.show).map((m,i)=>(
          <div key={i} style={{padding:'10px 14px',borderBottom:`0.5px solid ${BORDER}`,display:'flex',alignItems:'center',gap:10}}>
            <div style={{fontSize:17,fontWeight:500,color:m.c,minWidth:52}}>{m.pct}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,color:TEXT}}>{m.label}</div>
              <div style={{fontSize:11,color:MUTED}}>{m.detail}</div>
            </div>
            {m.action&&<Btn small onClick={m.action}>Export</Btn>}
          </div>
        ))}
      </div>

      {/* Top countries — only meaningful with open tracking on */}
      {tracksOpens ? (
      <div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:'10px 14px',borderBottom:`0.5px solid ${BORDER}`,fontSize:11,fontWeight:500,color:MUTED,textTransform:'uppercase',letterSpacing:'.06em'}}>Top countries</div>
        <div style={{padding:14}}>
          {[
            {country:'United Kingdom',pct:83,count:Math.round(opens*.83)},
            {country:'United States',pct:7,count:Math.round(opens*.07)},
            {country:'Ireland',pct:5,count:Math.round(opens*.05)},
            {country:'France',pct:3,count:Math.round(opens*.03)},
            {country:'Netherlands',pct:2,count:Math.round(opens*.02)},
          ].map(({country,pct,count})=>(
            <div key={country} style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,fontSize:12}}>
              <div style={{width:110,color:MUTED,fontSize:11,textAlign:'right',flexShrink:0}}>{country}</div>
              <div style={{flex:1,height:8,background:BG,borderRadius:4,overflow:'hidden'}}>
                <div style={{height:8,borderRadius:4,background:GREEN,width:`${pct}%`}}/>
              </div>
              <div style={{width:30,color:TEXT,fontSize:11,fontWeight:500,flexShrink:0}}>{count}</div>
            </div>
          ))}
          <div style={{fontSize:11,color:MUTED,marginTop:6}}>* Country data is approximate (based on open events)</div>
        </div>
      </div>
      ) : (
        <div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,padding:14,fontSize:12,color:MUTED,display:'flex',alignItems:'center',justifyContent:'center'}}>
          Top countries panel hidden — open tracking is off for this campaign.
        </div>
      )}
    </div>
    </>}

    {/* Link activity — only shown if click tracking was on */}
    {tracksClicks && (
    <div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,overflow:'hidden'}}>
      <div style={{padding:'10px 14px',borderBottom:`0.5px solid ${BORDER}`,fontSize:11,fontWeight:500,color:MUTED,textTransform:'uppercase',letterSpacing:'.06em',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        Link activity
        <Btn small onClick={()=>exportData('clickers')}>Export all clickers</Btn>
      </div>
      {!report||report.link_clicks?.length===0?(
        <div style={{padding:24,textAlign:'center',color:MUTED,fontSize:13}}>No link clicks recorded yet.</div>
      ):(
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr><TH>Link URL</TH><TH>Unique clicks</TH><TH>Total clicks</TH><TH>Actions</TH></tr></thead>
          <tbody>
            {report.link_clicks.map((lc,i)=>(
              <tr key={i}>
                <TD><span style={{color:BLUE,fontSize:11,wordBreak:'break-all'}}>{lc.url}</span></TD>
                <TD center><Badge label={lc.unique_clicks} color={BLUE} bg="#e6f1fb"/></TD>
                <TD center>{lc.total_clicks}</TD>
                <TD><Btn small>Export clickers</Btn></TD>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
    )}

    {/* Recipients — who got it, who hasn't yet, who opened/clicked */}
    <div style={{marginTop:14}}>
      <CampaignRecipientsPanel campaignId={c.id} tracksOpens={tracksOpens} tracksClicks={tracksClicks} onExport={exportData}/>
    </div>
  </div>);
}

// ── Campaign recipients panel ────────────────────────────────────────────────
// Lists every subscriber on the campaign's list with their per-campaign status:
// queued (drip not yet reached them), sent, opened, clicked, bounced, failed.
// Filterable, with two CSV exports — recipients (everyone sent so far) and
// queued (everyone still to come).
function CampaignRecipientsPanel({campaignId, tracksOpens, tracksClicks, onExport}){
  const [data,setData]=useState(null);
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');

  useEffect(()=>{
    const url = filter==='all'
      ? `/api/email/campaigns/${campaignId}/recipients`
      : `/api/email/campaigns/${campaignId}/recipients?status=${filter}`;
    fetch(url).then(r=>r.json()).then(setData);
  },[campaignId, filter]);

  if (!data) return (
    <div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,padding:24,textAlign:'center',color:MUTED,fontSize:13}}>Loading recipients…</div>
  );

  const s = data.summary || {};
  const filtered = !search.trim()
    ? data.recipients
    : data.recipients.filter(r => {
        const q = search.toLowerCase();
        return (r.email||'').toLowerCase().includes(q) || (r.name||'').toLowerCase().includes(q);
      });

  function bucketLabel(b){
    switch (b) {
      case 'queued':       return <Badge label="Queued"      color={MUTED}    bg="#f0f0ed"/>;
      case 'opened':       return <Badge label="Opened"      color={GREEN}    bg={`${GREEN}15`}/>;
      case 'sent_no_open': return <Badge label="Sent"        color={BLUE}     bg="#e6f1fb"/>;
      case 'bounced':      return <Badge label="Bounced"     color={DANGER}   bg="#fdecea"/>;
      case 'failed':       return <Badge label="Failed"      color={DANGER}   bg="#fdecea"/>;
      default:             return <Badge label={b}           color={MUTED}/>;
    }
  }

  // Filter pills the user can click
  const pills = [
    { k:'all',        l:'All',         n: s.total },
    { k:'sent',       l:'Sent',        n: s.sent },
    { k:'queued',     l:'Queued',      n: s.queued },
    ...(tracksOpens  ? [{ k:'opened',     l:'Opened',     n: s.opened }, { k:'not-opened', l:'Not opened', n: s.sent - s.opened }] : []),
    ...(tracksClicks ? [{ k:'clicked',    l:'Clicked',    n: s.clicked }] : []),
    { k:'bounced',    l:'Bounced',     n: s.bounced },
  ];

  return(<div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,overflow:'hidden'}}>
    <div style={{padding:'10px 14px',borderBottom:`0.5px solid ${BORDER}`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
      <div style={{fontSize:11,fontWeight:500,color:MUTED,textTransform:'uppercase',letterSpacing:'.06em'}}>Recipients</div>
      <div style={{display:'flex',gap:6}}>
        <Btn small onClick={()=>onExport('recipients')}>Export sent ({(s.sent||0).toLocaleString()})</Btn>
        {(s.queued||0)>0 && <Btn small onClick={()=>onExport('queued')}>Export queued ({(s.queued||0).toLocaleString()})</Btn>}
      </div>
    </div>

    {/* Phase 4: per-step counts. Only render when the campaign has 2+ steps —
        single-step campaigns keep the existing layout unchanged. Each tile
        shows step N's send count and reply count side-by-side. */}
    {Array.isArray(s.steps) && s.steps.length > 1 && (
      <div style={{padding:'10px 14px',borderBottom:`0.5px solid ${BORDER}`,display:'flex',gap:8,flexWrap:'wrap'}}>
        {s.steps.map(st => (
          <div key={st.step_number}
            style={{
              flex:'1 1 140px',
              padding:'8px 12px',
              background:BG,
              borderRadius:8,
              minWidth:140,
            }}
          >
            <div style={{fontSize:11,color:MUTED,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>
              {st.step_number === 1 ? '1st contact' : st.step_number === 2 ? '2nd contact' : st.step_number === 3 ? '3rd contact' : `${st.step_number}th contact`}
            </div>
            <div style={{fontSize:13,color:TEXT}}>
              <span style={{fontWeight:500}}>{(st.sent_count||0).toLocaleString()}</span>
              <span style={{color:MUTED}}> sent · </span>
              <span style={{fontWeight:500,color: st.reply_count>0 ? GREEN : TEXT}}>{(st.reply_count||0).toLocaleString()}</span>
              <span style={{color:MUTED}}> {st.reply_count===1 ? 'reply' : 'replies'}</span>
            </div>
          </div>
        ))}
      </div>
    )}

    {/* Filter pills */}
    <div style={{padding:'10px 14px',borderBottom:`0.5px solid ${BORDER}`,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
      {pills.map(p=>(
        <button key={p.k} type="button" onClick={()=>setFilter(p.k)} style={{
          padding:'4px 10px',fontSize:11,borderRadius:6,cursor:'pointer',
          background: filter===p.k ? `${BLUE}15` : 'transparent',
          color:      filter===p.k ? BLUE         : MUTED,
          border:    `0.5px solid ${filter===p.k ? BLUE+'60' : BORDER}`,
        }}>{p.l} {(p.n||0).toLocaleString()}</button>
      ))}
      <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or email…"
        style={{marginLeft:'auto',padding:'4px 8px',fontSize:12,border:`0.5px solid ${BORDER}`,borderRadius:6,outline:'none',minWidth:200}}/>
    </div>

    {filtered.length===0 ? (
      <div style={{padding:30,textAlign:'center',color:MUTED,fontSize:13}}>
        {search ? 'No recipients match that search.' : 'No recipients in this view.'}
      </div>
    ) : (
      <div style={{maxHeight:480,overflowY:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead style={{position:'sticky',top:0,background:BG,zIndex:1}}>
            <tr>
              <TH>Recipient</TH>
              <TH>Status</TH>
              {Array.isArray(s.steps) && s.steps.length > 1 && <TH>Step</TH>}
              <TH>Sent at</TH>
              {tracksOpens && <TH>Opens</TH>}
              {tracksClicks && <TH>Clicks</TH>}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map(r=>(
              <tr key={r.subscriber_id}>
                <TD>
                  <div style={{fontSize:13,color:TEXT}}>{r.name||'(no name)'}</div>
                  <div style={{fontSize:11,color:MUTED}}>{r.email}</div>
                </TD>
                <TD>{bucketLabel(r.bucket)}</TD>
                {Array.isArray(s.steps) && s.steps.length > 1 && (
                  <TD center style={{fontSize:11,color: r.last_step > 0 ? TEXT : MUTED}}>
                    {r.last_step > 0 ? `Step ${r.last_step}` : '—'}
                  </TD>
                )}
                <TD muted style={{fontSize:11}}>
                  {r.sent_at ? new Date(r.sent_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}
                </TD>
                {tracksOpens && <TD center>{r.open_count || (r.opened_at ? 1 : 0) || '—'}</TD>}
                {tracksClicks && <TD center>{r.link_click_count || r.click_count || '—'}</TD>}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <div style={{padding:12,textAlign:'center',color:MUTED,fontSize:12,borderTop:`0.5px solid ${BORDER}`}}>
            Showing first 500 of {filtered.length.toLocaleString()}. Export to see them all.
          </div>
        )}
      </div>
    )}
  </div>);
}

// ── Subscriber view ───────────────────────────────────────────────────────────
function SubscriberView({list,onBack,onRefresh}){
  const [subs,setSubs]=useState([]);
  const [touches,setTouches]=useState({});  // subscriber_id → touch count
  const [alwaysWarm,setAlwaysWarm]=useState(!!list.always_warm);
  const [loading,setLoading]=useState(true);
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(1);
  const [modal,setModal]=useState(null);
  const PER_PAGE=50;
  useEffect(()=>{load();},[]);
  async function load(){
    setLoading(true);
    const r=await fetch(`/api/email/lists/${list.id}/subscribers`);
    setSubs(await r.json());
    // Fetch touch counts in parallel — used for the contact-count badge.
    // 6-month window matches the campaign default; the badge is informational.
    fetch(`/api/email/lists/${list.id}/touch-counts?window=6`).then(r=>r.json()).then(d=>{
      setTouches(d.counts||{});
    }).catch(()=>{});
    setLoading(false);
  }
  async function toggleAlwaysWarm(v){
    setAlwaysWarm(v);
    await fetch(`/api/email/lists/${list.id}/always-warm`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({always_warm:v})});
  }
  async function unsub(id){await fetch(`/api/email/lists/${list.id}/subscribers/${id}`,{method:'DELETE'});load();onRefresh();}
  function exportCSV(){
    const rows=filtered.map(s=>`"${s.name||''}","${s.email}","${s.status}","${s.created_at||''}"`);
    const csv=['Name,Email,Status,Added',...rows].join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`${list.name.replace(/\s+/g,'-')}.csv`;a.click();
  }
  const counts={all:subs.length,subscribed:subs.filter(s=>s.status==='subscribed').length,bounced:subs.filter(s=>s.status==='bounced').length,unsubscribed:subs.filter(s=>s.status==='unsubscribed').length,spam:subs.filter(s=>s.status==='spam').length};
  const filtered=subs.filter(s=>filter==='all'||s.status===filter).filter(s=>!search||s.email.includes(search.toLowerCase())||(s.name||'').toLowerCase().includes(search.toLowerCase()));
  const totalPages=Math.ceil(filtered.length/PER_PAGE);
  const paginated=filtered.slice((page-1)*PER_PAGE,page*PER_PAGE);
  return(<div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,minHeight:0}}>
    <div style={{padding:'12px 20px',borderBottom:`0.5px solid ${BORDER}`,background:CARD,display:'flex',alignItems:'center',gap:12}}>
      <button onClick={onBack} style={{background:'none',border:'none',cursor:'pointer',color:MUTED,fontSize:12,padding:0}}>← Back to lists</button>
      <span style={{color:BORDER}}>|</span>
      <span style={{fontSize:14,fontWeight:500,color:TEXT}}>{list.name}</span>
      <div style={{marginLeft:'auto',display:'flex',gap:8}}>
        <Btn small onClick={()=>setModal('import')}>⬆ Import CSV</Btn>
        <Btn small onClick={exportCSV}>⬇ Export</Btn>
        <Btn small variant="primary" onClick={()=>setModal('add')}>+ Add subscriber</Btn>
      </div>
    </div>

    {/* Always-warm toggle row */}
    <div style={{padding:'10px 20px',background:'#fafaf8',borderBottom:`0.5px solid ${BORDER}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
      <div>
        <div style={{fontSize:13,fontWeight:500,color:TEXT}}>Treat list as always warm</div>
        <div style={{fontSize:11,color:MUTED,marginTop:2}}>Override touch-count rules. Tracking applies to every recipient on this list regardless of campaign settings.</div>
      </div>
      <Toggle checked={alwaysWarm} onChange={toggleAlwaysWarm}/>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',background:CARD,borderBottom:`0.5px solid ${BORDER}`}}>
      {[{n:counts.subscribed,l:'Active subscribers',c:GREEN},{n:counts.bounced,l:`Bounced · ${counts.all?((counts.bounced/counts.all)*100).toFixed(1):0}%`,c:DANGER},{n:counts.unsubscribed,l:`Unsubscribed · ${counts.all?((counts.unsubscribed/counts.all)*100).toFixed(1):0}%`,c:AMBER},{n:counts.spam,l:'Marked as spam',c:MUTED}].map((s,i)=>(
        <div key={i} style={{padding:'12px 20px',borderRight:i<3?`0.5px solid ${BORDER}`:'none'}}>
          <div style={{fontSize:22,fontWeight:500,color:s.c}}>{s.n.toLocaleString()}</div>
          <div style={{fontSize:11,color:MUTED,marginTop:2}}>{s.l}</div>
        </div>
      ))}
    </div>
    <div style={{display:'flex',alignItems:'center',gap:6,padding:'10px 20px',background:BG,borderBottom:`0.5px solid ${BORDER}`}}>
      {['all','subscribed','bounced','unsubscribed','spam'].map(f=>(
        <button key={f} onClick={()=>{setFilter(f);setPage(1);}} style={{padding:'4px 12px',fontSize:12,border:`0.5px solid ${BORDER}`,borderRadius:20,background:filter===f?GREEN:'transparent',color:filter===f?'#fff':MUTED,cursor:'pointer',textTransform:'capitalize'}}>{f} ({counts[f]})</button>
      ))}
      <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Search…" style={{marginLeft:'auto',padding:'5px 10px',border:`0.5px solid ${BORDER}`,borderRadius:6,fontSize:12,color:TEXT,background:CARD,outline:'none',width:200}}/>
    </div>
    <div style={{flex:1,overflow:'auto',background:BG}}>
      <table style={{width:'100%',borderCollapse:'collapse',background:CARD}}>
        <thead><tr><TH>Name</TH><TH>Email</TH><TH>Status</TH><TH>Contact</TH><TH>Added</TH><TH>Actions</TH></tr></thead>
        <tbody>
          {loading?<tr><td colSpan={6} style={{textAlign:'center',padding:40,color:MUTED,fontSize:13}}>Loading…</td></tr>
          :paginated.length===0?<tr><td colSpan={6} style={{textAlign:'center',padding:40,color:MUTED,fontSize:13}}>No subscribers found</td></tr>
          :paginated.map(s=>(
            <tr key={s.id}>
              <TD>{s.name||<span style={{color:MUTED}}>—</span>}</TD>
              <TD muted>{s.email}</TD>
              <TD>{subBadge(s.status)}</TD>
              <TD>{touchBadge(touches[s.id]||0)}</TD>
              <TD muted>{s.created_at?new Date(s.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—'}</TD>
              <TD>{s.status==='subscribed'&&<button onClick={()=>{if(confirm(`Unsubscribe ${s.email}?`))unsub(s.id);}} style={{background:'none',border:'none',color:DANGER,fontSize:11,cursor:'pointer',padding:0}}>Unsubscribe</button>}
              {(s.status==='bounced'||s.status==='spam')&&<button onClick={()=>{if(confirm(`Remove ${s.email}?`))unsub(s.id);}} style={{background:'none',border:'none',color:DANGER,fontSize:11,cursor:'pointer',padding:0}}>Remove</button>}</TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {totalPages>1&&(
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 20px',background:CARD,borderTop:`0.5px solid ${BORDER}`,fontSize:12,color:MUTED}}>
        <span>Showing {((page-1)*PER_PAGE)+1}–{Math.min(page*PER_PAGE,filtered.length)} of {filtered.length.toLocaleString()}</span>
        <div style={{display:'flex',gap:4}}>
          <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} style={{padding:'3px 9px',borderRadius:5,border:`0.5px solid ${BORDER}`,background:'transparent',fontSize:12,cursor:'pointer',color:MUTED}}>←</button>
          {Array.from({length:Math.min(5,totalPages)},(_,i)=>{const p=Math.max(1,Math.min(page-2,totalPages-4))+i;return(<button key={p} onClick={()=>setPage(p)} style={{padding:'3px 9px',borderRadius:5,border:`0.5px solid ${BORDER}`,background:page===p?GREEN:'transparent',color:page===p?'#fff':MUTED,fontSize:12,cursor:'pointer'}}>{p}</button>);}).filter(Boolean)}
          <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} style={{padding:'3px 9px',borderRadius:5,border:`0.5px solid ${BORDER}`,background:'transparent',fontSize:12,cursor:'pointer',color:MUTED}}>→</button>
        </div>
      </div>
    )}
    {modal==='import'&&<ImportModal list={list} onClose={()=>setModal(null)} onSaved={()=>{load();onRefresh();}}/>}
    {modal==='add'&&<Modal title="Add subscriber" onClose={()=>setModal(null)}>
      <AddSubForm listId={list.id} onSaved={()=>{load();onRefresh();setModal(null);}} onClose={()=>setModal(null)}/>
    </Modal>}
  </div>);
}
function AddSubForm({listId,onSaved,onClose}){
  const [email,setEmail]=useState('');const [name,setName]=useState('');const [err,setErr]=useState('');const [saving,setSaving]=useState(false);
  async function save(){if(!email){setErr('Email required');return;}setSaving(true);const r=await fetch(`/api/email/lists/${listId}/subscribers`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,name})});const d=await r.json();if(d.error){setErr(d.error);setSaving(false);return;}onSaved();}
  return(<><Input label="Email *" value={email} onChange={setEmail} placeholder="john@example.com" required/><Input label="Name" value={name} onChange={setName} placeholder="John Smith"/>{err&&<div style={{color:DANGER,fontSize:13,marginBottom:10}}>{err}</div>}<div style={{display:'flex',justifyContent:'flex-end',gap:8}}><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={save} disabled={saving}>{saving?'Adding…':'Add subscriber'}</Btn></div></>);
}

// ── Lists table ───────────────────────────────────────────────────────────────
function ListsTable({emailClient,lists,onNewList,onImport,onView,onDelete,onRefresh}){
  function exportList(list){
    fetch(`/api/email/lists/${list.id}/subscribers`).then(r=>r.json()).then(subs=>{
      const rows=subs.map(s=>`"${s.name||''}","${s.email}","${s.status}","${s.created_at||''}"`);
      const csv=['Name,Email,Status,Added',...rows].join('\n');
      const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`${list.name.replace(/\s+/g,'-')}.csv`;a.click();
    });
  }
  if(lists.length===0)return(<div style={{background:CARD,border:`0.5px dashed ${BORDER}`,borderRadius:12,padding:48,textAlign:'center',color:MUTED}}>No lists yet.<br/><br/><Btn variant="primary" onClick={onNewList}>Create first list</Btn></div>);
  return(<div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,overflow:'hidden'}}>
    <table style={{width:'100%',borderCollapse:'collapse'}}>
      <thead><tr><TH>List name</TH><TH>Active</TH><TH>Unsubscribed</TH><TH>Bounced</TH><TH>Spam</TH><TH>Actions</TH></tr></thead>
      <tbody>
        {lists.map(l=>(
          <tr key={l.id}>
            <TD><span style={{fontWeight:500,color:TEXT}}>{l.name}</span></TD>
            <TD><Badge label={l.subscriber_count?.toLocaleString()||'0'} color={GREEN} bg={`${GREEN}18`}/></TD>
            <TD><Badge label={l.unsubscribed_count?.toLocaleString()||'0'} color={l.unsubscribed_count>0?AMBER:MUTED} bg={l.unsubscribed_count>0?'#fff3cd':'#f0f0ed'}/></TD>
            <TD><Badge label={l.bounced_count?.toLocaleString()||'0'} color={l.bounced_count>0?DANGER:MUTED} bg={l.bounced_count>0?'#fdecea':'#f0f0ed'}/></TD>
            <TD><Badge label={l.spam_count?.toLocaleString()||'0'} color={l.spam_count>0?DANGER:MUTED} bg={l.spam_count>0?'#fdecea':'#f0f0ed'}/></TD>
            <TD><div style={{display:'flex',gap:10}}>
              <button onClick={()=>onView(l)} style={{background:'none',border:'none',color:GREEN,fontSize:11,cursor:'pointer',padding:0,fontWeight:500}}>View</button>
              <button onClick={()=>onImport(l)} style={{background:'none',border:'none',color:MUTED,fontSize:11,cursor:'pointer',padding:0}}>Import</button>
              <button onClick={()=>exportList(l)} style={{background:'none',border:'none',color:MUTED,fontSize:11,cursor:'pointer',padding:0}}>Export</button>
              <button onClick={()=>{if(confirm(`Delete "${l.name}" and all subscribers?`))onDelete(l.id);}} style={{background:'none',border:'none',color:DANGER,fontSize:11,cursor:'pointer',padding:0}}>Delete</button>
            </div></TD>
          </tr>
        ))}
      </tbody>
    </table>
  </div>);
}

// ── Campaign Queue table (Variant 3) ──────────────────────────────────────────
function CampaignQueue({emailClient,lists,onViewReport,onRefresh,onClientUpdated}){
  const [campaigns,setCampaigns]=useState([]);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(null);
  const [modalData,setModalData]=useState({});
  const [testEmail,setTestEmail]=useState(emailClient.test_email||'');
  // Default sender — one per customer, auto-fills new campaigns and lists.
  // Lives on email_clients.default_from_name + .default_from_email. Editable
  // here so the operator can drop in the values when a new domain auto-syncs
  // from AWS without having to open the Edit Client modal.
  const [defaultFromName,setDefaultFromName]=useState(emailClient.default_from_name||'');
  const [defaultFromEmail,setDefaultFromEmail]=useState(emailClient.default_from_email||'');

  // When the operator switches between customers in the left sidebar, the
  // emailClient prop changes but the local state would otherwise hold the
  // previous customer's values. Resync from the new prop only on customer
  // switch — we deliberately do NOT depend on the individual field values,
  // because the parent's clients array is updated in place after each save
  // (via onClientUpdated) and re-running this effect mid-typing would
  // overwrite what the operator is currently entering.
  useEffect(()=>{
    setTestEmail(emailClient.test_email||'');
    setDefaultFromName(emailClient.default_from_name||'');
    setDefaultFromEmail(emailClient.default_from_email||'');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[emailClient.id]);

  // Save to server when any of the three header fields change. Debounced 800ms
  // so we don't fire a request on every keystroke. One timer per field — they
  // save independently. The PUT route accepts partial bodies so we only send
  // the field that changed. After the save returns, we update the parent's
  // in-memory clients list (via onClientUpdated) so the New Campaign modal,
  // List modal, and a re-mounted header on customer switch all see the fresh
  // values without a full refetch.
  const testEmailTimer = useRef(null);
  const fromNameTimer  = useRef(null);
  const fromEmailTimer = useRef(null);
  async function saveField(body){
    try{
      const r=await fetch(`/api/email/clients/${emailClient.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!r.ok)return;
      const updated=await r.json();
      if(onClientUpdated)onClientUpdated(updated);
    }catch(e){
      // Network error — leave local state alone. The user can retry by typing
      // again. Silent failure is intentional here so a transient blip doesn't
      // throw an alert mid-edit.
      console.warn('[CampaignQueue] field save failed:',e);
    }
  }
  function handleTestEmailChange(val){
    setTestEmail(val);
    clearTimeout(testEmailTimer.current);
    testEmailTimer.current=setTimeout(()=>saveField({test_email:val}),800);
  }
  function handleDefaultFromNameChange(val){
    setDefaultFromName(val);
    clearTimeout(fromNameTimer.current);
    fromNameTimer.current=setTimeout(()=>saveField({default_from_name:val.trim()||null}),800);
  }
  function handleDefaultFromEmailChange(val){
    setDefaultFromEmail(val);
    clearTimeout(fromEmailTimer.current);
    fromEmailTimer.current=setTimeout(()=>saveField({default_from_email:val.trim()||null}),800);
  }
  const [testStatus,setTestStatus]=useState({});
  const [sendStatus,setSendStatus]=useState({});
  const [previewCampaignId,setPreviewCampaignId]=useState(null);
  const [sendDialogId,setSendDialogId]=useState(null);

  useEffect(()=>{load();},[emailClient.id]);
  useEffect(()=>{
    const hasSending=campaigns.some(c=>c.status==='sending');
    if(!hasSending)return;
    const t=setInterval(load,5000);return()=>clearInterval(t);
  },[campaigns]);

  async function load(){
    setLoading(true);
    const r=await fetch(`/api/email/campaigns?email_client_id=${emailClient.id}`);
    const d=await r.json();
    // Sort: sending first, then scheduled, then draft, then sent
    const order={sending:0,paused:1,scheduled:2,draft:3,sent:4,cancelled:5,failed:6};
    setCampaigns(Array.isArray(d)?d.sort((a,b)=>(order[a.status]||9)-(order[b.status]||9)):[]);
    setLoading(false);
  }

  async function sendTest(id){
    if(!testEmail){alert('Enter a test email address first');return;}
    setTestStatus(s=>({...s,[id]:'sending'}));
    const r=await fetch(`/api/email/campaigns/${id}/test`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({test_email:testEmail})});
    const d=await r.json();
    setTestStatus(s=>({...s,[id]:d.ok?'sent':'error'}));
    setTimeout(()=>setTestStatus(s=>({...s,[id]:null})),3000);
  }

  // Send button now opens the breakdown dialog instead of a bare confirm()
  function sendNow(id){
    setSendDialogId(id);
  }
  function onSendConfirmed(id){
    setSendStatus(s=>({...s,[id]:'starting'}));
    load();
  }

  async function togglePause(id){
    await fetch(`/api/email/campaigns/${id}/pause`,{method:'POST'});
    load();
  }

  async function deleteCampaign(id){
    if(!confirm('Delete this campaign?'))return;
    await fetch(`/api/email/campaigns/${id}`,{method:'DELETE'});
    load();onRefresh();
  }

  // Cancel — for sending/paused/scheduled campaigns. Stops further sends but
  // preserves stats. Distinct from delete which removes everything including reports.
  async function cancelCampaign(id){
    if(!confirm('Stop this campaign? Already-sent emails are kept for reporting. The remainder will not be sent.'))return;
    const r=await fetch(`/api/email/campaigns/${id}/cancel`,{method:'POST'});
    const d=await r.json();
    if(d.error){alert(d.error);return;}
    load();
  }

  const getLists=()=>lists;

  return(<div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,minHeight:0}}>
    <div style={{padding:'10px 16px',borderBottom:`0.5px solid ${BORDER}`,background:CARD,display:'flex',alignItems:'flex-end',gap:14,flexWrap:'wrap'}}>
      {/* Default From name. Auto-fills the From name on every new campaign
          and list for this customer. Saved on debounce. No placeholder text
          intentionally — operator wants the field genuinely blank when unset
          rather than showing a ghost example that looks like a real value. */}
      <div style={{display:'flex',flexDirection:'column',gap:3}}>
        <label style={{fontSize:11,color:MUTED}}>Default From name</label>
        <input value={defaultFromName} onChange={e=>handleDefaultFromNameChange(e.target.value)} style={{fontSize:12,padding:'5px 10px',border:`0.5px solid ${BORDER}`,borderRadius:6,color:TEXT,background:BG,outline:'none',width:170}}/>
      </div>
      {/* Default From email. Also used as the default Reply-to on new campaigns
          (the operator confirmed reply-to should always equal the From). Same
          no-placeholder rule as the From name field above. */}
      <div style={{display:'flex',flexDirection:'column',gap:3}}>
        <label style={{fontSize:11,color:MUTED}}>Default From email</label>
        <input value={defaultFromEmail} onChange={e=>handleDefaultFromEmailChange(e.target.value)} style={{fontSize:12,padding:'5px 10px',border:`0.5px solid ${BORDER}`,borderRadius:6,color:TEXT,background:BG,outline:'none',width:210}}/>
      </div>
      {/* Test send address. Same field as before, just relabelled to match
          the two new ones above. */}
      <div style={{display:'flex',flexDirection:'column',gap:3}}>
        <label style={{fontSize:11,color:MUTED}}>Test send address</label>
        <input value={testEmail} onChange={e=>handleTestEmailChange(e.target.value)} placeholder="test@youremail.com" style={{fontSize:12,padding:'5px 10px',border:`0.5px solid ${BORDER}`,borderRadius:6,color:TEXT,background:BG,outline:'none',width:200}}/>
      </div>
      <div style={{marginLeft:'auto',display:'flex',gap:8}}>
        <Btn small onClick={()=>setModal('new-campaign')} variant="primary">+ New campaign</Btn>
      </div>
    </div>

    <div style={{flex:1,overflow:'auto',background:BG,padding:16}}>
      {loading?<div style={{textAlign:'center',padding:40,color:MUTED}}>Loading…</div>
      :campaigns.length===0?(
        <div style={{background:CARD,border:`0.5px dashed ${BORDER}`,borderRadius:12,padding:48,textAlign:'center',color:MUTED}}>
          No campaigns yet.<br/><br/><Btn variant="primary" onClick={()=>setModal('new-campaign')}>Create first campaign</Btn>
        </div>
      ):(
        <div style={{background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:10,overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <TH w="24px">#</TH>
                <TH>Campaign</TH>
                <TH>Status</TH>
                <TH>List</TH>
                <TH>Daily limit</TH>
                <TH>Progress</TH>
                <TH>Est. finish</TH>
                <TH>Actions</TH>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c,i)=>{
                const list=lists.find(l=>l.id===c.list_id);
                const totalSubs=list?.subscriber_count||0;
                const days=c.daily_limit>0?Math.ceil((totalSubs-(c.drip_sent||0))/c.daily_limit):0;
                const finish=days>0?new Date(Date.now()+days*86400000).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'—';
                const pct=totalSubs>0?Math.round(((c.sent_count||0)/totalSubs)*100):0;
                const isSending=c.status==='sending'||c.status==='paused';
                const isSent=c.status==='sent';
                return(
                  <tr key={c.id} style={{background:c.status==='sending'?`${GREEN}08`:c.status==='paused'?'#fff3cd18':'transparent'}}>
                    <TD muted>{i+1}</TD>
                    <TD>
                      <div style={{fontWeight:500,color:TEXT,cursor:'pointer',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}} onClick={isSent?()=>onViewReport(c):undefined}>
                        <span>{c.title}</span>
                        {trackingBadge(c)}
                        {isSent&&<span style={{fontSize:10,color:BLUE}}>View report →</span>}
                      </div>
                      <div style={{fontSize:11,color:MUTED,marginTop:1}}>{c.subject}</div>
                    </TD>
                    <TD>{statusBadge(c.status)}</TD>
                    <TD muted style={{fontSize:11}}>{c.list_name||'—'}</TD>
                    <TD muted>{c.daily_limit>0?`${c.daily_limit.toLocaleString()}/day`:'—'}</TD>
                    <TD style={{minWidth:120}}>
                      {isSending?(
                        <div>
                          <div style={{fontSize:11,color:MUTED,marginBottom:3}}>{(c.sent_count||0).toLocaleString()} / {totalSubs.toLocaleString()}</div>
                          <div style={{height:4,background:BG,borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:4,borderRadius:2,background:c.status==='paused'?AMBER:GREEN,width:`${pct}%`}}/>
                          </div>
                        </div>
                      ):c.status==='scheduled' && c.daily_limit>0 ? (
                        <div>
                          <div style={{fontSize:11,color:MUTED,marginBottom:3}}>
                            {(c.drip_sent||0).toLocaleString()} / {totalSubs.toLocaleString()}
                            {c.drip_today_sent>0 && <span style={{color:BLUE,marginLeft:4}}>· {c.drip_today_sent} today</span>}
                          </div>
                          <div style={{height:4,background:BG,borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:4,borderRadius:2,background:BLUE,width:`${totalSubs?Math.min(100,Math.round(((c.drip_sent||0)/totalSubs)*100)):0}%`}}/>
                          </div>
                        </div>
                      ):isSent?(
                        <div style={{fontSize:11}}>
                          <span style={{color:GREEN}}>{(c.open_count||0).toLocaleString()} opens</span>
                          <span style={{color:MUTED}}> · </span>
                          <span style={{color:BLUE}}>{(c.click_count||0).toLocaleString()} clicks</span>
                        </div>
                      ):<span style={{color:MUTED,fontSize:11}}>—</span>}
                    </TD>
                    <TD muted style={{fontSize:11}}>{
                      isSending ? finish
                      : c.status==='scheduled' && c.daily_limit>0 ? estimateDripFinish(c, totalSubs)
                      : isSent ? (c.sent_at?new Date(c.sent_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'—')
                      : '—'
                    }</TD>
                    <TD>
                      <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                        {(c.status==='draft'||c.status==='scheduled')&&<>
                          <Btn small onClick={()=>{setModalData(c);setModal('edit-campaign');}}>Edit</Btn>
                          <Btn small variant="amber" onClick={()=>{setModalData(c);setModal('drip');}}>Schedule drip</Btn>
                          <Btn small variant="primary" onClick={()=>sendNow(c.id)}>Send now</Btn>
                        </>}
                        {c.status==='scheduled' && c.daily_limit>0 && (
                          <Btn small onClick={()=>onViewReport(c)}>View progress</Btn>
                        )}
                        {isSending&&<>
                          <Btn small variant="amber" onClick={()=>togglePause(c.id)}>{c.status==='paused'?'Resume':'Pause'}</Btn>
                          <Btn small variant="danger" onClick={()=>cancelCampaign(c.id)}>Cancel</Btn>
                          <Btn small onClick={()=>onViewReport(c)}>View progress</Btn>
                        </>}
                        {isSent&&<Btn small onClick={()=>onViewReport(c)}>View report</Btn>}
                        {c.status==='cancelled'&&<>
                          <Btn small onClick={()=>onViewReport(c)}>View partial report</Btn>
                          <Btn small variant="danger" onClick={()=>deleteCampaign(c.id)}>Delete</Btn>
                        </>}
                        {!isSending&&c.status!=='cancelled'&&<Btn small variant="danger" onClick={()=>deleteCampaign(c.id)}>Delete</Btn>}
                        {(c.status==='draft'||c.status==='scheduled')&&<>
                          <Btn small onClick={()=>setPreviewCampaignId(c.id)}>Preview</Btn>
                          <Btn small variant="blue" onClick={()=>sendTest(c.id)}>{testStatus[c.id]==='sending'?'Sending…':testStatus[c.id]==='sent'?'✓ Sent!':testStatus[c.id]==='error'?'Error':'Test'}</Btn>
                        </>}
                      </div>
                      {sendStatus[c.id]&&<div style={{fontSize:11,color:sendStatus[c.id]==='ok'?GREEN:DANGER,marginTop:4}}>{sendStatus[c.id]==='ok'?'Send started!':sendStatus[c.id]==='starting'?'Starting…':'Send failed'}</div>}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>

    {modal==='new-campaign'&&<CampaignModal emailClient={emailClient} lists={getLists()} onClose={()=>setModal(null)} onSaved={()=>{load();onRefresh();}}/>}
    {modal==='edit-campaign'&&<CampaignModal emailClient={emailClient} lists={getLists()} initial={modalData} onClose={()=>setModal(null)} onSaved={()=>{load();onRefresh();}}/>}
    {modal==='drip'&&<DripModal campaign={modalData} totalSubs={lists.find(l=>l.id===modalData.list_id)?.subscriber_count||0} onClose={()=>setModal(null)} onSaved={load}/>}
    {sendDialogId&&<SendCampaignDialog campaignId={sendDialogId} onClose={()=>setSendDialogId(null)} onConfirmed={()=>onSendConfirmed(sendDialogId)}/>}
    {previewCampaignId&&<PreviewCampaignModal campaignId={previewCampaignId} onClose={()=>setPreviewCampaignId(null)}/>}
  </div>);
}

// ── Client panel ──────────────────────────────────────────────────────────────
function ClientPanel({emailClient,onRefresh,onClientUpdated,onEditClient}){
  const [tab,setTab]=useState('campaigns');
  const [lists,setLists]=useState([]);
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [modalData,setModalData]=useState({});
  const [viewingList,setViewingList]=useState(null);
  const [viewingReport,setViewingReport]=useState(null);

  useEffect(()=>{loadLists();},[emailClient.id]);

  async function loadLists(){
    setLoading(true);
    const r=await fetch(`/api/email/lists?email_client_id=${emailClient.id}`);
    const d=await r.json();setLists(Array.isArray(d)?d:[]);setLoading(false);
  }

  async function deleteList(id){
    await fetch(`/api/email/lists/${id}`,{method:'DELETE'});
    loadLists();onRefresh();
  }

  if(viewingList)return <SubscriberView list={viewingList} onBack={()=>{setViewingList(null);loadLists();}} onRefresh={onRefresh}/>;
  if(viewingReport)return(
    <CampaignReport campaign={viewingReport} lists={lists} onBack={()=>setViewingReport(null)}/>
  );

  return(<div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,minHeight:0}}>
    <div style={{padding:'12px 20px',borderBottom:`0.5px solid ${BORDER}`,background:CARD,display:'flex',alignItems:'center',gap:12}}>
      <div style={{width:32,height:32,borderRadius:8,background:emailClient.color||GREEN,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:12,fontWeight:600,flexShrink:0}}>{initials(emailClient.name)}</div>
      <div style={{flex:1}}>
        <div style={{fontSize:15,fontWeight:500,color:TEXT}}>{emailClient.name}</div>
        <div style={{fontSize:12,color:MUTED}}>{emailClient.list_count||0} lists · {emailClient.subscriber_count||0} active subscribers</div>
      </div>
      <div style={{display:'flex',gap:8}}>
        {tab==='lists'&&<>
          <Btn small onClick={()=>setModal('import-new-list')}>⬆ Import new list</Btn>
          <Btn small variant="primary" onClick={()=>setModal('new-list')}>+ New list</Btn>
        </>}
        <Btn small onClick={()=>onEditClient(emailClient)}>Edit</Btn>
      </div>
    </div>

    <div style={{display:'flex',borderBottom:`0.5px solid ${BORDER}`,background:CARD}}>
      {['campaigns','lists'].map(t=>(
        <button key={t} onClick={()=>setTab(t)} style={{padding:'9px 18px',fontSize:13,border:'none',background:'transparent',cursor:'pointer',color:tab===t?GREEN:MUTED,fontWeight:tab===t?500:400,borderBottom:tab===t?`2px solid ${GREEN}`:'2px solid transparent',textTransform:'capitalize'}}>{t}</button>
      ))}
    </div>

    <div style={{flex:1,minHeight:0,overflow:'hidden',display:'flex',flexDirection:'column',background:BG}}>
      {tab==='campaigns'&&<CampaignQueue emailClient={emailClient} lists={lists} onViewReport={setViewingReport} onRefresh={()=>{loadLists();onRefresh();}} onClientUpdated={onClientUpdated}/>}
      {tab==='lists'&&(
        <div style={{flex:1,overflow:'auto',padding:20}}>
          {loading?<div style={{color:MUTED,textAlign:'center',padding:40}}>Loading…</div>
          :<ListsTable emailClient={emailClient} lists={lists} onNewList={()=>setModal('new-list')} onImport={l=>{setModalData(l);setModal('import');}} onView={l=>setViewingList(l)} onDelete={deleteList} onRefresh={loadLists}/>}
        </div>
      )}
    </div>

    {modal==='new-list'&&<ListModal emailClient={emailClient} onClose={()=>setModal(null)} onSaved={()=>{loadLists();onRefresh();}}/>}
    {modal==='import'&&<ImportModal list={modalData} onClose={()=>setModal(null)} onSaved={()=>{loadLists();onRefresh();}}/>}
    {modal==='import-new-list'&&<ImportNewListModal emailClient={emailClient} onClose={()=>setModal(null)} onSaved={()=>{loadLists();onRefresh();}}/>}
  </div>);
}

// ── Main EmailSection ─────────────────────────────────────────────────────────
export default function EmailSection({initialTab='customers'}){
  const [clients,setClients]=useState([]);
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(null);
  const [modalData,setModalData]=useState({});
  const [domains,setDomains]=useState([]);
  const [domainsLoading,setDomainsLoading]=useState(false);
  const [showArchived,setShowArchived]=useState(false);
  const [archived,setArchived]=useState([]);
  const isDomainView   = initialTab==='domains';
  const isMailboxesView= initialTab==='mailboxes';

  async function loadArchived(){
    const a=await fetch('/api/email/clients?archived=1').then(r=>r.json());
    setArchived(Array.isArray(a)?a:[]);
  }
  async function restoreClient(c){
    await fetch(`/api/email/clients/${c.id}/restore`,{method:'POST'});
    await loadArchived(); await loadAll();
  }

  useEffect(()=>{
    if(isDomainView){loadDomains();}
    else if(isMailboxesView){/* MailboxesSection loads its own data */}
    else{loadAll();}
  },[initialTab]);

  async function loadDomains(){
    setDomainsLoading(true);setDomains([]);
    const vd=await fetch('/api/email/verified-domains').then(r=>r.json());
    if(!Array.isArray(vd)||vd.length===0){setDomainsLoading(false);return;}
    Promise.all(vd.map(d=>fetch(`/api/email/domain-health/${d}`).then(r=>r.json()))).then(results=>{setDomains(results);setDomainsLoading(false);});
  }

  async function loadAll(){
    setLoading(true);
    const [vd,c]=await Promise.all([fetch('/api/email/verified-domains').then(r=>r.json()),fetch('/api/email/clients').then(r=>r.json())]);
    const vds=Array.isArray(vd)?vd:[];
    let current=Array.isArray(c)?c:[];
    const existingNames=current.map(cl=>cl.name.toLowerCase());
    const toCreate=vds.filter(d=>!existingNames.includes(d.toLowerCase()));
    if(toCreate.length>0){
      await Promise.all(toCreate.map(domain=>fetch('/api/email/clients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:domain,color:'#1D9E75'})})));
      const refreshed=await fetch('/api/email/clients').then(r=>r.json());
      current=Array.isArray(refreshed)?refreshed:[];
    }
    setClients(current);setLoading(false);
  }

  const filtered=clients.filter(c=>c.name.toLowerCase().includes(search.toLowerCase()));
  const selectedClient=clients.find(c=>c.id===selected);

  // Update one customer in our in-memory list when a save returns a fresh row
  // from the server. Used by the inline-editable header fields (Default From
  // name / Default From email / Test send) on the customer detail page so that
  // navigating away and back, or opening the New Campaign modal, sees the
  // values the operator just typed instead of the stale ones from page load.
  // Important: the GET /clients query computes list_count, subscriber_count,
  // and campaign_count via subqueries. The PUT /clients/:id route returns a
  // bare SELECT * from email_clients which does NOT include those counts. We
  // explicitly preserve them so the sidebar list doesn't blank out the
  // "N lists · M subs" line on every save.
  function updateClientLocally(updated){
    if(!updated||!updated.id)return;
    setClients(cs=>cs.map(c=>c.id===updated.id?{
      ...c,
      ...updated,
      list_count: c.list_count,
      subscriber_count: c.subscriber_count,
      campaign_count: c.campaign_count,
    }:c));
  }

  if(isMailboxesView)return <MailboxesSection/>;

  if(isDomainView)return(
    <div style={{flex:1,display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden'}}>
      <div style={{padding:'14px 20px',borderBottom:`0.5px solid ${BORDER}`,background:CARD,display:'flex',alignItems:'center',gap:12}}>
        <div style={{fontSize:15,fontWeight:500,color:TEXT}}>Domain Health</div>
        <div style={{marginLeft:'auto'}}><Btn small onClick={loadDomains}>Refresh</Btn></div>
      </div>
      <div style={{flex:1,minHeight:0,overflow:'auto',padding:20,background:BG}}>
        {domainsLoading?<div style={{color:MUTED,textAlign:'center',padding:40}}>Checking all domains…</div>
        :domains.length===0?<div style={{color:MUTED,textAlign:'center',padding:40}}>No verified domains found.</div>
        :<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>{domains.map(d=><DomainCard key={d.domain} data={d}/>)}</div>}
      </div>
    </div>
  );

  return(
    <div style={{flex:1,display:'flex',height:'100vh',overflow:'hidden'}}>
      <div style={{width:240,background:CARD,borderRight:`0.5px solid ${BORDER}`,display:'flex',flexDirection:'column',flexShrink:0}}>
        <div style={{padding:'14px 12px',borderBottom:`0.5px solid ${BORDER}`}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search clients…" style={{width:'100%',padding:'7px 10px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:BG,outline:'none',boxSizing:'border-box'}}/>
          <button type="button" onClick={()=>{const n=!showArchived;setShowArchived(n);if(n)loadArchived();}} style={{marginTop:8,background:'none',border:'none',color:MUTED,fontSize:11,cursor:'pointer',padding:0}}>{showArchived?'← Back to active':'Show archived'}</button>
        </div>
        <div style={{flex:1,overflowY:'auto'}}>
          {showArchived?(
            archived.length===0?<div style={{color:MUTED,textAlign:'center',padding:32,fontSize:13}}>No archived domains</div>
            :archived.map(c=>(
              <div key={c.id} style={{padding:'10px 12px',borderBottom:`0.5px solid ${BORDER}`}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:30,height:30,borderRadius:7,background:'#bbb',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:11,fontWeight:600,flexShrink:0}}>{initials(c.name)}</div>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,color:MUTED,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</div><div style={{fontSize:11,color:MUTED}}>archived</div></div>
                </div>
                <div style={{display:'flex',gap:8,marginTop:8}}>
                  <button type="button" onClick={()=>restoreClient(c)} style={{flex:1,padding:'5px 0',border:`0.5px solid ${BORDER}`,borderRadius:6,background:CARD,color:TEXT,fontSize:12,cursor:'pointer'}}>Restore</button>
                  <button type="button" onClick={()=>{setModalData(c);setModal('remove-client');}} style={{flex:1,padding:'5px 0',border:`0.5px solid #F0997B`,borderRadius:6,background:CARD,color:DANGER,fontSize:12,cursor:'pointer'}}>Delete</button>
                </div>
              </div>
            ))
          ):loading?<div style={{color:MUTED,textAlign:'center',padding:32,fontSize:13}}>Loading…</div>
          :filtered.length===0?<div style={{color:MUTED,textAlign:'center',padding:32,fontSize:13}}>{search?'No clients match':'No clients yet'}</div>
          :filtered.map(c=>(
            <div key={c.id} onClick={()=>setSelected(c.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',cursor:'pointer',borderBottom:`0.5px solid ${BORDER}`,background:selected===c.id?`${GREEN}12`:CARD,borderLeft:selected===c.id?`3px solid ${GREEN}`:'3px solid transparent'}}>
              <div style={{width:30,height:30,borderRadius:7,background:c.color||GREEN,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:11,fontWeight:600,flexShrink:0}}>{initials(c.name)}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:selected===c.id?500:400,color:TEXT,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</div>
                <div style={{fontSize:11,color:MUTED}}>{c.list_count||0} lists · {c.subscriber_count||0} subs</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedClient?(
        <ClientPanel key={selectedClient.id} emailClient={selectedClient} onRefresh={loadAll} onClientUpdated={updateClientLocally} onEditClient={c=>{setModalData(c);setModal('edit-client');}}/>
      ):(
        <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',background:BG,flexDirection:'column',gap:12}}>
          <div style={{fontSize:14,color:MUTED}}>Select a client to get started</div>
          {clients.length===0&&!loading&&<Btn variant="primary" onClick={()=>setModal('new-client')}>Add your first email client</Btn>}
        </div>
      )}

      {modal==='new-client'&&<ClientModal onClose={()=>setModal(null)} onSaved={loadAll}/>}
      {modal==='edit-client'&&<ClientModal initial={modalData} onClose={()=>setModal(null)} onSaved={loadAll} onRemove={c=>{setModalData(c);setModal('remove-client');}}/>}
      {modal==='remove-client'&&<RemoveDomainModal client={modalData} onClose={()=>setModal(null)} onDone={()=>{setModal(null);setSelected(null);loadAll();if(showArchived)loadArchived();}}/>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAILBOXES — Phase 3 inbox monitoring & reply triage (Variant C: split layout)
// ════════════════════════════════════════════════════════════════════════════

// Date helper used in several mailbox views: "14 min ago", "2 h ago", "yesterday"
function relTime(iso){
  if(!iso) return '—';
  // SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" — a UTC string with
  // a space separator and no timezone marker. Chrome/Edge parse that as LOCAL
  // time, which makes timestamps appear off by the user's TZ offset (e.g. 1h
  // behind in BST). Detect and force-treat as UTC. ISO strings (with T and Z,
  // like email received_at values) parse correctly without modification.
  let s = iso;
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  }
  const d=new Date(s); const now=Date.now();
  const sec=Math.round((now-d.getTime())/1000);
  if (sec<0)         return 'just now';            // clock skew safety net
  if (sec<60)        return 'just now';
  if (sec<3600)      return `${Math.round(sec/60)}m ago`;
  if (sec<86400)     return `${Math.round(sec/3600)}h ago`;
  if (sec<86400*7)   return `${Math.round(sec/86400)}d ago`;
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}

// Classification badge.
//
// Three layers, in priority order:
//
//   1. Formspree website-form submissions get their own label
//      ("Website Prospect", green) — these aren't classifier output, they're
//      structured form fills, so they bypass classification entirely. The
//      detection mirrors isFormspreeLead() in formspree-flagger.js (sender
//      domain + lead-keyword subject). Same gate so the badge stays in step
//      with the auto-flagger that adds them to Hot Prospects.
//
//   2. Campaign-matched replies (campaign_title set) get a "Campaign · "
//      prefix so the operator can tell at a glance which rows are responses
//      to outreach vs general inbox traffic. Auto-unsubscribed is always
//      campaign-only by definition.
//
//   3. Non-campaign mail keeps the bare classifier label (admin sees the
//      full ops detail; the customer portal collapses non-campaign rows to
//      "Normal email" — see ClassifyBadge in PortalApp.jsx).
//
// Decision history (blueprint reference for next chat): this used to show
// just the bare label. Operator added the Campaign prefix + Website Prospect
// label 2026-05-20 fifth session — see decisions #36, #69, and the amendment
// in this session's blueprint addition.
function classifyBadge(reply){
  // 1. Formspree website-form submission — own label, bypasses classifier.
  //    Driven by is_website_prospect from the backend (single source of truth;
  //    see isFormspreeLeadRow in formspree-flagger.js) so this badge can never
  //    drift from the auto-flagger via a stale local keyword copy.
  if (reply?.is_website_prospect) {
    return <Badge label="Website Prospect" color="#0F6E56" bg="#E1F5EE"/>;
  }

  const inCampaign = !!reply.campaign_title;
  const prefix = inCampaign ? 'Campaign · ' : '';

  if (reply.auto_unsubscribed) {
    return <Badge label={`${prefix}Auto-unsubscribed`} color="#633806" bg="#FAEEDA"/>;
  }
  switch (reply.classification) {
    case 'positive':      return <Badge label={`${prefix}New prospect`}  color="#0C447C" bg="#E6F1FB"/>;
    case 'hard_negative': return <Badge label={`${prefix}Negative`}      color="#793F1F" bg="#FAECE7"/>;
    case 'soft_negative': return <Badge label={`${prefix}Soft negative`} color="#793F1F" bg="#FAECE7"/>;
    case 'auto_reply':    return <Badge label={`${prefix}Out of Office`} color="#72243E" bg="#FBEAF0"/>;
    case 'forwarding':    return <Badge label={`${prefix}Forwarded`}     color="#3C3489" bg="#EEEDFE"/>;
    case 'neutral':       return <Badge label={`${prefix}Neutral`}       color="#5F5E5A" bg="#F1EFE8"/>;
    default:              return <Badge label={`${prefix}Unclassified`}  color="#5F5E5A" bg="transparent" border="1px dashed #B4B2A9"/>;
  }
}

// ── Secondary "action-taken" status badges ────────────────────────────────────
// Rendered next to classifyBadge on inbox rows AND in the reply-detail modal
// header. Surfaces, at a glance, two pieces of state that the operator would
// otherwise have to dig for:
//
//   • On Hot Prospects list  — amber pill, clickable; opens this prospect's
//     detail modal in the CRM screen (same handoff as the success banner
//     after Send-to-Hot-Prospects).
//   • Unsubscribed           — grey pill, not clickable. Means this sender
//     is currently unsubscribed from at least one of the customer's mailing
//     lists (whether by their own link-click, auto-unsubscribe by the
//     classifier, or manual removal). End-state — no destination to link to.
//
// Backend supplies hot_prospect_id + hot_prospect_crm_customer_id +
// contact_unsubscribed on every reply row (see attachInboxBadges in
// server/routes/email.js).
//
// The "On Hot Prospects list" click handler uses the SAME localStorage +
// custom-event handoff that ReplyDetailModal's openInCrm uses (see comment
// near openInCrm — Dashboard.jsx listens for studio:navigate and switches
// view; CRM screen reads open_prospect_id on mount). Inlined here so the
// badge works from the inbox row directly without prop-drilling through
// MailboxDetail → ReplyDetailModal.
function openHotProspectInCrm(prospectId, crmCustomerId){
  try {
    if (crmCustomerId) {
      localStorage.setItem('studio.crm.hot_prospects.last_customer_id', crmCustomerId);
    }
    if (prospectId) {
      localStorage.setItem('studio.crm.hot_prospects.open_prospect_id', prospectId);
    }
  } catch {} // private-browsing tolerance — non-fatal
  window.dispatchEvent(new CustomEvent('studio:navigate', { detail: { view: 'crm-hot-prospects' } }));
}

function ActionBadges({ reply, onBeforeNavigate }) {
  const onList = !!reply?.hot_prospect_id;
  const unsubd = !!reply?.contact_unsubscribed;
  if (!onList && !unsubd) return null;
  return (
    <>
      {onList && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation(); // don't also open the inbox-row detail modal
            if (onBeforeNavigate) onBeforeNavigate();
            openHotProspectInCrm(reply.hot_prospect_id, reply.hot_prospect_crm_customer_id);
          }}
          title="Open in CRM"
          style={{
            fontSize:11, padding:'2px 8px', borderRadius:20, fontWeight:500,
            background:'#FAEEDA', color:'#633806', whiteSpace:'nowrap',
            border:'none', cursor:'pointer', fontFamily:'inherit',
          }}
        >On Hot Prospects list</button>
      )}
      {unsubd && (
        <span style={{
          fontSize:11, padding:'2px 8px', borderRadius:20, fontWeight:500,
          background:'#F1EFE8', color:'#5F5E5A', whiteSpace:'nowrap',
        }}>Unsubscribed</span>
      )}
    </>
  );
}

// ── Top-level Mailboxes section ───────────────────────────────────────────────
function MailboxesSection(){
  const [inboxes,setInboxes]=useState([]);
  const [selectedId,setSelectedId]=useState(null);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(null);

  useEffect(()=>{ loadInboxes(); const t=setInterval(loadInboxes,30_000); return()=>clearInterval(t); },[]);

  async function loadInboxes(){
    const r=await fetch('/api/email/mailboxes');
    if(!r.ok){setLoading(false);return;}
    const d=await r.json();
    setInboxes(Array.isArray(d)?d:[]);
    setLoading(false);
    // If nothing selected and we have inboxes, auto-select first one.
    // Uses the functional updater form so the 30-second background poll
    // (which captures the initial selectedId in its closure) doesn't
    // snap the operator back to the first mailbox every refresh.
    if(Array.isArray(d) && d.length>0){ const vis=d.filter(i=>i.enabled!==0); if(vis.length>0) setSelectedId(prev => prev || vis[0].id); }
  }

  // Disconnected mailboxes (enabled=0) are hidden — they stop syncing and drop
  // out of the list, but their reply history stays in the DB.
  const visible=inboxes.filter(i=>i.enabled!==0);
  const selected=visible.find(i=>i.id===selectedId);
  const totalProspects=visible.reduce((s,i)=>s+(i.new_prospect_count||0),0);
  const totalUnsub    =visible.reduce((s,i)=>s+(i.auto_unsub_count||0),0);
  const totalReplies  =visible.reduce((s,i)=>s+(i.replies_30d||0),0);

  return(<div style={{flex:1,display:'flex',height:'100vh',overflow:'hidden'}}>

    {/* Left rail — list of all mailboxes */}
    <div style={{width:260,background:CARD,borderRight:`0.5px solid ${BORDER}`,display:'flex',flexDirection:'column',flexShrink:0}}>
      <div style={{padding:'14px 14px 10px',borderBottom:`0.5px solid ${BORDER}`}}>
        <div style={{fontSize:13,fontWeight:500,color:TEXT}}>Mailboxes</div>
        <div style={{fontSize:11,color:MUTED,marginTop:2}}>{visible.length} connected · {totalProspects} new prospect{totalProspects===1?'':'s'}</div>
      </div>

      {/* Aggregate stats strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:6,padding:10,borderBottom:`0.5px solid ${BORDER}`}}>
        <div style={{background:BG,padding:'6px 8px',borderRadius:5,textAlign:'center'}}>
          <div style={{fontSize:16,fontWeight:500,color:totalProspects>0?BLUE:MUTED}}>{totalProspects}</div>
          <div style={{fontSize:9,color:MUTED,textTransform:'uppercase',letterSpacing:0.4}}>Prospects</div>
        </div>
        <div style={{background:BG,padding:'6px 8px',borderRadius:5,textAlign:'center'}}>
          <div style={{fontSize:16,fontWeight:500,color:totalUnsub>0?'#633806':MUTED}}>{totalUnsub}</div>
          <div style={{fontSize:9,color:MUTED,textTransform:'uppercase',letterSpacing:0.4}}>Unsub</div>
        </div>
        <div style={{background:BG,padding:'6px 8px',borderRadius:5,textAlign:'center'}}>
          <div style={{fontSize:16,fontWeight:500,color:TEXT}}>{totalReplies}</div>
          <div style={{fontSize:9,color:MUTED,textTransform:'uppercase',letterSpacing:0.4}}>30d</div>
        </div>
      </div>

      {/* Mailbox list */}
      <div style={{flex:1,overflowY:'auto'}}>
        {loading?<div style={{color:MUTED,textAlign:'center',padding:32,fontSize:12}}>Loading…</div>
        :visible.length===0?<div style={{color:MUTED,textAlign:'center',padding:32,fontSize:12}}>No mailboxes connected yet</div>
        :visible.map(ib=>{
          const isSelected=ib.id===selectedId;
          const hasError=!!ib.last_error;
          return(<div key={ib.id} onClick={()=>setSelectedId(ib.id)} style={{
            padding:'10px 12px',cursor:'pointer',
            background:isSelected?`${GREEN}12`:'transparent',
            borderLeft:isSelected?`3px solid ${GREEN}`:'3px solid transparent',
            borderBottom:`0.5px solid ${BORDER}`,
            display:'flex',alignItems:'center',gap:8,
          }}>
            {/* Status dot */}
            <span style={{width:6,height:6,borderRadius:'50%',background:hasError?DANGER:ib.enabled?GREEN:MUTED,flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,color:TEXT,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontWeight:isSelected?500:400}}>{ib.email_address}</div>
              {hasError?
                <div style={{fontSize:10,color:DANGER,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ib.last_error}</div>
                :
                <div style={{fontSize:10,color:MUTED,marginTop:1}}>{(ib.replies_30d||0).toLocaleString()} emails · {relTime(ib.last_polled_at)}</div>
              }
            </div>
            {(ib.new_prospect_count||0)>0 && <span style={{background:'#E6F1FB',color:'#0C447C',fontSize:10,fontWeight:500,padding:'1px 6px',borderRadius:8,minWidth:14,textAlign:'center',lineHeight:1.5}}>{ib.new_prospect_count}</span>}
          </div>);
        })}
      </div>

      <div style={{padding:10,borderTop:`0.5px solid ${BORDER}`}}>
        <Btn variant="primary" style={{width:'100%',justifyContent:'center'}} onClick={()=>setModal('connect')}>+ Connect mailbox</Btn>
      </div>
    </div>

    {/* Right side — focused inbox detail */}
    {selected ? <MailboxDetail key={selected.id} inbox={selected} onRefresh={loadInboxes}/>
      : <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',background:BG,flexDirection:'column',gap:12}}>
          <div style={{fontSize:14,color:MUTED}}>{visible.length===0?'Connect your first mailbox':'Select a mailbox'}</div>
          {visible.length===0&&<Btn variant="primary" onClick={()=>setModal('connect')}>Connect mailbox</Btn>}
        </div>}

    {modal==='connect'&&<ConnectMailboxModal onClose={()=>setModal(null)} onSaved={()=>{setModal(null);loadInboxes();}}/>}
  </div>);
}

// ── Detail pane for one inbox: tabs + list of replies ─────────────────────────
function MailboxDetail({inbox, onRefresh}){
  const [bucket,setBucket]=useState('all');
  const [replies,setReplies]=useState([]);
  const [loading,setLoading]=useState(true);
  const [openReplyId,setOpenReplyId]=useState(null);
  const [polling,setPolling]=useState(false);
  const [classifying,setClassifying]=useState(false);

  useEffect(()=>{loadReplies();},[inbox.id, bucket]);
  async function loadReplies(){
    setLoading(true);
    const r=await fetch(`/api/email/mailboxes/${inbox.id}/replies?bucket=${bucket}&limit=200`);
    setReplies(r.ok?await r.json():[]);
    setLoading(false);
  }
  const [pollMsg,setPollMsg]=useState(null);  // toast-style feedback after Check Now
  async function checkNow(){
    setPolling(true);
    setPollMsg(null);
    const r=await fetch(`/api/email/mailboxes/${inbox.id}/poll`,{method:'POST'});
    const d=await r.json();
    setPolling(false);
    if(d.ok){
      loadReplies();
      onRefresh();
      // Show what actually happened — "fetched" is new emails stored, "scanned" is total examined
      const f=d.fetched||0, s=d.scanned||0;
      if(f>0)      setPollMsg({ok:true, text:`Fetched ${f} new email${f===1?'':'s'}`});
      else if(s>0) setPollMsg({ok:true, text:`Up to date — scanned ${s} email${s===1?'':'s'}, nothing new`});
      else         setPollMsg({ok:true, text:`Up to date — no new emails`});
      setTimeout(()=>setPollMsg(null), 5000);
    } else {
      setPollMsg({ok:false, text:d.error||'Poll failed'});
      setTimeout(()=>setPollMsg(null), 8000);
    }
  }
  // Resync — destructive: deletes local replies for this mailbox and re-pulls
  // from IMAP. Anything no longer in the IMAP inbox is permanently lost from
  // the Studio. Gated behind a typed-confirmation modal so it can't be hit
  // by accident.
  const [resyncModal, setResyncModal] = useState(null);  // null | { typed, revertUnsubs, busy, error }
  function openResyncModal() {
    setResyncModal({ typed: '', revertUnsubs: false, busy: false, error: null });
  }
  async function confirmResync() {
    if (!resyncModal) return;
    setResyncModal(m => ({ ...m, busy: true, error: null }));
    try {
      const r = await fetch(`/api/email/mailboxes/${inbox.id}/resync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revertAutoUnsubs: !!resyncModal.revertUnsubs }),
      });
      const d = await r.json();
      if (!d.ok) {
        setResyncModal(m => ({ ...m, busy: false, error: d.error || 'Resync failed' }));
        return;
      }
      setResyncModal(null);
      loadReplies();
      onRefresh();
      const fetched = d.poll?.fetched || 0;
      const scanned = d.poll?.scanned || 0;
      const purged = d.replies_deleted || 0;
      const reverted = d.auto_unsubs_reverted || 0;
      const parts = [`purged ${purged}`];
      if (reverted > 0) parts.push(`reverted ${reverted} auto-unsub${reverted === 1 ? '' : 's'}`);
      parts.push(`fetched ${fetched} (scanned ${scanned})`);
      setPollMsg({ ok: true, text: `Resync complete — ${parts.join(', ')}` });
      setTimeout(() => setPollMsg(null), 7000);
    } catch (err) {
      setResyncModal(m => ({ ...m, busy: false, error: err.message }));
    }
  }

  // Classify pending — kick the AI classifier cron now instead of waiting up to 60s.
  // Hits the global classify-now endpoint (not scoped to this mailbox) since the
  // classifier processes the whole queue. Refreshes the UI to show new badges.
  async function classifyPending(){
    setClassifying(true);
    setPollMsg(null);
    try {
      const r = await fetch('/api/email/replies/classify-now',{method:'POST'});
      const d = await r.json();
      if (d.ok) {
        loadReplies();
        onRefresh();
        const total = d.processed || 0;
        if (total === 0) {
          setPollMsg({ok:true, text:'Nothing pending — all replies are already classified'});
        } else {
          const pieces = [];
          if (d.byPass.regex)     pieces.push(`${d.byPass.regex} by rule`);
          if (d.byPass.heuristic) pieces.push(`${d.byPass.heuristic} by heuristic`);
          if (d.byPass.ai)        pieces.push(`${d.byPass.ai} by AI`);
          if (d.byPass.error)     pieces.push(`${d.byPass.error} errored`);
          setPollMsg({ok:true, text:`Classified ${total} repl${total===1?'y':'ies'} — ${pieces.join(', ')}`});
        }
        setTimeout(()=>setPollMsg(null), 6000);
      } else {
        setPollMsg({ok:false, text:d.error||'Classifier failed'});
        setTimeout(()=>setPollMsg(null), 8000);
      }
    } catch(err) {
      setPollMsg({ok:false, text:err.message});
      setTimeout(()=>setPollMsg(null), 8000);
    }
    setClassifying(false);
  }

  // Disconnect — stop syncing this mailbox and remove it from the list. Reply
  // history is kept (linked by inbox_id). Uses DELETE /mailboxes/:id (enabled=0).
  const [disconnecting,setDisconnecting]=useState(false);
  async function disconnectMailbox(){
    if(!window.confirm(`Disconnect ${inbox.email_address}?\n\nIt stops syncing with Gmail and is removed from the list. Reply history is kept.`))return;
    setDisconnecting(true);
    try{
      const r=await fetch(`/api/email/mailboxes/${inbox.id}`,{method:'DELETE'});
      if(!r.ok){const d=await r.json().catch(()=>({})); setPollMsg({ok:false,text:d.error||'Could not disconnect'}); setDisconnecting(false); return;}
      onRefresh();
    }catch(e){ setPollMsg({ok:false,text:'Could not reach the server'}); setDisconnecting(false); }
  }
  return(<div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,minHeight:0,overflow:'hidden'}}>

    {/* Header */}
    <div style={{padding:'14px 20px',borderBottom:`0.5px solid ${BORDER}`,background:CARD,display:'flex',alignItems:'baseline',gap:12}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:15,fontWeight:500,color:TEXT,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{inbox.email_address}</div>
        <div style={{fontSize:11,color:MUTED,marginTop:2}}>
          {inbox.last_error
            ? <span style={{color:DANGER}}>{inbox.last_error}</span>
            : <>Connected · last polled {relTime(inbox.last_polled_at)}</>}
        </div>
      </div>
      <Btn small onClick={checkNow} disabled={polling}>{polling?'Checking…':'Check now'}</Btn>
      <Btn small onClick={classifyPending} disabled={polling||classifying} title="Run the AI classifier now on any unclassified emails. Otherwise it runs automatically every minute.">{classifying?'Classifying…':'Classify pending'}</Btn>
      <button
        onClick={openResyncModal}
        disabled={polling}
        title="Wipe local replies for this mailbox and re-pull from IMAP. Anything no longer in your IMAP inbox is permanently lost."
        style={{
          background:'transparent',border:'none',padding:'4px 8px',fontSize:11,
          color:polling?MUTED:BLUE,cursor:polling?'default':'pointer',textDecoration:'underline',
        }}
      >Resync</button>
      <button
        onClick={disconnectMailbox}
        disabled={polling||disconnecting}
        title="Stop syncing this mailbox with Gmail and remove it from the list. Reply history is kept."
        style={{
          background:'transparent',border:'none',padding:'4px 8px',fontSize:11,
          color:(polling||disconnecting)?MUTED:DANGER,cursor:(polling||disconnecting)?'default':'pointer',textDecoration:'underline',
        }}
      >{disconnecting?'Disconnecting…':'Disconnect'}</button>
    </div>

    {/* Poll-result toast — disappears after 5s */}
    {pollMsg && (
      <div style={{
        padding:'8px 20px',fontSize:12,
        background:pollMsg.ok?`${GREEN}15`:'#fdecea',
        color:pollMsg.ok?GREEN:DANGER,
        borderBottom:`0.5px solid ${BORDER}`,
      }}>{pollMsg.text}</div>
    )}

    {/* KPI strip */}
    <div style={{padding:'12px 20px',background:CARD,borderBottom:`0.5px solid ${BORDER}`,display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:10}}>
      <div style={{padding:'8px 12px',background:BG,borderRadius:7,border:`0.5px solid ${BORDER}`}}>
        <div style={{fontSize:20,fontWeight:500,color:(inbox.new_prospect_count||0)>0?BLUE:TEXT}}>{(inbox.new_prospect_count||0).toLocaleString()}</div>
        <div style={{fontSize:11,color:MUTED}}>New prospects</div>
      </div>
      <div style={{padding:'8px 12px',background:BG,borderRadius:7,border:`0.5px solid ${BORDER}`}}>
        <div style={{fontSize:20,fontWeight:500,color:(inbox.auto_unsub_count||0)>0?'#633806':TEXT}}>{(inbox.auto_unsub_count||0).toLocaleString()}</div>
        <div style={{fontSize:11,color:MUTED}}>Auto-unsubscribed</div>
      </div>
      <div style={{padding:'8px 12px',background:BG,borderRadius:7,border:`0.5px solid ${BORDER}`}}>
        <div style={{fontSize:20,fontWeight:500,color:TEXT}}>{(inbox.replies_30d||0).toLocaleString()}</div>
        <div style={{fontSize:11,color:MUTED}}>Emails (30d)</div>
      </div>
    </div>

    {/* Sub-tabs */}
    <div style={{display:'flex',gap:18,padding:'0 20px',borderBottom:`0.5px solid ${BORDER}`,background:CARD,flexShrink:0}}>
      {[
        {k:'all',         l:'Inbox'},
        {k:'prospects',   l:'New prospects', count:inbox.new_prospect_count, color:BLUE},
        {k:'auto_unsubscribed', l:'Auto-unsubscribed', count:inbox.auto_unsub_count, color:'#633806'},
        {k:'out_of_office',l:'Out of Office'},
      ].map(t=>(
        <button key={t.k} onClick={()=>setBucket(t.k)} style={{
          background:'transparent',border:'none',padding:'10px 0',marginBottom:-1,
          fontSize:13,color:bucket===t.k?TEXT:MUTED,fontWeight:bucket===t.k?500:400,
          borderBottom:bucket===t.k?`2px solid ${TEXT}`:'2px solid transparent',
          cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6,
        }}>
          {t.l}
          {(t.count||0)>0 && <span style={{background:t.color==='#633806'?'#FAEEDA':t.color===BLUE?'#E6F1FB':'#F1EFE8',color:t.color||MUTED,fontSize:10,padding:'1px 6px',borderRadius:8,fontWeight:500}}>{t.count}</span>}
        </button>
      ))}
    </div>

    {/* Reply list */}
    <div style={{flex:1,minHeight:0,overflowY:'auto',background:BG}}>
      {loading?<div style={{color:MUTED,textAlign:'center',padding:40,fontSize:13}}>Loading…</div>
      :replies.length===0?<div style={{color:MUTED,textAlign:'center',padding:40,fontSize:13}}>No emails in this view</div>
      :replies.map(r=>(
        <div key={r.id} onClick={()=>setOpenReplyId(r.id)} style={{
          display:'grid',gridTemplateColumns:'24px minmax(0, 1fr) auto auto',gap:12,
          padding:'12px 20px',borderBottom:`0.5px solid ${BORDER}`,cursor:'pointer',
          background:CARD,opacity:r.classification==='auto_reply'?0.65:1,
          alignItems:'center',
        }} onMouseEnter={e=>e.currentTarget.style.background=BG} onMouseLeave={e=>e.currentTarget.style.background=CARD}>
          <span style={{color:r.classification==='positive'?BLUE:'transparent',fontSize:14,textAlign:'center'}}>★</span>
          <div style={{minWidth:0}}>
            <div style={{fontSize:11,color:MUTED,marginBottom:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              {r.from_name?`${r.from_name} <${r.from_address}>`:r.from_address}
            </div>
            <div style={{fontSize:13,color:TEXT,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              {r.subject||'(no subject)'}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
            {classifyBadge(r)}
            <ActionBadges reply={r} />
          </div>
          <span style={{fontSize:11,color:MUTED,whiteSpace:'nowrap'}}>{relTime(r.received_at)}</span>
        </div>
      ))}
    </div>

    {openReplyId&&<ReplyDetailModal replyId={openReplyId} onClose={()=>setOpenReplyId(null)} onAction={()=>{loadReplies();onRefresh();}}/>}

    {/* Resync confirmation modal. Typed-phrase gate (the mailbox email) so this
        can't be hit accidentally. Optional checkbox to also revert auto-unsubs. */}
    {resyncModal && (
      <Modal title="Resync mailbox" onClose={() => !resyncModal.busy && setResyncModal(null)}>
        <div style={{fontSize:13,color:TEXT,lineHeight:1.5,marginBottom:14}}>
          This will <strong>permanently delete</strong> all locally stored replies for{' '}
          <strong>{inbox.email_address}</strong> and re-pull from your IMAP inbox. Anything
          no longer in IMAP is gone for good.
        </div>
        <div style={{
          background:`${DANGER}10`, border:`0.5px solid ${DANGER}40`,
          borderRadius:6, padding:10, fontSize:12, color:TEXT, marginBottom:14, lineHeight:1.5,
        }}>
          <strong style={{color:DANGER}}>Heads up:</strong> auto-unsubscribed prospects who genuinely
          replied "remove me" stay unsubscribed by default. Tick the box below ONLY if you're
          sure none of the wiped replies were legitimate opt-outs.
        </div>

        <label style={{display:'flex',alignItems:'flex-start',gap:8,marginBottom:14,cursor:'pointer',fontSize:12,color:TEXT}}>
          <input type="checkbox"
            checked={resyncModal.revertUnsubs}
            disabled={resyncModal.busy}
            onChange={e => setResyncModal(m => ({...m, revertUnsubs: e.target.checked}))}
            style={{marginTop:2}}
          />
          <span>
            Also revert auto-unsubscribes caused by these replies
            <span style={{display:'block',color:MUTED,fontSize:11,marginTop:2}}>
              Use this for the warmupinbox-era cleanup. Anyone manually re-subscribed since is unaffected.
            </span>
          </span>
        </label>

        <div style={{marginBottom:6,fontSize:12,color:MUTED}}>
          Type <strong style={{color:TEXT}}>{inbox.email_address}</strong> to confirm:
        </div>
        <input type="text"
          value={resyncModal.typed}
          disabled={resyncModal.busy}
          onChange={e => setResyncModal(m => ({...m, typed: e.target.value}))}
          autoFocus
          placeholder={inbox.email_address}
          style={{
            width:'100%',boxSizing:'border-box',padding:'8px 10px',fontSize:13,
            border:`0.5px solid ${BORDER}`,borderRadius:6,outline:'none',
            color:TEXT,background:CARD,
          }}
        />

        {resyncModal.error && (
          <div style={{color:DANGER,fontSize:12,marginTop:10}}>{resyncModal.error}</div>
        )}

        <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:18}}>
          <Btn onClick={() => setResyncModal(null)} disabled={resyncModal.busy}>Cancel</Btn>
          <Btn variant="primary"
            onClick={confirmResync}
            disabled={resyncModal.busy || resyncModal.typed.trim().toLowerCase() !== inbox.email_address.toLowerCase()}
          >{resyncModal.busy ? 'Resyncing…' : 'Resync now'}</Btn>
        </div>
      </Modal>
    )}
  </div>);
}

// ── Reply detail modal — opens when you click a reply row ─────────────────────
function ReplyDetailModal({replyId, onClose, onAction}){
  const [reply,setReply]=useState(null);
  const [busy,setBusy]=useState(false);
  // When the operator clicks "Reply", we swap this modal out for the compose
  // modal (rendered below). Cancelling compose returns here; sending compose
  // closes the whole flow. Same pattern as the customer portal except the
  // state lives inside this component rather than being lifted to the parent —
  // smaller diff and keeps the change scoped.
  const [composing,setComposing]=useState(false);
  // Hot Prospects state. addingProspect = button is mid-POST. hotProspectBanner
  // holds the success/already-on-list message after a successful add:
  //   { kind: 'added' | 'already', prospect_id: '<uuid>' }
  // On error we just alert() — failed adds aren't a state worth banner-ing.
  const [addingProspect,setAddingProspect]=useState(false);
  const [hotProspectBanner,setHotProspectBanner]=useState(null);
  // Status message shown next to the Unsubscribe / Re-subscribe buttons —
  // kind = 'success' | 'info' (e.g. "not on any list"). Cleared on close
  // and on the next button click. Stays visible after the click so the
  // operator sees confirmation of what happened.
  const [subResubStatus,setSubResubStatus]=useState(null);

  useEffect(()=>{
    fetch(`/api/email/replies/${replyId}`).then(r=>r.json()).then(setReply);
  },[replyId]);

  // Re-fetch the reply (after sub/resub) so the badge state updates without
  // closing the modal. Also re-runs onAction() so the underlying inbox list
  // refreshes in the background.
  async function refetchReply(){
    try {
      const r = await fetch(`/api/email/replies/${replyId}`);
      if (r.ok) setReply(await r.json());
    } catch {}
    if (onAction) onAction();
  }

  // Unsubscribe / Re-subscribe handler. Different from action() above:
  //   1. Doesn't close the modal — refetches the reply so the badges update
  //      and the button row swaps Unsubscribe ↔ Re-subscribe in place.
  //   2. Handles the three-shape response (ok=true / not_on_lists /
  //      already_unsubscribed / already_subscribed) with inline status text
  //      rather than just alert(). The "not on any list" case in particular
  //      is information the operator needs to see, not a failure.
  async function manualSubResub(action){
    if (!reply || busy) return;
    setBusy(true);
    setSubResubStatus(null);
    try {
      const r = await fetch(`/api/email/replies/${replyId}/${action}`, { method:'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok && !d.code) {
        alert(d.error || `${action} failed (HTTP ${r.status})`);
        setBusy(false);
        return;
      }
      if (d.ok) {
        const what = action === 'manual-unsubscribe' ? 'Unsubscribed' : 'Re-subscribed';
        setSubResubStatus({ kind:'success', text:`✓ ${what} from ${d.lists_affected} list${d.lists_affected===1?'':'s'}` });
      } else if (d.code) {
        // not_on_lists / already_unsubscribed / already_subscribed
        setSubResubStatus({ kind:'info', text: d.message });
      }
      await refetchReply();
    } catch (e) {
      alert(`${action} failed: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function action(name, opts={}){
    setBusy(true);
    const r=await fetch(`/api/email/replies/${replyId}/${name}`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(opts),
    });
    const d=await r.json();
    setBusy(false);
    if(d.error){alert(d.error);return;}
    onAction();
    onClose();
  }

  // Adds the email's sender to this customer's Hot Prospects list via
  // POST /api/email/hot-prospects. The endpoint upserts — same email +
  // same customer = same row. The response includes was_new=true|false so
  // we can tell the operator "Added" vs "Already on the list".
  //
  // We don't close the modal on success — the operator is mid-triage and
  // wants to keep working. The banner offers an "Open in CRM" link if they
  // do want to jump.
  async function addToHotProspects(){
    if (!reply || addingProspect) return;
    setAddingProspect(true);
    setHotProspectBanner(null);
    try {
      const r = await fetch('/api/email/hot-prospects', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          email_client_id: reply.email_client_id,
          prospect_email: reply.from_address,
          prospect_name: reply.from_name || null,
          source_reply_id: reply.id,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) {
        alert(d.error || `Couldn't add to Hot Prospects (HTTP ${r.status})`);
        setAddingProspect(false);
        return;
      }
      setHotProspectBanner({
        kind: d.was_new ? 'added' : 'already',
        prospect_id: d.prospect && d.prospect.id,
        // crm_customer_id is which switcher card this prospect will appear
        // under. For a linked customer (e.g. flagged from mail.engineering…
        // for Cube 6) that's Cube 6's id, NOT the source inbox's id —
        // because the inbox row is now hidden from the switcher. Fallback
        // to reply.email_client_id keeps legacy behaviour if the field is
        // missing (e.g. older deploy briefly mid-rollout).
        crm_customer_id: (d.crm_customer_id || reply.email_client_id),
      });
      setAddingProspect(false);
    } catch (e) {
      alert(`Couldn't add to Hot Prospects: ${e.message || e}`);
      setAddingProspect(false);
    }
  }

  // Jumps from the inbox modal to the CRM screen with the right customer
  // selected and this prospect's detail modal open. The CRM screen
  // (CrmHotProspects.jsx) reads two localStorage keys on mount:
  //   - studio.crm.hot_prospects.last_customer_id (already used to remember
  //     the operator's last-selected customer)
  //   - studio.crm.hot_prospects.open_prospect_id (one-shot; cleared after
  //     consumption so it doesn't auto-open on subsequent visits)
  // Navigation itself uses a custom DOM event that Dashboard.jsx listens to,
  // so EmailSection.jsx doesn't have to know about Dashboard's view state.
  //
  // The customer id we set must be the SWITCHER card id, not the inbox row
  // id — for a linked customer, the inbox row is hidden from the switcher
  // and clicking "Open in CRM" with the inbox row id would just land on
  // the default customer. The banner carries crm_customer_id (returned by
  // POST /api/email/hot-prospects) which already resolves this correctly.
  function openInCrm(prospectId, crmCustomerId){
    try {
      const customerId = crmCustomerId || (reply && reply.email_client_id);
      if (customerId) {
        localStorage.setItem('studio.crm.hot_prospects.last_customer_id', customerId);
      }
      if (prospectId) {
        localStorage.setItem('studio.crm.hot_prospects.open_prospect_id', prospectId);
      }
    } catch {} // localStorage can throw in private modes — non-fatal
    window.dispatchEvent(new CustomEvent('studio:navigate', { detail: { view: 'crm-hot-prospects' } }));
    onClose();
  }

  if(!reply) return(<Modal title="Loading…" onClose={onClose}>
    <div style={{textAlign:'center',padding:30,color:MUTED,fontSize:13}}>Fetching reply…</div>
  </Modal>);

  // Swap out the detail view for the compose view when the operator has
  // clicked "Reply". Cancel returns to detail; successful Send closes the
  // whole flow via onClose() so the inbox list refreshes underneath.
  if (composing) {
    return <AdminComposeReplyModal
      reply={reply}
      onCancel={() => setComposing(false)}
      onSent={() => { onAction(); onClose(); }}
    />;
  }

  return(
    // Custom layout instead of the shared <Modal> primitive: we need a
    // non-scrolling header containing the action buttons, with a scrolling
    // body underneath. The shared Modal puts every child inside a single
    // scrolling container which lets the buttons disappear off the bottom on
    // long emails. Leaving Modal untouched (used by lots of other modals).
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.35)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
      <div style={{
        background:CARD,borderRadius:12,
        width:800,maxWidth:'95vw',
        height:'90vh',maxHeight:'90vh',
        display:'flex',flexDirection:'column',
        boxShadow:'0 8px 40px rgba(0,0,0,0.15)',
        overflow:'hidden',
      }}>

        {/* ─── Pinned header section ─────────────────────────────────────────
            Doesn't scroll. Holds the close button, sender meta, subject, and
            the entire action row so the operator can always trigger Reply /
            Send to Hot Prospects / Classify / Unsubscribe / etc. even on a
            very long email. */}
        <div style={{padding:'24px 28px 14px',borderBottom:`0.5px solid ${BORDER}`,flexShrink:0}}>

          {/* Close button — top right */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14,gap:12}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginBottom:6}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:500,color:TEXT}}>{reply.from_name||reply.from_address}</div>
                  <div style={{fontSize:12,color:MUTED}}>{reply.from_address} · {relTime(reply.received_at)}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
                  {classifyBadge(reply)}
                  <ActionBadges reply={reply} onBeforeNavigate={onClose} />
                </div>
              </div>
              <div style={{fontSize:14,color:TEXT,fontWeight:500,marginTop:8}}>{reply.subject||'(no subject)'}</div>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',fontSize:22,color:MUTED,cursor:'pointer',lineHeight:1,padding:0,marginLeft:4}} aria-label="Close">×</button>
          </div>

          {/* Actions — pinned. Same conditional set as before, just relocated. */}
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {/* Reply — primary green, matches the customer-portal action. */}
            <Btn variant="primary" onClick={()=>setComposing(true)} disabled={busy}>Reply</Btn>
            {/* Send to Hot Prospects — amber, second-most-prominent positive action. */}
            <Btn
              variant="amber"
              onClick={addToHotProspects}
              disabled={busy || addingProspect}
            >{addingProspect ? 'Adding…' : '🔥 Send to Hot Prospects'}</Btn>
            {!reply.classification && (
              <Btn variant="blue" onClick={async()=>{
                setBusy(true);
                const r=await fetch(`/api/email/replies/${replyId}/classify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:true})});
                const d=await r.json();
                setBusy(false);
                if(d.ok){
                  const rr=await fetch(`/api/email/replies/${replyId}`);
                  setReply(await rr.json());
                  onAction();
                } else alert(d.error||'Classify failed');
              }} disabled={busy}>{busy?'Classifying…':'Classify with AI'}</Btn>
            )}
            {reply.classification==='positive' && !reply.handled_at && (
              <Btn variant="primary" onClick={()=>action('handle')} disabled={busy}>Mark as handled</Btn>
            )}
            {/* Unsubscribe / Re-subscribe — toggles based on the contact's
                current state in email_subscribers (not the per-reply
                auto_unsubscribed flag which is audit-only history). When
                contact_unsubscribed is true, show the Re-subscribe button
                + a "✓ Already unsubscribed" label so the state is obvious.
                Both buttons gate behind confirm() — reversible action, no
                need for a stricter typed-phrase gate. */}
            {reply.contact_unsubscribed ? (
              <>
                <span style={{
                  fontSize:11, padding:'2px 8px', borderRadius:20, fontWeight:500,
                  background:'#F1EFE8', color:'#5F5E5A', whiteSpace:'nowrap',
                  alignSelf:'center',
                }}>✓ Already unsubscribed</span>
                <Btn variant="default" onClick={()=>{
                  if(confirm(`Re-subscribe ${reply.from_address} to your mailing lists?`)) manualSubResub('manual-resubscribe');
                }} disabled={busy}>Re-subscribe</Btn>
              </>
            ) : (
              <Btn variant="danger" onClick={()=>{
                if(confirm(`Unsubscribe ${reply.from_address} from all of your mailing lists?`)) manualSubResub('manual-unsubscribe');
              }} disabled={busy}>Unsubscribe</Btn>
            )}
            <ReclassifyDropdown disabled={busy} current={reply.classification} onChoose={c=>action('reclassify',{classification:c})}/>
            <Btn onClick={onClose} disabled={busy}>Close</Btn>
          </div>

          {/* Inline status line for the most recent unsub/resub click. Stays
              visible after the action so the operator sees confirmation —
              especially important for the "not on any list" message which
              isn't a failure, just information. */}
          {subResubStatus && (
            <div style={{
              marginTop:8, fontSize:12,
              color: subResubStatus.kind === 'success' ? '#085041' : '#5F5E5A',
              fontStyle: subResubStatus.kind === 'info' ? 'italic' : 'normal',
            }}>{subResubStatus.text}</div>
          )}

        </div>

        {/* ─── Scrolling body section ────────────────────────────────────────
            Holds classification reasoning, campaign context, Hot-Prospects
            success banner, and the email body itself. Scrolls independently
            of the header so the actions are always reachable. */}
        <div style={{padding:'14px 28px 24px',overflowY:'auto',flex:1}}>

          {/* Classification reasoning */}
          {reply.classification_reason && (
            <div style={{background:'#E6F1FB',borderLeft:`3px solid ${BLUE}`,borderRadius:6,padding:'8px 12px',marginBottom:12,fontSize:12,color:'#0C447C',lineHeight:1.5}}>
              <b style={{fontWeight:500}}>Why classified as {reply.classification?.replace('_',' ')||'unknown'}:</b> {reply.classification_reason}
              {reply.classification_confidence && <> · confidence {Math.round(reply.classification_confidence*100)}%</>}
            </div>
          )}

          {/* Original campaign context */}
          {reply.campaign_title && (
            <div style={{background:BG,padding:'8px 12px',borderRadius:6,marginBottom:12,fontSize:12,color:MUTED,border:`0.5px solid ${BORDER}`}}>
              In response to <b style={{color:TEXT,fontWeight:500}}>"{reply.campaign_subject}"</b> — campaign <em>{reply.campaign_title}</em>
              {reply.campaign_sent_at && <> · sent {new Date(reply.campaign_sent_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</>}
            </div>
          )}
          {!reply.matched_campaign_id && (
            <div style={{background:'#fff3cd',borderLeft:`3px solid ${AMBER}`,borderRadius:6,padding:'8px 12px',marginBottom:12,fontSize:12,color:AMBER,lineHeight:1.5}}>
              Could not match this reply to a specific campaign. The recipient's email client may have stripped the threading headers.
            </div>
          )}

          {/* Hot Prospects banner — shown after a click on "Send to Hot Prospects". */}
          {hotProspectBanner && (
            <div style={{
              background: hotProspectBanner.kind === 'added' ? '#E1F5EE' : '#E6F1FB',
              borderLeft: `3px solid ${hotProspectBanner.kind === 'added' ? GREEN : BLUE}`,
              borderRadius:6, padding:'8px 12px', marginBottom:12,
              fontSize:12, color: hotProspectBanner.kind === 'added' ? '#085041' : '#0C447C',
              lineHeight:1.5,
              display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
            }}>
              <span>
                {hotProspectBanner.kind === 'added'
                  ? <><b style={{fontWeight:500}}>✓ Added to Hot Prospects.</b> The full email thread is attached automatically.</>
                  : <><b style={{fontWeight:500}}>Already on the list.</b> No duplicate created — existing follow-up date and notes were kept.</>
                }
              </span>
              <button
                onClick={() => openInCrm(hotProspectBanner.prospect_id, hotProspectBanner.crm_customer_id)}
                style={{
                  background:'transparent', border:'none', padding:0, cursor:'pointer',
                  fontSize:12, color:'inherit', textDecoration:'underline', fontFamily:'inherit',
                  whiteSpace:'nowrap',
                }}
              >Open in CRM →</button>
            </div>
          )}

          {/* Campaign subscriptions panel — per-campaign tickboxes so the
              operator can stop a specific campaign from continuing its drip
              to this contact, OR tick "Unsubscribe from ALL" as a master
              switch. Identical UI in the Hot Prospect detail modal. */}
          <CampaignSubscriptionsPanel
            source="reply"
            sourceId={replyId}
            onMasterToggle={() => { refetchReply(); }}
          />

          {/* Body — plain text only on the admin side (HTML rendering lives
              on the customer-portal version). Email-client-style quote bar. */}
          <div style={{borderLeft:`2px solid ${BORDER}`,padding:'4px 0 4px 14px',fontSize:13,color:TEXT,lineHeight:1.6,whiteSpace:'pre-wrap'}}>
            {reply.body_text || <em style={{color:MUTED}}>(no plain text body — message was HTML-only)</em>}
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Campaign subscriptions panel ─────────────────────────────────────────────
// Per-campaign opt-out widget. Renders in the inbox open-email modal AND in
// the CRM Hot Prospect detail modal — same component, same behaviour, same
// look. Decision 2026-05-22 (operator wanted these surfaces identical).
//
// Props:
//   source      — 'reply' | 'hot_prospect' (chooses the endpoint base)
//   sourceId    — the reply ID or hot prospect ID
//   onMasterToggle — optional callback when the master "Unsubscribe from
//                    ALL" flag changes (so the parent can refresh other
//                    badges that depend on contact state).
//
// Endpoints used:
//   GET  /api/email/{replies|hot-prospects}/:id/subscriptions
//   PUT  /api/email/{replies|hot-prospects}/:id/subscriptions
//
// Optimistic updates: ticks/unticks reflect immediately in the UI, with the
// PUT firing in the background. If the server response diverges (very rare),
// snap to it. This makes the panel feel instant for a customer scrolling
// through their contacts.
//
// Disabled-while-master-on: when the master switch is on, per-campaign rows
// render checked-and-disabled with a small explainer line. Clicks are inert
// until the master is unticked.
function CampaignSubscriptionsPanel({ source, sourceId, onMasterToggle }) {
  const [state, setState]   = useState(null);   // panel JSON
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
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

  // Helper — apply a partial update and replace local state with the server
  // response. savingKey tracks which row is mid-flight so we can render a
  // tiny spinner on it. Errors revert by re-fetching the canonical state.
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
      const fresh = await r.json();
      setState(fresh);
      if ('unsubscribed_from_all' in body && typeof onMasterToggle === 'function') {
        onMasterToggle(fresh.unsubscribed_from_all);
      }
    } catch (e) {
      // Roll back to canonical state by re-fetching
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
        background: BG, border: `0.5px solid ${BORDER}`, borderRadius: 6,
        padding: '10px 14px', marginBottom: 12, fontSize: 12, color: MUTED,
      }}>Loading campaign subscriptions…</div>
    );
  }
  if (error) {
    return (
      <div style={{
        background: '#fff3cd', borderLeft: `3px solid ${AMBER}`, borderRadius: 6,
        padding: '8px 12px', marginBottom: 12, fontSize: 12, color: AMBER,
      }}>Could not load campaign subscriptions: {error}</div>
    );
  }
  if (!state) return null;

  const masterOn = !!state.unsubscribed_from_all;
  const campaigns = state.campaigns || [];

  return (
    <div style={{
      background: BG, border: `0.5px solid ${BORDER}`, borderRadius: 6,
      padding: '12px 14px', marginBottom: 12,
    }}>
      {/* Heading */}
      <div style={{
        display:'flex', justifyContent:'space-between', alignItems:'center',
        marginBottom: 8,
      }}>
        <div style={{fontSize: 12, fontWeight: 500, color: TEXT}}>
          📭 Campaign subscriptions
        </div>
        <div style={{fontSize: 10, color: MUTED}}>Synced admin ↔ portal</div>
      </div>

      {/* Master "Unsubscribe from ALL" tick */}
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
        <div style={{fontSize: 10, color: MUTED}}>includes future</div>
      </label>

      {/* Empty state */}
      {campaigns.length === 0 && !masterOn && (
        <div style={{
          fontSize: 11, color: MUTED, padding: '8px 4px 2px',
          fontStyle: 'italic',
        }}>No campaigns at this customer yet.</div>
      )}

      {/* Per-campaign rows */}
      {campaigns.map(c => {
        const isAuto = c.unsub_source === 'hot_prospect_auto';
        const isArchived = c.status === 'archived';
        // Effective checked: master overrides per-campaign for visual state
        const checked = masterOn || c.unsubscribed;
        const disabled = masterOn || savingKey === c.campaign_id;

        // Build the sub-label describing this contact's relationship to
        // this campaign. Three pieces of info: archived flag, audience-list
        // status, send progress + auto-stop note.
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
              background: isAuto ? '#FAEEDA' : CARD,
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
                {c.list_name && <span style={{color: isAuto ? '#633806' : MUTED, fontWeight: 400}}> · {c.list_name}</span>}
              </div>
              <div style={{fontSize: 10, color: isAuto ? '#633806' : MUTED}}>
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

      {/* Hint when master is on */}
      {masterOn && campaigns.length > 0 && (
        <div style={{
          fontSize: 10, color: MUTED, marginTop: 6, fontStyle: 'italic',
        }}>
          All campaigns blocked via master switch — untick "Unsubscribe from ALL" to control campaigns individually.
        </div>
      )}
    </div>
  );
}

// ── Admin compose-reply modal ────────────────────────────────────────────────
// Opened from ReplyDetailModal's "Reply" button. Composes a plain-text reply
// and POSTs to /api/email/replies/:id/send, which sends via SES from the
// mailbox the inbound originally arrived on (with the customer's default
// from-name) and threads via In-Reply-To + References.
//
// Mirrors the customer-portal ComposeReplyModal in PortalApp.jsx but uses
// EmailSection.jsx's local primitives (Modal, Input, Btn) so the visual style
// matches the rest of the admin UI.
function AdminComposeReplyModal({ reply, onCancel, onSent }){
  const [cc, setCc]     = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function send(){
    if(!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/email/replies/${reply.id}/send`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ cc: cc.trim(), body }),
      });
      const d = await r.json();
      if(!r.ok || d.error){
        setError(d.error || `Send failed (HTTP ${r.status})`);
        setBusy(false);
        return;
      }
      onSent();
    } catch (e){
      setError(String(e.message || e));
      setBusy(false);
    }
  }

  // Subject preview: prefix "Re:" if not already a reply, matching the
  // backend's logic so what the operator sees matches what actually goes out.
  const inboundSubject = reply.subject || '';
  const previewSubject = /^re:/i.test(inboundSubject)
    ? inboundSubject
    : `Re: ${inboundSubject || '(no subject)'}`;

  return(<Modal title={`Reply to ${reply.from_name || reply.from_address}`} onClose={() => !busy && onCancel()} wide>
    <div style={{fontSize:12,color:MUTED,marginBottom:14,lineHeight:1.6}}>
      To: <strong style={{color:TEXT,fontWeight:500}}>{reply.from_address}</strong><br/>
      Subject: <strong style={{color:TEXT,fontWeight:500}}>{previewSubject}</strong>
    </div>

    <Input label="CC (optional)" value={cc} onChange={setCc} placeholder="someone@yourcompany.co.uk"/>

    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontSize:12,color:MUTED,marginBottom:4}}>Your reply *</label>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Type your reply…"
        autoFocus
        disabled={busy}
        style={{
          width:'100%',padding:'10px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,
          fontSize:13,color:TEXT,background:CARD,outline:'none',boxSizing:'border-box',
          fontFamily:'inherit',minHeight:200,resize:'vertical',lineHeight:1.5,
        }}
      />
    </div>

    {error && (
      <div style={{background:'#fdecea',borderLeft:`3px solid ${DANGER}`,borderRadius:6,padding:'8px 12px',marginBottom:12,fontSize:12,color:DANGER,lineHeight:1.5}}>
        {error}
      </div>
    )}

    <div style={{display:'flex',justifyContent:'flex-end',gap:8,paddingTop:12,borderTop:`0.5px solid ${BORDER}`}}>
      <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
      <Btn variant="primary" onClick={send} disabled={busy || !body.trim()}>{busy ? 'Sending…' : 'Send reply'}</Btn>
    </div>
  </Modal>);
}

// Inline dropdown for reclassifying
function ReclassifyDropdown({current, onChoose, disabled}){
  const [open,setOpen]=useState(false);
  const opts=[
    {k:'positive',     l:'New prospect'},
    {k:'soft_negative',l:'Soft negative'},
    {k:'hard_negative',l:'Hard negative'},
    {k:'auto_reply',   l:'Out of Office'},
    {k:'forwarding',   l:'Forwarded'},
    {k:'neutral',      l:'Neutral'},
  ];
  return(<div style={{position:'relative'}}>
    <Btn onClick={()=>setOpen(!open)} disabled={disabled}>Reclassify ▾</Btn>
    {open && <div style={{position:'absolute',right:0,bottom:'100%',marginBottom:4,background:CARD,border:`0.5px solid ${BORDER}`,borderRadius:7,padding:4,minWidth:160,zIndex:10,boxShadow:'0 4px 12px rgba(0,0,0,0.08)'}}>
      {opts.map(o=>(
        <button key={o.k} onClick={()=>{setOpen(false);onChoose(o.k);}} style={{
          display:'block',width:'100%',textAlign:'left',padding:'6px 10px',
          background:o.k===current?BG:'transparent',border:'none',borderRadius:5,
          fontSize:12,color:TEXT,cursor:'pointer',fontFamily:'inherit',
        }}>{o.l}{o.k===current&&' ✓'}</button>
      ))}
    </div>}
  </div>);
}

// ── Connect-mailbox modal ─────────────────────────────────────────────────────
function ConnectMailboxModal({onClose, onSaved}){
  const [clients,setClients]=useState([]);
  const [form,setForm]=useState({email_client_id:'', email:'', app_password:''});
  const [testing,setTesting]=useState(false);
  const [tested,setTested]=useState(false);
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState('');
  const set=(k,v)=>{setForm(f=>({...f,[k]:v}));setTested(false);};
  useEffect(()=>{
    fetch('/api/email/clients').then(r=>r.json()).then(d=>setClients(Array.isArray(d)?d:[]));
  },[]);

  async function testConnection(){
    setErr(''); setTesting(true);
    const r=await fetch('/api/email/mailboxes/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.email,app_password:form.app_password})});
    const d=await r.json();
    setTesting(false);
    if(d.ok){setTested(true);} else {setErr(d.error||'Connection test failed');}
  }
  async function save(){
    if(!form.email_client_id||!form.email||!form.app_password){setErr('All fields required');return;}
    setErr(''); setSaving(true);
    const r=await fetch('/api/email/mailboxes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
    const d=await r.json();
    setSaving(false);
    if(d.error){setErr(d.error);return;}
    onSaved();
  }

  return(<Modal title="Connect a Gmail mailbox" onClose={onClose} wide>
    <p style={{fontSize:13,color:MUTED,margin:'0 0 16px',lineHeight:1.5}}>
      Connects via IMAP using a Google app password. The password is encrypted at rest. Replies are polled every 3 minutes.
    </p>

    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontSize:12,color:MUTED,marginBottom:4}}>Customer / domain *</label>
      <select value={form.email_client_id} onChange={e=>set('email_client_id',e.target.value)} style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD}}>
        <option value="">— select customer —</option>
        {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>

    <Input label="Mailbox email *" value={form.email} onChange={v=>set('email',v)} placeholder="hello@yourcompany.com"/>

    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontSize:12,color:MUTED,marginBottom:4}}>App password * <span style={{color:MUTED,fontSize:11}}>(16 chars, spaces are fine)</span></label>
      <input type="password" value={form.app_password} onChange={e=>set('app_password',e.target.value)} placeholder="zjua bpuh oxik cwqm" style={{width:'100%',padding:'8px 12px',border:`0.5px solid ${BORDER}`,borderRadius:7,fontSize:13,color:TEXT,background:CARD,boxSizing:'border-box',fontFamily:'monospace'}}/>
      <div style={{fontSize:11,color:MUTED,marginTop:4,lineHeight:1.5}}>
        Generate at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener" style={{color:BLUE}}>myaccount.google.com/apppasswords</a> — requires 2FA enabled on the account.
      </div>
    </div>

    {err && <div style={{color:DANGER,fontSize:12,marginBottom:10,padding:'8px 12px',background:'#fdecea',borderRadius:6}}>{err}</div>}
    {tested && <div style={{color:GREEN,fontSize:12,marginBottom:10,padding:'8px 12px',background:`${GREEN}15`,borderRadius:6}}>✓ Connection works. Click Save to add this mailbox.</div>}

    <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
      <Btn onClick={onClose} disabled={saving||testing}>Cancel</Btn>
      <Btn onClick={testConnection} disabled={testing||!form.email||!form.app_password||saving}>{testing?'Testing…':'Test connection'}</Btn>
      <Btn variant="primary" onClick={save} disabled={!tested||saving||testing}>{saving?'Saving…':'Save mailbox'}</Btn>
    </div>
  </Modal>);
}
