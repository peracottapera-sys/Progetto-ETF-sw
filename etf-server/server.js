require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, 'etf_app.db');

app.use(cors());
app.use(express.json());

// ══════════════════════════════════════════════
//  DATABASE SQLITE — INIT
// ══════════════════════════════════════════════
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, email TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS portfolios (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    name TEXT NOT NULL, risk_profile TEXT NOT NULL,
    max_usa TEXT DEFAULT 'No max',
    minusvalenze_disponibili REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS minusvalenze_manuali (
    id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id TEXT NOT NULL,
    importo REAL NOT NULL, data_scadenza TEXT, note TEXT,
    usata INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS portfolio_etf (
    id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id TEXT NOT NULL,
    isin TEXT NOT NULL, selected INTEGER DEFAULT 0,
    tipo TEXT DEFAULT 'consigliato',
    UNIQUE(portfolio_id, isin),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS acquisti (
    id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id TEXT NOT NULL,
    isin TEXT NOT NULL, quantita REAL NOT NULL,
    quotazione_acquisto REAL NOT NULL, data_acquisto TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS prezzi_storici (
    id INTEGER PRIMARY KEY AUTOINCREMENT, isin TEXT NOT NULL,
    data TEXT NOT NULL, prezzo REAL, perf1m REAL, perf6m REAL,
    perf1y REAL, perf5y REAL, UNIQUE(isin, data)
  );
  CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS vendite (
    id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id TEXT NOT NULL,
    isin TEXT NOT NULL, quantita REAL NOT NULL,
    quotazione_vendita REAL NOT NULL,
    quotazione_acquisto REAL NOT NULL DEFAULT 0,
    data_vendita TEXT NOT NULL, quantita_residua REAL NOT NULL DEFAULT 0,
    note TEXT, created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  );
`);

// ══════════════════════════════════════════════
//  MIGRAZIONI SICURE
// ══════════════════════════════════════════════
const migrations = [
  { test: `SELECT minusvalenze_disponibili FROM portfolios LIMIT 1`,
    fix:  `ALTER TABLE portfolios ADD COLUMN minusvalenze_disponibili REAL DEFAULT 0`,
    desc: 'portfolios.minusvalenze_disponibili' },
  { test: `SELECT quotazione_acquisto FROM vendite LIMIT 1`,
    fix:  `ALTER TABLE vendite ADD COLUMN quotazione_acquisto REAL NOT NULL DEFAULT 0`,
    desc: 'vendite.quotazione_acquisto' },
  { test: `SELECT quantita_residua FROM vendite LIMIT 1`,
    fix:  `ALTER TABLE vendite ADD COLUMN quantita_residua REAL NOT NULL DEFAULT 0`,
    desc: 'vendite.quantita_residua' },
  { test: `SELECT note FROM vendite LIMIT 1`,
    fix:  `ALTER TABLE vendite ADD COLUMN note TEXT`, desc: 'vendite.note' },
  { test: `SELECT usata FROM minusvalenze_manuali LIMIT 1`,
    fix:  `ALTER TABLE minusvalenze_manuali ADD COLUMN usata INTEGER DEFAULT 0`,
    desc: 'minusvalenze_manuali.usata' },
  { test: `SELECT condivisa FROM minusvalenze_manuali LIMIT 1`,
    fix:  `ALTER TABLE minusvalenze_manuali ADD COLUMN condivisa INTEGER DEFAULT 1`,
    desc: 'minusvalenze_manuali.condivisa (condivisa tra portafogli)' },
];

for (const { test, fix, desc } of migrations) {
  try { db.prepare(test).get(); }
  catch { try { db.exec(fix); console.log(`✓ Migrazione: ${desc}`); } catch (e) { console.error(`✗ ${desc}:`, e.message); } }
}

// Backfill quotazione_acquisto (prima del riallineamento saldi)
try {
  const venditeZero = db.prepare("SELECT id, portfolio_id, isin FROM vendite WHERE quotazione_acquisto = 0 OR quotazione_acquisto IS NULL").all();
  let n = 0;
  for (const v of venditeZero) {
    const acq = db.prepare("SELECT quotazione_acquisto FROM acquisti WHERE portfolio_id=? AND isin=?").get(v.portfolio_id, v.isin);
    if (acq?.quotazione_acquisto > 0) { db.prepare("UPDATE vendite SET quotazione_acquisto=? WHERE id=?").run(acq.quotazione_acquisto, v.id); n++; }
  }
  if (n > 0) console.log(`✓ Backfill quotazione_acquisto: ${n} vendite`);
} catch (e) { console.error('✗ Backfill:', e.message); }

// Ricalcola saldi minusvalenze
try {
  db.transaction(() => {
    for (const { id } of db.prepare('SELECT id FROM portfolios').all()) {
      const { tot } = db.prepare(`SELECT COALESCE(SUM(importo),0) AS tot FROM minusvalenze_manuali WHERE portfolio_id=? AND (data_scadenza IS NULL OR data_scadenza>=date('now'))`).get(id);
      let saldo = tot || 0;
      for (const v of db.prepare(`SELECT quotazione_vendita, quotazione_acquisto, quantita FROM vendite WHERE portfolio_id=? ORDER BY data_vendita ASC, created_at ASC`).all(id)) {
        const pl = (v.quotazione_vendita - (v.quotazione_acquisto || 0)) * v.quantita;
        if (pl > 0) saldo = Math.max(0, saldo - pl); else saldo += Math.abs(pl);
      }
      db.prepare('UPDATE portfolios SET minusvalenze_disponibili=? WHERE id=?').run(parseFloat(saldo.toFixed(2)), id);
    }
    console.log('✓ Saldi minusvalenze ricalcolati');
  })();
} catch (e) { console.error('✗ Ricalcolo saldi:', e.message); }

// Seed utente demo
const demoUser = db.prepare('SELECT id FROM users WHERE username = ?').get('demo');
if (!demoUser) {
  db.prepare('INSERT INTO users (id, username, password, email) VALUES (?, ?, ?, ?)').run('u1', 'demo', bcrypt.hashSync('demo123', 10), 'demo@email.com');
  console.log('✓ Utente demo creato');
}
console.log(`✓ Database SQLite pronto: ${DB_PATH}`);

// ══════════════════════════════════════════════
//  ROUTES — mount
// ══════════════════════════════════════════════
const { fetchETF, ETF_INFO_MAP } = require('./routes/etf');

app.use('/api/auth',         require('./routes/auth')(db));
app.use('/api/portfolios',   require('./routes/portfolios')(db));
app.use('/api/portfolios',   require('./routes/vendite')(db));
app.use('/api/etf',          require('./routes/etf')(db));
app.use('/api/etf-catalog',  require('./routes/catalog')(db, fetchETF));
app.use('/api/ai',           require('./routes/ai')(db, fetchETF, ETF_INFO_MAP));
app.use('/api/reports',      require('./routes/reports')(db));

// Rotte admin/health standalone
app.get('/api/health', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const ports = db.prepare('SELECT COUNT(*) as c FROM portfolios').get().c;
  res.json({ status: 'ok', db: 'sqlite', users, portfolios: ports, timestamp: new Date().toISOString() });
});
app.post('/api/admin/cleanup-prezzi', (req, res) => {
  try { const r = db.prepare('DELETE FROM prezzi_storici WHERE prezzo IS NULL OR prezzo <= 0').run(); res.json({ ok: true, rimossi: r.changes }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/test', async (req, res) => {
  try {
    const axios = require('axios');
    const { data } = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/IWDA.AS?interval=1d&range=1y', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    res.json({ prezzo: data?.chart?.result?.[0]?.meta?.regularMarketPrice });
  } catch (e) { res.json({ errore: e.message }); }
});

// ── Scheduler aggiornamento prezzi 18:00 ──────────────────────────────────
const { schedulaAggiornamento18 } = require('./routes/catalog');
schedulaAggiornamento18(db, fetchETF);

// ── Serve frontend build (produzione) ─────────────────────────────────────
const distPath = path.resolve(__dirname, process.env.STATIC_PATH || '/app/etf-app/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  console.log(`📦 Frontend servito da: ${distPath}`);
}

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 ETF Server avviato su http://localhost:${PORT}`);
  console.log(`🗄️  Database: ${DB_PATH}`);
  console.log(`📊 Auth:      /api/auth/*`);
  console.log(`📁 Portfolio: /api/portfolios/*`);
  console.log(`📈 ETF:       /api/etf/* · /api/etf-catalog/*`);
  console.log(`🤖 AI:        /api/ai/*`);
  console.log(`📋 Reports:   /api/reports/*\n`);
});

setInterval(() => {}, 1000 * 60 * 60);
