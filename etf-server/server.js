require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const { Pool } = require('pg');
const path    = require('path');
const fs      = require('fs');

const { log, setPool, EVENTI } = require('./routes/logger');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ══════════════════════════════════════════════════════════════════════════
//  DATABASE POSTGRESQL — INIT
// ══════════════════════════════════════════════════════════════════════════
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace('postgres.railway.internal:5432', 'crossover.proxy.rlwy.net:20706'),
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

// Helper: query semplificata
pool.q = (text, params) => pool.query(text, params);

async function initDB() {
  await pool.q(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS portfolios (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      risk_profile TEXT NOT NULL,
      max_usa TEXT DEFAULT 'No max',
      minusvalenze_disponibili REAL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS minusvalenze_manuali (
      id SERIAL PRIMARY KEY,
      portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      importo REAL NOT NULL,
      data_scadenza TEXT,
      note TEXT,
      usata INTEGER DEFAULT 0,
      condivisa INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS portfolio_etf (
      id SERIAL PRIMARY KEY,
      portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      isin TEXT NOT NULL,
      selected INTEGER DEFAULT 0,
      tipo TEXT DEFAULT 'consigliato',
      UNIQUE(portfolio_id, isin)
    );
    CREATE TABLE IF NOT EXISTS acquisti (
      id SERIAL PRIMARY KEY,
      portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      isin TEXT NOT NULL,
      quantita REAL NOT NULL,
      quotazione_acquisto REAL NOT NULL,
      data_acquisto TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS prezzi_storici (
      id SERIAL PRIMARY KEY,
      isin TEXT NOT NULL,
      data TEXT NOT NULL,
      prezzo REAL,
      perf1m REAL,
      perf6m REAL,
      perf1y REAL,
      perf5y REAL,
      UNIQUE(isin, data)
    );
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS portfolio_buckets (
      id SERIAL PRIMARY KEY,
      portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('BREVE','LUNGO')),
      pct_allocazione REAL NOT NULL DEFAULT 50,
      orizzonte_anni INTEGER NOT NULL DEFAULT 5,
      rendimento_target_annuo REAL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(portfolio_id, tipo)
    );
    CREATE TABLE IF NOT EXISTS ai_config (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      categoria TEXT NOT NULL,
      valore REAL NOT NULL DEFAULT 50,
      min_val REAL NOT NULL DEFAULT 0,
      max_val REAL NOT NULL DEFAULT 100,
      descrizione TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS app_logs (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      evento TEXT NOT NULL,
      utente TEXT,
      dettagli JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_app_logs_ts ON app_logs(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_app_logs_evento ON app_logs(evento);
    CREATE TABLE IF NOT EXISTS vendite (
      id SERIAL PRIMARY KEY,
      portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      isin TEXT NOT NULL,
      quantita REAL NOT NULL,
      quotazione_vendita REAL NOT NULL,
      quotazione_acquisto REAL NOT NULL DEFAULT 0,
      data_vendita TEXT NOT NULL,
      quantita_residua REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS etf_catalog (
      isin TEXT PRIMARY KEY,
      name TEXT,
      emittente TEXT,
      ter REAL,
      valuta TEXT,
      aum_mln REAL,
      perf1m REAL,
      perf6m REAL,
      perf1y REAL,
      perf3y REAL,
      perf5y REAL,
      vol1y REAL,
      maxdd1y REAL,
      maxdd5y REAL,
      distribuzione TEXT,
      replica TEXT,
      ticker_yahoo TEXT,
      categoria TEXT,
      quotazione REAL,
      active INTEGER DEFAULT 1,
      updated_at TEXT
    );
  `);

  // Seed utente demo
  const { rows } = await pool.q("SELECT id FROM users WHERE username = 'demo'");
  if (rows.length === 0) {
    await pool.q(
      'INSERT INTO users (id, username, password, email) VALUES ($1, $2, $3, $4)',
      ['u1', 'demo', bcrypt.hashSync('demo123', 10), 'demo@email.com']
    );
    console.log('✓ Utente demo creato');
  }
  // Seed ai_config — valori default scorecard
  const aiConfigDefaults = [
    // HARD: totale 52
    ['peso_quota_azion',    'Quota azionaria target',   'HARD', 14, 0, 20, 'Target azionario per profilo (+/-10%)'],
    ['peso_volatilita',     'Volatilita media port.',   'HARD', 11, 0, 20, 'Vol media ponderata <= limite profilo'],
    ['peso_max_drawdown',   'Max Drawdown 1Y',          'HARD',  8, 0, 20, 'Drawdown singolo ETF <= limite profilo'],
    ['peso_num_etf',        'N. ETF nel portafoglio',   'HARD',  8, 0, 20, 'Numero ETF nel range min-max profilo'],
    ['peso_capitaliz',      'Capitalizzazione minima',  'HARD',  6, 0, 20, 'AUM >= minimo per profilo'],
    ['peso_limite_usa',     'Limite esposizione USA',   'HARD',  5, 0, 20, 'Vincolo geografico USA se impostato'],
    // SOFT: totale 18
    ['peso_ter',            'TER ponderato',            'SOFT',  8, 0, 15, 'Costo totale ponderato del portafoglio'],
    ['peso_correlazione',   'Correlazione tra ETF',     'SOFT',  6, 0, 15, 'Diversificazione coppie ETF (<0.6)'],
    ['peso_hedging',        'Hedging valuta non EUR',   'SOFT',  4, 0, 15, 'Copertura valutaria per profilo'],
    // MACRO: totale 14
    ['peso_tassi',          'Tassi BCE/Fed',            'MACRO', 4, 0, 10, 'Tassi interesse e outlook banche centrali'],
    ['peso_vix',            'VIX (volatilita mercato)', 'MACRO', 3, 0, 10, 'Volatilita mercato e risk-off'],
    ['peso_inflazione',     'Inflazione EU/USA',        'MACRO', 3, 0, 10, 'Pressione inflattiva corrente'],
    ['peso_petrolio',       'Petrolio Brent',           'MACRO', 2, 0, 10, 'Shock petrolio e inflazione secondaria'],
    ['peso_curva_eurusd',   'Curva tassi / EUR/USD',    'MACRO', 2, 0, 10, 'Curva rendimenti e cambio valutario'],
    // BUCKET/FATTORI: totale 16
    ['peso_bucket_coerenza','Coerenza ETF-Bucket',      'BUCKET', 5, 0, 10, 'ETF coerente con orizzonte del bucket'],
    ['peso_smartbeta',      'Smart Beta vs scenario',   'BUCKET', 4, 0, 10, 'Fattore ETF adatto a scenario macro'],
    ['peso_rend_compless',  'Rendimento complessivo',   'BUCKET', 4, 0, 10, 'Rend. pesato >= minimo del profilo'],
    ['peso_divers_fattori', 'Diversificazione fattori', 'BUCKET', 3, 0, 10, 'Varieta fattori Smart Beta in portafoglio'],
  ];
  for (const [key,label,cat,val,min,max,desc] of aiConfigDefaults) {
    await pool.q(
      `INSERT INTO ai_config (key,label,categoria,valore,min_val,max_val,descrizione) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (key) DO UPDATE SET valore=EXCLUDED.valore, label=EXCLUDED.label, categoria=EXCLUDED.categoria, min_val=EXCLUDED.min_val, max_val=EXCLUDED.max_val, descrizione=EXCLUDED.descrizione`,
      [key,label,cat,val,min,max,desc]
    );
  }
  // Migrazioni sicure
  await pool.q('ALTER TABLE etf_catalog ADD COLUMN IF NOT EXISTS maxdd5y REAL');
  await pool.q("ALTER TABLE portfolio_etf ADD COLUMN IF NOT EXISTS bucket TEXT DEFAULT 'LUNGO'");
  await pool.q('ALTER TABLE etf_catalog ADD COLUMN IF NOT EXISTS smart_beta_factor TEXT');
  console.log('✓ Database PostgreSQL pronto');
}

// ══════════════════════════════════════════════════════════════════════════
//  ROUTES — mount
// ══════════════════════════════════════════════════════════════════════════
const { fetchETF, ETF_INFO_MAP } = require('./routes/etf');

app.use('/api/auth',        require('./routes/auth')(pool));
app.use('/api/portfolios',  require('./routes/portfolios')(pool));
app.use('/api/portfolios',  require('./routes/vendite')(pool));
app.use('/api/etf',         require('./routes/etf')(pool));
app.use('/api/etf-catalog', require('./routes/catalog')(pool, fetchETF));
app.use('/api/ai',          require('./routes/ai')(pool, fetchETF, ETF_INFO_MAP));
app.use('/api/reports',     require('./routes/reports')(pool));

app.get('/api/health', async (req, res) => {
  try {
    const { rows: u } = await pool.q('SELECT COUNT(*) as c FROM users');
    const { rows: p } = await pool.q('SELECT COUNT(*) as c FROM portfolios');
    res.json({ status: 'ok', db: 'postgresql', users: parseInt(u[0].c), portfolios: parseInt(p[0].c), timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/debug-env', (req, res) => {
  res.json({
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    keyLength: process.env.ANTHROPIC_API_KEY?.length,
    port: process.env.PORT,
    allKeys: Object.keys(process.env),
  });
});

app.post('/api/admin/cleanup-prezzi', async (req, res) => {
  try {
    const { rowCount } = await pool.q('DELETE FROM prezzi_storici WHERE prezzo IS NULL OR prezzo <= 0');
    res.json({ ok: true, rimossi: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/test', async (req, res) => {
  try {
    const axios = require('axios');
    const { data } = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/IWDA.AS?interval=1d&range=1y', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    res.json({ prezzo: data?.chart?.result?.[0]?.meta?.regularMarketPrice });
  } catch (e) { res.json({ errore: e.message }); }
});

// ── AI Config endpoint ─────────────────────────────────────────────────────
const authMiddleware = require('./middleware/auth');

app.get('/api/ai/config', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ai_config ORDER BY categoria, key');
    res.json({ ok: true, config: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/ai/config/:key', authMiddleware, async (req, res) => {
  const { valore } = req.body;
  if (valore == null || isNaN(parseFloat(valore))) return res.status(400).json({ error: 'Valore non valido' });
  try {
    const { rows } = await pool.query(
      `UPDATE ai_config SET valore=$1, updated_at=NOW() WHERE key=$2 RETURNING *`,
      [parseFloat(valore), req.params.key]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Chiave non trovata' });
    res.json({ ok: true, config: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/config/reset', authMiddleware, async (req, res) => {
  try {
    await pool.query(`UPDATE ai_config SET valore = CASE
      WHEN key='peso_quota_azion'     THEN 14
      WHEN key='peso_volatilita'      THEN 11
      WHEN key='peso_max_drawdown'    THEN 8
      WHEN key='peso_num_etf'         THEN 8
      WHEN key='peso_capitaliz'       THEN 6
      WHEN key='peso_limite_usa'      THEN 5
      WHEN key='peso_ter'             THEN 8
      WHEN key='peso_correlazione'    THEN 6
      WHEN key='peso_hedging'         THEN 4
      WHEN key='peso_tassi'           THEN 4
      WHEN key='peso_vix'             THEN 3
      WHEN key='peso_inflazione'      THEN 3
      WHEN key='peso_petrolio'        THEN 2
      WHEN key='peso_curva_eurusd'    THEN 2
      WHEN key='peso_bucket_coerenza' THEN 5
      WHEN key='peso_smartbeta'       THEN 4
      WHEN key='peso_rend_compless'   THEN 4
      WHEN key='peso_divers_fattori'  THEN 3
      ELSE valore END, updated_at=NOW()`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── App Logs endpoint ──────────────────────────────────────────────────────
app.delete('/api/admin/logs', authMiddleware, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Nessun ID fornito' });
    const ph = ids.map((_, i) => `$${i+1}`).join(',');
    const { rowCount } = await pool.query(`DELETE FROM app_logs WHERE id IN (${ph})`, ids);
    res.json({ ok: true, eliminati: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/logs', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const evento = req.query.evento || null;
    const utente = req.query.utente || null;
    let sql = `SELECT id, ts, evento, utente, dettagli FROM app_logs`;
    const params = [];
    const where = [];
    if (evento) { params.push(`${evento}%`); where.push(`evento ILIKE $${params.length}`); }
    if (utente) { params.push(`%${utente}%`); where.push(`utente ILIKE $${params.length}`); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    params.push(limit);
    sql += ` ORDER BY ts DESC LIMIT $${params.length}`;
    const { rows } = await pool.query(sql, params);
    res.json({ ok: true, logs: rows, totale: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Macro context endpoint ─────────────────────────────────────────────────
const { getMacroContext, getMacroDati } = require('./routes/macro');

app.get('/api/macro/context', async (req, res) => {
  try {
    const { testo, dati } = await getMacroDati();
    res.json({ ok: true, testo, dati, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Scheduler aggiornamento prezzi 18:00 ──────────────────────────────────
const { schedulaAggiornamento18, schedulaJustetfSync } = require('./routes/catalog');

// ── Serve frontend build ──────────────────────────────────────────────────
// Ricerca robusta: prova vari path possibili e logga cosa vede sul filesystem
// così se Railway o Docker cambiano il layout scopriamo subito dov'è finito.
const distCandidates = [
  process.env.STATIC_PATH,
  path.join(__dirname, '..', 'etf-app', 'build'),
  path.join(__dirname, '..', 'etf-app', 'dist'),
  path.join(__dirname, 'public'),
  '/app/etf-app/build',
  '/app/etf-app/dist',
].filter(Boolean);

console.log('[static] __dirname    =', __dirname);
console.log('[static] process.cwd() =', process.cwd());
try {
  const rootFs = fs.existsSync('/app') ? '/app' : process.cwd();
  console.log(`[static] ${rootFs} contiene:`, fs.readdirSync(rootFs).join(', '));
  const etfAppPath = path.join(rootFs, 'etf-app');
  if (fs.existsSync(etfAppPath)) {
    console.log(`[static] ${etfAppPath} contiene:`, fs.readdirSync(etfAppPath).join(', '));
  } else {
    console.log(`[static] ${etfAppPath} NON ESISTE`);
  }
} catch (e) {
  console.log('[static] readdir error:', e.message);
}

let distPath = null;
for (const c of distCandidates) {
  const trovata = fs.existsSync(c);
  console.log(`[static] provo: ${c} → ${trovata ? 'TROVATA ✓' : 'no'}`);
  if (trovata && !distPath) { distPath = c; }
}

if (distPath) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  console.log(`📦 Frontend servito da: ${distPath}`);

  // Log diagnostico: contenuto della cartella static/js e riferimento bundle in index.html
  try {
    const jsDir = path.join(distPath, 'static', 'js');
    if (fs.existsSync(jsDir)) {
      const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
      console.log(`[static] bundle JS in ${jsDir}:`, jsFiles.join(', '));
    } else {
      console.log(`[static] ${jsDir} NON ESISTE`);
    }
    const idx = path.join(distPath, 'index.html');
    if (fs.existsSync(idx)) {
      const html = fs.readFileSync(idx, 'utf8');
      const m = html.match(/main\.[a-f0-9]+\.js/);
      console.log(`[static] index.html riferisce bundle: ${m ? m[0] : '(non trovato)'}`);
    }
  } catch (e) {
    console.log('[static] error leggendo bundle:', e.message);
  }
} else {
  console.log('⚠️  Nessuna cartella statica trovata, frontend non servito.');
}

// ── Start ─────────────────────────────────────────────────────────────────
initDB().then(() => {
  // Inizializza logger con pool DB
  setPool(pool);
  log(EVENTI.SERVER_START, { porta: PORT, env: process.env.NODE_ENV || 'production' });

  schedulaAggiornamento18(pool, fetchETF);
  schedulaJustetfSync(pool);
  app.listen(PORT, () => {
    console.log(`\n🚀 ETF Server avviato su http://localhost:${PORT}`);
    console.log(`🗄️  Database: PostgreSQL`);
    console.log(`📊 Auth:      /api/auth/*`);
    console.log(`📁 Portfolio: /api/portfolios/*`);
    console.log(`📈 ETF:       /api/etf/* · /api/etf-catalog/*`);
    console.log(`🤖 AI:        /api/ai/*`);
    console.log(`📋 Reports:   /api/reports/*\n`);
  });
}).catch(e => {
  console.error('❌ Errore inizializzazione DB:', e.message);
  process.exit(1);
});
