import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

const SEMAFORO_COLOR = { VERDE: '#22c55e', GIALLO: '#f59e0b', ROSSO: '#ef4444' };
const SEMAFORO_EMOJI = { VERDE: '🟢', GIALLO: '🟡', ROSSO: '🔴' };
const SEM_LABELS = {
  diversificazione: 'Diversificazione', volatilita: 'Volatilità',
  drawdown: 'Max Drawdown', ter: 'Costi TER', azionario: 'Quota Azionaria',
  correlazione: 'Correlazione',
};

function SemaforoRow({ k, v }) {
  const stato = (typeof v === 'object' ? v?.stato : v) || '';
  const commento = (typeof v === 'object' ? v?.commento : '') || '';
  const col = SEMAFORO_COLOR[stato.toUpperCase()] || '#6b7280';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
      <span style={{ fontSize:16, flexShrink:0 }}>{SEMAFORO_EMOJI[stato.toUpperCase()] || '⚪'}</span>
      <span style={{ fontSize:12, fontWeight:700, width:130, color:'var(--text-primary)' }}>{SEM_LABELS[k] || k}</span>
      <span style={{ fontSize:11, fontWeight:700, color:col, width:52 }}>{stato.toUpperCase()}</span>
      <span style={{ fontSize:11, color:'var(--text-secondary)', flex:1 }}>{commento}</span>
    </div>
  );
}

function AIModal({ portfolio, onClose }) {
  const { token, loadPortfoliosFromDB, currentUser } = useApp();
  // Step pre-analisi
  const [step, setStep] = useState('form'); // 'form' | 'analisi'
  const [opzioni, setOpzioni] = useState({
    obiettivo: 'completa',
    disponibilita: 'moderato',
    sogliaVendita: '',
    maxUSA: portfolio?.maxUSA || 'No max',
    note: '',
  });
  const [semafori, setSemafori] = useState(null);
  const [puntiChiave, setPuntiChiave] = useState([]);
  const [analisiDettagliata, setAnalisiDettagliata] = useState('');
  const [modifiche, setModifiche] = useState([]);
  const [approvate, setApprovate] = useState({});
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [errore, setErrore] = useState('');
  const [applicate, setApplicate] = useState(false);
  const orizAnni = portfolio?.orizzonteAnni || 7;
  const [orizzonte, setOrizzonte] = useState(orizAnni <= 4 ? 'BREVE' : orizAnni >= 10 ? 'LUNGO' : 'MEDIO');
  const [bucket, setBucket] = useState({ attivo: false, pctBreve: 30, anniBreve: 3 });
  const [showAnalisi, setShowAnalisi] = useState(false);
  const [showModifiche, setShowModifiche] = useState(true);

  const authHdr = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const avviaAnalisi = async () => {
    setStep('analisi');
    setLoading(true);
    setErrore('');
    try {
      const res = await fetch(`${API}/api/ai/analisi`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ portfolio: { ...portfolio, orizzonteAnni: orizzonte === 'BREVE' ? 3 : orizzonte === 'LUNGO' ? 15 : 7, orizzonteLabel: orizzonte }, opzioni, bucketBreve: bucket.attivo ? { pct: bucket.pctBreve, anni: bucket.anniBreve } : undefined, bucketLungo: bucket.attivo ? { pct: 100 - bucket.pctBreve, anni: orizzonte === 'LUNGO' ? 15 : 7 } : undefined }),
      });
      const data = await res.json();
      if (data.semafori || data.analisiDettagliata) {
        setSemafori(data.semafori || null);
        setPuntiChiave(data.puntiChiave || []);
        setAnalisiDettagliata(data.analisiDettagliata || '');
        setModifiche(data.modifiche || []);
        const init = {};
        (data.modifiche || []).forEach((_, i) => { init[i] = true; });
        setApprovate(init);
      } else {
        setErrore(data.error || 'Risposta non valida dal server');
      }
    } catch (err) {
      setErrore('Server non raggiungibile.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplica = async () => {
    setApplying(true);
    const oggi = new Date().toISOString().slice(0, 10);
    const modificheApprovate = modifiche.filter((_, i) => approvate[i]);

    // Step 1: applica selezioni/deseleziona/aggiungi
    const etfsAggiornati = portfolio.etfs.map(e => ({ ...e }));
    for (const m of modificheApprovate) {
      if (m.azione === 'seleziona') {
        const etf = etfsAggiornati.find(e => e.isin === m.isin);
        if (etf) etf.selected = true;
      } else if (m.azione === 'deseleziona') {
        const etf = etfsAggiornati.find(e => e.isin === m.isin);
        if (etf) { etf.selected = false; etf.acquisto = null; }
      } else if (m.azione === 'aggiungi') {
        // Cerca quotazione: 1) dal JSON AI, 2) tra gli ETF non selezionati del portafoglio, 3) ETF_MASTER
        const quotazioneFallback = portfolio.etfs.find(e => e.isin === m.isin)?.quotazione || 0;
        const quotazione = m.quotazione > 0 ? m.quotazione : quotazioneFallback;
        if (!etfsAggiornati.find(e => e.isin === m.isin)) {
          etfsAggiornati.push({ isin: m.isin, name: m.name || m.isin, selected: true,
            tipo: 'consigliato', ter: m.ter || 0, quotazione,
            categoria: m.categoria || 'Altro', valuta: 'EUR',
            perf1m:0, perf6m:0, perf1y:0, perf5y:0, capitalizzazione:0, variabilita:0, maxDrawdown:0 });
        } else {
          const etf = etfsAggiornati.find(e => e.isin === m.isin);
          if (etf) { etf.selected = true; if (quotazione > 0) etf.quotazione = quotazione; }
        }
      }
    }

    // Step 2: redistribuisci il capitale TOTALE proporzionalmente su tutti gli ETF selezionati finali
    const totInvestitoOriginale = portfolio.etfs
      .filter(e => e.selected && e.acquisto?.quantita > 0)
      .reduce((s, e) => s + e.acquisto.quantita * e.acquisto.quotazioneAcquisto, 0);

    if (totInvestitoOriginale > 0) {
      const etfSelezionatiFinali = etfsAggiornati.filter(e => e.selected);
      const nEtf = etfSelezionatiFinali.length;
      if (nEtf > 0) {
        // Calcola il "peso originale" di ogni ETF ancora selezionato
        // ETF già esistenti: mantengono il peso relativo originale
        // ETF nuovi (aggiunti/selezionati): ricevono peso uguale alla media
        const totOriginaleRimasto = etfSelezionatiFinali
          .filter(e => e.acquisto?.quantita > 0)
          .reduce((s, e) => s + e.acquisto.quantita * e.acquisto.quotazioneAcquisto, 0);
        const nNuovi = etfSelezionatiFinali.filter(e => !(e.acquisto?.quantita > 0)).length;
        // Peso medio da assegnare ai nuovi: capitaleTotale / nEtf
        const pesoMedioNuovi = totInvestitoOriginale / nEtf;
        // Fattore di scala per gli ETF esistenti: devono coprire il rimanente dopo i nuovi
        const capitalePerEsistenti = totInvestitoOriginale - (nNuovi * pesoMedioNuovi);
        const scaleFactor = totOriginaleRimasto > 0 ? capitalePerEsistenti / totOriginaleRimasto : 1;

        etfSelezionatiFinali.forEach(e => {
          const prezzo = e.quotazione || e.acquisto?.quotazioneAcquisto || 0;
          if (!prezzo) {
            console.warn('[redistribuisci] ETF senza prezzo, skippato:', e.isin);
            return;
          }
          let capitaleTarget;
          if (e.acquisto?.quantita > 0) {
            // ETF esistente: scala proporzionalmente
            capitaleTarget = e.acquisto.quantita * e.acquisto.quotazioneAcquisto * scaleFactor;
          } else {
            // ETF nuovo: peso medio
            capitaleTarget = pesoMedioNuovi;
          }
          const quantita = Math.floor(capitaleTarget / prezzo);
          if (quantita > 0) {
            e.acquisto = { quantita, quotazioneAcquisto: prezzo, dataAcquisto: oggi };
          }
        });
      }
    }

    const etfsPayload = etfsAggiornati.map(e => ({ isin:e.isin, selected:e.selected, tipo:e.tipo||'consigliato', quotazione:e.quotazione||0 }));
    const acquistiPayload = etfsAggiornati
      .filter(e => e.selected && e.acquisto?.quantita > 0)
      .map(e => ({ isin:e.isin, quantita:e.acquisto.quantita, quotazioneAcquisto:e.acquisto.quotazioneAcquisto, dataAcquisto:e.acquisto.dataAcquisto || oggi }));
    const prezziPayload = etfsAggiornati.filter(e => (e.quotazione||0) > 0).map(e => ({ isin:e.isin, prezzo:e.quotazione }));

    const totFinale = acquistiPayload.reduce((s, a) => s + a.quantita * a.quotazioneAcquisto, 0);
    console.log(`[analisi apply] Capitale originale: €${totInvestitoOriginale.toFixed(0)} → finale: €${totFinale.toFixed(0)} (${etfsAggiornati.filter(e=>e.selected).length} ETF)`);

    await fetch(`${API}/api/portfolios/${portfolio.id}/apply-ai`, {
      method:'POST', headers:authHdr,
      body:JSON.stringify({ etfs:etfsPayload, acquisti:acquistiPayload, prezzi:prezziPayload }),
    }).catch(err => console.error('[analisi apply]', err));

    await loadPortfoliosFromDB(token, currentUser?.id);
    setApplicate(true);
    setApplying(false);
    setTimeout(() => onClose(), 1500);
  };

  const handlePDF = async () => {
    setPdfLoading(true);
    try {
      const res = await fetch(`${API}/api/ai/genera-pdf`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ portfolio, semafori, puntiChiave, analisiDettagliata, modifiche }),
      });
      if (!res.ok) throw new Error('Errore generazione PDF');
      const html = await res.text();
      // Apri in nuova finestra → Ctrl+P → Salva come PDF
      const win = window.open('', '_blank');
      win.document.write(html);
      win.document.close();
      // Avvia print dialog automaticamente dopo il rendering
      setTimeout(() => win.print(), 600);
    } catch (e) {
      alert('Errore generazione PDF: ' + e.message);
    } finally {
      setPdfLoading(false);
    }
  };

  const nApprovate = Object.values(approvate).filter(Boolean).length;

  // Calcola giudizio globale dai semafori
  const giudizioGlobale = semafori ? (() => {
    const stati = Object.values(semafori).map(v => (typeof v === 'object' ? v?.stato : v) || '');
    if (stati.some(s => s.toUpperCase() === 'ROSSO')) return 'ROSSO';
    if (stati.some(s => s.toUpperCase() === 'GIALLO')) return 'GIALLO';
    return 'VERDE';
  })() : null;

  const renderAnalisiTesto = (testo) => testo.split('\n').map((riga, i) => {
    if (!riga.trim()) return <div key={i} style={{ height:6 }} />;
    if (riga.startsWith('## ') || riga.startsWith('# '))
      return <div key={i} style={{ fontFamily:'DM Serif Display,serif', fontSize:14, color:'var(--accent-gold)', margin:'14px 0 4px', fontWeight:700 }}>{riga.replace(/^#+\s*/,'')}</div>;
    if (riga.startsWith('- ') || riga.startsWith('* '))
      return <div key={i} style={{ display:'flex', gap:8, margin:'3px 0', paddingLeft:8 }}><span style={{ color:'var(--accent-gold)', flexShrink:0 }}>•</span><span style={{ fontSize:13, lineHeight:1.6 }}>{riga.slice(2).replace(/\*\*(.*?)\*\*/g,'$1')}</span></div>;
    if (riga.startsWith('---'))
      return <hr key={i} style={{ border:'none', borderTop:'1px solid var(--border)', margin:'10px 0' }} />;
    return <p key={i} style={{ fontSize:13, lineHeight:1.7, margin:'3px 0', color:'var(--text-primary)' }}>{riga.replace(/\*\*(.*?)\*\*/g,'$1')}</p>;
  });

  const obiettivoLabel = {
    'completa': 'Analisi completa',
    'regole': 'Verifica conformità regole',
    'costi': 'Ottimizzazione costi (TER)',
    'rendimento': 'Massimizzazione rendimento',
    'rischio': 'Riduzione rischio/volatilità',
  };

  return (
    <div className="modal-overlay">
      <div className="modal"  style={{ minWidth:700, maxWidth:860, maxHeight:'90vh', display:'flex', flexDirection:'column' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexShrink:0 }}>
          <div>
            <div className="modal-title" style={{ marginBottom:2 }}>🤖 Analisi AI Portafoglio</div>
            <div style={{ fontSize:12, color:'var(--text-secondary)' }}>{portfolio.name} · powered by Claude</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {step === 'analisi' && analisiDettagliata && !loading && (
              <button className="btn btn-ghost" onClick={handlePDF} disabled={pdfLoading}
                style={{ fontSize:12, padding:'6px 12px', display:'flex', alignItems:'center', gap:6 }}>
                {pdfLoading ? '⏳' : '📄'} {pdfLoading ? 'Generando...' : 'Scarica PDF'}
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose} style={{ fontSize:18, padding:'4px 10px' }}>✕</button>
          </div>
        </div>

        {/* STEP 1 — Form pre-analisi */}
        {step === 'form' && (
          <div style={{ overflowY:'auto', flex:1, paddingRight:4 }}>
            <div style={{ background:'var(--bg-secondary)', borderRadius:10, padding:'16px 18px', marginBottom:16, border:'1px solid var(--border)' }}>
              <div style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:14, lineHeight:1.5 }}>
                Configura i parametri dell'analisi prima di avviarla. L'AI utilizzerà queste preferenze per personalizzare suggerimenti e modifiche proposte.
              </div>

              {/* Obiettivo */}
              <div style={{ marginBottom:16 }}>
                <label style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', display:'block', marginBottom:8 }}>Obiettivo dell'analisi</label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {[['completa','🔍 Analisi completa'],['regole','📋 Verifica regole'],['costi','💰 Ottimizza costi'],['rendimento','📈 Massimizza rendimento'],['rischio','🛡️ Riduci rischio']].map(([val, label]) => (
                    <button key={val} onClick={() => setOpzioni(o => ({...o, obiettivo: val}))}
                      style={{ padding:'7px 14px', borderRadius:20, border:`1px solid ${opzioni.obiettivo === val ? 'var(--accent-blue)' : 'var(--border)'}`,
                        background: opzioni.obiettivo === val ? 'var(--accent-blue)' : 'var(--bg-primary)',
                        color: opzioni.obiettivo === val ? '#fff' : 'var(--text-primary)', cursor:'pointer', fontSize:12, fontWeight: opzioni.obiettivo === val ? 600 : 400 }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Disponibilità modifiche */}
              <div style={{ marginBottom:16 }}>
                <label style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', display:'block', marginBottom:8 }}>Disponibilità alle modifiche</label>
                <div style={{ display:'flex', gap:8 }}>
                  {[['conservativo','🔒 Conservativo','Solo segnalazioni, nessuna modifica'],['moderato','⚖️ Moderato','Max 2 modifiche, preferisci ribilanciamenti'],['radicale','🔄 Radicale','Tutte le modifiche necessarie']].map(([val, label, desc]) => (
                    <div key={val} onClick={() => setOpzioni(o => ({...o, disponibilita: val}))}
                      style={{ flex:1, padding:'10px 12px', borderRadius:8, border:`1px solid ${opzioni.disponibilita === val ? 'var(--accent-blue)' : 'var(--border)'}`,
                        background: opzioni.disponibilita === val ? 'rgba(59,130,246,0.08)' : 'var(--bg-primary)', cursor:'pointer' }}>
                      <div style={{ fontSize:12, fontWeight:600, color: opzioni.disponibilita === val ? 'var(--accent-blue)' : 'var(--text-primary)', marginBottom:3 }}>{label}</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.4 }}>{desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Riga: Soglia P&L + Max USA */}
              <div style={{ display:'flex', gap:12, marginBottom:16 }}>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', display:'block', marginBottom:6 }}>Soglia min. P&L per vendita — opzionale</label>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <input type="number" className="input" placeholder="Es: -5 (non vendere se perdi più del 5%)"
                      value={opzioni.sogliaVendita} onChange={e => setOpzioni(o => ({...o, sogliaVendita: e.target.value}))}
                      style={{ flex:1 }} />
                    <span style={{ fontSize:12, color:'var(--text-muted)', flexShrink:0 }}>%</span>
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:3 }}>Valore negativo = soglia di perdita massima accettabile</div>
                </div>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', display:'block', marginBottom:6 }}>Limite esposizione USA</label>
                  <select className="input" value={opzioni.maxUSA} onChange={e => setOpzioni(o => ({...o, maxUSA: e.target.value}))}>
                    <option value="No max">Nessun limite</option>
                    <option value="60%">Max 60%</option>
                    <option value="30%">Max 30%</option>
                    <option value="0%">Nessuna esposizione USA</option>
                  </select>
                </div>
              </div>

              {/* Note libere */}
              <div style={{ marginBottom:8 }}>
                <label style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', display:'block', marginBottom:6 }}>Orizzonte temporale</label>
                <div style={{ display:'flex', gap:6, marginBottom:12 }}>
                  {[['BREVE','< 5 anni'],['MEDIO','5-10 anni'],['LUNGO','> 10 anni']].map(([val,lab]) => (
                    <div key={val} onClick={() => setOrizzonte(val)}
                      style={{ flex:1, padding:'7px 8px', borderRadius:8, cursor:'pointer', textAlign:'center',
                        border:'1px solid ' + (orizzonte===val ? 'var(--accent-blue)' : 'var(--border)'),
                        background: orizzonte===val ? 'rgba(59,130,246,0.1)' : 'var(--bg-primary)' }}>
                      <div style={{ fontSize:12, fontWeight:700, color: orizzonte===val ? 'var(--accent-blue)' : 'var(--text-primary)' }}>{val}</div>
                      <div style={{ fontSize:10, color:'var(--text-muted)' }}>{lab}</div>
                    </div>
                  ))}
                </div>

                <label style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', display:'block', marginBottom:6 }}>Note o preferenze — opzionale</label>
                <input type="text" className="input" placeholder="Es: voglio mantenere l'ETF Gold, evitare obbligazionario..."
                  value={opzioni.note} onChange={e => setOpzioni(o => ({...o, note: e.target.value}))} />
              </div>
            </div>

              <div style={{ marginBottom:8, padding:'10px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-secondary)' }}>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', marginBottom: bucket.attivo ? 10 : 0 }}>
                  <input type="checkbox" checked={bucket.attivo} onChange={e => setBucket(b => ({...b, attivo: e.target.checked}))} />
                  <span style={{ fontSize:12, fontWeight:600 }}>Strategia a due bucket</span>
                  <span style={{ fontSize:11, color:'var(--text-muted)' }}>— opzionale</span>
                </label>
                {bucket.attivo && (
                  <div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:4 }}>
                      <span style={{ color:'var(--accent-blue)', fontWeight:600 }}>BREVE: {bucket.pctBreve}%</span>
                      <span style={{ color:'var(--accent-amber)', fontWeight:600 }}>LUNGO: {100-bucket.pctBreve}%</span>
                    </div>
                    <input type="range" min={10} max={80} step={5} value={bucket.pctBreve}
                      onChange={e => setBucket(b => ({...b, pctBreve: parseInt(e.target.value)}))}
                      style={{ width:'100%', accentColor:'var(--accent-blue)', marginBottom:8 }} />
                    <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:3 }}>Orizzonte breve (anni, max 5)</div>
                    <input className="input" type="number" min={1} max={5} value={bucket.anniBreve}
                      onChange={e => setBucket(b => ({...b, anniBreve: parseInt(e.target.value)||1}))}
                      style={{ fontSize:12, padding:'4px 8px', width:80 }} />
                  </div>
                )}
              </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, paddingTop:8, flexShrink:0 }}>
              <button className="btn btn-ghost" onClick={onClose}>Annulla</button>
              <button className="btn btn-primary" onClick={avviaAnalisi}
                style={{ display:'flex', alignItems:'center', gap:8 }}>
                🤖 Avvia Analisi AI
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 — Risultato analisi */}
        {step === 'analisi' && (
        <>
        <div style={{ overflowY:'auto', flex:1, paddingRight:4 }}>
          {/* Riepilogo parametri usati */}
          {!loading && (semafori || errore) && (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12, padding:'8px 12px', background:'var(--bg-secondary)', borderRadius:8, border:'1px solid var(--border)', fontSize:11, color:'var(--text-muted)' }}>
              <span>📋 <strong>{obiettivoLabel[opzioni.obiettivo]}</strong></span>
              <span>·</span>
              <span>🔄 {opzioni.disponibilita}</span>
              {opzioni.sogliaVendita && <><span>·</span><span>📉 Soglia vendita: {opzioni.sogliaVendita}%</span></>}
              {opzioni.maxUSA !== 'No max' && <><span>·</span><span>🇺🇸 Max USA: {opzioni.maxUSA}</span></>}
              {opzioni.note && <><span>·</span><span>📝 {opzioni.note}</span></>}
            </div>
          )}
          {loading && (
            <div style={{ textAlign:'center', padding:'60px 0' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>🤖</div>
              <div style={{ fontSize:14, color:'var(--text-secondary)', marginBottom:6 }}>Analisi in corso...</div>
              <div style={{ fontSize:12, color:'var(--text-muted)' }}>Claude sta analizzando il portafoglio con contesto macro</div>
            </div>
          )}
          {errore && <div className="alert alert-warning">⚠️ {errore}</div>}

          {!loading && (semafori || puntiChiave.length > 0) && (
            <>
              {/* Giudizio globale */}
              {giudizioGlobale && (
                <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderRadius:10, marginBottom:16,
                  background: giudizioGlobale === 'VERDE' ? 'rgba(34,197,94,0.1)' : giudizioGlobale === 'GIALLO' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${SEMAFORO_COLOR[giudizioGlobale]}33`
                }}>
                  <span style={{ fontSize:28 }}>{SEMAFORO_EMOJI[giudizioGlobale]}</span>
                  <div>
                    <div style={{ fontSize:15, fontWeight:700, color: SEMAFORO_COLOR[giudizioGlobale] }}>
                      Giudizio Globale: {giudizioGlobale}
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
                      {giudizioGlobale === 'VERDE' ? 'Portafoglio conforme alle regole del profilo' :
                       giudizioGlobale === 'GIALLO' ? 'Alcune aree richiedono attenzione' :
                       'Sono presenti anomalie che richiedono intervento'}
                    </div>
                  </div>
                </div>
              )}

              {/* Semafori per area */}
              {semafori && Object.keys(semafori).length > 0 && (
                <div style={{ background:'var(--bg-secondary)', borderRadius:10, padding:'12px 16px', marginBottom:16 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--text-secondary)', marginBottom:8, textTransform:'uppercase', letterSpacing:1 }}>Valutazione per Area</div>
                  {Object.entries(semafori).map(([k,v]) => <SemaforoRow key={k} k={k} v={v} />)}
                </div>
              )}

              {/* Punti chiave */}
              {puntiChiave.length > 0 && (
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--text-secondary)', marginBottom:8, textTransform:'uppercase', letterSpacing:1 }}>Punti Chiave</div>
                  {puntiChiave.map((p, i) => (
                    <div key={i} style={{ display:'flex', gap:10, padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
                      <span style={{ color:'var(--accent-gold)', fontWeight:700, flexShrink:0 }}>{i+1}.</span>
                      <span style={{ fontSize:13, color:'var(--text-primary)', lineHeight:1.5 }}>{p}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Analisi dettagliata — espandibile */}
              {analisiDettagliata && (
                <div style={{ marginBottom:16, background:'var(--bg-secondary)', borderRadius:10, overflow:'hidden' }}>
                  <button onClick={() => setShowAnalisi(a => !a)}
                    style={{ width:'100%', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', background:'none', border:'none', cursor:'pointer', color:'var(--text-primary)' }}>
                    <span style={{ fontSize:13, fontWeight:700 }}>📋 Analisi Completa (per PDF)</span>
                    <span style={{ fontSize:16 }}>{showAnalisi ? '▲' : '▼'}</span>
                  </button>
                  {showAnalisi && (
                    <div style={{ padding:'0 16px 16px', maxHeight:320, overflowY:'auto' }}>
                      {renderAnalisiTesto(analisiDettagliata)}
                    </div>
                  )}
                </div>
              )}

              {/* Modifiche consigliate — espandibile */}
              {modifiche.length > 0 && !applicate && (
                <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                  <button onClick={() => setShowModifiche(m => !m)}
                    style={{ width:'100%', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', background:'none', border:'none', cursor:'pointer', color:'var(--text-primary)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:13, fontWeight:700 }}>💡 Modifiche Consigliate</span>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background:'var(--accent-gold)22', color:'var(--accent-gold)', fontWeight:700 }}>{nApprovate}/{modifiche.length} selezionate</span>
                    </div>
                    <span style={{ fontSize:16 }}>{showModifiche ? '▲' : '▼'}</span>
                  </button>
                  {showModifiche && (
                    <div style={{ padding:'0 16px 16px' }}>
                      <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:12 }}>Deseleziona le modifiche che non vuoi applicare</div>
                      {modifiche.map((m, i) => {
                        const etf = portfolio.etfs.find(e => e.isin === m.isin);
                        return (
                          <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'10px 0', borderBottom: i < modifiche.length-1 ? '1px solid var(--border)' : 'none' }}>
                            <input type="checkbox" checked={!!approvate[i]} onChange={() => setApprovate(a => ({ ...a, [i]: !a[i] }))}
                              style={{ marginTop:3, cursor:'pointer', width:15, height:15 }} />
                            <div style={{ flex:1 }}>
                              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                                <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4,
                                  background: m.azione === 'deseleziona' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                                  color: m.azione === 'deseleziona' ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                                  {m.azione === 'deseleziona' ? '− RIMUOVI' : m.azione === 'aggiungi' ? '+ AGGIUNGI' : '+ SELEZIONA'}
                                </span>
                                <span style={{ fontSize:13, fontWeight:600 }}>{etf?.name || m.name || m.isin}</span>
                                <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'monospace' }}>{m.isin}</span>
                              </div>
                              <div style={{ fontSize:12, color:'var(--text-secondary)' }}>{m.motivo}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {modifiche.length === 0 && (
                <div className="alert alert-success" style={{ marginTop:8 }}>✓ Il portafoglio rispetta tutte le regole del profilo selezionato.</div>
              )}
            </>
          )}

          {applicate && (
            <div className="alert alert-success" style={{ marginTop:16, textAlign:'center', fontSize:14 }}>✓ Modifiche applicate con successo!</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginTop:14, display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)' }}>
            {modifiche.length > 0 && !applicate && `${nApprovate} di ${modifiche.length} modifiche selezionate`}
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button className="btn btn-ghost" onClick={onClose}>Chiudi</button>
            {modifiche.length > 0 && !applicate && (
              <button className="btn btn-primary" onClick={handleApplica} disabled={nApprovate === 0 || applying}
                style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                {applying ? '⏳ Salvataggio...' : `✓ Applica ${nApprovate} Modifica${nApprovate !== 1 ? 'he' : ''}`}
              </button>
            )}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}


export default AIModal;
