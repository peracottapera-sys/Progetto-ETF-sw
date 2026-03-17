const express = require('express');
const authMiddleware = require('../middleware/auth');

module.exports = (pool) => {
  const router = express.Router();

  // DELETE /api/reports/operations/bulk
  router.delete('/operations/bulk', authMiddleware, async (req, res) => {
    const { operations } = req.body;
    if (!Array.isArray(operations) || operations.length === 0)
      return res.status(400).json({ error: 'Nessuna operazione specificata' });

    const { rows: portRows } = await pool.query('SELECT id FROM portfolios WHERE user_id=$1', [req.user.id]);
    if (portRows.length === 0) return res.status(403).json({ error: 'Nessun portafoglio trovato' });
    const portfolioIds = portRows.map(p => p.id);
    const placeholders = portfolioIds.map((_, i) => `$${i + 1}`).join(',');

    let deleted = 0;
    const errors = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const { id, type } of operations) {
        try {
          if (type === 'SELL') {
            const { rows: vRows } = await client.query(
              `SELECT * FROM vendite WHERE id=$1 AND portfolio_id IN (${placeholders})`,
              [id, ...portfolioIds]
            );
            const v = vRows[0];
            if (!v) { errors.push(`Vendita ${id} non trovata`); continue; }
            const plLordo = (v.quotazione_vendita - (v.quotazione_acquisto || 0)) * v.quantita;
            const { rows: portR } = await client.query('SELECT minusvalenze_disponibili FROM portfolios WHERE id=$1', [v.portfolio_id]);
            await client.query('DELETE FROM vendite WHERE id=$1', [v.id]);
            const { rows: acqEx } = await client.query('SELECT * FROM acquisti WHERE portfolio_id=$1 AND isin=$2', [v.portfolio_id, v.isin]);
            if (acqEx[0]) await client.query('UPDATE acquisti SET quantita=$1 WHERE portfolio_id=$2 AND isin=$3', [acqEx[0].quantita + v.quantita, v.portfolio_id, v.isin]);
            let nuovoSaldo = portR[0]?.minusvalenze_disponibili || 0;
            if (plLordo > 0) nuovoSaldo += Math.min(nuovoSaldo, plLordo);
            else if (plLordo < 0) nuovoSaldo = Math.max(0, nuovoSaldo - Math.abs(plLordo));
            await client.query('UPDATE portfolios SET minusvalenze_disponibili=$1 WHERE id=$2', [nuovoSaldo, v.portfolio_id]);
            const { rows: altreV } = await client.query("SELECT COUNT(*) as c FROM vendite WHERE portfolio_id=$1 AND isin=$2 AND quantita_residua=0", [v.portfolio_id, v.isin]);
            if (parseInt(altreV[0].c) === 0)
              await client.query("UPDATE portfolio_etf SET selected=1, tipo='consigliato' WHERE portfolio_id=$1 AND isin=$2 AND tipo='venduto'", [v.portfolio_id, v.isin]);
            deleted++;
          } else if (type === 'BUY') {
            const { rows: aRows } = await client.query(
              `SELECT * FROM acquisti WHERE id=$1 AND portfolio_id IN (${placeholders})`,
              [id, ...portfolioIds]
            );
            const a = aRows[0];
            if (!a) { errors.push(`Acquisto ${id} non trovato`); continue; }
            await client.query('DELETE FROM acquisti WHERE id=$1', [a.id]);
            const { rows: altri } = await client.query('SELECT COUNT(*) as c FROM acquisti WHERE portfolio_id=$1 AND isin=$2', [a.portfolio_id, a.isin]);
            if (parseInt(altri[0].c) === 0)
              await client.query('UPDATE portfolio_etf SET selected=0 WHERE portfolio_id=$1 AND isin=$2', [a.portfolio_id, a.isin]);
            deleted++;
          }
        } catch (e) { errors.push(`Errore operazione ${id}: ${e.message}`); }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ ok: true, deleted, errors });
  });

  // GET /api/reports/operations
  router.get('/operations', authMiddleware, async (req, res) => {
    const { year, month, ticker, type, portfolioId } = req.query;
    if (!year || isNaN(Number(year))) return res.status(400).json({ error: "Parametro 'year' mancante o non valido" });
    if (!portfolioId) return res.status(400).json({ error: "Parametro 'portfolioId' richiesto" });

    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id=$1 AND user_id=$2', [portfolioId, req.user.id]);
    if (!p[0]) return res.status(403).json({ error: 'Portafoglio non trovato o non autorizzato' });

    const yearNum = Number(year);
    const monthNum = month ? Number(month) : null;
    const dataStart = monthNum ? `${yearNum}-${String(monthNum).padStart(2, '0')}-01` : `${yearNum}-01-01`;
    const dataEnd = monthNum ? new Date(yearNum, monthNum, 0).toISOString().slice(0, 10) : `${yearNum}-12-31`;

    try {
      let acquisti = [], vendite = [];
      if (!type || type === 'BUY') {
        let sql = `SELECT a.id, a.data_acquisto AS date, 'BUY' AS type, a.isin AS ticker,
                   ec.name AS name, a.quantita AS quantity, a.quotazione_acquisto AS price,
                   NULL AS realizedpl, NULL AS compensatedloss, NULL AS costbasisfIFO, NULL AS notes
                   FROM acquisti a LEFT JOIN etf_catalog ec ON a.isin = ec.isin
                   WHERE a.portfolio_id = $1 AND a.data_acquisto BETWEEN $2 AND $3`;
        const params = [portfolioId, dataStart, dataEnd];
        if (ticker) { sql += ` AND a.isin = $${params.length + 1}`; params.push(ticker); }
        const { rows } = await pool.query(sql, params);
        acquisti = rows;
      }
      if (!type || type === 'SELL') {
        let sql = `SELECT v.id, v.data_vendita AS date, 'SELL' AS type, v.isin AS ticker,
                   ec.name AS name, v.quantita AS quantity, v.quotazione_vendita AS price,
                   ROUND((v.quotazione_vendita - v.quotazione_acquisto) * v.quantita, 2) AS realizedpl,
                   v.quotazione_acquisto AS costbasisfIFO, v.note AS notes
                   FROM vendite v LEFT JOIN etf_catalog ec ON v.isin = ec.isin
                   WHERE v.portfolio_id = $1 AND v.data_vendita BETWEEN $2 AND $3`;
        const params = [portfolioId, dataStart, dataEnd];
        if (ticker) { sql += ` AND v.isin = $${params.length + 1}`; params.push(ticker); }
        const { rows } = await pool.query(sql, params);
        vendite = rows;
      }

      const { rows: mmRows } = await pool.query(`
        SELECT COALESCE(SUM(importo), 0) AS tot FROM minusvalenze_manuali
        WHERE portfolio_id = $1 AND (data_scadenza IS NULL OR data_scadenza >= CURRENT_DATE::TEXT)
      `, [portfolioId]);

      let saldoMinus = parseFloat(mmRows[0].tot) || 0;
      const venditeConFifo = vendite.map(v => {
        const pl = v.realizedpl || 0;
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
  router.get('/fiscal-summary', authMiddleware, async (req, res) => {
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: "Parametro 'year' richiesto" });
    const yearNum = Number(year);
    const dataStart = `${yearNum}-01-01`;
    const dataEnd = `${yearNum}-12-31`;
    try {
      const { rows: vendite } = await pool.query(`
        SELECT (v.quotazione_vendita - v.quotazione_acquisto) * v.quantita AS pl
        FROM vendite v
        WHERE v.portfolio_id IN (SELECT id FROM portfolios WHERE user_id = $1)
        AND v.data_vendita BETWEEN $2 AND $3
        ORDER BY v.data_vendita ASC, v.created_at ASC
      `, [req.user.id, dataStart, dataEnd]);

      const { rows: mmRows } = await pool.query(`
        SELECT COALESCE(SUM(importo), 0) AS tot FROM minusvalenze_manuali
        WHERE portfolio_id IN (SELECT id FROM portfolios WHERE user_id = $1)
        AND (data_scadenza IS NULL OR data_scadenza >= CURRENT_DATE::TEXT)
      `, [req.user.id]);

      let plusvalenze = 0, minusvalenze = 0, saldoMinus = parseFloat(mmRows[0].tot) || 0, compensazioni = 0;
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
