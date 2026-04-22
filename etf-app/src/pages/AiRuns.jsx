import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function AiRuns() {
  const { getAiRuns, deleteAiRun, currentPortfolio } = useApp();
  const [runs, setRuns] = useState([]);
  const [filtro, setFiltro] = useState({ profilo: '', portfolioId: '', tipo: '' });
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);

  const carica = async () => {
    setLoading(true);
    const params = {};
    if (filtro.profilo) params.profilo = filtro.profilo;
    if (filtro.portfolioId) params.portfolioId = filtro.portfolioId;
    if (filtro.tipo) params.tipo = filtro.tipo;
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
      ['ID', 'Data', 'Tipo', 'Profilo', 'Orizzonte', 'Capitale', 'Scenario', 'Max USA', 'Preferenze', 'Solo Acc.', 'Bucket', 'Bucket Breve%', 'N.ETF', 'TER tot.', 'TER medio', 'Rend. lordo~', 'ETF selezionati', 'Dettaglio ETF (ISIN · peso · categoria · TER)'],
      ...runs.map(r => {
        const etfs = Array.isArray(r.etf_selezionati) ? r.etf_selezionati : [];
        const etfStr = etfs.map(e => `${e.isin}(${e.peso || e.azione || ''})`).join(', ');
        const etfDettaglio = etfs.map(e => `${e.isin} · ${e.peso ?? e.azione ?? '—'} · ${e.categoria || '—'} · TER ${e.ter ?? '—'}%`).join(' | ');
        const terMedio = etfs.length > 0 && etfs.some(e => e.ter != null)
          ? (etfs.reduce((s, e) => s + (e.ter || 0), 0) / etfs.length).toFixed(3)
          : '—';
        return [
          r.id,
          new Date(r.created_at).toLocaleString('it-IT'),
          r.tipo === 'analisi' ? 'Analisi' : 'Creazione',
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
  const tipoBadge = {
    creazione: { label: 'Creazione', color: '#a78bfa', emoji: '🆕' },
    analisi:   { label: 'Analisi',   color: '#22d3ee', emoji: '🔄' },
  };

  // Contatori per i pill (ricalcolati quando cambiano i runs)
  // Nota: quando filtro.tipo è attivo, `runs` contiene solo quel tipo; per i contatori
  // totali usiamo il valore reale dei filtri non-tipo. Semplifichiamo mostrando il count
  // del subset corrente (Tutti = runs.length, altrimenti runs filtrati già).
  const countTutti = filtro.tipo ? '' : runs.length;

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
              {runs.length} run {filtro.tipo ? `di tipo ${filtro.tipo}` : 'salvati'}
            </p>
          </div>
          <button className="btn btn-secondary" style={{ fontSize:12 }} onClick={esportaExcel}>
            📥 Esporta CSV
          </button>
        </div>

        {/* Pill filtro Tipo */}
        <div style={{ display:'flex', gap:6, marginBottom:10 }}>
          {[
            { v: '',          label: 'Tutti',      emoji: '📋' },
            { v: 'creazione', label: 'Creazioni',  emoji: '🆕' },
            { v: 'analisi',   label: 'Analisi',    emoji: '🔄' },
          ].map(p => {
            const attivo = filtro.tipo === p.v;
            return (
              <button key={p.v} onClick={() => setFiltro(f => ({ ...f, tipo: p.v }))}
                style={{ fontSize:11, fontWeight:attivo ? 700 : 500,
                  padding:'5px 12px', borderRadius:20, cursor:'pointer',
                  border: attivo ? '1px solid var(--accent-gold)' : '1px solid var(--border)',
                  background: attivo ? 'var(--accent-gold)' : 'transparent',
                  color: attivo ? '#000' : 'var(--text-secondary)' }}>
                {p.emoji} {p.label}
              </button>
            );
          })}
        </div>

        {/* Filtri secondari */}
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
          <button className="btn btn-ghost" style={{ fontSize:12 }} onClick={() => setFiltro({ profilo:'', portfolioId:'', tipo:'' })}>
            ✕ Reset
          </button>
        </div>
      </div>

      <div style={{ padding:'12px 28px 0' }}>
        {loading && <div style={{ color:'var(--text-muted)', fontSize:13, padding:'20px 0' }}>Caricamento...</div>}
        {!loading && runs.length === 0 && (
          <div style={{ color:'var(--text-muted)', fontSize:13, padding:'20px 0' }}>
            {filtro.tipo === 'analisi'
              ? 'Nessuna analisi salvata. Le prossime analisi AI verranno registrate qui.'
              : filtro.tipo === 'creazione'
                ? 'Nessuna creazione salvata. I prossimi portafogli generati con AI verranno registrati qui.'
                : 'Nessun run salvato. I prossimi portafogli creati o analizzati con AI verranno registrati qui.'}
          </div>
        )}

        {runs.map(r => {
          const etfs = Array.isArray(r.etf_selezionati) ? r.etf_selezionati : [];
          const isExpanded = expandedId === r.id;
          const dataStr = new Date(r.created_at).toLocaleString('it-IT', {
            day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'
          });
          const tipoInfo = tipoBadge[r.tipo] || tipoBadge.creazione;

          return (
            <div key={r.id} style={{ background:'var(--bg-card)', border:'1px solid var(--border)',
              borderRadius:10, marginBottom:10, overflow:'hidden' }}>

              {/* Header riga */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px',
                cursor:'pointer' }} onClick={() => setExpandedId(isExpanded ? null : r.id)}>

                <span style={{ fontSize:11, color:'var(--text-muted)', minWidth:110 }}>{dataStr}</span>

                {/* Badge TIPO (Creazione / Analisi) */}
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4,
                  background: `${tipoInfo.color}22`, color: tipoInfo.color,
                  border: `1px solid ${tipoInfo.color}44` }}>
                  {tipoInfo.emoji} {tipoInfo.label}
                </span>

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
                    {etfs.length} {r.tipo === 'analisi' ? 'modif.' : 'ETF'}{r.metriche?.terTotale ? ` · TER ${r.metriche.terTotale.toFixed(2)}%` : ''}
                    {r.metriche?.rendAttesoLordo ? ` · Rend. ${r.metriche.rendAttesoLordo}% lordo` : ''}
                    {r.tipo === 'analisi' && r.metriche?.semaforoGlobale ? ` · ${r.metriche.semaforoGlobale === 'VERDE' ? '🟢' : r.metriche.semaforoGlobale === 'GIALLO' ? '🟡' : '🔴'}` : ''}
                  </span>
                  <span style={{ fontSize:12, color:'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span>
                  <button className="btn btn-ghost" style={{ fontSize:10, padding:'2px 7px', color:'var(--accent-red)' }}
                    onClick={e => { e.stopPropagation(); handleDelete(r.id); }}>✕</button>
                </div>
              </div>

              {/* Dettaglio espanso */}
              {isExpanded && (
                <div style={{ borderTop:'1px solid var(--border)', padding:'12px 16px' }}>
                  {/* Semafori (solo per analisi, se presenti nelle metriche) */}
                  {r.tipo === 'analisi' && r.metriche?.semafori && (
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)',
                        textTransform:'uppercase', marginBottom:8 }}>Semafori</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                        {Object.entries(r.metriche.semafori).map(([k, v]) => {
                          const stato = (typeof v === 'object' ? v?.stato : v) || '';
                          const col = stato.toUpperCase() === 'VERDE' ? '#22c55e'
                                    : stato.toUpperCase() === 'GIALLO' ? '#f59e0b'
                                    : stato.toUpperCase() === 'ROSSO' ? '#ef4444' : '#6b7280';
                          const emoji = stato.toUpperCase() === 'VERDE' ? '🟢'
                                      : stato.toUpperCase() === 'GIALLO' ? '🟡'
                                      : stato.toUpperCase() === 'ROSSO' ? '🔴' : '⚪';
                          return (
                            <span key={k} style={{ fontSize:11, padding:'3px 9px',
                              borderRadius:6, border:`1px solid ${col}44`, color:col,
                              background:`${col}11` }}>
                              {emoji} {k}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ETF (creazione) o Modifiche suggerite (analisi) */}
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)',
                      textTransform:'uppercase', marginBottom:8 }}>
                      {r.tipo === 'analisi' ? `Modifiche suggerite (${etfs.length})` : 'ETF Selezionati'}
                    </div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                      {etfs.map((e, i) => {
                        // Per analisi: usa azione + colore; per creazione: usa peso%
                        const isAnalisi = r.tipo === 'analisi';
                        const azColor = e.azione === 'seleziona' || e.azione === 'aggiungi' ? '#22c55e'
                                      : e.azione === 'deseleziona' ? '#ef4444' : '#888';
                        const azLabel = e.azione === 'seleziona'   ? '🟢 TIENI'
                                      : e.azione === 'aggiungi'    ? '➕ AGGIUNGI'
                                      : e.azione === 'deseleziona' ? '🔴 VENDI'
                                      : e.azione || '—';
                        return (
                          <div key={i} style={{ background:'var(--bg-secondary)', borderRadius:6,
                            padding:'4px 10px', border:'1px solid var(--border)' }}>
                            {isAnalisi ? (
                              <span style={{ fontSize:10, fontWeight:700, color:azColor }}>{azLabel}</span>
                            ) : (
                              <span style={{ fontSize:11, fontWeight:600 }}>{e.peso}%</span>
                            )}
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
                        );
                      })}
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
