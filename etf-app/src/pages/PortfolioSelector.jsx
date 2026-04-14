import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import ImportPortafoglioModal from './modals/ImportPortafoglioModal';

const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

export default function PortfolioSelector() {
  const { currentUser, getUserPortfolios, selectPortfolio, createPortfolio, deletePortfolio, logout, token, setPendingAIResult, loadPortfoliosFromDB } = useApp();
  const portfolios = getUserPortfolios(currentUser.id);

  // step: 'list' | 'new' | 'ai-prompt' | 'ai-loading' | 'ai-result'
  const [step, setStep] = useState('list');
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ name: '', riskProfile: 'Prudente', maxUSA: 'No max' });
  const [aiForm, setAiForm] = useState({ orizzonteAnni: 'MEDIO', capitale: '', preferenze: '', escludiDistribuzione: true, usaBucket: false, pctBreve: 30, anniBreve: 3, rendBreve: '', anniLungo: 10, rendLungo: '' });
  const [error, setError] = useState('');
  const [newPortfolioId, setNewPortfolioId] = useState(null);
  const [aiRisultato, setAiRisultato] = useState(null); // { spiegazione, selezione }
  const [aiApplicato, setAiApplicato] = useState(false);

  const riskColors = { Prudente: 'badge-prudente', Bilanciato: 'badge-bilanciato', Aggressivo: 'badge-aggressivo' };
  const defaultName = `Portafoglio_${form.riskProfile}_${String(portfolios.length + 1).padStart(3, '0')}`;

  const handleCreate = async () => {
    const res = await createPortfolio(form.name || defaultName, form.riskProfile, form.maxUSA, true); // noSelect=true
    if (!res.ok) { setError(res.error); return; }
    setNewPortfolioId(res.id);
    setStep('ai-prompt');
  };

  const handleGeneraAI = async () => {
    setStep('ai-loading');
    try {
      const res = await fetch(`${API}/api/ai/crea-portafoglio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          portfolioId: newPortfolioId,
          profilo: form.riskProfile,
          orizzonteAnni: aiForm.orizzonteAnni === 'BREVE' ? 3 : aiForm.orizzonteAnni === 'LUNGO' ? 15 : 7,
          bucketBreve: aiForm.usaBucket ? { pct: aiForm.pctBreve, anni: aiForm.anniBreve, targetRend: parseFloat(aiForm.rendBreve) || null } : undefined,
          bucketLungo: aiForm.usaBucket ? { pct: 100 - aiForm.pctBreve, anni: aiForm.anniLungo, targetRend: parseFloat(aiForm.rendLungo) || null } : undefined,
          capitale: aiForm.capitale || null,
          conCapitale: !!aiForm.capitale,
          preferenze: aiForm.preferenze,
          escludiDistribuzione: aiForm.escludiDistribuzione,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore AI');
      if (!data.selezione?.length) throw new Error('Nessun ETF selezionato dall\'AI');

      // Salva risultato nel context e naviga alla Dashboard — il modal si aprirà automaticamente
      setPendingAIResult({ portfolioId: newPortfolioId, selezione: data.selezione, spiegazione: data.spiegazione, capitale: aiForm.capitale ? parseFloat(aiForm.capitale) : null });
      selectPortfolio(newPortfolioId);
    } catch (e) {
      setError(e.message);
      setStep('ai-prompt');
    }
  };

  const handleApriPortafoglio = () => selectPortfolio(newPortfolioId);
  const handleSaltaAI = () => selectPortfolio(newPortfolioId);

  // ── Render ──
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', padding: 24 }}>
      {showImport && <ImportPortafoglioModal onClose={() => setShowImport(false)} />}
      <div style={{ width: '100%', maxWidth: 600 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontFamily: 'DM Serif Display, serif', fontSize: 26, color: 'var(--text-primary)' }}>
              Benvenuto, {currentUser.username}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
              {step === 'list' ? 'Seleziona o crea un portafoglio' :
               step === 'new' ? 'Configura il nuovo portafoglio' :
               step === 'ai-prompt' ? 'Vuoi generarlo subito con AI?' :
               step === 'ai-loading' ? 'Generazione in corso...' :
               'Portafoglio creato con successo!'}
            </p>
          </div>
          <button className="btn btn-ghost" onClick={logout} style={{ fontSize: 12 }}>Esci ↗</button>
        </div>

        {/* ── STEP: LIST ── */}
        {step === 'list' && (<>
          {portfolios.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
              <p>Nessun portafoglio ancora.</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Crea il tuo primo portafoglio per iniziare.</p>
            </div>
          )}
          {portfolios.map(p => (
            <div key={p.id} className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', transition: 'border-color 0.2s', border: '1px solid var(--border)' }}
              onClick={() => selectPortfolio(p.id)}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-gold)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--accent-gold-dim)', border: '1px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                  {p.riskProfile === 'Prudente' ? '🛡️' : p.riskProfile === 'Bilanciato' ? '⚖️' : '🚀'}
                </div>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 15 }}>{p.name}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                    <span className={`badge ${riskColors[p.riskProfile]}`}>{p.riskProfile}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {p.etfs.filter(e => e.selected).length} ETF selezionati · creato {p.createdAt}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={e => { e.stopPropagation(); selectPortfolio(p.id); }}>Apri →</button>
                <button className="btn btn-danger" style={{ fontSize: 12, padding: '6px 12px' }} onClick={e => { e.stopPropagation(); if (window.confirm('Eliminare il portafoglio?')) deletePortfolio(p.id); }}>✕</button>
              </div>
            </div>
          ))}
          {portfolios.length < 3 && (
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              <button className="btn btn-secondary" style={{ flex:1, justifyContent:'center', padding:14, borderStyle:'dashed' }} onClick={() => setStep('new')}>
                + Nuovo Portafoglio
              </button>
              <button className="btn btn-secondary" style={{ flex:1, justifyContent:'center', padding:14, borderStyle:'dashed', color:'var(--accent-blue)', borderColor:'var(--accent-blue)' }}
                onClick={() => setShowImport(true)}>
                📥 Importa da Excel
              </button>
            </div>
          )}
          {portfolios.length >= 3 && (
            <div className="alert alert-info" style={{ marginTop: 12 }}>Hai raggiunto il limite massimo di 3 portafogli per account.</div>
          )}
        </>)}

        {/* ── STEP: NEW ── */}
        {step === 'new' && (
          <div className="card" style={{ border: '1px solid var(--border-strong)', position: 'relative' }}>
            <button onClick={() => { setStep('list'); setError(''); }} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-secondary)', lineHeight: 1 }}>✕</button>
            <button onClick={() => { setStep('list'); setError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>← Indietro</button>
            {error && <div className="alert alert-warning" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="form-group">
              <label className="form-label">Nome portafoglio</label>
              <input className="input" placeholder={defaultName} value={form.name} maxLength={30} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <div className="form-error" style={{ color: 'var(--text-muted)' }}>Lascia vuoto per nome automatico · max 30 caratteri</div>
            </div>
            <div className="form-group">
              <label className="form-label">Profilo di Rischio</label>
              <div className="radio-group">
                {['Prudente', 'Bilanciato', 'Aggressivo'].map(r => (
                  <div key={r} className={`radio-option ${form.riskProfile === r ? 'selected' : ''}`} onClick={() => setForm(f => ({ ...f, riskProfile: r }))}>
                    <div className={`radio-dot ${form.riskProfile === r ? 'checked' : ''}`} />{r}
                  </div>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Max % USA</label>
              <div className="radio-group">
                {['Min', '30', '60', 'No max'].map(v => (
                  <div key={v} className={`radio-option ${form.maxUSA === v ? 'selected' : ''}`} onClick={() => setForm(f => ({ ...f, maxUSA: v }))}>
                    <div className={`radio-dot ${form.maxUSA === v ? 'checked' : ''}`} />
                    {v === 'Min' ? 'Minima' : v === 'No max' ? 'Nessun limite' : `Max ${v}%`}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-primary" onClick={handleCreate}>Continua →</button>
            </div>
          </div>
        )}

        {/* ── STEP: AI-PROMPT ── */}
        {step === 'ai-prompt' && (
          <div className="card" style={{ border: '1px solid var(--border-strong)', position: 'relative' }}>
            {/* X chiusura con conferma */}
            <button onClick={async () => {
              if (window.confirm('Annullare la creazione del portafoglio? Il portafoglio verrà eliminato.')) {
                await deletePortfolio(newPortfolioId);
                setStep('list');
              }
            }} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-secondary)', lineHeight: 1 }}>✕</button>

            {/* Tasto indietro */}
            <button onClick={() => setStep('new')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              ← Indietro
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 24 }}>✨</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Genera il portafoglio con AI</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  L'AI selezionerà gli ETF più adatti al profilo <strong>{form.riskProfile}</strong>
                </div>
              </div>
            </div>
            {error && <div className="alert alert-warning" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="form-group">
              <label className="form-label">Orizzonte temporale</label>
              <div style={{ display:'flex', gap:8, marginTop:4 }}>
                {[['BREVE','< 5 anni'],['MEDIO','5-10 anni'],['LUNGO','> 10 anni']].map(([val,lab]) => (
                  <div key={val} onClick={() => setAiForm(f => ({...f, orizzonteAnni: val}))}
                    style={{ flex:1, padding:'8px 10px', borderRadius:8, cursor:'pointer', textAlign:'center',
                      border:'1px solid ' + (aiForm.orizzonteAnni===val ? 'var(--accent-blue)' : 'var(--border)'),
                      background: aiForm.orizzonteAnni===val ? 'rgba(59,130,246,0.1)' : 'var(--bg-primary)' }}>
                    <div style={{ fontSize:13, fontWeight:700, color: aiForm.orizzonteAnni===val ? 'var(--accent-blue)' : 'var(--text-primary)' }}>{val}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)' }}>{lab}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 8 }}>
                <input type="checkbox" checked={aiForm.usaBucket}
                  onChange={e => setAiForm(f => ({ ...f, usaBucket: e.target.checked }))} />
                <span>🪣 Strategia a <strong>due bucket</strong> (breve + lungo)</span>
              </label>
              {aiForm.usaBucket && (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>🔵 BREVE: {aiForm.pctBreve}%</span>
                    <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>🟡 LUNGO: {100 - aiForm.pctBreve}%</span>
                  </div>
                  <input type="range" min={10} max={80} step={5} value={aiForm.pctBreve}
                    onChange={e => setAiForm(f => ({ ...f, pctBreve: parseInt(e.target.value) }))}
                    style={{ width: '100%', accentColor: 'var(--accent-blue)', marginBottom: 10 }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Orizzonte breve (anni)</div>
                      <input className="input" type="number" min={1} max={5} value={aiForm.anniBreve}
                        onChange={e => setAiForm(f => ({ ...f, anniBreve: parseInt(e.target.value) || 1 }))}
                        style={{ fontSize: 12, padding: '4px 8px' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Orizzonte lungo (anni)</div>
                      <input className="input" type="number" min={5} max={30} value={aiForm.anniLungo}
                        onChange={e => setAiForm(f => ({ ...f, anniLungo: parseInt(e.target.value) || 5 }))}
                        style={{ fontSize: 12, padding: '4px 8px' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Capitale disponibile (€) — opzionale</label>
              <input className="input" type="number" placeholder="Es: 50000" value={aiForm.capitale}
                onChange={e => setAiForm(f => ({ ...f, capitale: e.target.value }))} />
              <div className="form-error" style={{ color: 'var(--text-muted)' }}>Se inserito, calcola automaticamente le quote da acquistare</div>
            </div>
            <div className="form-group">
              <label className="form-label">Preferenze o note — opzionale</label>
              <input className="input" placeholder="Es: preferisco ETF a basso TER, evitare emergenti..." value={aiForm.preferenze}
                onChange={e => setAiForm(f => ({ ...f, preferenze: e.target.value }))} />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={aiForm.escludiDistribuzione} onChange={e => setAiForm(f => ({ ...f, escludiDistribuzione: e.target.checked }))} />
                <span>Escludi ETF a <strong>Distribuzione</strong></span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(preferisci Accumulation per fiscalità italiana)</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--text-muted)' }} onClick={handleSaltaAI}>
                Salta Creazione
              </button>
              <button className="btn btn-primary" onClick={handleGeneraAI}>
                ✨ Genera con AI
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: AI-LOADING ── */}
        {step === 'ai-loading' && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>✨</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Generazione in corso...</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              L'AI sta analizzando il catalogo ETF e costruendo il portafoglio {form.riskProfile}
            </div>
          </div>
        )}

        {/* ── STEP: AI-RESULT ── */}
        {step === 'ai-result' && aiRisultato && (
          <div className="card" style={{ border: '1px solid var(--accent-green)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 24 }}>✅</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--accent-green)' }}>Portafoglio generato!</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {aiRisultato.selezione?.filter(s => !s.tipo || s.tipo === 'consigliato').length || 0} ETF selezionati · profilo {form.riskProfile}
                </div>
              </div>
            </div>
            {aiRisultato.spiegazione && (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px 0', padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                {aiRisultato.spiegazione.split(/METRICHE:|VERIFICA:/)[0].replace(/\*\*/g,'').trim().split(/[.!?]+/).slice(0,2).join('. ').trim()}.
              </p>
            )}
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleApriPortafoglio}>
              Apri il portafoglio →
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
