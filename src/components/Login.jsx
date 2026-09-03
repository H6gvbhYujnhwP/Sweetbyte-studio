import React, { useState } from 'react';
import { SB, BRAND_NAME } from '../brand.js';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password })
      });

      if (res.ok) {
        const { token } = await res.json();
        onLogin(token);
      } else {
        setError('Incorrect username or password');
      }
    } catch {
      setError('Could not reach server — try again');
    }

    setLoading(false);
  }

  const inputStyle = (hasError) => ({
    width: '100%', padding: '10px 12px', boxSizing: 'border-box',
    border: `1px solid ${hasError ? '#e74c3c' : '#d0d0cc'}`,
    borderRadius: 8, outline: 'none', fontSize: 14, background: '#fff',
    transition: 'border-color 0.15s'
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f3' }}>
      <div style={{ background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 12, padding: '40px 36px', width: 360, boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <div style={{ width: 36, height: 36, background: '#fff', border: `0.5px solid ${SB.tint}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 3, boxSizing: 'border-box' }}>
            <img src="/sweetbyte-logo.png" alt={BRAND_NAME} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: SB.darkest }}>{BRAND_NAME}</div>
            <div style={{ fontSize: 12, color: '#888' }}>Studio</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} autoComplete="on">
          {/* Username */}
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 6 }}>
            Username
          </label>
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Username"
            required
            autoFocus
            style={{ ...inputStyle(!!error), marginBottom: 14 }}
            onFocus={e => { if (!error) e.target.style.borderColor = SB.primary; }}
            onBlur={e  => { e.target.style.borderColor = error ? '#e74c3c' : '#d0d0cc'; }}
          />

          {/* Password */}
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 6 }}>
            Password
          </label>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            required
            style={{ ...inputStyle(!!error), marginBottom: 14 }}
            onFocus={e => { if (!error) e.target.style.borderColor = SB.primary; }}
            onBlur={e  => { e.target.style.borderColor = error ? '#e74c3c' : '#d0d0cc'; }}
          />

          {error && (
            <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 12 }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            style={{
              width: '100%', background: loading ? SB.light : SB.primary,
              color: SB.onPrimary, border: 'none', padding: '11px',
              borderRadius: 8, fontWeight: 600, fontSize: 14,
              cursor: loading || !username || !password ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s'
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
