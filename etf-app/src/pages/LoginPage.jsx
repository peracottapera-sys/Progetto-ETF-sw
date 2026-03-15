import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function LoginPage() {
  const { login, register, dbStatus } = useApp();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', email: '', newPwd: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

const handleLogin = async () => {
    setError('');
    if (!form.username || !form.password) { setError('Inserisci username e password'); return; }
    setLoading(true);
    const res = await login(form.username, form.password);
    setLoading(false);
    if (!res.ok) setError(res.error);
  };

  const handleRegister = async () => {
    setError('');
    if (!form.username || !form.password) { setError('Username e password obbligatori'); return; }
    if (form.password.length < 6) { setError('La password deve essere almeno 6 caratteri'); return; }
    setLoading(true);
    const res = await register(form.username, form.password, form.email);
    setLoading(false);
    if (!res.ok) setError(res.error);
  };

  const handleReset = () => {
    setError(''); setInfo('');
    if (!form.username || !form.newPwd) { setError('Inserisci username e nuova password'); return; }
    setInfo('Password aggiornata! Accedi ora.');
    setMode('login');
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)', position: 'relative', overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(201,168,76,0.04) 0%, transparent 70%)',
        pointerEvents: 'none'
      }} />
      <div style={{ width: 420, position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56, height: 56, borderRadius: '14px',
            background: 'var(--accent-gold-dim)', border: '1px solid var(--border-strong)',
            marginBottom: 16
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-gold)" strokeWidth="1.5">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
          </div>
          <h1 style={{ fontFamily: 'DM Serif Display, serif', fontSize: 28, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
            ETF Portfolio
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
            Gestione intelligente dei tuoi investimenti
          </p>
        </div>

        <div className="card" style={{ padding: 32 }}>
         <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: dbStatus === 'online' ? 'var(--accent-green)' : dbStatus === 'offline' ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
              {dbStatus === 'online' ? '🟢 DB Server' : dbStatus === 'offline' ? '🟡 Modalità Locale' : '⏳ Connessione...'}
            </span>
          </div>
          <div className="tabs" style={{ marginBottom: 24 }}>
            <button className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(''); setInfo(''); }}>Accedi</button>
            <button className={`tab ${mode === 'register' ? 'active' : ''}`} onClick={() => { setMode('register'); setError(''); setInfo(''); }}>Registrati</button>
            <button className={`tab ${mode === 'resetpwd' ? 'active' : ''}`} onClick={() => { setMode('resetpwd'); setError(''); setInfo(''); }}>Reset Password</button>
          </div>

          {error && <div className="alert alert-warning" style={{ marginBottom: 16 }}>⚠ {error}</div>}
          {info && <div className="alert alert-success" style={{ marginBottom: 16 }}>✓ {info}</div>}

          {mode === 'login' && (
            <>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input className="input" placeholder="Il tuo username" value={form.username}
                  onChange={e => set('username', e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()} />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="input" type="password" placeholder="••••••••" value={form.password}
                  onChange={e => set('password', e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()} />
              </div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: 12, marginTop: 8 }} onClick={handleLogin} disabled={loading}>
                {loading ? '⏳ Accesso...' : 'Accedi'}
              </button>
              <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 16 }}>
                Demo: username <strong style={{color:'var(--text-secondary)'}}>demo</strong> / password <strong style={{color:'var(--text-secondary)'}}>demo123</strong>
              </p>
            </>
          )}

          {mode === 'register' && (
            <>
              <div className="form-group">
                <label className="form-label">Username *</label>
                <input className="input" placeholder="Scegli un username" value={form.username} onChange={e => set('username', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Password * <span style={{color:'var(--text-muted)', fontSize:11}}>(min. 6 caratteri)</span></label>
                <input className="input" type="password" placeholder="••••••••" value={form.password} onChange={e => set('password', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Email <span style={{color:'var(--text-muted)', fontSize:11}}>(opzionale)</span></label>
                <input className="input" type="email" placeholder="tua@email.com" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: 12, marginTop: 8 }} onClick={handleRegister} disabled={loading}>
                {loading ? '⏳ Creazione...' : 'Crea Account'}
              </button>
            </>
          )}

          {mode === 'resetpwd' && (
            <>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input className="input" placeholder="Il tuo username" value={form.username} onChange={e => set('username', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Nuova Password</label>
                <input className="input" type="password" placeholder="Nuova password" value={form.newPwd} onChange={e => set('newPwd', e.target.value)} />
              </div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: 12, marginTop: 8 }} onClick={handleReset}>
                Imposta Nuova Password
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}