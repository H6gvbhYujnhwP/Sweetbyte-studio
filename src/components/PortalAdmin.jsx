// ─────────────────────────────────────────────────────────────────────────────
// PortalAdmin.jsx — Admin section for managing the Customer Portal.
//
// Mounted by Dashboard.jsx when activeView === 'portal-customers'.
//
// Top-level page lists every customer where portal_enabled = 1. Two ways to
// add to the list:
//   - "+ New portal customer" — creates a fresh email_clients row with
//     portal_enabled=1 and no services yet.
//   - "Enable existing customer" — picks an email_clients row that exists but
//     isn't portal-enabled yet (e.g. a cold-email-only domain you want to give
//     a portal to) and flips portal_enabled=1.
//
// Click Manage on a row → detail panel with three sections:
//   1. Services — dropdowns are RENDERED FROM THE SERVER. Services live in the
//      `services` DB table; the admin reads them via /api/portal-admin/services
//      and renders one dropdown per service. Adding a new service later is a
//      DB insert, not a code change.
//   2. Portal users — add/remove/reset-password. Adding or resetting shows the
//      new temporary password ONCE.
//   3. Portal URL — copy-to-clipboard https://studio.thegreenagents.com/c/<slug>.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import { SB } from '../brand.js';

const GREEN     = SB.primary;
const GREEN_HI  = SB.strong;
const GREEN_BG  = SB.tint;
const TEXT      = '#1a1a1a';
const MUTED     = '#666';
const TERTIARY  = '#999';
const BORDER    = '#e0e0dc';
const BG        = '#f5f5f3';
const CARD      = '#ffffff';
const BLUE      = '#185FA5';
const BLUE_BG   = '#E6F1FB';
const AMBER     = '#854F0B';
const AMBER_BG  = '#FAEEDA';
const DANGER    = '#A32D2D';

// ── Top-level list view ─────────────────────────────────────────────────────
export default function PortalAdmin() {
  const [customers, setCustomers] = useState(null);
  const [selected,  setSelected]  = useState(null);
  const [error,     setError]     = useState(null);
  const [showCreate, setShowCreate]  = useState(false);
  const [showEnable, setShowEnable]  = useState(false);

  async function loadCustomers() {
    try {
      const r = await fetch('/api/portal-admin/customers');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setCustomers(await r.json());
    } catch (e) {
      setError(e.message);
      setCustomers([]);
    }
  }
  useEffect(() => { loadCustomers(); }, []);

  if (selected) {
    return <ManagePanel
      customerId={selected}
      onClose={() => { setSelected(null); loadCustomers(); }}
    />;
  }

  return (
    <div style={{ flex:1, overflow:'auto', padding:28 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <h1 style={{ fontSize:20, fontWeight:500, color:TEXT, margin:0 }}>Customer Portal</h1>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setShowEnable(true)} style={btnSecondary()}>Enable existing customer</button>
          <button onClick={() => setShowCreate(true)} style={btnPrimary()}>+ New portal customer</button>
        </div>
      </div>
      <div style={{ fontSize:12, color:MUTED, marginBottom:24 }}>
        Manage which customers have a portal at <code style={{ background:'#f0f0ec', padding:'2px 6px', borderRadius:4, fontSize:11 }}>/c/&lt;slug&gt;</code> and which services they see. Services are configured in <strong>Manage</strong> on each row.
      </div>

      {error && (
        <div style={{ padding:'10px 14px', background:'#fbe9e9', color:DANGER, borderRadius:6, fontSize:13, marginBottom:16 }}>
          Failed to load customers: {error}
        </div>
      )}

      {customers === null ? (
        <div style={{ color:MUTED, padding:'40px 0', textAlign:'center' }}>Loading…</div>
      ) : customers.length === 0 ? (
        <div style={{ background:CARD, border:`0.5px dashed #d0d0cc`, borderRadius:12, padding:48, textAlign:'center', color:MUTED }}>
          <div style={{ fontSize:14, marginBottom:14 }}>No portal customers yet.</div>
          <button onClick={() => setShowCreate(true)} style={btnPrimary()}>+ New portal customer</button>
        </div>
      ) : (
        <CustomersTable customers={customers} onManage={(id) => setSelected(id)} />
      )}

      {showCreate && (
        <CreateCustomerModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); setSelected(id); }}
        />
      )}
      {showEnable && (
        <EnableExistingModal
          onClose={() => setShowEnable(false)}
          onEnabled={(id) => { setShowEnable(false); setSelected(id); }}
        />
      )}
    </div>
  );
}

// ── Customers table ─────────────────────────────────────────────────────────
function CustomersTable({ customers, onManage }) {
  // Compute the union of services across all customers so the table header
  // is comprehensive — every service that exists gets a column. Avoids the
  // problem of "service A is shown only when at least one customer subscribes".
  // We get the order from the first customer (which is in services.sort_order).
  const serviceColumns = customers.length > 0
    ? customers[0].services.map(s => ({ key: s.service_key, label: s.display_name, state: s.state }))
    : [];

  // Grid template: 2fr (Customer) + 1.5fr (Slug) + 1fr (Users) + 1fr per service + 90px (Manage)
  const cols = `2fr 1.5fr 1fr ${serviceColumns.map(() => '1fr').join(' ')} 90px`;

  return (
    <div style={{ background:CARD, border:`0.5px solid ${BORDER}`, borderRadius:8, overflow:'hidden' }}>
      <div style={{
        display:'grid', gridTemplateColumns:cols, gap:10, padding:'12px 16px',
        borderBottom:`0.5px solid ${BORDER}`,
        fontSize:11, color:MUTED, textTransform:'uppercase', letterSpacing:'0.05em',
      }}>
        <div>Customer</div>
        <div>Slug / portal URL</div>
        <div>Portal users</div>
        {serviceColumns.map(s => <div key={s.key}>{s.label}</div>)}
        <div></div>
      </div>
      {customers.map(c => (
        <CustomerRow key={c.id} customer={c} cols={cols} serviceColumns={serviceColumns} onManage={() => onManage(c.id)} />
      ))}
    </div>
  );
}

function CustomerRow({ customer, cols, serviceColumns, onManage }) {
  const [hover, setHover] = useState(false);
  const servicesByKey = Object.fromEntries(customer.services.map(s => [s.service_key, s]));
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display:'grid', gridTemplateColumns:cols, gap:10, padding:'14px 16px',
        alignItems:'center', borderBottom:`0.5px solid ${BORDER}`, fontSize:12,
        background: hover ? '#fafaf8' : 'transparent',
      }}>
      <div style={{ fontWeight:500, color:TEXT }}>{customer.name}</div>
      <div style={{ color:MUTED, fontFamily:'monospace', fontSize:11 }}>/c/{customer.slug}</div>
      <div style={{ color: customer.portal_user_count > 0 ? TEXT : TERTIARY }}>
        {customer.portal_user_count === 0
          ? <span style={{ fontStyle:'italic' }}>No users</span>
          : `${customer.portal_user_count} user${customer.portal_user_count !== 1 ? 's' : ''}`}
      </div>
      {serviceColumns.map(col => {
        const s = servicesByKey[col.key];
        if (!s) return <div key={col.key} />;
        if (s.state === 'coming_soon') {
          return <div key={col.key}><Pill bg={BLUE_BG} fg={BLUE}>Coming soon</Pill></div>;
        }
        if (!s.subscribed) {
          return <div key={col.key}><Pill bg="#f4f1e8" fg={MUTED}>Not required</Pill></div>;
        }
        // Subscribed — show "Enabled" or the linked record name.
        const label = s.linked_external_name
          ? (s.linked_external_name.length > 16 ? s.linked_external_name.slice(0, 16) + '…' : s.linked_external_name)
          : 'Enabled';
        return (
          <div key={col.key}>
            <Pill bg={GREEN_BG} fg={GREEN_HI} title={s.linked_external_name || 'Enabled'}>
              ✓ {label}
            </Pill>
          </div>
        );
      })}
      <div style={{ textAlign:'right' }}>
        <button onClick={onManage} style={btnSecondary()}>Manage →</button>
      </div>
    </div>
  );
}

// ── Manage Panel ────────────────────────────────────────────────────────────
function ManagePanel({ customerId, onClose }) {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState(null);

  async function loadAll() {
    try {
      const r = await fetch(`/api/portal-admin/customers/${customerId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(String(e.message || e));
    }
  }
  useEffect(() => { loadAll(); }, [customerId]);

  if (error) {
    return (
      <div style={{ flex:1, padding:28 }}>
        <button onClick={onClose} style={btnSecondary()}>← Back to all customers</button>
        <div style={{ marginTop:16, padding:'10px 14px', background:'#fbe9e9', color:DANGER, borderRadius:6, fontSize:13 }}>
          Failed to load: {error}
        </div>
      </div>
    );
  }
  if (!data) return <div style={{ flex:1, padding:28, color:MUTED }}>Loading…</div>;

  const { customer, users } = data;
  const portalUrl = `${window.location.origin}/c/${customer.slug}`;

  return (
    <div style={{ flex:1, overflow:'auto', padding:28 }}>
      <button onClick={onClose} style={btnSecondary()}>← Back to all customers</button>

      <h1 style={{ fontSize:20, fontWeight:500, color:TEXT, margin:'18px 0 4px' }}>{customer.name}</h1>
      <div style={{ fontSize:12, color:MUTED, marginBottom:24 }}>
        Customer portal at <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ color:BLUE, textDecoration:'none', fontFamily:'monospace' }}>{portalUrl}</a>
      </div>

      <ServicesPanel customer={customer} onUpdated={(updated) => setData(d => ({ ...d, customer: updated }))} />
      <LogoPanel customer={customer} onUpdated={(updated) => setData(d => ({ ...d, customer: updated }))} />
      <UsersPanel customer={customer} users={users} onChange={loadAll} />
      <PortalUrlPanel portalUrl={portalUrl} userCount={users.length} />
      <DangerZonePanel customer={customer} onUpdated={onClose} />
    </div>
  );
}

// ── Logo panel ──────────────────────────────────────────────────────────────
// Upload, preview, or remove the customer's logo. Uploads sync to the linked
// LinkedIn account if one is set (and vice versa, when uploaded from the
// LinkedIn side). PNG / JPG / SVG / WebP up to 20 MB.
function LogoPanel({ customer, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  const linkedToLinkedin = customer.services.find(s => s.service_key === 'linkedin')?.subscribed;

  async function upload(file) {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const r = await fetch(`/api/portal-admin/customers/${customer.id}/logo`, {
        method: 'POST',
        body: fd,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onUpdated(d.customer);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  async function clear() {
    if (!confirm(`Remove ${customer.name}'s logo?\n\nThe customer's portal header will fall back to initials. ${linkedToLinkedin ? 'This also removes the logo from the linked LinkedIn account.' : ''}`)) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/portal-admin/customers/${customer.id}/logo`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onUpdated(d.customer);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <Card title="Logo" subtitle={
      linkedToLinkedin
        ? <>Shown in the customer's portal header. Synchronised with the linked LinkedIn account — uploading on either side updates both. PNG, JPG, SVG, or WebP. Up to 20&nbsp;MB.</>
        : <>Shown in the customer's portal header. PNG, JPG, SVG, or WebP. Up to 20&nbsp;MB. Falls back to initials if not set.</>
    }>
      <div style={{
        display:'flex', alignItems:'center', gap:18,
        padding:'12px 14px', background:'#fafaf8', borderRadius:6,
        border:`0.5px solid ${BORDER}`,
      }}>
        {/* Preview — same 60x60 footprint whether logo set or not */}
        <div style={{
          width:60, height:60, borderRadius:8,
          background: customer.logo_url ? '#fff' : (customer.color || SB.primary),
          border: customer.logo_url ? `0.5px solid ${BORDER}` : 'none',
          display:'flex', alignItems:'center', justifyContent:'center',
          color:'white', fontSize:20, fontWeight:500, flexShrink:0,
          overflow:'hidden',
        }}>
          {customer.logo_url
            ? <img src={customer.logo_url} alt={`${customer.name} logo`}
                style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }} />
            : (customer.name || '?').trim().slice(0, 2).toUpperCase()
          }
        </div>

        <div style={{ flex:1 }}>
          <div style={{ fontSize:12, color:TEXT, marginBottom:4 }}>
            {customer.logo_url
              ? <>Logo uploaded. <a href={customer.logo_url} target="_blank" rel="noopener noreferrer" style={{ color:BLUE, fontSize:11, textDecoration:'none' }}>View full size ↗</a></>
              : <>No logo uploaded — currently showing initials.</>}
          </div>

          <div style={{ display:'flex', gap:8 }}>
            <label style={{ ...btnPrimary(busy), display:'inline-block', padding:'8px 14px' }}>
              {busy ? 'Uploading…' : (customer.logo_url ? 'Replace logo' : 'Upload logo')}
              <input type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                disabled={busy}
                onChange={e => upload(e.target.files?.[0])}
                style={{ display:'none' }}
              />
            </label>
            {customer.logo_url && (
              <button onClick={clear} disabled={busy} style={btnSecondary(busy)}>Remove</button>
            )}
          </div>

          {err && <div style={{ color:DANGER, fontSize:12, marginTop:8 }}>{err}</div>}
        </div>
      </div>
    </Card>
  );
}

// ── Services panel ──────────────────────────────────────────────────────────
// Renders one dropdown per service in customer.services (data-driven from the
// `services` catalogue). The dropdown options come from /api/portal-admin/
// service-options/:key — which, for plain on/off services, returns [], in
// which case we show a yes/no toggle instead.
function ServicesPanel({ customer, onUpdated }) {
  // Local edit state — keyed by service_key, holds either a linked id or a
  // boolean (for plain services). Initialised from customer.services.
  const initialState = () => {
    const out = {};
    for (const s of customer.services) {
      if (s.link_table) {
        out[s.service_key] = s.linked_external_id || '';   // '' = not subscribed
      } else {
        out[s.service_key] = !!s.subscribed;
      }
    }
    return out;
  };
  const [edits, setEdits] = useState(initialState);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // Reset edits if customer prop changes (e.g. after save).
  useEffect(() => { setEdits(initialState()); }, [customer]);

  // Detect dirty state.
  const dirty = customer.services.some(s => {
    if (s.state === 'coming_soon') return false;
    if (s.link_table) return (s.linked_external_id || '') !== (edits[s.service_key] || '');
    return (!!s.subscribed) !== (!!edits[s.service_key]);
  });

  async function save() {
    setSaving(true); setMsg(null);
    const payload = { services: {} };
    for (const s of customer.services) {
      if (s.state === 'coming_soon') continue;   // never write to coming-soon services
      if (s.link_table) {
        const linkedId = edits[s.service_key] || '';
        payload.services[s.service_key] = linkedId
          ? { subscribed: true, linked_external_id: linkedId }
          : { subscribed: false };
      } else {
        payload.services[s.service_key] = { subscribed: !!edits[s.service_key] };
      }
    }
    try {
      const r = await fetch(`/api/portal-admin/customers/${customer.id}/services`, {
        method:'PUT',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onUpdated(d);
      setMsg({ ok:true, text:'Saved.' });
    } catch (e) {
      setMsg({ ok:false, text: e.message });
    }
    setSaving(false);
  }

  return (
    <Card title="Services" subtitle="Which services this customer sees in their portal. Each tab in the customer portal renders either real data, a 'Not required' panel, or a 'Coming soon' panel based on these settings.">
      {customer.services.map(svc => (
        <ServiceRow
          key={svc.service_key}
          svc={svc}
          value={edits[svc.service_key]}
          onChange={(v) => setEdits(e => ({ ...e, [svc.service_key]: v }))}
          customerId={customer.id}
          disabled={saving}
        />
      ))}

      <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:12 }}>
        <button onClick={save} disabled={!dirty || saving} style={btnPrimary(!dirty || saving)}>
          {saving ? 'Saving…' : 'Save services'}
        </button>
        {msg && <span style={{ fontSize:12, color: msg.ok ? GREEN_HI : DANGER }}>{msg.text}</span>}
      </div>
    </Card>
  );
}

// One row per service. Behaviour adapts to:
//   - state === 'coming_soon' → greyed-out, "Coming soon" label only
//   - link_table set          → dropdown of pickable records via service-options
//   - link_table null         → on/off select (Enabled / Not required)
function ServiceRow({ svc, value, onChange, customerId, disabled }) {
  const isComingSoon = svc.state === 'coming_soon';
  const hasPicker    = !!svc.link_table;

  // Picker options for link_table services.
  const [options, setOptions] = useState(null);
  useEffect(() => {
    if (!hasPicker || isComingSoon) return;
    fetch(`/api/portal-admin/service-options/${svc.service_key}`)
      .then(r => r.ok ? r.json() : [])
      .then(setOptions)
      .catch(() => setOptions([]));
  }, [svc.service_key, hasPicker, isComingSoon]);

  return (
    <div style={{
      display:'grid', gridTemplateColumns:'1fr 360px', gap:18, alignItems:'start',
      padding:'14px 0', borderBottom:`0.5px solid ${BORDER}`,
    }}>
      <div>
        <div style={{ fontSize:13, fontWeight:500, color: isComingSoon ? TERTIARY : TEXT, marginBottom:4 }}>
          {svc.display_name}
          {isComingSoon && (
            <span style={{
              marginLeft:8, padding:'1px 6px', fontSize:10, fontWeight:500,
              background:BLUE_BG, color:BLUE, borderRadius:4,
            }}>Coming soon</span>
          )}
        </div>
        {svc.description && (
          <div style={{ fontSize:11, color:MUTED, lineHeight:1.5 }}>{svc.description}</div>
        )}
      </div>
      <div>
        {isComingSoon ? (
          <select disabled style={{ ...selectStyle(), color:TERTIARY }}>
            <option>Coming soon</option>
          </select>
        ) : hasPicker ? (
          options === null ? (
            <select disabled style={selectStyle()}><option>Loading…</option></select>
          ) : (
            <select value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} style={selectStyle()}>
              <option value="">Not required — hide with message</option>
              {options.map(opt => {
                // Grey out (disable) any option that's already linked to a different customer.
                const linkedElsewhere = opt.linked_to_id && opt.linked_to_id !== customerId;
                return (
                  <option key={opt.id} value={opt.id} disabled={linkedElsewhere}>
                    {opt.name}{linkedElsewhere ? ` — already linked to ${opt.linked_to_name}` : ''}
                  </option>
                );
              })}
            </select>
          )
        ) : (
          <select value={value ? 'enabled' : 'not_required'}
            onChange={e => onChange(e.target.value === 'enabled')}
            disabled={disabled}
            style={selectStyle()}
          >
            <option value="enabled">Enabled — show real data</option>
            <option value="not_required">Not required — hide with message</option>
          </select>
        )}
      </div>
    </div>
  );
}

// ── Users panel ─────────────────────────────────────────────────────────────
function UsersPanel({ customer, users, onChange }) {
  const [showAdd,  setShowAdd]  = useState(false);
  const [newCreds, setNewCreds] = useState(null);

  return (
    <Card
      title="Portal users"
      subtitle="People at this customer who can sign in to their portal. Usernames are scoped to this customer — two different customers can both have a user called 'admin'."
      action={<button onClick={() => setShowAdd(true)} style={btnPrimary()}>+ Add user</button>}
    >
      {users.length === 0 ? (
        <div style={{
          padding:'24px 18px', textAlign:'center',
          background:'#fafaf8', borderRadius:6, color:MUTED, fontSize:13,
        }}>
          No portal users yet. Click <strong>+ Add user</strong> to create one — you'll get a temporary password to share with the customer.
        </div>
      ) : (
        <div style={{ border:`0.5px solid ${BORDER}`, borderRadius:6, overflow:'hidden' }}>
          <div style={{
            display:'grid', gridTemplateColumns:'1.5fr 1.5fr 80px 110px 200px',
            gap:10, padding:'10px 14px', borderBottom:`0.5px solid ${BORDER}`,
            fontSize:11, color:MUTED, textTransform:'uppercase', letterSpacing:'0.04em',
          }}>
            <div>Username</div>
            <div>Email</div>
            <div>Role</div>
            <div>Last sign-in</div>
            <div></div>
          </div>
          {users.map(u => (
            <UserRow key={u.id} user={u} onChange={onChange} onResetShown={(creds) => setNewCreds(creds)} />
          ))}
        </div>
      )}

      {showAdd && (
        <AddUserModal
          customerId={customer.id}
          existingUsernames={users.map(u => u.username)}
          onClose={() => setShowAdd(false)}
          onCreated={(creds) => {
            setShowAdd(false);
            setNewCreds(creds);
            onChange();
          }}
        />
      )}

      {newCreds && (
        <TempPasswordModal
          creds={newCreds}
          customerName={customer.name}
          portalSlug={customer.slug}
          onClose={() => setNewCreds(null)}
        />
      )}
    </Card>
  );
}

function UserRow({ user, onChange, onResetShown }) {
  const [busy, setBusy] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);

  // Called from ResetPasswordModal once the admin has either typed a password
  // or chosen to generate a random one. `chosenPassword` is null for the
  // random path (backend generates), or a string for the admin-chosen path.
  async function submitReset(chosenPassword) {
    setBusy('reset');
    try {
      const body = chosenPassword ? JSON.stringify({ new_password: chosenPassword }) : undefined;
      const r = await fetch(`/api/portal-admin/users/${user.id}/reset-password`, {
        method:'POST',
        headers: chosenPassword ? { 'Content-Type': 'application/json' } : undefined,
        body,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setResetOpen(false);
      onResetShown({
        username: user.username,
        temporary_password: d.temporary_password,
        kind: 'reset',
      });
    } catch (e) {
      alert(`Reset failed: ${e.message}`);
    }
    setBusy(null);
  }

  async function remove() {
    if (!confirm(`Remove ${user.username}?\n\nThey'll be signed out immediately and won't be able to sign in again. This can't be undone.`)) return;
    setBusy('delete');
    try {
      const r = await fetch(`/api/portal-admin/users/${user.id}`, { method:'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      onChange();
    } catch (e) {
      alert(`Remove failed: ${e.message}`);
    }
    setBusy(null);
  }

  return (
    <div style={{
      display:'grid', gridTemplateColumns:'1.5fr 1.5fr 80px 110px 200px',
      gap:10, padding:'10px 14px', borderBottom:`0.5px solid ${BORDER}`,
      fontSize:12, alignItems:'center',
    }}>
      <div style={{ fontWeight:500, color:TEXT }}>{user.username}</div>
      <div style={{ color:MUTED }}>{user.email || <span style={{ color:TERTIARY, fontStyle:'italic' }}>(none)</span>}</div>
      <div>
        <Pill bg={user.role === 'admin' ? BLUE_BG : '#f4f1e8'} fg={user.role === 'admin' ? BLUE : MUTED}>
          {user.role}
        </Pill>
      </div>
      <div style={{ color: user.last_login_at ? MUTED : AMBER, fontSize:11 }}>
        {user.last_login_at ? formatRelative(user.last_login_at) : <em>Never</em>}
      </div>
      <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
        <button onClick={()=>setResetOpen(true)} disabled={busy} style={btnSecondary(busy === 'reset')}>
          {busy === 'reset' ? 'Resetting…' : 'Reset password'}
        </button>
        <button onClick={remove} disabled={busy} style={{ ...btnSecondary(busy === 'delete'), color:DANGER, borderColor:'#f0c4c4' }}>
          {busy === 'delete' ? 'Removing…' : 'Remove'}
        </button>
      </div>
      {resetOpen && (
        <ResetPasswordModal
          username={user.username}
          busy={busy === 'reset'}
          onSubmit={submitReset}
          onClose={()=>{ if (busy !== 'reset') setResetOpen(false); }}
        />
      )}
    </div>
  );
}

function AddUserModal({ customerId, existingUsernames, onClose, onCreated }) {
  const [username, setUsername] = useState('');
  const [email,    setEmail]    = useState('');
  const [role,     setRole]     = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  async function submit() {
    const u = username.trim().toLowerCase();
    if (!u) { setErr('Username is required'); return; }
    if (existingUsernames.includes(u)) { setErr('That username is already in use for this customer'); return; }
    if (!/^[a-z0-9][a-z0-9._-]{1,30}$/.test(u)) {
      setErr('Username must be 2–31 chars: lowercase letters, digits, dots, underscores, dashes');
      return;
    }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/portal-admin/customers/${customerId}/users`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ username: u, email: email.trim(), role }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onCreated({
        username: d.user.username,
        temporary_password: d.temporary_password,
        kind: 'create',
      });
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Add portal user" onClose={busy ? null : onClose}>
      <div style={{ fontSize:13, color:TEXT, lineHeight:1.5, marginBottom:14 }}>
        We'll generate a temporary password for them. You'll see it once on the next screen — copy it and give it to the customer over the phone or your usual secure channel.
      </div>

      <Field label="Username">
        <input value={username} onChange={e => setUsername(e.target.value)} disabled={busy}
          autoFocus placeholder="rob-tower"
          style={inputStyle()}
        />
      </Field>

      <Field label="Email (for password resets)">
        <input value={email} onChange={e => setEmail(e.target.value)} disabled={busy}
          type="email" placeholder="rob@tower.co.uk"
          style={inputStyle()}
        />
      </Field>

      <Field label="Role">
        <select value={role} onChange={e => setRole(e.target.value)} disabled={busy} style={selectStyle()}>
          <option value="viewer">Viewer — read only</option>
          <option value="admin">Admin — can manage other portal users at this customer</option>
        </select>
      </Field>

      {err && <div style={{ color:DANGER, fontSize:12, marginTop:6 }}>{err}</div>}

      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:16 }}>
        <button onClick={onClose} disabled={busy} style={btnSecondary()}>Cancel</button>
        <button onClick={submit} disabled={busy || !username.trim()} style={btnPrimary(busy || !username.trim())}>
          {busy ? 'Creating…' : 'Create user'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── ResetPasswordModal ──────────────────────────────────────────────────────
// Used by UserRow when admin clicks "Reset password". Lets the admin either
// type a new password explicitly (with show/hide toggle), or click "Generate
// random" to fall back to the original behaviour (backend generates one).
// On submit:
//   - If admin typed a password, sends { new_password: "<typed>" } and the
//     backend uses that exact value after validating min-length 8.
//   - If admin clicked "Generate random", sends no body — backend generates.
// In both cases the TempPasswordModal opens next showing the resulting
// password so the admin can copy it to give to the customer.
function ResetPasswordModal({ username, busy, onSubmit, onClose }) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  function handleSubmit() {
    if (busy) return;
    if (pw.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setError('');
    onSubmit(pw);
  }

  function handleGenerate() {
    if (busy) return;
    setError('');
    onSubmit(null); // null = let backend generate
  }

  return (
    <ModalShell title={`Reset password for ${username}`} onClose={busy ? ()=>{} : onClose}>
      <div style={{
        padding:'10px 12px', background:AMBER_BG, color:AMBER,
        borderRadius:6, fontSize:12, lineHeight:1.5, marginBottom:14,
      }}>
        This will sign {username} out of any active sessions and replace their
        password. You'll see the new password once on the next screen so you
        can pass it on.
      </div>

      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:500, color:MUTED, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.04em' }}>
          New password
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <input
            type={show ? 'text' : 'password'}
            value={pw}
            onChange={e => { setPw(e.target.value); if (error) setError(''); }}
            placeholder="At least 8 characters"
            disabled={busy}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            style={{
              flex:1, padding:'8px 10px', fontSize:13,
              border:`0.5px solid ${error ? '#d99090' : BORDER}`,
              borderRadius:6, fontFamily:'monospace',
              background: busy ? '#fafaf8' : '#fff',
              color: TEXT,
            }}
          />
          <button onClick={()=>setShow(s=>!s)} type="button" style={{
            ...btnSecondary(),
            padding:'8px 12px', fontSize:11,
          }}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        {error && (
          <div style={{ fontSize:11, color:DANGER, marginTop:6 }}>{error}</div>
        )}
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
        <button onClick={handleGenerate} disabled={busy} type="button" style={{
          ...btnSecondary(),
          fontSize:11,
        }}>
          Generate random instead
        </button>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} disabled={busy} type="button" style={btnSecondary()}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={busy || pw.length < 8} type="button" style={btnPrimary(busy)}>
            {busy ? 'Resetting…' : 'Set password'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function TempPasswordModal({ creds, customerName, portalSlug, onClose }) {
  const [copied, setCopied] = useState(false);
  const portalUrl = `${window.location.origin}/c/${portalSlug}`;
  const blob = `Portal: ${portalUrl}\nUsername: ${creds.username}\nTemporary password: ${creds.temporary_password}`;

  function copyAll() { navigator.clipboard.writeText(blob).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }
  function copyPw()  { navigator.clipboard.writeText(creds.temporary_password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }

  return (
    <ModalShell title={creds.kind === 'reset' ? 'Password reset' : 'User created'} onClose={onClose}>
      <div style={{
        padding:'10px 12px', background:AMBER_BG, color:AMBER,
        borderRadius:6, fontSize:12, lineHeight:1.5, marginBottom:14,
      }}>
        <strong style={{ fontWeight:500 }}>This is the only time you'll see this password.</strong>
        {' '}Copy it now and give it to the customer. They'll be prompted to change it on their first sign-in.
      </div>

      <div style={{
        background:'#fafaf8', border:`0.5px solid ${BORDER}`, borderRadius:6,
        padding:'14px 16px', marginBottom:14,
      }}>
        <Row label="Customer" value={customerName} />
        <Row label="Portal URL" value={portalUrl} mono link />
        <Row label="Username" value={creds.username} mono />
        <Row label="Temporary password" value={creds.temporary_password} mono bold />
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
        <div style={{ fontSize:11, color: copied ? GREEN_HI : MUTED }}>{copied ? '✓ Copied to clipboard' : ''}</div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={copyPw} style={btnSecondary()}>Copy password only</button>
          <button onClick={copyAll} style={btnPrimary()}>Copy all details</button>
          <button onClick={onClose} style={btnSecondary()}>Done</button>
        </div>
      </div>
    </ModalShell>
  );
}

function Row({ label, value, mono, bold, link }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:10, padding:'4px 0', fontSize:12 }}>
      <div style={{ color:MUTED }}>{label}</div>
      <div style={{
        color: TEXT, fontWeight: bold ? 500 : 400,
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak: 'break-all',
      }}>
        {link
          ? <a href={value} target="_blank" rel="noopener noreferrer" style={{ color:BLUE, textDecoration:'none' }}>{value}</a>
          : value}
      </div>
    </div>
  );
}

// ── Portal URL panel ────────────────────────────────────────────────────────
function PortalUrlPanel({ portalUrl, userCount }) {
  const [copied, setCopied] = useState(false);
  function copy() { navigator.clipboard.writeText(portalUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }
  return (
    <Card title="Portal URL" subtitle="Send this to the customer along with their username and password.">
      <div style={{
        display:'flex', gap:10, alignItems:'center',
        padding:'12px 14px', background:'#fafaf8', borderRadius:6,
        border:`0.5px solid ${BORDER}`,
      }}>
        <code style={{ flex:1, fontSize:12, color:TEXT, wordBreak:'break-all' }}>{portalUrl}</code>
        <button onClick={copy} style={btnSecondary()}>{copied ? '✓ Copied' : 'Copy'}</button>
        <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={btnSecondary()}>Open ↗</a>
      </div>
      {userCount === 0 && (
        <div style={{ marginTop:10, fontSize:12, color:AMBER }}>
          ⚠️ No portal users created yet — the customer can't sign in until you add at least one user above.
        </div>
      )}
    </Card>
  );
}

// ── Danger zone (disable portal) ────────────────────────────────────────────
function DangerZonePanel({ customer, onUpdated }) {
  const [busy, setBusy] = useState(false);

  async function disablePortal() {
    if (!confirm(`Hide ${customer.name} from the Customer Portal admin list?\n\nTheir portal users and services stay in the database — re-enable any time. They'll be signed out next time their session expires.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/portal-admin/customers/${customer.id}`, {
        method:'PUT',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ portal_enabled: false }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      onUpdated();
    } catch (e) {
      alert(`Failed: ${e.message}`);
      setBusy(false);
    }
  }

  return (
    <Card title="Hide from Customer Portal list" subtitle="Removes this customer from the Customer Portal admin page. Doesn't delete anything — re-enable later via 'Enable existing customer' on the main page.">
      <button onClick={disablePortal} disabled={busy}
        style={{ ...btnSecondary(busy), color:DANGER, borderColor:'#f0c4c4' }}>
        {busy ? 'Working…' : 'Hide from list'}
      </button>
    </Card>
  );
}

// ── Create-customer modal ───────────────────────────────────────────────────
function CreateCustomerModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) { setErr('Name is required'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/portal-admin/customers', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onCreated(d.id);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  // Live preview of the slug as the user types.
  const slugPreview = name.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'customer';

  return (
    <ModalShell title="Add portal customer" onClose={busy ? null : onClose}>
      <div style={{ fontSize:13, color:TEXT, lineHeight:1.5, marginBottom:14 }}>
        Creates a new customer for the portal. After creating, you'll set up which services they see and add their portal users.
      </div>

      <Field label="Customer name">
        <input value={name} onChange={e => setName(e.target.value)} disabled={busy}
          autoFocus placeholder="Tower Leasing" style={inputStyle()}
        />
      </Field>
      <div style={{ fontSize:11, color:MUTED, marginTop:-8, marginBottom:14 }}>
        Portal URL will be: <code style={{ background:'#f0f0ec', padding:'2px 5px', borderRadius:3 }}>/c/{slugPreview}</code>
      </div>

      {err && <div style={{ color:DANGER, fontSize:12, marginTop:6 }}>{err}</div>}

      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:6 }}>
        <button onClick={onClose} disabled={busy} style={btnSecondary()}>Cancel</button>
        <button onClick={submit} disabled={busy || !name.trim()} style={btnPrimary(busy || !name.trim())}>
          {busy ? 'Creating…' : 'Create & manage'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Enable-existing modal ───────────────────────────────────────────────────
function EnableExistingModal({ onClose, onEnabled }) {
  const [eligible, setEligible] = useState(null);
  const [picked,   setPicked]   = useState('');
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  useEffect(() => {
    fetch('/api/portal-admin/eligible-customers')
      .then(r => r.ok ? r.json() : [])
      .then(setEligible)
      .catch(() => setEligible([]));
  }, []);

  async function submit() {
    if (!picked) { setErr('Pick a customer to enable'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/portal-admin/customers/${picked}`, {
        method:'PUT',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ portal_enabled: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onEnabled(picked);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Enable existing customer" onClose={busy ? null : onClose}>
      <div style={{ fontSize:13, color:TEXT, lineHeight:1.5, marginBottom:14 }}>
        Pick an existing customer (e.g. one you've set up under <strong>Email Campaigns → Customers</strong>) to give a portal. Their existing settings are preserved — you'll add portal-specific services and users next.
      </div>

      <Field label="Customer">
        {eligible === null ? (
          <select disabled style={selectStyle()}><option>Loading…</option></select>
        ) : eligible.length === 0 ? (
          <div style={{ fontSize:12, color:MUTED, padding:'10px 0' }}>
            All your existing customers are already portal-enabled.
            Use <strong>+ New portal customer</strong> to add a new one.
          </div>
        ) : (
          <select value={picked} onChange={e => setPicked(e.target.value)} disabled={busy} style={selectStyle()}>
            <option value="">— pick one —</option>
            {eligible.map(c => (
              <option key={c.id} value={c.id}>{c.name} (/c/{c.slug})</option>
            ))}
          </select>
        )}
      </Field>

      {err && <div style={{ color:DANGER, fontSize:12, marginTop:6 }}>{err}</div>}

      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
        <button onClick={onClose} disabled={busy} style={btnSecondary()}>Cancel</button>
        <button onClick={submit} disabled={busy || !picked} style={btnPrimary(busy || !picked)}>
          {busy ? 'Enabling…' : 'Enable & manage'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Reusable bits ───────────────────────────────────────────────────────────
function Card({ title, subtitle, action, children }) {
  return (
    <div style={{
      background:CARD, border:`0.5px solid ${BORDER}`, borderRadius:8,
      padding:'18px 20px', marginBottom:16,
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:500, color:TEXT, marginBottom:4 }}>{title}</div>
          {subtitle && <div style={{ fontSize:12, color:MUTED, lineHeight:1.5 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Pill({ bg, fg, children, title }) {
  return (
    <span title={title || undefined} style={{
      display:'inline-block', padding:'2px 8px', fontSize:11, fontWeight:500,
      background:bg, color:fg, borderRadius:4, whiteSpace:'nowrap',
    }}>{children}</span>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:12, color:MUTED, marginBottom:4 }}>{label}</label>
      {children}
    </div>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div onClick={onClose ? onClose : undefined} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:CARD, borderRadius:12, padding:'22px 26px',
        maxWidth:540, width:'100%', maxHeight:'90vh', overflow:'auto',
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <h3 style={{ fontSize:15, fontWeight:500, margin:0, color:TEXT }}>{title}</h3>
          {onClose && (
            <button onClick={onClose} style={{
              background:'transparent', border:'none', fontSize:20, color:MUTED,
              cursor:'pointer', lineHeight:1, padding:0,
            }}>×</button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function inputStyle() {
  return {
    width:'100%', boxSizing:'border-box', padding:'9px 10px', fontSize:13,
    border:`0.5px solid ${BORDER}`, borderRadius:6, outline:'none',
    color:TEXT, background:CARD, fontFamily:'inherit',
  };
}
function selectStyle() {
  return { ...inputStyle(), cursor:'pointer', appearance:'auto' };
}
function btnPrimary(disabled) {
  return {
    padding:'8px 14px', fontSize:13, fontWeight:500,
    background: disabled ? SB.light : GREEN, color:'white',
    border:'none', borderRadius:6,
    cursor: disabled ? 'default' : 'pointer',
  };
}
function btnSecondary(disabled) {
  return {
    padding:'7px 12px', fontSize:12,
    background:CARD, color:TEXT,
    border:`0.5px solid ${BORDER}`, borderRadius:6,
    cursor: disabled ? 'default' : 'pointer',
    textDecoration:'none', display:'inline-block',
  };
}

function formatRelative(iso) {
  if (!iso) return '';
  const fixed = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const ms = Date.now() - new Date(fixed).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return new Date(fixed).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}
