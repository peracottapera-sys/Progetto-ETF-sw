const express = require('express');
const authMiddleware = require('../middleware/auth');
const { log, EVENTI } = require('./logger');

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

module.exports = (pool, fetchETF) => {
  const router = express.Router();

  router.get('/stats', async (req, res) => {
    try {
      const { rows: [t] } = await pool.query('SELECT COUNT(*) as c FROM etf_catalog WHERE active=1');
      const { rows: [w] } = await pool.query("SELECT COUNT(*) as c FROM etf_catalog WHERE ticker_yahoo IS NOT NULL AND ticker_yahoo != ''");
      const { rows: byValuta } = await pool.query("SELECT valuta, COUNT(*) as c FROM etf_catalog WHERE active=1 GROUP BY valuta ORDER BY c DESC LIMIT 10");
      res.json({ total: parseInt(t.c), withTicker: parseInt(w.c), byValuta });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    if (q.length < 2) return res.json([]);
    try {
      // Ricerca multi-parola: ogni parola deve essere presente nel nome
      const words = q.split(/\s+/).filter(w => w.length > 0);
      const params = [];
      let whereClause;
      if (words.length === 1) {
        params.push(`%${words[0]}%`, `%${words[0]}%`);
        whereClause = `(name ILIKE $1 OR isin ILIKE $2)`;
      } else {
        whereClause = words.map((w, i) => {
          params.push(`%${w}%`);
          return `name ILIKE $${i + 1}`;
        }).join(' AND ');
      }
      params.push(limit);
      const { rows } = await pool.query(`
        SELECT isin, name, valuta, aum_mln, ter, perf1m, perf6m, perf1y, perf3y, perf5y,
               vol1y, maxdd1y, distribuzione, replica, ticker_yahoo, categoria, active, quotazione
        FROM etf_catalog WHERE ${whereClause} AND active = 1
        ORDER BY aum_mln DESC NULLS LAST LIMIT $${params.length}
      `, params);
      // Arricchisci con prezzi_storici
      if (rows.length > 0) {
        const isins = rows.map(r => r.isin);
        const ph = isins.map((_, i) => `$${i + 1}`).join(',');
        try {
          const { rows: prezziRows } = await pool.query(
            `SELECT DISTINCT ON (isin) isin, prezzo FROM prezzi_storici WHERE isin IN (${ph}) AND prezzo > 0 ORDER BY isin, data DESC`,
            isins
          );
          const prezziMap = {};
          prezziRows.forEach(p => { prezziMap[p.isin] = p.prezzo; });
          rows.forEach(r => { r.quotazione = prezziMap[r.isin] ?? r.quotazione ?? 0; });
        } catch {}
      }
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/:isin', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM etf_catalog WHERE isin = $1', [req.params.isin]);
      if (!rows[0]) return res.status(404).json({ error: 'ETF non trovato nel catalogo' });
      res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/batch', async (req, res) => {
    const { isins } = req.body;
    if (!isins || !Array.isArray(isins) || isins.length === 0) return res.json([]);
    try {
      const placeholders = isins.map((_, i) => `$${i + 1}`).join(',');
      const { rows } = await pool.query(`SELECT * FROM etf_catalog WHERE isin IN (${placeholders})`, isins);
      const prezziMap = {};
      try {
        const { rows: prezziRows } = await pool.query(
          `SELECT DISTINCT ON (isin) isin, prezzo FROM prezzi_storici WHERE isin IN (${placeholders}) AND prezzo > 0 ORDER BY isin, data DESC`, isins);
        prezziRows.forEach(p => { prezziMap[p.isin] = p.prezzo; });
      } catch {}
      res.json(rows.map(r => ({
        isin: r.isin, name: r.name, emittente: r.emittente || '', ter: r.ter ?? 0,
        tassazione: 26, quotazione: prezziMap[r.isin] ?? 0,
        annoNascita: ETF_ANNO_MAP[r.isin] || null, capitalizzazione: r.aum_mln ?? 0,
        variabilita: r.vol1y ?? 0, maxDrawdown: r.maxdd1y ?? 0,
        categoria: r.categoria || 'Altro', valuta: r.valuta || 'EUR',
        perf1m: r.perf1m ?? 0, perf6m: r.perf6m ?? 0, perf1y: r.perf1y ?? 0, perf5y: r.perf5y ?? 0,
      })));
    } catch(e) { console.error(e.message); res.json([]); }
  });

  router.post('/:isin/ticker', async (req, res) => {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: 'ticker mancante' });
    try {
      await pool.query('UPDATE etf_catalog SET ticker_yahoo = $1 WHERE isin = $2', [ticker, req.params.isin]);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Admin ──────────────────────────────────────────────────────────────────

  router.get('/health', async (req, res) => {
    const { rows: [u] } = await pool.query('SELECT COUNT(*) as c FROM users');
    const { rows: [p] } = await pool.query('SELECT COUNT(*) as c FROM portfolios');
    res.json({ status: 'ok', db: 'postgresql', users: parseInt(u.c), portfolios: parseInt(p.c), timestamp: new Date().toISOString() });
  });

  router.post('/admin/cleanup-prezzi', async (req, res) => {
    try {
      const { rowCount } = await pool.query('DELETE FROM prezzi_storici WHERE prezzo IS NULL OR prezzo <= 0');
      res.json({ ok: true, rimossi: rowCount });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/admin/last-update', authMiddleware, async (req, res) => {
    const { rows: cfgRows } = await pool.query("SELECT value FROM system_config WHERE key = 'last_price_update'");
    const oggi = new Date().toISOString().slice(0, 10);
    const lastDate = cfgRows[0]?.value || null;

    // Dettagli dell'ultimo aggiornamento dai log
    const { rows: logRows } = await pool.query(`
      SELECT ts, dettagli FROM app_logs
      WHERE evento IN ('AGGIORNA_PREZZI_AUTO', 'AGGIORNA_PREZZI_SELETTIVO')
      ORDER BY ts DESC LIMIT 1
    `);
    const lastLog = logRows[0] || null;
    const dati = lastLog?.dettagli || {};

    // Controlla se un aggiornamento è in corso (avviato negli ultimi 30 min senza completamento oggi)
    const { rows: inCorsoRows } = await pool.query(`
      SELECT ts FROM app_logs
      WHERE evento = 'SERVER_START' OR evento IN ('AGGIORNA_PREZZI_AUTO','AGGIORNA_PREZZI_SELETTIVO')
      ORDER BY ts DESC LIMIT 1
    `);

    res.json({
      lastUpdate: lastDate,
      oggi,
      needsUpdate: !lastDate || lastDate !== oggi,
      dettagli: lastLog ? {
        ts: lastLog.ts,
        ok: dati.ok ?? null,
        err: dati.err ?? null,
        totale: dati.totale ?? null,
        motivo: dati.motivo ?? null,
        data: dati.data ?? null,
      } : null,
    });
  });

  router.post('/admin/trigger-update', authMiddleware, async (req, res) => {
    const { motivo, isins } = req.body || {};
    res.json({ message: 'Aggiornamento avviato in background' });
    if (isins && Array.isArray(isins) && isins.length > 0) {
      aggiornaPrezziSelettivo(pool, fetchETF, isins, motivo || 'manual').catch(e => console.error('[trigger-update]', e.message));
    } else {
      aggiornaPrezziCompleto(pool, fetchETF, motivo || 'manual').catch(e => console.error('[trigger-update]', e.message));
    }
  });

  return router;
};

// ── Aggiornamento prezzi automatico ────────────────────────────────────────

async function aggiornaPrezziSelettivo(pool, fetchETF, isins, motivo = 'manual') {
  const axios = require('axios');
  const HEADERS = { 'User-Agent': 'Mozilla/5.0' };
  const oggi = new Date().toISOString().slice(0, 10);
  console.log(`[update-selettivo] Aggiornamento ${isins.length} ETF — ${motivo}`);

  // Leggi ticker_yahoo dal DB per ogni ISIN
  const ph = isins.map((_, i) => `$${i+1}`).join(',');
  const { rows: tickerRows } = await pool.query(
    `SELECT isin, ticker_yahoo FROM etf_catalog WHERE isin IN (${ph})`, isins
  );
  const tickerMap = {};
  tickerRows.forEach(r => { if (r.ticker_yahoo) tickerMap[r.isin] = r.ticker_yahoo; });

  async function fetchQuoteDirect(ticker) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5y`;
      const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const meta = result.meta;
      const closes = result.indicators?.quote?.[0]?.close || [];
      const validi = closes.filter(c => c != null);
      if (validi.length < 2) return null;
      const prezzo = parseFloat((meta.regularMarketPrice || validi[validi.length-1]).toFixed(3));
      const l = validi.length;
      const perf = (idx) => idx >= 0 && idx < l && validi[idx] ? parseFloat(((prezzo - validi[idx]) / validi[idx] * 100).toFixed(2)) : null;
      return { quotazione: prezzo, perf1m: perf(l-22), perf6m: perf(l-126), perf1y: perf(l-252), perf5y: perf(0) };
    } catch { return null; }
  }

  let ok = 0, err = 0;
  for (const isin of isins) {
    try {
      const ticker = tickerMap[isin];
      let dati = null;
      let tickerUsato = ticker || null;
      if (ticker) {
        dati = await fetchQuoteDirect(ticker);
      }
      if (!dati) {
        // Fallback: usa fetchETF standard (cerca in ISIN_TICKER_MAP)
        const r = await fetchETF(isin);
        if (r) { dati = { quotazione: r.quotazione, perf1m: r.perf1m, perf6m: r.perf6m, perf1y: r.perf1y, perf5y: r.perf5y }; tickerUsato = r.ticker || ticker; }
      }
      if (!dati) {
        // Auto-fix: prova suffissi alternativi
        // ⚠ NON sovrascrivere ticker mnemonici reali (es. MVEU.MI) con ISIN.suffisso
        const isIsinTicker = !ticker || /^[A-Z]{2}[A-Z0-9]{10}\./.test(ticker);
        for (const suf of ['.MI', '.AS', '.DE', '.PA', '.L', '.F', '.SW', '.IR', '.SG']) {
          const t = isin + suf;
          const r = await fetchQuoteDirect(t);
          if (r?.quotazione > 0) {
            dati = r;
            tickerUsato = t;
            // Aggiorna il ticker nel DB SOLO se quello attuale è già ISIN.suffisso o mancante
            if (isIsinTicker) {
              await pool.query('UPDATE etf_catalog SET ticker_yahoo=$1 WHERE isin=$2', [t, isin]);
              console.log(`[update-selettivo] 🔧 Auto-fix ticker ${isin}: ${ticker || 'N/A'} → ${t}`);
            } else {
              console.log(`[update-selettivo] ⚠ Ticker mnemonico ${ticker} protetto per ${isin} (trovato ${t} ma non salvato)`);
            }
            break;
          }
          await new Promise(r => setTimeout(r, 150));
        }
      }
      if (dati?.quotazione > 0) {
        await pool.query(`
          INSERT INTO prezzi_storici (isin, data, prezzo, perf1m, perf6m, perf1y, perf5y) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(isin, data) DO UPDATE SET prezzo=EXCLUDED.prezzo, perf1m=EXCLUDED.perf1m,
            perf6m=EXCLUDED.perf6m, perf1y=EXCLUDED.perf1y, perf5y=EXCLUDED.perf5y
        `, [isin, oggi, dati.quotazione, dati.perf1m, dati.perf6m, dati.perf1y, dati.perf5y]);
        await pool.query(
          `UPDATE etf_catalog SET quotazione=$1, perf1m=$2, perf6m=$3, perf1y=$4, perf5y=$5, updated_at=$6 WHERE isin=$7`,
          [dati.quotazione, dati.perf1m, dati.perf6m, dati.perf1y, dati.perf5y, oggi, isin]
        );
        console.log(`[update-selettivo] ✓ ${isin} (${ticker || 'auto'}) → ${dati.quotazione}`);
        ok++;
      } else { console.log(`[update-selettivo] ✗ ${isin} — nessun prezzo`); err++; }
    } catch (e) { console.error(`[update-selettivo] Errore ${isin}:`, e.message); err++; }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`[update-selettivo] Completato: ${ok} OK, ${err} errori`);
  log(EVENTI.AGGIORNA_PREZZI_SELETTIVO, { ok, err, totale: isins.length, motivo }).catch(() => {});
  return { ok, err };
}

async function aggiornaPrezziCompleto(pool, fetchETF, motivo = 'scheduled') {
  const oggi = new Date().toISOString().slice(0, 10);
  const { rows: cfgRows } = await pool.query("SELECT value FROM system_config WHERE key = 'last_price_update'");
  if (cfgRows[0]?.value === oggi) {
    console.log(`[auto-update] Già aggiornato oggi (${oggi}), skip.`);
    return { skip: true, data: oggi };
  }
  console.log(`\n[auto-update] Avvio aggiornamento — motivo: ${motivo} — ${oggi}`);
  const { rows: etfs } = await pool.query("SELECT isin FROM etf_catalog WHERE active = 1 AND ticker_yahoo IS NOT NULL AND ticker_yahoo != ''");
  let ok = 0, err = 0;
  for (const { isin } of etfs) {
    try {
      let dati = await fetchETF(isin);
      // Auto-fix: se fetchETF fallisce prova suffissi alternativi e aggiorna ticker nel DB
      if (!dati?.quotazione) {
        const { rows: tr } = await pool.query('SELECT ticker_yahoo FROM etf_catalog WHERE isin=$1', [isin]);
        const tickerDB = tr[0]?.ticker_yahoo;
        // ⚠ NON sovrascrivere ticker mnemonici reali (es. MVEU.MI) con ISIN.suffisso
        const isIsinTicker = !tickerDB || /^[A-Z]{2}[A-Z0-9]{10}\./.test(tickerDB);
        for (const suf of ['.MI', '.AS', '.DE', '.PA', '.L', '.F', '.SW', '.IR', '.SG']) {
          const t = isin + suf;
          if (t === tickerDB + suf) continue; // evita riprova stesso ticker
          try {
            const axios = require('axios');
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${t}?interval=1d&range=1d`;
            const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
            const prezzo = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
            if (prezzo > 0) {
              dati = { quotazione: prezzo, perf1m: null, perf6m: null, perf1y: null, perf5y: null };
              if (isIsinTicker) {
                await pool.query('UPDATE etf_catalog SET ticker_yahoo=$1 WHERE isin=$2', [t, isin]);
                console.log(`[auto-update] 🔧 Auto-fix ticker ${isin} → ${t}`);
              } else {
                console.log(`[auto-update] ⚠ Ticker mnemonico ${tickerDB} protetto per ${isin} (trovato ${t} ma non salvato)`);
              }
              break;
            }
          } catch {}
          await new Promise(r => setTimeout(r, 150));
        }
      }
      if (dati?.quotazione > 0) {
        await pool.query(`
          INSERT INTO prezzi_storici (isin, data, prezzo, perf1m, perf6m, perf1y, perf5y) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(isin, data) DO UPDATE SET prezzo=EXCLUDED.prezzo, perf1m=EXCLUDED.perf1m,
            perf6m=EXCLUDED.perf6m, perf1y=EXCLUDED.perf1y, perf5y=EXCLUDED.perf5y
        `, [isin, oggi, dati.quotazione, dati.perf1m, dati.perf6m, dati.perf1y, dati.perf5y]);
        await pool.query(
          `UPDATE etf_catalog SET quotazione=$1, perf1m=$2, perf6m=$3, perf1y=$4, perf5y=$5, updated_at=$6 WHERE isin=$7`,
          [dati.quotazione, dati.perf1m, dati.perf6m, dati.perf1y, dati.perf5y, oggi, isin]
        );
        ok++;
      } else { err++; }
    } catch (e) { console.error(`[auto-update] Errore ${isin}:`, e.message); err++; }
    await new Promise(r => setTimeout(r, 500));
  }
  await pool.query("INSERT INTO system_config(key,value) VALUES('last_price_update',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [oggi]);
  console.log(`[auto-update] Completato: ${ok} OK, ${err} errori\n`);
  log(EVENTI.AGGIORNA_PREZZI_AUTO, { ok, err, totale: etfs.length, data: oggi, motivo }).catch(() => {});
  return { ok, err, data: oggi };
}

async function schedulaAggiornamento18(pool, fetchETF) {
  const oggi = new Date().toISOString().slice(0, 10);

  // Controlla se l'aggiornamento di oggi è già stato fatto
  try {
    const { rows } = await pool.query(
      "SELECT ts FROM app_logs WHERE evento='AGGIORNA_PREZZI_AUTO' AND ts::date = CURRENT_DATE ORDER BY ts DESC LIMIT 1"
    );
    if (rows.length > 0) {
      console.log(`[scheduler] Aggiornamento di oggi già eseguito alle ${rows[0].ts.toLocaleTimeString('it-IT')} — salto`);
    } else {
      // Se siamo dopo le 18:00 e non è stato fatto, fallo subito
      const ora = new Date();
      if (ora.getHours() >= 18) {
        console.log('[scheduler] Siamo dopo le 18:00 e update non ancora eseguito — avvio ora');
        await aggiornaPrezziCompleto(pool, fetchETF, 'scheduled-recovery');
      }
    }
  } catch (e) {
    console.error('[scheduler] Errore check log:', e.message);
  }

  // Programma prossime 18:00
  const ora = new Date();
  const prossime18 = new Date(ora);
  prossime18.setHours(18, 0, 0, 0);
  if (prossime18 <= ora) prossime18.setDate(prossime18.getDate() + 1);
  const msAlle18 = prossime18 - ora;
  console.log(`[scheduler] Prossimo aggiornamento prezzi: ${prossime18.toLocaleString('it-IT')} (tra ${Math.round(msAlle18/1000/60)} min)`);

  setTimeout(async () => {
    await aggiornaPrezziCompleto(pool, fetchETF, 'scheduled-18:00');
    schedulaAggiornamento18(pool, fetchETF); // riprogramma per domani
  }, msAlle18);
}

module.exports.schedulaAggiornamento18 = schedulaAggiornamento18;
module.exports.aggiornaPrezziCompleto = aggiornaPrezziCompleto;
