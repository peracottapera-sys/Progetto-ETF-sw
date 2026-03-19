import React, { useState, useEffect } from 'react';

const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

function Pill({ label, valore, unita = '', colore, sub, perf }) {
  return (
    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '9px 13px', border: '1px solid var(--border)', minWidth: 100 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: colore || 'var(--text-primary)', lineHeight: 1.2 }}>
        {valore != null ? `${valore}${unita}` : '—'}
      </div>
      {(sub || perf != null) && (
        <div style={{ fontSize: 10, marginTop: 3, color: perf != null ? (perf >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-muted)' }}>
          {perf != null ? `${perf >= 0 ? '+' : ''}${perf}% 1M` : sub}
        </div>
      )}
    </div>
  );
}

function OutlookBadge({ label, outlook }) {
  if (!outlook) return null;
  const colore = outlook.outlook?.includes('TAGLIO') || outlook.outlook?.includes('BASSO')
    ? 'var(--accent-green)'
    : outlook.outlook?.includes('RIALZO')
    ? 'var(--accent-red)'
    : 'var(--accent-amber)';
  return (
    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '9px 13px', border: `1px solid ${colore}44`, flex: 1 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: colore, marginBottom: 2 }}>{outlook.outlook}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{outlook.dettaglio}</div>
      {outlook.tassoReale != null && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
          Tasso reale: {outlook.tassoReale}%
        </div>
      )}
    </div>
  );
}

function colorVIX(v) {
  if (!v) return 'var(--text-primary)';
  if (v < 20) return 'var(--accent-green)';
  if (v < 25) return 'var(--accent-amber)';
  return 'var(--accent-red)';
}

function colorCurva(info) {
  if (!info) return 'var(--text-primary)';
  const m = { red: 'var(--accent-red)', orange: 'var(--accent-red)', amber: 'var(--accent-amber)', green: 'var(--accent-green)' };
  return m[info.colore] || 'var(--text-primary)';
}

export default function MacroPanel({ token }) {
  const [dati, setDati] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState('');
  const [lastFetch, setLastFetch] = useState(null);

  const fetchMacro = async (force = false) => {
    const oggi = new Date().toISOString().slice(0, 10);
    if (!force) {
      const cached = sessionStorage.getItem('macroData');
      const cachedDate = sessionStorage.getItem('macroDate');
      if (cached && cachedDate === oggi) {
        try { setDati(JSON.parse(cached)); setLastFetch(cachedDate); return; } catch {}
      }
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

  useEffect(() => { fetchMacro(); }, []);

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: '14px 18px', border: '1px solid var(--border)', marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13 }}>🌍 Contesto Macro</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 10 }}>
            {lastFetch ? `Aggiornato: ${lastFetch}` : 'FRED · BCE · Yahoo Finance'}
          </span>
        </div>
        <button onClick={() => fetchMacro(true)} disabled={loading}
          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 11 }}>
          {loading ? '⏳' : '🔄'}
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)', fontSize: 12 }}>Recupero dati in corso... (10-15 sec)</div>}
      {errore && <div style={{ color: 'var(--accent-red)', fontSize: 12 }}>⚠️ {errore}</div>}

      {dati && !loading && (<>

        {/* Riga 1: Volatilità e mercati */}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Volatilità e Mercati</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <Pill label="VIX" valore={dati.vix} colore={colorVIX(dati.vix)} sub={dati.vixLabel} />
          <Pill label="Euro Stoxx 50" valore={dati.stoxx50?.toLocaleString('it-IT')} perf={dati.stoxx50Perf1m} />
          <Pill label="Oro" valore={dati.gold != null ? '$' + dati.gold.toLocaleString('it-IT') : null} perf={dati.goldPerf1m} colore="var(--accent-amber)" />
          <Pill label="EUR/USD" valore={dati.eurusd} perf={dati.eurusdPerf1m}
            colore={dati.eurusd < 1.05 ? 'var(--accent-red)' : dati.eurusd > 1.15 ? 'var(--accent-green)' : 'var(--text-primary)'} />
        </div>

        {/* Riga 2: Tassi e rendimenti */}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tassi e Rendimenti</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <Pill label="Tasso Fed" valore={dati.fedFunds} unita="%" colore="var(--accent-amber)" sub="Fed Funds Rate" />
          <Pill label="Tasso BCE" valore={dati.bce} unita="%" colore="var(--accent-amber)" sub="Deposit Facility" />
          <Pill label="Treasury 10Y" valore={dati.treasury10y} unita="%" colore="var(--accent-blue)" sub="USA benchmark" />
          <Pill label="Bund 10Y" valore={dati.bund10y} unita="%" colore="var(--accent-blue)" sub="EU benchmark" />
          <Pill label="Spread BTP-Bund" valore={dati.btpBundSpread} unita="%"
            colore={dati.btpBundSpread > 2.5 ? 'var(--accent-red)' : dati.btpBundSpread > 1.5 ? 'var(--accent-amber)' : 'var(--accent-green)'}
            sub={dati.btpBundSpread > 2.5 ? '⚠️ Rischio Italia' : dati.btpBundSpread > 1.5 ? 'Attenzione' : 'Contenuto'} />
          <Pill label="Curva USA (10Y-5Y)" valore={dati.curvaUSA} unita="%"
            colore={colorCurva(dati.curvaInfo)}
            sub={dati.curvaInfo?.label + (dati.curvaInfo ? ' — ' + dati.curvaInfo.desc : '')} />
        </div>

        {/* Riga 3: Inflazione */}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Inflazione (YoY)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <Pill label="CPI USA — YoY" valore={dati.cpiUSA} unita="%"
            colore={dati.cpiUSA > 3 ? 'var(--accent-red)' : dati.cpiUSA > 2 ? 'var(--accent-amber)' : 'var(--accent-green)'}
            sub={dati.cpiUSAMoM != null ? `MoM: ${dati.cpiUSAMoM > 0 ? '+' : ''}${dati.cpiUSAMoM}%` : (dati.cpiUSA > 3 ? 'Sopra target Fed' : dati.cpiUSA > 2 ? 'Moderata' : 'Vicina al target')} />
          <Pill label="HICP EU — YoY" valore={dati.inflEU} unita="%"
            colore={dati.inflEU > 3 ? 'var(--accent-red)' : dati.inflEU > 2 ? 'var(--accent-amber)' : 'var(--accent-green)'}
            sub={dati.inflEU > 3 ? 'Sopra target BCE' : dati.inflEU > 2 ? 'Moderata' : 'Vicina al target'} />
        </div>

        {/* Riga 4: Outlook politica monetaria */}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Outlook Politica Monetaria</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <OutlookBadge label="BCE — prossime mosse" outlook={dati.stimaBCE} />
          <OutlookBadge label="Fed — prossime mosse" outlook={dati.stimaFed} />
        </div>

        {/* Implicazioni */}
        {dati.implicazioni?.length > 0 && (
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
              Implicazioni per i portafogli
            </div>
            {dati.implicazioni.map((imp, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3, display: 'flex', gap: 6 }}>
                <span style={{ color: 'var(--accent-gold)', flexShrink: 0 }}>•</span>
                <span>{imp}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, textAlign: 'right' }}>
          Fonti: FRED (Fed Reserve) · BCE · Yahoo Finance · Cache 6h · Inflazione = variazione YoY
        </div>
      </>)}
    </div>
  );
}
