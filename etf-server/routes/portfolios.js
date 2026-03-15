const express = require('express');
const authMiddleware = require('../middleware/auth');

module.exports = (db) => {
  const router = express.Router();

  // ── Portafogli ──────────────────────────────────────────────────────────────

  router.get('/', authMiddleware, (req, res) => {
    const portfolios = db.prepare('SELECT * FROM portfolios WHERE user_id = ? ORDER BY created_at').all(req.user.id);
    res.json(portfolios);
  });

  router.post('/', authMiddleware, (req, res) => {
    const { name, riskProfile, maxUSA } = req.body;
    const existing = db.prepare('SELECT COUNT(*) as c FROM portfolios WHERE user_id = ?').get(req.user.id);
    if (existing.c >= 3) return res.status(400).json({ error: 'Massimo 3 portafogli per utente' });
    const id = 'p' + Date.now();
    db.prepare('INSERT INTO portfolios (id, user_id, name, risk_profile, max_usa) VALUES (?, ?, ?, ?, ?)').run(id, req.user.id, name, riskProfile, maxUSA || 'No max');
    console.log(`[${new Date().toLocaleTimeString()}] Portafoglio creato: ${name}`);
    res.json({ id, name, riskProfile, maxUSA });
  });

  router.put('/:id', authMiddleware, (req, res) => {
    const { name, riskProfile, maxUSA } = req.body;
    const p = db.prepare('SELECT id FROM portfolios WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    if (name) db.prepare('UPDATE portfolios SET name = ? WHERE id = ?').run(name, req.params.id);
    if (riskProfile) db.prepare('UPDATE portfolios SET risk_profile = ? WHERE id = ?').run(riskProfile, req.params.id);
    if (maxUSA) db.prepare('UPDATE portfolios SET max_usa = ? WHERE id = ?').run(maxUSA, req.params.id);
    res.json({ ok: true });
  });

  router.delete('/:id', authMiddleware, (req, res) => {
    const p = db.prepare('SELECT id FROM portfolios WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    db.prepare('DELETE FROM portfolios WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── ETF Selections ──────────────────────────────────────────────────────────

  router.get('/:id/etf-selections', authMiddleware, (req, res) => {
    const p = db.prepare('SELECT id FROM portfolios WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const rows = db.prepare('SELECT isin, selected, tipo FROM portfolio_etf WHERE portfolio_id = ?').all(req.params.id);
    if (rows.length === 0) return res.json([]);

    const placeholders = rows.map(() => '?').join(',');
    const isins = rows.map(r => r.isin);
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    let prezziMap = {};
    try {
      const prezziRows = db.prepare(
        `SELECT isin, prezzo FROM prezzi_storici WHERE isin IN (${placeholders}) AND prezzo > 0 AND data >= ? ORDER BY data DESC`
      ).all(...isins, cutoff);
      prezziRows.forEach(r => { if (!prezziMap[r.isin]) prezziMap[r.isin] = r.prezzo; });
    } catch {}

    let catalogMap = {};
    try {
      const catRows = db.prepare(
        `SELECT isin, name, emittente, ter, categoria, valuta, aum_mln, vol1y, maxdd1y,
                perf1m, perf6m, perf1y, perf5y FROM etf_catalog WHERE isin IN (${placeholders})`
      ).all(...isins);
      catRows.forEach(r => { catalogMap[r.isin] = r; });
    } catch {}

    res.json(rows.map(r => {
      const cat = catalogMap[r.isin] || {};
      return {
        isin: r.isin, selected: r.selected, tipo: r.tipo,
        quotazione: prezziMap[r.isin] || 0,
        name: cat.name || null, emittente: cat.emittente || null,
        ter: cat.ter ?? null, categoria: cat.categoria || null,
        valuta: cat.valuta || null, capitalizzazione: cat.aum_mln ?? null,
        variabilita: cat.vol1y ?? null, maxDrawdown: cat.maxdd1y ?? null,
        perf1m: cat.perf1m ?? null, perf6m: cat.perf6m ?? null,
        perf1y: cat.perf1y ?? null, perf5y: cat.perf5y ?? null,
      };
    }));
  });

  router.post('/:id/etf-selections', authMiddleware, (req, res) => {
    const { isin, selected, tipo } = req.body;
    const p = db.prepare('SELECT id FROM portfolios WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    db.prepare(`
      INSERT INTO portfolio_etf (portfolio_id, isin, selected, tipo) VALUES (?, ?, ?, ?)
      ON CONFLICT(portfolio_id, isin) DO UPDATE SET selected = excluded.selected, tipo = excluded.tipo
    `).run(req.params.id, isin, selected ? 1 : 0, tipo || 'consigliato');
    res.json({ ok: true });
  });

  router.delete('/:id/etf-selections', authMiddleware, (req, res) => {
    const p = db.prepare('SELECT id FROM portfolios WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const r1 = db.prepare('DELETE FROM portfolio_etf WHERE portfolio_id = ?').run(req.params.id);
    const r2 = db.prepare('DELETE FROM acquisti WHERE portfolio_id = ?').run(req.params.id);
    console.log(`[RESET] portfolio_etf: ${r1.changes} righe, acquisti: ${r2.changes} righe`);
    res.json({ ok: true, deletedSelections: r1.changes, deletedAcquisti: r2.changes });
  });

  // ── Apply AI ────────────────────────────────────────────────────────────────

  router.post('/:id/apply-ai', authMiddleware, (req, res) => {
    const portfolioId = req.params.id;
    const p = db.prepare('SELECT id FROM portfolios WHERE id = ? AND user_id = ?').get(portfolioId, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const { etfs = [], acquisti = [], prezzi = [] } = req.body;
    if (etfs.length === 0) return res.status(400).json({ error: 'Nessun ETF ricevuto' });
    const oggi = new Date().toISOString().slice(0, 10);
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM portfolio_etf WHERE portfolio_id = ?').run(portfolioId);
        db.prepare('DELETE FROM acquisti WHERE portfolio_id = ?').run(portfolioId);
        const stmtEtf = db.prepare(`
          INSERT INTO portfolio_etf (portfolio_id, isin, selected, tipo) VALUES (?, ?, ?, ?)
          ON CONFLICT(portfolio_id, isin) DO UPDATE SET selected = excluded.selected, tipo = excluded.tipo
        `);
        for (const e of etfs) stmtEtf.run(portfolioId, e.isin, e.selected ? 1 : 0, e.tipo || 'consigliato');
        const stmtAcq = db.prepare('INSERT INTO acquisti (portfolio_id, isin, quantita, quotazione_acquisto, data_acquisto) VALUES (?, ?, ?, ?, ?)');
        for (const a of acquisti) {
          if (a.quantita > 0 && a.quotazioneAcquisto > 0)
            stmtAcq.run(portfolioId, a.isin, a.quantita, a.quotazioneAcquisto, a.dataAcquisto || oggi);
        }
        const stmtPr = db.prepare(`
          INSERT INTO prezzi_storici (isin, data, prezzo) VALUES (?, ?, ?)
          ON CONFLICT(isin, data) DO UPDATE SET prezzo = excluded.prezzo
        `);
        for (const pr of prezzi) {
          if (pr.isin && pr.prezzo > 0) stmtPr.run(pr.isin, oggi, pr.prezzo);
        }
      })();
      const rows = db.prepare('SELECT isin, selected, tipo FROM portfolio_etf WHERE portfolio_id = ?').all(portfolioId);
      const acqRows = db.prepare('SELECT isin, quantita, quotazione_acquisto, data_acquisto FROM acquisti WHERE portfolio_id = ?').all(portfolioId);
      console.log(`[apply-ai] ${portfolioId}: ${etfs.length} ETF, ${acquisti.length} acquisti`);
      res.json({ ok: true, etfsInDB: rows.length, selezionatiInDB: rows.filter(r => r.selected).length, rows, acqRows });
    } catch (err) {
      console.error('[apply-ai] ERRORE:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Acquisti ────────────────────────────────────────────────────────────────

  router.get('/:id/acquisti', authMiddleware, (req, res) => {
    const p = db.prepare('SELECT id FROM portfolios WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    res.json(db.prepare('SELECT * FROM acquisti WHERE portfolio_id = ? ORDER BY data_acquisto DESC').all(req.params.id));
  });

  router.post('/:id/acquisti', authMiddleware, (req, res) => {
    const { isin, quantita, quotazioneAcquisto, dataAcquisto } = req.body;
    const p = db.prepare('SELECT id FROM portfolios WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    db.prepare('DELETE FROM acquisti WHERE portfolio_id = ? AND isin = ?').run(req.params.id, isin);
    if (quantita && quotazioneAcquisto)
      db.prepare('INSERT INTO acquisti (portfolio_id, isin, quantita, quotazione_acquisto, data_acquisto) VALUES (?, ?, ?, ?, ?)').run(req.params.id, isin, quantita, quotazioneAcquisto, dataAcquisto);
    console.log(`[${new Date().toLocaleTimeString()}] Acquisto salvato: ${isin} qt=${quantita}`);
    res.json({ ok: true });
  });

  router.delete('/:id/acquisti/:acquisto_id', authMiddleware, (req, res) => {
    const p = db.prepare('SELECT id FROM portfolios WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const a = db.prepare('SELECT * FROM acquisti WHERE id = ? AND portfolio_id = ?').get(req.params.acquisto_id, req.params.id);
    if (!a) return res.status(404).json({ error: 'Acquisto non trovato' });
    db.transaction(() => {
      db.prepare('DELETE FROM acquisti WHERE id = ?').run(a.id);
      const altri = db.prepare('SELECT COUNT(*) as c FROM acquisti WHERE portfolio_id = ? AND isin = ?').get(req.params.id, a.isin);
      if (altri.c === 0)
        db.prepare('UPDATE portfolio_etf SET selected=0 WHERE portfolio_id = ? AND isin = ?').run(req.params.id, a.isin);
    })();
    res.json({ ok: true });
  });

  // ── Prezzi storici ──────────────────────────────────────────────────────────

  router.post('/prezzi-storici/bulk', authMiddleware, (req, res) => {
    const { prezzi } = req.body;
    if (!Array.isArray(prezzi) || prezzi.length === 0) return res.json({ ok: true, saved: 0 });
    const oggi = new Date().toISOString().slice(0, 10);
    const stmt = db.prepare(`
      INSERT INTO prezzi_storici (isin, data, prezzo) VALUES (?, ?, ?)
      ON CONFLICT(isin, data) DO UPDATE SET prezzo = excluded.prezzo
    `);
    let saved = 0;
    const saveMany = db.transaction((items) => {
      for (const { isin, prezzo } of items) {
        if (isin && prezzo > 0) { stmt.run(isin, oggi, prezzo); saved++; }
      }
    });
    try {
      saveMany(prezzi);
      res.json({ ok: true, saved });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/prezzi-storici', authMiddleware, (req, res) => {
    const { isin, prezzo, perf1m, perf6m, perf1y, perf5y } = req.body;
    const oggi = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO prezzi_storici (isin, data, prezzo, perf1m, perf6m, perf1y, perf5y) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(isin, data) DO UPDATE SET prezzo=excluded.prezzo, perf1m=excluded.perf1m,
        perf6m=excluded.perf6m, perf1y=excluded.perf1y, perf5y=excluded.perf5y
    `).run(isin, oggi, prezzo, perf1m, perf6m, perf1y, perf5y);
    res.json({ ok: true });
  });

  router.get('/prezzi-storici/:isin', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT data, prezzo, perf1y FROM prezzi_storici WHERE isin = ? ORDER BY data').all(req.params.isin));
  });

  // ── Correlazione ────────────────────────────────────────────────────────────

  router.get('/:id/correlazione', authMiddleware, (req, res) => {
    const portfolio = db.prepare('SELECT * FROM portfolios WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!portfolio) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const etfSelezionati = db.prepare(`
      SELECT pe.isin, ec.name, ec.categoria
      FROM portfolio_etf pe LEFT JOIN etf_catalog ec ON pe.isin = ec.isin
      WHERE pe.portfolio_id = ? AND pe.selected = 1
    `).all(req.params.id);
    if (etfSelezionati.length < 2) return res.json({ matrice: {}, maxCorr: 0, coppieAlte: [] });
    res.json(calcolaMatriceCorrelazione(db, etfSelezionati));
  });

  return router;
};

// ── Helper correlazione ─────────────────────────────────────────────────────

function calcolaRendimentiGiornalieri(prezziOrdinati) {
  const rendimenti = [];
  for (let i = 1; i < prezziOrdinati.length; i++) {
    const p0 = prezziOrdinati[i - 1].prezzo, p1 = prezziOrdinati[i].prezzo;
    if (p0 > 0 && p1 > 0) rendimenti.push((p1 - p0) / p0);
  }
  return rendimenti;
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const aS = a.slice(0, n), bS = b.slice(0, n);
  const meanA = aS.reduce((s, v) => s + v, 0) / n;
  const meanB = bS.reduce((s, v) => s + v, 0) / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const da = aS[i] - meanA, db = bS[i] - meanB;
    num += da * db; dA += da * da; dB += db * db;
  }
  const den = Math.sqrt(dA * dB);
  return den === 0 ? null : parseFloat((num / den).toFixed(3));
}

function corrEuristica(etfA, etfB) {
  const cat = (e) => (e.categoria || '').toLowerCase();
  const isAz = (c) => c.includes('azionario');
  const isObb = (c) => c.includes('obblig');
  const isLiq = (c) => c.includes('liquidit') || c.includes('monetario');
  const cA = cat(etfA), cB = cat(etfB);
  if (isAz(cA) && isAz(cB)) {
    if (cA === cB) return 0.92;
    if (cA.includes('globale') && cB.includes('globale')) return 0.90;
    if ((cA.includes('usa') || cA.includes('s&p')) && (cB.includes('globale'))) return 0.88;
    return 0.70;
  }
  if (isObb(cA) && isObb(cB)) return cA === cB ? 0.85 : 0.60;
  if ((isAz(cA) && isObb(cB)) || (isObb(cA) && isAz(cB))) return 0.10;
  if (isLiq(cA) || isLiq(cB)) return 0.05;
  return 0.35;
}

function calcolaMatriceCorrelazione(db, etfSelezionati) {
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const prezziPerIsin = {};
  for (const { isin } of etfSelezionati) {
    try {
      prezziPerIsin[isin] = db.prepare(
        'SELECT data, prezzo FROM prezzi_storici WHERE isin = ? AND data >= ? AND prezzo > 0 ORDER BY data ASC'
      ).all(isin, cutoff);
    } catch { prezziPerIsin[isin] = []; }
  }
  const matrice = {}, coppieAlte = [];
  let maxCorr = 0;
  for (let i = 0; i < etfSelezionati.length; i++) {
    for (let j = i + 1; j < etfSelezionati.length; j++) {
      const A = etfSelezionati[i], B = etfSelezionati[j];
      const key = `${A.isin}_${B.isin}`;
      const rA = calcolaRendimentiGiornalieri(prezziPerIsin[A.isin] || []);
      const rB = calcolaRendimentiGiornalieri(prezziPerIsin[B.isin] || []);
      const corrStatistica = rA.length >= 10 && rB.length >= 10 ? pearson(rA, rB) : null;
      const corrE = corrEuristica(A, B);
      const corr = corrStatistica !== null
        ? parseFloat((0.6 * corrStatistica + 0.4 * corrE).toFixed(3))
        : corrE;
      const metodo = corrStatistica !== null ? 'statistica+euristica' : 'euristica';
      matrice[key] = { corr, metodo, nomiA: A.name, nomeB: B.name };
      if (corr > maxCorr) maxCorr = corr;
      if (corr > 0.6) coppieAlte.push({ isinA: A.isin, isinB: B.isin, nomeA: A.name, nomeB: B.name, corr, metodo });
    }
  }
  coppieAlte.sort((a, b) => b.corr - a.corr);
  return { matrice, maxCorr: parseFloat(maxCorr.toFixed(3)), coppieAlte };
}
