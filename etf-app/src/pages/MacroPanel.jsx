import React, { useState, useEffect } from 'react';

const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

function Indicatore({ label, valore, unita = '', colore, sub }) {
  return (
    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)', minWidth: 110 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: colore || 'var(--text-primary)' }}>
        {valore != null ? `${valore}${unita}` : '—'}
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function colorVIX(v) {
  if (!v) return 'var(--text-primary)';
  if (v < 15) return 'var(--accent-green)';
  if (v < 20) return 'var(--accent-green)';
  if (v < 25) return 'var(--accent-amber)';
  if (v < 35) return 'var(--accent-red)';
  return '#ff4444';
}

function colorPerf(v) {
  if (!v) return 'var(--text-primary)';
  return v >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
}

export default function MacroPanel({ token }) {
  const [dati, setDati] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState('');
  const [lastFetch, setLastFetch] = useState(null);

  const fetchMacro = async (force = false) => {
    // Usa cache locale per la giornata (non rifetcha se già fatto oggi)
    const oggi = new Date().toISOString().slice(0, 10);
    const cached = sessionStorage.getItem('macroData');
    const cachedDate = sessionStorage.getItem('macroDate');
    if (!force && cached && cachedDate === oggi) {
      setDati(JSON.parse(cached));
      setLastFetch(cachedDate);
      return;
    }

    setLoading(true);
    setErrore('');
    try {
      const res = await fetch(`${API}/api/macro/context`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.ok && data.dati) {
        setDati(data.dati);
        setLastFetch(oggi);
        sessionStorage.setItem('macroData', JSON.stringify(data.dati));
        sessionStorage.setItem('macroDate', oggi);
      } else {
        setErrore('Dati non disponibili');
      }
    } catch {
      setErrore('Errore nel recupero dati macro');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMacro();
  }, []);

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: '16px 18px', border: '1px solid var(--border)', marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🌍</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Contesto Macro</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {lastFetch ? `Aggiornato: ${lastFetch}` : 'Fonti: FRED, BCE, Yahoo Finance'}
            </div>
          </div>
        </div>
        <button onClick={() => fetchMacro(true)} disabled={loading}
          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12 }}>
          {loading ? '⏳' : '🔄 Aggiorna'}
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Recupero dati in corso...
        </div>
      )}

      {errore && (
        <div style={{ color: 'var(--accent-red)', fontSize: 13, padding: '8px 0' }}>⚠️ {errore}</div>
      )}

      {dati && !loading && (
        <>
          {/* Indicatori principali */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Indicatore label="VIX" valore={dati.vix} colore={colorVIX(dati.vix)}
              sub={dati.vix > 25 ? '⚠️ Elevato' : dati.vix > 20 ? '⚡ Moderato' : '✓ Basso'} />
            <Indicatore label="S&P 500" valore={dati.sp500?.toLocaleString('it-IT')}
              sub={dati.sp500Perf1m != null ? `1M: ${dati.sp500Perf1m > 0 ? '+' : ''}${dati.sp500Perf1m}%` : ''}
              colore={colorPerf(dati.sp500Perf1m)} />
            <Indicatore label="Treasury 10Y" valore={dati.treasury10y} unita="%" colore="var(--accent-blue)"
              sub="Rendimento USA" />
            <Indicatore label="Tasso Fed" valore={dati.fedFunds} unita="%" colore="var(--accent-amber)"
              sub="Fed Funds Rate" />
            <Indicatore label="Tasso BCE" valore={dati.bce} unita="%" colore="var(--accent-amber)"
              sub="Deposit Facility" />
            <Indicatore label="Inflazione USA" valore={dati.cpiUSA} unita="%" colore={dati.cpiUSA > 3 ? 'var(--accent-red)' : 'var(--text-primary)'}
              sub="CPI YoY" />
            <Indicatore label="Inflazione EU" valore={dati.inflEU} unita="%" colore={dati.inflEU > 3 ? 'var(--accent-red)' : 'var(--text-primary)'}
              sub="HICP YoY" />
          </div>

          {/* Implicazioni per profilo */}
          {dati.implicazioni?.length > 0 && (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                IMPLICAZIONI PER I PORTAFOGLI
              </div>
              {dati.implicazioni.map((imp, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3, display: 'flex', gap: 6 }}>
                  <span style={{ color: 'var(--accent-gold)', flexShrink: 0 }}>•</span>
                  <span>{imp}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, textAlign: 'right' }}>
            Fonti: Federal Reserve (FRED) · BCE · Yahoo Finance · Cache aggiornata ogni 6 ore
          </div>
        </>
      )}
    </div>
  );
}
