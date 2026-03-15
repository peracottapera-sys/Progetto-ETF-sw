import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function Performance() {
  const { currentPortfolio, getVendite, annullaVendita, getMinusvalenze, salvaMinusvalenzaManuale, eliminaMinusvalenzaManuale } = useApp();
  const [sortKey, setSortKey] = useState('nome');
  const [sortDir, setSortDir] = useState(1);
  const [vendite, setVendite] = useState([]);
  const [tabPerf, setTabPerf] = useState('aperte');
  const [minus, setMinus] = useState({ saldo: 0, manuali: [] });
  const [showMinusPanel, setShowMinusPanel] = useState(false);
  const [minusForm, setMinusForm] = useState({ importo: '', data_scadenza: '', note: '', condivisa: true });
  const [savingMinus, setSavingMinus] = useState(false);

  const reloadMinus = () => currentPortfolio?.id && getMinusvalenze(currentPortfolio.id).then(setMinus);

  useEffect(() => {
    if (currentPortfolio?.id) {
      getVendite(currentPortfolio.id).then(setVendite);
      getMinusvalenze(currentPortfolio.id).then(setMinus);
    }
  }, [currentPortfolio?.id]);

  const handleSalvaMinus = async () => {
    if (!minusForm.importo || parseFloat(minusForm.importo) <= 0) return;
    setSavingMinus(true);
    await salvaMinusvalenzaManuale(currentPortfolio.id, parseFloat(minusForm.importo), minusForm.data_scadenza || null, minusForm.note || null, minusForm.condivisa);
    setMinusForm({ importo: '', data_scadenza: '', note: '', condivisa: true });
    await reloadMinus();
    setSavingMinus(false);
  };

  const handleEliminaMinus = async (mid) => {
    if (!window.confirm('Eliminare questa minusvalenza manuale?')) return;
    await eliminaMinusvalenzaManuale(currentPortfolio.id, mid);
    reloadMinus();
  };

  if (!currentPortfolio) return null;

  const etfsAperti = currentPortfolio.etfs.filter(e => e.selected && e.acquisto && e.tipo !== 'venduto');

  const handleSort = (k) => {
    if (sortKey === k) setSortDir(d => -d);
    else { setSortKey(k); setSortDir(1); }
  };
  const arrow = k => sortKey === k ? (sortDir === 1 ? ' ↑' : ' ↓') : '';
  const calcMesi = (d) => !d ? 0 : Math.round((Date.now() - new Date(d)) / (1000*60*60*24*30.44));

  const rows = etfsAperti.map(e => {
    const { quantita, quotazioneAcquisto, dataAcquisto } = e.acquisto;
    const quotazioneAttuale = e.quotazione > 0 ? e.quotazione : quotazioneAcquisto;
    const prezzoAggiornato = e.quotazione > 0;
    const valoreAcquisto = quantita * quotazioneAcquisto;
    const valoreAttuale = quantita * quotazioneAttuale;
    const performance = valoreAttuale - valoreAcquisto;
    const tasse = performance > 0 ? performance * (e.tassazione / 100) : 0;
    const plFinale = performance - tasse;
    const mesi = calcMesi(dataAcquisto);
    return { ...e, quantita, quotazioneAcquisto, quotazioneAttuale, prezzoAggiornato, dataAcquisto, valoreAcquisto, valoreAttuale, performance, tasse, plFinale, mesi };
  }).sort((a, b) => {
    const map = { nome: 'name', valoreAcquisto: 'valoreAcquisto', valoreAttuale: 'valoreAttuale', performance: 'performance', pl: 'plFinale', mesi: 'mesi' };
    const k = map[sortKey] || sortKey;
    if (typeof a[k] === 'string') return a[k].localeCompare(b[k]) * sortDir;
    return ((a[k] || 0) - (b[k] || 0)) * sortDir;
  });

  const totAcquisto = rows.reduce((s, r) => s + r.valoreAcquisto, 0);
  const totAttuale = rows.reduce((s, r) => s + r.valoreAttuale, 0);
  const totPerf = totAttuale - totAcquisto;
  const totTasse = rows.reduce((s, r) => s + r.tasse, 0);
  const totPL = totPerf - totTasse;

  // Totali basati sui valori FIFO pre-calcolati dal server
  const totPLRealizzato = vendite.reduce((s, v) => s + (v.pl_lordo ?? (v.quotazione_vendita - (v.quotazione_acquisto||0)) * v.quantita), 0);
  const totTasseRealizzate = vendite.reduce((s, v) => s + (v.tasse ?? 0), 0);
  const totPLNettoRealizzato = vendite.reduce((s, v) => s + (v.pl_netto ?? 0), 0);
  const totMinusUsata = vendite.reduce((s, v) => s + (v.minus_usata || 0), 0);

  const fmt = v => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtEur = v => `€ ${fmt(v)}`;
  const perfColor = v => ({ color: v > 0 ? 'var(--accent-green)' : v < 0 ? 'var(--accent-red)' : 'var(--text-secondary)', fontWeight: 500 });
  const sign = v => v > 0 ? '+' : '';
  const Th = ({ k, children }) => (
    <th onClick={() => handleSort(k)} style={{ cursor: 'pointer', fontSize: 11 }}>{children}{arrow(k)}</th>
  );

  const stats = [
    { label: 'Investito', value: fmtEur(totAcquisto), valueColor: 'var(--text-primary)', sub: 'valore di carico' },
    { label: 'Valore Attuale', value: fmtEur(totAttuale), valueColor: 'var(--text-primary)', sub: 'ai prezzi correnti' },
    { label: 'Performance Lorda', value: `${sign(totPerf)}${fmtEur(totPerf)}`, valueColor: totPerf > 0 ? 'var(--accent-green)' : totPerf < 0 ? 'var(--accent-red)' : 'var(--text-secondary)', sub: `${sign(totPerf)}${totAcquisto > 0 ? ((totPerf/totAcquisto)*100).toFixed(2) : '0.00'}%` },
    { label: 'P&L Netto', value: `${sign(totPL)}${fmtEur(totPL)}`, valueColor: totPL > 0 ? 'var(--accent-green)' : totPL < 0 ? 'var(--accent-red)' : 'var(--text-secondary)', sub: `tasse stimate: ${fmtEur(totTasse)}` },
    ...(vendite.length > 0 ? [{
      label: 'P&L Realizzato', value: `${sign(totPLNettoRealizzato)}${fmtEur(totPLNettoRealizzato)}`,
      valueColor: totPLNettoRealizzato > 0 ? 'var(--accent-green)' : totPLNettoRealizzato < 0 ? 'var(--accent-red)' : 'var(--text-secondary)',
      sub: `${vendite.length} vendita${vendite.length > 1 ? 'e' : ''} · tasse: ${fmtEur(totTasseRealizzate)}${totMinusUsata > 0 ? ` · minus: ${fmtEur(totMinusUsata)}` : ''}`,
      highlight: true,
    }] : []),
    ...(minus.saldo > 0 ? [{
      label: 'Minus Disponibili',
      value: `€ ${fmt(minus.saldo)}`,
      valueColor: 'var(--accent-amber)',
      sub: 'compensano future plusvalenze',
      highlightAmber: true,
    }] : []),
  ];

  const handleAnnullaVendita = async (v) => {
    if (!window.confirm(`Annullare la vendita di ${v.quantita} quote di ${v.etf_name || v.isin}?`)) return;
    await annullaVendita(currentPortfolio.id, v.id);
    // Ricarica tutto in parallelo
    await Promise.all([
      getVendite(currentPortfolio.id).then(setVendite),
      getMinusvalenze(currentPortfolio.id).then(setMinus),
    ]);
  };

  return (
    <div style={{ padding: '0 0 28px 0' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', padding: '14px 28px 12px' }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontFamily: 'DM Serif Display, serif', fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>Performance</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
            {currentPortfolio.name} · ETF acquistati: {rows.length}{vendite.length > 0 ? ` · ${vendite.length} vendita${vendite.length > 1 ? 'e' : ''}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {stats.map((s, i) => (
            <div key={i} style={{ flex: 1, minWidth: 130, background: s.highlight ? 'rgba(239,68,68,0.08)' : s.highlightAmber ? 'rgba(245,158,11,0.08)' : 'var(--bg-card)', border: `1px solid ${s.highlight ? 'var(--accent-red)' : s.highlightAmber ? 'var(--accent-amber)' : 'var(--border)'}`, borderRadius: 10, padding: '10px 16px' }}>
              <div style={{ fontSize: 10, color: s.highlight ? 'var(--accent-red)' : s.highlightAmber ? 'var(--accent-amber)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: 18, color: s.valueColor, lineHeight: 1.2 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {vendite.length > 0 && (
        <div style={{ padding: '12px 28px 0' }}>
          <div className="tabs" style={{ width: 'auto', display: 'inline-flex' }}>
            <button className={`tab ${tabPerf === 'aperte' ? 'active' : ''}`} style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => setTabPerf('aperte')}>
              Posizioni aperte ({rows.length})
            </button>
            <button className={`tab ${tabPerf === 'chiuse' ? 'active' : ''}`} style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => setTabPerf('chiuse')}>
              <span style={{ color: tabPerf !== 'chiuse' ? 'var(--accent-red)' : 'inherit' }}>Posizioni chiuse ({vendite.length})</span>
            </button>
          </div>
        </div>
      )}

      {/* PANNELLO MINUSVALENZE MANUALI */}
      <div style={{ padding: '12px 28px 0' }}>
        <button onClick={() => setShowMinusPanel(v => !v)}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', gap: 8 }}>
          💰 Minusvalenze preesistenti (da altri broker/anni precedenti)
          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
            {minus.manuali.length > 0 ? `${minus.manuali.length} inserita${minus.manuali.length > 1 ? 'e' : ''} · saldo: €${fmt(minus.manuali.reduce((s,m)=>s+m.importo,0))}` : 'nessuna inserita'}
          </span>
          <span>{showMinusPanel ? '▲' : '▼'}</span>
        </button>

        {showMinusPanel && (
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Inserisci minusvalenze maturate fuori da questa app (altri broker, anni precedenti) per compensarle automaticamente con le future plusvalenze. Le minusvalenze scadono dopo 4 anni.
            </div>

            {/* Form inserimento */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: 2, minWidth: 120 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Importo (€)</div>
                <input className="input" type="number" min="0" step="0.01" placeholder="Es: 1500.00"
                  value={minusForm.importo} onChange={e => setMinusForm(f => ({ ...f, importo: e.target.value }))}
                  style={{ fontSize: 13 }} />
              </div>
              <div style={{ flex: 2, minWidth: 120 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Scadenza (opz.)</div>
                <input className="input" type="date" value={minusForm.data_scadenza}
                  onChange={e => setMinusForm(f => ({ ...f, data_scadenza: e.target.value }))}
                  style={{ fontSize: 13 }} />
              </div>
              <div style={{ flex: 3, minWidth: 160 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Note</div>
                <input className="input" placeholder="Es: Banca X, anno 2022" value={minusForm.note}
                  onChange={e => setMinusForm(f => ({ ...f, note: e.target.value }))}
                  style={{ fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 2 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Usa su tutti i portafogli</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={minusForm.condivisa}
                    onChange={e => setMinusForm(f => ({ ...f, condivisa: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent-gold)', cursor: 'pointer' }} />
                  <span style={{ fontSize: 12, color: minusForm.condivisa ? 'var(--accent-gold)' : 'var(--text-muted)', fontWeight: minusForm.condivisa ? 600 : 400 }}>
                    {minusForm.condivisa ? 'Sì — tutti i portafogli' : 'No — solo questo'}
                  </span>
                </label>
              </div>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '8px 14px', whiteSpace: 'nowrap' }}
                onClick={handleSalvaMinus} disabled={savingMinus || !minusForm.importo}>
                {savingMinus ? '...' : '+ Aggiungi'}
              </button>
            </div>

            {/* Lista minus manuali */}
            {minus.manuali.length > 0 && (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>Importo</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>Scadenza</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>Note</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>Tutti i portafogli</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>Inserita</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {minus.manuali.map(m => (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--accent-amber)', fontWeight: 700, fontFamily: 'monospace' }}>€{fmt(m.importo)}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{m.data_scadenza ? m.data_scadenza.slice(0,10).split('-').reverse().join('/') : '—'}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{m.note || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
                          background: m.condivisa !== 0 ? 'rgba(201,168,76,0.15)' : 'rgba(74,85,104,0.3)',
                          color: m.condivisa !== 0 ? 'var(--accent-gold)' : 'var(--text-muted)',
                        }}>
                          {m.condivisa !== 0 ? '✓ Tutti' : 'Solo questo'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{m.created_at?.slice(0,10).split('-').reverse().join('/')}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--accent-red)' }}
                          onClick={() => handleEliminaMinus(m.id)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--accent-amber)', fontFamily: 'monospace' }}>€{fmt(minus.manuali.reduce((s,m)=>s+m.importo,0))}</td>
                    <td colSpan={5} style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>Totale inserito manualmente</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}
      </div>

      {tabPerf === 'aperte' && (
        <div style={{ padding: '12px 28px 0' }}>
          {rows.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📈</div>
              <p>Nessun acquisto registrato.</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Seleziona degli ETF nel portafoglio e aggiungi i dati di acquisto.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <Th k="nome">ETF</Th>
                  <th style={{ fontSize: 11 }}>ISIN</th>
                  <th style={{ fontSize: 11 }}>Qt.</th>
                  <th style={{ fontSize: 11 }}>Quotaz. Acq. €</th>
                  <Th k="valoreAcquisto">Val. Acq. €</Th>
                  <th style={{ fontSize: 11 }}>Quotaz. Att. €</th>
                  <Th k="valoreAttuale">Val. Att. €</Th>
                  <Th k="performance">Perf. Lorda €</Th>
                  <th style={{ fontSize: 11 }}>Tasse €</th>
                  <Th k="pl">P&L Netto €</Th>
                  <Th k="mesi">Mesi</Th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.isin}>
                      <td><div style={{ fontWeight: 500, fontSize: 14, maxWidth: 180, whiteSpace: 'normal', lineHeight: 1.3 }}>{r.name}</div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{r.emittente}</div></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text-secondary)' }}>{r.isin}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 14 }}>{r.quantita}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 14 }}>{r.quotazioneAcquisto.toFixed(3)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 14 }}>{fmt(r.valoreAcquisto)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 14 }}>{r.quotazioneAttuale.toFixed(3)}{!r.prezzoAggiornato && <span title="Prezzo non aggiornato" style={{ color: 'var(--text-muted)', marginLeft: 2 }}>*</span>}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 14 }}>{fmt(r.valoreAttuale)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 14, ...perfColor(r.performance) }}>{sign(r.performance)}{fmt(r.performance)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 14, color: r.tasse > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{r.tasse > 0 ? fmt(r.tasse) : '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 14, ...perfColor(r.plFinale), fontWeight: 700 }}>{sign(r.plFinale)}{fmt(r.plFinale)}</td>
                      <td style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{r.mesi}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 1 && (
                  <tfoot><tr style={{ background: 'var(--bg-elevated)' }}>
                    <td colSpan={4} style={{ fontWeight: 600, fontSize: 14 }}>TOTALE</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700 }}>{fmt(totAcquisto)}</td>
                    <td />
                    <td style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700 }}>{fmt(totAttuale)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, ...perfColor(totPerf) }}>{sign(totPerf)}{fmt(totPerf)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--accent-amber)' }}>{fmt(totTasse)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, ...perfColor(totPL) }}>{sign(totPL)}{fmt(totPL)}</td>
                    <td />
                  </tr></tfoot>
                )}
              </table>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            * Tasse: 26% azionario/obblig. corporate, 12.5% obblig. governativo · * Prezzo stimato al costo di acquisto
          </div>
        </div>
      )}

      {tabPerf === 'chiuse' && (
        <div style={{ padding: '12px 28px 0' }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: 'var(--text-muted)', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(34,197,94,0.2)', border: '1px solid var(--accent-green)', display: 'inline-block' }} /> Plusvalenza</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(239,68,68,0.2)', border: '1px solid var(--accent-red)', display: 'inline-block' }} /> Minusvalenza</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(245,158,11,0.2)', border: '1px solid var(--accent-amber)', display: 'inline-block' }} /> Vendita parziale</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th style={{ fontSize: 11 }}>ETF</th>
                <th style={{ fontSize: 11 }}>ISIN</th>
                <th style={{ fontSize: 11 }}>Data</th>
                <th style={{ fontSize: 11 }}>Qt.</th>
                <th style={{ fontSize: 11 }}>P.zo Acq. €</th>
                <th style={{ fontSize: 11 }}>P.zo Vend. €</th>
                <th style={{ fontSize: 11 }}>Val. Vendita €</th>
                <th style={{ fontSize: 11 }}>P&L Lordo €</th>
                <th style={{ fontSize: 11, color: 'var(--accent-green)' }}>Minus €</th>
                <th style={{ fontSize: 11 }}>Tasse €</th>
                <th style={{ fontSize: 11 }}>P&L Netto €</th>
                <th style={{ fontSize: 11 }}>Tipo</th>
                <th style={{ fontSize: 11 }}>Note</th>
                <th style={{ fontSize: 11 }}></th>
              </tr></thead>
              <tbody>
                {vendite.map(v => {
                  const plLordo = v.pl_lordo ?? (v.quotazione_vendita - (v.quotazione_acquisto || 0)) * v.quantita;
                  const tasse = v.tasse ?? (plLordo > 0 ? plLordo * 0.26 : 0);
                  const plNetto = v.pl_netto ?? (plLordo - tasse);
                  const minusUsata = v.minus_usata || 0;
                  const minusGenerata = v.minus_generata || 0;
                  const isParziale = v.quantita_residua > 0;
                  const rowBg = isParziale ? 'rgba(245,158,11,0.06)' : plLordo >= 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)';
                  const borderColor = isParziale ? 'var(--accent-amber)' : plLordo >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
                  return (
                    <tr key={v.id} style={{ background: rowBg, borderLeft: `3px solid ${borderColor}` }}>
                      <td><div style={{ fontWeight: 500, fontSize: 13, maxWidth: 160, whiteSpace: 'normal', lineHeight: 1.3 }}>{v.etf_name || v.isin}</div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{v.categoria || ''}</div></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{v.isin}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{v.data_vendita?.slice(0,10).split('-').reverse().join('/')}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{v.quantita}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{v.quotazione_acquisto ? v.quotazione_acquisto.toFixed(3) : '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{v.quotazione_vendita.toFixed(3)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{fmt(v.quantita * v.quotazione_vendita)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13, ...perfColor(plLordo) }}>{sign(plLordo)}{fmt(plLordo)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13, color: minusUsata > 0 ? 'var(--accent-green)' : minusGenerata > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                        {minusUsata > 0 ? <span title="Minus compensata">-{fmt(minusUsata)}</span> : minusGenerata > 0 ? <span title="Minus generata">+{fmt(minusGenerata)}</span> : '—'}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13, color: tasse > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{tasse > 0 ? fmt(tasse) : '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13, ...perfColor(plNetto), fontWeight: 700 }}>{sign(plNetto)}{fmt(plNetto)}</td>
                      <td><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: `rgba(${isParziale?'245,158,11':'239,68,68'},0.15)`, color: borderColor, border: `1px solid ${borderColor}`, whiteSpace: 'nowrap' }}>{isParziale ? `PARZ. (${v.quantita_residua} rim.)` : 'TOTALE'}</span></td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 100, whiteSpace: 'normal' }}>{v.note || '—'}</td>
                      <td><button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px', color: 'var(--text-muted)' }} onClick={() => handleAnnullaVendita(v)} title="Annulla vendita">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr style={{ background: 'var(--bg-elevated)' }}>
                <td colSpan={7} style={{ fontWeight: 600, fontSize: 14 }}>TOTALE REALIZZATO</td>
                <td style={{ fontFamily: 'monospace', fontSize: 14, ...perfColor(totPLRealizzato), fontWeight: 700 }}>{sign(totPLRealizzato)}{fmt(totPLRealizzato)}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--accent-green)' }}>{totMinusUsata > 0 ? `-${fmt(totMinusUsata)}` : '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--accent-amber)' }}>{fmt(totTasseRealizzate)}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 14, ...perfColor(totPLNettoRealizzato), fontWeight: 700 }}>{sign(totPLNettoRealizzato)}{fmt(totPLNettoRealizzato)}</td>
                <td colSpan={3} />
              </tr></tfoot>
            </table>
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            P&L su prezzo acquisto registrato · Minus col. FIFO (manuali prima, poi da vendite) · Tasse al 26% sulla plus residua · ✕ annulla vendita
          </div>
        </div>
      )}
    </div>
  );
}
