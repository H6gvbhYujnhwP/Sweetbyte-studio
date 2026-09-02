import React from 'react';
import { SB } from '../brand.js';

const STATUS_CONFIG = {
  completed: { label: 'Deployed', bg: SB.tint, color: SB.dark, dot: SB.primary },
  running:   { label: 'Generating...', bg: '#FAEEDA', color: '#633806', dot: '#EF9F27' },
  failed:    { label: 'Failed', bg: '#FCEBEB', color: '#501313', dot: '#E24B4A' },
  pending:   { label: 'Queued', bg: '#E6F1FB', color: '#0C447C', dot: '#378ADD' },
  default:   { label: 'No runs yet', bg: '#f0f0ec', color: '#888', dot: '#ccc' }
};

export default function ClientCard({ client, onClick }) {
  const cfg = STATUS_CONFIG[client.last_status] || STATUS_CONFIG.default;
  const lastRun = client.last_run
    ? new Date(client.last_run).toLocaleDateString('en-GB', { day:'numeric', month:'short' })
    : 'Never';

  const progress = client.last_status === 'running' ? 60 : client.last_status === 'completed' ? 100 : 0;

  return (
    <div
      onClick={onClick}
      style={{
        background:'#fff', border:'0.5px solid #e0e0dc', borderRadius:12,
        overflow:'hidden', cursor:'pointer', transition:'border-color 0.15s'
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#b0b0ac'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#e0e0dc'}
    >
      <div style={{ height:3, background: cfg.dot === '#ccc' ? '#eee' : cfg.dot, opacity: 0.6 }} />
      <div style={{ padding:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
          <div>
            <div style={{ fontSize:14, fontWeight:500, color:'#1a1a1a', marginBottom:2 }}>{client.name}</div>
            <div style={{ fontSize:12, color:'#888' }}>{client.website || client.brand}</div>
          </div>
          <span style={{
            fontSize:11, padding:'3px 9px', borderRadius:20,
            background: cfg.bg, color: cfg.color,
            display:'inline-flex', alignItems:'center', gap:5, flexShrink:0
          }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background: cfg.dot, display:'inline-block' }} />
            {cfg.label}
          </span>
        </div>

        <div style={{ display:'flex', gap:20, marginBottom:12 }}>
          <div style={{ fontSize:12, color:'#888' }}>
            <span style={{ color:'#1a1a1a', fontWeight:500 }}>{client.campaign_count || 0}</span> campaigns
          </div>
          <div style={{ fontSize:12, color:'#888' }}>
            <span style={{ color:'#1a1a1a', fontWeight:500 }}>{client.cadence}</span> cadence
          </div>
          <div style={{ fontSize:12, color:'#888' }}>
            Last: <span style={{ color:'#1a1a1a', fontWeight:500 }}>{lastRun}</span>
          </div>
        </div>

        <div style={{ height:3, background:'#f0f0ec', borderRadius:2 }}>
          <div style={{ height:'100%', width:`${progress}%`, background:SB.primary, borderRadius:2, transition:'width 0.3s' }} />
        </div>
      </div>
    </div>
  );
}
