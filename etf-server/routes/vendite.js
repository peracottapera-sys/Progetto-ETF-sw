const express = require('express');
const authMiddleware = require('../middleware/auth');

module.exports = (db) => {
  const router = express.Router({ mergeParams: true });

  // GET /api/portfolios/:id/vendite
  router.get('/:id/vendite', authMiddleware, (req, res) => {
    const p = db.prepare('SELECT minusvalenze_disponibili FROM portfolios WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });

    const rows = db.prepare(`
      SELECT v.*, ec.name as etf_name, ec.categoria
      FROM vendite v LEFT JOIN etf_catalog ec ON v.isin = ec.isin
      WHERE v.portfolio_id = ? ORDER BY v.data_vendita ASC, v.created_at ASC
    `).all(req.params.id);

    const minusManuali = db.prepare(`
      SELECT mm.* FROM minusvalenze_manuali mm
      JOIN portfolios p ON mm.portfolio_id = p.id
      WHERE p.user_id = (SELECT user_id FROM portfolios WHERE id = ?)
      AND (mm.portfolio_id = ? OR mm.condivisa = 1)
      AND (mm.data_scadenza IS NULL OR mm.data_scadenza >= date('now'))
      ORDER BY mm.created_at ASC
    `).all(req.params.id, req.params.id);

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
      const plNetto = parseFloat((plLordo - tasse).toFixed(2));
      return { ...v, pl_lordo: parseFloat(plLordo.toFixed(2)), pl_netto: plNetto, tasse, minus_usata: minusUsata, minus_generata: minusGenerata };
    });

    res.json(rowsCalcolati.reverse());
  });

  // POST /api/portfolios/:id/vendite
  router.post('/:id/vendite', authMiddleware, (req, res) => {
    const { isin, quantita_venduta, quotazione_vendita, data_vendita, note } = req.body;
    if (!isin || !quantita_venduta || !quotazione_vendita || !data_vendita)
      return res.status(400).json({ error: 'Campi obbligatori: isin, quantita_venduta, quotazione_vendita, data_vendita' });

    const p = db.prepare('SELECT id FROM portfolios WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const acq = db.prepare('SELECT quantita, quotazione_acquisto FROM acquisti WHERE portfolio_id=? AND isin=?').get(req.params.id, isin);
    if (!acq) return res.status(400).json({ error: 'Nessun acquisto trovato per questo ETF' });

    const qVenduta = parseFloat(quantita_venduta);
    if (qVenduta <= 0 || qVenduta > acq.quantita)
      return res.status(400).json({ error: `Quantità non valida. Disponibili: ${acq.quantita} quote` });

    const qResidua = parseFloat((acq.quantita - qVenduta).toFixed(6));
    const qVendita = parseFloat(quotazione_vendita);
    const plLordo = (qVendita - acq.quotazione_acquisto) * qVenduta;

    const portfolio = db.prepare('SELECT minusvalenze_disponibili FROM portfolios WHERE id=?').get(req.params.id);
    const minusDisponibili = portfolio?.minusvalenze_disponibili || 0;
    const minusManualiAttive = db.prepare(`
      SELECT mm.id, mm.importo FROM minusvalenze_manuali mm
      JOIN portfolios p ON mm.portfolio_id = p.id
      WHERE p.user_id = (SELECT user_id FROM portfolios WHERE id = ?)
      AND (mm.portfolio_id = ? OR mm.condivisa = 1)
      AND mm.usata = 0
      AND (mm.data_scadenza IS NULL OR mm.data_scadenza >= date('now'))
      ORDER BY mm.created_at ASC
    `).all(req.params.id, req.params.id);

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

    db.transaction(() => {
      db.prepare(`
        INSERT INTO vendite (portfolio_id, isin, quantita, quotazione_vendita, quotazione_acquisto, data_vendita, quantita_residua, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.params.id, isin, qVenduta, qVendita, acq.quotazione_acquisto, data_vendita, qResidua, note || null);
      db.prepare('UPDATE portfolios SET minusvalenze_disponibili=? WHERE id=?').run(nuoveMinus, req.params.id);
      for (const { id, nuovoImporto, usata } of aggiornaManuali) {
        if (usata) db.prepare('UPDATE minusvalenze_manuali SET importo=0, usata=1 WHERE id=?').run(id);
        else db.prepare('UPDATE minusvalenze_manuali SET importo=? WHERE id=?').run(nuovoImporto, id);
      }
      if (qResidua <= 0) {
        db.prepare('DELETE FROM acquisti WHERE portfolio_id=? AND isin=?').run(req.params.id, isin);
        db.prepare("UPDATE portfolio_etf SET selected=0, tipo=? WHERE portfolio_id=? AND isin=?").run('venduto', req.params.id, isin);
      } else {
        db.prepare('UPDATE acquisti SET quantita=? WHERE portfolio_id=? AND isin=?').run(qResidua, req.params.id, isin);
      }
    })();

    res.json({ ok: true, quantita_residua: qResidua, pl_lordo: plLordo, pl_netto: plNetto, tasse, minus_usata: minusUsata, minus_generata: minusGenerata, minus_disponibili_dopo: nuoveMinus, vendita_totale: qResidua <= 0 });
  });

  // DELETE /api/portfolios/:id/vendite/:vendita_id
  router.delete('/:id/vendite/:vendita_id', authMiddleware, (req, res) => {
    const p = db.prepare('SELECT minusvalenze_disponibili FROM portfolios WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const v = db.prepare('SELECT * FROM vendite WHERE id=? AND portfolio_id=?').get(req.params.vendita_id, req.params.id);
    if (!v) return res.status(404).json({ error: 'Vendita non trovata' });

    const plLordoOrig = (v.quotazione_vendita - (v.quotazione_acquisto || 0)) * v.quantita;

    db.transaction(() => {
      db.prepare('DELETE FROM vendite WHERE id=?').run(v.id);
      const acqEsistente = db.prepare('SELECT * FROM acquisti WHERE portfolio_id=? AND isin=?').get(req.params.id, v.isin);
      if (acqEsistente) db.prepare('UPDATE acquisti SET quantita=? WHERE portfolio_id=? AND isin=?').run(acqEsistente.quantita + v.quantita, req.params.id, v.isin);
      let nuovoSaldo = p.minusvalenze_disponibili || 0;
      if (plLordoOrig > 0) nuovoSaldo += Math.min(nuovoSaldo + plLordoOrig, plLordoOrig);
      else if (plLordoOrig < 0) nuovoSaldo = Math.max(0, nuovoSaldo - Math.abs(plLordoOrig));
      db.prepare('UPDATE portfolios SET minusvalenze_disponibili=? WHERE id=?').run(nuovoSaldo, req.params.id);
      const altreVendite = db.prepare('SELECT COUNT(*) as c FROM vendite WHERE portfolio_id=? AND isin=? AND quantita_residua=0').get(req.params.id, v.isin);
      if (altreVendite.c === 0) db.prepare("UPDATE portfolio_etf SET selected=1, tipo='consigliato' WHERE portfolio_id=? AND isin=? AND tipo='venduto'").run(req.params.id, v.isin);
    })();
    res.json({ ok: true });
  });

  // GET /api/portfolios/:id/minusvalenze
  router.get('/:id/minusvalenze', authMiddleware, (req, res) => {
    const p = db.prepare('SELECT minusvalenze_disponibili FROM portfolios WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Non trovato' });
    const manuali = db.prepare('SELECT * FROM minusvalenze_manuali WHERE portfolio_id=? ORDER BY created_at DESC').all(req.params.id);
    res.json({ saldo: p.minusvalenze_disponibili || 0, manuali });
  });

  // POST /api/portfolios/:id/minusvalenze/manuali
  router.post('/:id/minusvalenze/manuali', authMiddleware, (req, res) => {
    const { importo, data_scadenza, note, condivisa } = req.body;
    if (!importo || parseFloat(importo) <= 0) return res.status(400).json({ error: 'Importo non valido' });
    const p = db.prepare('SELECT minusvalenze_disponibili FROM portfolios WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Non trovato' });
    const condivisaVal = condivisa === false || condivisa === 0 ? 0 : 1; // default 1
    db.transaction(() => {
      db.prepare('INSERT INTO minusvalenze_manuali (portfolio_id, importo, data_scadenza, note, condivisa) VALUES (?,?,?,?,?)').run(req.params.id, parseFloat(importo), data_scadenza || null, note || null, condivisaVal);
      db.prepare('UPDATE portfolios SET minusvalenze_disponibili=? WHERE id=?').run((p.minusvalenze_disponibili || 0) + parseFloat(importo), req.params.id);
    })();
    res.json({ ok: true, saldo: (p.minusvalenze_disponibili || 0) + parseFloat(importo) });
  });

  // DELETE /api/portfolios/:id/minusvalenze/manuali/:mid
  router.delete('/:id/minusvalenze/manuali/:mid', authMiddleware, (req, res) => {
    const p = db.prepare('SELECT minusvalenze_disponibili FROM portfolios WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    const m = db.prepare('SELECT * FROM minusvalenze_manuali WHERE id=? AND portfolio_id=?').get(req.params.mid, req.params.id);
    if (!p || !m) return res.status(404).json({ error: 'Non trovato' });
    db.transaction(() => {
      db.prepare('DELETE FROM minusvalenze_manuali WHERE id=?').run(m.id);
      db.prepare('UPDATE portfolios SET minusvalenze_disponibili=? WHERE id=?').run(Math.max(0, (p.minusvalenze_disponibili || 0) - m.importo), req.params.id);
    })();
    res.json({ ok: true });
  });

  return router;
};
