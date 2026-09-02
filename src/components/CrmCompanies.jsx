import React, { useState, useEffect, useCallback } from 'react';
import { SB } from '../brand.js';

// CrmCompanies — Sales CRM company list + profile (Phase 2, admin / TGA box).
// Talks to /api/crm/companies. Self-contained: holds both the list view and
// the single-company profile view, like the other admin screens.

const GREEN = SB.primary;
const GREEN_DARK = SB.strong;

const STATUSES = [
  { key: 'suspect',      label: 'Suspect',      bg: '#F1EFE8', color: '#444441' },
  { key: 'prospect',     label: 'Prospect',     bg: '#E6F1FB', color: '#0C447C' },
  { key: 'hot_prospect', label: 'Hot prospect', bg: '#FAEEDA', color: '#854F0B' },
  { key: 'customer',     label: 'Customer',     bg: SB.tint, color: SB.strong },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]));

const card = { background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 10 };
const btnPrimary = { background: GREEN, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 500, fontSize: 13, cursor: 'pointer' };
const btnGhost = { background: '#fff', color: '#444', border: '0.5px solid #d0d0cc', padding: '7px 14px', borderRadius: 8, fontWeight: 500, fontSize: 13, cursor: 'pointer' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #d0d0cc', borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff' };
const label = { display: 'block', fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 5 };
const sel = { height: 32, border: '0.5px solid #d0d0cc', borderRadius: 8, background: '#fff', fontSize: 13, padding: '0 8px', color: '#1a1a1a' };

function Pill({ status }) {
  const s = STATUS_MAP[status] || STATUSES[0];
  return <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 8, background: s.bg, color: s.color, fontWeight: 500 }}>{s.label}</span>;
}

export default function CrmCompanies({ user }) {
  const isSuper = !user || user.is_super || user.access === 'ALL';
  const canTasks = isSuper || !!(user && user.access && user.access.crm_tasks);
  const canDeals = isSuper || !!(user && user.access && user.access.crm_deals);
  const canOrders = isSuper || !!(user && user.access && user.access.crm_orders);

  const [companies, setCompanies] = useState([]);
  const [counts, setCounts] = useState({ all: 0 });
  const [statusFilter, setStatusFilter] = useState('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [assignees, setAssignees] = useState([]);

  const [selectedId, setSelectedId] = useState(null);
  const [company, setCompany] = useState(null); // profile
  const [modal, setModal] = useState(null); // 'new' | companyObj | null
  const [tab, setTab] = useState('details');
  const [contacts, setContacts] = useState([]);
  const [contactModal, setContactModal] = useState(null); // 'new' | contactObj | null
  const [history, setHistory] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [taskModal, setTaskModal] = useState(null); // 'new' | taskObj | null
  const [deals, setDeals] = useState([]);
  const [dealModal, setDealModal] = useState(null); // 'new' | dealObj | null
  const [orders, setOrders] = useState([]);
  const [orderModal, setOrderModal] = useState(null); // 'new' | orderObj | null

  const loadContacts = useCallback(async (companyId) => {
    try { const r = await fetch('/api/crm/contacts?company_id=' + companyId); if (r.ok) { const d = await r.json(); setContacts(d.contacts || []); } } catch {}
  }, []);
  const loadHistory = useCallback(async (companyId) => {
    try { const r = await fetch('/api/crm/history?company_id=' + companyId); if (r.ok) { const d = await r.json(); setHistory(d.history || []); } } catch {}
  }, []);
  const loadTasks = useCallback(async (companyId) => {
    try { const r = await fetch('/api/crm/tasks?company_id=' + companyId); if (r.ok) { const d = await r.json(); setTasks(d.tasks || []); } } catch {}
  }, []);
  const loadDeals = useCallback(async (companyId) => {
    try { const r = await fetch('/api/crm/deals?company_id=' + companyId); if (r.ok) { const d = await r.json(); setDeals(d.deals || []); } } catch {}
  }, []);
  const loadOrders = useCallback(async (companyId) => {
    try { const r = await fetch('/api/crm/orders?company_id=' + companyId); if (r.ok) { const d = await r.json(); setOrders(d.orders || []); } } catch {}
  }, []);
  useEffect(() => { if (company) { loadContacts(company.id); loadHistory(company.id); if (canTasks) loadTasks(company.id); if (canDeals) loadDeals(company.id); if (canOrders) loadOrders(company.id); } }, [company, canTasks, canDeals, canOrders, loadContacts, loadHistory, loadTasks, loadDeals, loadOrders]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (q.trim()) params.set('q', q.trim());
      const r = await fetch('/api/crm/companies?' + params.toString());
      if (r.ok) { const d = await r.json(); setCompanies(d.companies || []); setCounts(d.counts || { all: 0 }); }
    } catch {}
    setLoading(false);
  }, [statusFilter, q]);

  useEffect(() => { const t = setTimeout(loadList, q ? 250 : 0); return () => clearTimeout(t); }, [loadList, q]);

  useEffect(() => {
    fetch('/api/crm/companies/assignees').then(r => r.ok ? r.json() : null).then(d => { if (d) setAssignees(d.assignees || []); }).catch(() => {});
  }, []);

  async function openCompany(id) {
    setSelectedId(id); setCompany(null); setTab('details'); setContacts([]); setHistory([]); setTasks([]); setDeals([]); setOrders([]);
    try { const r = await fetch('/api/crm/companies/' + id); if (r.ok) { const d = await r.json(); setCompany(d.company); } } catch {}
  }

  async function patchCompany(id, patch) {
    try {
      const r = await fetch('/api/crm/companies/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (r.ok) { const d = await r.json(); setCompany(d.company); }
    } catch {}
  }

  async function removeCompany(c) {
    if (!window.confirm(`Delete ${c.name}? This can't be undone.`)) return;
    await fetch('/api/crm/companies/' + c.id, { method: 'DELETE' });
    setSelectedId(null); setCompany(null); loadList();
  }

  // ── Profile view ────────────────────────────────────────────────────────
  if (selectedId) {
    return (
      <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
        <button style={{ background: 'none', border: 'none', color: '#666', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }} onClick={() => { setSelectedId(null); setCompany(null); loadList(); }}>← Companies</button>
        {!company ? <div style={{ ...card, padding: 32, color: '#888' }}>Loading…</div> : (
          <div style={{ ...card, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 500, color: '#1a1a1a' }}>{company.name}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{company.category ? company.category + ' · ' : ''}added {new Date(company.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div><div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>Status</div>
                  <select style={sel} value={company.status} onChange={e => patchCompany(company.id, { status: e.target.value })}>
                    {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div><div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>Account manager</div>
                  <select style={sel} value={company.account_manager_id || ''} onChange={e => patchCompany(company.id, { account_manager_id: e.target.value || null })}>
                    <option value="">Unassigned</option>
                    {assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <button style={btnGhost} onClick={() => setModal(company)}>Edit</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid #eee', margin: '16px 0 16px', flexWrap: 'wrap' }}>
              {[
                { key: 'details', label: 'Details', on: true },
                { key: 'contacts', label: 'Contacts', on: true },
                { key: 'history', label: 'History', on: true },
                { key: 'tasks', label: 'Tasks', on: canTasks },
                { key: 'deals', label: 'Deals', on: canDeals },
                { key: 'orders', label: 'Orders', on: canOrders },
              ].map(t => t.on ? (
                <span key={t.key} onClick={() => setTab(t.key)} style={{ fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: tab === t.key ? 500 : 400, color: tab === t.key ? GREEN_DARK : '#666', borderBottom: '2px solid ' + (tab === t.key ? GREEN_DARK : 'transparent') }}>{t.label}{t.key === 'contacts' && contacts.length ? ` (${contacts.length})` : ''}</span>
              ) : (
                <span key={t.key} style={{ fontSize: 12, padding: '6px 12px', color: '#bbb' }}>{t.label}</span>
              ))}
            </div>

            {tab === 'details' && <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 24px' }}>
                <Field label="Website" value={company.website} />
                <Field label="Phone" value={company.phone} />
                <Field label="Address" value={[company.address, company.town, company.postcode].filter(Boolean).join(', ')} />
                <Field label="Category / industry" value={company.category} />
                <Field label="Source" value={company.source} />
              </div>
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: '#999', marginBottom: 2 }}>Notes</div>
                <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{company.notes || '—'}</div>
              </div>
            </>}

            {tab === 'contacts' && (
              <ContactsPanel
                contacts={contacts}
                onAdd={() => setContactModal('new')}
                onEdit={(c) => setContactModal(c)}
                onDelete={async (c) => { if (window.confirm(`Remove ${c.name}?`)) { await fetch('/api/crm/contacts/' + c.id, { method: 'DELETE' }); loadContacts(company.id); } }}
              />
            )}

            {tab === 'history' && (
              <HistoryPanel
                history={history}
                onAdd={async (kind, body) => { await fetch('/api/crm/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: company.id, kind, body }) }); loadHistory(company.id); }}
                onDelete={async (e) => { if (window.confirm('Delete this entry?')) { await fetch('/api/crm/history/' + e.id, { method: 'DELETE' }); loadHistory(company.id); } }}
              />
            )}

            {tab === 'tasks' && (
              <TasksPanel
                tasks={tasks}
                onAdd={() => setTaskModal('new')}
                onEdit={(t) => setTaskModal(t)}
                onToggle={async (t) => { await fetch('/api/crm/tasks/' + t.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: t.status === 'done' ? 'open' : 'done' }) }); loadTasks(company.id); loadHistory(company.id); }}
                onDelete={async (t) => { if (window.confirm('Delete this task?')) { await fetch('/api/crm/tasks/' + t.id, { method: 'DELETE' }); loadTasks(company.id); } }}
              />
            )}

            {tab === 'deals' && (
              <DealsPanel
                deals={deals}
                onAdd={() => setDealModal('new')}
                onEdit={(d) => setDealModal(d)}
                onDelete={async (d) => { if (window.confirm('Delete this deal?')) { await fetch('/api/crm/deals/' + d.id, { method: 'DELETE' }); loadDeals(company.id); } }}
              />
            )}

            {tab === 'orders' && (
              <OrdersPanel
                orders={orders}
                onAdd={() => setOrderModal('new')}
                onOpen={(o) => setOrderModal(o)}
              />
            )}

            <div style={{ borderTop: '0.5px solid #eee', marginTop: 16, paddingTop: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button style={{ ...btnGhost, color: '#A32D2D', borderColor: '#F0997B' }} onClick={() => removeCompany(company)}>Delete</button>
            </div>
          </div>
        )}
        {modal && <CompanyModal mode="edit" company={modal} assignees={assignees} onClose={() => setModal(null)} onSaved={(c) => { setModal(null); setCompany(c); }} />}
        {contactModal && company && <ContactModal mode={contactModal === 'new' ? 'new' : 'edit'} contact={contactModal === 'new' ? null : contactModal} companyId={company.id} onClose={() => setContactModal(null)} onSaved={() => { setContactModal(null); loadContacts(company.id); }} />}
        {taskModal && company && <TaskModal mode={taskModal === 'new' ? 'new' : 'edit'} task={taskModal === 'new' ? null : taskModal} companyId={company.id} assignees={assignees} onClose={() => setTaskModal(null)} onSaved={() => { setTaskModal(null); loadTasks(company.id); }} />}
        {dealModal && company && <DealModal mode={dealModal === 'new' ? 'new' : 'edit'} deal={dealModal === 'new' ? null : dealModal} companyId={company.id} assignees={assignees} onClose={() => setDealModal(null)} onSaved={() => { setDealModal(null); loadDeals(company.id); loadHistory(company.id); }} />}
        {orderModal && company && <OrderModal user={user} order={orderModal === 'new' ? null : orderModal} companyId={company.id} onClose={() => setOrderModal(null)} onSaved={() => { setOrderModal(null); loadOrders(company.id); loadHistory(company.id); }} />}
      </div>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1a1a' }}>Sales CRM</h1>
        <button style={btnPrimary} onClick={() => setModal('new')}>+ Add company</button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <Tab label="All" n={counts.all} on={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        {STATUSES.map(s => <Tab key={s.key} label={s.label} n={counts[s.key] || 0} on={statusFilter === s.key} onClick={() => setStatusFilter(s.key)} />)}
      </div>

      <input style={{ ...inputStyle, width: 280, marginBottom: 14 }} placeholder="Search name, town, postcode or account manager…" value={q} onChange={e => setQ(e.target.value)} />

      <div style={{ ...card, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Loading…</div>
          : companies.length === 0 ? <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>No companies{q || statusFilter !== 'all' ? ' match this filter' : ' yet — click “Add company”'}.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', color: '#888', fontSize: 12 }}>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Company</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Account manager</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Location</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Source</th>
              </tr></thead>
              <tbody>
                {companies.map(c => (
                  <tr key={c.id} style={{ borderTop: '0.5px solid #eee', cursor: 'pointer' }} onClick={() => openCompany(c.id)}>
                    <td style={{ padding: '11px 16px', color: '#1a1a1a' }}>{c.name}</td>
                    <td style={{ padding: '11px 16px' }}><Pill status={c.status} /></td>
                    <td style={{ padding: '11px 16px', color: '#666' }}>{c.account_manager_name || '—'}</td>
                    <td style={{ padding: '11px 16px', color: '#666' }}>{[c.town, c.postcode].filter(Boolean).join(', ') || '—'}</td>
                    <td style={{ padding: '11px 16px', color: '#666' }}>{c.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {modal && <CompanyModal mode="new" assignees={assignees} onClose={() => setModal(null)} onSaved={() => { setModal(null); loadList(); }} />}
    </div>
  );
}

function Field({ label, value }) {
  return <div><div style={{ fontSize: 12, color: '#999', marginBottom: 2 }}>{label}</div><div style={{ fontSize: 13, color: '#1a1a1a', marginBottom: 12 }}>{value || '—'}</div></div>;
}

function Tab({ label, n, on, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
      border: '0.5px solid ' + (on ? GREEN_DARK : '#d0d0cc'),
      background: on ? GREEN_DARK : '#fff', color: on ? '#fff' : '#666', fontWeight: 500,
    }}>{label} {n}</button>
  );
}

// ── Add / edit modal ──────────────────────────────────────────────────────
function CompanyModal({ mode, company, assignees, onClose, onSaved }) {
  const [f, setF] = useState({
    name: company?.name || '', status: company?.status || 'suspect',
    account_manager_id: company?.account_manager_id || '',
    website: company?.website || '', phone: company?.phone || '',
    address: company?.address || '', town: company?.town || '', postcode: company?.postcode || '',
    category: company?.category || '', source: company?.source || '', notes: company?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));

  async function save() {
    if (!f.name.trim()) { setErr('Company name is required'); return; }
    setBusy(true); setErr('');
    try {
      const body = { ...f, account_manager_id: f.account_manager_id || null };
      const r = mode === 'new'
        ? await fetch('/api/crm/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/crm/companies/' + company.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not save'); setBusy(false); return; }
      onSaved(d.company);
    } catch { setErr('Could not reach the server'); setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 26, width: 'min(620px, 94vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: '#1a1a1a', marginBottom: 16 }}>{mode === 'new' ? 'Add company' : 'Edit ' + company.name}</div>

        <div style={{ marginBottom: 12 }}><label style={label}>Company name *</label><input style={inputStyle} value={f.name} onChange={set('name')} autoFocus /></div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}><label style={label}>Status</label>
            <select style={{ ...inputStyle, height: 38 }} value={f.status} onChange={set('status')}>{STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}><label style={label}>Account manager</label>
            <select style={{ ...inputStyle, height: 38 }} value={f.account_manager_id} onChange={set('account_manager_id')}>
              <option value="">Unassigned</option>
              {assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}><label style={label}>Website</label><input style={inputStyle} value={f.website} onChange={set('website')} /></div>
          <div style={{ flex: 1, minWidth: 150 }}><label style={label}>Phone</label><input style={inputStyle} value={f.phone} onChange={set('phone')} /></div>
        </div>

        <div style={{ marginBottom: 12 }}><label style={label}>Address</label><input style={inputStyle} value={f.address} onChange={set('address')} placeholder="Street / building" /></div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}><label style={label}>Town</label><input style={inputStyle} value={f.town} onChange={set('town')} /></div>
          <div style={{ flex: 1, minWidth: 150 }}><label style={label}>Postcode</label><input style={inputStyle} value={f.postcode} onChange={set('postcode')} /></div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}><label style={label}>Category / industry</label><input style={inputStyle} value={f.category} onChange={set('category')} /></div>
          <div style={{ flex: 1, minWidth: 150 }}><label style={label}>Source</label><input style={inputStyle} value={f.source} onChange={set('source')} placeholder="Website, referral, cold email…" /></div>
        </div>

        <div style={{ marginBottom: 12 }}><label style={label}>Notes</label><textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }} value={f.notes} onChange={set('notes')} /></div>

        {err && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : (mode === 'new' ? 'Add company' : 'Save changes')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Contacts tab panel ────────────────────────────────────────────────────
function ContactsPanel({ contacts, onAdd, onEdit, onDelete }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: '#666' }}>{contacts.length} contact{contacts.length === 1 ? '' : 's'}</span>
        <button style={{ ...btnPrimary, height: 30, padding: '0 12px', fontSize: 12 }} onClick={onAdd}>+ Add contact</button>
      </div>
      {contacts.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>No contacts yet — add the people you deal with at this company.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#888', fontSize: 12 }}>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Name</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Role</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Email</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Phone</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}></th>
          </tr></thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.id} style={{ borderTop: '0.5px solid #eee' }}>
                <td style={{ padding: '10px 8px', color: '#1a1a1a' }}>{c.name}{c.is_decision_maker ? <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: SB.tint, color: GREEN_DARK, fontWeight: 500, marginLeft: 8 }}>Decision-maker</span> : null}</td>
                <td style={{ padding: '10px 8px', color: '#666' }}>{c.role || '—'}</td>
                <td style={{ padding: '10px 8px', color: '#666' }}>{c.email || '—'}</td>
                <td style={{ padding: '10px 8px', color: '#666' }}>{c.phone || '—'}</td>
                <td style={{ padding: '10px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button style={{ ...btnGhost, padding: '4px 10px' }} onClick={() => onEdit(c)}>Edit</button>
                  <button style={{ ...btnGhost, padding: '4px 10px', marginLeft: 6, color: '#A32D2D', borderColor: '#F0997B' }} onClick={() => onDelete(c)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Add / edit contact modal ──────────────────────────────────────────────
function ContactModal({ mode, contact, companyId, onClose, onSaved }) {
  const [f, setF] = useState({
    name: contact?.name || '', role: contact?.role || '', email: contact?.email || '',
    phone: contact?.phone || '', is_decision_maker: contact ? !!contact.is_decision_maker : false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));

  async function save() {
    if (!f.name.trim()) { setErr('Contact name is required'); return; }
    setBusy(true); setErr('');
    try {
      const body = { ...f, company_id: companyId };
      const r = mode === 'new'
        ? await fetch('/api/crm/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/crm/contacts/' + contact.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not save'); setBusy(false); return; }
      onSaved();
    } catch { setErr('Could not reach the server'); setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 26, width: 'min(520px, 94vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: '#1a1a1a', marginBottom: 16 }}>{mode === 'new' ? 'Add contact' : 'Edit contact'}</div>
        <div style={{ marginBottom: 12 }}><label style={label}>Name *</label><input style={inputStyle} value={f.name} onChange={set('name')} autoFocus /></div>
        <div style={{ marginBottom: 12 }}><label style={label}>Role / job title</label><input style={inputStyle} value={f.role} onChange={set('role')} /></div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}><label style={label}>Email</label><input style={inputStyle} value={f.email} onChange={set('email')} /></div>
          <div style={{ flex: 1, minWidth: 150 }}><label style={label}>Phone</label><input style={inputStyle} value={f.phone} onChange={set('phone')} /></div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, cursor: 'pointer', marginBottom: 4 }}>
          <input type="checkbox" checked={f.is_decision_maker} onChange={e => setF(s => ({ ...s, is_decision_maker: e.target.checked }))} style={{ accentColor: GREEN_DARK, width: 16, height: 16 }} />
          Decision-maker
        </label>
        {err && <div style={{ color: '#c0392b', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : (mode === 'new' ? 'Add contact' : 'Save changes')}</button>
        </div>
      </div>
    </div>
  );
}

// ── History tab panel ─────────────────────────────────────────────────────
const KIND_META = {
  note:          { label: 'Note',          color: '#555' },
  call:          { label: 'Call',          color: '#2E7D32' },
  email:         { label: 'Email',         color: '#0C447C' },
  meeting:       { label: 'Meeting',       color: '#9333EA' },
  status_change: { label: 'Status change', color: '#999' },
  system:        { label: 'Update',        color: '#999' },
};
function fmtWhen(ts) {
  try { return new Date(ts.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return ts; }
}
function HistoryPanel({ history, onAdd, onDelete }) {
  const [kind, setKind] = useState('note');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function log() {
    if (!body.trim() || busy) return;
    setBusy(true);
    await onAdd(kind, body.trim());
    setBody(''); setBusy(false);
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <select style={{ ...sel, height: 34 }} value={kind} onChange={e => setKind(e.target.value)}>
          <option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option>
        </select>
        <input style={{ ...inputStyle, height: 34, flex: 1 }} placeholder="What happened?" value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') log(); }} />
        <button style={{ ...btnPrimary, height: 34, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={log}>Log</button>
      </div>
      {history.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>No activity yet — log a call, email, meeting or note above.</div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {history.map(e => {
            const m = KIND_META[e.kind] || KIND_META.note;
            return (
              <div key={e.id} style={{ display: 'flex', gap: 11, padding: '12px 0', borderBottom: '0.5px solid #eee' }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', marginTop: 5, background: m.color }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', color: m.color }}>{m.label}</span>
                  <span style={{ fontSize: 11, color: '#aaa' }}> · {e.author || 'Unknown'} · {fmtWhen(e.created_at)}</span>
                  <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>{e.body}</div>
                </div>
                <button title="Delete" onClick={() => onDelete(e)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: 15, lineHeight: 1, alignSelf: 'flex-start' }}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tasks tab panel + shared task bits ────────────────────────────────────
const PRIORITY_META = {
  high:   { label: 'High',   bg: '#FBE6E2', color: '#9E2A1E' },
  normal: { label: 'Normal', bg: '#E6F1FB', color: '#0C447C' },
  low:    { label: 'Low',    bg: '#F1EFE8', color: '#5b5b57' },
};
export function PriorityPill({ priority }) {
  const m = PRIORITY_META[priority] || PRIORITY_META.normal;
  return <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: m.bg, color: m.color, fontWeight: 500 }}>{m.label}</span>;
}
export function fmtDue(due, overdue) {
  if (!due) return { text: '—', over: false };
  let text = due;
  try { text = new Date(due + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch {}
  return { text: overdue ? text + ' (overdue)' : text, over: !!overdue };
}

function TasksPanel({ tasks, onAdd, onEdit, onToggle, onDelete }) {
  const open = tasks.filter(t => t.status !== 'done').length;
  const done = tasks.length - open;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: '#666' }}>{open} open · {done} done</span>
        <button style={{ ...btnPrimary, height: 30, padding: '0 12px', fontSize: 12 }} onClick={onAdd}>+ Add task</button>
      </div>
      {tasks.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>No tasks yet — add one to track the next step.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#888', fontSize: 12 }}>
            <th style={{ padding: '8px 8px', width: 26 }}></th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Task</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Assignee</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Due</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Priority</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}></th>
          </tr></thead>
          <tbody>
            {tasks.map(t => {
              const done = t.status === 'done';
              const due = fmtDue(t.due_date, t.overdue);
              return (
                <tr key={t.id} style={{ borderTop: '0.5px solid #eee' }}>
                  <td style={{ padding: '10px 8px' }}><input type="checkbox" checked={done} onChange={() => onToggle(t)} style={{ width: 15, height: 15, accentColor: GREEN_DARK }} /></td>
                  <td style={{ padding: '10px 8px', color: done ? '#aaa' : '#1a1a1a', textDecoration: done ? 'line-through' : 'none' }}>{t.title}</td>
                  <td style={{ padding: '10px 8px', color: '#888' }}>{t.assignee_name || '—'}</td>
                  <td style={{ padding: '10px 8px', color: due.over ? '#9E2A1E' : '#888', fontWeight: due.over ? 500 : 400 }}>{due.text}</td>
                  <td style={{ padding: '10px 8px' }}>{done ? null : <PriorityPill priority={t.priority} />}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button style={{ ...btnGhost, padding: '4px 10px' }} onClick={() => onEdit(t)}>Edit</button>
                    <button style={{ ...btnGhost, padding: '4px 10px', marginLeft: 6, color: '#A32D2D', borderColor: '#F0997B' }} onClick={() => onDelete(t)}>Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Add / edit task modal ─────────────────────────────────────────────────
export function TaskModal({ mode, task, companyId, assignees, onClose, onSaved }) {
  const [f, setF] = useState({
    title: task?.title || '', assignee_id: task?.assignee_id || '',
    due_date: task?.due_date || '', priority: task?.priority || 'normal',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));

  async function save() {
    if (!f.title.trim()) { setErr('Task title is required'); return; }
    setBusy(true); setErr('');
    try {
      const body = { ...f, company_id: companyId, assignee_id: f.assignee_id || null };
      const r = mode === 'new'
        ? await fetch('/api/crm/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/crm/tasks/' + task.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not save'); setBusy(false); return; }
      onSaved();
    } catch { setErr('Could not reach the server'); setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 26, width: 'min(520px, 94vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: '#1a1a1a', marginBottom: 16 }}>{mode === 'new' ? 'Add task' : 'Edit task'}</div>
        <div style={{ marginBottom: 12 }}><label style={label}>Task *</label><input style={inputStyle} value={f.title} onChange={set('title')} autoFocus placeholder="e.g. Send catalogue pricing" /></div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}><label style={label}>Assignee</label>
            <select style={{ ...inputStyle, height: 38 }} value={f.assignee_id} onChange={set('assignee_id')}>
              <option value="">Unassigned</option>
              {(assignees || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}><label style={label}>Due date</label><input type="date" style={{ ...inputStyle, height: 38 }} value={f.due_date} onChange={set('due_date')} /></div>
          <div style={{ flex: 1, minWidth: 110 }}><label style={label}>Priority</label>
            <select style={{ ...inputStyle, height: 38 }} value={f.priority} onChange={set('priority')}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
            </select>
          </div>
        </div>
        {err && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : (mode === 'new' ? 'Add task' : 'Save changes')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Deals tab panel + shared deal bits ────────────────────────────────────
export function fmtMoney(n) {
  const v = Number(n) || 0;
  return '£' + v.toLocaleString('en-GB', { maximumFractionDigits: 0 });
}
const DEAL_STATUS = {
  open: { label: 'Open', bg: '#E6F1FB', color: '#0C447C' },
  won:  { label: 'Won',  bg: SB.tint, color: SB.strong },
  lost: { label: 'Lost', bg: '#F1EFE8', color: '#777' },
};
export function DealStatusPill({ status }) {
  const m = DEAL_STATUS[status] || DEAL_STATUS.open;
  return <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: m.bg, color: m.color, fontWeight: 500 }}>{m.label}</span>;
}

function DealsPanel({ deals, onAdd, onEdit, onDelete }) {
  const open = deals.filter(d => d.status === 'open');
  const oneOff = open.reduce((s, d) => s + (Number(d.one_off_value) || 0), 0);
  const monthly = open.reduce((s, d) => s + (Number(d.monthly_value) || 0), 0);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: '#666' }}>{open.length} open · {fmtMoney(oneOff)} one-off + {fmtMoney(monthly)}/mo</span>
        <button style={{ ...btnPrimary, height: 30, padding: '0 12px', fontSize: 12 }} onClick={onAdd}>+ Add deal</button>
      </div>
      {deals.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>No deals yet — add one to forecast this company.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#888', fontSize: 12 }}>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Deal</th>
            <th style={{ padding: '8px 8px', fontWeight: 500, textAlign: 'right' }}>One-off</th>
            <th style={{ padding: '8px 8px', fontWeight: 500, textAlign: 'right' }}>Monthly</th>
            <th style={{ padding: '8px 8px', fontWeight: 500, textAlign: 'right' }}>Profit</th>
            <th style={{ padding: '8px 8px', fontWeight: 500, textAlign: 'right' }}>Likely</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Close</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Status</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}></th>
          </tr></thead>
          <tbody>
            {deals.map(d => (
              <tr key={d.id} style={{ borderTop: '0.5px solid #eee', cursor: 'pointer' }} onClick={() => onEdit(d)}>
                <td style={{ padding: '10px 8px', color: '#1a1a1a' }}>{d.title}</td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(d.one_off_value)}</td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(d.monthly_value)}</td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#666' }}>{fmtMoney(d.profit)}</td>
                <td style={{ padding: '10px 8px', textAlign: 'right', color: '#666' }}>{d.status === 'open' ? d.likelihood + '%' : '—'}</td>
                <td style={{ padding: '10px 8px', color: '#888' }}>{fmtDue(d.expected_close, false).text}</td>
                <td style={{ padding: '10px 8px' }}><DealStatusPill status={d.status} /></td>
                <td style={{ padding: '10px 8px', textAlign: 'right' }}><button style={{ ...btnGhost, padding: '4px 10px', color: '#A32D2D', borderColor: '#F0997B' }} onClick={(e) => { e.stopPropagation(); onDelete(d); }}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Add / edit deal modal ─────────────────────────────────────────────────
export function DealModal({ mode, deal, companyId, assignees, onClose, onSaved }) {
  const [f, setF] = useState({
    title: deal?.title || '', one_off_value: deal?.one_off_value ?? '', monthly_value: deal?.monthly_value ?? '',
    profit: deal?.profit ?? '', likelihood: deal?.likelihood ?? 50, expected_close: deal?.expected_close || '',
    owner_id: deal?.owner_id || '', status: deal?.status || 'open',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));

  async function save() {
    if (!f.title.trim()) { setErr('Deal name is required'); return; }
    setBusy(true); setErr('');
    try {
      const body = { ...f, company_id: companyId, owner_id: f.owner_id || null };
      const r = mode === 'new'
        ? await fetch('/api/crm/deals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/crm/deals/' + deal.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not save'); setBusy(false); return; }
      onSaved();
    } catch { setErr('Could not reach the server'); setBusy(false); }
  }

  const money = { ...inputStyle };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 26, width: 'min(560px, 94vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: '#1a1a1a', marginBottom: 16 }}>{mode === 'new' ? 'Add deal' : 'Edit deal'}</div>
        <div style={{ marginBottom: 12 }}><label style={label}>Deal name *</label><input style={inputStyle} value={f.title} onChange={set('title')} autoFocus placeholder="e.g. Catalogue programme" /></div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}><label style={label}>One-off value (£)</label><input type="number" min="0" step="0.01" style={money} value={f.one_off_value} onChange={set('one_off_value')} /></div>
          <div style={{ flex: 1, minWidth: 130 }}><label style={label}>Monthly value (£)</label><input type="number" min="0" step="0.01" style={money} value={f.monthly_value} onChange={set('monthly_value')} /></div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}><label style={label}>Profit (£)</label><input type="number" step="0.01" style={money} value={f.profit} onChange={set('profit')} /></div>
          <div style={{ flex: 1, minWidth: 130 }}><label style={label}>Likelihood to close (%)</label><input type="number" min="0" max="100" step="1" style={money} value={f.likelihood} onChange={set('likelihood')} /></div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}><label style={label}>Expected close</label><input type="date" style={{ ...inputStyle, height: 38 }} value={f.expected_close} onChange={set('expected_close')} /></div>
          <div style={{ flex: 1, minWidth: 130 }}><label style={label}>Owner</label>
            <select style={{ ...inputStyle, height: 38 }} value={f.owner_id} onChange={set('owner_id')}>
              <option value="">Unassigned</option>
              {(assignees || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 110 }}><label style={label}>Status</label>
            <select style={{ ...inputStyle, height: 38 }} value={f.status} onChange={set('status')}>
              <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option>
            </select>
          </div>
        </div>
        {err && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : (mode === 'new' ? 'Add deal' : 'Save changes')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Orders: status pill, company Orders tab panel, and the order editor ──────
const ORDER_STATUS = {
  draft:             { label: 'Draft',             bg: '#F1EFE8', color: '#5b5b57' },
  awaiting_approval: { label: 'Awaiting approval', bg: '#FAEEDA', color: '#854F0B' },
  approved:          { label: 'Approved',          bg: '#E6F1FB', color: '#0C447C' },
  rejected:          { label: 'Returned',          bg: '#FBE6E2', color: '#9E2A1E' },
  purchasing:        { label: 'Purchasing',        bg: '#EDE7F6', color: '#5B21B6' },
  completed:         { label: 'Completed',         bg: SB.tint, color: SB.strong },
};
export function OrderStatusPill({ status }) {
  const m = ORDER_STATUS[status] || ORDER_STATUS.draft;
  return <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: m.bg, color: m.color, fontWeight: 500 }}>{m.label}</span>;
}

function OrdersPanel({ orders, onAdd, onOpen }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: '#666' }}>{orders.length} order{orders.length === 1 ? '' : 's'}</span>
        <button style={{ ...btnPrimary, height: 30, padding: '0 12px', fontSize: 12 }} onClick={onAdd}>+ New order</button>
      </div>
      {orders.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>No orders yet — write one to forward for approval.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#888', fontSize: 12 }}>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Order</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Title</th>
            <th style={{ padding: '8px 8px', fontWeight: 500, textAlign: 'right' }}>Value</th>
            <th style={{ padding: '8px 8px', fontWeight: 500 }}>Status</th>
          </tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} style={{ borderTop: '0.5px solid #eee', cursor: 'pointer' }} onClick={() => onOpen(o)}>
                <td style={{ padding: '10px 8px', color: '#1a1a1a' }}>#{o.order_no}</td>
                <td style={{ padding: '10px 8px', color: '#666' }}>{o.title || '—'}</td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(o.value)}</td>
                <td style={{ padding: '10px 8px' }}><OrderStatusPill status={o.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// The order editor + workflow actions. Used by the company Orders tab AND the
// CRM → Orders / Approval / Purchasing dashboards.
export function OrderModal({ user, order, companyId, onClose, onSaved }) {
  const isSuper = !user || user.is_super || user.access === 'ALL';
  const acc = (k) => isSuper || !!(user && user.access && user.access[k]);
  const canOrders = acc('crm_orders');
  const canPurchasing = acc('crm_purchasing');

  const [full, setFull] = useState(order && order.lines ? order : null);
  const [loading, setLoading] = useState(!!(order && order.id));
  const [lines, setLines] = useState([{ description: '', qty: 1, unit_price: 0 }]);
  const [title, setTitle] = useState('');
  const [profit, setProfit] = useState('');
  const [notes, setNotes] = useState('');
  const [comment, setComment] = useState('');
  const [pstatus, setPstatus] = useState('');
  const [pnotes, setPnotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function hydrate(o) {
    setTitle(o.title || ''); setProfit(o.profit ?? ''); setNotes(o.notes || '');
    setPstatus(o.purchasing_status || ''); setPnotes(o.purchasing_notes || '');
    setLines(o.lines && o.lines.length ? o.lines.map(l => ({ description: l.description, qty: l.qty, unit_price: l.unit_price })) : [{ description: '', qty: 1, unit_price: 0 }]);
  }
  useEffect(() => {
    let alive = true;
    if (order && order.id) {
      fetch('/api/crm/orders/' + order.id).then(r => r.ok ? r.json() : null).then(d => { if (alive && d && d.order) { setFull(d.order); hydrate(d.order); } setLoading(false); }).catch(() => setLoading(false));
    } else { setLoading(false); }
    return () => { alive = false; };
  }, [order]);

  const status = full ? full.status : 'draft';
  const isNew = !order || !order.id;
  const editable = isNew || ['draft', 'rejected'].includes(status);
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);

  function setLine(i, k, v) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l)); }
  function addLine() { setLines(ls => [...ls, { description: '', qty: 1, unit_price: 0 }]); }
  function removeLine(i) { setLines(ls => ls.filter((_, idx) => idx !== i)); }

  async function persist() {
    const body = { company_id: companyId, title, profit, notes, lines: lines.filter(l => (l.description || '').trim()) };
    const r = order && order.id
      ? await fetch('/api/crm/orders/' + order.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/crm/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not save');
    return d.order;
  }
  async function act(fn) { setBusy(true); setErr(''); try { await fn(); onSaved(); } catch (e) { setErr(e.message || 'Could not reach the server'); setBusy(false); } }
  const saveDraft = () => act(async () => { await persist(); });
  const forward = () => act(async () => { const o = await persist(); await fetch('/api/crm/orders/' + o.id + '/forward', { method: 'POST' }); });
  const approve = () => act(async () => { await fetch('/api/crm/orders/' + order.id + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }) }); });
  const reject = () => act(async () => { await fetch('/api/crm/orders/' + order.id + '/reject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }) }); });
  const sendToPurchasing = () => act(async () => { await fetch('/api/crm/orders/' + order.id + '/send-to-purchasing', { method: 'POST' }); });
  const savePurchasing = () => act(async () => { await fetch('/api/crm/orders/' + order.id + '/purchasing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purchasing_status: pstatus, purchasing_notes: pnotes }) }); });
  const complete = () => act(async () => { await fetch('/api/crm/orders/' + order.id + '/complete', { method: 'POST' }); });
  const del = () => { if (window.confirm('Delete this order?')) act(async () => { await fetch('/api/crm/orders/' + order.id, { method: 'DELETE' }); }); };

  const cell = { padding: '6px 6px', borderBottom: '0.5px solid #eee' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 26, width: 'min(680px, 95vw)', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#1a1a1a' }}>{isNew ? 'New order' : 'Order #' + full?.order_no} {full ? <OrderStatusPill status={status} /> : null}</div>
        </div>

        {loading ? <div style={{ padding: 20, color: '#888' }}>Loading…</div> : <>
          <div style={{ marginBottom: 12 }}><label style={label}>Title (optional)</label><input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} disabled={!editable} placeholder="e.g. Q3 catalogue order" /></div>

          <div style={{ fontSize: 12, fontWeight: 500, color: '#555', margin: '4px 0 6px' }}>Line items</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 6 }}>
            <thead><tr style={{ textAlign: 'left', color: '#999', fontSize: 11 }}>
              <th style={{ padding: '4px 6px', fontWeight: 500 }}>Description</th>
              <th style={{ padding: '4px 6px', fontWeight: 500, width: 60 }}>Qty</th>
              <th style={{ padding: '4px 6px', fontWeight: 500, width: 90 }}>Unit £</th>
              <th style={{ padding: '4px 6px', fontWeight: 500, width: 80, textAlign: 'right' }}>Total</th>
              {editable && <th style={{ width: 24 }}></th>}
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td style={cell}>{editable ? <input style={{ ...inputStyle, height: 32 }} value={l.description} onChange={e => setLine(i, 'description', e.target.value)} /> : <span>{l.description}</span>}</td>
                  <td style={cell}>{editable ? <input type="number" min="0" step="1" style={{ ...inputStyle, height: 32 }} value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)} /> : <span>{l.qty}</span>}</td>
                  <td style={cell}>{editable ? <input type="number" min="0" step="0.01" style={{ ...inputStyle, height: 32 }} value={l.unit_price} onChange={e => setLine(i, 'unit_price', e.target.value)} /> : <span>{fmtMoney(l.unit_price)}</span>}</td>
                  <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney((Number(l.qty) || 0) * (Number(l.unit_price) || 0))}</td>
                  {editable && <td style={cell}><button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: 15 }}>×</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {editable && <button style={{ ...btnGhost, padding: '5px 10px', fontSize: 12 }} onClick={addLine}>+ Add line</button>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 18, marginTop: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: '#666' }}>Order total <span style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginLeft: 8 }}>{fmtMoney(total)}</span></div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}><label style={label}>Profit (£)</label><input type="number" step="0.01" style={inputStyle} value={profit} onChange={e => setProfit(e.target.value)} disabled={!editable} /></div>
          </div>
          <div style={{ marginTop: 12 }}><label style={label}>Notes</label><textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical', fontFamily: 'inherit' }} value={notes} onChange={e => setNotes(e.target.value)} disabled={!editable} /></div>

          {/* Decision / purchasing context */}
          {full && full.decision_comment && (status === 'approved' || status === 'rejected') && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#f7f7f4', borderRadius: 8, fontSize: 13, color: '#555' }}>
              <strong style={{ fontWeight: 500 }}>{status === 'approved' ? 'Approved' : 'Returned'}{full.approver ? ' by ' + full.approver : ''}:</strong> {full.decision_comment}
            </div>
          )}

          {status === 'awaiting_approval' && isSuper && (
            <div style={{ marginTop: 14 }}>
              <label style={label}>Decision comment (optional)</label>
              <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical', fontFamily: 'inherit' }} value={comment} onChange={e => setComment(e.target.value)} />
            </div>
          )}
          {status === 'awaiting_approval' && !isSuper && (
            <div style={{ marginTop: 12, fontSize: 13, color: '#854F0B', background: '#FAEEDA', padding: '10px 12px', borderRadius: 8 }}>Awaiting admin approval.</div>
          )}

          {(status === 'purchasing') && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '0.5px solid #eee' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 8 }}>Purchasing</div>
              <div style={{ marginBottom: 10 }}><label style={label}>Purchasing status</label><input style={inputStyle} value={pstatus} onChange={e => setPstatus(e.target.value)} disabled={!canPurchasing} placeholder="e.g. Ordered with supplier / Awaiting delivery" /></div>
              <div><label style={label}>Purchasing notes</label><textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical', fontFamily: 'inherit' }} value={pnotes} onChange={e => setPnotes(e.target.value)} disabled={!canPurchasing} /></div>
            </div>
          )}
          {status === 'completed' && full && full.purchasing_notes && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#f7f7f4', borderRadius: 8, fontSize: 13, color: '#555' }}>Purchasing: {full.purchasing_notes}</div>
          )}

          {err && <div style={{ color: '#c0392b', fontSize: 13, marginTop: 12 }}>{err}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <div>
              {!isNew && editable && canOrders && <button style={{ ...btnGhost, color: '#A32D2D', borderColor: '#F0997B' }} onClick={del} disabled={busy}>Delete</button>}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button style={btnGhost} onClick={onClose}>Close</button>
              {editable && canOrders && <button style={btnGhost} onClick={saveDraft} disabled={busy}>Save draft</button>}
              {editable && canOrders && <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} onClick={forward} disabled={busy}>Forward for approval</button>}
              {status === 'awaiting_approval' && isSuper && <button style={{ ...btnGhost, color: '#9E2A1E', borderColor: '#F0997B' }} onClick={reject} disabled={busy}>Reject</button>}
              {status === 'awaiting_approval' && isSuper && <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} onClick={approve} disabled={busy}>Approve</button>}
              {status === 'approved' && canOrders && <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} onClick={sendToPurchasing} disabled={busy}>Send to purchasing</button>}
              {status === 'purchasing' && canPurchasing && <button style={btnGhost} onClick={savePurchasing} disabled={busy}>Save</button>}
              {status === 'purchasing' && canPurchasing && <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} onClick={complete} disabled={busy}>Mark completed</button>}
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}
