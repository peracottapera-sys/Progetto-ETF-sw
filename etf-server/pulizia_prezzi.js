// Pulisce prezzi_storici: rimuove prezzi 0, NULL, e outlier evidenti
const Database = require('better-sqlite3');
const db = new Database('etf_app.db');

// Mostra stato prima
const prima = db.prepare('SELECT COUNT(*) as c FROM prezzi_storici').get();
console.log('PRIMA — prezzi_storici:', prima.c, 'righe totali');

// Rimuovi prezzi nulli o zero
const r1 = db.prepare('DELETE FROM prezzi_storici WHERE prezzo IS NULL OR prezzo <= 0').run();
console.log('Rimossi prezzi NULL/zero:', r1.changes);

// Mostra cosa rimane per ogni ISIN
const rows = db.prepare('SELECT isin, COUNT(*) as n, MAX(prezzo) as max_p, MIN(prezzo) as min_p, MAX(data) as ultima FROM prezzi_storici GROUP BY isin ORDER BY ultima DESC').all();
console.log('\nPrezzi storici rimasti per ISIN:');
rows.forEach(r => {
  console.log(`  ${r.isin}: ${r.n} righe | ultimo=${r.ultima} | prezzo min=${r.min_p} max=${r.max_p}`);
});

console.log('\nDone. Righe totali rimaste:', db.prepare('SELECT COUNT(*) as c FROM prezzi_storici').get().c);
db.close();
