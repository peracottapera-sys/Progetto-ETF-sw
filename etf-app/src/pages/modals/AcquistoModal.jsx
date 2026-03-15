import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

function AcquistoModal({ etf, portfolioId, onClose }) {
  const { saveAcquisto } = useApp();
  const oggi = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
  const [form, setForm] = useState({
    quantita: etf.acquisto?.quantita || '',
    quotazioneAcquisto: etf.acquisto?.quotazioneAcquisto || etf.quotazione,
    dataAcquisto: etf.acquisto?.dataAcquisto ? etf.acquisto.dataAcquisto.split('-').reverse().join('/') : oggi
  });

  const handleSave = () => {
    const [d, m, y] = form.dataAcquisto.split('/');
    saveAcquisto(portfolioId, etf.isin, {
      quantita: parseFloat(form.quantita),
      quotazioneAcquisto: parseFloat(form.quotazioneAcquisto),
      dataAcquisto: `${y}-${m}-${d}`
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 420 }}>
        <div className="modal-title">Dati di Acquisto</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          {etf.name} <span style={{ color: 'var(--accent-gold)', fontSize: 11, marginLeft: 6 }}>{etf.isin}</span>
        </div>
        <div className="form-group">
          <label className="form-label">Quantità titoli</label>
          <input className="input" type="number" min="0" step="1" placeholder="Es: 10"
            value={form.quantita} onChange={e => setForm(f => ({ ...f, quantita: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Quotazione di acquisto (€)</label>
          <input className="input" type="number" min="0" step="0.001"
            value={form.quotazioneAcquisto} onChange={e => setForm(f => ({ ...f, quotazioneAcquisto: e.target.value }))} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Default: quotazione attuale ({etf.quotazione.toFixed(3)})
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Data di acquisto (dd/mm/aaaa)</label>
          <input className="input" placeholder="dd/mm/aaaa" value={form.dataAcquisto}
            onChange={e => setForm(f => ({ ...f, dataAcquisto: e.target.value }))} />
        </div>
        {form.quantita && form.quotazioneAcquisto && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            Valore totale: <strong>€ {(parseFloat(form.quantita) * parseFloat(form.quotazioneAcquisto)).toLocaleString('it-IT', { minimumFractionDigits: 2 })}</strong>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Annulla</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!form.quantita}>Salva</button>
        </div>
      </div>
    </div>
  );
}


export default AcquistoModal;
