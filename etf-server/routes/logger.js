/**
 * logger.js — Log centralizzato eventi applicazione
 * Scrive su: console, file /app/logs/app.log, tabella DB app_logs
 */

const fs = require('fs');
const path = require('path');

// ── Configurazione ────────────────────────────────────────────────────────
const LOG_DIR = process.env.LOG_DIR || '/app/logs';
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_LOG_LINES = 5000; // rotazione automatica

// Assicura che la cartella esista
try {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {}

// ── Categorie eventi ──────────────────────────────────────────────────────
const EVENTI = {
  // Autenticazione
  LOGIN:            'LOGIN',
  LOGOUT:           'LOGOUT',
  REGISTER:         'REGISTER',
  // Portafogli
  CREA_PORTAFOGLIO: 'CREA_PORTAFOGLIO',
  ELIMINA_PORTAFOGLIO: 'ELIMINA_PORTAFOGLIO',
  MODIFICA_PORTAFOGLIO: 'MODIFICA_PORTAFOGLIO',
  // Operazioni ETF
  ACQUISTO:         'ACQUISTO',
  VENDITA:          'VENDITA',
  ELIMINA_ACQUISTO: 'ELIMINA_ACQUISTO',
  ANNULLA_VENDITA:  'ANNULLA_VENDITA',
  // AI
  AI_ANALISI:       'AI_ANALISI',
  AI_CREA_PORTAFOGLIO: 'AI_CREA_PORTAFOGLIO',
  AI_APPLICA:       'AI_APPLICA',
  // Prezzi
  AGGIORNA_PREZZI_MANUALE: 'AGGIORNA_PREZZI_MANUALE',
  AGGIORNA_PREZZI_AUTO:    'AGGIORNA_PREZZI_AUTO',
  AGGIORNA_PREZZI_SELETTIVO: 'AGGIORNA_PREZZI_SELETTIVO',
  // Sistema
  SERVER_START:     'SERVER_START',
  SERVER_ERROR:     'SERVER_ERROR',
};

// ── Funzione principale di log ────────────────────────────────────────────
let pool = null;

function setPool(p) { pool = p; }

async function log(evento, dettagli = {}, utente = null) {
  const ts = new Date().toISOString();
  const riga = {
    ts,
    evento,
    utente: utente || dettagli.username || dettagli.userId || '—',
    dettagli: { ...dettagli },
  };

  // 1. Console
  const det = Object.entries(riga.dettagli)
    .filter(([k]) => !['userId','username'].includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`[LOG] ${ts.slice(11,19)} ${evento} | ${riga.utente} | ${det}`);

  // 2. File
  try {
    const linea = JSON.stringify(riga) + '\n';
    fs.appendFileSync(LOG_FILE, linea, 'utf8');

    // Rotazione: se supera MAX_LOG_LINES, taglia le prime 1000
    const contenuto = fs.readFileSync(LOG_FILE, 'utf8');
    const righe = contenuto.split('\n').filter(Boolean);
    if (righe.length > MAX_LOG_LINES) {
      fs.writeFileSync(LOG_FILE, righe.slice(1000).join('\n') + '\n', 'utf8');
    }
  } catch {}

  // 3. DB
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO app_logs (ts, evento, utente, dettagli) VALUES ($1, $2, $3, $4)`,
        [ts, evento, riga.utente, JSON.stringify(riga.dettagli)]
      ).catch(() => {});
    } catch {}
  }

  return riga;
}

// ── Middleware Express: inietta log nelle routes ───────────────────────────
function logMiddleware(evento, getDettagli) {
  return async (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        const det = getDettagli ? getDettagli(req, res) : {};
        log(evento, det, req.user?.username || req.user?.id || null).catch(() => {});
      }
    });
    next();
  };
}

module.exports = { log, setPool, logMiddleware, EVENTI };
