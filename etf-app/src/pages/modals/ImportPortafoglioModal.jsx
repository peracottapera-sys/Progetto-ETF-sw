import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import * as XLSX from 'xlsx';

const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

// ── Parsing Excel ──────────────────────────────────────────────────────────
function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        // Cerca il foglio "Portafoglio" o prende il primo
        const sheetName = wb.SheetNames.includes('Portafoglio') ? 'Portafoglio' : wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        // Trova la riga header (contiene "ISIN")
        let headerRow = -1;
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
          if (rows[i].some(c => String(c).toUpperCase().includes('ISIN'))) {
            headerRow = i;
            break;
          }
        }
        if (headerRow === -1) { reject(new Error('Intestazione ISIN non trovata. Usa il template fornito.')); return; }

        const headers = rows[headerRow].map(h => String(h).toLowerCase().trim());
        const isinCol = headers.findIndex(h => h.includes('isin'));
        const nomeCol = headers.findIndex(h => h.includes('nome') || h.includes('etf'));
        const qtaCol  = headers.findIndex(h => h.includes('quant'));
        const prezCol = headers.findIndex(h => h.includes('prezz') || h.includes('carico'));
        const noteCol = headers.findIndex(h => h.includes('note'));

        const etfs = [];
        for (let i = headerRow + 1; i < rows.length; i++) {
          const row = rows[i];
          const isin = String(row[isinCol] || '').trim().toUpperCase();
          if (!isin || isin.length !== 12 || isin === 'TOTALE') continue;
          const qta  = parseFloat(String(row[qtaCol] || '').replace(',', '.')) || null;
          const prez = parseFloat(String(row[prezCol] || '').replace(',', '.')) || null;
          etfs.push({
            isin,
            name: String(row[nomeCol] || '').trim() || isin,
            quantita: qta,
            prezzoCarico: prez,
            note: noteCol >= 0 ? String(row[noteCol] || '').trim() : '',
          });
        }

        if (etfs.length === 0) { reject(new Error('Nessun ETF trovato. Verifica che il foglio "Portafoglio" sia compilato.')); return; }
        resolve(etfs);
      } catch (err) { reject(new Error('Errore lettura file: ' + err.message)); }
    };
    reader.onerror = () => reject(new Error('Errore lettura file'));
    reader.readAsArrayBuffer(file);
  });
}

// ── Componente principale ──────────────────────────────────────────────────
export default function ImportPortafoglioModal({ onClose }) {
  const { createPortfolio, token, currentUser, getUserPortfolios, loadPortfoliosFromDB } = useApp();
  const portfolios = currentUser ? getUserPortfolios(currentUser.id) : [];
  const fileRef = useRef();

  const [step, setStep] = useState('form'); // form | anteprima | caricamento
  const [form, setForm] = useState({
    nome: '',
    profiloTarget: 'Bilanciato',
    orizzonteAnni: 'LUNGO',
    maxUSA: 'No max',
  });
  const [file, setFile] = useState(null);
  const [etfsLetti, setEtfsLetti] = useState([]);
  const [matchResults, setMatchResults] = useState([]); // { ...etf, trovato, catalogoData }
  const [errore, setErrore] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');

  // ── Download template ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    // Foglio Istruzioni
    const istrData = [
      ['ETF Portfolio Manager — Template Import Portafoglio', '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['ISTRUZIONI', '', '', '', '', ''],
      ['1.', 'Vai al foglio "Portafoglio" (tab in basso)', '', '', '', ''],
      ['2.', 'Per ogni ETF inserisci ISIN (obbligatorio), Nome, Quantità e Prezzo di carico', '', '', '', ''],
      ['3.', 'Il codice ISIN è composto da 12 caratteri (es. IE00B4L5Y983)', '', '', '', ''],
      ['4.', 'La Quantità è il numero di quote possedute (es. 50)', '', '', '', ''],
      ['5.', 'Il Prezzo di carico è il prezzo medio di acquisto in Euro (es. 112.50)', '', '', '', ''],
      ['6.', 'Non modificare le intestazioni delle colonne', '', '', '', ''],
      ['7.', 'Salva il file in formato .xlsx e importalo nell\'app', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['ESEMPIO', '', '', '', '', ''],
      ['ISIN', 'Nome ETF', 'Quantità', 'Prezzo carico (€)', 'Valore totale (€)', 'Note'],
      ['IE00B4L5Y983', 'iShares Core MSCI World UCITS ETF', 50, 112.50, 5625, 'ETF core globale'],
      ['IE00BKM4GZ66', 'iShares Core MSCI EM IMI UCITS ETF', 30, 76.20, 2286, 'Mercati emergenti'],
      ['LU0290356871', 'Xtrackers Eurozone Govt Bond 1-3Y', 80, 173.00, 13840, 'Obblig. breve termine'],
    ];
    const wsIstr = XLSX.utils.aoa_to_sheet(istrData);
    wsIstr['!cols'] = [{ wch: 18 }, { wch: 44 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsIstr, 'Istruzioni');

    // Foglio Portafoglio — 30 righe vuote con intestazioni
    const portData = [
      ['ISIN *', 'Nome ETF', 'Quantità *', 'Prezzo carico (€)', 'Valore totale (€)', 'Note'],
      ...Array(30).fill(['', '', '', '', '', '']),
      ['TOTALE', '', '', '', '', ''],
    ];
    const wsPort = XLSX.utils.aoa_to_sheet(portData);
    wsPort['!cols'] = [{ wch: 16 }, { wch: 44 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, wsPort, 'Portafoglio');

    XLSX.writeFile(wb, 'template_import_portafoglio.xlsx');
  };

  // ── Upload file ──────────────────────────────────────────────────────────
  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setErrore('');
    try {
      const etfs = await parseExcel(f);
      setEtfsLetti(etfs);
    } catch (err) {
      setErrore(err.message);
      setEtfsLetti([]);
    }
  };

  // ── Analisi ISIN vs catalogo ─────────────────────────────────────────────
  const handleAnteprima = async () => {
    if (!etfsLetti.length) return;
    if (!form.nome.trim()) { setErrore('Inserisci un nome per il portafoglio'); return; }
    setLoading(true);
    setErrore('');
    try {
      const res = await fetch(`${API}/api/portfolios/import-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ etfs: etfsLetti }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore server');
      setMatchResults(data.results);
      setStep('anteprima');
    } catch (err) {
      setErrore(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Import definitivo ────────────────────────────────────────────────────
  const handleImport = async () => {
    setLoading(true);
    setProgress('Creazione portafoglio...');
    try {
      // 1. Crea portafoglio
      const creaRes = await createPortfolio(form.nome.trim(), form.profiloTarget, form.maxUSA);
      if (!creaRes.ok) throw new Error(creaRes.error);
      const portfolioId = creaRes.id;

      // 2. Importa ETF
      setProgress('Importazione ETF...');
      const res = await fetch(`${API}/api/portfolios/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          portfolioId,
          etfs: matchResults.map(r => ({
            isin: r.isin,
            name: r.trovato ? r.catalogoData.name : r.name,
            quantita: r.quantita,
            prezzoCarico: r.prezzoCarico,
            custom: !r.trovato,
            categoria: r.trovato ? r.catalogoData.categoria : 'Custom',
          })),
          profiloTarget: form.profiloTarget,
          orizzonteAnni: form.orizzonteAnni,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore import');

      setProgress('Completato!');
      // FIX: passare token + userId, altrimenti la fetch va in 401 e il catch
      // sostituisce lo stato con loadFromLocalStorage → dopo l'import si vede stato stale.
      await loadPortfoliosFromDB(token, currentUser?.id);
      setTimeout(() => onClose(), 800);
    } catch (err) {
      setErrore(err.message);
      setLoading(false);
      setProgress('');
    }
  };

  // ── Render step form ─────────────────────────────────────────────────────
  const renderForm = () => (
    <div>
      {/* Download template */}
      <div style={{ background:'rgba(46,117,182,0.08)', border:'1px solid rgba(46,117,182,0.3)', borderRadius:10, padding:'14px 16px', marginBottom:18 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', marginBottom:3 }}>📥 Scarica il template Excel</div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>Compila con ISIN, quantità e prezzo di carico dei tuoi ETF</div>
          </div>
          <button className="btn btn-secondary" style={{ fontSize:12, whiteSpace:'nowrap', flexShrink:0 }}
            onClick={handleDownloadTemplate}>
            📊 Template.xlsx
          </button>
        </div>
      </div>

      {/* Upload file */}
      <div style={{ marginBottom:14 }}>
        <label className="form-label">File Excel compilato</label>
        <div
          onClick={() => fileRef.current?.click()}
          style={{ border:`2px dashed ${file ? 'var(--accent-green)' : 'var(--border)'}`, borderRadius:10,
            padding:'20px', textAlign:'center', cursor:'pointer',
            background: file ? 'rgba(33,115,70,0.06)' : 'var(--bg-primary)',
            transition:'all 0.2s' }}>
          <div style={{ fontSize:22, marginBottom:6 }}>{file ? '✅' : '📂'}</div>
          <div style={{ fontSize:13, color: file ? 'var(--accent-green)' : 'var(--text-secondary)', fontWeight: file ? 700 : 400 }}>
            {file ? file.name : 'Clicca per selezionare il file .xlsx'}
          </div>
          {file && etfsLetti.length > 0 && (
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
              {etfsLetti.length} ETF trovati nel file
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={handleFile} />
      </div>

      {/* Nome portafoglio */}
      <div style={{ marginBottom:12 }}>
        <label className="form-label">Nome portafoglio</label>
        <input className="input" placeholder="Es. Portafoglio_IBKR_2026"
          value={form.nome} onChange={e => setForm(f => ({...f, nome: e.target.value.slice(0,30)}))} />
        <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>Max 30 caratteri</div>
      </div>

      {/* Profilo target + Orizzonte */}
      <div style={{ display:'flex', gap:12, marginBottom:12 }}>
        <div style={{ flex:1 }}>
          <label className="form-label">Profilo di riferimento</label>
          <select className="input" value={form.profiloTarget} onChange={e => setForm(f => ({...f, profiloTarget: e.target.value}))}>
            <option>Prudente</option>
            <option>Bilanciato</option>
            <option>Aggressivo</option>
          </select>
          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>Usato dall'AI per l'analisi e i suggerimenti</div>
        </div>
        <div style={{ flex:1 }}>
          <label className="form-label">Orizzonte temporale</label>
          <div style={{ display:'flex', gap:6 }}>
            {[['BREVE','< 5A'],['MEDIO','5-10A'],['LUNGO','> 10A']].map(([v,l]) => (
              <div key={v} onClick={() => setForm(f => ({...f, orizzonteAnni: v}))}
                style={{ flex:1, padding:'7px 6px', borderRadius:8, cursor:'pointer', textAlign:'center',
                  border:`1px solid ${form.orizzonteAnni===v ? 'var(--accent-gold)' : 'var(--border)'}`,
                  background: form.orizzonteAnni===v ? 'rgba(212,175,55,0.1)' : 'var(--bg-primary)' }}>
                <div style={{ fontSize:11, fontWeight:700, color: form.orizzonteAnni===v ? 'var(--accent-gold)' : 'var(--text-primary)' }}>{v}</div>
                <div style={{ fontSize:9, color:'var(--text-muted)' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Max USA */}
      <div style={{ marginBottom:16 }}>
        <label className="form-label">Limite esposizione USA — opzionale</label>
        <select className="input" value={form.maxUSA} onChange={e => setForm(f => ({...f, maxUSA: e.target.value}))}>
          <option value="No max">Nessun limite</option>
          <option value="60%">Max 60%</option>
          <option value="30%">Max 30%</option>
          <option value="0%">Nessuna esposizione USA</option>
        </select>
      </div>

      {errore && <div style={{ color:'var(--accent-red)', fontSize:12, marginBottom:12, padding:'8px 12px', background:'rgba(192,0,0,0.08)', borderRadius:8 }}>⚠️ {errore}</div>}

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:8 }}>
        <button className="btn btn-ghost" onClick={onClose}>Annulla</button>
        <button className="btn btn-primary"
          disabled={!file || !etfsLetti.length || !form.nome.trim() || loading || portfolios.length >= 5}
          onClick={handleAnteprima}
          style={{ background:'linear-gradient(135deg, #6366f1, #8b5cf6)', border:'none' }}>
          {loading ? '⏳ Analisi...' : `Analizza ${etfsLetti.length} ETF →`}
        </button>
      </div>
      {portfolios.length >= 5 && (
        <div style={{ fontSize:11, color:'var(--accent-red)', textAlign:'center', marginTop:8 }}>Hai già 5 portafogli — elimina uno per continuare</div>
      )}
    </div>
  );

  // ── Render step anteprima ────────────────────────────────────────────────
  const trovati   = matchResults.filter(r => r.trovato);
  const nonTrovati = matchResults.filter(r => !r.trovato);

  const renderAnteprima = () => (
    <div>
      {/* Riepilogo match */}
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        <div style={{ flex:1, background:'rgba(33,115,70,0.08)', border:'1px solid rgba(33,115,70,0.3)', borderRadius:10, padding:'10px 14px', textAlign:'center' }}>
          <div style={{ fontSize:20, fontWeight:700, color:'var(--accent-green)' }}>{trovati.length}</div>
          <div style={{ fontSize:11, color:'var(--text-muted)' }}>ETF riconosciuti</div>
        </div>
        {nonTrovati.length > 0 && (
          <div style={{ flex:1, background:'rgba(212,175,55,0.08)', border:'1px solid rgba(212,175,55,0.3)', borderRadius:10, padding:'10px 14px', textAlign:'center' }}>
            <div style={{ fontSize:20, fontWeight:700, color:'var(--accent-amber)' }}>{nonTrovati.length}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>Non nel catalogo → Custom</div>
          </div>
        )}
        <div style={{ flex:1, background:'rgba(46,117,182,0.08)', border:'1px solid rgba(46,117,182,0.3)', borderRadius:10, padding:'10px 14px', textAlign:'center' }}>
          <div style={{ fontSize:20, fontWeight:700, color:'var(--accent-blue)' }}>
            €{matchResults.reduce((t,r) => t + ((r.quantita||0)*(r.prezzoCarico||0)), 0).toLocaleString('it-IT', {maximumFractionDigits:0})}
          </div>
          <div style={{ fontSize:11, color:'var(--text-muted)' }}>Valore carico totale</div>
        </div>
      </div>

      {/* Lista ETF */}
      <div style={{ maxHeight:300, overflowY:'auto', borderRadius:10, border:'1px solid var(--border)' }}>
        {matchResults.map((r, i) => (
          <div key={r.isin} style={{
            display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
            borderBottom: i < matchResults.length-1 ? '1px solid var(--border)' : 'none',
            background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-primary)',
          }}>
            <div style={{ fontSize:16 }}>{r.trovato ? '✅' : '🟡'}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text-primary)', fontFamily:'monospace' }}>{r.isin}</div>
              <div style={{ fontSize:11, color:'var(--text-secondary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {r.trovato ? r.catalogoData.name : r.name || 'Nome non disponibile'}
              </div>
              {r.trovato && <div style={{ fontSize:10, color:'var(--text-muted)' }}>{r.catalogoData.categoria}</div>}
              {!r.trovato && <div style={{ fontSize:10, color:'var(--accent-amber)' }}>⚠️ Aggiunto come Custom — dati limitati</div>}
            </div>
            <div style={{ textAlign:'right', flexShrink:0 }}>
              {r.quantita && <div style={{ fontSize:12, color:'var(--text-primary)' }}>{r.quantita} quote</div>}
              {r.prezzoCarico && <div style={{ fontSize:11, color:'var(--text-muted)' }}>€{r.prezzoCarico.toFixed(2)}/quota</div>}
              {r.quantita && r.prezzoCarico && (
                <div style={{ fontSize:11, fontWeight:700, color:'var(--accent-green)' }}>
                  €{(r.quantita * r.prezzoCarico).toLocaleString('it-IT', {maximumFractionDigits:0})}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {nonTrovati.length > 0 && (
        <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:10, padding:'8px 12px', background:'rgba(212,175,55,0.06)', borderRadius:8 }}>
          💡 Gli ETF Custom vengono importati ma non hanno dati di performance. Puoi comunque usarli nel portafoglio e farli analizzare dall'AI.
        </div>
      )}

      {errore && <div style={{ color:'var(--accent-red)', fontSize:12, marginTop:10, padding:'8px 12px', background:'rgba(192,0,0,0.08)', borderRadius:8 }}>⚠️ {errore}</div>}
      {progress && <div style={{ color:'var(--accent-green)', fontSize:12, marginTop:10, textAlign:'center' }}>⏳ {progress}</div>}

      <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginTop:16 }}>
        <button className="btn btn-ghost" onClick={() => setStep('form')} disabled={loading}>← Indietro</button>
        <button className="btn btn-primary" onClick={handleImport} disabled={loading}
          style={{ background:'linear-gradient(135deg, #6366f1, #8b5cf6)', border:'none' }}>
          {loading ? `⏳ ${progress}` : `✓ Importa ${matchResults.length} ETF nel portafoglio`}
        </button>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ minWidth:580, maxWidth:720, maxHeight:'90vh', display:'flex', flexDirection:'column' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexShrink:0 }}>
          <div>
            <div className="modal-title" style={{ marginBottom:4 }}>📥 Importa Portafoglio da Excel</div>
            <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
              {step === 'form' ? 'Carica un file Excel con i tuoi ETF esistenti'
                : `Anteprima — ${matchResults.length} ETF trovati nel file`}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize:18, padding:'4px 10px' }}>✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ display:'flex', gap:6, marginBottom:20, flexShrink:0 }}>
          {[['1','Configura'],['2','Anteprima'],['3','Importa']].map(([n,l], i) => {
            const active = (i === 0 && step === 'form') || (i === 1 && step === 'anteprima') || (i === 2 && loading && step === 'anteprima');
            const done = (i === 0 && step !== 'form') || (i === 1 && loading && step === 'anteprima');
            return (
              <div key={n} style={{ flex:1, display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700,
                  background: done ? 'var(--accent-green)' : active ? 'var(--accent-gold)' : 'var(--border)',
                  color: (done || active) ? 'white' : 'var(--text-muted)' }}>
                  {done ? '✓' : n}
                </div>
                <div style={{ fontSize:11, color: active ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: active ? 700 : 400 }}>{l}</div>
                {i < 2 && <div style={{ flex:1, height:1, background:'var(--border)' }} />}
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div style={{ overflowY:'auto', flex:1 }}>
          {step === 'form' ? renderForm() : renderAnteprima()}
        </div>
      </div>
    </div>
  );
}
