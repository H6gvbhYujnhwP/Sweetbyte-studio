import React, { useState, useEffect, useRef } from 'react';
import CampaignProgress from './CampaignProgress.jsx';
import NewClientModal from './NewClientModal.jsx';
import { SB } from '../brand.js';

const GREEN = SB.primary;

export default function ClientDetail({ clientId, onBack, onRefresh }) {
  const [client, setClient]                     = useState(null);
  const [loading, setLoading]                   = useState(true);
  const [activeCampaignId, setActiveCampaignId] = useState(null);
  const [showEdit, setShowEdit]                 = useState(false);
  const [starting, setStarting]                 = useState(false);
  const [newRag, setNewRag]                     = useState(null);
  const [uploadingRag, setUploadingRag]         = useState(false);
  const [deleting, setDeleting]                 = useState(false);
  const [logoUploading, setLogoUploading]       = useState(false);
  const [logoFile, setLogoFile]                 = useState(null);
  const [activeTab, setActiveTab]               = useState('campaigns');
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  // Number of posts to generate this run — chosen in the Run-campaign modal.
  const [postCount, setPostCount] = useState(12);

  // "Pull brand from RAG" — re-extracts the brand block from the stored RAG on
  // demand (auto-extraction already runs on every RAG upload server-side).
  const [extractingBrand, setExtractingBrand] = useState(false);
  const [extractMsg, setExtractMsg]           = useState('');

  // Brand panel — three per-customer overrides for how the logo is
  // composited onto generated images. See decision-log entry for this
  // feature in BLUEPRINT.md. The save is debounced (1s) so each dropdown
  // change doesn't fire an immediate PUT; this matches the email-side
  // inline-edit pattern from decision #50/#51.
  const [panelSaving, setPanelSaving]   = useState(false);
  const [panelSaved,  setPanelSaved]    = useState(false);
  const panelSaveTimer                  = useRef(null);
  // Mirror the latest client state into a ref so the debounced save
  // reads the most recent values rather than the stale closure snapshot
  // from whenever the timer was first scheduled. Without this, rapidly
  // clicking two dropdowns (e.g. Position then Background) would lose
  // the first change — the second click's setState hasn't yet flushed
  // when the timer's closure builds its payload.
  const clientRef = useRef(null);
  useEffect(() => { clientRef.current = client; }, [client]);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/clients/${clientId}`);
    if (res.ok) setClient(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [clientId]);

  async function deleteClient() {
    if (!window.confirm(`Delete ${client.name}? This removes all campaign history permanently.`)) return;
    setDeleting(true);
    await fetch(`/api/clients/${clientId}`, { method: 'DELETE' });
    onRefresh();
    onBack();
  }

  async function deleteCampaign(campaignId, e) {
    e.stopPropagation();
    if (!window.confirm('Delete this campaign? All posts and images will be removed permanently.')) return;
    await fetch(`/api/campaigns/${campaignId}`, { method: 'DELETE' });
    load();
  }

  async function startCampaign(includeImages) {
    setShowCampaignModal(false);
    setStarting(true);
    const res = await fetch(`/api/campaigns/start/${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeImages, postCount })
    });
    const data = await res.json();
    setStarting(false);
    if (res.ok) setActiveCampaignId(data.campaignId);
    else alert(data.error || 'Failed to start campaign');
  }

  async function uploadLogo() {
    if (!logoFile) return;
    setLogoUploading(true);
    const fd = new FormData();
    fd.append('logo', logoFile);
    const res = await fetch(`/api/clients/${clientId}/logo`, { method: 'POST', body: fd });
    setLogoFile(null);
    setLogoUploading(false);
    if (res.ok) load();
    else { const err = await res.json(); alert(err.error || 'Logo upload failed'); }
  }

  // Brand panel — update one of the three logo settings (logo_position,
  // logo_panel, logo_size), debounced 1s. Mirrors the email-side default-
  // sender inline-edit pattern (decision #50/#51) — every change splices
  // immediately into local state so the UI stays responsive, then a single
  // PUT fires once the operator stops clicking dropdowns.
  //
  // The PUT route is a full-replace (legacy shape) not a partial-update,
  // so we send the entire current client object as FormData — same pattern
  // as uploadNewRag above. The route's whitelist falls back to the existing
  // stored value for any of the three brand-panel fields if the value is
  // missing or invalid, so unsetting one accidentally is safe.
  function updateBrandPanel(field, value) {
    if (!client) return;
    // Update local state immediately so the dropdown reflects the click
    setClient(c => ({ ...c, [field]: value }));
    setPanelSaved(false);

    if (panelSaveTimer.current) clearTimeout(panelSaveTimer.current);
    panelSaveTimer.current = setTimeout(async () => {
      setPanelSaving(true);
      try {
        const fd = new FormData();
        // Read the latest client snapshot via ref so rapid back-to-back
        // dropdown changes don't drop earlier values from a stale closure.
        // The most-recent click's setClient updater (functional form, line
        // above) plus the useEffect that syncs into clientRef means
        // clientRef.current already reflects every change up to now.
        const latest = clientRef.current || client;
        const merged = { ...latest, [field]: value };
        Object.entries(merged).forEach(([k, v]) => {
          if (typeof v === 'string') fd.append(k, v);
        });
        const res = await fetch(`/api/clients/${clientId}`, { method: 'PUT', body: fd });
        if (res.ok) {
          setPanelSaved(true);
          setTimeout(() => setPanelSaved(false), 1800);
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.error || 'Failed to save brand panel setting');
        }
      } catch (err) {
        alert('Failed to save brand panel setting');
      } finally {
        setPanelSaving(false);
      }
    }, 1000);
  }

  async function uploadNewRag() {
    if (!newRag) return;
    setUploadingRag(true);
    const fd = new FormData();
    fd.append('rag', newRag);
    Object.entries(client).forEach(([k, v]) => { if (typeof v === 'string') fd.append(k, v); });
    await fetch(`/api/clients/${clientId}`, { method: 'PUT', body: fd });
    setNewRag(null);
    setUploadingRag(false);
    load();
  }

  // Manual re-pull of the brand block from the stored RAG. The brand fields are
  // already auto-filled when a RAG is uploaded; this button lets the operator
  // re-pull after editing the RAG wording, or after clearing a field by hand.
  async function pullBrandFromRag() {
    if (!client?.rag_content || extractingBrand) return;
    setExtractingBrand(true);
    setExtractMsg('');
    try {
      const res = await fetch(`/api/clients/${clientId}/extract-brand`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.client) setClient(c => ({ ...c, ...data.client }));
        setExtractMsg(data.found
          ? `✓ Pulled ${data.found} field${data.found === 1 ? '' : 's'} from the RAG`
          : 'No visual branding found in the RAG');
      } else {
        setExtractMsg(data.error || 'Extraction failed');
      }
    } catch (_) {
      setExtractMsg('Extraction failed');
    } finally {
      setExtractingBrand(false);
      setTimeout(() => setExtractMsg(''), 4000);
    }
  }

  if (loading) return <div style={{ padding: 40, color: '#888' }}>Loading...</div>;
  if (!client) return <div style={{ padding: 40, color: '#888' }}>Client not found</div>;

  if (activeCampaignId) {
    return (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '20px 28px', borderBottom: '0.5px solid #e0e0dc', display: 'flex', alignItems: 'center', gap: 16, background: '#fff' }}>
          <button onClick={() => { setActiveCampaignId(null); load(); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13 }}>← Back</button>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{client.name}</span>
        </div>
        <CampaignProgress campaignId={activeCampaignId} onComplete={() => { load(); onRefresh(); }} />
      </div>
    );
  }

  const campaigns = client.campaigns || [];

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: '16px 24px', borderBottom: '0.5px solid #e0e0dc', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13 }}>← All clients</button>
          <span style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a' }}>{client.name}</span>
          <span style={{ fontSize: 12, color: '#aaa' }}>{client.supergrow_workspace_name}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowEdit(true)} style={{ padding: '7px 12px', border: '0.5px solid #d0d0cc', borderRadius: 8, background: '#fff', color: '#555', fontSize: 12, cursor: 'pointer' }}>Edit client</button>
          <button onClick={deleteClient} disabled={deleting} style={{ padding: '7px 12px', border: '0.5px solid #F7C1C1', borderRadius: 8, background: '#fff', color: '#E24B4A', fontSize: 12, cursor: 'pointer' }}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
          <button onClick={() => setShowCampaignModal(true)} disabled={starting || !client.rag_content}
            style={{ padding: '7px 16px', background: client.rag_content ? GREEN : '#ccc', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 500, fontSize: 12, cursor: client.rag_content ? 'pointer' : 'not-allowed' }}>
            {starting ? 'Starting...' : '▶ Run new campaign'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', padding: '0 24px', borderBottom: '0.5px solid #e0e0dc', background: '#fff' }}>
        {['overview', 'campaigns'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '10px 16px', fontSize: 13, background: 'none', border: 'none',
            borderBottom: `2px solid ${activeTab === tab ? GREEN : 'transparent'}`,
            color: activeTab === tab ? GREEN : '#888',
            fontWeight: activeTab === tab ? 500 : 400,
            cursor: 'pointer', marginBottom: -0.5
          }}>
            {tab === 'campaigns' ? `Campaigns (${campaigns.length})` : 'Overview'}
          </button>
        ))}
      </div>

      <div style={{ padding: 24 }}>
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={{ background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Client info</div>
              {[
                ['Website', client.website],
                ['Timezone', client.timezone],
                ['Cadence', client.cadence],
                ['Posting identity', client.posting_identity === 'personal' ? 'Personal profile' : 'Company page'],
                ['Approval mode', client.approval_mode === 'auto' ? 'Auto queue' : 'Drafts only'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid #f0f0ec', fontSize: 13 }}>
                  <span style={{ color: '#888' }}>{k}</span>
                  <span style={{ color: '#1a1a1a', fontWeight: 500 }}>{v || '—'}</span>
                </div>
              ))}
            </div>
            <div style={{ background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Supergrow</div>
              {[
                ['Workspace', client.supergrow_workspace_name],
                ['Workspace ID', client.supergrow_workspace_id?.slice(0, 8) + '...'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid #f0f0ec', fontSize: 13 }}>
                  <span style={{ color: '#888' }}>{k}</span>
                  <span style={{ color: '#1a1a1a', fontWeight: 500 }}>{v || '—'}</span>
                </div>
              ))}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: '#555', marginBottom: 8, fontWeight: 500 }}>RAG document</div>
                {client.rag_filename ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f5f5f3', borderRadius: 7, padding: '8px 12px' }}>
                    <span style={{ fontSize: 12, color: GREEN, fontWeight: 500 }}>{client.rag_filename}</span>
                    <label style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>Replace<input type="file" accept=".md,.txt,.pdf" onChange={e => setNewRag(e.target.files[0])} style={{ display: 'none' }} /></label>
                  </div>
                ) : (
                  <label style={{ display: 'block', border: '0.5px dashed #d0d0cc', borderRadius: 7, padding: '10px 12px', textAlign: 'center', cursor: 'pointer', fontSize: 12, color: '#888' }}>
                    Upload RAG document<input type="file" accept=".md,.txt,.pdf" onChange={e => setNewRag(e.target.files[0])} style={{ display: 'none' }} />
                  </label>
                )}
                {newRag && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: GREEN }}>{newRag.name}</span>
                    <button onClick={uploadNewRag} disabled={uploadingRag} style={{ fontSize: 11, padding: '3px 10px', background: GREEN, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>{uploadingRag ? 'Saving...' : 'Save'}</button>
                    <button onClick={() => setNewRag(null)} style={{ fontSize: 11, padding: '3px 8px', background: 'none', border: '0.5px solid #d0d0cc', borderRadius: 6, cursor: 'pointer', color: '#888' }}>×</button>
                  </div>
                )}
                {!client.rag_content && <div style={{ fontSize: 11, color: '#E24B4A', marginTop: 6 }}>RAG document required before running a campaign</div>}
              </div>

              {/* Logo section */}
              <div style={{ marginTop: 20, borderTop: '0.5px solid #f0f0ec', paddingTop: 16 }}>
                <div style={{ fontSize: 12, color: '#555', marginBottom: 8, fontWeight: 500 }}>Brand logo</div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.5 }}>
                  PNG with transparent background recommended. The logo will be composited into the bottom-right corner of every generated image with an auto-contrasting background patch.
                </div>
                {client.logo_url ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f5f5f3', borderRadius: 7, padding: '8px 12px' }}>
                    <img src={client.logo_url} alt="Brand logo" style={{ height: 36, maxWidth: 140, objectFit: 'contain' }} />
                    <label style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>
                      Replace
                      <input type="file" accept=".png,.jpg,.jpeg,.svg,.webp" onChange={e => setLogoFile(e.target.files[0])} style={{ display: 'none' }} />
                    </label>
                  </div>
                ) : (
                  <label style={{ display: 'block', border: '0.5px dashed #d0d0cc', borderRadius: 7, padding: '10px 12px', textAlign: 'center', cursor: 'pointer', fontSize: 12, color: '#888' }}>
                    Upload logo (PNG, JPG, SVG, WebP)
                    <input type="file" accept=".png,.jpg,.jpeg,.svg,.webp" onChange={e => setLogoFile(e.target.files[0])} style={{ display: 'none' }} />
                  </label>
                )}
                {logoFile && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: GREEN }}>{logoFile.name}</span>
                    <button onClick={uploadLogo} disabled={logoUploading} style={{ fontSize: 11, padding: '3px 10px', background: GREEN, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                      {logoUploading ? 'Uploading...' : 'Upload'}
                    </button>
                    <button onClick={() => setLogoFile(null)} style={{ fontSize: 11, padding: '3px 8px', background: 'none', border: '0.5px solid #d0d0cc', borderRadius: 6, cursor: 'pointer', color: '#888' }}>x</button>
                  </div>
                )}
              </div>

              {/* Brand panel — per-customer logo placement, background, and size */}
              <div style={{ marginTop: 20, borderTop: '0.5px solid #f0f0ec', paddingTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>Brand panel</div>
                  <div style={{ fontSize: 11, color: panelSaving ? '#888' : (panelSaved ? GREEN : 'transparent'), transition: 'color 0.3s' }}>
                    {panelSaving ? 'Saving…' : (panelSaved ? '✓ Saved' : '·')}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 12, lineHeight: 1.5 }}>
                  Controls how this customer's logo is placed on every generated post image. Changes apply to all future image regenerations.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Position</div>
                    <select
                      value={client.logo_position || 'bottom-right'}
                      onChange={e => updateBrandPanel('logo_position', e.target.value)}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', color: '#1a1a1a' }}
                    >
                      <option value="bottom-right">Bottom right</option>
                      <option value="top-right">Top right</option>
                      <option value="bottom-left">Bottom left</option>
                      <option value="top-left">Top left</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Background</div>
                    <select
                      value={client.logo_panel || 'white'}
                      onChange={e => updateBrandPanel('logo_panel', e.target.value)}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', color: '#1a1a1a' }}
                    >
                      <option value="white">White panel</option>
                      <option value="none">No panel</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Size</div>
                    <select
                      value={client.logo_size || 'small'}
                      onChange={e => updateBrandPanel('logo_size', e.target.value)}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', color: '#1a1a1a' }}
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large (≈ 2× small)</option>
                    </select>
                  </div>
                </div>
                {(client.logo_panel === 'none') && (
                  <div style={{ marginTop: 10, fontSize: 11, color: '#9a6f00', background: '#fff8e6', border: '0.5px solid #f0d68a', borderRadius: 6, padding: '7px 9px', lineHeight: 1.45 }}>
                    With no panel, the logo sits directly on each image. Works best if the logo file already has its own opaque background or strong contrast. If a generated image hides the logo, regenerate it.
                  </div>
                )}
              </div>

              {/* Brand kit — auto-pulled from the RAG, feeds every generated image */}
              <div style={{ marginTop: 20, borderTop: '0.5px solid #f0f0ec', paddingTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>Brand kit (used by all images)</div>
                  <div style={{ fontSize: 11, color: panelSaving ? '#888' : (panelSaved ? GREEN : 'transparent'), transition: 'color 0.3s' }}>
                    {panelSaving ? 'Saving…' : (panelSaved ? '✓ Saved' : '·')}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.5 }}>
                  These fields are pulled automatically from the uploaded RAG and feed every generated image, so LinkedIn posts match the brand colours. Edit any field by hand, or re-pull after you change the RAG. The uploaded logo is always added on top.
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <button
                    onClick={pullBrandFromRag}
                    disabled={!client.rag_content || extractingBrand}
                    style={{ padding: '6px 12px', fontSize: 12, border: `0.5px solid ${client.rag_content ? GREEN : '#d0d0cc'}`, borderRadius: 6,
                      background: '#fff', color: client.rag_content ? GREEN : '#aaa', fontWeight: 500,
                      cursor: (!client.rag_content || extractingBrand) ? 'not-allowed' : 'pointer' }}
                  >
                    {extractingBrand ? 'Pulling…' : 'Pull brand from RAG'}
                  </button>
                  {extractMsg && <span style={{ fontSize: 11, color: extractMsg.startsWith('✓') ? GREEN : '#888' }}>{extractMsg}</span>}
                  {!client.rag_content && <span style={{ fontSize: 11, color: '#aaa' }}>Upload a RAG document first</span>}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Image engine</div>
                  <div style={{ display: 'inline-flex', border: '0.5px solid #d0d0cc', borderRadius: 6, overflow: 'hidden' }}>
                    <button
                      onClick={() => updateBrandPanel('image_engine', 'gemini')}
                      style={{ padding: '7px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                        background: (client.image_engine || 'gemini') === 'gemini' ? GREEN : '#fff',
                        color: (client.image_engine || 'gemini') === 'gemini' ? '#fff' : '#555' }}
                    >
                      Gemini (plain photo)
                    </button>
                    <button
                      onClick={() => updateBrandPanel('image_engine', 'gpt_image')}
                      style={{ padding: '7px 12px', fontSize: 12, border: 'none', borderLeft: '0.5px solid #d0d0cc', cursor: 'pointer',
                        background: client.image_engine === 'gpt_image' ? GREEN : '#fff',
                        color: client.image_engine === 'gpt_image' ? '#fff' : '#555' }}
                    >
                      gpt-image-2 (designed ad)
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Brand colours</div>
                  <textarea
                    value={client.brand_colors || ''}
                    rows={2}
                    placeholder="graphite #1a1a1a background, vivid green #77A734 accent, white #FFFFFF text. Primary combination: graphite background + green accent + white text"
                    onChange={e => updateBrandPanel('brand_colors', e.target.value)}
                    style={{ width: '100%', fontSize: 12, padding: '6px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', color: '#1a1a1a', resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Logo description</div>
                  <textarea
                    value={client.logo_description || ''}
                    rows={2}
                    placeholder="Green circular emblem with RGS in bold white letters inside a vivid green ring"
                    onChange={e => updateBrandPanel('logo_description', e.target.value)}
                    style={{ width: '100%', fontSize: 12, padding: '6px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', color: '#1a1a1a', resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Typography style</div>
                  <input
                    value={client.type_style || ''}
                    placeholder="bold condensed all-caps headlines, clean sans-serif body"
                    onChange={e => updateBrandPanel('type_style', e.target.value)}
                    style={{ width: '100%', fontSize: 12, padding: '6px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', color: '#1a1a1a' }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Visual style &amp; what to avoid</div>
                  <textarea
                    value={client.visual_style || ''}
                    rows={3}
                    placeholder="Dark canvas, fleet/job-site photo hero, green CTA button, headline max 8 words. Avoid white or pastel backgrounds and generic stock photos."
                    onChange={e => updateBrandPanel('visual_style', e.target.value)}
                    style={{ width: '100%', fontSize: 12, padding: '6px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', color: '#1a1a1a', resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>

                {client.image_engine === 'gpt_image' && (
                  <div style={{ marginTop: 10, fontSize: 11, color: '#185FA5', background: '#eaf2fb', border: '0.5px solid #b8d4f0', borderRadius: 6, padding: '7px 9px', lineHeight: 1.45 }}>
                    This client's post images generate as full designed ads via gpt-image-2 (higher cost per image). Requires OPENAI_AI_KEY and OpenAI org verification.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'campaigns' && (
          !campaigns.length ? (
            <div style={{ background: '#fff', border: '0.5px dashed #d0d0cc', borderRadius: 10, padding: 40, textAlign: 'center', color: '#888', fontSize: 13 }}>
              No campaigns yet — click <strong>Run new campaign</strong> to get started
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {campaigns.map(c => (
                <CampaignCard key={c.id} campaign={c} onView={() => setActiveCampaignId(c.id)} onDelete={(e) => deleteCampaign(c.id, e)} />
              ))}
            </div>
          )
        )}
      </div>

      {showCampaignModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 360 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a', marginBottom: 8 }}>Run new campaign</div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 6, lineHeight: 1.6 }}>How many posts should this campaign generate?</div>
              <select
                value={postCount}
                onChange={e => setPostCount(Number(e.target.value))}
                style={{ width: '100%', fontSize: 13, padding: '8px 10px', border: '0.5px solid #d0d0cc', borderRadius: 8, background: '#fff', color: '#1a1a1a' }}
              >
                <option value={3}>3 posts</option>
                <option value={6}>6 posts</option>
                <option value={12}>12 posts</option>
                <option value={18}>18 posts</option>
                <option value={24}>24 posts</option>
              </select>
            </div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 24, lineHeight: 1.6 }}>
              Should this campaign include AI-generated images for each post?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <button onClick={() => startCampaign(true)} style={{ padding: '11px 16px', background: SB.primary, color: SB.darkest, border: 'none', borderRadius: 8, fontWeight: 500, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
                ✓ Yes — generate images for each post
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, opacity: 0.85 }}>{client.image_engine === 'gpt_image' ? 'Uses gpt-image-2 — designed ads, higher cost per image' : 'Uses Gemini Nano Banana (~£0.03 per image)'}</div>
              </button>
              <button onClick={() => startCampaign(false)} style={{ padding: '11px 16px', background: '#f5f5f3', color: '#1a1a1a', border: '0.5px solid #d0d0cc', borderRadius: 8, fontWeight: 500, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
                ✕ No — text posts only
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, color: '#888' }}>Faster, no image costs</div>
              </button>
            </div>
            <button onClick={() => setShowCampaignModal(false)} style={{ fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Cancel</button>
          </div>
        </div>
      )}

      {showEdit && (
        <NewClientModal existing={client} onClose={() => setShowEdit(false)} onCreated={() => { setShowEdit(false); load(); onRefresh(); }} />
      )}
    </div>
  );
}

function CampaignCard({ campaign, onView, onDelete }) {
  const [hovered, setHovered] = useState(false);

  // Status pill is driven by campaign.status with one extra check: when a
  // completed campaign was deployed via the customer portal (deployed_by ===
  // 'portal'), the pill says 'Customer approved' in a distinct colour so we
  // can tell at a glance who finished it. Falls back to the original 'Deployed'
  // pill for admin-deployed and for any old completed campaigns that predate
  // the deployed_by column.
  const isPortalDeployed = campaign.status === 'completed' && campaign.deployed_by === 'portal';

  const STATUS = {
    completed:         { label: 'Deployed',          bg: SB.tint, color: SB.dark },
    running:           { label: 'Running',           bg: '#FAEEDA', color: '#633806' },
    awaiting_approval: { label: 'Ready to review',   bg: '#FFF3CD', color: '#7a4a00' },
    failed:            { label: 'Failed',            bg: '#FCEBEB', color: '#501313' },
    pending:           { label: 'Queued',            bg: '#E6F1FB', color: '#0C447C' },
  };
  const cfg  = isPortalDeployed
    ? { label: 'Customer approved', bg: '#E0EAFA', color: '#1A3A7A' }
    : (STATUS[campaign.status] || STATUS.pending);
  const date = new Date(campaign.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const viewLabel =
    campaign.status === 'running'           ? 'View progress' :
    campaign.status === 'awaiting_approval' ? 'Review posts'  :
    campaign.status === 'completed'         ? 'View results'  :
    campaign.status === 'failed'            ? 'View error'    : null;

  let coverUrl   = null;
  let firstTitle = null;
  try {
    const posts = JSON.parse(campaign.posts_json || '[]');
    if (posts.length > 0) {
      coverUrl   = posts[0]?.image_url || null;
      firstTitle = posts[0]?.topic || null;
    }
  } catch (_) {}

  const postCount = campaign.total_posts || campaign.posts_generated || 0;
  const canOpen   = !!viewLabel;

  return (
    <div
      onClick={canOpen ? onView : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered && canOpen ? '#fafaf8' : '#fff',
        border: `0.5px solid ${hovered && canOpen ? '#bbb' : '#e0e0dc'}`,
        borderRadius: 12, padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 16,
        cursor: canOpen ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.15s'
      }}
    >
      <div style={{ width: 88, height: 60, borderRadius: 8, flexShrink: 0, overflow: 'hidden', background: '#f0f0ec', border: '0.5px solid #e0e0dc', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {coverUrl
          ? <img src={coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <span style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: '0 6px', lineHeight: 1.3 }}>No image</span>
        }
        <div style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 10, padding: '1px 5px', borderRadius: 4, fontWeight: 500 }}>
          {postCount} posts
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: cfg.bg, color: cfg.color, fontWeight: 500, flexShrink: 0 }}>{cfg.label}</span>
          <span style={{ fontSize: 12, color: '#aaa' }}>{date}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a', marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {firstTitle ? `${firstTitle}${postCount > 1 ? ` + ${postCount - 1} more posts` : ''}` : `${postCount} posts generated`}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {campaign.images_generated > 0 && <span style={{ fontSize: 12, color: '#888' }}>{campaign.images_generated} images</span>}
          {campaign.posts_deployed > 0
            ? <span style={{ fontSize: 12, color: SB.primary, fontWeight: 500 }}>✓ {campaign.posts_deployed} deployed to Supergrow</span>
            : campaign.status === 'awaiting_approval' ? <span style={{ fontSize: 12, color: '#888' }}>Not yet deployed</span> : null
          }
          {campaign.status === 'failed' && campaign.error_log && <span style={{ fontSize: 12, color: '#E24B4A' }}>{campaign.error_log.slice(0, 60)}</span>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        {viewLabel && (
          <button onClick={onView} style={{ fontSize: 12, color: SB.primary, fontWeight: 500, padding: '5px 12px', border: `0.5px solid ${SB.light}`, borderRadius: 7, background: SB.tint, cursor: 'pointer' }}>
            {viewLabel}
          </button>
        )}
        <button onClick={onDelete} title="Delete campaign" style={{ width: 30, height: 30, border: '0.5px solid #e0e0dc', borderRadius: 7, background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="#E24B4A" strokeWidth="1.3">
            <path d="M2 3h8M5 3V2h2v1M4.5 3v6.5h3V3"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
