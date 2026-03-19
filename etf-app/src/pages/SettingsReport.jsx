import React, { useState, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';

export function Settings() {
  const { currentUser, updateUser } = useApp();
  const [form, setForm] = useState({ email: currentUser.email || '', newPwd: '', confirmPwd: '' });
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  const handleSave = () => {
    setError(''); setSaved('');
    if (form.newPwd && form.newPwd !== form.confirmPwd) { setError('Le password non coincidono'); return; }
    if (form.newPwd && form.newPwd.length < 6) { setError('Password minimo 6 caratteri'); return; }
    const updates = { email: form.email };
    if (form.newPwd) updates.password = form.newPwd;
    updateUser(currentUser.id, updates);
    setSaved('Impostazioni salvate!');
    setForm(f => ({ ...f, newPwd: '', confirmPwd: '' }));
  };

  return (
    <div style={{ padding: '20px 16px' }}>
      <h2 style={{ fontFamily: 'DM Serif Display, serif', fontSize: 24, marginBottom: 24 }}>Impostazioni</h2>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

        {/* Colonna sinistra — Profilo */}
        <div style={{ width: 300, flexShrink: 0 }}>
          <div className="card">
            <div className="card-title">Dati Account</div>

            <div className="form-group">
              <label className="form-label">Username</label>
              <input className="input" value={currentUser.username} disabled style={{ opacity: 0.6 }} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Lo username non può essere modificato</div>
            </div>

            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="input" type="email" placeholder="tua@email.com" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>

            <hr className="divider" />
            <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Cambia Password</div>

            <div className="form-group">
              <label className="form-label">Nuova Password</label>
              <input className="input" type="password" placeholder="Lascia vuoto per non cambiare"
                value={form.newPwd} onChange={e => setForm(f => ({ ...f, newPwd: e.target.value }))} />
            </div>

            <div className="form-group">
              <label className="form-label">Conferma Nuova Password</label>
              <input className="input" type="password" placeholder="Ripeti la nuova password"
                value={form.confirmPwd} onChange={e => setForm(f => ({ ...f, confirmPwd: e.target.value }))} />
            </div>

            {error && <div className="alert alert-warning" style={{ marginBottom: 16 }}>⚠ {error}</div>}
            {saved && <div className="alert alert-success" style={{ marginBottom: 16 }}>✓ {saved}</div>}

            <button className="btn btn-primary" onClick={handleSave}>Salva Modifiche</button>

            <hr className="divider" style={{ margin: '16px 0' }} />
            <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>🤖 Motore AI</div>
            <a href="/Regole_AI_ETF_Portfolio.docx" download
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
                background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)',
                textDecoration: 'none', fontSize: 12, fontWeight: 500 }}>
              <span style={{ fontSize: 16 }}>📄</span>
              <div>
                <div style={{ fontWeight: 600 }}>Regole Motore AI</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Documento di riferimento — .docx</div>
              </div>
            </a>
          </div>
        </div>

        {/* Colonna destra — Catalogo ETF */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <CatalogAdmin />
        </div>

      </div>
    </div>
  );
}

// ── Pannello ricerca catalogo ETF ──────────────────────────────────────────
function CatalogAdmin() {
  const { token, currentPortfolio, toggleEtfSelection, saveAcquisto } = useApp();
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [added, setAdded]     = useState({});
  const [stats, setStats]     = useState(null);
  const [sortCol, setSortCol] = useState('aum_mln');
  const [sortDir, setSortDir] = useState('desc');
  const debounceRef = useRef(null);
  const [modalEtf, setModalEtf]   = useState(null);  // ETF selezionato per acquisto
  const [acqForm, setAcqForm]     = useState({ quantita: '', quotazione: '', data: new Date().toISOString().slice(0,10) });
  const [acqError, setAcqError]   = useState('');

  const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

  React.useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/etf-catalog/stats`)
      .then(r => r.json()).then(setStats).catch(() => {});
  }, [token]);

  const search = useCallback((q) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    fetch(`${API}/api/etf-catalog/search?q=${encodeURIComponent(q)}&limit=20`)
      .then(r => r.json())
      .then(data => { setResults(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setResults([]); setLoading(false); });
  }, [token]);

  const handleChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 350);
  };

  const handleAdd = (etf) => {
    setAcqForm({ quantita: '', quotazione: etf.quotazione > 0 ? etf.quotazione.toFixed(2) : '', data: new Date().toISOString().slice(0,10) });
    setAcqError('');
    setModalEtf(etf);
  };

  const handleAcquisto = async () => {
    const q = parseFloat(acqForm.quantita);
    const p = parseFloat(acqForm.quotazione);
    if (!q || q <= 0) { setAcqError('Inserisci una quantità valida'); return; }
    if (!p || p <= 0) { setAcqError('Inserisci un prezzo valido'); return; }
    if (!acqForm.data)  { setAcqError('Inserisci una data'); return; }

    const etf = modalEtf;
    const etfObj = {
      isin: etf.isin, name: etf.name,
      emittente: etf.name.split(' ')[0] || '—',
      ter: etf.ter ?? 0, tassazione: 26,
      quotazione: p, annoNascita: null,
      capitalizzazione: etf.aum_mln ?? 0,
      variabilita: etf.vol1y ?? 0, maxDrawdown: etf.maxdd1y ?? 0,
      categoria: etf.categoria || 'Altro', valuta: etf.valuta || 'EUR',
      hedged: false, tipo: 'personalizzato',
      perf1m: etf.perf1m ?? 0, perf6m: etf.perf6m ?? 0,
      perf1y: etf.perf1y ?? 0, perf5y: etf.perf5y ?? 0,
    };
    await toggleEtfSelection(currentPortfolio.id, etf.isin, true, etfObj);
    await saveAcquisto(currentPortfolio.id, etf.isin, {
      quantita: q,
      quotazioneAcquisto: p,
      dataAcquisto: acqForm.data,
    });
    setAdded(a => ({ ...a, [etf.isin]: true }));
    setModalEtf(null);
  };

  const inPortfolio = (isin) => currentPortfolio?.etfs?.some(e => e.isin === isin && e.selected);
  const fmt    = (v) => v != null ? (v > 0 ? '+' : '') + v.toFixed(1) + '%' : '—';
  const fmtTer = (v) => v != null ? v.toFixed(2) + '%' : '—';
  const fmtAum = (v) => v != null ? (v >= 1000 ? (v / 1000).toFixed(1) + 'B€' : v.toFixed(0) + 'M€') : '—';

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };
  const sortedResults = [...results].sort((a, b) => {
    const va = a[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity);
    const vb = b[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity);
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === 'asc' ? va - vb : vb - va;
  });
  const Th = ({ col, label, style }) => (
    <th onClick={() => handleSort(col)} style={{ cursor: 'pointer', userSelect: 'none', padding: '6px 4px', fontSize: 11, position: 'sticky', top: 0, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', ...style }}>
      {label}{sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
    </th>
  );

  return (
    <div className="card" style={{ marginTop: 0 }}>
      {/* Modal acquisto */}
      {modalEtf && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 28, width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Aggiungi al portafoglio</h3>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--text-muted)' }}>{modalEtf.name}</p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Quantità (quote)</label>
              <input type="number" min="0" step="1" value={acqForm.quantita}
                onChange={e => setAcqForm(f => ({ ...f, quantita: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box' }}
                placeholder="es. 10" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Prezzo di acquisto (€)</label>
              <input type="number" min="0" step="0.01" value={acqForm.quotazione}
                onChange={e => setAcqForm(f => ({ ...f, quotazione: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box' }}
                placeholder="es. 95.50" />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Data acquisto</label>
              <input type="date" value={acqForm.data}
                onChange={e => setAcqForm(f => ({ ...f, data: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            {acqForm.quantita && acqForm.quotazione && (
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>Controvalore totale: </span>
                <strong style={{ color: 'var(--accent-blue)' }}>
                  €{(parseFloat(acqForm.quantita) * parseFloat(acqForm.quotazione)).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
              </div>
            )}
            {acqError && <p style={{ color: 'var(--accent-red)', fontSize: 12, margin: '0 0 12px' }}>{acqError}</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalEtf(null)}
                style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13 }}>
                Annulla
              </button>
              <button onClick={handleAcquisto}
                style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: 'var(--accent-blue)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Aggiungi
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="card-title">🔍 Catalogo ETF — JustETF</div>

      {stats && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          {[['ETF nel catalogo', stats.total?.toLocaleString('it-IT')], ['Con ticker Yahoo', stats.withTicker || 0]].map(([k, v]) => (
            <div key={k} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 14px', border: '1px solid var(--border)', fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>{k}: </span><strong>{v}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="form-group" style={{ marginBottom: 12 }}>
        <input className="input" placeholder="Cerca per nome o ISIN (es. iShares World, IE00B4L5Y983…)"
          value={query} onChange={handleChange} style={{ fontSize: 14 }} />
        {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Ricerca in corso…</div>}
      </div>

      {results.length > 0 && (
        <div style={{ maxHeight: 420, overflowY: 'auto', overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 750, borderCollapse: 'collapse' }}>
            <colgroup>
              <col style={{ width: '30%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <Th col="name"    label="Nome ETF" style={{ textAlign: 'left',   padding: '6px 8px' }} />
                <th style={{ padding: '6px 8px', fontSize: 11, position: 'sticky', top: 0, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>ISIN</th>
                <Th col="valuta"  label="Val."     style={{ textAlign: 'right' }} />
                <Th col="aum_mln" label="AUM"      style={{ textAlign: 'right' }} />
                <Th col="ter"     label="TER"      style={{ textAlign: 'right' }} />
                <Th col="perf1y"  label="1A%"      style={{ textAlign: 'right' }} />
                <Th col="perf5y"  label="5A%"      style={{ textAlign: 'right' }} />
                <Th col="vol1y"   label="Vol."     style={{ textAlign: 'right' }} />
                <Th col="distribuzione" label="Distr." style={{ textAlign: 'center' }} />
                <th style={{ padding: '6px 4px', position: 'sticky', top: 0, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}></th>
              </tr>
            </thead>
            <tbody>
              {sortedResults.map(etf => (
                <tr key={etf.isin} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ fontSize: 11, padding: '5px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={etf.name}>{etf.name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 10, padding: '5px 8px' }}>
                    <a href={`https://www.justetf.com/it/etf-profile.html?isin=${etf.isin}`} target="_blank" rel="noreferrer"
                      style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                      {etf.isin} ↗
                    </a>
                  </td>
                  <td style={{ fontSize: 11, padding: '5px 4px', textAlign: 'right' }}>{etf.valuta || '—'}</td>
                  <td style={{ fontSize: 11, padding: '5px 4px', textAlign: 'right' }}>{fmtAum(etf.aum_mln)}</td>
                  <td style={{ fontSize: 11, padding: '5px 4px', textAlign: 'right' }}>{fmtTer(etf.ter)}</td>
                  <td style={{ fontSize: 11, padding: '5px 4px', textAlign: 'right', color: etf.perf1y > 0 ? 'var(--accent-green)' : etf.perf1y < 0 ? 'var(--accent-red)' : undefined }}>{fmt(etf.perf1y)}</td>
                  <td style={{ fontSize: 11, padding: '5px 4px', textAlign: 'right', color: etf.perf5y > 0 ? 'var(--accent-green)' : etf.perf5y < 0 ? 'var(--accent-red)' : undefined }}>{fmt(etf.perf5y)}</td>
                  <td style={{ fontSize: 11, padding: '5px 4px', textAlign: 'right' }}>{etf.vol1y != null ? etf.vol1y.toFixed(1) + '%' : '—'}</td>
                  <td style={{ fontSize: 10, padding: '5px 4px', textAlign: 'center' }}>{etf.distribuzione === 'Accumulazione' ? 'Acc' : etf.distribuzione === 'Distribuzione' ? 'Dist' : '—'}</td>
                  <td style={{ padding: '5px 4px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    {inPortfolio(etf.isin) || added[etf.isin]
                      ? <span style={{ fontSize: 10, color: 'var(--accent-green)' }}
                          title={`In uso in: ${currentPortfolio?.name || 'portafoglio corrente'}`}>
                          ✓
                        </span>
                      : <button className="btn btn-primary" style={{ padding: '3px 8px', fontSize: 10, whiteSpace: 'nowrap' }} onClick={() => handleAdd(etf)}>+ Add</button>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.length >= 2 && !loading && results.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>Nessun ETF trovato per "{query}"</div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
        Fonte: JustETF · Dati aggiornati a marzo 2026 · Prezzi in tempo reale solo per ETF con ticker Yahoo verificato
      </div>
    </div>
  );
}

export function Report() {
  const { currentPortfolio } = useApp();
  const [generating, setGenerating] = useState(false);

  if (!currentPortfolio) return null;

  const etfs = currentPortfolio.etfs.filter(e => e.selected);
  const etfsConAcquisto = etfs.filter(e => e.acquisto);
  const today = new Date().toLocaleDateString('it-IT');
  // TER: leggi il ter da ogni ETF, normalizza null/undefined a 0
  // NOTA: etfRows viene calcolato dopo, ma abbiamo bisogno del TER prima — usiamo etfs direttamente
  const terPerEtf = etfs.map(e => ({
    isin: e.isin,
    name: e.name,
    ter: typeof e.ter === 'number' ? e.ter : 0,
    val: (e.acquisto?.quantita || 0) * (e.acquisto?.quotazioneAcquisto || 0),
  }));

  // Log per debug (visibile in console)
  console.table(terPerEtf.map(t => ({ isin: t.isin, ter: t.ter + '%', val: '€' + t.val.toFixed(0) })));

  // TER Totale = SOMMA di tutti i TER individuali
  const totalTer = terPerEtf.reduce((s, t) => s + t.ter, 0);

  // TER Medio Ponderato = media pesata per valore acquistato = costo % medio per ogni euro investito
  const terComplessivo = (() => {
    const validi = terPerEtf.filter(t => t.val > 0);
    const totValore = validi.reduce((s, t) => s + t.val, 0);
    if (totValore === 0) {
      const conTer = terPerEtf.filter(t => t.ter > 0);
      return conTer.length > 0 ? conTer.reduce((s, t) => s + t.ter, 0) / conTer.length : 0;
    }
    return terPerEtf.reduce((s, t) => s + (t.ter * t.val / totValore), 0);
  })();

  // Calcola dati per ogni ETF — usa quotazioneAcquisto come fallback se quotazione=0
  const etfRows = etfsConAcquisto.map(e => {
    const qAcq = e.acquisto.quotazioneAcquisto || 0;
    const qAtt = e.quotazione > 0 ? e.quotazione : qAcq; // fallback: se no prezzo attuale usa prezzo acquisto
    const qty = e.acquisto.quantita || 0;
    const vAcq = qty * qAcq;
    const vAtt = qty * qAtt;
    const plLorda = vAtt - vAcq;
    const aliquota = (e.tassazione || 26) / 100;
    const tasse = plLorda > 0 ? plLorda * aliquota : 0;
    const plNetto = plLorda - tasse;
    const dataAcq = e.acquisto.dataAcquisto ? new Date(e.acquisto.dataAcquisto) : null;
    const mesi = dataAcq ? Math.floor((new Date() - dataAcq) / (1000 * 60 * 60 * 24 * 30)) : 0;
    const prezzoAggiornato = e.quotazione > 0; // true se prezzo attuale disponibile
    return { e, vAcq, vAtt, plLorda, tasse, plNetto, mesi, prezzoAggiornato };
  });

  const totInvestito = etfRows.reduce((s, r) => s + r.vAcq, 0);
  const totAttuale = etfRows.reduce((s, r) => s + r.vAtt, 0);
  const totPlLorda = etfRows.reduce((s, r) => s + r.plLorda, 0);
  const totTasse = etfRows.reduce((s, r) => s + r.tasse, 0);
  const totPlNetto = etfRows.reduce((s, r) => s + r.plNetto, 0);

  const fmtEur = v => v.toLocaleString('it-IT', { minimumFractionDigits: 2 });
  const fmtPl = v => (v >= 0 ? '+' : '') + fmtEur(v);
  const plColor = v => v > 0 ? 'var(--accent-green)' : v < 0 ? 'var(--accent-red)' : 'var(--text-muted)';

  const handlePrint = () => {
    setGenerating(true);
    setTimeout(() => { window.print(); setGenerating(false); }, 300);
  };

  return (
    <div style={{ padding: '20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontFamily: 'DM Serif Display, serif', fontSize: 24 }}>Report Portafoglio</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>Generato il {today}</p>
        </div>
        <button className="btn btn-secondary" onClick={handlePrint} disabled={generating}>
          🖨️ Stampa / Salva PDF
        </button>
      </div>

      <div className="card">
        {/* Header portafoglio */}
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: 20, color: 'var(--accent-gold)', marginBottom: 4 }}>ETF Portfolio Manager</div>
          <div style={{ fontSize: 17, color: 'var(--text-primary)', marginBottom: 8 }}>{currentPortfolio.name}</div>
          <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            <span>Profilo: <strong style={{ color: 'var(--text-primary)' }}>{currentPortfolio.riskProfile}</strong></span>
            <span>Max USA: <strong style={{ color: 'var(--text-primary)' }}>{currentPortfolio.maxUSA}</strong></span>
            <span>Data: <strong style={{ color: 'var(--text-primary)' }}>{today}</strong></span>
            <span>ETF: <strong style={{ color: 'var(--accent-gold)' }}>{etfs.length}</strong></span>
          </div>
        </div>

        {/* Riepilogo finanziario */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Riepilogo Finanziario</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              ['Valore Investito', `€ ${fmtEur(totInvestito)}`, null],
              ['Valore Attuale', `€ ${fmtEur(totAttuale)}`, null],
              ['TER Totale', `${totalTer.toFixed(2)}%`, null, 'Somma TER di tutti gli ETF selezionati'],
              ['TER Medio', `${terComplessivo.toFixed(2)}%`, null, 'Ponderato per valore acquistato'],
              ['P&L Lordo', fmtPl(totPlLorda), plColor(totPlLorda), null],
              ['Tasse Stimate', totTasse > 0 ? `−€ ${fmtEur(totTasse)}` : '—', 'var(--accent-red)', null],
              ['P&L Netto', fmtPl(totPlNetto), plColor(totPlNetto), null],
            ].map(([k, v, c, subtitle]) => (
              <div key={k} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{k}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: c || 'var(--text-primary)' }}>{v}</div>
                {subtitle && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Tabella ETF */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>ETF in Portafoglio</div>
          {etfs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nessun ETF selezionato.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 900, width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['ETF', 'ISIN', 'TER%', 'Perf.1A', 'Perf.5A', 'Tax%', 'Acq. €', 'Val.Att. €', 'P&L Lordo €', 'Tasse €', 'P&L Netto €', 'Mesi'].map(h => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: h === 'ETF' ? 'left' : 'right', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {etfRows.map(({ e, vAcq, vAtt, plLorda, tasse, plNetto, mesi, prezzoAggiornato }) => (
                    <tr key={e.isin} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.name}>{e.name}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 10, textAlign: 'right' }}>
                        <a href={`https://www.justetf.com/it/etf-profile.html?isin=${e.isin}`} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                          {e.isin} ↗
                        </a>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{e.ter.toFixed(2)}%</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: plColor(e.perf1y) }}>{e.perf1y > 0 ? '+' : ''}{e.perf1y.toFixed(1)}%</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: plColor(e.perf5y) }}>{e.perf5y > 0 ? '+' : ''}{e.perf5y.toFixed(1)}%</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{e.tassazione}%</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtEur(vAcq)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                        {prezzoAggiornato ? fmtEur(vAtt) : <span style={{ color: 'var(--text-muted)' }}>{fmtEur(vAtt)} *</span>}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: plColor(plLorda) }}>{fmtPl(plLorda)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: tasse > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>{tasse > 0 ? fmtEur(tasse) : '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: plColor(plNetto) }}>{fmtPl(plNetto)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{mesi}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {etfRows.some(r => !r.prezzoAggiornato) && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>* Prezzo attuale non disponibile — valore stimato al prezzo di acquisto (P&L = 0)</p>
              )}
            </div>
          )}
        </div>

        <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          Report generato da ETF Portfolio Manager · {today} · Dati a solo scopo informativo, non costituiscono consulenza finanziaria.
        </div>
      </div>
    </div>
  );
}
