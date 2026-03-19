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
      {outlook.avvertenza && (
        <div style={{ fontSize: 11, color: 'var(--accent-amber)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
          ⚠️ {outlook.avvertenza}
        </div>
      )}
      {outlook.tassoReale != null && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
          📊 Tasso reale (nominale − inflazione): <strong>{outlook.tassoReale}%</strong>
          <span style={{ marginLeft: 6, color: outlook.tassoReale > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
            {outlook.tassoReale > 1 ? '— politica restrittiva' : outlook.tassoReale > 0 ? '— lievemente restrittiva' : '— politica accomodante'}
          </span>
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
  const [tab, setTab] = useState('indicatori'); // 'indicatori' | 'paesi'

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
        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          {[['indicatori','📊 Indicatori'],['paesi','🌐 Paesi']].map(([t,l]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: tab === t ? 700 : 400,
                background: tab === t ? 'var(--accent-blue)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--text-muted)' }}>
              {l}
            </button>
          ))}
        </div>

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
          <Pill label="Inflazione USA (CPI)" valore={dati.cpiUSA} unita="%"
            colore={dati.cpiUSA > 3 ? 'var(--accent-red)' : dati.cpiUSA > 2 ? 'var(--accent-amber)' : 'var(--accent-green)'}
            sub={dati.cpiUSA > 3 ? 'Sopra target Fed' : dati.cpiUSA > 2 ? 'Moderata' : 'Vicina al target'} />
          <Pill label="Inflazione EU (HICP)" valore={dati.inflEU} unita="%"
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

        {tab === 'indicatori' && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, textAlign: 'right' }}>
          Fonti: FRED · BCE · Yahoo Finance · Cache 6h · Inflazione EU: {dati.inflEUSource || 'FRED'}
        </div>
        )}

        {/* Tab Paesi */}
        {tab === 'paesi' && dati.paesiMacro && (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
              Dati macroeconomici principali paesi · Fonte: Trading Economics · Aggiornamento: mensile
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Paese','PIL (Mld$)','Crescita %','Tasso %','Inflazione %','Disoccupaz. %','Debito/PIL %'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Paese' ? 'left' : 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dati.paesiMacro.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>{p.paese}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{p.pil?.toLocaleString('it-IT')}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: p.crescita > 1 ? 'var(--accent-green)' : p.crescita < 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{p.crescita}%</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: p.tasso > 5 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{p.tasso}%</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: p.inflazione > 3 ? 'var(--accent-red)' : p.inflazione > 2 ? 'var(--accent-amber)' : 'var(--accent-green)' }}>{p.inflazione}%</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: p.disoccupazione > 8 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{p.disoccupazione}%</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: p.debito > 120 ? 'var(--accent-red)' : p.debito > 90 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>{p.debito}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>)}
    </div>
  );
}
