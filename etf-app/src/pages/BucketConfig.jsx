import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

const RENDIMENTO_MIN = { Prudente: 3.5, Bilanciato: 4.5, Aggressivo: 6.0 };
const RENDIMENTO_MAX = { Prudente: 5.5, Bilanciato: 7.0, Aggressivo: 10.0 };

export default function BucketConfig({ portfolioId, riskProfile, onUpdate }) {
  const { token } = useApp();
  const [buckets, setBuckets] = useState(null);
  const [attivo, setAttivo] = useState(false);
  const [form, setForm] = useState({
    pctBreve: 30, anniBreve: 3, rendBreve: '',
    pctLungo: 70, anniLungo: 10, rendLungo: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const authHdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const rendMin = RENDIMENTO_MIN[riskProfile] || 4.0;
  const rendMax = RENDIMENTO_MAX[riskProfile] || 7.0;

  useEffect(() => { fetchBuckets(); }, [portfolioId]);

  const fetchBuckets = async () => {
    try {
      const res = await fetch(`${API}/api/portfolios/${portfolioId}/buckets`, { headers: authHdr });
      const data = await res.json();
      if (Array.isArray(data) && data.length >= 2) {
        setBuckets(data);
        setAttivo(true);
        const b = data.find(b => b.tipo === 'BREVE');
        const l = data.find(b => b.tipo === 'LUNGO');
        if (b && l) setForm({
          pctBreve: b.pct_allocazione, anniBreve: b.orizzonte_anni, rendBreve: b.rendimento_target_annuo || '',
          pctLungo: l.pct_allocazione, anniLungo: l.orizzonte_anni, rendLungo: l.rendimento_target_annuo || '',
        });
      } else {
        setBuckets([]);
        setAttivo(false);
      }
    } catch {}
  };

  const rendPesato = () => {
    const b = parseFloat(form.rendBreve) || rendMin * 0.6;
    const l = parseFloat(form.rendLungo) || rendMin * 1.3;
    return ((form.pctBreve / 100) * b + (form.pctLungo / 100) * l).toFixed(2);
  };

  const rendOk = () => parseFloat(rendPesato()) >= rendMin;

  const handlePctBreve = (v) => {
    const n = Math.min(80, Math.max(10, parseInt(v) || 10));
    setForm(f => ({ ...f, pctBreve: n, pctLungo: 100 - n }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${API}/api/portfolios/${portfolioId}/buckets`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({
          buckets: [
            { tipo: 'BREVE', pct_allocazione: form.pctBreve, orizzonte_anni: form.anniBreve, rendimento_target_annuo: parseFloat(form.rendBreve) || null },
            { tipo: 'LUNGO', pct_allocazione: form.pctLungo, orizzonte_anni: form.anniLungo, rendimento_target_annuo: parseFloat(form.rendLungo) || null },
          ]
        })
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await fetchBuckets();
      onUpdate?.();
    } catch {}
    finally { setSaving(false); }
  };

  const handleDisattiva = async () => {
    if (!window.confirm('Disattivare la strategia a due bucket? Gli ETF manterranno le etichette esistenti.')) return;
    await fetch(`${API}/api/portfolios/${portfolioId}/buckets`, {
      method: 'POST', headers: authHdr, body: JSON.stringify({ buckets: [] })
    });
    setBuckets([]); setAttivo(false);
  };

  const rp = parseFloat(rendPesato());
  const rpOk = rp >= rendMin;
  const targetLungoMin = form.rendBreve
    ? ((rendMin - (form.pctBreve / 100) * parseFloat(form.rendBreve)) / (form.pctLungo / 100)).toFixed(1)
    : null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="card-title">🪣 Strategia Bucket</div>
        {attivo && (
          <button onClick={handleDisattiva} style={{ fontSize: 10, color: 'var(--text-muted)',
            background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Disattiva
          </button>
        )}
      </div>

      {!attivo ? (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Dividi il portafoglio in due bucket con orizzonti diversi: <strong>BREVE</strong> (liquidità/obblig.) e <strong>LUNGO</strong> (crescita/azionario). Il rendimento medio pesato non deve mai scendere sotto il minimo del profilo ({rendMin}% annuo).
          </div>
          <button className="btn btn-secondary" style={{ fontSize: 12, width: '100%' }}
            onClick={() => setAttivo(true)}>
            ⚙️ Configura strategia bucket
          </button>
        </div>
      ) : (
        <div>
          {/* Slider allocazione */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>🔵 BREVE: {form.pctBreve}%</span>
              <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>🟡 LUNGO: {form.pctLungo}%</span>
            </div>
            <input type="range" min={10} max={80} step={5} value={form.pctBreve}
              onChange={e => handlePctBreve(e.target.value)}
              style={{ width: '100%', accentColor: 'var(--accent-blue)' }} />
          </div>

          {/* Parametri BREVE */}
          <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 8 }}>
              🔵 Bucket BREVE — {form.pctBreve}% del capitale
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Orizzonte (anni)</div>
                <input className="input" type="number" min={1} max={5} value={form.anniBreve}
                  onChange={e => setForm(f => ({ ...f, anniBreve: parseInt(e.target.value) || 1 }))}
                  style={{ fontSize: 12, padding: '4px 8px' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Target rend. annuo (%)</div>
                <input className="input" type="number" step={0.1} placeholder={`min ${rendMin}`}
                  value={form.rendBreve}
                  onChange={e => setForm(f => ({ ...f, rendBreve: e.target.value }))}
                  style={{ fontSize: 12, padding: '4px 8px' }} />
              </div>
            </div>
          </div>

          {/* Parametri LUNGO */}
          <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-amber)', marginBottom: 8 }}>
              🟡 Bucket LUNGO — {form.pctLungo}% del capitale
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Orizzonte (anni)</div>
                <input className="input" type="number" min={5} max={30} value={form.anniLungo}
                  onChange={e => setForm(f => ({ ...f, anniLungo: parseInt(e.target.value) || 5 }))}
                  style={{ fontSize: 12, padding: '4px 8px' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Target rend. annuo (%)</div>
                <input className="input" type="number" step={0.1} placeholder={`es. ${rendMax}`}
                  value={form.rendLungo}
                  onChange={e => setForm(f => ({ ...f, rendLungo: e.target.value }))}
                  style={{ fontSize: 12, padding: '4px 8px' }} />
              </div>
            </div>
          </div>

          {/* Rendimento complessivo */}
          <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12,
            background: rpOk ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${rpOk ? 'var(--accent-green)' : 'var(--accent-red)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Rendimento medio pesato atteso
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: rpOk ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {rp}% {rpOk ? '✓' : '⚠️'}
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
              {rpOk
                ? `Sopra il minimo del profilo ${riskProfile} (${rendMin}%)`
                : `Sotto il minimo del profilo ${riskProfile} (${rendMin}%). ${targetLungoMin ? `Il bucket LUNGO deve rendere almeno ${targetLungoMin}%` : ''}`
              }
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}
              style={{ flex: 1, fontSize: 12 }}>
              {saving ? '⏳' : '💾 Salva configurazione'}
            </button>
            {saved && <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>✓ Salvato</span>}
          </div>
        </div>
      )}
    </div>
  );
}
