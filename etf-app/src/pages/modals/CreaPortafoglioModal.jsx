import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

function CreaPortafoglioModal({ portfolioId, onClose, initialProfilo, initialData }) {
  const { applicaPortafoglioAI } = useApp();
  const [form, setForm] = useState({
    profilo: initialProfilo || 'Bilanciato',
    orizzonteAnni: 10,
    capitale: initialData?.capitale ? String(initialData.capitale) : '',
    preferenze: '',
    escludiDistribuzione: true,
  });
  const [spiegazione, setSpiegazione] = useState(initialData?.spiegazione || '');
  const [selezione, setSelezione] = useState(initialData?.selezione || []);
  const [approvate, setApprovate] = useState(() => {
    if (!initialData?.selezione) return {};
    const init = {};
    initialData.selezione.forEach((s, i) => { init[i] = s.tipo === 'consigliato' || !s.tipo; });
    return init;
  });
  const [pesi, setPesi] = useState(() => {
    if (!initialData?.selezione) return {};
    const init = {};
    initialData.selezione.forEach((s, i) => { init[i] = s.peso || 0; });
    return init;
  });
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState('');
  const [step, setStep] = useState(initialData?.selezione?.length > 0 ? 'risultato' : 'form');

  const handleCrea = async () => {
    setLoading(true);
    setErrore('');
    try {
      const res = await fetch(`${API}/api/ai/crea-portafoglio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profilo: form.profilo,
          orizzonteAnni: form.orizzonteAnni,
          capitale: form.capitale ? parseFloat(form.capitale) : null,
          preferenze: form.preferenze,
          escludiDistribuzione: form.escludiDistribuzione,
        })
      });
      const data = await res.json();
      if (data.selezione) {
        setSpiegazione(data.spiegazione);
        setSelezione(data.selezione);
        const initApp = {}, initPesi = {};
        data.selezione.forEach((s, i) => {
          initApp[i] = s.tipo === 'consigliato' || (!s.tipo);
          initPesi[i] = s.peso || 0;
        });
        setApprovate(initApp);
        setPesi(initPesi);
        setStep('risultato');
      } else {
        setErrore(data.error || 'Errore sconosciuto');
      }
    } catch (err) {
      setErrore('Server non raggiungibile.');
    } finally {
      setLoading(false);
    }
  };

  const totPesi = Object.entries(pesi)
    .filter(([i]) => approvate[i] && (selezione[i]?.tipo === 'consigliato' || !selezione[i]?.tipo))
    .reduce((s, [, v]) => s + (parseFloat(v) || 0), 0);
  const capitale = form.capitale ? parseFloat(form.capitale) : null;

  const handleApplica = async () => {
    const selezioneAggiornata = selezione.map((s, i) => {
      const isConsigliato = s.tipo === 'consigliato' || !s.tipo;
      const isApproved = isConsigliato && !!approvate[i];
      const pesoVal = isConsigliato ? (parseFloat(pesi[i]) || s.peso || 0) : 0;
      const valAllocato = (isApproved && capitale) ? capitale * pesoVal / 100 : null;
      // Priorità quantita: 1) calcolata dal capitale nel form, 2) già calcolata dal server, 3) null
      const quantita = valAllocato && s.quotazioneAcquisto > 0
        ? Math.floor(valAllocato / s.quotazioneAcquisto)
        : (s.quantita || null);
      return { ...s, peso: pesoVal, quantita, _selected: isApproved };
    });
    await applicaPortafoglioAI(portfolioId, selezioneAggiornata, capitale || 0);
    onClose();
  };

  const nApprovate = Object.values(approvate).filter(Boolean).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 620, maxWidth: 780, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
          <div>
            <div className="modal-title" style={{ marginBottom: 4 }}>✨ Crea Portafoglio con AI</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>L'AI selezionerà gli ETF più adatti al tuo profilo</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 18, padding: '4px 10px' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {step === 'form' && (
            <div>
              <div className="form-group">
                <label className="form-label">Profilo di rischio</label>
                <select className="input" value={form.profilo} onChange={e => setForm(f => ({ ...f, profilo: e.target.value }))}>
                  <option>Prudente</option>
                  <option>Bilanciato</option>
                  <option>Aggressivo</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Orizzonte temporale (anni)</label>
                <input className="input" type="number" min="1" max="30"
                  value={form.orizzonteAnni} onChange={e => setForm(f => ({ ...f, orizzonteAnni: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Capitale disponibile (€) — opzionale</label>
                <input className="input" type="number" min="0" placeholder="Es: 10000"
                  value={form.capitale} onChange={e => setForm(f => ({ ...f, capitale: e.target.value }))} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Se inserito, verranno calcolate automaticamente le quote da acquistare
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Preferenze o note — opzionale</label>
                <input className="input" placeholder="Es: preferisco ETF a basso TER, evitare emergenti..."
                  value={form.preferenze} onChange={e => setForm(f => ({ ...f, preferenze: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                <input type="checkbox" id="escludiDistr" checked={form.escludiDistribuzione}
                  onChange={e => setForm(f => ({ ...f, escludiDistribuzione: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent-gold)' }} />
                <label htmlFor="escludiDistr" style={{ fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                  Escludi ETF a <strong>Distribuzione</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>(preferisci Accumulazione per fiscalità italiana)</span>
                </label>
              </div>
              {errore && <div className="alert alert-warning">⚠️ {errore}</div>}
              <div className="alert alert-info" style={{ fontSize: 12 }}>
                ⚠️ Le selezioni attuali verranno sostituite con quelle consigliate dall'AI.
              </div>
            </div>
          )}

          {step === 'risultato' && (
            <div>
              {loading && (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>✨</div>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Creazione portafoglio in corso...</div>
                </div>
              )}
              {spiegazione && (() => {
                // ── Metriche calcolate DIRETTAMENTE dalla selezione (non dal testo) ──
                const consigliati = selezione.filter(s => s.tipo === 'consigliato' || !s.tipo);
                const totPeso = consigliati.reduce((t, s, i) => t + (parseFloat(pesi[selezione.indexOf(s)]) || s.peso || 0), 0);

                // TER totale = SOMMA dei TER di tutti i consigliati selezionati
                const terTotale = consigliati.reduce((t, s) => t + (s.ter || 0), 0);

                // Correlazione max: estratta dal testo (unica fonte disponibile)
                const corrMatch = spiegazione.match(/correlazione[^:]*:?\s*[~≈]?(0\.\d+)/i)
                  || spiegazione.match(/METRICHE:[^\n]*corr_max:(0\.\d+)/i);
                const corrMax = corrMatch ? corrMatch[1] : null;

                // Logica narrativa: prime 2-3 frasi prima di METRICHE/VERIFICA/**
                let logica = spiegazione.split(/METRICHE:|VERIFICA:|(?:\*\*Coppie)/i)[0].replace(/\*\*/g,'').trim();
                logica = (logica.match(/[^.!?]+[.!?]+/g) || []).slice(0, 3).join(' ').trim();

                // Categorie: raggruppa per categoria con fallback dal nome
                const inferCategoria = (s) => {
                  if (s.categoria && s.categoria !== 'N/D') return s.categoria;
                  const n = (s.name || '').toLowerCase();
                  if (n.includes('emerging') || n.includes('emergenti') || n.includes(' em ')) return 'Azionario Emergenti';
                  if (n.includes('world value') || n.includes('msci world value')) return 'Azionario Globale Value';
                  if (n.includes('world') || n.includes('msci world') || n.includes('ftse all-world') || n.includes('acwi')) return 'Azionario Globale';
                  if (n.includes('s&p 500') || n.includes('sp500') || n.includes('nasdaq')) return 'Azionario USA';
                  if (n.includes('europe') || n.includes('stoxx') || n.includes('euro')) return 'Azionario Europa';
                  if (n.includes('japan') || n.includes('pacific') || n.includes('giappone')) return 'Azionario Pacifico';
                  if (n.includes('healthcare') || n.includes('tech') || n.includes('innovation') || n.includes('clean')) return 'Azionario Tematico';
                  if (n.includes('high yield')) return 'Obbligazionario High Yield';
                  if (n.includes('corporate')) return 'Obbligazionario Corporate';
                  if (n.includes('government') || n.includes('govt') || n.includes('treasury') || n.includes('bund')) return 'Obbligazionario Gov';
                  if (n.includes('aggregate') || n.includes('bond') || n.includes('obbligaz')) return 'Obbligazionario';
                  if (n.includes('overnight') || n.includes('monetary') || n.includes('swap') || n.includes('liquidit')) return 'Liquidità';
                  if (n.includes('gold') || n.includes('oro') || n.includes('commodity') || n.includes('silver')) return 'Materie Prime';
                  if (n.includes('reit') || n.includes('real estate') || n.includes('immobil')) return 'Immobiliare';
                  return s.categoria || 'Altro';
                };
                const catCount = {};
                const catPeso = {};
                consigliati.forEach((s, idx) => {
                  const c = inferCategoria(s);
                  const i = selezione.indexOf(s);
                  const p = parseFloat(pesi[i]) || s.peso || 0;
                  catCount[c] = (catCount[c] || 0) + 1;
                  catPeso[c] = (catPeso[c] || 0) + p;
                });
                // Macro per conteggio aree distinte
                const getMacro = (c) => {
                  const cl = (c||'').toLowerCase();
                  if (cl.includes('azionario') || cl.includes('equity')) return 'az';
                  if (cl.includes('obbligaz') || cl.includes('bond') || cl.includes('corporate') || cl.includes('government') || cl.includes('treasury') || cl.includes('high yield') || cl.includes('aggregate') || cl.includes('gov')) return 'ob';
                  if (cl.includes('liquidit') || cl.includes('monetar') || cl.includes('overnight') || cl.includes('swap')) return 'liq';
                  if (cl.includes('oro') || cl.includes('gold') || cl.includes('materie') || cl.includes('commodity')) return 'mp';
                  if (cl.includes('immobil') || cl.includes('reit')) return 'im';
                  return 'altro';
                };
                const macroDistinte = new Set(Object.keys(catCount).map(getMacro));

                const Pill = ({ label, value, color }) => (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', background:'var(--bg-primary)', borderRadius:8, padding:'8px 12px', minWidth:70, border:'1px solid var(--border)' }}>
                    <span style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:2 }}>{label}</span>
                    <span style={{ fontSize:14, fontWeight:700, color: color || 'var(--text-primary)' }}>{value || '—'}</span>
                  </div>
                );

                return (
                  <div style={{ background:'var(--bg-secondary)', borderRadius:10, padding:'14px 16px', marginBottom:20, border:'1px solid var(--border)' }}>
                    {logica && <p style={{ fontSize:13, color:'var(--text-secondary)', lineHeight:1.6, margin:'0 0 12px 0' }}>{logica}</p>}
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <Pill label="ETF" value={consigliati.length} color="var(--accent-gold)" />
                      <Pill label="TER totale" value={terTotale.toFixed(2)+'%'} color={terTotale > 1 ? 'var(--accent-amber)' : 'var(--accent-green)'} />
                      {Object.keys(catCount).length > 0 && (
                        <div style={{ background:'var(--bg-primary)', borderRadius:8, padding:'8px 12px', border:'1px solid var(--border)', flex:1, minWidth:120 }}>
                          <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:5 }}>
                            Categorie ({macroDistinte.size} macro-aree)
                          </div>
                          {Object.entries(catCount).map(([cat, n]) => (
                            <div key={cat} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11, marginBottom:2 }}>
                              <span style={{ color:'var(--text-primary)' }}>{cat}</span>
                              <span style={{ display:'flex', gap:8, marginLeft:8 }}>
                                <span style={{ color:'var(--text-muted)' }}>{n} ETF</span>
                                <span style={{ fontWeight:700, color:'var(--accent-gold)', minWidth:36, textAlign:'right' }}>{Math.round(catPeso[cat])}%</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {corrMax && <Pill label="Corr. max" value={corrMax} color={parseFloat(corrMax) > 0.6 ? 'var(--accent-amber)' : 'var(--accent-green)'} />}
                    </div>
                  </div>
                );
              })()}

              {/* Riepilogo pesi — solo consigliati */}
              {(() => {
                const idxConsigliati = selezione.map((s,i) => (s.tipo==='consigliato'||!s.tipo)?i:null).filter(i=>i!==null);
                const tuttiApprovati = idxConsigliati.every(i => approvate[i]);
                const toggleTutti = () => {
                  const newApp = {...approvate};
                  idxConsigliati.forEach(i => { newApp[i] = !tuttiApprovati; });
                  setApprovate(newApp);
                };
                return (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <input type="checkbox" checked={tuttiApprovati} onChange={toggleTutti}
                        title="Seleziona/deseleziona tutti i consigliati"
                        style={{ width:15, height:15, cursor:'pointer' }} />
                      <div style={{ fontWeight: 600, fontSize: 14 }}>★ ETF consigliati — modifica i pesi %</div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: Math.abs(totPesi - 100) < 0.1 ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                      Totale: {totPesi.toFixed(0)}% {Math.abs(totPesi - 100) < 0.1 ? '✓' : '⚠ deve essere 100%'}
                    </div>
                  </div>
                );
              })()}

              {/* Consigliati */}
              {selezione.map((s, i) => {
                if (s.tipo !== 'consigliato' && s.tipo) return null;
                const nome = s.name || s.isin;
                const pesoVal = parseFloat(pesi[i]) || 0;
                const valAllocato = capitale ? (capitale * pesoVal / 100) : null;
                const qtCalcolata = valAllocato && s.quotazioneAcquisto ? Math.floor(valAllocato / s.quotazioneAcquisto) : s.quantita || null;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                    <input type="checkbox" checked={!!approvate[i]}
                      onChange={() => setApprovate(a => ({ ...a, [i]: !a[i] }))}
                      style={{ marginTop: 4, cursor: 'pointer', width: 16, height: 16 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span className="tag-consigliato">★ Top</span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{nome}</span>
                        <a href={`https://www.justetf.com/it/etf-profile.html?isin=${s.isin}`} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, color: 'var(--accent-blue)', fontFamily: 'monospace', textDecoration: 'none' }}
                          onClick={e => e.stopPropagation()}>
                          {s.isin} ↗
                        </a>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{s.motivo}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                        TER: {s.ter ?? '—'}% · Perf 1A: {s.perf1y > 0 ? '+' : ''}{s.perf1y ?? '—'}% · {s.categoria}
                        {s.quotazioneAcquisto ? ` · €${s.quotazioneAcquisto}` : ''}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Peso:</span>
                          <input type="number" min="0" max="100" step="1"
                            value={pesi[i] ?? s.peso}
                            onChange={e => setPesi(p => ({ ...p, [i]: e.target.value }))}
                            disabled={!approvate[i]}
                            style={{ width: 60, padding: '3px 8px', fontSize: 13, fontWeight: 700, color: 'var(--accent-gold)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center' }} />
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>%</span>
                        </div>
                        {capitale && approvate[i] && valAllocato && (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            → <strong style={{ color: 'var(--text-primary)' }}>€{valAllocato.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</strong>
                            {qtCalcolata > 0 && <span style={{ color: 'var(--accent-gold)', marginLeft: 6 }}>= {qtCalcolata} quote</span>}
                            {!s.quotazioneAcquisto && <span style={{ color: 'var(--accent-amber)', marginLeft: 6 }}>(quotazione non disponibile)</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Alternative — sezione collassata, informativa */}
              {selezione.some(s => s.tipo === 'alternativa1' || s.tipo === 'alternativa2') && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    📋 Alternative disponibili (aggiunte al portafoglio come riferimento, non selezionate)
                  </div>
                  {selezione.map((s, i) => {
                    if (s.tipo !== 'alternativa1' && s.tipo !== 'alternativa2') return null;
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', opacity: 0.75 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {s.tipo === 'alternativa1' ? 'Alt. 1' : 'Alt. 2'}
                        </span>
                        <span style={{ fontSize: 12, flex: 1 }}>{s.name || s.isin}</span>
                        <a href={`https://www.justetf.com/it/etf-profile.html?isin=${s.isin}`} target="_blank" rel="noreferrer"
                          style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--accent-blue)', textDecoration: 'none' }}
                          onClick={e => e.stopPropagation()}>
                          {s.isin} ↗
                        </a>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.categoria}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>TER {s.ter ?? '—'}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {step === 'risultato' && `${nApprovate} ETF selezionati`}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose}>Annulla</button>
            {step === 'form' && (
              <button className="btn btn-primary" onClick={handleCrea} disabled={loading}
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                {loading ? '⏳ Elaborazione...' : '✨ Genera Portafoglio'}
              </button>
            )}
            {step === 'risultato' && (
              <button className="btn btn-primary" onClick={handleApplica}
                disabled={nApprovate === 0 || (capitale && Math.abs(totPesi - 100) > 5)}
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                ✓ Applica {nApprovate} ETF al Portafoglio
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


export default CreaPortafoglioModal;
