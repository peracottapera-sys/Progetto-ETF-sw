const express = require('express');
const authMiddleware = require('../middleware/auth');
const { log, EVENTI } = require('./logger');
const Anthropic = require('@anthropic-ai/sdk');

const getAnthropic = () => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY non configurata');
  return new Anthropic({ apiKey: key });
};

// ─── Riclassificazione automatica via regole ─────────────────────────────
// Restituisce la categoria target in base al nome ETF. Le regole sono in
// CASCATA (la prima che matcha vince). null = nessun match → fallback AI.
function classificaPerRegole(name) {
  if (!name || typeof name !== 'string') return null;
  const n = name.toLowerCase();

  // ── 1-6: Bond / Liquidità (controllo prima per evitare match azionari su bond) ──
  // Liquidità / Monetario
  if (/\b(overnight|money market|t-bill|liquidity|liquidità|monetario|short term cash)\b/i.test(name)) {
    return 'Liquidità / Monetario';
  }

  // High Yield bond
  if (/\b(high yield|hy corp|hy bond|speculative grade|sub investment grade)\b/i.test(name)) {
    return 'Obbligazionario High Yield';
  }

  // Bond Emergenti
  if (/\b(em hard currency|em local|em bond|emerging.*bond|em sovereign|em government|china.*bond|india.*bond|local currency)\b/i.test(name)) {
    return 'Obbligazionario Emergenti';
  }

  // Bond Corporate
  if (/\b(corporate bond|corp bond|corporate (eur|usd|gbp))\b/i.test(name)) {
    return 'Obbligazionario Corporate';
  }

  // Bond Governativo (più specifico, controllo prima del bond generico)
  if (/\b(government bond|sovereign bond|treasury|btp|bund|gilt|gov bond|govt bond|govies|government.*paris)\b/i.test(name)
      || /\b(germany|italy|france|spain|portugal|us|uk|japan).*government\b/i.test(name)
      || /\b(eb\.rexx|ibonds|ibond)\b/i.test(name)) {
    return 'Obbligazionario Governativo';
  }

  // Inflation-Linked → Governativo
  if (/\b(inflation[- ]linked|tips|index[- ]linked gilt|linker)\b/i.test(name)) {
    return 'Obbligazionario Governativo';
  }

  // Bond generici (catch-all per bond non riconosciuti sopra)
  if (/\b(aggregate bond|fixed income|bond ucits|bonds ucits|bond etf|bond fund|covered bond|short duration|bond.*hedge|ultrashort bond)\b/i.test(name)) {
    return 'Obbligazionario';
  }

  // ── 7: Settori specifici (vincono sempre su geografia, da decisione utente) ──
  if (/\b(health[- ]?care|biotech|pharmaceutical|medical)\b/i.test(name)) {
    return 'Azionario Tematico - Salute';
  }
  if (/\b(information technology|infotech|tech 100|technology|semiconductor|software|internet|cloud|fintech|cybersecurity|ai sector|artificial intelligence|robotics|nasdaq.*tech)\b/i.test(name)) {
    return 'Azionario Tematico - Tecnologia';
  }
  if (/\b(financials|financial services|banks|banking|insurance)\b/i.test(name)) {
    return 'Azionario Tematico - Finanziario';
  }
  if (/\b(real estate|reit|property|immobil)\b/i.test(name)) {
    return 'Azionario Tematico - Immobiliare';
  }
  if (/\b(defense|aerospace|defence|weapon)\b/i.test(name)) {
    return 'Azionario Tematico - Difesa';
  }
  if (/\b(infrastructure|infrastrutture|utilities)\b/i.test(name)) {
    return 'Azionario Tematico - Infrastrutture';
  }
  // Energy come SETTORE azionario (es. "MSCI World Energy Sector"). Distinto da Materie Prime - Energia
  if (/\b(energy sector|energy ucits etf|s&p.*energy|msci.*energy|stoxx.*energy|world energy|usa energy|europe energy)\b/i.test(name)
      && !/\b(crude|brent|natural gas|petroleum|oil|gas|wti)\b/i.test(name)) {
    return 'Azionario Tematico - Energia';
  }
  // Settoriali generici: industrials, materials, consumer, communication, telecom
  if (/\b(industrials|industrial goods|industrial services|materials|consumer (staples|discretionary|goods)|telecommunication|communication services|telecom|utilities sector)\b/i.test(name)) {
    return 'Azionario Tematico - Settoriale';
  }

  // ── 8-13: Materie prime ──
  // Crypto
  if (/\b(bitcoin|ethereum|crypto|btc|eth|solana|polkadot|dogecoin|stellar|chainlink|cardano|ripple|altcoin)\b/i.test(name)) {
    return 'Materie Prime - Crypto';
  }
  // Metalli preziosi
  if (/\b(gold|silver|platinum|palladium|precious metals|argento|oro fisico|metalli preziosi)\b/i.test(name)) {
    return 'Materie Prime - Metalli Preziosi';
  }
  // Metalli industriali
  if (/\b(industrial metals|copper|nickel|aluminum|aluminium|zinc|tin|metalli industriali|base metals)\b/i.test(name)) {
    return 'Materie Prime - Metalli Industriali';
  }
  // Energia commodity (oil, gas, ecc.)
  if (/\b(crude oil|brent|wti|natural gas|petroleum|oil & gas|carbon|carbon credits|emissions)\b/i.test(name)) {
    return 'Materie Prime - Energia';
  }
  // Agricoltura
  if (/\b(agriculture|agricultural|cotton|wheat|soybean|soy|sugar|coffee|cattle|grain|livestock|corn|cocoa)\b/i.test(name)) {
    return 'Materie Prime - Agricoltura';
  }
  // Commodities generiche
  if (/\b(commodities|commodity|bcom|bloomberg commodity|broad commodit|enhanced roll)\b/i.test(name)) {
    return 'Materie Prime - Commodities';
  }

  // ── 14: Smart Beta (vince su geografia, da decisione utente) ──
  if (/\b(value factor|momentum factor|quality factor|low volatility|min volatility|minimum vol|multifactor|multi[- ]factor|alphadex|equal weight|fundamental|prime value|select factor|factor mix)\b/i.test(name)) {
    return 'Azionario - Smart Beta';
  }
  if (/\b(value ucits etf|value etf$|momentum ucits|quality ucits)\b/i.test(name)) {
    return 'Azionario - Smart Beta';
  }

  // ── 15: Dividend ──
  if (/\b(dividend|yield aristocrat|high yield equity|dividend select|div dax|divdax)\b/i.test(name)
      && !/\b(bond|corporate|govies|government|treasury)\b/i.test(name)) {
    return 'Azionario - Dividend';
  }

  // ── 16: Small/Mid Cap ──
  if (/\b(small cap|mid cap|small\/mid|smid|sdax|midcap|mdax)\b/i.test(name)) {
    return 'Azionario - Small/Mid Cap';
  }

  // ── 17: ESG/Green/Climate ──
  if (/\b(esg|sri|climate|paris[- ]aligned|sustainable|green|net zero|low carbon|socially responsible|ethical|ctb|enhanced ctb)\b/i.test(name)) {
    return 'Azionario Tematico - ESG/Green';
  }

  // ── 18: Geografia (ultimo step) ──
  // Emergenti (controlla prima di Globale, perché "MSCI Emerging" potrebbe matchare "MSCI" generico)
  if (/\b(emerging markets|emerging mkt|em ucits|msci em |india|china|brazil|brasile|korea|mexico|mexicano|turkey|russia|chinese|indiano)\b/i.test(name)) {
    return 'Azionario Emergenti';
  }
  // World ex / Globale
  if (/\b(world ex|msci world ex|acwi|all country world|world equity|msci world|ftse all-world|all-world|ftse global|world ucits|world index)\b/i.test(name)) {
    return 'Azionario Globale';
  }
  // USA
  if (/\b(s&p ?500|sp500|nasdaq 100|nasdaq-100|russell|dow jones (industrial|us)|msci usa|us equity|usa equity|north america|american|americano)\b/i.test(name)) {
    return 'Azionario USA';
  }
  // Pacifico
  if (/\b(japan|nikkei|topix|jpx|pacific|asia ex japan|asia[- ]pacific|asean|far east|asia)\b/i.test(name)) {
    return 'Azionario Pacifico';
  }
  // Europa (per ultimo perché molti tematici settoriali hanno "europe" nel nome — ma se sono arrivati qui, non sono tematici)
  if (/\b(europe|european|emu|eurozone|stoxx|msci europe|ftse 100|dax|cac 40|mib|italy equity|germany equity|france equity|uk equity|ftse europe)\b/i.test(name)) {
    return 'Azionario Europa';
  }
  // Globale generico (catch-all per "global", "world" senza specifiche)
  if (/\b(global|world)\b/i.test(name)) {
    return 'Azionario Globale';
  }

  // Nessun match → fallback AI
  return null;
}

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

    // Dettagli dell ultimo aggiornamento completo dai log
    const { rows: logRows } = await pool.query(`
      SELECT ts, dettagli FROM app_logs
      WHERE evento = 'AGGIORNA_PREZZI_AUTO'
      ORDER BY ts DESC LIMIT 1
    `);
    const lastLog = logRows[0] || null;
    const dati = lastLog?.dettagli || {};

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

  // Diagnostica classificazione ETF: cerca pattern comuni di mis-classificazione.
  // Restituisce CSV scaricabile con isin, name, categoria_attuale, pattern_sospetto.
  router.get('/admin/diagnostica-classificazione', authMiddleware, async (req, res) => {
    try {
      const sospetti = [];

      // Q1 — Emerging Markets non classificati come Emergenti
      const q1 = await pool.query(`
        SELECT isin, name, categoria, 'EM_classificato_altrove' AS pattern
        FROM etf_catalog
        WHERE active = 1
          AND (name ILIKE '%emerging%' OR name ILIKE '%emergenti%' OR name ILIKE '%MSCI EM%')
          AND categoria NOT ILIKE '%Emergenti%'
      `);
      sospetti.push(...q1.rows);

      // Q2 — Settoriali (Tech, Health, Energy, Financial...) NON classificati come tematici/settoriali
      const q2 = await pool.query(`
        SELECT isin, name, categoria, 'settoriale_geografico' AS pattern
        FROM etf_catalog
        WHERE active = 1
          AND (
            name ILIKE '%technology%' OR name ILIKE '%health%care%'
            OR name ILIKE '%energy%' OR name ILIKE '%financial%'
            OR name ILIKE '%real estate%' OR name ILIKE '%consumer%'
            OR name ILIKE '%industrial%' OR name ILIKE '%materials%'
            OR name ILIKE '%utilities%' OR name ILIKE '%communication%'
          )
          AND categoria NOT ILIKE '%Tematico%'
          AND categoria NOT ILIKE '%settoriale%'
          AND categoria NOT ILIKE '%Health%'
          AND categoria NOT ILIKE '%Tech%'
          AND categoria NOT ILIKE '%Energ%'
      `);
      sospetti.push(...q2.rows);

      // Q3 — Singoli paesi non emergenti, classificati genericamente
      const q3 = await pool.query(`
        SELECT isin, name, categoria, 'paese_singolo' AS pattern
        FROM etf_catalog
        WHERE active = 1
          AND (
            name ILIKE '%FTSE 100%' OR name ILIKE '%FTSE MIB%' OR name ILIKE '%DAX%'
            OR name ILIKE '%CAC 40%' OR name ILIKE '%TOPIX%' OR name ILIKE '%Nikkei%'
            OR name ILIKE '%India%' OR name ILIKE '%China%' OR name ILIKE '%Brazil%'
            OR name ILIKE '%Japan%' OR name ILIKE '%Italy%' OR name ILIKE '%Germany%'
            OR name ILIKE '%France%' OR name ILIKE '%UK Equity%' OR name ILIKE '%Korea%'
          )
          AND categoria NOT ILIKE '%Tematico%'
          AND categoria NOT ILIKE '%paese%'
      `);
      sospetti.push(...q3.rows);

      // Q4 — World ex-* non classificato come Globale
      const q4 = await pool.query(`
        SELECT isin, name, categoria, 'world_ex_non_globale' AS pattern
        FROM etf_catalog
        WHERE active = 1
          AND name ILIKE '%World ex%'
          AND categoria NOT ILIKE '%Globale%'
          AND categoria NOT ILIKE '%Internazionale%'
      `);
      sospetti.push(...q4.rows);

      // Q5 — Riepilogo distribuzione categorie globale (per riferimento)
      const q5 = await pool.query(`
        SELECT categoria, COUNT(*) AS n
        FROM etf_catalog
        WHERE active = 1
        GROUP BY categoria
        ORDER BY n DESC
      `);

      // Costruisci CSV: prima la lista dettaglio sospetti, poi una sezione di riepilogo
      const headers = ['isin', 'name', 'categoria', 'pattern'];
      const escape = v => {
        if (v == null) return '';
        const s = String(v);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };

      let csv = '\ufeff' + headers.join(';') + '\n' +
        sospetti.map(r => headers.map(h => escape(r[h])).join(';')).join('\n');

      // Sezione riepilogo categorie in coda
      csv += '\n\n--- DISTRIBUZIONE CATEGORIE NEL CATALOGO ---\ncategoria;n\n';
      csv += q5.rows.map(r => `${escape(r.categoria)};${r.n}`).join('\n');

      const fileName = `diagnostica_classificazione_${new Date().toISOString().slice(0,10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(csv);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Export CSV degli ETF "fossili" (mai aggiornati o stale > 30 giorni)
  // Il browser scarica direttamente il file. Bypassa il limite di 100 righe del DB UI.
  router.get('/admin/export-fossili-csv', authMiddleware, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          c.isin,
          COALESCE(c.ticker_yahoo, '') AS ticker,
          COALESCE(c.name, '') AS name,
          COALESCE(c.categoria, '') AS categoria,
          COALESCE(c.emittente, '') AS emittente,
          COALESCE(c.valuta, '') AS valuta,
          (SELECT MAX(data) FROM prezzi_storici WHERE isin = c.isin) AS ultimo_prezzo,
          CASE
            WHEN NOT EXISTS (SELECT 1 FROM prezzi_storici WHERE isin = c.isin AND prezzo > 0) THEN 'mai'
            ELSE 'stale'
          END AS motivo,
          CASE
            WHEN c.ticker_yahoo IS NULL OR c.ticker_yahoo = '' THEN 'ticker_vuoto'
            WHEN c.ticker_yahoo NOT LIKE '%.%' THEN 'ticker_senza_suffisso'
            ELSE 'ticker_normale'
          END AS tipo_ticker
        FROM etf_catalog c
        WHERE c.active = 1
          AND (
            NOT EXISTS (SELECT 1 FROM prezzi_storici ps WHERE ps.isin = c.isin AND ps.prezzo > 0)
            OR (SELECT MAX(data) FROM prezzi_storici WHERE isin = c.isin)::date < CURRENT_DATE - 30
          )
        ORDER BY motivo, c.emittente, c.name
      `);

      const headers = ['isin','ticker','name','categoria','emittente','valuta','ultimo_prezzo','motivo','tipo_ticker'];
      const escape = v => {
        if (v == null) return '';
        const s = String(v);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = '\ufeff' + headers.join(';') + '\n' +
        rows.map(r => headers.map(h => escape(r[h])).join(';')).join('\n');

      const fileName = `fossili_etf_${new Date().toISOString().slice(0,10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(csv);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Riclassificazione automatica delle categorie ETF basata su pattern del nome.
  // Per gli ETF che non matchano nessuna regola, usa fallback AI (Haiku 4.5 in batch).
  // Body opzionale: { dryRun: bool, useAi: bool, limit: number }
  router.post('/admin/riclassifica', authMiddleware, async (req, res) => {
    const { dryRun = true, useAi = true, limit = 5000 } = req.body || {};

    const { rows: etfs } = await pool.query(
      `SELECT isin, name, categoria FROM etf_catalog
       WHERE active = 1 AND name IS NOT NULL AND name != ''
       ORDER BY isin
       LIMIT $1`,
      [Math.min(parseInt(limit) || 5000, 5000)]
    );

    res.json({
      message: `Riclassificazione avviata: ${etfs.length} ETF (dryRun=${dryRun}, useAi=${useAi}). Vedi log per progresso. Risultato finale via /admin/riclassifica-result.`,
      etfDaProcessare: etfs.length,
    });

    // Esecuzione in background
    (async () => {
      const start = Date.now();
      const propostiPerRegole = [];
      const senzaMatch = [];

      console.log(`\n[riclassifica] Inizio: ${etfs.length} ETF (dryRun=${dryRun}, useAi=${useAi})`);

      // ─── Step 1: applica regole ───
      for (const etf of etfs) {
        const cat = classificaPerRegole(etf.name);
        if (cat) {
          if (cat !== etf.categoria) propostiPerRegole.push({ ...etf, nuovaCategoria: cat, fonte: 'regole' });
        } else {
          senzaMatch.push(etf);
        }
      }
      console.log(`[riclassifica] Regole: ${propostiPerRegole.length} riclassificati, ${senzaMatch.length} senza match`);

      // ─── Step 2: fallback AI per i senza match ───
      const propostiPerAi = [];
      if (useAi && senzaMatch.length > 0) {
        const BATCH = 30;
        const categorie = [
          'Azionario Globale','Azionario USA','Azionario Europa','Azionario Emergenti','Azionario Pacifico',
          'Azionario - Smart Beta','Azionario - Dividend','Azionario - Small/Mid Cap',
          'Azionario Tematico - Salute','Azionario Tematico - Tecnologia','Azionario Tematico - Finanziario',
          'Azionario Tematico - Energia','Azionario Tematico - Settoriale','Azionario Tematico - Immobiliare',
          'Azionario Tematico - Difesa','Azionario Tematico - Infrastrutture','Azionario Tematico - Consumi',
          'Azionario Tematico - ESG/Green',
          'Obbligazionario','Obbligazionario Governativo','Obbligazionario Corporate',
          'Obbligazionario High Yield','Obbligazionario Emergenti',
          'Materie Prime - Commodities','Materie Prime - Metalli Preziosi','Materie Prime - Metalli Industriali',
          'Materie Prime - Energia','Materie Prime - Crypto','Materie Prime - Agricoltura',
          'Liquidità / Monetario',
        ];

        for (let i = 0; i < senzaMatch.length; i += BATCH) {
          const chunk = senzaMatch.slice(i, i + BATCH);
          const lista = chunk.map((e, j) => `${j+1}. ${e.isin} | ${e.name} | attuale: ${e.categoria || 'N/D'}`).join('\n');
          const prompt = `Classifica i seguenti ETF nella categoria più adatta. Le categorie possibili sono SOLO queste (non inventarne):

${categorie.join(', ')}

REGOLE:
- Settori (Tech, Health, Energy, Financials, ecc.) hanno PRIORITÀ sulla geografia → "Azionario Tematico - X"
- Smart Beta (Value, Momentum, Quality, Low Vol) ha PRIORITÀ sulla geografia → "Azionario - Smart Beta"
- ETF obbligazionari sempre in famiglia "Obbligazionario *"
- Ultima istanza: classificazione geografica ("Azionario USA/Europa/Emergenti/Pacifico/Globale")
- Se l'ETF è cross (es. cinese su S&P USA), prevale la geografia del fondo (cinese → Emergenti)

ETF DA CLASSIFICARE:
${lista}

Risposta in JSON puro, formato:
[
  { "isin": "IE00...", "categoria": "Azionario Globale" },
  ...
]
Una riga per ogni ETF. Niente testo extra prima o dopo il JSON.`;

          try {
            const message = await getAnthropic().messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 2000,
              messages: [{ role: 'user', content: prompt }],
            });
            const testo = message.content?.[0]?.text || '';
            const matches = [...testo.matchAll(/\[([\s\S]*?)\]/g)];
            for (let k = matches.length - 1; k >= 0; k--) {
              try {
                const parsed = JSON.parse('[' + matches[k][1] + ']');
                if (Array.isArray(parsed) && parsed[0]?.isin && parsed[0]?.categoria) {
                  for (const r of parsed) {
                    const orig = chunk.find(e => e.isin === r.isin);
                    if (orig && categorie.includes(r.categoria) && r.categoria !== orig.categoria) {
                      propostiPerAi.push({ ...orig, nuovaCategoria: r.categoria, fonte: 'ai' });
                    }
                  }
                  break;
                }
              } catch {}
            }
            console.log(`[riclassifica] AI batch ${Math.floor(i/BATCH)+1}/${Math.ceil(senzaMatch.length/BATCH)} processato`);
          } catch (e) {
            console.log(`[riclassifica] AI batch ${i/BATCH} errore: ${e.message}`);
          }
          await new Promise(r => setTimeout(r, 500));
        }
      }

      const tutteProposte = [...propostiPerRegole, ...propostiPerAi];
      console.log(`[riclassifica] Totale modifiche proposte: ${tutteProposte.length} (${propostiPerRegole.length} da regole + ${propostiPerAi.length} da AI)`);

      // ─── Step 3: applica modifiche (se non dryRun) ───
      let applicate = 0;
      if (!dryRun && tutteProposte.length > 0) {
        for (const p of tutteProposte) {
          try {
            await pool.query('UPDATE etf_catalog SET categoria = $1 WHERE isin = $2', [p.nuovaCategoria, p.isin]);
            applicate += 1;
          } catch (e) {
            console.log(`[riclassifica] errore update ${p.isin}: ${e.message}`);
          }
        }
      }

      const stats = {
        totaleProcessati: etfs.length,
        riclassificate: tutteProposte.length,
        daRegole: propostiPerRegole.length,
        daAi: propostiPerAi.length,
        senzaMatch: senzaMatch.length - propostiPerAi.length,
        applicate,
        dryRun,
        durata_s: Math.round((Date.now() - start) / 1000),
        // Salviamo le proposte in memoria globale per essere recuperate via altra route
        proposte: tutteProposte,
      };
      // Salva in variabile globale dell'app per recupero successivo
      global.__lastRiclassificaResult = stats;

      console.log(`[riclassifica] Completato in ${stats.durata_s}s: ${tutteProposte.length} riclassificate, ${applicate} applicate al DB`);
      log(EVENTI.AGGIORNA_PREZZI_SELETTIVO, {
        ok: applicate,
        err: tutteProposte.length - applicate,
        totale: etfs.length,
        motivo: `riclassifica${dryRun ? '-dryrun' : ''}`,
      }).catch(() => {});
    })().catch(e => console.error('[riclassifica] Errore fatale:', e.message));
  });

  // Recupera l'ultimo risultato di riclassifica come CSV scaricabile
  router.get('/admin/riclassifica-result', authMiddleware, async (req, res) => {
    const last = global.__lastRiclassificaResult;
    if (!last) {
      return res.status(404).json({ error: 'Nessun risultato disponibile. Lancia prima POST /admin/riclassifica.' });
    }

    const headers = ['isin', 'name', 'categoria_attuale', 'nuova_categoria', 'fonte'];
    const escape = v => {
      if (v == null) return '';
      const s = String(v);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = '\ufeff' + headers.join(';') + '\n' +
      last.proposte.map(p => [
        escape(p.isin),
        escape(p.name),
        escape(p.categoria),
        escape(p.nuovaCategoria),
        escape(p.fonte),
      ].join(';')).join('\n') +
      `\n\n--- STATISTICHE ---\nTotale processati;${last.totaleProcessati}\nRiclassificate;${last.riclassificate}\nDa regole;${last.daRegole}\nDa AI;${last.daAi}\nSenza match;${last.senzaMatch}\nApplicate al DB;${last.applicate}\ndryRun;${last.dryRun}\nDurata (s);${last.durata_s}`;

    const fileName = `riclassifica_${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  });

  // Fix ticker senza suffisso di exchange (es. "QDV4" → "QDV4.DE")
  // Prova i 9 exchange comuni e salva il primo che risponde con prezzo valido.
  // Risposta immediata, elaborazione in background con log su console.
  router.post('/admin/fix-ticker-senza-suffisso', authMiddleware, async (req, res) => {
    const { limit, dryRun } = req.body || {};
    const { rows: etfs } = await pool.query(
      `SELECT isin, ticker_yahoo, name FROM etf_catalog
       WHERE active = 1 AND ticker_yahoo IS NOT NULL AND ticker_yahoo != ''
       AND ticker_yahoo NOT LIKE '%.%'
       ORDER BY isin
       LIMIT $1`,
      [Math.min(parseInt(limit) || 500, 500)]
    );
    res.json({ message: `Fix avviato su ${etfs.length} ETF (dryRun=${!!dryRun}). Vedi i log del server per progress.`, etfDaProcessare: etfs.length });

    // Esecuzione in background
    (async () => {
      const axios = require('axios');
      const HEADERS = { 'User-Agent': 'Mozilla/5.0' };
      const oggi = new Date().toISOString().slice(0, 10);
      const SUFFIXES = ['.DE', '.MI', '.L', '.AS', '.PA', '.F', '.SW', '.IR', '.SG'];
      const risultati = { fixed: [], notFound: [], errors: [] };

      console.log(`\n[fix-ticker] Inizio fix su ${etfs.length} ETF (dryRun=${!!dryRun})`);

      for (const etf of etfs) {
        const { isin, ticker_yahoo: tickerBase, name } = etf;
        let trovato = null;

        for (const suf of SUFFIXES) {
          const tickerProva = tickerBase + suf;
          try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${tickerProva}?interval=1d&range=5y`;
            const { data } = await axios.get(url, { headers: HEADERS, timeout: 8000 });
            const result = data?.chart?.result?.[0];
            if (!result) { await new Promise(r => setTimeout(r, 150)); continue; }
            const meta = result.meta;
            const closes = result.indicators?.quote?.[0]?.close || [];
            const validi = closes.filter(c => c != null);
            const prezzo = meta?.regularMarketPrice || validi[validi.length - 1];
            if (prezzo > 0) {
              const l = validi.length;
              const perf = (idx) => idx >= 0 && idx < l && validi[idx] ? parseFloat(((prezzo - validi[idx]) / validi[idx] * 100).toFixed(2)) : null;
              trovato = {
                ticker: tickerProva,
                prezzo: parseFloat(prezzo.toFixed(3)),
                perf1m: perf(l - 22), perf6m: perf(l - 126),
                perf1y: perf(l - 252), perf5y: perf(0),
              };
              break;
            }
          } catch { /* 404 atteso per exchange sbagliati */ }
          await new Promise(r => setTimeout(r, 150));
        }

        if (trovato) {
          if (!dryRun) {
            await pool.query('UPDATE etf_catalog SET ticker_yahoo=$1, quotazione=$2, perf1m=COALESCE($3,perf1m), perf6m=COALESCE($4,perf6m), perf1y=COALESCE($5,perf1y), perf5y=COALESCE($6,perf5y), updated_at=$7 WHERE isin=$8',
              [trovato.ticker, trovato.prezzo, trovato.perf1m, trovato.perf6m, trovato.perf1y, trovato.perf5y, oggi, isin]);
            await pool.query(`INSERT INTO prezzi_storici (isin, data, prezzo, perf1m, perf6m, perf1y, perf5y) VALUES ($1,$2,$3,$4,$5,$6,$7)
              ON CONFLICT(isin, data) DO UPDATE SET prezzo=EXCLUDED.prezzo, perf1m=EXCLUDED.perf1m, perf6m=EXCLUDED.perf6m, perf1y=EXCLUDED.perf1y, perf5y=EXCLUDED.perf5y`,
              [isin, oggi, trovato.prezzo, trovato.perf1m, trovato.perf6m, trovato.perf1y, trovato.perf5y]);
          }
          risultati.fixed.push({ isin, name, da: tickerBase, a: trovato.ticker, prezzo: trovato.prezzo });
          console.log(`[fix-ticker] ✓ ${isin} (${name?.slice(0,40)}): ${tickerBase} → ${trovato.ticker} @ €${trovato.prezzo}${dryRun ? ' [DRY-RUN]' : ''}`);
        } else {
          risultati.notFound.push({ isin, name, ticker: tickerBase });
          console.log(`[fix-ticker] ✗ ${isin} (${name?.slice(0,40)}): ${tickerBase} non trovato su nessun exchange`);
        }

        await new Promise(r => setTimeout(r, 300));
      }

      console.log(`\n[fix-ticker] Completato: ${risultati.fixed.length} fixed, ${risultati.notFound.length} not found`);
      log(EVENTI.AGGIORNA_PREZZI_SELETTIVO, {
        ok: risultati.fixed.length,
        err: risultati.notFound.length,
        totale: etfs.length,
        motivo: `fix-ticker-senza-suffisso${dryRun ? '-dryrun' : ''}`,
      }).catch(() => {});
    })().catch(e => console.error('[fix-ticker] Errore fatale:', e.message));
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
        for (const suf of ['.MI', '.AS', '.DE', '.PA', '.L', '.F', '.SW', '.IR', '.SG', '.HM', '.MU', '.DU', '.HA', '.BE']) {
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
      // Fallback finale: prova ISIN nudo (Yahoo a volte risponde direttamente)
      if (!dati?.quotazione) {
        try {
          const axios = require('axios');
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${isin}?interval=1d&range=1d`;
          const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
          const prezzo = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (prezzo > 0) {
            dati = { quotazione: prezzo, perf1m: null, perf6m: null, perf1y: null, perf5y: null };
            console.log(`[auto-update] 🔧 Prezzo via ISIN nudo: ${isin} @ €${prezzo}`);
          }
        } catch {}
      }
      if (dati?.quotazione > 0) {
        await pool.query(`
          INSERT INTO prezzi_storici (isin, data, prezzo, perf1m, perf6m, perf1y, perf5y) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(isin, data) DO UPDATE SET prezzo=EXCLUDED.prezzo, perf1m=EXCLUDED.perf1m,
            perf6m=EXCLUDED.perf6m, perf1y=EXCLUDED.perf1y, perf5y=EXCLUDED.perf5y
        `, [isin, oggi, dati.quotazione, dati.perf1m, dati.perf6m, dati.perf1y, dati.perf5y]);
        await pool.query(
          `UPDATE etf_catalog SET 
            quotazione=$1, 
            perf1m=COALESCE($2, perf1m), 
            perf6m=COALESCE($3, perf6m), 
            perf1y=COALESCE($4, perf1y), 
            perf5y=COALESCE($5, perf5y), 
            updated_at=$6 
          WHERE isin=$7`,
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
        for (const suf of ['.MI', '.AS', '.DE', '.PA', '.L', '.F', '.SW', '.IR', '.SG', '.HM', '.MU', '.DU', '.HA', '.BE']) {
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
      // Fallback finale: prova ISIN nudo (Yahoo a volte risponde direttamente)
      if (!dati?.quotazione) {
        try {
          const axios = require('axios');
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${isin}?interval=1d&range=1d`;
          const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
          const prezzo = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (prezzo > 0) {
            dati = { quotazione: prezzo, perf1m: null, perf6m: null, perf1y: null, perf5y: null };
            console.log(`[auto-update] 🔧 Prezzo via ISIN nudo: ${isin} @ €${prezzo}`);
          }
        } catch {}
      }
      if (dati?.quotazione > 0) {
        await pool.query(`
          INSERT INTO prezzi_storici (isin, data, prezzo, perf1m, perf6m, perf1y, perf5y) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(isin, data) DO UPDATE SET prezzo=EXCLUDED.prezzo, perf1m=EXCLUDED.perf1m,
            perf6m=EXCLUDED.perf6m, perf1y=EXCLUDED.perf1y, perf5y=EXCLUDED.perf5y
        `, [isin, oggi, dati.quotazione, dati.perf1m, dati.perf6m, dati.perf1y, dati.perf5y]);
        await pool.query(
          `UPDATE etf_catalog SET 
            quotazione=$1, 
            perf1m=COALESCE($2, perf1m), 
            perf6m=COALESCE($3, perf6m), 
            perf1y=COALESCE($4, perf1y), 
            perf5y=COALESCE($5, perf5y), 
            updated_at=$6 
          WHERE isin=$7`,
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
