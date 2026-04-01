import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

// aggiornato 2026-03-29 15:35
function CreaPortafoglioModal({ portfolioId, onClose, initialProfilo, initialData }) {
  const { applicaPortafoglioAI, token, saveBuckets, saveAiRun } = useApp();
  const [form, setForm] = useState({
    profilo: initialProfilo || 'Bilanciato',
    orizzonteAnni: 'MEDIO',
    capitale: initialData?.capitale ? String(initialData.capitale) : '',
    preferenze: '',
    escludiDistribuzione: true,
    maxUSA: 'No max',
  });
  const [spiegazione, setSpiegazione] = useState(initialData?.spiegazione || '');
  const [scenarioMacro, setScenarioMacro] = useState(initialData?.scenarioMacro || '');
  const [bucketInfo, setBucketInfo] = useState(null);
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
  const [bucket, setBucket] = useState({ attivo: false, pctBreve: 20, anniBreve: 3, filosofia: 'difensiva' });
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
          orizzonteAnni: form.orizzonteAnni === 'BREVE' ? 3 : form.orizzonteAnni === 'LUNGO' ? 15 : 7,
          bucketBreve: bucket.attivo ? { pct: Math.min(bucket.pctBreve, 40), anni: bucket.anniBreve, filosofia: bucket.filosofia || 'difensiva' } : undefined,
          bucketLungo: bucket.attivo ? { pct: 100 - Math.min(bucket.pctBreve, form.orizzonteAnni === 'LUNGO' ? 40 : 20), anni: form.orizzonteAnni === 'LUNGO' ? 15 : 7 } : undefined,
          capitale: form.capitale ? parseFloat(form.capitale) : null,
          preferenze: form.preferenze,
          escludiDistribuzione: form.escludiDistribuzione,
          maxUSA: form.maxUSA,
        })
      });
      const data = await res.json();
      if (data.selezione) {
        setSpiegazione(data.spiegazione);
        setScenarioMacro(data.scenarioMacro || '');
        setBucketInfo(data.bucketInfo || null);
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
      const quantita = valAllocato && s.quotazioneAcquisto > 0
        ? Math.floor(valAllocato / s.quotazioneAcquisto)
        : (s.quantita || null);
      return { ...s, peso: pesoVal, quantita, _selected: isApproved };
    });
    await applicaPortafoglioAI(portfolioId, selezioneAggiornata, capitale || 0);

    // Salva i bucket se la pianificazione è attiva
    if (bucketInfo?.attivo) {
      await saveBuckets(portfolioId, [
        { tipo: 'BREVE', pct_allocazione: bucketInfo.breve.pct, orizzonte_anni: bucketInfo.breve.anni },
        { tipo: 'LUNGO', pct_allocazione: bucketInfo.lungo.pct, orizzonte_anni: bucketInfo.lungo.anni },
      ]);
    }

    // Salva il run AI per lo storico
    const consigliati = selezioneAggiornata.filter(s => s.tipo === 'consigliato' || !s.tipo);
    // Estrai rendimento atteso lordo dalla spiegazione — cerca prima nel blocco METRICHE strutturato
    const rendMatch = spiegazione?.match(/METRICHE:.*?rend_lordo:([\d.]+)%/i)
      || spiegazione?.match(/rend_lordo:([\d.]+)%/i)
      || spiegazione?.match(/rendimento[^:]*lordo[^:]*:?\s*[~≈]?(\d+[\.,]\d+)\s*%/i)
      || spiegazione?.match(/(\d+[\.,]\d+)\s*%\s*(?:lordo|annuo\s+lordo)/i);
    const rendAttesoLordo = rendMatch ? parseFloat(rendMatch[1].replace(',', '.')) : null;

    await saveAiRun({
      portfolioId,
      profilo: form?.profilo || '',
      orizzonte: form?.orizzonteAnni || null,
      capitale: capitale ? parseFloat(capitale) : null,
      scenarioMacro: scenarioMacro || null,
      // Campi input utente
      maxUsa: form?.maxUSA || null,
      preferenze: form?.preferenze || null,
      escludiDistribuzione: form?.escludiDistribuzione ?? true,
      bucketAttivo: bucketInfo?.attivo ?? false,
      bucketPctBreve: bucketInfo?.attivo ? bucketInfo.breve.pct : null,
      metriche: {
        nEtf: consigliati.length,
        terTotale: parseFloat(consigliati.reduce((t, s) => t + (s.ter || 0), 0).toFixed(2)),
        rendAttesoLordo,
      },
      etfSelezionati: consigliati.map(s => ({
        isin: s.isin,
        name: s.name,
        peso: s.peso,
        bucket: s.bucket || 'LUNGO',
        ter: s.ter,
        categoria: s.categoria,
        motivo: s.motivo,
      })),
      spiegazione,
    });

    onClose();
  };

  const nApprovate = Object.values(approvate).filter(Boolean).length;

  return (
    <div className="modal-overlay" onClick={e => e.stopPropagation()}>
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
              {/* Riga 1: Profilo + Orizzonte */}
              <div style={{ display:'flex', gap:12, marginBottom:12 }}>
                <div style={{ flex:1 }}>
                  <label className="form-label">Profilo di rischio</label>
                  <select className="input" value={form.profilo} onChange={e => setForm(f => ({ ...f, profilo: e.target.value }))}>
                    <option>Prudente</option>
                    <option>Bilanciato</option>
                    <option>Aggressivo</option>
                  </select>
                </div>
                <div style={{ flex:1 }}>
                  <label className="form-label">Orizzonte temporale</label>
                  <div style={{ display:'flex', gap:6, marginTop:4 }}>
                    {[['BREVE','< 5 anni'],['MEDIO','5-10 anni'],['LUNGO','> 10 anni']].map(([val,lab]) => (
                      <div key={val} onClick={() => {
                        setForm(f => ({...f, orizzonteAnni: val}));
                        // Aggiorna pctBreve al default del nuovo orizzonte se era al default precedente
                        setBucket(b => {
                          const prevDefault = form.orizzonteAnni === 'LUNGO' ? 30 : 20;
                          const newDefault  = val === 'LUNGO' ? 30 : 20;
                          if (b.pctBreve === prevDefault) return {...b, pctBreve: newDefault};
                          return b;
                        });
                      }}
                        style={{ flex:1, padding:'6px 8px', borderRadius:8, border:`1px solid ${form.orizzonteAnni===val?'var(--accent-blue)':'var(--border)'}`,
                          background: form.orizzonteAnni===val?'rgba(59,130,246,0.1)':'var(--bg-primary)',
                          cursor:'pointer', textAlign:'center' }}>
                        <div style={{ fontSize:11, fontWeight:700, color: form.orizzonteAnni===val?'var(--accent-blue)':'var(--text-primary)' }}>{val}</div>
                        <div style={{ fontSize:10, color:'var(--text-muted)' }}>{lab}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Riga 2: Capitale + Max USA */}
              <div style={{ display:'flex', gap:12, marginBottom:12 }}>
                <div style={{ flex:1 }}>
                  <label className="form-label">Capitale (€) — opzionale</label>
                  <input className="input" type="number" min="0" placeholder="Es: 10000"
                    value={form.capitale} onChange={e => setForm(f => ({ ...f, capitale: e.target.value }))} />
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:3 }}>Quote calcolate automaticamente</div>
                </div>
                <div style={{ flex:1 }}>
                  <label className="form-label">Limite USA — opzionale</label>
                  <select className="input" value={form.maxUSA} onChange={e => setForm(f => ({ ...f, maxUSA: e.target.value }))}>
                    <option value="No max">Nessun limite</option>
                    <option value="60%">Max 60%</option>
                    <option value="30%">Max 30%</option>
                    <option value="0%">Nessuna esposizione USA</option>
                  </select>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:3 }}>Esposizione stimata agli ETF USA</div>
                </div>
              </div>
              {/* Riga 3: Preferenze (campo largo) */}
              <div style={{ marginBottom:12 }}>
                <label className="form-label">Preferenze o note — opzionale</label>
                <input className="input" placeholder="Es: preferisco ETF a basso TER, voglio 1 ETF Oil&Gas..."
                  value={form.preferenze} onChange={e => setForm(f => ({ ...f, preferenze: e.target.value }))} />
              </div>
              {/* Checkbox distribuzione */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderTop:'1px solid var(--border)' }}>
                <input type="checkbox" id="escludiDistr" checked={form.escludiDistribuzione}
                  onChange={e => setForm(f => ({ ...f, escludiDistribuzione: e.target.checked }))}
                  style={{ width:16, height:16, cursor:'pointer', accentColor:'var(--accent-gold)' }} />
                <label htmlFor="escludiDistr" style={{ fontSize:13, cursor:'pointer', userSelect:'none' }}>
                  Escludi ETF a <strong>Distribuzione</strong>
                  <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:6 }}>(preferisci Accumulazione per fiscalità italiana)</span>
                </label>
              </div>
              {/* Pianificazione a due orizzonti */}
              {(() => {
                const isPrudente = form.profilo === 'Prudente';
                const isBreve    = form.orizzonteAnni === 'BREVE';
                const isMedio    = form.orizzonteAnni === 'MEDIO';
                const isLungo    = form.orizzonteAnni === 'LUNGO';

                // Regole di disponibilità
                const bucketDisponibile = !isPrudente && !isBreve;

                // Limiti % bucket breve per orizzonte
                const MAX_PCT_BREVE = 40; // max fisso uguale per tutti
                const defaultPctBreve = isLungo ? 30 : 20; // default per orizzonte

                // Valore effettivo: mai oltre il max fisso
                const pctBreveEffettiva = Math.min(bucket.pctBreve, MAX_PCT_BREVE);

                if (!bucketDisponibile) {
                  return (
                    <div style={{ padding:'10px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-secondary)', marginTop:8, opacity:0.6 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:13, fontWeight:600, color:'var(--text-muted)' }}>🪣 Pianificazione a due orizzonti</span>
                        <span style={{ fontSize:11, color:'var(--text-muted)' }}>
                          {isPrudente ? '— non disponibile per profilo Prudente' : '— non disponibile con orizzonte Breve'}
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div style={{ padding:'10px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-secondary)', marginTop:8 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', marginBottom: bucket.attivo ? 10 : 0 }}>
                      <input type="checkbox" checked={bucket.attivo}
                        onChange={e => setBucket(b => ({
                          ...b,
                          attivo: e.target.checked,
                          pctBreve: b.pctBreve || defaultPctBreve, // usa default se non impostato
                          filosofia: b.filosofia || 'difensiva',
                        }))}
                        style={{ width:16, height:16, cursor:'pointer', accentColor:'var(--accent-blue)' }} />
                      <span style={{ fontSize:13, fontWeight:600 }}>🪣 Pianificazione a due orizzonti</span>
                      <span style={{ fontSize:11, color:'var(--text-muted)' }}>— opzionale</span>
                    </label>

                    {bucket.attivo && (
                      <div>
                        {/* Filosofia bucket */}
                        <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                          {[
                            { val:'difensiva', emoji:'🛡️', label:'Difensivo', desc:'Proteggi il capitale a breve termine' },
                            { val:'opportunistica', emoji:'⚡', label:'Opportunistico', desc: isMedio ? 'Liquidità tattica (max 20%)' : 'Liquidità per acquisti a sconto' },
                          ].map(f => (
                            <div key={f.val}
                              onClick={() => setBucket(b => ({...b, filosofia: f.val}))}
                              style={{ flex:1, padding:'8px 10px', borderRadius:8, cursor:'pointer',
                                border:`1px solid ${(bucket.filosofia||'difensiva')===f.val ? 'var(--accent-blue)' : 'var(--border)'}`,
                                background:(bucket.filosofia||'difensiva')===f.val ? 'rgba(59,130,246,0.08)' : 'var(--bg-primary)' }}>
                              <div style={{ fontSize:12, fontWeight:700, color:(bucket.filosofia||'difensiva')===f.val ? 'var(--accent-blue)' : 'var(--text-primary)', marginBottom:2 }}>
                                {f.emoji} {f.label}
                              </div>
                              <div style={{ fontSize:10, color:'var(--text-muted)' }}>{f.desc}</div>
                            </div>
                          ))}
                        </div>

                        {/* Slider percentuale */}
                        <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>
                          {(bucket.filosofia||'difensiva') === 'difensiva'
                            ? 'Il bucket breve viene popolato con ETF difensivi (monetario, obbligazionario breve, low vol).'
                            : 'Il bucket breve mantiene liquidità tattica da impiegare in caso di cali di mercato.'}
                          {isMedio && <span style={{ color:'var(--accent-amber)' }}> Con orizzonte medio, default 20% consigliato.</span>}
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                          <span style={{ color:'var(--accent-blue)', fontWeight:600 }}>🔵 Breve: {pctBreveEffettiva}%</span>
                          <span style={{ color:'var(--accent-amber)', fontWeight:600 }}>🟡 Lungo: {100-pctBreveEffettiva}%</span>
                        </div>
                        <input type="range" min={10} max={MAX_PCT_BREVE} step={5} value={pctBreveEffettiva}
                          onChange={e => setBucket(b => ({...b, pctBreve: parseInt(e.target.value)}))}
                          style={{ width:'100%', accentColor:'var(--accent-blue)', marginBottom:2 }} />
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-muted)', marginBottom:8 }}>
                          <span>min 10%</span>
                          <span>max 40%</span>
                        </div>

                        {/* Orizzonte breve */}
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:11, color:'var(--text-muted)' }}>Orizzonte breve (anni):</span>
                          <input className="input" type="number" min={1} max={5} value={bucket.anniBreve}
                            onChange={e => setBucket(b => ({...b, anniBreve: parseInt(e.target.value)||1}))}
                            style={{ fontSize:12, padding:'3px 8px', width:60 }} />
                          <span style={{ fontSize:11, color:'var(--text-muted)' }}>
                            · Lungo usa orizzonte {form.orizzonteAnni === 'LUNGO' ? 'oltre 10 anni' : '5-10 anni'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {errore && <div className="alert alert-warning">⚠️ {errore}</div>}
              <div className="alert alert-info" style={{ fontSize: 12 }}>
                ⚠️ Le selezioni attuali verranno sostituite con quelle consigliate dall AI.
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

                // Rendimento atteso lordo: estratto dal testo AI (prima dal campo strutturato METRICHE, poi dal testo libero)
                const rendMatch = spiegazione.match(/rend_lordo:(\d+[\.,]\d+)%/i)
                  || spiegazione.match(/rendimento[^:]*lordo[^:]*:?\s*[~≈]?(\d+[\.,]\d+)\s*%/i)
                  || spiegazione.match(/rendimento[^:]*atteso[^:]*:?\s*[~≈]?(\d+[\.,]\d+)\s*%\s*lordo/i)
                  || spiegazione.match(/(\d+[\.,]\d+)\s*%\s*(?:lordo|annuo\s+lordo)/i);
                const rendAtteso = rendMatch ? rendMatch[1].replace(',', '.') : null;

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

                // Mappa % USA stimata per categoria
                const USA_PCT_MAP = {
                  // Esplicitamente USA
                  'azionario usa': 100,
                  // Globale con forte componente USA
                  'azionario globale': 70,
                  'azionario - smart beta': 60,
                  'azionario - dividend': 50,
                  // Tematici
                  'azionario tematico - tecnologia': 80,
                  'azionario tematico - salute': 60,
                  'azionario tematico - esg/green': 50,
                  'azionario tematico - immobiliare': 50,
                  'azionario tematico - energia': 30,
                  'azionario tematico - finanziario': 40,
                  'azionario tematico - consumi': 40,
                  'azionario tematico - infrastrutture': 30,
                  'azionario - small/mid cap': 50,
                  // Zero USA
                  'azionario europa': 0,
                  'azionario emergenti': 0,
                  'azionario pacifico': 0,
                  'azionario tematico': 40, // fallback tematico generico
                  // Non azionario
                  'obbligazionario governativo': 5,   // Gov europeo/globale
                  'obbligazionario corporate': 15,    // Corporate mix globale
                  'obbligazionario high yield': 20,   // HY spesso USA-heavy
                  'obbligazionario emergenti': 0,     // EM bonds
                  'obbligazionario': 10,              // fallback generico
                  'materie prime': 0,
                  'liquidità / monetario': 0,
                  'immobiliare': 50,
                };
                const getUsaPct = (s) => {
                  const cat = (s.categoria || '').toLowerCase();
                  const nome = (s.name || '').toLowerCase();
                  // Override per nome esplicito — azionario
                  if (nome.includes('s&p') || nome.includes('nasdaq') || nome.includes('russell') || nome.includes('dow jones')) return 100;
                  if (nome.includes('ftse 100') || nome.includes('dax') || nome.includes('cac') || nome.includes('stoxx') || nome.includes('ftse mib')) return 0;
                  if (nome.includes('nikkei') || nome.includes('topix') || nome.includes('japan') || nome.includes('pacific')) return 0;
                  if (nome.includes('emerging') || nome.includes('emergenti')) return 0;
                  // Override per Treasury USA — alto rischio paese USA
                  if (nome.includes('us treasury') || nome.includes('usd treasury') || nome.includes('treasury bond') ||
                      nome.includes('treasury bill') || nome.includes('t-bill') || nome.includes('tips') ||
                      nome.includes('us govt') || nome.includes('us government') || nome.includes('united states bond') ||
                      (nome.includes('treasury') && !nome.includes('euro') && !nome.includes('bund'))) return 70;
                  // Override per obbligazionario europeo puro
                  if (nome.includes('btp') || nome.includes('bund') || nome.includes('oat ') || nome.includes('gilt') ||
                      nome.includes('euro government') || nome.includes('eur government') ||
                      nome.includes('eurozone') || nome.includes('euro aggregate')) return 0;
                  // Cerca nella mappa per corrispondenza esatta o parziale (più specifico prima)
                  const keysOrdinati = Object.keys(USA_PCT_MAP).sort((a,b) => b.length - a.length);
                  for (const key of keysOrdinati) {
                    if (cat.includes(key)) return USA_PCT_MAP[key];
                  }
                  return 0;
                };

                // Calcola esposizione USA stimata portafoglio
                let expUSA = 0;
                consigliati.forEach(s => {
                  const i = selezione.indexOf(s);
                  const p = parseFloat(pesi[i]) || s.peso || 0;
                  expUSA += p * getUsaPct(s) / 100;
                });
                expUSA = Math.round(expUSA);

                // Calcola asset class e valute
                const getMacroAsset = (s) => {
                  const cat = (s.categoria || '').toLowerCase();
                  const nome = (s.name || '').toLowerCase();
                  // IMPORTANTE: obbligazionario PRIMA di azionario perché "obbligazionario" contiene "azionario"
                  if (cat.startsWith('obbligaz') || cat.includes('bond') || cat.includes('corporate') || cat.includes('government') || cat.includes('high yield') || cat.includes('aggregate') || cat.includes('liquidit') || cat.includes('monetar') || cat.includes('overnight')) return cat.includes('liquidit') || cat.includes('monetar') || cat.includes('overnight') ? 'Liquidità' : 'Obbligazionario';
                  if (cat.includes('azionario')) return 'Azionario';
                  if (cat.includes('materie') || cat.includes('commodity') || cat.includes('gold') || cat.includes('oro') || cat.includes('metal')) return 'Materie Prime';
                  if (cat.includes('immobil') || cat.includes('reit')) return 'Immobiliare';
                  return 'Altro';
                };
                const assetPeso = {};
                const valutePeso = {};
                consigliati.forEach(s => {
                  const i = selezione.indexOf(s);
                  const p = parseFloat(pesi[i]) || s.peso || 0;
                  const a = getMacroAsset(s);
                  assetPeso[a] = (assetPeso[a] || 0) + p;
                  const v = s.valuta || 'EUR';
                  valutePeso[v] = (valutePeso[v] || 0) + p;
                });
                const topAsset = Object.entries(assetPeso).sort((a,b) => b[1]-a[1]);
                const topValute = Object.entries(valutePeso).sort((a,b) => b[1]-a[1]).slice(0,3);
                const assetColor = { 'Azionario':'var(--accent-gold)', 'Obbligazionario':'var(--accent-blue)', 'Materie Prime':'var(--accent-amber)', 'Liquidità':'var(--accent-green)', 'Immobiliare':'#a78bfa', 'Altro':'var(--text-muted)' };

                return (
                  <div style={{ background:'var(--bg-secondary)', borderRadius:10, padding:'14px 16px', marginBottom:20, border:'1px solid var(--border)' }}>
                    {logica && <p style={{ fontSize:13, color:'var(--text-secondary)', lineHeight:1.6, margin:'0 0 12px 0' }}>{logica}</p>}

                    {/* Layout: Categorie (sinistra) | Colonna destra (Asset+Valute+Pills) */}
                    <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                      {/* Categorie dettagliate — leggermente più strette */}
                      {Object.keys(catCount).length > 0 && (
                        <div style={{ background:'var(--bg-primary)', borderRadius:8, padding:'8px 12px', border:'1px solid var(--border)', flex:'0 0 52%', alignSelf:'stretch' }}>
                          <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:5 }}>
                            Categorie ({macroDistinte.size} macro-aree)
                          </div>
                          {Object.entries(catCount).map(([cat, n]) => (
                            <div key={cat} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11, marginBottom:2 }}>
                              <span style={{ color:'var(--text-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:160 }}>{cat}</span>
                              <span style={{ display:'flex', gap:6, marginLeft:6, flexShrink:0 }}>
                                <span style={{ color:'var(--text-muted)' }}>{n} ETF</span>
                                <span style={{ fontWeight:700, color:'var(--accent-gold)', minWidth:32, textAlign:'right' }}>{Math.round(catPeso[cat])}%</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Colonna destra: Asset Class + Valute + Pills (inclusa USA) */}
                      <div style={{ display:'flex', flexDirection:'column', gap:8, flex:1 }}>
                        {/* Asset Class */}
                        {topAsset.length > 0 && (
                          <div style={{ background:'var(--bg-primary)', borderRadius:8, padding:'8px 12px', border:'1px solid var(--border)' }}>
                            <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:5 }}>Split per Asset Class</div>
                            {topAsset.map(([asset, peso]) => (
                              <div key={asset} style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}>
                                <span style={{ color:'var(--text-primary)' }}>{asset}</span>
                                <span style={{ fontWeight:700, color: assetColor[asset] || 'var(--text-primary)', minWidth:36, textAlign:'right' }}>{Math.round(peso)}%</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Valute */}
                        {topValute.length > 0 && (
                          <div style={{ background:'var(--bg-primary)', borderRadius:8, padding:'8px 12px', border:'1px solid var(--border)' }}>
                            <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:5 }}>Valuta di scambio (top {topValute.length})</div>
                            {topValute.map(([valuta, peso]) => (
                              <div key={valuta} style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}>
                                <span style={{ color:'var(--text-primary)' }}>{valuta}</span>
                                <span style={{ fontWeight:700, color:'var(--accent-green)', minWidth:36, textAlign:'right' }}>{Math.round(peso)}%</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Pills riga 1: ETF · TER · Corr · Exp.USA · Rend.lordo */}
                        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                          <Pill label="ETF" value={consigliati.length} color="var(--accent-gold)" />
                          <Pill label="TER tot." value={terTotale.toFixed(2)+'%'} color={terTotale > 1 ? 'var(--accent-amber)' : 'var(--accent-green)'} />
                          {corrMax && <Pill label="Corr.max" value={corrMax} color={parseFloat(corrMax) > 0.6 ? 'var(--accent-amber)' : 'var(--accent-green)'} />}
                          <Pill label="Exp.USA~" value={expUSA+'%'} color={expUSA > 60 ? 'var(--accent-red)' : expUSA > 30 ? 'var(--accent-amber)' : 'var(--accent-green)'} />
                        </div>

                        {/* Riga 2: Vol pond. 5A, DD pond. 5A, Smart Beta, Scenario */}
                        {(() => {
                          const totPeso = consigliati.reduce((s, e) => s + (parseFloat(e.peso) || 0), 0);

                          // Volatilità media PONDERATA sui pesi degli ETF consigliati
                          const volPond = totPeso > 0
                            ? consigliati.reduce((sum, s) => {
                                const v = parseFloat(s.variabilita) || 0;
                                const p = (parseFloat(s.peso) || 0) / totPeso;
                                return sum + v * p;
                              }, 0)
                            : 0;

                          // Drawdown medio PONDERATO — usa maxDrawdown5y se disponibile, altrimenti maxDrawdown
                          const ddPond = totPeso > 0
                            ? consigliati.reduce((sum, s) => {
                                const v = Math.abs(parseFloat(s.maxDrawdown5y || s.maxDrawdown) || 0);
                                const p = (parseFloat(s.peso) || 0) / totPeso;
                                return sum + v * p;
                              }, 0)
                            : 0;

                          // Smart Beta: conta ETF con fattore e lista categorie uniche
                          const sbMap = {};
                          consigliati.forEach(s => {
                            if (s.smartBeta && s.smartBeta !== 'ESG') {
                              sbMap[s.smartBeta] = (sbMap[s.smartBeta] || 0) + 1;
                            }
                          });
                          const sbList = Object.entries(sbMap);
                          const sbTot = sbList.reduce((t, [, n]) => t + n, 0);

                          // Scenario macro — letto dal backend (scenarioMacro nello stato)
                          const scenarioLabel = scenarioMacro
                            ? scenarioMacro.replace(/_/g, ' ')
                            : 'NEUTRO';
                          const scenColore = scenarioLabel.includes('CRISI') ? 'var(--accent-red)'
                            : scenarioLabel.includes('STAGFLAZ') || scenarioLabel.includes('SHOCK') ? 'var(--accent-amber)'
                            : scenarioLabel.includes('ESPANSIONE') || scenarioLabel.includes('EASING') ? 'var(--accent-green)'
                            : 'var(--text-muted)';

                          return (
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:2 }}>
                              <Pill label="Vol. pond."
                                value={volPond > 0 ? volPond.toFixed(1)+'%' : 'N/D'}
                                color={volPond > 16 ? 'var(--accent-red)' : volPond > 10 ? 'var(--accent-amber)' : 'var(--accent-green)'} />
                              <Pill label="DD pond."
                                value={ddPond > 0 ? '-'+ddPond.toFixed(1)+'%' : 'N/D'}
                                color={ddPond > 25 ? 'var(--accent-red)' : ddPond > 15 ? 'var(--accent-amber)' : 'var(--accent-green)'} />
                              {rendAtteso && <Pill label="Rend. lordo~" value={rendAtteso+'%'} color={parseFloat(rendAtteso) < 3 ? 'var(--accent-red)' : parseFloat(rendAtteso) > 10 ? 'var(--accent-amber)' : 'var(--accent-green)'} />}
                              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', background:'var(--bg-primary)', borderRadius:8, padding:'8px 12px', border:'1px solid var(--border)', minWidth:90 }}>
                                <span style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:2 }}>Smart Beta</span>
                                <span style={{ fontSize:13, fontWeight:700, color:'#7030A0' }}>
                                  {sbTot > 0 ? `${sbTot} ETF` : '—'}
                                </span>
                                {sbList.length > 0 && (
                                  <span style={{ fontSize:9, color:'var(--text-muted)', textAlign:'center', marginTop:2, lineHeight:1.2 }}>
                                    {sbList.map(([k]) => k).join(', ')}
                                  </span>
                                )}
                              </div>
                              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', background:'var(--bg-primary)', borderRadius:8, padding:'8px 12px', border:'1px solid var(--border)', minWidth:110 }}>
                                <span style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:2 }}>Scenario Macro</span>
                                <span style={{ fontSize:11, fontWeight:700, color: scenColore, textAlign:'center' }}>{scenarioLabel}</span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
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


                            {/* Consigliati — raggruppati per bucket se attivo */}
              {(() => {
                const renderEtf = (s, i) => {
                  const nome = s.name || s.isin;
                  const pesoVal = parseFloat(pesi[i]) || 0;
                  const valAllocato = capitale ? (capitale * pesoVal / 100) : null;
                  const qtCalcolata = valAllocato && s.quotazioneAcquisto ? Math.floor(valAllocato / s.quotazioneAcquisto) : s.quantita || null;
                  const bucketColore = s.bucket === 'BREVE' ? 'var(--accent-blue)' : s.bucket === 'LUNGO' ? 'var(--accent-amber)' : null;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                      <input type="checkbox" checked={!!approvate[i]}
                        onChange={() => setApprovate(a => ({ ...a, [i]: !a[i] }))}
                        style={{ marginTop: 4, cursor: 'pointer', width: 16, height: 16 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span className="tag-consigliato">★ Top</span>
                          {bucketInfo?.attivo && s.bucket && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                              background: s.bucket === 'BREVE' ? 'rgba(59,130,246,0.12)' : 'rgba(251,191,36,0.12)',
                              color: bucketColore, border: `1px solid ${bucketColore}` }}>
                              {s.bucket === 'BREVE' ? '🔵' : '🟡'} {s.bucket}
                            </span>
                          )}
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
                };

                const consigliatiList = selezione.map((s, i) => ({ s, i }))
                  .filter(({ s }) => s.tipo === 'consigliato' || !s.tipo);

                if (bucketInfo?.attivo) {
                  const breve = consigliatiList.filter(({ s }) => s.bucket === 'BREVE');
                  const lungo = consigliatiList.filter(({ s }) => s.bucket === 'LUNGO' || !s.bucket);
                  const renderGruppo = (lista, label, colore, pct, anni) => (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
                        background: colore === 'blue' ? 'rgba(59,130,246,0.08)' : 'rgba(251,191,36,0.08)',
                        borderRadius:'8px 8px 0 0', borderBottom:'2px solid ' + (colore === 'blue' ? 'var(--accent-blue)' : 'var(--accent-amber)') }}>
                        <span style={{ fontSize:16 }}>{colore === 'blue' ? '🔵' : '🟡'}</span>
                        <span style={{ fontWeight:700, fontSize:13, color: colore === 'blue' ? 'var(--accent-blue)' : 'var(--accent-amber)' }}>
                          Bucket {label}
                        </span>
                        <span style={{ fontSize:11, color:'var(--text-muted)' }}>
                          {pct}% del capitale · orizzonte {anni} {anni === 1 ? 'anno' : 'anni'}
                        </span>
                        <span style={{ marginLeft:'auto', fontSize:11, color:'var(--text-muted)' }}>
                          {lista.length} ETF
                        </span>
                      </div>
                      {lista.map(({ s, i }) => renderEtf(s, i))}
                    </div>
                  );
                  return (
                    <>
                      {renderGruppo(breve, 'BREVE', 'blue', bucketInfo.breve.pct, bucketInfo.breve.anni)}
                      {renderGruppo(lungo, 'LUNGO', 'amber', bucketInfo.lungo.pct, bucketInfo.lungo.anni)}
                    </>
                  );
                }
                return consigliatiList.map(({ s, i }) => renderEtf(s, i));
              })()}

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
