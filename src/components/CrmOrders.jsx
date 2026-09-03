import React, { useState, useEffect, useCallback } from 'react';
import { OrderModal, OrderStatusPill, fmtMoney } from './CrmCompanies.jsx';
import { SB } from '../brand.js';

// CrmOrders — the cross-company order screens. One component, three modes via
// the `queue` prop:
//   'orders'     → CRM → Orders        (everything, status filter)
//   'approval'   → CRM → Approval queue (awaiting approval; admin approves)
//   'purchasing' → CRM → Purchasing    (approved + sent; fulfilment)
// Clicking a row opens the shared OrderModal, which shows the right workflow
// buttons for the order's status and the signed-in user's access.

const GREEN_DARK = SB.strong;
const card = { background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 10 };

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'awaiting_approval', label: 'Awaiting' },
  { key: 'approved', label: 'Approved' },
  { key: 'purchasing', label: 'Purchasing' },
  { key: 'completed', label: 'Completed' },
  { key: 'rejected', label: 'Returned' },
];

function Tab({ label, n, on, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
      border: '0.5px solid ' + (on ? GREEN_DARK : '#d0d0cc'),
      background: on ? GREEN_DARK : '#fff', color: on ? '#fff' : '#666', fontWeight: 500,
    }}>{label}{n != null ? ' ' + n : ''}</button>
  );
}

export default function CrmOrders({ user, queue = 'orders' }) {
  const [status, setStatus] = useState('all');
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null); // order being viewed

  const title = queue === 'approval' ? 'Approval queue' : queue === 'purchasing' ? 'Purchasing queue' : 'Orders';
  const empty = queue === 'approval' ? 'Nothing waiting for approval.' : queue === 'purchasing' ? 'Nothing in purchasing.' : 'No orders here.';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/api/crm/orders';
      if (queue === 'approval') url += '?queue=approval';
      else if (queue === 'purchasing') url += '?queue=purchasing';
      else if (status !== 'all') url += '?status=' + status;
      const r = await fetch(url);
      if (r.ok) { const d = await r.json(); setOrders(d.orders || []); if (d.counts) setCounts(d.counts); }
    } catch {}
    setLoading(false);
  }, [queue, status]);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
      <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1a1a', marginBottom: 14 }}>{title}</h1>

      {queue === 'orders' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {STATUS_TABS.map(t => <Tab key={t.key} label={t.label} n={t.key === 'all' ? undefined : (counts[t.key] || 0)} on={status === t.key} onClick={() => setStatus(t.key)} />)}
        </div>
      )}

      <div style={{ ...card, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Loading…</div>
          : orders.length === 0 ? <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>{empty}</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', color: '#888', fontSize: 12 }}>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Order</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Company</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Title</th>
                <th style={{ padding: '10px 16px', fontWeight: 500, textAlign: 'right' }}>Value</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Status</th>
              </tr></thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} style={{ borderTop: '0.5px solid #eee', cursor: 'pointer' }} onClick={() => setOpen(o)}>
                    <td style={{ padding: '11px 16px', color: '#1a1a1a' }}>#{o.order_no}</td>
                    <td style={{ padding: '11px 16px', color: '#666' }}>{o.company_name || '—'}</td>
                    <td style={{ padding: '11px 16px', color: '#666' }}>{o.title || '—'}</td>
                    <td style={{ padding: '11px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(o.value)}</td>
                    <td style={{ padding: '11px 16px' }}><OrderStatusPill status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {open && <OrderModal user={user} order={open} companyId={open.company_id} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />}
    </div>
  );
}
