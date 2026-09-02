import React, { useState, useEffect } from 'react';
import { SB } from '../brand.js';

// StaffAccess — Studio staff accounts + per-section access (super-admin only).
//
// Talks to /api/admin-users (all super-admin-gated on the server). The current
// signed-in user is passed in as `user` so we can show the "you" row and keep
// the screen sensible if a non-super somehow lands here. Passwords are shown
// exactly once after create/reset — bcrypt on the server means there's no
// "reveal existing password" path by design.

const GREEN = SB.primary;
const GREEN_DARK = SB.strong;
const BG = '#f5f5f3';

const card = { background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 10 };
const btnPrimary = { background: GREEN, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 500, fontSize: 13, cursor: 'pointer' };
const btnGhost = { background: '#fff', color: '#444', border: '0.5px solid #d0d0cc', padding: '7px 14px', borderRadius: 8, fontWeight: 500, fontSize: 13, cursor: 'pointer' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #d0d0cc', borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff' };
const label = { display: 'block', fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 5 };

export default function StaffAccess({ user }) {
  const isSuper = !user || user.is_super || user.access === 'ALL';

  const [users, setUsers] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState(null);     // staff row being edited, or 'new', or null
  const [resetting, setResetting] = useState(null);  // staff row whose password we're resetting
  const [tempPw, setTempPw] = useState(null);        // { name, password } — one-time reveal

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/admin-users');
      if (!r.ok) throw new Error('load failed');
      const d = await r.json();
      setUsers(d.users || []);
      setSections(d.sections || []);
      setError('');
    } catch (e) {
      setError('Could not load staff. Make sure the latest backend is deployed.');
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function removeUser(u) {
    if (!window.confirm(`Remove ${u.username}? They will no longer be able to sign in.`)) return;
    await fetch(`/api/admin-users/${u.id}`, { method: 'DELETE' });
    load();
  }

  function accessSummary(u) {
    if (u.disabled) return { text: 'Disabled', color: '#A32D2D', bg: '#FCEBEB' };
    if (u.is_super) return { text: 'Full admin', color: GREEN_DARK, bg: SB.tint };
    const n = Object.keys(u.access || {}).length;
    return { text: `${n} section${n === 1 ? '' : 's'}`, color: '#555', bg: '#f0f0ec' };
  }

  if (!isSuper) {
    return (
      <div style={{ flex: 1, padding: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1a1a' }}>Staff &amp; access</h1>
        <div style={{ ...card, padding: 32, marginTop: 16, color: '#666' }}>This page is only available to a full administrator.</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1a1a' }}>Staff &amp; access</h1>
        <button style={btnPrimary} onClick={() => setEditing('new')}>+ Add staff</button>
      </div>
      <div style={{ fontSize: 13, color: '#777', marginBottom: 20 }}>
        Create logins for your team and tick which sections each person can see. You always have full access.
      </div>

      {error && <div style={{ ...card, padding: 16, marginBottom: 16, color: '#A32D2D', background: '#FCEBEB', border: '0.5px solid #F09595' }}>{error}</div>}

      {/* You row */}
      <div style={{ ...card, padding: '14px 18px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a' }}>{user ? user.username : 'You'} <span style={{ fontSize: 12, color: '#888', fontWeight: 400 }}>— you</span></div>
          <div style={{ fontSize: 12, color: '#888' }}>Your master login. Full access, can never be locked out.</div>
        </div>
        <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 8, background: SB.tint, color: GREEN_DARK, fontWeight: 500 }}>Full admin</span>
      </div>

      {/* Staff table */}
      <div style={{ ...card, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Loading…</div>
        ) : users.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>No staff accounts yet. Click “Add staff” to create the first one.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#888', fontSize: 12 }}>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Email</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Access</th>
                <th style={{ padding: '10px 16px', fontWeight: 500 }}>Last sign-in</th>
                <th style={{ padding: '10px 16px', fontWeight: 500, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const s = accessSummary(u);
                return (
                  <tr key={u.id} style={{ borderTop: '0.5px solid #eee' }}>
                    <td style={{ padding: '11px 16px', color: '#1a1a1a' }}>{u.username}</td>
                    <td style={{ padding: '11px 16px', color: '#666' }}>{u.email || '—'}</td>
                    <td style={{ padding: '11px 16px' }}><span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 8, background: s.bg, color: s.color, fontWeight: 500 }}>{s.text}</span></td>
                    <td style={{ padding: '11px 16px', color: '#888' }}>{u.last_login_at ? new Date(u.last_login_at.replace(' ', 'T') + 'Z').toLocaleString('en-GB') : 'Never'}</td>
                    <td style={{ padding: '11px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button style={{ ...btnGhost, padding: '5px 10px', marginLeft: 6 }} onClick={() => setEditing(u)}>Edit</button>
                      <button style={{ ...btnGhost, padding: '5px 10px', marginLeft: 6 }} onClick={() => setResetting(u)}>Reset password</button>
                      <button style={{ ...btnGhost, padding: '5px 10px', marginLeft: 6, color: '#A32D2D', borderColor: '#F0997B' }} onClick={() => removeUser(u)}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <StaffModal
          mode={editing === 'new' ? 'new' : 'edit'}
          staff={editing === 'new' ? null : editing}
          sections={sections}
          onClose={() => setEditing(null)}
          onSaved={(result) => { setEditing(null); load(); if (result && result.password) setTempPw({ name: result.user.username, password: result.password }); }}
        />
      )}

      {resetting && (
        <ResetModal
          staff={resetting}
          onClose={() => setResetting(null)}
          onDone={(pw) => { setResetting(null); setTempPw({ name: resetting.username, password: pw }); }}
        />
      )}

      {tempPw && <TempPasswordModal name={tempPw.name} password={tempPw.password} onClose={() => setTempPw(null)} />}
    </div>
  );
}

// ── Add / edit modal ──────────────────────────────────────────────────────────
function StaffModal({ mode, staff, sections, onClose, onSaved }) {
  const [username, setUsername] = useState(staff ? staff.username : '');
  const [email, setEmail] = useState(staff ? (staff.email || '') : '');
  const [password, setPassword] = useState('');
  const [isSuper, setIsSuper] = useState(staff ? !!staff.is_super : false);
  const [disabled, setDisabled] = useState(staff ? !!staff.disabled : false);
  const [access, setAccess] = useState(() => ({ ...(staff && staff.access ? staff.access : {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // group sections preserving order
  const groups = [];
  for (const sec of sections) {
    let g = groups.find(x => x.name === sec.group);
    if (!g) { g = { name: sec.group, items: [] }; groups.push(g); }
    g.items.push(sec);
  }

  function toggle(key) {
    setAccess(a => { const n = { ...a }; if (n[key]) delete n[key]; else n[key] = true; return n; });
  }

  async function save() {
    if (!username.trim()) { setErr('Username is required'); return; }
    if (mode === 'new' && password && password.length < 8) { setErr('Password must be at least 8 characters'); return; }
    setBusy(true); setErr('');
    try {
      const body = { username: username.trim(), email: email.trim(), is_super: isSuper, access };
      let res;
      if (mode === 'new') {
        if (password) body.password = password;
        res = await fetch('/api/admin-users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        body.disabled = disabled;
        res = await fetch(`/api/admin-users/${staff.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save'); setBusy(false); return; }
      onSaved(d);
    } catch {
      setErr('Could not reach the server'); setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ fontSize: 16, fontWeight: 500, color: '#1a1a1a', marginBottom: 16 }}>{mode === 'new' ? 'Add staff member' : `Edit ${staff.username}`}</div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={label}>Name / username</label>
          <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)} autoFocus />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={label}>Email (optional)</label>
          <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} />
        </div>
      </div>

      {mode === 'new' && (
        <div style={{ marginBottom: 14 }}>
          <label style={label}>Password (leave blank to auto-generate)</label>
          <input style={inputStyle} type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="Auto-generate" />
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', border: '1px solid #d0d0cc', borderRadius: 8, marginBottom: 14, fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={isSuper} onChange={e => setIsSuper(e.target.checked)} style={{ accentColor: GREEN_DARK, width: 16, height: 16 }} />
        <span style={{ fontWeight: 500 }}>Full admin — sees everything (turns all tickboxes on)</span>
      </label>

      <div style={{ opacity: isSuper ? 0.45 : 1, pointerEvents: isSuper ? 'none' : 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        {groups.map(g => (
          <div key={g.name} style={{ border: '0.5px solid #e0e0dc', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{g.name}</div>
            {g.items.map(it => (
              <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0', fontSize: 13, color: '#333', cursor: 'pointer' }}>
                <input type="checkbox" checked={isSuper || !!access[it.key]} onChange={() => toggle(it.key)} style={{ accentColor: GREEN_DARK, width: 15, height: 15 }} />
                {it.label}
              </label>
            ))}
          </div>
        ))}
      </div>

      {mode === 'edit' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, fontSize: 13, color: '#A32D2D', cursor: 'pointer' }}>
          <input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} style={{ accentColor: '#A32D2D', width: 15, height: 15 }} />
          Disable this account (blocks sign-in, keeps the record)
        </label>
      )}

      {err && <div style={{ color: '#c0392b', fontSize: 13, marginTop: 12 }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button style={btnGhost} onClick={onClose}>Cancel</button>
        <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : (mode === 'new' ? 'Create staff member' : 'Save changes')}</button>
      </div>
    </Overlay>
  );
}

// ── Reset-password modal ────────────────────────────────────────────────────
function ResetModal({ staff, onClose, onDone }) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(useRandom) {
    if (!useRandom && pw && pw.length < 8) { setErr('Password must be at least 8 characters'); return; }
    setBusy(true); setErr('');
    try {
      const body = useRandom ? {} : { new_password: pw };
      const res = await fetch(`/api/admin-users/${staff.id}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not reset'); setBusy(false); return; }
      onDone(d.password);
    } catch {
      setErr('Could not reach the server'); setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose} width={420}>
      <div style={{ fontSize: 16, fontWeight: 500, color: '#1a1a1a', marginBottom: 6 }}>Reset password — {staff.username}</div>
      <div style={{ fontSize: 13, color: '#777', marginBottom: 16 }}>Set a new password, or generate a random one. This signs them out everywhere.</div>
      <label style={label}>New password</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <input style={{ ...inputStyle, flex: 1 }} type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 8 characters" autoFocus />
        <button style={btnGhost} onClick={() => setShow(s => !s)}>{show ? 'Hide' : 'Show'}</button>
      </div>
      <button style={{ background: 'none', border: 'none', color: GREEN, fontSize: 12, padding: 0, cursor: 'pointer' }} onClick={() => submit(true)}>Generate random instead</button>
      {err && <div style={{ color: '#c0392b', fontSize: 13, marginTop: 12 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button style={btnGhost} onClick={onClose}>Cancel</button>
        <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => submit(false)}>{busy ? 'Saving…' : 'Set password'}</button>
      </div>
    </Overlay>
  );
}

// ── One-time password reveal ────────────────────────────────────────────────
function TempPasswordModal({ name, password, onClose }) {
  const [copied, setCopied] = useState(false);
  function copy() { try { navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }
  return (
    <Overlay onClose={onClose} width={420}>
      <div style={{ fontSize: 16, fontWeight: 500, color: '#1a1a1a', marginBottom: 6 }}>Password for {name}</div>
      <div style={{ fontSize: 13, color: '#777', marginBottom: 16 }}>This is the only time you'll see this password. Copy it now and give it to {name}.</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <code style={{ flex: 1, padding: '11px 12px', background: '#f5f5f3', border: '0.5px solid #d0d0cc', borderRadius: 8, fontSize: 15, letterSpacing: '0.02em', wordBreak: 'break-all' }}>{password}</code>
        <button style={btnGhost} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button style={btnPrimary} onClick={onClose}>Done</button>
      </div>
    </Overlay>
  );
}

// ── Shared overlay (normal-flow, not position:fixed, so it sizes correctly) ──
function Overlay({ children, onClose, width = 640 }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 26, width: `min(${width}px, 94vw)`, maxHeight: '88vh', overflow: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
        {children}
      </div>
    </div>
  );
}
