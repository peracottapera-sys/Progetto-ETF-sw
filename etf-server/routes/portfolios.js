const express = require('express');
const authMiddleware = require('../middleware/auth');
const { log, EVENTI } = require('./logger');

module.exports = (pool) => {
  const router = express.Router();

  // ── Portafogli ──────────────────────────────────────────────────────────────

  router.get('/', authMiddleware, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM portfolios WHERE user_id = $1 ORDER BY created_at', [req.user.id]);
    res.json(rows);
  });

  router.post('/', authMiddleware, async (req, res) => {
    const { name, riskProfile, maxUSA } = req.body;
    const { rows: ex } = await pool.query('SELECT COUNT(*) as c FROM portfolios WHERE user_id = $1', [req.user.id]);
    if (parseInt(ex[0].c) >= 3) return res.status(400).json({ error: 'Massimo 3 portafogli per utente' });
    const id = 'p' + Date.now();
    await pool.query('INSERT INTO portfolios (id, user_id, name, risk_profile, max_usa) VALUES ($1, $2, $3, $4, $5)',
      [id, req.user.id, name, riskProfile, maxUSA || 'No max']);
    console.log(`[${new Date().toLocaleTimeString()}] Portafoglio creato: ${name}`);
    log(EVENTI.CREA_PORTAFOGLIO, { portfolioId: id, nome: name, profilo: riskProfile, maxUSA: maxUSA || 'No max' }, req.user?.username).catch(() => {});
    res.json({ id, name, riskProfile, maxUSA });
  });

  router.put('/:id', authMiddleware, async (req, res) => {
    const { name, riskProfile, maxUSA } = req.body;
    const { rows } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    if (name)        await pool.query('UPDATE portfolios SET name = $1 WHERE id = $2', [name, req.params.id]);
    if (riskProfile) await pool.query('UPDATE portfolios SET risk_profile = $1 WHERE id = $2', [riskProfile, req.params.id]);
    if (maxUSA)      await pool.query('UPDATE portfolios SET max_usa = $1 WHERE id = $2', [maxUSA, req.params.id]);
    res.json({ ok: true });
  });

  router.delete('/:id', authMiddleware, async (req, res) => {
    const { rows } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    await pool.query('DELETE FROM portfolios WHERE id = $1', [req.params.id]);
    log(EVENTI.ELIMINA_PORTAFOGLIO, { portfolioId: req.params.id }, req.user?.username).catch(() => {});
    res.json({ ok: true });
  });

  // ── ETF Selections ──────────────────────────────────────────────────────────

  router.get('/:id/etf-selections', authMiddleware, async (req, res) => {
    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });

    const { rows } = await pool.query('SELECT isin, selected, tipo, bucket FROM portfolio_etf WHERE portfolio_id = $1', [req.params.id]);
    if (rows.length === 0) return res.json([]);

    const isins = rows.map(r => r.isin);
    const placeholders = isins.map((_, i) => `$${i + 1}`).join(',');
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    let prezziMap = {};
    try {
      const { rows: prezziRows } = await pool.query(
        `SELECT DISTINCT ON (isin) isin, prezzo FROM prezzi_storici WHERE isin IN (${placeholders}) AND prezzo > 0 AND data >= $${isins.length + 1} ORDER BY isin, data DESC`,
        [...isins, cutoff]
      );
      prezziRows.forEach(r => { prezziMap[r.isin] = r.prezzo; });
    } catch {}

    let catalogMap = {};
    try {
      const { rows: catRows } = await pool.query(
        `SELECT isin, name, emittente, ter, categoria, valuta, aum_mln, vol1y, maxdd1y, perf1m, perf6m, perf1y, perf5y, smart_beta_factor, data_lancio FROM etf_catalog WHERE isin IN (${placeholders})`,
        isins
      );
      catRows.forEach(r => { catalogMap[r.isin] = r; });
    } catch {}

    res.json(rows.map(r => {
      const cat = catalogMap[r.isin] || {};
      return {
        isin: r.isin, selected: r.selected, tipo: r.tipo, bucket: r.bucket || 'LUNGO',
        quotazione: prezziMap[r.isin] || 0,
        name: cat.name || null, emittente: cat.emittente || null,
        ter: cat.ter ?? null, categoria: cat.categoria || null,
        valuta: cat.valuta || null, capitalizzazione: cat.aum_mln ?? null,
        variabilita: cat.vol1y ?? null, maxDrawdown: cat.maxdd1y ?? null,
        smartBeta: cat.smart_beta_factor || null,
        perf1m: cat.perf1m ?? null, perf6m: cat.perf6m ?? null,
        perf1y: cat.perf1y ?? null, perf5y: cat.perf5y ?? null,
        annoNascita: cat.data_lancio ? new Date(cat.data_lancio).getFullYear() : null,
      };
    }));
  });

  router.post('/:id/etf-selections', authMiddleware, async (req, res) => {
    const { isin, selected, tipo } = req.body;
    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    await pool.query(
      `INSERT INTO portfolio_etf (portfolio_id, isin, selected, tipo) VALUES ($1, $2, $3, $4)
       ON CONFLICT(portfolio_id, isin) DO UPDATE SET selected = EXCLUDED.selected, tipo = EXCLUDED.tipo`,
      [req.params.id, isin, selected ? 1 : 0, tipo || 'consigliato']
    );
    res.json({ ok: true });
  });

  router.delete('/:id/etf-selections', authMiddleware, async (req, res) => {
    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const { rowCount: r1 } = await pool.query('DELETE FROM portfolio_etf WHERE portfolio_id = $1', [req.params.id]);
    const { rowCount: r2 } = await pool.query('DELETE FROM acquisti WHERE portfolio_id = $1', [req.params.id]);
    res.json({ ok: true, deletedSelections: r1, deletedAcquisti: r2 });
  });

  // ── Apply AI ────────────────────────────────────────────────────────────────

  router.post('/:id/apply-ai', authMiddleware, async (req, res) => {
    const portfolioId = req.params.id;
    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [portfolioId, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const { etfs = [], acquisti = [], prezzi = [] } = req.body;
    if (etfs.length === 0) return res.status(400).json({ error: 'Nessun ETF ricevuto' });
    const oggi = new Date().toISOString().slice(0, 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM portfolio_etf WHERE portfolio_id = $1', [portfolioId]);
      await client.query('DELETE FROM acquisti WHERE portfolio_id = $1', [portfolioId]);
      for (const e of etfs)
        await client.query(
          `INSERT INTO portfolio_etf (portfolio_id, isin, selected, tipo) VALUES ($1, $2, $3, $4)
           ON CONFLICT(portfolio_id, isin) DO UPDATE SET selected = EXCLUDED.selected, tipo = EXCLUDED.tipo`,
          [portfolioId, e.isin, e.selected ? 1 : 0, e.tipo || 'consigliato']
        );
      for (const a of acquisti)
        if (a.quantita > 0 && a.quotazioneAcquisto > 0)
          await client.query(
            'INSERT INTO acquisti (portfolio_id, isin, quantita, quotazione_acquisto, data_acquisto) VALUES ($1, $2, $3, $4, $5)',
            [portfolioId, a.isin, a.quantita, a.quotazioneAcquisto, a.dataAcquisto || oggi]
          );
      for (const pr of prezzi)
        if (pr.isin && pr.prezzo > 0)
          await client.query(
            `INSERT INTO prezzi_storici (isin, data, prezzo) VALUES ($1, $2, $3)
             ON CONFLICT(isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo`,
            [pr.isin, oggi, pr.prezzo]
          );
      await client.query('COMMIT');
      const { rows } = await pool.query('SELECT isin, selected, tipo FROM portfolio_etf WHERE portfolio_id = $1', [portfolioId]);
      const { rows: acqRows } = await pool.query('SELECT isin, quantita, quotazione_acquisto, data_acquisto FROM acquisti WHERE portfolio_id = $1', [portfolioId]);
      res.json({ ok: true, etfsInDB: rows.length, selezionatiInDB: rows.filter(r => r.selected).length, rows, acqRows });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[apply-ai] ERRORE:', err.message);
      res.status(500).json({ error: err.message });
    } finally { client.release(); }
  });

  // ── Bucket config ─────────────────────────────────────────────────────────────

  router.get('/:id/buckets', authMiddleware, async (req, res) => {
    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const { rows } = await pool.query('SELECT * FROM portfolio_buckets WHERE portfolio_id = $1 ORDER BY tipo', [req.params.id]);
    res.json(rows);
  });

  router.post('/:id/buckets', authMiddleware, async (req, res) => {
    const { buckets } = req.body; // [{tipo, pct_allocazione, orizzonte_anni, rendimento_target_annuo}]
    if (!Array.isArray(buckets) || buckets.length === 0)
      return res.status(400).json({ error: 'Dati bucket mancanti' });
    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM portfolio_buckets WHERE portfolio_id = $1', [req.params.id]);
      for (const b of buckets) {
        await client.query(
          `INSERT INTO portfolio_buckets (portfolio_id, tipo, pct_allocazione, orizzonte_anni, rendimento_target_annuo)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.params.id, b.tipo, b.pct_allocazione, b.orizzonte_anni, b.rendimento_target_annuo || null]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
    finally { client.release(); }
  });

  // Assegna bucket a un ETF
  router.post('/:id/etf-bucket', authMiddleware, async (req, res) => {
    const { isin, bucket } = req.body;
    if (!isin || !['BREVE', 'LUNGO'].includes(bucket))
      return res.status(400).json({ error: 'Dati non validi' });
    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    await pool.query(
      'UPDATE portfolio_etf SET bucket = $1 WHERE portfolio_id = $2 AND isin = $3',
      [bucket, req.params.id, isin]
    );
    res.json({ ok: true });
  });

  // ── Acquisti ────────────────────────────────────────────────────────────────

  router.get('/:id/acquisti', authMiddleware, async (req, res) => {
    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const { rows } = await pool.query('SELECT * FROM acquisti WHERE portfolio_id = $1 ORDER BY data_acquisto DESC', [req.params.id]);
    res.json(rows);
  });

  router.post('/:id/acquisti', authMiddleware, async (req, res) => {
    const { isin, quantita, quotazioneAcquisto, dataAcquisto } = req.body;
    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    await pool.query('DELETE FROM acquisti WHERE portfolio_id = $1 AND isin = $2', [req.params.id, isin]);
    if (quantita && quotazioneAcquisto) {
      await pool.query(
        'INSERT INTO acquisti (portfolio_id, isin, quantita, quotazione_acquisto, data_acquisto) VALUES ($1, $2, $3, $4, $5)',
        [req.params.id, isin, quantita, quotazioneAcquisto, dataAcquisto]
      );
      log(EVENTI.ACQUISTO, { portfolioId: req.params.id, isin, quantita, prezzo: quotazioneAcquisto, data: dataAcquisto }, req.user?.username).catch(() => {});
    }
    res.json({ ok: true });
  });

  router.delete('/:id/acquisti/:acquisto_id', authMiddleware, async (req, res) => {
    const { rows: p } = await pool.query('SELECT id FROM portfolios WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!p[0]) return res.status(404).json({ error: 'Portafoglio non trovato' });
    const { rows: a } = await pool.query('SELECT * FROM acquisti WHERE id = $1 AND portfolio_id = $2', [req.params.acquisto_id, req.params.id]);
    if (!a[0]) return res.status(404).json({ error: 'Acquisto non trovato' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM acquisti WHERE id = $1', [a[0].id]);
      const { rows: altri } = await client.query('SELECT COUNT(*) as c FROM acquisti WHERE portfolio_id = $1 AND isin = $2', [req.params.id, a[0].isin]);
      if (parseInt(altri[0].c) === 0)
        await client.query('UPDATE portfolio_etf SET selected=0 WHERE portfolio_id = $1 AND isin = $2', [req.params.id, a[0].isin]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ ok: true });
  });

  // ── Prezzi storici ──────────────────────────────────────────────────────────

  router.post('/prezzi-storici/bulk', authMiddleware, async (req, res) => {
    const { prezzi } = req.body;
    if (!Array.isArray(prezzi) || prezzi.length === 0) return res.json({ ok: true, saved: 0 });
    const oggi = new Date().toISOString().slice(0, 10);
    let saved = 0;
    for (const { isin, prezzo } of prezzi) {
      if (isin && prezzo > 0) {
        await pool.query(
          `INSERT INTO prezzi_storici (isin, data, prezzo) VALUES ($1, $2, $3)
           ON CONFLICT(isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo`,
          [isin, oggi, prezzo]
        );
        saved++;
      }
    }
    res.json({ ok: true, saved });
  });

  router.post('/prezzi-storici', authMiddleware, async (req, res) => {
    const { isin, prezzo, perf1m, perf6m, perf1y, perf5y } = req.body;
    const oggi = new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO prezzi_storici (isin, data, prezzo, perf1m, perf6m, perf1y, perf5y) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(isin, data) DO UPDATE SET prezzo=EXCLUDED.prezzo, perf1m=EXCLUDED.perf1m,
         perf6m=EXCLUDED.perf6m, perf1y=EXCLUDED.perf1y, perf5y=EXCLUDED.perf5y`,
      [isin, oggi, prezzo, perf1m, perf6m, perf1y, perf5y]
    );
    res.json({ ok: true });
  });

  router.get('/prezzi-storici/:isin', authMiddleware, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT data, prezzo, perf1y FROM prezzi_storici WHERE isin = $1 ORDER BY data',
      [req.params.isin]
    );
    res.json(rows);
  });

  return router;
};
