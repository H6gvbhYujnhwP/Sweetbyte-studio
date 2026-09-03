import React, { useState, useEffect, useCallback } from 'react';
import { fmtMoney, DealStatusPill, fmtDue } from './CrmCompanies.jsx';
import { SB } from '../brand.js';

// CrmDeals — the cross-company deals forecast (sidebar → CRM → Deals).
// Spreadsheet-style table + a totals strip that weights OPEN deals by
// likelihood. Status filter: Open / Won / Lost / All. Deals are created on a
// company; here you see the whole pipeline.

const GREEN_DARK = SB.strong;
const card = { background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 10 };

function Tab({ label, on, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
      border: '0.5px solid ' + (on ? GREEN_DARK : '#d0d0cc'),
      background: on ? GREEN_DARK : '#fff', color: on ? '#fff' : '#666', fontWeight: 500,
    }}>{label}</button>
  );
}
function Tile({ value, sub, label }) {
  return (
    <div style={{ flex: 1, minWidth: 130, background: '#f5f5f3', border: '0.5px solid #e0e0dc', borderRadius: 8, padding: '11px 14px' }}>
      <div style={{ fontSize: 19, fontWeight: 600, color: '#1a1a1a' }}>{value}{sub ? <span style={{ fontSize: 12, fontWeight: 400 }}>{sub}</span> : null}</div>
      <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{label}</div>
    </div>
  );
}

export default function CrmDeals() {
  const [filter, setFilter] = useState('open');
  const [deals, setDeals] = useState([]);
  const [summary, setSummary] = useState({ open_count: 0, weighted_one_off: 0, monthly_recurring: 0, forecast_profit: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/crm/deals?status=' + filter);
      if (r.ok) { const d = await r.json(); setDeals(d.deals || []); if (d.summary) setSummary(d.summary); }
    } catch {}
    setLoading(false);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1a1a' }}>Deals forecast</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <Tab label="Open" on={filter === 'open'} onClick={() => setFilter('open')} />
          <Tab label="Won" on={filter === 'won'} onClick={() => setFilter('won')} />
          <Tab label="Lost" on={filter === 'lost'} onClick={() => setFilter('lost')} />
          <Tab label="All" on={filter === 'all'} onClick={() => setFilter('all')} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Tile value={summary.open_count} label="Open deals" />
        <Tile value={fmtMoney(summary.weighted_one_off)} label="Weighted forecast (one-off)" />
        <Tile value={fmtMoney(summary.monthly_recurring)} sub="/mo" label="Monthly recurring (open)" />
        <Tile value={fmtMoney(summary.forecast_profit)} label="Forecast profit" />
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Loading…</div>
          : deals.length === 0 ? <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>No deals here.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ textAlign: 'left', color: '#888', fontSize: 11 }}>
                <th style={{ padding: '9px 12px', fontWeight: 500 }}>Company</th>
                <th style={{ padding: '9px 12px', fontWeight: 500 }}>Deal</th>
                <th style={{ padding: '9px 12px', fontWeight: 500, textAlign: 'right' }}>One-off</th>
                <th style={{ padding: '9px 12px', fontWeight: 500, textAlign: 'right' }}>Monthly</th>
                <th style={{ padding: '9px 12px', fontWeight: 500, textAlign: 'right' }}>Profit</th>
                <th style={{ padding: '9px 12px', fontWeight: 500, textAlign: 'right' }}>Likely</th>
                <th style={{ padding: '9px 12px', fontWeight: 500 }}>Close</th>
                <th style={{ padding: '9px 12px', fontWeight: 500 }}>Owner</th>
                <th style={{ padding: '9px 12px', fontWeight: 500 }}>Status</th>
              </tr></thead>
              <tbody>
                {deals.map(d => (
                  <tr key={d.id} style={{ borderTop: '0.5px solid #eee' }}>
                    <td style={{ padding: '10px 12px', color: '#1a1a1a' }}>{d.company_name || '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#666' }}>{d.title}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(d.one_off_value)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(d.monthly_value)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#666' }}>{fmtMoney(d.profit)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#666' }}>{d.status === 'open' ? d.likelihood + '%' : '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#888' }}>{fmtDue(d.expected_close, false).text}</td>
                    <td style={{ padding: '10px 12px', color: '#666' }}>{d.owner_name || '—'}</td>
                    <td style={{ padding: '10px 12px' }}><DealStatusPill status={d.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>Weighted forecast = each open deal's one-off × its likelihood. Monthly recurring is the sum of open deals' monthly charges.</div>
    </div>
  );
}
