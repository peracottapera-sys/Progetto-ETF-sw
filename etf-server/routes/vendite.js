const express = require('express');
const authMiddleware = require('../middleware/auth');

module.exports = (pool) => {
  const router = express.Router({ mergeParams: true });

  // GET /api/portfolios/:id/vendite
  router.get('/:id/vendite', authMiddleware, async (req, res) => {
    const { rows: p } = await pool.query(
      'SELECT minusvalenze_disponibili FROM portfolios WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });

    const { rows } = await pool.query(`
      SELECT v.*, ec.name as etf_name, ec.categoria
      FROM vendite v LEFT JOIN etf_catalog ec ON v.isin = ec.isin
      WHERE v.portfolio_id = $1 ORDER BY v.data_vendita ASC, v.created_at ASC
    `, [req.params.id]);

    const { rows: minusManuali } = await pool.query(`
      SELECT mm.* FROM minusvalenze_manuali mm
      JOIN portfolios p ON mm.portfolio_id = p.id
      WHERE p.user_id = (SELECT user_id FROM portfolios WHERE id = $1)
      AND (mm.portfolio_id = $2 OR mm.condivisa = 1)
      AND (mm.data_scadenza IS NULL OR mm.data_scadenza >= CURRENT_DATE::TEXT)
      ORDER BY mm.created_at ASC
    `, [req.params.id, req.params.id]);

    let saldoMinus = minusManuali.reduce((sum, m) => sum + (m.importo || 0), 0);

    const rowsCalcolati = rows.map(v => {
      const plLordo = (v.quotazione_vendita - v.quotazione_acquisto) * v.quantita;
      let minusUsata = 0, tasse = 0, minusGenerata = 0;
      if (plLordo > 0) {
        const plCompensato = Math.max(0, plLordo - saldoMinus);
        minusUsata = Math.min(saldoMinus, plLordo);
        tasse = parseFloat((plCompensato * 0.26).toFixed(2));
        saldoMinus = Math.max(0, saldoMinus - plLordo);
      } else if (plLordo < 0) {
        minusGenerata = Math.abs(plLordo);
        saldoMinus += minusGenerata;
      }
      return { ...v, pl_lordo: parseFloat(plLordo.toFixed(2)), pl_netto: parseFloat((plLordo - tasse).toFixed(2)), tasse, minus_usata: minusUsata, minus_generata: minusGenerata };
    });

    res.json(rowsCalcolati.reverse());
  });

  // POST /api/portfolios/:id/vendite
  router.post('/:id/vendite', authMiddleware, async (req, res) => {
    const { isin, quantita_venduta, quotazione_vendita, data_vendita, note } = req.body;
    if (!isin || !quantita_venduta || !quotazione_vendita || !data_vendita)
      return res.status(400).json({ error: 'Campi obbligatori: isin, quantita_venduta, quotazione_vendita, data_vendita' });

    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });

    const { rows: acqRows } = await pool.query(
      'SELECT quantita, quotazione_acquisto FROM acquisti WHERE portfolio_id=$1 AND isin=$2',
      [req.params.id, isin]
    );
    const acq = acqRows[0];
    if (!acq) return res.status(400).json({ error: 'Nessun acquisto trovato per questo ETF' });

    const qVenduta = parseFloat(quantita_venduta);
    if (qVenduta <= 0 || qVenduta > acq.quantita)
      return res.status(400).json({ error: `Quantità non valida. Disponibili: ${acq.quantita} quote` });

    const qResidua = parseFloat((acq.quantita - qVenduta).toFixed(6));
    const qVendita = parseFloat(quotazione_vendita);
    const plLordo = (qVendita - acq.quotazione_acquisto) * qVenduta;

    const { rows: portRows } = await pool.query('SELECT minusvalenze_disponibili FROM portfolios WHERE id=$1', [req.params.id]);
    const minusDisponibili = portRows[0]?.minusvalenze_disponibili || 0;

    const { rows: minusManualiAttive } = await pool.query(`
      SELECT mm.id, mm.importo FROM minusvalenze_manuali mm
      JOIN portfolios p ON mm.portfolio_id = p.id
      WHERE p.user_id = (SELECT user_id FROM portfolios WHERE id = $1)
      AND (mm.portfolio_id = $2 OR mm.condivisa = 1)
      AND mm.usata = 0
      AND (mm.data_scadenza IS NULL OR mm.data_scadenza >= CURRENT_DATE::TEXT)
      ORDER BY mm.created_at ASC
    `, [req.params.id, req.params.id]);

    let minusUsata = 0, tasse = 0, minusGenerata = 0;
    let nuoveMinus = minusDisponibili;
    const aggiornaManuali = [];

    if (plLordo > 0) {
      minusUsata = Math.min(minusDisponibili, plLordo);
      tasse = parseFloat((Math.max(0, plLordo - minusDisponibili) * 0.26).toFixed(2));
      nuoveMinus = parseFloat(Math.max(0, minusDisponibili - plLordo).toFixed(2));
      let daScalare = minusUsata;
      for (const m of minusManualiAttive) {
        if (daScalare <= 0) break;
        if (m.importo <= daScalare) {
          aggiornaManuali.push({ id: m.id, nuovoImporto: 0, usata: 1 });
          daScalare -= m.importo;
        } else {
          aggiornaManuali.push({ id: m.id, nuovoImporto: parseFloat((m.importo - daScalare).toFixed(2)), usata: 0 });
          daScalare = 0;
        }
      }
    } else if (plLordo < 0) {
      minusGenerata = Math.abs(plLordo);
      nuoveMinus = parseFloat((minusDisponibili + minusGenerata).toFixed(2));
    }

    const plNetto = plLordo - tasse;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO vendite (portfolio_id, isin, quantita, quotazione_vendita, quotazione_acquisto, data_vendita, quantita_residua, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [req.params.id, isin, qVenduta, qVendita, acq.quotazione_acquisto, data_vendita, qResidua, note || null]
      );
      await client.query('UPDATE portfolios SET minusvalenze_disponibili=$1 WHERE id=$2', [nuoveMinus, req.params.id]);
      for (const { id, nuovoImporto, usata } of aggiornaManuali) {
        if (usata) await client.query('UPDATE minusvalenze_manuali SET importo=0, usata=1 WHERE id=$1', [id]);
        else       await client.query('UPDATE minusvalenze_manuali SET importo=$1 WHERE id=$2', [nuovoImporto, id]);
      }
      if (qResidua <= 0) {
        await client.query('DELETE FROM acquisti WHERE portfolio_id=$1 AND isin=$2', [req.params.id, isin]);
        await client.query("UPDATE portfolio_etf SET selected=0, tipo='venduto' WHERE portfolio_id=$1 AND isin=$2", [req.params.id, isin]);
      } else {
        await client.query('UPDATE acquisti SET quantita=$1 WHERE portfolio_id=$2 AND isin=$3', [qResidua, req.params.id, isin]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    res.json({ ok: true, quantita_residua: qResidua, pl_lordo: plLordo, pl_netto: plNetto, tasse, minus_usata: minusUsata, minus_generata: minusGenerata, minus_disponibili_dopo: nuoveMinus, vendita_totale: qResidua <= 0 });
  });

  // DELETE /api/portfolios/:id/vendite/:vendita_id
  router.delete('/:id/vendite/:vendita_id', authMiddleware, async (req, res) => {
    const { rows: p } = await pool.query('SELECT minusvalenze_disponibili FROM portfolios WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const { rows: vRows } = await pool.query('SELECT * FROM vendite WHERE id=$1 AND portfolio_id=$2', [req.params.vendita_id, req.params.id]);
    const v = vRows[0];
    if (!v) return res.status(404).json({ error: 'Vendita non trovata' });

    const plLordoOrig = (v.quotazione_vendita - (v.quotazione_acquisto || 0)) * v.quantita;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM vendite WHERE id=$1', [v.id]);
      const { rows: acqEx } = await client.query('SELECT * FROM acquisti WHERE portfolio_id=$1 AND isin=$2', [req.params.id, v.isin]);
      if (acqEx[0]) await client.query('UPDATE acquisti SET quantita=$1 WHERE portfolio_id=$2 AND isin=$3', [acqEx[0].quantita + v.quantita, req.params.id, v.isin]);
      let nuovoSaldo = p[0].minusvalenze_disponibili || 0;
      if (plLordoOrig > 0) nuovoSaldo += plLordoOrig;
      else if (plLordoOrig < 0) nuovoSaldo = Math.max(0, nuovoSaldo - Math.abs(plLordoOrig));
      await client.query('UPDATE portfolios SET minusvalenze_disponibili=$1 WHERE id=$2', [nuovoSaldo, req.params.id]);
      const { rows: altreV } = await client.query("SELECT COUNT(*) as c FROM vendite WHERE portfolio_id=$1 AND isin=$2 AND quantita_residua=0", [req.params.id, v.isin]);
      if (parseInt(altreV[0].c) === 0)
        await client.query("UPDATE portfolio_etf SET selected=1, tipo='consigliato' WHERE portfolio_id=$1 AND isin=$2 AND tipo='venduto'", [req.params.id, v.isin]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ ok: true });
  });

  // GET /api/portfolios/:id/minusvalenze
  router.get('/:id/minusvalenze', authMiddleware, async (req, res) => {
    const { rows: p } = await pool.query('SELECT minusvalenze_disponibili FROM portfolios WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Non trovato' });
    const { rows: manuali } = await pool.query('SELECT * FROM minusvalenze_manuali WHERE portfolio_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ saldo: p[0].minusvalenze_disponibili || 0, manuali });
  });

  // POST /api/portfolios/:id/minusvalenze/manuali
  router.post('/:id/minusvalenze/manuali', authMiddleware, async (req, res) => {
    const { importo, data_scadenza, note, condivisa } = req.body;
    if (!importo || parseFloat(importo) <= 0) return res.status(400).json({ error: 'Importo non valido' });
    const { rows: p } = await pool.query('SELECT minusvalenze_disponibili FROM portfolios WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Non trovato' });
    const condivisaVal = condivisa === false || condivisa === 0 ? 0 : 1;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO minusvalenze_manuali (portfolio_id, importo, data_scadenza, note, condivisa) VALUES ($1,$2,$3,$4,$5)',
        [req.params.id, parseFloat(importo), data_scadenza || null, note || null, condivisaVal]
      );
      const nuovoSaldo = (p[0].minusvalenze_disponibili || 0) + parseFloat(importo);
      await client.query('UPDATE portfolios SET minusvalenze_disponibili=$1 WHERE id=$2', [nuovoSaldo, req.params.id]);
      await client.query('COMMIT');
      res.json({ ok: true, saldo: nuovoSaldo });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  });

  // DELETE /api/portfolios/:id/minusvalenze/manuali/:mid
  router.delete('/:id/minusvalenze/manuali/:mid', authMiddleware, async (req, res) => {
    const { rows: p } = await pool.query('SELECT minusvalenze_disponibili FROM portfolios WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    const { rows: m } = await pool.query('SELECT * FROM minusvalenze_manuali WHERE id=$1 AND portfolio_id=$2', [req.params.mid, req.params.id]);
    if (!p[0] || !m[0]) return res.status(404).json({ error: 'Non trovato' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM minusvalenze_manuali WHERE id=$1', [m[0].id]);
      await client.query('UPDATE portfolios SET minusvalenze_disponibili=$1 WHERE id=$2', [Math.max(0, (p[0].minusvalenze_disponibili || 0) - m[0].importo), req.params.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ ok: true });
  });

  return router;
};
