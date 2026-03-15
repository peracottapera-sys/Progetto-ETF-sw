/**
 * reportExport.js — zero dipendenze npm
 * PDF: apre finestra di stampa browser
 * Excel: genera CSV scaricabile (apre in Excel)
 */

const fmt = (n, dec = 2) =>
  Number(n ?? 0).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const fmtEur = (n) => `€ ${fmt(n)}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('it-IT') : '');
const plSign = (val) => (val > 0 ? '+' : '');

const MONTHS_IT = ['','Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

const buildFilterLabel = ({ year, month, ticker, opType }) => {
  const parts = [`Anno: ${year}`];
  if (month) parts.push(`Mese: ${MONTHS_IT[Number(month)]}`);
  if (ticker) parts.push(`ETF: ${ticker}`);
  if (opType) parts.push(`Tipo: ${opType === 'BUY' ? 'Acquisti' : 'Vendite'}`);
  return parts.join('  |  ');
};

const buildFiscalSummary = (operations, year) => {
  const sells = operations.filter(op => op.type === 'SELL' && new Date(op.date).getFullYear() === Number(year));
  let plusvalenze = 0, minusvalenze = 0, compensazioni = 0;
  sells.forEach(op => {
    const pl = op.realizedPL ?? 0;
    if (pl > 0) plusvalenze += pl;
    else minusvalenze += Math.abs(pl);
    compensazioni += op.compensatedLoss ?? 0;
  });
  const imponibile = Math.max(0, plusvalenze - compensazioni);
  return { plusvalenze, minusvalenze, compensazioni, imponibile, imposta: imponibile * 0.26 };
};

// ── EXPORT PDF ────────────────────────────────────────────────────────────────
export const exportToPDF = (operations, filters) => {
  const { year } = filters;
  const fiscal = buildFiscalSummary(operations, year);
  const oggi = new Date().toLocaleDateString('it-IT');
  const sells = operations.filter(op => op.type === 'SELL');
  const totalPL = sells.reduce((s, op) => s + (op.realizedPL ?? 0), 0);

  const righe = operations.map(op => {
    const pl = op.realizedPL ?? 0;
    const comp = op.compensatedLoss ?? 0;
    const controvalore = (op.quantity ?? 0) * (op.price ?? 0);
    const plColor = pl > 0 ? '#4ade80' : pl < 0 ? '#f87171' : '#9ca3af';
    return `<tr>
      <td>${fmtDate(op.date)}</td>
      <td><span class="badge ${op.type === 'BUY' ? 'badge-buy' : 'badge-sell'}">${op.type === 'BUY' ? 'Acquisto' : 'Vendita'}</span></td>
      <td><strong>${op.ticker ?? ''}</strong><br><small>${op.name ?? ''}</small></td>
      <td class="num">${fmt(op.quantity, 4)}</td>
      <td class="num">${fmtEur(op.price)}</td>
      <td class="num">${fmtEur(controvalore)}</td>
      <td class="num" style="color:${op.type === 'SELL' ? plColor : '#6b7280'}">${op.type === 'SELL' ? plSign(pl) + fmtEur(pl) : '—'}</td>
      <td class="num" style="color:${comp > 0 ? '#facc15' : '#6b7280'}">${comp > 0 ? fmtEur(comp) : '—'}</td>
      <td style="font-size:10px;color:#9ca3af">${op.notes ?? ''}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<title>Report Operazioni ${year}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;background:#111827;color:#e5e7eb;font-size:12px;padding:24px}
h1{font-size:20px;font-weight:700;color:#fff;margin-bottom:4px}
.subtitle{color:#9ca3af;font-size:12px;margin-bottom:20px}
.fiscal{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px}
.fiscal-card{background:#1f2937;border:1px solid #374151;border-radius:8px;padding:10px 14px}
.fiscal-card .label{font-size:10px;color:#9ca3af;margin-bottom:4px}
.fiscal-card .value{font-size:14px;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:#111827;color:#9ca3af;font-size:10px;padding:8px 6px;text-align:left;border-bottom:1px solid #374151;white-space:nowrap}
td{padding:7px 6px;border-bottom:1px solid #1f2937;vertical-align:top}
.num{text-align:right;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:2px 7px;border-radius:99px;font-size:10px;font-weight:600}
.badge-buy{background:rgba(59,130,246,.2);color:#93c5fd;border:1px solid rgba(59,130,246,.3)}
.badge-sell{background:rgba(249,115,22,.2);color:#fdba74;border:1px solid rgba(249,115,22,.3)}
tfoot td{font-weight:700;background:#111827;border-top:1px solid #374151;padding:8px 6px}
.note{margin-top:16px;font-size:10px;color:#6b7280;border-top:1px solid #374151;padding-top:12px}
@media print{
  body{background:white;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:12px}
  .fiscal-card{border:1px solid #ddd;background:#f9fafb}
  th{background:#f3f4f6;color:#374151}
  td{border-bottom:1px solid #e5e7eb}
  .badge-buy{background:#dbeafe;color:#1d4ed8;border:none}
  .badge-sell{background:#ffedd5;color:#c2410c;border:none}
  tfoot td{background:#f3f4f6}
}
</style></head><body>
<h1>Report Storico Operazioni ETF</h1>
<p class="subtitle">${buildFilterLabel(filters)} · ${operations.length} operazioni · Generato il ${oggi}</p>
<div class="fiscal">
  <div class="fiscal-card"><div class="label">Plusvalenze lorde</div><div class="value" style="color:#4ade80">${fmtEur(fiscal.plusvalenze)}</div></div>
  <div class="fiscal-card"><div class="label">Minusvalenze</div><div class="value" style="color:#f87171">${fmtEur(fiscal.minusvalenze)}</div></div>
  <div class="fiscal-card"><div class="label">Compensazioni FIFO</div><div class="value" style="color:#facc15">${fmtEur(fiscal.compensazioni)}</div></div>
  <div class="fiscal-card"><div class="label">Imponibile netto</div><div class="value" style="color:#fff">${fmtEur(fiscal.imponibile)}</div></div>
  <div class="fiscal-card"><div class="label">Imposta stimata (26%)</div><div class="value" style="color:#fb923c">${fmtEur(fiscal.imposta)}</div></div>
</div>
<table>
<thead><tr><th>Data</th><th>Tipo</th><th>ETF / Strumento</th><th class="num">Quantità</th><th class="num">Prezzo</th><th class="num">Controvalore</th><th class="num">P&amp;L Realizz.</th><th class="num">Comp. FIFO</th><th>Note</th></tr></thead>
<tbody>${righe}</tbody>
<tfoot><tr>
  <td colspan="6" style="text-align:right;color:#9ca3af">P&amp;L totale vendite:</td>
  <td class="num" style="color:${totalPL >= 0 ? '#4ade80' : '#f87171'}">${plSign(totalPL)}${fmtEur(totalPL)}</td>
  <td class="num" style="color:#facc15">${fmtEur(fiscal.compensazioni)}</td>
  <td></td>
</tr></tfoot>
</table>
<div class="note">* Dati fiscali indicativi. Verificare con il proprio intermediario o commercialista.</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) alert('Abilita i popup nel browser per esportare il PDF');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

// ── EXPORT CSV (apre in Excel) ────────────────────────────────────────────────
const csvEscape = (val) => {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('\n') || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
  return s;
};
const csvRow = (arr) => arr.map(csvEscape).join(',') + '\r\n';

export const exportToExcel = (operations, filters) => {
  const { year } = filters;
  const fiscal = buildFiscalSummary(operations, year);
  let csv = '\uFEFF'; // BOM per Excel italiano

  csv += csvRow(['REPORT STORICO OPERAZIONI ETF', year]);
  csv += csvRow(['Filtri:', buildFilterLabel(filters)]);
  csv += csvRow(['Generato il:', new Date().toLocaleDateString('it-IT')]);
  csv += csvRow([]);
  csv += csvRow(['--- RIEPILOGO FISCALE ---']);
  csv += csvRow(['Plusvalenze lorde', fmt(fiscal.plusvalenze)]);
  csv += csvRow(['Minusvalenze', fmt(fiscal.minusvalenze)]);
  csv += csvRow(['Compensazioni FIFO', fmt(fiscal.compensazioni)]);
  csv += csvRow(['Imponibile netto', fmt(fiscal.imponibile)]);
  csv += csvRow(['Imposta stimata (26%)', fmt(fiscal.imposta)]);
  csv += csvRow([]);
  csv += csvRow(['--- DETTAGLIO OPERAZIONI ---']);
  csv += csvRow(['Data','Tipo','Ticker','Nome ETF','Quantità','Prezzo (€)','Controvalore (€)','P&L Realizzato (€)','Compensazione FIFO (€)','Note']);

  operations.forEach(op => {
    const pl = op.realizedPL ?? 0;
    const comp = op.compensatedLoss ?? 0;
    csv += csvRow([
      fmtDate(op.date),
      op.type === 'BUY' ? 'Acquisto' : 'Vendita',
      op.ticker ?? '', op.name ?? '',
      fmt(op.quantity, 4), fmt(op.price),
      fmt((op.quantity ?? 0) * (op.price ?? 0)),
      op.type === 'SELL' ? fmt(pl) : '',
      comp > 0 ? fmt(comp) : '',
      op.notes ?? '',
    ]);
  });

  csv += csvRow([]);
  const vendite = operations.filter(op => op.type === 'SELL');
  if (vendite.length > 0) {
    csv += csvRow(['--- SOLO VENDITE ---']);
    csv += csvRow(['Data','Ticker','Nome ETF','Quantità','Prezzo vendita (€)','Controvalore (€)','P&L Lordo (€)','Comp. applicata (€)','P&L Netto (€)']);
    vendite.forEach(op => {
      const pl = op.realizedPL ?? 0;
      const comp = op.compensatedLoss ?? 0;
      csv += csvRow([
        fmtDate(op.date), op.ticker ?? '', op.name ?? '',
        fmt(op.quantity, 4), fmt(op.price),
        fmt((op.quantity ?? 0) * (op.price ?? 0)),
        fmt(pl), fmt(comp), fmt(pl - comp),
      ]);
    });
    csv += csvRow([]);
    csv += csvRow(['* Dati fiscali indicativi. Verificare con il proprio intermediario.']);
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const m = filters.month ? `_${String(filters.month).padStart(2, '0')}` : '';
  const t = filters.ticker ? `_${filters.ticker}` : '';
  a.download = `report_etf_${year}${m}${t}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};
