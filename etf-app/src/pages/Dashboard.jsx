import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import AcquistoModal from './modals/AcquistoModal';
import VenditaModal from './modals/VenditaModal';
import AIModal from './modals/AIModal';
import CreaPortafoglioModal from './modals/CreaPortafoglioModal';

const API = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  || process.env?.REACT_APP_API_URL
  || 'http://localhost:3001';

export default function Dashboard() {
  const { currentPortfolio, toggleEtfSelection, aggiornaPrezziBatch, token, loadPortfoliosFromDB, currentUser, pendingAIResult, setPendingAIResult } = useApp();
  const [sortKey, setSortKey] = useState('tipo');
  const [sortDir, setSortDir] = useState(1);
  const [filter, setFilter] = useState('tutte');
  const [acquistoEtf, setAcquistoEtf] = useState(null);
  const [venditaEtf, setVenditaEtf] = useState(null);
  const [aggiornando, setAggiornando] = useState(false);
  const [msgAggiornamento, setMsgAggiornamento] = useState('');
  const [showAI, setShowAI] = useState(false);
  const [showCrea, setShowCrea] = useState(false);
  const [pendingData, setPendingData] = useState(null);

  // Apri automaticamente il modal con il risultato AI proveniente dal PortfolioSelector
  React.useEffect(() => {
    if (pendingAIResult && currentPortfolio && pendingAIResult.portfolioId === currentPortfolio.id) {
      setPendingData(pendingAIResult);
      setShowCrea(true);
      setPendingAIResult(null);
    }
  }, [pendingAIResult, currentPortfolio]);

  if (!currentPortfolio) return null;

  const { etfs, id: portfolioId, riskProfile, name, maxUSA } = currentPortfolio;

  const handleAggiornaPressi = async () => {
    setAggiornando(true);
    setMsgAggiornamento('');
    const res = await aggiornaPrezziBatch(portfolioId);
    setAggiornando(false);
    if (res.ok) setMsgAggiornamento(`✓ Aggiornati ${res.trovati}/${res.totale} ETF`);
    else setMsgAggiornamento(`⚠ ${res.error}`);
    setTimeout(() => setMsgAggiornamento(''), 5000);
  };

  // Ordine tipo: consigliato → alternativa1 → alternativa2
  const tipoOrdine = { consigliato: 0, alternativa1: 1, alternativa2: 2 };

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(1); }
  };
  const sortArrow = (key) => sortKey === key ? (sortDir === 1 ? ' ↑' : ' ↓') : '';

  const filtered = etfs
    .filter(e => {
      if (filter === 'selezionate') return e.selected && e.tipo !== 'venduto';
      if (filter === 'non-selezionate') return !e.selected && e.tipo !== 'venduto';
      if (filter === 'chiusi') return e.tipo === 'venduto';
      return e.tipo !== 'venduto'; // tab 'tutte' esclude i chiusi
    })
    .sort((a, b) => {
      const map = { nome: 'name', ter: 'ter', p1m: 'perf1m', p6m: 'perf6m', p1y: 'perf1y', p5y: 'perf5y', cap: 'capitalizzazione', quotazione: 'quotazione' };
      if (sortKey === 'tipo') {
        // tipo: consigliato → alt1 → alt2, poi selezionati prima dentro ogni gruppo
        const diffTipo = (tipoOrdine[a.tipo] ?? 9) - (tipoOrdine[b.tipo] ?? 9);
        if (diffTipo !== 0) return diffTipo * sortDir;
        // secondario: selezionati prima
        if (a.selected !== b.selected) return a.selected ? -1 : 1;
        return 0;
      }
      // Per tutti gli altri sort: applica sort puro senza override "selezionati prima"
      const k = map[sortKey] || sortKey;
      if (typeof a[k] === 'string') return a[k].localeCompare(b[k]) * sortDir;
      return ((a[k] || 0) - (b[k] || 0)) * sortDir;
    });

  const selectedEtfs = etfs.filter(e => e.selected);
  const totalTer = selectedEtfs.length > 0 ? selectedEtfs.reduce((s, e) => s + e.ter, 0) / selectedEtfs.length : 0;
  const sumTer = selectedEtfs.reduce((s, e) => s + e.ter, 0);
  const valoreAcquistato = selectedEtfs.filter(e => e.acquisto).reduce((s, e) => s + (e.acquisto.quantita * e.acquisto.quotazioneAcquisto), 0);

  // Media ponderata per valore acquistato — se non ci sono acquisti, usa pesi uguali
  const etfConAcquisto = selectedEtfs.filter(e => e.acquisto?.quantita > 0 && e.acquisto?.quotazioneAcquisto > 0);
  const totValorePerPeso = etfConAcquisto.reduce((s, e) => s + e.acquisto.quantita * e.acquisto.quotazioneAcquisto, 0);
  const calcPonderata = (campo) => {
    if (totValorePerPeso > 0 && etfConAcquisto.length > 0) {
      return etfConAcquisto.reduce((s, e) => {
        const peso = (e.acquisto.quantita * e.acquisto.quotazioneAcquisto) / totValorePerPeso;
        return s + (e[campo] || 0) * peso;
      }, 0);
    }
    // fallback: media semplice sugli ETF selezionati
    return selectedEtfs.length > 0 ? selectedEtfs.reduce((s, e) => s + (e[campo] || 0), 0) / selectedEtfs.length : 0;
  };
  const avgPerf1y = calcPonderata('perf1y');
  const avgPerf5y = calcPonderata('perf5y');

  const perf = (v) => (
    <span style={{ color: v > 0 ? 'var(--accent-green)' : v < 0 ? 'var(--accent-red)' : 'var(--text-secondary)', fontWeight: 500, fontSize: 14 }}>
      {v > 0 ? '+' : ''}{v.toFixed(2)}%
    </span>
  );

  const Th = ({ k, children }) => (
    <th onClick={() => handleSort(k)} style={{ cursor: 'pointer', fontSize: 12 }}>
      {children}{sortArrow(k)}
    </th>
  );

  const stats = [
    { label: 'ETF Selezionati', value: selectedEtfs.length, valueColor: 'var(--accent-gold)', sub: `su ${etfs.length} disponibili` },
    { label: 'TER Portafoglio', value: `${sumTer.toFixed(2)}%`, valueColor: sumTer > 1 ? 'var(--accent-red)' : 'var(--accent-green)', sub: `totale · media: ${totalTer.toFixed(2)}%` },
    {
      label: 'Perf. Storica 1A',
      value: `${avgPerf1y > 0 ? '+' : ''}${avgPerf1y.toFixed(1)}%`,
      valueColor: avgPerf1y > 0 ? 'var(--accent-green)' : 'var(--accent-red)',
      sub: avgPerf5y !== 0
        ? <span>ponderata · <span style={{ color: avgPerf5y > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{avgPerf5y > 0 ? '+' : ''}{avgPerf5y.toFixed(1)}%</span> 5A</span>
        : 'ponderata per valore',
    },
    { label: 'Valore Acquistato', value: `€ ${valoreAcquistato.toLocaleString('it-IT', { maximumFractionDigits: 0 })}`, valueColor: 'var(--text-primary)', sub: 'valore di carico' },
  ];

  return (
    <div style={{ padding: '0 0 28px 0' }}>
      {acquistoEtf && <AcquistoModal etf={acquistoEtf} portfolioId={portfolioId} onClose={() => setAcquistoEtf(null)} />}
      {venditaEtf && <VenditaModal etf={venditaEtf} portfolioId={portfolioId} onClose={() => setVenditaEtf(null)} />}
      {showAI && <AIModal portfolio={currentPortfolio} onClose={() => setShowAI(false)} />}
      {showCrea && <CreaPortafoglioModal portfolioId={portfolioId} initialProfilo={riskProfile} initialData={pendingData} onClose={() => { setShowCrea(false); setPendingData(null); }} />}

      {/* HEADER FISSO */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border)',
        padding: '14px 28px 12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontFamily: 'DM Serif Display, serif', fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>{name}</h2>
            <span className={`badge badge-${riskProfile.toLowerCase()}`}>{riskProfile}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Max USA: {maxUSA}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {msgAggiornamento && (
              <span style={{ fontSize: 12, color: msgAggiornamento.startsWith('✓') ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                {msgAggiornamento}
              </span>
            )}
            <button className="btn btn-secondary" style={{ fontSize: 12 }}
              onClick={handleAggiornaPressi} disabled={aggiornando}>
              {aggiornando ? '⏳ Aggiornamento...' : '🔄 Aggiorna Prezzi'}
            </button>
            <button className="btn btn-secondary" style={{ fontSize: 12, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none' }}
              onClick={() => setShowCrea(true)}>
              ✨ Crea con AI
            </button>
            <button className="btn btn-primary" style={{ fontSize: 12, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              onClick={() => setShowAI(true)}>
              🤖 Analisi AI
            </button>
            <button className="btn btn-primary" style={{ fontSize: 12 }}>📊 Genera Report</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          {stats.map((s, i) => (
            <div key={i} style={{ flex: 1, minWidth: 130, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: 18, color: s.valueColor, lineHeight: 1.2 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="tabs" style={{ width: 'auto' }}>
            {[['tutte', 'Tutti'], ['selezionate', 'Selezionati'], ['non-selezionate', 'Non Selezionati'], ['chiusi', `Chiusi${etfs.filter(e=>e.tipo==='venduto').length > 0 ? ` (${etfs.filter(e=>e.tipo==='venduto').length})` : ''}`]].map(([v, l]) => (
              <button key={v} className={`tab ${filter === v ? 'active' : ''}`}
                style={{ flex: 'none', padding: '5px 12px', fontSize: 12, ...(v==='chiusi' && etfs.filter(e=>e.tipo==='venduto').length > 0 ? { color: 'var(--accent-red)' } : {}) }}
                onClick={() => setFilter(v)}>{l}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            💡 <span style={{ color: 'var(--accent-gold)' }}>★ Top</span> = consigliato · Alt 1 = alternativa
          </div>
        </div>
      </div>

      {/* TABELLA */}
      <div style={{ padding: '12px 28px 0' }}>
        <div className="table-wrap" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
          <table>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)' }}>
              <tr>
                <th style={{ width: 36, fontSize: 12 }}>
                  {(() => {
                    const filteredSelezionabili = filtered.filter(e => e.tipo === 'consigliato' || e.tipo === 'alternativa1' || !e.tipo);
                    const tuttiSelezionati = filteredSelezionabili.length > 0 && filteredSelezionabili.every(e => e.selected);
                    return (
                      <input type="checkbox" checked={tuttiSelezionati}
                        title="Seleziona/deseleziona tutti gli ETF visibili"
                        style={{ cursor: 'pointer', width: 14, height: 14 }}
                        onChange={() => {
                          filteredSelezionabili.forEach(e => {
                            if (e.selected !== !tuttiSelezionati) toggleEtfSelection(portfolioId, e.isin);
                          });
                        }} />
                    );
                  })()}
                </th>
                <Th k="nome">ETF / Emittente</Th>
                <th style={{ fontSize: 12 }}>ISIN</th>
                <Th k="tipo">Tipo</Th>
                <Th k="ter">TER%</Th>
                <Th k="p1m">1 Mese</Th>
                <Th k="p6m">6 Mesi</Th>
                <Th k="p1y">1 Anno</Th>
                <Th k="p5y">5 Anni</Th>
                <th style={{ fontSize: 12 }}>Tax%</th>
                <Th k="quotazione">Quota €</Th>
                <Th k="cap">Dim. Fnd (M€)</Th>
                <th style={{ fontSize: 12 }}>Anno Lancio</th>
                <th style={{ fontSize: 12 }}>Acquisto</th>
              </tr>
            </thead>
            <tbody>
              {etfs.length === 0 ? (
                <tr><td colSpan={14} style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
                  Nessun ETF disponibile.
                </td></tr>
              ) : filtered.map(etf => (
                <tr key={etf.isin} style={{ opacity: etf.selected ? 1 : 0.6 }}>
                  <td><div className="checkbox-cell"><input type="checkbox" checked={!!etf.selected} onChange={() => toggleEtfSelection(portfolioId, etf.isin)} /></div></td>
                  <td>
                    <div style={{ fontWeight: 500, fontSize: 14, maxWidth: 220, whiteSpace: 'normal', lineHeight: 1.4 }}>{etf.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{etf.emittente}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{etf.categoria}</div>
                  </td>
                  <td>
                    <a href={`https://www.justetf.com/it/etf-profile.html?isin=${etf.isin}`} target="_blank" rel="noreferrer"
                      style={{ color: 'var(--accent-blue)', fontSize: 14, textDecoration: 'none', fontFamily: 'monospace' }}>
                      {etf.isin} ↗
                    </a>
                  </td>
                  <td>
                    {etf.tipo === 'consigliato'
                      ? <span className="tag-consigliato">★ Top</span>
                      : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{etf.tipo === 'alternativa1' ? 'Alt. 1' : 'Alt. 2'}</span>}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 14 }}>{etf.ter.toFixed(2)}%</td>
                  <td>{perf(etf.perf1m)}</td>
                  <td>{perf(etf.perf6m)}</td>
                  <td>{perf(etf.perf1y)}</td>
                  <td>{perf(etf.perf5y)}</td>
                  <td style={{ fontSize: 14 }}>
                    <span style={{ color: etf.tassazione <= 12.5 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{etf.tassazione}%</span>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 14 }}>{etf.quotazione.toFixed(3)}</td>
                  <td style={{ fontSize: 14 }}>
                    {etf.capitalizzazione >= 1000 ? `${(etf.capitalizzazione / 1000).toFixed(1)}B€` : `${etf.capitalizzazione}M€`}
                  </td>
                  <td style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{etf.annoNascita}</td>
                  <td>
                    {etf.tipo === 'venduto' ? (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)', border: '1px solid var(--accent-red)' }}>
                        VENDUTO
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', opacity: etf.selected ? 1 : 0.4 }}
                          disabled={!etf.selected} onClick={() => setAcquistoEtf(etf)}>
                          {etf.acquisto ? '✏️ Modifica' : '+ Acquisto'}
                        </button>
                        {etf.selected && etf.acquisto?.quantita > 0 && (
                          <button className="btn btn-danger" style={{ fontSize: 12, padding: '4px 10px' }}
                            onClick={() => setVenditaEtf(etf)} title="Registra vendita">
                            📤
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
          <span>Clicca sulle intestazioni per ordinare · Clicca sull'ISIN per aprire JustETF</span>
          <span style={{ color: 'var(--accent-gold)', fontWeight: 600 }}>
            {filtered.length} ETF mostrati · {selectedEtfs.length} selezionati
          </span>
        </div>
      </div>
    </div>
  );
}