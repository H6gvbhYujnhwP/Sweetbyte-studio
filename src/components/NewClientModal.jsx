import React, { useState } from 'react';
import { SB } from '../brand.js';

const FIELD = ({ label, name, value, onChange, type='text', required=false, hint='' }) => (
  <div style={{ marginBottom:14 }}>
    <label style={{ display:'block', fontSize:12, color:'#555', marginBottom:5, fontWeight:500 }}>
      {label}{required && <span style={{ color:'#E24B4A' }}> *</span>}
    </label>
    <input
      type={type} name={name} value={value} onChange={onChange} required={required}
      style={{ width:'100%', padding:'8px 10px', border:'0.5px solid #d0d0cc', borderRadius:7, outline:'none', background:'#fff', color:'#1a1a1a' }}
    />
    {hint && <div style={{ fontSize:11, color:'#999', marginTop:4 }}>{hint}</div>}
  </div>
);

const SELECT = ({ label, name, value, onChange, options }) => (
  <div style={{ marginBottom:14 }}>
    <label style={{ display:'block', fontSize:12, color:'#555', marginBottom:5, fontWeight:500 }}>{label}</label>
    <select
      name={name} value={value} onChange={onChange}
      style={{ width:'100%', padding:'8px 10px', border:'0.5px solid #d0d0cc', borderRadius:7, outline:'none', background:'#fff', color:'#1a1a1a' }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const defaults = {
  name:'', brand:'', website:'',
  supergrow_workspace_name:'', supergrow_workspace_id:'', supergrow_api_key:'',
  timezone:'Europe/London', cadence:'Daily', posting_identity:'personal', approval_mode:'auto'
};

export default function NewClientModal({ onClose, onCreated, existing }) {
  const [form, setForm] = useState(existing || defaults);
  const [rag, setRag] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Improvement 1: workspace fetch state ─────────────────────────────────
  const [workspaces, setWorkspaces] = useState([]);
  const [fetchingWs, setFetchingWs] = useState(false);
  const [wsError, setWsError] = useState('');
  const [wsSelected, setWsSelected] = useState(false);

  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  async function fetchWorkspaces() {
    if (!form.supergrow_api_key) {
      setWsError('Enter the Supergrow API key first.');
      return;
    }
    setFetchingWs(true);
    setWsError('');
    try {
      const res = await fetch(`/api/clients/workspaces?api_key=${encodeURIComponent(form.supergrow_api_key)}`);
      const data = await res.json();
      if (!res.ok) { setWsError(data.error || 'Failed to fetch workspaces'); return; }
      if (!data.workspaces || data.workspaces.length === 0) {
        setWsError('No workspaces found for this API key.');
        return;
      }
      setWorkspaces(data.workspaces);
    } catch (e) {
      setWsError('Network error fetching workspaces.');
    } finally {
      setFetchingWs(false);
    }
  }

  function handleWorkspaceSelect(e) {
    const id = e.target.value;
    const ws = workspaces.find(w => (w.id || w.workspace_id) === id);
    if (!ws) return;
    setForm(f => ({
      ...f,
      supergrow_workspace_id: ws.id || ws.workspace_id || '',
      supergrow_workspace_name: ws.name || ws.workspace_name || ''
    }));
    setWsSelected(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const fd = new FormData();
    Object.entries(form).forEach(([k,v]) => fd.append(k, v));
    if (rag) fd.append('rag', rag);

    const url = existing ? `/api/clients/${existing.id}` : '/api/clients';
    const method = existing ? 'PUT' : 'POST';
    const res = await fetch(url, { method, body: fd });
    setLoading(false);

    if (res.ok) onCreated();
    else {
      const d = await res.json();
      setError(d.error || 'Failed to save client');
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'#fff', borderRadius:12, width:560, maxHeight:'90vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.15)' }}>
        <div style={{ padding:'20px 24px', borderBottom:'0.5px solid #e0e0dc', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, background:'#fff', zIndex:1 }}>
          <h2 style={{ fontSize:16, fontWeight:500, color:'#1a1a1a' }}>{existing ? 'Edit client' : 'New client'}</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, color:'#999', lineHeight:1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding:'20px 24px' }}>
          <div style={{ fontSize:11, fontWeight:500, color:SB.primary, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>Client info</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
            <FIELD label="Client name" name="name" value={form.name} onChange={set} required />
            <FIELD label="Brand name" name="brand" value={form.brand} onChange={set} required />
          </div>
          <FIELD label="Website" name="website" value={form.website} onChange={set} />

          <div style={{ fontSize:11, fontWeight:500, color:SB.primary, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12, marginTop:8 }}>Supergrow</div>

          {/* API key + fetch button */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block', fontSize:12, color:'#555', marginBottom:5, fontWeight:500 }}>
              API key <span style={{ color:'#E24B4A' }}>*</span>
            </label>
            <div style={{ display:'flex', gap:8 }}>
              <input
                type="password" name="supergrow_api_key" value={form.supergrow_api_key} onChange={set} required
                style={{ flex:1, padding:'8px 10px', border:'0.5px solid #d0d0cc', borderRadius:7, outline:'none', background:'#fff', color:'#1a1a1a' }}
              />
              <button
                type="button" onClick={fetchWorkspaces} disabled={fetchingWs}
                style={{ padding:'8px 14px', background:SB.primary, color:SB.darkest, border:'none', borderRadius:7, fontWeight:500, fontSize:12, whiteSpace:'nowrap', opacity: fetchingWs ? 0.7 : 1, cursor: fetchingWs ? 'wait' : 'pointer' }}
              >
                {fetchingWs ? 'Loading...' : '↓ Fetch workspaces'}
              </button>
            </div>
            <div style={{ fontSize:11, color:'#999', marginTop:4 }}>From Supergrow MCP settings page</div>
          </div>

          {wsError && (
            <div style={{ fontSize:12, color:'#E24B4A', background:'#FCEBEB', padding:'7px 10px', borderRadius:6, marginBottom:10 }}>
              {wsError}
            </div>
          )}

          {/* Workspace dropdown — shown after fetch */}
          {workspaces.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:12, color:'#555', marginBottom:5, fontWeight:500 }}>
                Select workspace <span style={{ color:'#E24B4A' }}>*</span>
              </label>
              <select
                onChange={handleWorkspaceSelect}
                defaultValue=""
                style={{ width:'100%', padding:'8px 10px', border: wsSelected ? `0.5px solid ${SB.primary}` : '0.5px solid #d0d0cc', borderRadius:7, outline:'none', background:'#fff', color:'#1a1a1a' }}
              >
                <option value="" disabled>— choose a workspace —</option>
                {workspaces.map(ws => (
                  <option key={ws.id || ws.workspace_id} value={ws.id || ws.workspace_id}>
                    {ws.name || ws.workspace_name}{ws.language ? ` (${ws.language})` : ''}
                  </option>
                ))}
              </select>
              {wsSelected && (
                <div style={{ fontSize:11, color:SB.primary, marginTop:4 }}>
                  ✓ Workspace selected — ID and name auto-filled below
                </div>
              )}
            </div>
          )}

          {/* Manual fallback fields — pre-filled from dropdown selection */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
            <FIELD
              label="Workspace name"
              name="supergrow_workspace_name"
              value={form.supergrow_workspace_name}
              onChange={set}
              required
              hint={workspaces.length === 0 ? 'Or enter manually' : ''}
            />
            <FIELD
              label="Workspace ID"
              name="supergrow_workspace_id"
              value={form.supergrow_workspace_id}
              onChange={set}
              required
              hint={workspaces.length === 0 ? 'Found in Supergrow workspace URL' : ''}
            />
          </div>

          <div style={{ fontSize:11, fontWeight:500, color:SB.primary, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12, marginTop:8 }}>Deployment settings</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
            <SELECT label="Timezone" name="timezone" value={form.timezone} onChange={set} options={[
              { value:'Europe/London', label:'London (GMT)' },
              { value:'Europe/Paris', label:'Paris (CET)' },
              { value:'America/New_York', label:'New York (ET)' },
              { value:'America/Los_Angeles', label:'LA (PT)' },
              { value:'Australia/Sydney', label:'Sydney (AEDT)' }
            ]} />
            <SELECT label="Posting cadence" name="cadence" value={form.cadence} onChange={set} options={[
              { value:'Daily', label:'Daily' },
              { value:'5x week', label:'5x per week' },
              { value:'3x week', label:'3x per week' },
              { value:'Weekly', label:'Weekly' }
            ]} />
            <SELECT label="Posting identity" name="posting_identity" value={form.posting_identity} onChange={set} options={[
              { value:'personal', label:'Personal LinkedIn profile' },
              { value:'company', label:'Company page' }
            ]} />
            <SELECT label="Approval mode" name="approval_mode" value={form.approval_mode} onChange={set} options={[
              { value:'auto', label:'Auto queue posts' },
              { value:'draft', label:'Create as drafts only' }
            ]} />
          </div>

          <div style={{ fontSize:11, fontWeight:500, color:SB.primary, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12, marginTop:8 }}>RAG document</div>
          <div
            style={{ border:'0.5px dashed #d0d0cc', borderRadius:8, padding:16, textAlign:'center', marginBottom:16, background:'#fafafa', cursor:'pointer' }}
            onClick={() => document.getElementById('rag-upload').click()}
          >
            <input id="rag-upload" type="file" accept=".md,.txt,.pdf" onChange={e => setRag(e.target.files[0])} style={{ display:'none' }} />
            {rag ? (
              <div>
                <div style={{ fontSize:13, color:SB.primary, fontWeight:500 }}>{rag.name}</div>
                <div style={{ fontSize:11, color:'#888', marginTop:4 }}>Click to change</div>
              </div>
            ) : existing?.rag_filename ? (
              <div>
                <div style={{ fontSize:13, color:'#888' }}>Current: <strong>{existing.rag_filename}</strong></div>
                <div style={{ fontSize:11, color:'#bbb', marginTop:4 }}>Click to replace</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize:13, color:'#888' }}>Click to upload RAG document</div>
                <div style={{ fontSize:11, color:'#bbb', marginTop:4 }}>Accepts .md, .txt, .pdf</div>
              </div>
            )}
          </div>

          {error && <div style={{ color:'#E24B4A', fontSize:12, marginBottom:12, padding:'8px 12px', background:'#FCEBEB', borderRadius:6 }}>{error}</div>}

          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding:'8px 18px', border:'0.5px solid #d0d0cc', borderRadius:8, background:'transparent', color:'#666' }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ padding:'8px 18px', background:SB.primary, color:SB.darkest, border:'none', borderRadius:8, fontWeight:500 }}>
              {loading ? 'Saving...' : existing ? 'Save changes' : 'Create client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
