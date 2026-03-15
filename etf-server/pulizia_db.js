const Database = require('better-sqlite3');
const db = new Database('etf_app.db');
const r1 = db.prepare('DELETE FROM portfolio_etf').run();
const r2 = db.prepare('DELETE FROM acquisti').run();
console.log('portfolio_etf: cancellate', r1.changes, 'righe');
console.log('acquisti: cancellate', r2.changes, 'righe');
console.log('DB pulito OK');
db.close();
