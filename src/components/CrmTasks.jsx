import React, { useState, useEffect, useCallback } from 'react';
import { PriorityPill, fmtDue } from './CrmCompanies.jsx';
import { SB } from '../brand.js';

// CrmTasks — the cross-company Tasks dashboard (sidebar → CRM → Tasks).
// Talks to /api/crm/tasks. Open / Overdue / Completed views + an assignee
// filter. Tasks are created on a company; here you work through and tick them.

const GREEN_DARK = SB.strong;
const card = { background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 10 };

function Tab({ label, n, on, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
      border: '0.5px solid ' + (on ? GREEN_DARK : '#d0d0cc'),
      background: on ? GREEN_DARK : '#fff', color: on ? '#fff' : '#666', fontWeight: 500,
    }}>{label} {n}</button>
  );
}

export default function CrmTasks() {
  const [view, setView] = useState('open');
  const [assignee, setAssignee] = useState('all');
  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({ open: 0, overdue: 0, completed: 0 });
  const [assignees, setAssignees] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ view });
      if (assignee !== 'all') p.set('assignee', assignee);
      const r = await fetch('/api/crm/tasks?' + p.toString());
      if (r.ok) { const d = await r.json(); setTasks(d.tasks || []); setCounts(d.counts || { open: 0, overdue: 0, completed: 0 }); }
    } catch {}
    setLoading(false);
  }, [view, assignee]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/crm/tasks/assignees').then(r => r.ok ? r.json() : null).then(d => { if (d) setAssignees(d.assignees || []); }).catch(() => {});
  }, []);

  async function toggle(t) {
    await fetch('/api/crm/tasks/' + t.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: t.status === 'done' ? 'open' : 'done' }) });
    load();
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1a1a' }}>Tasks</h1>
        <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ height: 32, border: '0.5px solid #d0d0cc', borderRadius: 8, background: '#fff', fontSize: 13, padding: '0 8px', color: '#444' }}>
          <option value="all">All assignees</option>
          {assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <Tab label="Open" n={counts.open} on={view === 'open'} onClick={() => setView('open')} />
        <Tab label="Overdue" n={counts.overdue} on={view === 'overdue'} onClick={() => setView('overdue')} />
        <Tab label="Completed" n={counts.completed} on={view === 'completed'} onClick={() => setView('completed')} />
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Loading…</div>
          : tasks.length === 0 ? <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Nothing here.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', color: '#888', fontSize: 12 }}>
                <th style={{ padding: '10px 16px', width: 26 }}></th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Task</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Company</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Assignee</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Due</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Priority</th>
              </tr></thead>
              <tbody>
                {tasks.map(t => {
                  const done = t.status === 'done';
                  const due = fmtDue(t.due_date, t.overdue);
                  return (
                    <tr key={t.id} style={{ borderTop: '0.5px solid #eee' }}>
                      <td style={{ padding: '11px 16px' }}><input type="checkbox" checked={done} onChange={() => toggle(t)} style={{ width: 15, height: 15, accentColor: GREEN_DARK }} /></td>
                      <td style={{ padding: '11px 16px', color: done ? '#aaa' : '#1a1a1a', textDecoration: done ? 'line-through' : 'none' }}>{t.title}</td>
                      <td style={{ padding: '11px 16px', color: '#666' }}>{t.company_name || '—'}</td>
                      <td style={{ padding: '11px 16px', color: '#666' }}>{t.assignee_name || '—'}</td>
                      <td style={{ padding: '11px 16px', color: due.over ? '#9E2A1E' : '#888', fontWeight: due.over ? 500 : 400 }}>{due.text}</td>
                      <td style={{ padding: '11px 16px' }}>{done ? null : <PriorityPill priority={t.priority} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
