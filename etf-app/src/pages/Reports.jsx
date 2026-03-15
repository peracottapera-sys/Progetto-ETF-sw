import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { exportToPDF, exportToExcel } from './reportExport';

const API = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  || process.env?.REACT_APP_API_URL
  || 'http://localhost:3001';
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = [
  { value: '', label: 'Tutti i mesi' },
  { value: '1', label: 'Gennaio' },   { value: '2', label: 'Febbraio' },
  { value: '3', label: 'Marzo' },     { value: '4', label: 'Aprile' },
  { value: '5', label: 'Maggio' },    { value: '6', label: 'Giugno' },
  { value: '7', label: 'Luglio' },    { value: '8', label: 'Agosto' },
  { value: '9', label: 'Settembre' }, { value: '10', label: 'Ottobre' },
  { value: '11', label: 'Novembre' }, { value: '12', label: 'Dicembre' },
];

const fmt = (n, dec = 2) =>
  Number(n ?? 0).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtEur = (n) => `€ ${fmt(n)}`;
const plColor = (v) => v > 0 ? 'var(--accent-green)' : v < 0 ? 'var(--accent-red)' : 'var(--text-muted)';
const plSign = (v) => v > 0 ? '+' : '';

// ── Riepilogo fiscale ──────────────────────────────────────────────────────────
function FiscalSummary({ operations, year }) {
  const fiscal = useMemo(() => {
    const sells = operations.filter(op =>
      op.type === 'SELL' && new Date(op.date).getFullYear() === Number(year)
    );
    let plus = 0, minus = 0, comp = 0;
    sells.forEach(op => {
      const pl = op.realizedPL ?? 0;
      if (pl > 0) plus += pl; else minus += Math.abs(pl);
      comp += op.compensatedLoss ?? 0;
    });
    const imponibile = Math.max(0, plus - comp);
    return { plus, minus, comp, imponibile, imposta: imponibile * 0.26, nVendite: sells.length };
  }, [operations, year]);

  const items = [
    { label: 'Plusvalenze lorde',     value: fmtEur(fiscal.plus),       color: 'var(--accent-green)' },
    { label: 'Minusvalenze',          value: fmtEur(fiscal.minus),       color: 'var(--accent-red)' },
    { label: 'Compensazioni FIFO',    value: fmtEur(fiscal.comp),        color: 'var(--accent-gold)' },
    { label: 'Imponibile netto',      value: fmtEur(fiscal.imponibile),  color: 'var(--text-primary)' },
    { label: 'Imposta stimata (26%)', value: fmtEur(fiscal.imposta),     color: '#fb923c', sub: '* stima indicativa' },
  ];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Riepilogo Fiscale {year}</div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fiscal.nVendite} vendite</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {items.map(({ label, value, color, sub }) => (
          <div key={label} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
            {sub && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tabella operazioni con selezione ──────────────────────────────────────────
function OperationsTable({ operations, selected, onToggle, onToggleAll }) {
  if (operations.length === 0) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
      <div style={{ fontSize: 14 }}>Nessuna operazione trovata</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>Prova a modificare i filtri</div>
    </div>
  );

  const allSelected = operations.length > 0 && operations.every(op => selected.has(`${op.type}:${op.id}`));
  const someSelected = operations.some(op => selected.has(`${op.type}:${op.id}`));

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '6px 8px', width: 36 }}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={() => onToggleAll(operations)}
                style={{ cursor: 'pointer', accentColor: 'var(--accent-gold)' }}
              />
            </th>
            {['Data','Tipo','ETF / Strumento','Quantità','Prezzo','Controvalore','P&L Realizz.','Comp. FIFO','Note'].map(h => (
              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {operations.map((op, i) => {
            const key = `${op.type}:${op.id}`;
            const isSelected = selected.has(key);
            const pl = op.realizedPL ?? 0;
            const comp = op.compensatedLoss ?? 0;
            const controvalore = (op.quantity ?? 0) * (op.price ?? 0);
            return (
              <tr
                key={key}
                style={{
                  borderBottom: '1px solid var(--border)',
                  background: isSelected ? 'rgba(239,68,68,0.06)' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => onToggle(key)}
              >
                <td style={{ padding: '8px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(key)}
                    style={{ cursor: 'pointer', accentColor: 'var(--accent-gold)' }}
                  />
                </td>
                <td style={{ padding: '8px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {new Date(op.date).toLocaleDateString('it-IT')}
                </td>
                <td style={{ padding: '8px' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600,
                    background: op.type === 'BUY' ? 'rgba(59,130,246,.18)' : 'rgba(249,115,22,.18)',
                    color: op.type === 'BUY' ? '#93c5fd' : '#fdba74',
                    border: `1px solid ${op.type === 'BUY' ? 'rgba(59,130,246,.3)' : 'rgba(249,115,22,.3)'}`,
                  }}>
                    {op.type === 'BUY' ? 'Acquisto' : 'Vendita'}
                  </span>
                </td>
                <td style={{ padding: '8px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{op.ticker}</div>
                  {op.name && <div style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.name}</div>}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(op.quantity, 4)}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtEur(op.price)}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtEur(controvalore)}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: op.type === 'SELL' ? plColor(pl) : 'var(--text-muted)' }}>
                  {op.type === 'SELL' ? `${plSign(pl)}${fmtEur(pl)}` : '—'}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', color: comp > 0 ? 'var(--accent-gold)' : 'var(--text-muted)' }}>
                  {comp > 0 ? fmtEur(comp) : '—'}
                </td>
                <td style={{ padding: '8px', fontSize: 11, color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {op.notes ?? ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Modale conferma eliminazione ──────────────────────────────────────────────
function ConfirmDeleteModal({ count, onConfirm, onCancel, deleting }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">🗑 Elimina operazioni</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
          Stai per eliminare <strong style={{ color: 'var(--accent-red)' }}>{count} operazione{count !== 1 ? 'i' : 'e'}</strong>.<br />
          Le vendite eliminate ripristinano le quantità in portafoglio e il saldo minusvalenze.<br />
          <strong>Questa operazione non è reversibile.</strong>
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={deleting}>Annulla</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? '⏳ Eliminazione…' : `🗑 Elimina ${count} operazione${count !== 1 ? 'i' : 'e'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Componente principale ──────────────────────────────────────────────────────
export default function Reports() {
  const { token, currentPortfolio } = useApp();

  const [year, setYear]     = useState(String(CURRENT_YEAR));
  const [month, setMonth]   = useState('');
  const [ticker, setTicker] = useState('');
  const [opType, setOpType] = useState('');

  const [operations, setOperations] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [exporting, setExporting]   = useState(null);

  // Selezione righe
  const [selected, setSelected] = useState(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [deleteMsg, setDeleteMsg] = useState(null);

  const portfolioId = currentPortfolio?.id;

  const tickers = useMemo(() => {
    const set = new Set(operations.map(op => op.ticker).filter(Boolean));
    return Array.from(set).sort();
  }, [operations]);

  const fetchOps = useCallback(async () => {
    if (!token || !portfolioId) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ year, portfolioId });
      if (month)  params.set('month', month);
      if (ticker) params.set('ticker', ticker);
      if (opType) params.set('type', opType);
      const res = await fetch(
        `${API}/api/reports/operations?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Errore server: ${res.status}`);
      const data = await res.json();
      setOperations(data.operations ?? []);
    } catch (err) {
      setError(err.message);
      setOperations([]);
    } finally {
      setLoading(false);
    }
  }, [token, portfolioId, year, month, ticker, opType]);

  useEffect(() => { fetchOps(); }, [fetchOps]);

  // Toggle singola riga
  const handleToggle = useCallback((key) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // Toggle tutte
  const handleToggleAll = useCallback((ops) => {
    const allKeys = ops.map(op => `${op.type}:${op.id}`);
    const allSelected = allKeys.every(k => selected.has(k));
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        allKeys.forEach(k => next.delete(k));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        allKeys.forEach(k => next.add(k));
        return next;
      });
    }
  }, [selected]);

  // Elimina selezionate
  const handleDelete = async () => {
    setDeleting(true);
    try {
      const toDelete = Array.from(selected).map(key => {
        const [type, id] = key.split(':');
        return { type, id: Number(id) };
      });
      const res = await fetch(`${API}/api/reports/operations/bulk`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ operations: toDelete }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDeleteMsg(`✓ ${data.deleted} operazione${data.deleted !== 1 ? 'i' : 'e'} eliminata${data.deleted !== 1 ? 'e' : ''}`);
      setShowConfirm(false);
      setSelected(new Set());
      await fetchOps();
      setTimeout(() => setDeleteMsg(null), 4000);
    } catch (err) {
      setDeleteMsg(`⚠ Errore: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  const totals = useMemo(() => {
    const sells = operations.filter(op => op.type === 'SELL');
    return {
      count: operations.length,
      sells: sells.length,
      buys:  operations.filter(op => op.type === 'BUY').length,
      plTot: sells.reduce((s, op) => s + (op.realizedPL ?? 0), 0),
      compTot: sells.reduce((s, op) => s + (op.compensatedLoss ?? 0), 0),
    };
  }, [operations]);

  const selectStyle = {
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', fontSize: 13, borderRadius: 6,
    padding: '6px 10px', outline: 'none', cursor: 'pointer',
  };
  const labelStyle = { fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, display: 'block' };
  const nSelected = selected.size;

  return (
    <div style={{ padding: '20px 16px' }}>
      {/* Modale conferma */}
      {showConfirm && (
        <ConfirmDeleteModal
          count={nSelected}
          onConfirm={handleDelete}
          onCancel={() => setShowConfirm(false)}
          deleting={deleting}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: 'DM Serif Display, serif', fontSize: 24 }}>Report Storico Operazioni</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
            Storico acquisti, vendite e compensazioni minusvalenze FIFO
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Pulsante elimina — visibile solo se ci sono selezioni */}
          {nSelected > 0 && (
            <button
              className="btn btn-danger"
              onClick={() => setShowConfirm(true)}
            >
              🗑 Elimina {nSelected} selezionate
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={async () => { setExporting('pdf'); try { await exportToPDF(operations, { year, month, ticker, opType }); } finally { setExporting(null); } }}
            disabled={!!exporting || operations.length === 0}
          >
            {exporting === 'pdf' ? '⏳' : '🖨️'} Export PDF
          </button>
          <button
            className="btn btn-secondary"
            onClick={async () => { setExporting('excel'); try { await exportToExcel(operations, { year, month, ticker, opType }); } finally { setExporting(null); } }}
            disabled={!!exporting || operations.length === 0}
          >
            {exporting === 'excel' ? '⏳' : '📊'} Export Excel
          </button>
        </div>
      </div>

      {/* Messaggio esito eliminazione */}
      {deleteMsg && (
        <div className={`alert ${deleteMsg.startsWith('✓') ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: 16 }}>
          {deleteMsg}
        </div>
      )}

      {/* Filtri */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <div>
            <label style={labelStyle}>Anno</label>
            <select style={selectStyle} value={year} onChange={e => setYear(e.target.value)}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Mese</label>
            <select style={selectStyle} value={month} onChange={e => setMonth(e.target.value)}>
              {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>ETF / Strumento</label>
            <select style={selectStyle} value={ticker} onChange={e => setTicker(e.target.value)}>
              <option value="">Tutti gli strumenti</option>
              {tickers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Tipo operazione</label>
            <select style={selectStyle} value={opType} onChange={e => setOpType(e.target.value)}>
              <option value="">Tutti i tipi</option>
              <option value="BUY">Acquisto</option>
              <option value="SELL">Vendita</option>
            </select>
          </div>
        </div>
      </div>

      {/* Riepilogo fiscale */}
      {(!opType || opType === 'SELL') && (
        <FiscalSummary operations={operations} year={year} />
      )}

      {/* Stat bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Operazioni totali', value: totals.count, color: 'var(--text-primary)' },
          { label: 'Vendite',           value: totals.sells, color: 'var(--text-primary)' },
          { label: 'Acquisti',          value: totals.buys,  color: 'var(--text-primary)' },
          {
            label: 'P&L realizzato',
            value: (totals.plTot >= 0 ? '+' : '') + fmtEur(totals.plTot),
            color: plColor(totals.plTot),
            sub: totals.compTot > 0 ? `Comp. FIFO: ${fmtEur(totals.compTot)}` : null,
          },
        ].map(({ label, value, color, sub }) => (
          <div key={label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
            {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* Tabella */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Dettaglio Operazioni</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {nSelected > 0 && (
              <span style={{ fontSize: 12, color: 'var(--accent-amber)' }}>
                {nSelected} selezionate
              </span>
            )}
            {!loading && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {operations.length} {operations.length === 1 ? 'operazione' : 'operazioni'}
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            ⏳ Caricamento operazioni…
          </div>
        ) : error ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--accent-red)', fontSize: 13 }}>
            ⚠ {error}
          </div>
        ) : (
          <OperationsTable
            operations={operations}
            selected={selected}
            onToggle={handleToggle}
            onToggleAll={handleToggleAll}
          />
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
        * P&L su prezzo acquisto registrato · Compensazioni FIFO (manuali prima, poi da vendite) · Tasse al 26% sulla plus residua
      </div>
    </div>
  );
}
