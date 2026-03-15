import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

export default function VenditaModal({ etf, portfolioId, onClose }) {
  const { registraVendita, getMinusvalenze } = useApp();
  const oggi = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
  const qtDisponibili = etf.acquisto?.quantita || 0;
  const quotazioneAttuale = etf.quotazione || etf.acquisto?.quotazioneAcquisto || 0;
  const [form, setForm] = useState({ quantita: qtDisponibili, quotazione_vendita: quotazioneAttuale.toFixed(3), data_vendita: oggi, note: '' });
  const [saving, setSaving] = useState(false);
  const [errore, setErrore] = useState('');
  const [minusDisponibili, setMinusDisponibili] = useState(0);

  React.useEffect(() => {
    getMinusvalenze(portfolioId).then(d => setMinusDisponibili(d.saldo || 0));
  }, [portfolioId]);

  const qVenduta = parseFloat(form.quantita) || 0;
  const qVendita = parseFloat(form.quotazione_vendita) || 0;
  const qAcquisto = etf.acquisto?.quotazioneAcquisto || 0;
  const plLordo = (qVendita - qAcquisto) * qVenduta;
  const isTotale = qVenduta >= qtDisponibili;

  // Calcolo con compensazione
  let minusUsata = 0, tasse = 0, minusGenerata = 0;
  if (plLordo > 0) {
    const plCompensato = Math.max(0, plLordo - minusDisponibili);
    minusUsata = Math.min(minusDisponibili, plLordo);
    tasse = plCompensato * 0.26;
  } else if (plLordo < 0) {
    minusGenerata = Math.abs(plLordo);
  }
  const plNetto = plLordo - tasse;
  const fmt2 = v => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleSave = async () => {
    if (!form.data_vendita.match(/^\d{2}\/\d{2}\/\d{4}$/)) { setErrore('Data non valida (dd/mm/aaaa)'); return; }
    setSaving(true);
    const [d, m, y] = form.data_vendita.split('/');
    const res = await registraVendita(portfolioId, etf.isin, qVenduta, qVendita, `${y}-${m}-${d}`, form.note);
    setSaving(false);
    if (!res.ok) { setErrore(res.error || 'Errore'); return; }
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 460 }}>
        <div className="modal-title" style={{ color: 'var(--accent-red)' }}>📤 Registra Vendita</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          {etf.name} <span style={{ color: 'var(--accent-gold)', fontSize: 11, marginLeft: 6 }}>{etf.isin}</span>
          <span style={{ marginLeft: 12, color: 'var(--text-muted)', fontSize: 11 }}>Disponibili: {qtDisponibili} quote</span>
        </div>

        {errore && <div className="alert alert-warning" style={{ marginBottom: 12 }}>{errore}</div>}

        {minusDisponibili > 0 && (
          <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid var(--accent-green)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 12 }}>
            <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>✓ Minusvalenze disponibili: €{fmt2(minusDisponibili)}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>— verranno usate automaticamente per compensare eventuali plusvalenze</span>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Quantità da vendere</label>
          <input className="input" type="number" min="1" max={qtDisponibili} step="1"
            value={form.quantita} onChange={e => setForm(f => ({ ...f, quantita: e.target.value }))} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {isTotale ? <span style={{ color: 'var(--accent-amber)' }}>⚠ Vendita totale — ETF si sposta in tab "Chiusi"</span>
              : <span>Residuo: <strong>{(qtDisponibili - qVenduta).toFixed(0)} quote</strong></span>}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Quotazione di vendita (€)</label>
          <input className="input" type="number" min="0" step="0.001"
            value={form.quotazione_vendita} onChange={e => setForm(f => ({ ...f, quotazione_vendita: e.target.value }))} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Default: quotazione attuale ({quotazioneAttuale.toFixed(3)})</div>
        </div>

        <div className="form-group">
          <label className="form-label">Data di vendita (dd/mm/aaaa)</label>
          <input className="input" placeholder="dd/mm/aaaa" value={form.data_vendita}
            onChange={e => setForm(f => ({ ...f, data_vendita: e.target.value }))} />
        </div>

        <div className="form-group">
          <label className="form-label">Note (opzionale)</label>
          <input className="input" placeholder="Es: ribilanciamento, take profit..." value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
        </div>

        {qVenduta > 0 && qVendita > 0 && qAcquisto > 0 && (
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ color: 'var(--text-secondary)' }}>P&L lordo</span>
              <strong style={{ color: plLordo >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {plLordo >= 0 ? '+' : ''}€{fmt2(plLordo)}
              </strong>
            </div>
            {minusUsata > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ color: 'var(--accent-green)', fontSize: 12 }}>↳ Minus compensata</span>
                <span style={{ color: 'var(--accent-green)', fontSize: 12 }}>-€{fmt2(minusUsata)}</span>
              </div>
            )}
            {minusGenerata > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ color: 'var(--accent-amber)', fontSize: 12 }}>↳ Minus generata (salvata)</span>
                <span style={{ color: 'var(--accent-amber)', fontSize: 12 }}>+€{fmt2(minusGenerata)}</span>
              </div>
            )}
            {tasse > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Tasse stimate (26% su €{fmt2(plLordo - minusUsata)})</span>
                <span style={{ color: 'var(--accent-amber)' }}>-€{fmt2(tasse)}</span>
              </div>
            )}
            {tasse === 0 && plLordo > 0 && minusUsata > 0 && (
              <div style={{ fontSize: 11, color: 'var(--accent-green)', marginBottom: 5 }}>
                ✓ Plusvalenza interamente compensata da minusvalenze — nessuna tassa dovuta
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              <span style={{ color: 'var(--text-secondary)' }}>P&L netto</span>
              <strong style={{ color: plNetto >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 15 }}>
                {plNetto >= 0 ? '+' : ''}€{fmt2(plNetto)}
              </strong>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Annulla</button>
          <button className="btn btn-danger" onClick={handleSave} disabled={saving || qVenduta <= 0 || qVenduta > qtDisponibili}>
            {saving ? 'Salvataggio...' : '📤 Conferma Vendita'}
          </button>
        </div>
      </div>
    </div>
  );
}
