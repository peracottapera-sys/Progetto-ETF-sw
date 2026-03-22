import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

const CAT_COLORE = {
  HARD:  { bg: 'rgba(192,0,0,0.08)', border: '#C00000', testo: '#C00000', label: 'HARD — Vincolo assoluto' },
  SOFT:  { bg: 'rgba(237,125,49,0.08)', border: '#ED7D31', testo: '#B45309', label: 'SOFT — Preferenza ottimizzabile' },
  MACRO: { bg: 'rgba(112,48,160,0.08)', border: '#7030A0', testo: '#7030A0', label: 'MACRO — Contesto di mercato' },
};

function SliderRow({ item, onChange }) {
  const [val, setVal] = useState(item.valore);
  const cat = CAT_COLORE[item.categoria] || CAT_COLORE.SOFT;
  const pct = ((val - item.min_val) / (item.max_val - item.min_val) * 100).toFixed(0);

  const handleChange = (e) => {
    const v = parseFloat(e.target.value);
    setVal(v);
    onChange(item.key, v);
  };

  return (
    <div style={{ padding: '8px 10px', borderRadius: 6, background: cat.bg,
      border: `1px solid ${cat.border}33`, marginBottom: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</div>
          {item.descrizione && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.4 }}>{item.descrizione}</div>
          )}
        </div>
        <input type="range" min={item.min_val} max={item.max_val} step={1} value={val}
          onChange={handleChange}
          style={{ width: 100, accentColor: cat.border, cursor: 'pointer', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: cat.testo, minWidth: 24, textAlign: 'right', flexShrink: 0 }}>{val}</span>
      </div>
    </div>
  );
}

export default function AIConfigPanel() {
  const { token } = useApp();
  const [config, setConfig] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState({});
  const [saved, setSaved] = useState(false);

  const authHdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/ai/config`, { headers: authHdr });
      const data = await res.json();
      if (data.ok) setConfig(data.config);
    } catch {}
    finally { setLoading(false); }
  };

  const handleChange = (key, valore) => {
    setModified(m => ({ ...m, [key]: valore }));
  };

  const handleSave = async () => {
    setSaving(true);
    const keys = Object.keys(modified);
    try {
      await Promise.all(keys.map(key =>
        fetch(`${API}/api/ai/config/${key}`, {
          method: 'PUT', headers: authHdr,
          body: JSON.stringify({ valore: modified[key] }),
        })
      ));
      setModified({});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await fetchConfig();
    } catch {}
    finally { setSaving(false); }
  };

  const handleReset = async () => {
    if (!window.confirm('Ripristinare tutti i pesi ai valori di default?')) return;
    setSaving(true);
    try {
      await fetch(`${API}/api/ai/config/reset`, { method: 'POST', headers: authHdr });
      setModified({});
      await fetchConfig();
    } catch {}
    finally { setSaving(false); }
  };

  const totModificate = Object.keys(modified).length;
  const byCategoria = ['HARD', 'SOFT', 'MACRO'].reduce((acc, cat) => {
    acc[cat] = config.filter(c => c.categoria === cat);
    return acc;
  }, {});

  // Totale pesi attuali
  const totPesi = config.reduce((s, c) => s + (modified[c.key] ?? c.valore), 0);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div className="card-title">⚖️ Pesi Motore AI</div>
        <div style={{ fontSize: 12, color: totPesi === 100 ? 'var(--accent-green)' : 'var(--accent-amber)',
          fontWeight: 600 }}>
          Totale: {totPesi} / 100
          {totPesi !== 100 && <span style={{ fontSize: 10, marginLeft: 4 }}>⚠️ non sommano 100</span>}
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
        Pesi relativi delle regole AI. HARD = vincolo assoluto; il peso influenza l'enfasi nei suggerimenti.
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Caricamento...</div>}

      {!loading && Object.entries(byCategoria).map(([cat, items]) => {
        if (!items.length) return null;
        const c = CAT_COLORE[cat];
        return (
          <div key={cat} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.testo, textTransform: 'uppercase',
              letterSpacing: '0.06em', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span>{cat}</span>
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                {items.reduce((s, i) => s + (modified[i.key] ?? i.valore), 0)} pt
              </span>
            </div>
            {items.map(item => (
              <SliderRow key={item.key} item={{ ...item, valore: modified[item.key] ?? item.valore }}
                onChange={handleChange} />
            ))}
          </div>
        );
      })}

      {!loading && (
        <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={handleSave}
            disabled={saving || totModificate === 0}
            style={{ opacity: totModificate === 0 ? 0.5 : 1 }}>
            {saving ? '⏳ Salvando...' : `💾 Salva${totModificate > 0 ? ` (${totModificate} modifiche)` : ''}`}
          </button>
          <button className="btn btn-ghost" onClick={handleReset} disabled={saving}>
            🔄 Ripristina default
          </button>
          {saved && <span style={{ fontSize: 12, color: 'var(--accent-green)' }}>✓ Salvato!</span>}
        </div>
      )}
    </div>
  );
}
