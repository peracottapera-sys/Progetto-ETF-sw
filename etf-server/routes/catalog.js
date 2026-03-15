const express = require('express');
const authMiddleware = require('../middleware/auth');

// Anno nascita fallback (non in etf_catalog)
const ETF_ANNO_MAP = {
  'IE00B4L5Y983':2009,'LU1681041782':2018,'IE00B3XXRP09':2012,'IE00B5BMR087':2010,
  'IE00B4L5YX21':2005,'IE00B4K48X80':2010,'LU1681043599':2000,'IE00B4L5YC18':2014,
  'LU1681045370':2016,'IE00BKM4GZ66':2014,'IE0032077012':2002,'IE00BGDQ0H97':2015,
  'IE00BYVJRP78':2018,'IE00B4JNQZ49':2016,'IE00BFG0R112':2016,'IE00B3F81R35':2009,
  'LU1829218749':2018,'IE00B3FH7618':2006,'IE00B3F81409':2003,'LU1829219655':2018,
  'IE00B66F4759':2010,'IE00BD4DXW77':2018,'IE00B4WXJJ64':2008,'IE00B4ND3602':2011,
  'DE000A1EK0G3':2011,'DE000A0S9GB0':2007,'IE00B3VVMM84':2009,'LU0290358497':2007,
  'IE00BK5BQT80':2019,'IE00B3ZW0K18':2010,'FR0013416716':2019,'IE00B441G979':2014,
  'IE00BP3QZB59':2014,'IE00BJK55C48':2017,'IE00B53L3W79':2002,'LU0908500753':2013,
  'LU1437016972':2016,'IE00BJ0KDQ92':2014,'IE00BL25JM42':2013,'LU0478205379':2010,
  'IE00B6R52259':2011,'IE00BGSF1X88':2019,'IE00B3RBWM25':2012,'IE00B3YCGJ38':2010,
  'IE0031442068':2002,'IE0005042456':2000,
};

module.exports = (db, fetchETF) => {
  const router = express.Router();

  router.get('/stats', (req, res) => {
    try {
      const total      = db.prepare('SELECT COUNT(*) as c FROM etf_catalog WHERE active=1').get().c;
      const withTicker = db.prepare("SELECT COUNT(*) as c FROM etf_catalog WHERE ticker_yahoo IS NOT NULL AND ticker_yahoo != ''").get().c;
      const byValuta   = db.prepare("SELECT valuta, COUNT(*) as c FROM etf_catalog WHERE active=1 GROUP BY valuta ORDER BY c DESC LIMIT 10").all();
      res.json({ total, withTicker, byValuta });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/search', (req, res) => {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    if (q.length < 2) return res.json([]);
    try {
      res.json(db.prepare(`
        SELECT isin, name, valuta, aum_mln, ter, perf1m, perf6m, perf1y, perf3y, perf5y,
               vol1y, maxdd1y, distribuzione, replica, ticker_yahoo, categoria, active
        FROM etf_catalog WHERE (name LIKE ? OR isin LIKE ?) AND active = 1
        ORDER BY aum_mln DESC NULLS LAST LIMIT ?
      `).all(`%${q}%`, `%${q}%`, limit));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/:isin', (req, res) => {
    try {
      const etf = db.prepare('SELECT * FROM etf_catalog WHERE isin = ?').get(req.params.isin);
      if (!etf) return res.status(404).json({ error: 'ETF non trovato nel catalogo' });
      res.json(etf);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/batch', (req, res) => {
    const { isins } = req.body;
    if (!isins || !Array.isArray(isins) || isins.length === 0) return res.json([]);
    try {
      const placeholders = isins.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM etf_catalog WHERE isin IN (${placeholders})`).all(...isins);
      const prezziMap = {};
      try {
        const prezziRows = db.prepare(`SELECT isin, prezzo FROM prezzi_storici WHERE isin IN (${placeholders}) AND prezzo > 0 ORDER BY data DESC`).all(...isins);
        prezziRows.forEach(p => { if (!prezziMap[p.isin]) prezziMap[p.isin] = p.prezzo; });
      } catch {}
      res.json(rows.map(r => ({
        isin: r.isin, name: r.name, emittente: r.emittente || '', ter: r.ter ?? 0,
        tassazione: 26, quotazione: prezziMap[r.isin] ?? 0,
        annoNascita: ETF_ANNO_MAP[r.isin] || null, capitalizzazione: r.aum_mln ?? 0,
        variabilita: r.vol1y ?? 0, maxDrawdown: r.maxdd1y ?? 0,
        categoria: r.categoria || 'Altro', valuta: r.valuta || 'EUR',
        perf1m: r.perf1m ?? 0, perf6m: r.perf6m ?? 0, perf1y: r.perf1y ?? 0, perf5y: r.perf5y ?? 0,
      })));
    } catch { res.json([]); }
  });

  router.post('/:isin/ticker', (req, res) => {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: 'ticker mancante' });
    try {
      db.prepare('UPDATE etf_catalog SET ticker_yahoo = ? WHERE isin = ?').run(ticker, req.params.isin);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Admin ──────────────────────────────────────────────────────────────────

  router.get('/health', (req, res) => {
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const portfolioCount = db.prepare('SELECT COUNT(*) as c FROM portfolios').get().c;
    res.json({ status: 'ok', db: 'sqlite', users: userCount, portfolios: portfolioCount, timestamp: new Date().toISOString() });
  });

  router.post('/admin/cleanup-prezzi', (req, res) => {
    try {
      const r = db.prepare('DELETE FROM prezzi_storici WHERE prezzo IS NULL OR prezzo <= 0').run();
      res.json({ ok: true, rimossi: r.changes });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/admin/last-update', authMiddleware, (req, res) => {
    const row = db.prepare("SELECT value FROM system_config WHERE key = 'last_price_update'").get();
    const oggi = new Date().toISOString().slice(0, 10);
    res.json({ lastUpdate: row?.value || null, oggi, needsUpdate: !row || row.value !== oggi });
  });

  router.post('/admin/trigger-update', authMiddleware, async (req, res) => {
    res.json({ message: 'Aggiornamento avviato in background' });
    aggiornaPrezziCompleto(db, fetchETF, req.body?.motivo || 'manual').catch(e => console.error('[trigger-update]', e.message));
  });

  return router;
};

// ── Aggiornamento prezzi automatico ────────────────────────────────────────

async function aggiornaPrezziCompleto(db, fetchETF, motivo = 'scheduled') {
  const oggi = new Date().toISOString().slice(0, 10);
  const ultimoAggiornamento = db.prepare("SELECT value FROM system_config WHERE key = 'last_price_update'").get();
  if (ultimoAggiornamento?.value === oggi) {
    console.log(`[auto-update] Già aggiornato oggi (${oggi}), skip.`);
    return { skip: true, data: oggi };
  }
  console.log(`\n[auto-update] Avvio aggiornamento — motivo: ${motivo} — ${oggi}`);
  const etfs = db.prepare("SELECT isin FROM etf_catalog WHERE active = 1 AND ticker_yahoo IS NOT NULL AND ticker_yahoo != ''").all();
  let ok = 0, err = 0;
  for (const { isin } of etfs) {
    try {
      const dati = await fetchETF(isin);
      if (dati?.quotazione > 0) {
        db.prepare(`
          INSERT INTO prezzi_storici (isin, data, prezzo, perf1m, perf6m, perf1y, perf5y) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(isin, data) DO UPDATE SET prezzo=excluded.prezzo, perf1m=excluded.perf1m,
            perf6m=excluded.perf6m, perf1y=excluded.perf1y, perf5y=excluded.perf5y
        `).run(isin, oggi, dati.quotazione, dati.perf1m, dati.perf6m, dati.perf1y, dati.perf5y);
        db.prepare(`UPDATE etf_catalog SET quotazione=?, perf1m=?, perf6m=?, perf1y=?, perf5y=?, updated_at=? WHERE isin=?`)
          .run(dati.quotazione, dati.perf1m, dati.perf6m, dati.perf1y, dati.perf5y, oggi, isin);
        ok++;
      } else { err++; }
    } catch (e) { console.error(`[auto-update] Errore ${isin}:`, e.message); err++; }
    await new Promise(r => setTimeout(r, 500));
  }
  db.prepare("INSERT INTO system_config(key,value) VALUES('last_price_update',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(oggi);
  console.log(`[auto-update] Completato: ${ok} OK, ${err} errori\n`);
  return { ok, err, data: oggi };
}

function schedulaAggiornamento18(db, fetchETF) {
  const ora = new Date();
  const prossime18 = new Date(ora);
  prossime18.setHours(18, 0, 0, 0);
  if (prossime18 <= ora) prossime18.setDate(prossime18.getDate() + 1);
  const msAlle18 = prossime18 - ora;
  console.log(`[scheduler] Prossimo aggiornamento prezzi: ${prossime18.toLocaleString('it-IT')}`);
  setTimeout(async () => {
    await aggiornaPrezziCompleto(db, fetchETF, 'scheduled-18:00');
    schedulaAggiornamento18(db, fetchETF);
  }, msAlle18);
}

module.exports.schedulaAggiornamento18 = schedulaAggiornamento18;
module.exports.aggiornaPrezziCompleto = aggiornaPrezziCompleto;
