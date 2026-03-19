/**
 * macro.js — Contesto macroeconomico per il motore AI
 * Fonti: FRED API (Fed/inflazione USA), BCE API (tassi EU), Yahoo Finance (VIX, S&P, Treasury 10Y)
 * Cache in memoria: refresh ogni 6 ore
 */

const axios = require('axios');

const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

// ── Cache ──────────────────────────────────────────────────────────────────
let cache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ore

// ── Fetch Yahoo Finance (VIX, S&P500, Treasury 10Y) ───────────────────────
async function fetchYahoo(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 8000 });
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const prezzo = result.meta?.regularMarketPrice;
    const closes = result.indicators?.quote?.[0]?.close?.filter(c => c != null) || [];
    const perf1m = closes.length >= 22
      ? parseFloat(((prezzo - closes[Math.max(0, closes.length - 22)]) / closes[Math.max(0, closes.length - 22)] * 100).toFixed(2))
      : null;
    return { prezzo: parseFloat(prezzo?.toFixed(2)), perf1m };
  } catch {
    return null;
  }
}

// ── Fetch FRED API (dati Fed e inflazione USA) ─────────────────────────────
async function fetchFRED(seriesId) {
  try {
    // FRED API pubblica senza key — usa il endpoint observation
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 8000 });
    const lines = data.trim().split('\n').filter(l => !l.startsWith('DATE'));
    const last = lines[lines.length - 1]?.split(',');
    if (!last || last.length < 2 || last[1] === '.') return null;
    return { data: last[0], valore: parseFloat(last[1]) };
  } catch {
    return null;
  }
}

// ── Fetch BCE API (tasso BCE) ──────────────────────────────────────────────
async function fetchBCE() {
  try {
    // ECB Data Portal — tasso sui depositi (DFR)
    const url = 'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?lastNObservations=1&format=jsondata';
    const { data } = await axios.get(url, { headers: { ...HEADERS, Accept: 'application/json' }, timeout: 8000 });
    const obs = data?.dataSets?.[0]?.series?.['0:0:0:0:0:0:0']?.observations;
    if (!obs) return null;
    const keys = Object.keys(obs).sort((a, b) => parseInt(b) - parseInt(a));
    const valore = obs[keys[0]]?.[0];
    return valore != null ? parseFloat(valore.toFixed(2)) : null;
  } catch {
    return null;
  }
}

// ── Interpreta il livello VIX ──────────────────────────────────────────────
function interpretaVIX(vix) {
  if (!vix) return 'N/D';
  if (vix < 15) return 'BASSO — mercati molto calmi, bassa volatilità attesa';
  if (vix < 20) return 'MODERATO — condizioni normali';
  if (vix < 25) return 'ELEVATO — attenzione, nervosismo sui mercati';
  if (vix < 35) return 'ALTO — volatilità significativa, cautela raccomandata';
  return 'MOLTO ALTO — stress di mercato, massima cautela';
}

// ── Interpreta il tasso BCE ────────────────────────────────────────────────
function interpretaBCE(tasso) {
  if (!tasso) return '';
  if (tasso >= 3.5) return 'tassi ancora restrittivi → obbligazionario breve durata preferibile per profilo Prudente';
  if (tasso >= 2.0) return 'tassi in normalizzazione → contesto favorevole per obbligazionario medio termine';
  return 'tassi accomodanti → favorisce azionario e obbligazionario lunga durata';
}

// ── Interpreta inflazione EU ───────────────────────────────────────────────
function interpretaInflazione(cpi, target = 2.0) {
  if (!cpi) return '';
  const diff = cpi - target;
  if (diff > 1.5) return `inflazione ${cpi}% sopra target BCE (${target}%) → rischio per obbligazionario reale`;
  if (diff > 0.5) return `inflazione ${cpi}% leggermente sopra target → BCE potrebbe mantenere tassi alti`;
  if (diff > -0.5) return `inflazione ${cpi}% vicina al target BCE → contesto stabile`;
  return `inflazione ${cpi}% sotto target BCE → possibili tagli tassi in vista`;
}

// ── Genera implicazioni per profilo ───────────────────────────────────────
function generaImplicazioni(dati) {
  const impl = [];
  const { vix, bce, inflEU, treasury10y } = dati;

  if (vix > 30) {
    impl.push('Prudente: VIX elevato → considera aumentare liquidità e obbligazionario breve');
    impl.push('Bilanciato: VIX elevato → riduci esposizione azionaria tattica');
    impl.push('Aggressivo: VIX elevato → opportunità di acquisto per orizzonti lunghi');
  } else if (vix > 20) {
    impl.push('Prudente: volatilità in aumento → mantieni hedging valutario');
    impl.push('Aggressivo: volatilità moderata → finestra di attenzione, non aggressività massima');
  } else {
    impl.push('Tutti i profili: VIX basso → condizioni favorevoli per esposizione azionaria');
  }

  if (bce >= 3.0) {
    impl.push('Prudente/Bilanciato: tassi BCE alti → obbligazionario breve durata (1-3y) preferibile al lungo');
  } else if (bce < 2.0) {
    impl.push('Tutti i profili: tassi BCE bassi → durata obbligazionaria più lunga diventa interessante');
  }

  if (treasury10y > 4.5) {
    impl.push('Profili con USD: Treasury 10Y > 4.5% → valuta opportunità obbligazionario USA ma attenzione rischio cambio');
  }

  return impl;
}

// ── Funzione principale: fetcha e caccha il contesto macro ─────────────────
async function getMacroContext() {
  const ora = Date.now();
  if (cache && (ora - cacheTimestamp) < CACHE_TTL_MS) {
    console.log('[macro] Cache hit');
    return cache;
  }

  console.log('[macro] Fetching dati macroeconomici...');
  const oggi = new Date().toLocaleDateString('it-IT');

  // Fetch in parallelo
  const [vixData, sp500Data, treasury10yData, fedFundsData, cpiUSAData, cpiEUData, tasoBCE] = await Promise.allSettled([
    fetchYahoo('^VIX'),
    fetchYahoo('^GSPC'),
    fetchYahoo('^TNX'),
    fetchFRED('FEDFUNDS'),     // Fed Funds Rate
    fetchFRED('CPIAUCSL'),     // CPI USA
    fetchFRED('CP0000EZ17M086NEST'), // HICP EU
    fetchBCE(),
  ]);

  const vix = vixData.status === 'fulfilled' ? vixData.value?.prezzo : null;
  const sp500 = sp500Data.status === 'fulfilled' ? sp500Data.value : null;
  const treasury10y = treasury10yData.status === 'fulfilled' ? treasury10yData.value?.prezzo : null;
  const fedFunds = fedFundsData.status === 'fulfilled' ? fedFundsData.value?.valore : null;
  const cpiUSA = cpiUSAData.status === 'fulfilled' ? cpiUSAData.value?.valore : null;
  const inflEU = cpiEUData.status === 'fulfilled' ? cpiEUData.value?.valore : null;
  const bce = tasoBCE.status === 'fulfilled' ? tasoBCE.value : null;

  const dati = { vix, sp500: sp500?.prezzo, sp500Perf1m: sp500?.perf1m, treasury10y, fedFunds, cpiUSA, inflEU, bce };
  const implicazioni = generaImplicazioni(dati);

  // Costruisci stringa macroContext
  const lines = [
    `## CONTESTO MACRO AGGIORNATO (${oggi}):`,
    fedFunds != null ? `- Tasso Fed (Fed Funds Rate): ${fedFunds}%` : null,
    bce != null ? `- Tasso BCE (Deposit Facility): ${bce}%` : null,
    cpiUSA != null ? `- Inflazione USA (CPI): ${cpiUSA}% YoY` : null,
    inflEU != null ? `- Inflazione EU (HICP): ${inflEU}% YoY` : null,
    vix != null ? `- VIX (volatilità S&P500): ${vix} — ${interpretaVIX(vix)}` : null,
    sp500 != null ? `- S&P500: ${sp500.prezzo?.toLocaleString('it-IT')} (perf 1M: ${sp500.perf1m != null ? sp500.perf1m + '%' : 'N/D'})` : null,
    treasury10y != null ? `- Treasury USA 10Y: ${treasury10y}%` : null,
    bce != null ? `- Implicazione tassi BCE: ${interpretaBCE(bce)}` : null,
    inflEU != null ? `- Implicazione inflazione EU: ${interpretaInflazione(inflEU)}` : null,
    '',
    '## IMPLICAZIONI PER PROFILO DI RISCHIO:',
    ...implicazioni.map(i => `- ${i}`),
  ].filter(l => l !== null);

  const macroContext = lines.join('\n');

  console.log('[macro] Contesto generato:');
  console.log(macroContext);

  cache = macroContext;
  cacheTimestamp = ora;
  return macroContext;
}

module.exports = { getMacroContext };

// ── Esporta anche i dati strutturati per il pannello frontend ──────────────
async function getMacroDati() {
  const ora = Date.now();
  if (cache && (ora - cacheTimestamp) < CACHE_TTL_MS) {
    return { testo: cache, dati: cacheDati };
  }

  const [vixData, sp500Data, treasury10yData, fedFundsData, cpiUSAData, cpiEUData, tasoBCE] = await Promise.allSettled([
    fetchYahoo('^VIX'),
    fetchYahoo('^GSPC'),
    fetchYahoo('^TNX'),
    fetchFRED('FEDFUNDS'),
    fetchFRED('CPIAUCSL'),
    fetchFRED('CP0000EZ17M086NEST'),
    fetchBCE(),
  ]);

  const vix = vixData.status === 'fulfilled' ? vixData.value?.prezzo : null;
  const sp500 = sp500Data.status === 'fulfilled' ? sp500Data.value : null;
  const treasury10y = treasury10yData.status === 'fulfilled' ? treasury10yData.value?.prezzo : null;
  const fedFunds = fedFundsData.status === 'fulfilled' ? fedFundsData.value?.valore : null;
  const cpiUSA = cpiUSAData.status === 'fulfilled' ? cpiUSAData.value?.valore : null;
  const inflEU = cpiEUData.status === 'fulfilled' ? cpiEUData.value?.valore : null;
  const bce = tasoBCE.status === 'fulfilled' ? tasoBCE.value : null;

  const dati = {
    vix, sp500: sp500?.prezzo, sp500Perf1m: sp500?.perf1m,
    treasury10y, fedFunds, cpiUSA, inflEU, bce,
    vixLabel: interpretaVIX(vix),
    implicazioni: generaImplicazioni({ vix, bce, inflEU, treasury10y }),
    aggiornato: new Date().toISOString(),
  };

  const testo = await getMacroContext();
  cacheDati = dati;
  return { testo, dati };
}

let cacheDati = null;
module.exports = { getMacroContext, getMacroDati };
