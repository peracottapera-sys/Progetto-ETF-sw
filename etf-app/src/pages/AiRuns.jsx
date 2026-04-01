import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function AiRuns() {
  const { getAiRuns, deleteAiRun, currentPortfolio } = useApp();
  const [runs, setRuns] = useState([]);
  const [filtro, setFiltro] = useState({ profilo: '', portfolioId: '' });
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);

  const carica = async () => {
    setLoading(true);
    const params = {};
    if (filtro.profilo) params.profilo = filtro.profilo;
    if (filtro.portfolioId) params.portfolioId = filtro.portfolioId;
    const data = await getAiRuns(params);
    setRuns(data);
    setLoading(false);
  };

  useEffect(() => { carica(); }, [filtro]);

  const handleDelete = async (id) => {
    if (!window.confirm('Eliminare questo run?')) return;
    await deleteAiRun(id);
    setRuns(r => r.filter(x => x.id !== id));
  };

  const esportaExcel = () => {
    const righe = [
      ['ID', 'Data', 'Profilo', 'Orizzonte', 'Capitale', 'Scenario', 'Max USA', 'Preferenze', 'Solo Acc.', 'Bucket', 'Bucket Breve%', 'N.ETF', 'TER tot.', 'TER medio', 'Rend. lordo~', 'ETF selezionati', 'Dettaglio ETF (ISIN · peso · categoria · TER)'],
      ...runs.map(r => {
        const etfs = Array.isArray(r.etf_selezionati) ? r.etf_selezionati : [];
        const etfStr = etfs.map(e => `${e.isin}(${e.peso}%)`).join(', ');
        const etfDettaglio = etfs.map(e => `${e.isin} · ${e.peso}% · ${e.categoria || '—'} · TER ${e.ter ?? '—'}%`).join(' | ');
        const terMedio = etfs.length > 0
          ? (etfs.reduce((s, e) => s + (e.ter || 0), 0) / etfs.length).toFixed(3)
          : '—';
        return [
          r.id,
          new Date(r.created_at).toLocaleString('it-IT'),
          r.profilo,
          r.orizzonte || '—',
          r.capitale ? `€${r.capitale.toLocaleString('it-IT')}` : '—',
          r.scenario_macro || '—',
          r.max_usa || 'No max',
          r.preferenze || '—',
          r.escludi_distribuzione ? 'Sì' : 'No',
          r.bucket_attivo ? 'Sì' : 'No',
          r.bucket_pct_breve != null ? r.bucket_pct_breve+'%' : '—',
          r.metriche?.nEtf || etfs.length,
          r.metriche?.terTotale != null ? r.metriche.terTotale.toFixed(2)+'%' : '—',
          terMedio !== '—' ? terMedio+'%' : '—',
          r.metriche?.rendAttesoLordo != null ? r.metriche.rendAttesoLordo+'%' : '—',
          etfStr,
          etfDettaglio,
        ];
      })
    ];
    const csv = righe.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai_runs_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const profiloColore = { Prudente: '#22c55e', Bilanciato: '#f59e0b', Aggressivo: '#ef4444' };
  const orizzonteColore = { LUNGO: '#22c55e', MEDIO: '#f59e0b', BREVE: '#60a5fa' };

  return (
    <div style={{ padding: '0 0 28px 0' }}>
      <div style={{ position:'sticky', top:0, zIndex:50, background:'var(--bg-primary)',
        borderBottom:'1px solid var(--border)', padding:'14px 28px 12px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div>
            <h2 style={{ fontFamily:'DM Serif Display, serif', fontSize:22, color:'var(--text-primary)', margin:0 }}>
              🤖 Storico Run AI
            </h2>
            <p style={{ color:'var(--text-secondary)', fontSize:12, marginTop:3 }}>
              {runs.length} run salvati
            </p>
          </div>
          <button className="btn btn-secondary" style={{ fontSize:12 }} onClick={esportaExcel}>
            📥 Esporta CSV
          </button>
        </div>

        {/* Filtri */}
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <select className="input" style={{ fontSize:12, width:140 }}
            value={filtro.profilo} onChange={e => setFiltro(f => ({...f, profilo: e.target.value}))}>
            <option value="">Tutti i profili</option>
            <option value="Prudente">Prudente</option>
            <option value="Bilanciato">Bilanciato</option>
            <option value="Aggressivo">Aggressivo</option>
          </select>
          <select className="input" style={{ fontSize:12, width:160 }}
            value={filtro.portfolioId} onChange={e => setFiltro(f => ({...f, portfolioId: e.target.value}))}>
            <option value="">Tutti i portafogli</option>
            {currentPortfolio && <option value={currentPortfolio.id}>{currentPortfolio.name}</option>}
          </select>
          <button className="btn btn-ghost" style={{ fontSize:12 }} onClick={() => setFiltro({ profilo:'', portfolioId:'' })}>
            ✕ Reset
          </button>
        </div>
      </div>

      <div style={{ padding:'12px 28px 0' }}>
        {loading && <div style={{ color:'var(--text-muted)', fontSize:13, padding:'20px 0' }}>Caricamento...</div>}
        {!loading && runs.length === 0 && (
          <div style={{ color:'var(--text-muted)', fontSize:13, padding:'20px 0' }}>
            Nessun run salvato. I prossimi portafogli creati con AI verranno registrati qui.
          </div>
        )}

        {runs.map(r => {
          const etfs = Array.isArray(r.etf_selezionati) ? r.etf_selezionati : [];
          const isExpanded = expandedId === r.id;
          const dataStr = new Date(r.created_at).toLocaleString('it-IT', {
            day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'
          });

          return (
            <div key={r.id} style={{ background:'var(--bg-card)', border:'1px solid var(--border)',
              borderRadius:10, marginBottom:10, overflow:'hidden' }}>

              {/* Header riga */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px',
                cursor:'pointer' }} onClick={() => setExpandedId(isExpanded ? null : r.id)}>

                <span style={{ fontSize:11, color:'var(--text-muted)', minWidth:110 }}>{dataStr}</span>

                <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:4,
                  background: `${profiloColore[r.profilo] || '#888'}22`,
                  color: profiloColore[r.profilo] || 'var(--text-primary)' }}>
                  {r.profilo}
                </span>

                {r.orizzonte && (
                  <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:4,
                    background: `${orizzonteColore[r.orizzonte] || '#888'}22`,
                    color: orizzonteColore[r.orizzonte] || 'var(--text-muted)' }}>
                    {r.orizzonte}
                  </span>
                )}

                {r.capitale && (
                  <span style={{ fontSize:11, color:'var(--text-secondary)' }}>
                    €{parseFloat(r.capitale).toLocaleString('it-IT', { maximumFractionDigits:0 })}
                  </span>
                )}

                {r.scenario_macro && (
                  <span style={{ fontSize:10, color:'var(--text-muted)', fontStyle:'italic' }}>
                    {r.scenario_macro.replace(/_/g,' ')}
                  </span>
                )}

                <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontSize:11, color:'var(--text-secondary)' }}>
                    {etfs.length} ETF{r.metriche?.terTotale ? ` · TER ${r.metriche.terTotale.toFixed(2)}%` : ''}
                    {r.metriche?.rendAttesoLordo ? ` · Rend. ${r.metriche.rendAttesoLordo}% lordo` : ''}
                  </span>
                  <span style={{ fontSize:12, color:'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span>
                  <button className="btn btn-ghost" style={{ fontSize:10, padding:'2px 7px', color:'var(--accent-red)' }}
                    onClick={e => { e.stopPropagation(); handleDelete(r.id); }}>✕</button>
                </div>
              </div>

              {/* Dettaglio espanso */}
              {isExpanded && (
                <div style={{ borderTop:'1px solid var(--border)', padding:'12px 16px' }}>
                  {/* ETF selezionati */}
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)',
                      textTransform:'uppercase', marginBottom:8 }}>ETF Selezionati</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                      {etfs.map((e, i) => (
                        <div key={i} style={{ background:'var(--bg-secondary)', borderRadius:6,
                          padding:'4px 10px', border:'1px solid var(--border)' }}>
                          <span style={{ fontSize:11, fontWeight:600 }}>{e.peso}%</span>
                          <span style={{ fontSize:10, color:'var(--text-muted)', margin:'0 4px' }}>·</span>
                          <span style={{ fontSize:11 }}>{e.name || e.isin}</span>
                          {e.bucket && (
                            <span style={{ fontSize:9, marginLeft:4,
                              color: e.bucket === 'BREVE' ? 'var(--accent-blue)' : 'var(--accent-amber)' }}>
                              {e.bucket === 'BREVE' ? '🔵' : '🟡'}
                            </span>
                          )}
                          {e.ter && <span style={{ fontSize:9, color:'var(--text-muted)', marginLeft:4 }}>{e.ter}%</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Motivi */}
                  {etfs.some(e => e.motivo) && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)',
                        textTransform:'uppercase', marginBottom:6 }}>Motivazioni AI</div>
                      {etfs.filter(e => e.motivo).map((e, i) => (
                        <div key={i} style={{ fontSize:11, color:'var(--text-secondary)',
                          padding:'3px 0', borderBottom:'1px solid var(--border)' }}>
                          <span style={{ fontWeight:600, color:'var(--text-primary)', marginRight:6 }}>
                            {e.isin}
                          </span>
                          {e.motivo}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
