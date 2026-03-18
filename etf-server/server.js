require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const { Pool } = require('pg');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ══════════════════════════════════════════════
//  DATABASE POSTGRESQL — INIT
// ══════════════════════════════════════════════
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
  // Migrazioni sicure
  await pool.q('ALTER TABLE etf_catalog ADD COLUMN IF NOT EXISTS maxdd5y REAL');
  console.log('✓ Database PostgreSQL pronto');
}

// ══════════════════════════════════════════════
//  ROUTES — mount
// ══════════════════════════════════════════════
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
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
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

// ── Scheduler aggiornamento prezzi 18:00 ─────────────────────────────────
const { schedulaAggiornamento18 } = require('./routes/catalog');

// ── Serve frontend build ──────────────────────────────────────────────────
const distPath = process.env.STATIC_PATH || path.join(__dirname, '..', 'etf-app', 'build');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  console.log(`📦 Frontend servito da: ${distPath}`);
}

// ── Start ─────────────────────────────────────────────────────────────────
initDB().then(() => {
  schedulaAggiornamento18(pool, fetchETF);
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
