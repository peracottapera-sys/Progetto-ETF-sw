const express = require('express');
const authMiddleware = require('../middleware/auth');

module.exports = (db) => {
  const router = express.Router();

  // DELETE /api/reports/operations/bulk
  router.delete('/operations/bulk', authMiddleware, (req, res) => {
    const { operations } = req.body;
    if (!Array.isArray(operations) || operations.length === 0)
      return res.status(400).json({ error: 'Nessuna operazione specificata' });

    const portfolioIds = db.prepare('SELECT id FROM portfolios WHERE user_id=?').all(req.user.id).map(p => p.id);
    if (portfolioIds.length === 0) return res.status(403).json({ error: 'Nessun portafoglio trovato' });
    const placeholders = portfolioIds.map(() => '?').join(',');

    let deleted = 0;
    const errors = [];

    db.transaction(() => {
      for (const { id, type } of operations) {
        try {
          if (type === 'SELL') {
            const v = db.prepare(`SELECT * FROM vendite WHERE id=? AND portfolio_id IN (${placeholders})`).get(id, ...portfolioIds);
            if (!v) { errors.push(`Vendita ${id} non trovata`); continue; }
            const plLordo = (v.quotazione_vendita - (v.quotazione_acquisto || 0)) * v.quantita;
            const port = db.prepare('SELECT minusvalenze_disponibili FROM portfolios WHERE id=?').get(v.portfolio_id);
            db.prepare('DELETE FROM vendite WHERE id=?').run(v.id);
            const acqEsistente = db.prepare('SELECT * FROM acquisti WHERE portfolio_id=? AND isin=?').get(v.portfolio_id, v.isin);
            if (acqEsistente) db.prepare('UPDATE acquisti SET quantita=? WHERE portfolio_id=? AND isin=?').run(acqEsistente.quantita + v.quantita, v.portfolio_id, v.isin);
            let nuovoSaldo = port?.minusvalenze_disponibili || 0;
            if (plLordo > 0) nuovoSaldo += Math.min(nuovoSaldo, plLordo);
            else if (plLordo < 0) nuovoSaldo = Math.max(0, nuovoSaldo - Math.abs(plLordo));
            db.prepare('UPDATE portfolios SET minusvalenze_disponibili=? WHERE id=?').run(nuovoSaldo, v.portfolio_id);
            const altreVendite = db.prepare('SELECT COUNT(*) as c FROM vendite WHERE portfolio_id=? AND isin=? AND quantita_residua=0').get(v.portfolio_id, v.isin);
            if (altreVendite.c === 0) db.prepare("UPDATE portfolio_etf SET selected=1, tipo='consigliato' WHERE portfolio_id=? AND isin=? AND tipo='venduto'").run(v.portfolio_id, v.isin);
            deleted++;
          } else if (type === 'BUY') {
            const a = db.prepare(`SELECT * FROM acquisti WHERE id=? AND portfolio_id IN (${placeholders})`).get(id, ...portfolioIds);
            if (!a) { errors.push(`Acquisto ${id} non trovato`); continue; }
            db.prepare('DELETE FROM acquisti WHERE id=?').run(a.id);
            const altri = db.prepare('SELECT COUNT(*) as c FROM acquisti WHERE portfolio_id=? AND isin=?').get(a.portfolio_id, a.isin);
            if (altri.c === 0) db.prepare('UPDATE portfolio_etf SET selected=0 WHERE portfolio_id=? AND isin=?').run(a.portfolio_id, a.isin);
            deleted++;
          }
        } catch (e) {
          errors.push(`Errore operazione ${id}: ${e.message}`);
        }
      }
    })();
    res.json({ ok: true, deleted, errors });
  });

  // GET /api/reports/operations
  router.get('/operations', authMiddleware, (req, res) => {
    const { year, month, ticker, type, portfolioId } = req.query;
    if (!year || isNaN(Number(year))) return res.status(400).json({ error: "Parametro 'year' mancante o non valido" });
    if (!portfolioId) return res.status(400).json({ error: "Parametro 'portfolioId' richiesto" });

    const p = db.prepare('SELECT id FROM portfolios WHERE id=? AND user_id=?').get(portfolioId, req.user.id);
    if (!p) return res.status(403).json({ error: 'Portafoglio non trovato o non autorizzato' });

    const yearNum = Number(year);
    const monthNum = month ? Number(month) : null;
    const dataStart = monthNum ? `${yearNum}-${String(monthNum).padStart(2, '0')}-01` : `${yearNum}-01-01`;
    const dataEnd = monthNum ? new Date(yearNum, monthNum, 0).toISOString().slice(0, 10) : `${yearNum}-12-31`;

    let sqlAcquisti = `
      SELECT a.id, a.data_acquisto AS date, 'BUY' AS type, a.isin AS ticker,
             ec.name AS name, a.quantita AS quantity, a.quotazione_acquisto AS price,
             NULL AS realizedPL, NULL AS compensatedLoss, NULL AS costBasisFIFO, NULL AS notes
      FROM acquisti a LEFT JOIN etf_catalog ec ON a.isin = ec.isin
      WHERE a.portfolio_id = ? AND a.data_acquisto BETWEEN ? AND ?
    `;
    const paramsAcquisti = [portfolioId, dataStart, dataEnd];
    if (ticker) { sqlAcquisti += ' AND a.isin = ?'; paramsAcquisti.push(ticker); }

    let sqlVendite = `
      SELECT v.id, v.data_vendita AS date, 'SELL' AS type, v.isin AS ticker,
             ec.name AS name, v.quantita AS quantity, v.quotazione_vendita AS price,
             ROUND((v.quotazione_vendita - v.quotazione_acquisto) * v.quantita, 2) AS realizedPL,
             v.quotazione_acquisto AS costBasisFIFO, v.note AS notes
      FROM vendite v LEFT JOIN etf_catalog ec ON v.isin = ec.isin
      WHERE v.portfolio_id = ? AND v.data_vendita BETWEEN ? AND ?
    `;
    const paramsVendite = [portfolioId, dataStart, dataEnd];
    if (ticker) { sqlVendite += ' AND v.isin = ?'; paramsVendite.push(ticker); }

    try {
      let acquisti = [];
      let vendite  = [];
      if (!type || type === 'BUY')  acquisti = db.prepare(sqlAcquisti).all(...paramsAcquisti);
      if (!type || type === 'SELL') vendite  = db.prepare(sqlVendite).all(...paramsVendite);

      const { tot: totManuali } = db.prepare(`
        SELECT COALESCE(SUM(importo), 0) AS tot FROM minusvalenze_manuali
        WHERE portfolio_id = ? AND (data_scadenza IS NULL OR data_scadenza >= date('now'))
      `).get(portfolioId);

      let saldoMinus = totManuali || 0;
      const venditeConFifo = vendite.map(v => {
        const pl = v.realizedPL || 0;
        let compensatedLoss = 0;
        if (pl > 0) { compensatedLoss = Math.min(saldoMinus, pl); saldoMinus = Math.max(0, saldoMinus - pl); }
        else if (pl < 0) saldoMinus += Math.abs(pl);
        return { ...v, compensatedLoss: parseFloat(compensatedLoss.toFixed(2)) };
      });

      const operations = [...acquisti, ...venditeConFifo].sort((a, b) => new Date(b.date) - new Date(a.date));
      res.json({ operations, meta: { total: operations.length, year: yearNum, month: monthNum } });
    } catch (err) {
      console.error('[/api/reports/operations]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/reports/fiscal-summary
  router.get('/fiscal-summary', authMiddleware, (req, res) => {
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: "Parametro 'year' richiesto" });
    const yearNum = Number(year);
    const dataStart = `${yearNum}-01-01`;
    const dataEnd = `${yearNum}-12-31`;
    try {
      const vendite = db.prepare(`
        SELECT (v.quotazione_vendita - v.quotazione_acquisto) * v.quantita AS pl
        FROM vendite v
        WHERE v.portfolio_id IN (SELECT id FROM portfolios WHERE user_id = ?)
        AND v.data_vendita BETWEEN ? AND ?
        ORDER BY v.data_vendita ASC, v.created_at ASC
      `).all(req.user.id, dataStart, dataEnd);

      const { tot: totManuali } = db.prepare(`
        SELECT COALESCE(SUM(importo), 0) AS tot FROM minusvalenze_manuali
        WHERE portfolio_id IN (SELECT id FROM portfolios WHERE user_id = ?)
        AND (data_scadenza IS NULL OR data_scadenza >= date('now'))
      `).get(req.user.id);

      let plusvalenze = 0, minusvalenze = 0, saldoMinus = totManuali || 0, compensazioni = 0;
      for (const { pl } of vendite) {
        if (pl > 0) plusvalenze += pl; else minusvalenze += Math.abs(pl);
      }
      for (const { pl } of vendite) {
        if (pl > 0) { const comp = Math.min(saldoMinus, pl); compensazioni += comp; saldoMinus = Math.max(0, saldoMinus - pl); }
        else saldoMinus += Math.abs(pl);
      }
      const imponibile = Math.max(0, plusvalenze - compensazioni);
      res.json({
        year: yearNum,
        plusvalenze: parseFloat(plusvalenze.toFixed(2)),
        minusvalenze: parseFloat(minusvalenze.toFixed(2)),
        compensazioni: parseFloat(compensazioni.toFixed(2)),
        imponibile: parseFloat(imponibile.toFixed(2)),
        imposta: parseFloat((imponibile * 0.26).toFixed(2)),
      });
    } catch (err) {
      console.error('[/api/reports/fiscal-summary]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
