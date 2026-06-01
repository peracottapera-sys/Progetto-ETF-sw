/**
 * macro.js — Contesto macroeconomico per il motore AI
 * Fonti: FRED API, BCE API, Yahoo Finance
 * Cache in memoria: refresh ogni 6 ore
 */

const axios = require('axios');
const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

// ── Dati statici paesi (Trading Economics, aggiornare mensilmente) ─────────
// Ultimo aggiornamento: marzo 2026
const PAESI_MACRO = [
  // paese, pil(mld$), crescita%, tasso%, inflazione%, disoccupazione%, debito/PIL%, bilancio%, contoCorrente%
  { paese: 'Stati Uniti',  pil: 29185, crescita: 0.7,  tasso: 3.75, inflazione: 2.4,  disoccupazione: 4.4,  debito: 124.3, bilancio: -6.4,  cc: -3.9  },
  { paese: 'Cina',         pil: 18744, crescita: 1.2,  tasso: 3.0,  inflazione: 1.3,  disoccupazione: 5.3,  debito: 88.3,  bilancio: -6.5,  cc: 2.2   },
  { paese: 'Area Euro',    pil: 16406, crescita: 0.2,  tasso: 2.15, inflazione: 1.9,  disoccupazione: 6.1,  debito: 87.1,  bilancio: -3.1,  cc: 1.6   },
  { paese: 'Germania',     pil: 4660,  crescita: 0.3,  tasso: 2.15, inflazione: 1.9,  disoccupazione: 6.3,  debito: 62.2,  bilancio: -2.7,  cc: 5.8   },
  { paese: 'Giappone',     pil: 4026,  crescita: 0.3,  tasso: 0.75, inflazione: 1.5,  disoccupazione: 2.7,  debito: 236.7, bilancio: -2.3,  cc: 4.7   },
  { paese: 'India',        pil: 3913,  crescita: 2.0,  tasso: 5.25, inflazione: 3.21, disoccupazione: 4.9,  debito: 81.92, bilancio: -4.8,  cc: -0.6  },
  { paese: 'Regno Unito',  pil: 3644,  crescita: 0.1,  tasso: 3.75, inflazione: 3.0,  disoccupazione: 5.2,  debito: 93.6,  bilancio: -5.2,  cc: -2.2  },
  { paese: 'Francia',      pil: 3162,  crescita: 0.2,  tasso: 2.15, inflazione: 0.9,  disoccupazione: 7.9,  debito: 113.0, bilancio: -5.8,  cc: 0.1   },
  { paese: 'Italia',       pil: 2373,  crescita: 0.3,  tasso: 2.15, inflazione: 1.5,  disoccupazione: 5.1,  debito: 137.1, bilancio: -3.1,  cc: 1.2   },
  { paese: 'Brasile',       pil: 2179,  crescita: 0.1,  tasso: 14.75,inflazione: 3.81, disoccupazione: 5.4,  debito: 76.5,  bilancio: -8.5,  cc: -3.02 },
  { paese: 'Canada',        pil: 2241,  crescita: -0.2, tasso: 2.25, inflazione: 1.8,  disoccupazione: 6.7,  debito: 110.8, bilancio: -1.2,  cc: -1.4  },
  { paese: 'Corea del Sud', pil: 1917,  crescita: -0.2, tasso: 2.5,  inflazione: 2.0,  disoccupazione: 2.9,  debito: 46.8,  bilancio: -3.9,  cc: 5.3   },
  { paese: 'Australia',     pil: 1752,  crescita: 0.8,  tasso: 4.1,  inflazione: 3.8,  disoccupazione: 4.3,  debito: 43.8,  bilancio: 0.6,   cc: -2.9  },
  { paese: 'Spagna',        pil: 1723,  crescita: 0.8,  tasso: 2.15, inflazione: 2.3,  disoccupazione: 9.93, debito: 101.8, bilancio: -3.2,  cc: 3.2   },
  { paese: 'Svizzera',      pil: 937,   crescita: 0.2,  tasso: 0.0,  inflazione: 0.1,  disoccupazione: 3.2,  debito: 15.5,  bilancio: -0.1,  cc: 5.1   },
  { paese: 'Norvegia',      pil: 484,   crescita: -0.3, tasso: 4.0,  inflazione: 2.7,  disoccupazione: 4.6,  debito: 55.1,  bilancio: 13.2,  cc: 14.2  },
];

// Fallback statici (Trading Economics + fonti ufficiali, aggiornare mensilmente)
// Usati se le API non rispondono dal container Railway
const INFL_EU_FALLBACK   = 1.9;   // HICP Area Euro, feb 2026
const FED_FUNDS_FALLBACK = 3.5;   // Fed Funds lower limit, marzo 2026
const BUND_10Y_FALLBACK  = 2.80;  // Bund 10Y, mar 2026
const BTP_10Y_FALLBACK   = 3.63;  // BTP 10Y, mar 2026 → spread ~83 pb
const CPI_USA_FALLBACK   = 2.8;   // CPI USA YoY, feb 2026

let cache = null;
let cacheDati = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchYahoo(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=400d`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const closes = result.indicators?.quote?.[0]?.close || [];
    const timestamps = result.timestamp || [];
    const validi = closes.map((c, i) => ({ c, t: timestamps[i] })).filter(x => x.c != null);
    if (validi.length < 2) return null;
    const prezzo = parseFloat((meta.regularMarketPrice || validi[validi.length - 1].c).toFixed(4));
    const l = validi.length;
    const perf1d = l >= 2 ? parseFloat(((prezzo - validi[l-2].c) / validi[l-2].c * 100).toFixed(2)) : null;
    const perf1m = l >= 22 ? parseFloat(((prezzo - validi[l-22].c) / validi[l-22].c * 100).toFixed(2)) : null;
    return { prezzo, perf1d, perf1m };
  } catch (e) {
    console.error(`[macro] Errore Yahoo ${ticker}:`, e.message);
    return null;
  }
}

// Fetch FRED — valore puntuale (tassi, rendimenti)
async function fetchFREDLast(seriesId) {
  try {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    // Non filtrare per '.': i valori decimali sono validi!
    const lines = data.trim().split('\n').filter(l => !l.startsWith('DATE') && l.trim() !== '' && !l.includes('NA'));
    if (!lines.length) return null;
    const last = lines[lines.length - 1].split(',');
    const valore = parseFloat(last[1]);
    if (isNaN(valore)) return null;
    return { data: last[0], valore: parseFloat(valore.toFixed(3)) };
  } catch (e) {
    console.error(`[macro] Errore FRED ${seriesId}:`, e.message);
    return null;
  }
}

// Fetch FRED — YoY calcolato correttamente (per inflazione)
async function fetchFREDYoY(seriesId) {
  try {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    const lines = data.trim().split('\n').filter(l => !l.startsWith('DATE') && l.trim() !== '' && !l.includes('NA'));
    if (lines.length < 13) return null;
    const parseLine = l => { const p = l.split(','); return parseFloat(p[1]); };
    const valoreAttuale = parseLine(lines[lines.length - 1]);
    const valore12mFa = parseLine(lines[lines.length - 13]);
    if (isNaN(valoreAttuale) || isNaN(valore12mFa) || valore12mFa === 0) return null;
    const yoy = parseFloat(((valoreAttuale - valore12mFa) / valore12mFa * 100).toFixed(2));
    const dataStr = lines[lines.length - 1].split(',')[0];
    return { data: dataStr, valore: valoreAttuale, yoy };
  } catch (e) {
    console.error(`[macro] Errore FRED YoY ${seriesId}:`, e.message);
    return null;
  }
}

async function fetchBCE() {
  try {
    const url = 'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?lastNObservations=1&format=jsondata';
    const { data } = await axios.get(url, { headers: { ...HEADERS, Accept: 'application/json' }, timeout: 10000 });
    const obs = data?.dataSets?.[0]?.series?.['0:0:0:0:0:0:0']?.observations;
    if (!obs) return null;
    const keys = Object.keys(obs).sort((a, b) => parseInt(b) - parseInt(a));
    const valore = obs[keys[0]]?.[0];
    return valore != null ? parseFloat(valore.toFixed(2)) : null;
  } catch (e) {
    console.error('[macro] Errore BCE:', e.message);
    return null;
  }
}

function stimaPoliticaMonetaria(tasso, inflazione, target = 2.0, banca = 'BCE', brent = null) {
  if (tasso == null || inflazione == null) return null;
  const diff = inflazione - target;
  const tassoReale = parseFloat((tasso - inflazione).toFixed(2));
  const petrolioCaldo = brent != null && brent > 95; // petrolio alto = rischio inflazione secondaria
  let outlook, dettaglio, avvertenza = null;

  if (diff > 1.5 && tasso > 3.0) {
    outlook = 'STABILE o RIALZO';
    dettaglio = `Inflazione ${inflazione}% sopra target (${target}%) → ${banca} in modalità wait-and-see`;
  } else if (diff > 0.5) {
    outlook = 'STABILE';
    dettaglio = `Inflazione sopra target → pausa probabile, tagli lontani`;
  } else if (diff > -0.5 && tasso > 2.0) {
    if (petrolioCaldo) {
      outlook = 'STABILE — tagli rinviati';
      dettaglio = `Inflazione vicina al target ma petrolio a $${brent} → rischio inflazione secondaria frena ${banca}`;
      avvertenza = `Brent $${brent} sopra $95 → tagli tassi meno probabili nel breve`;
    } else {
      outlook = 'TAGLIO nei prossimi 6-12 mesi';
      dettaglio = `Inflazione vicina al target → ${banca} può iniziare ciclo di allentamento`;
    }
  } else if (tasso > 1.0) {
    if (petrolioCaldo) {
      outlook = 'CAUTO — petrolio frena tagli';
      dettaglio = `Inflazione sotto target ma petrolio elevato ($${brent}) → ${banca} procede con cautela`;
    } else {
      outlook = 'TAGLI probabili';
      dettaglio = `Inflazione sotto target → ${banca} ha margine per tagliare`;
    }
  } else {
    outlook = 'TASSI BASSI';
    dettaglio = `Tassi già minimi, politica accomodante`;
  }
  return { outlook, dettaglio, tassoReale, avvertenza };
}

function interpretaVIX(vix) {
  if (!vix) return 'N/D';
  if (vix < 15) return 'BASSO — mercati calmi';
  if (vix < 20) return 'Moderato — condizioni normali';
  if (vix < 25) return 'Moderato-alto — attenzione';
  if (vix < 35) return 'ALTO — volatilità significativa';
  return 'MOLTO ALTO — stress di mercato';
}

function interpretaCurva(spread) {
  if (spread == null) return null;
  if (spread < -0.5) return { label: 'INVERTITA', colore: 'red', desc: 'Segnale storico di recessione' };
  if (spread < 0) return { label: 'Piatta/invertita', colore: 'orange', desc: 'Attenzione rallentamento' };
  if (spread < 0.5) return { label: 'Piatta', colore: 'amber', desc: 'Incertezza ciclo economico' };
  return { label: 'Normale', colore: 'green', desc: 'Curva sana, crescita attesa' };
}

function generaImplicazioni(dati) {
  const { vix, bce, inflEU, inflUSA, treasury10y, treasury5y, bund10y, btpBundSpread, eurusd } = dati;
  const impl = [];
  if (vix > 30) {
    impl.push('Prudente: VIX elevato → aumenta liquidità, riduci duration obbligazionaria');
    impl.push('Bilanciato: VIX elevato → riduci esposizione azionaria tattica');
    impl.push('Aggressivo: VIX elevato → opportunità per orizzonti >5 anni');
  } else if (vix > 22) {
    impl.push('Tutti i profili: volatilità in aumento → mantieni hedging valutario');
  } else if (vix) {
    impl.push('Tutti i profili: VIX contenuto → condizioni favorevoli per azionario');
  }
  if (bce >= 3.0) impl.push('Prudente/Bilanciato: BCE restrittiva → obbligazionario breve (1-3y) preferibile');
  else if (bce != null && bce < 1.5) impl.push('Tutti i profili: BCE accomodante → lunga duration favorita');
  if (inflEU > 3.0) impl.push('Prudente: inflazione EU alta → considera ETF inflation-linked');
  else if (inflEU != null && inflEU < 1.5) impl.push('Bilanciato/Aggressivo: inflazione bassa → ETF obbligazionario a tasso fisso preferito a inflation-linked');
  if (treasury10y != null && treasury5y != null && (treasury10y - treasury5y) < 0) {
    impl.push('Curva USA invertita → segnale storico di recessione, riduci ciclici');
  }
  if (btpBundSpread != null && btpBundSpread > 200) {
    impl.push(`Spread BTP-Bund ${btpBundSpread} pb → rischio Italia elevato, attenzione obbligazionario IT`);
  }
  if (eurusd != null && eurusd < 1.05) {
    impl.push('EUR/USD debole (USD forte) → ETF in USD non hedged rendono di più in EUR, hedging meno urgente');
  } else if (eurusd != null && eurusd > 1.15) {
    impl.push('EUR forte (USD debole) → ETF in USD non hedged perdono valore in EUR, hedging preferibile');
  }
  const { brent } = dati;
  if (brent != null && brent > 100) impl.push(`Brent $${brent} → petrolio alto, rischio inflazione secondaria, cautela su tagli tassi`);
  else if (brent != null && brent < 60) impl.push(`Brent $${brent} → petrolio basso, deflazione importata, favorisce tagli tassi`);
  return impl;
}

async function getMacroDati() {
  const ora = Date.now();
  if (cache && cacheDati && (ora - cacheTimestamp) < CACHE_TTL_MS) {
    console.log('[macro] Cache hit');
    return { testo: cache, dati: cacheDati };
  }

  console.log('[macro] Fetching dati macroeconomici...');
  const oggi = new Date().toLocaleDateString('it-IT');

  // Fetch in parallelo
  const [vixR, sp500R, t10yR, t5yR, eurusdR, goldR, brentR, stoxx50R, fedR, cpiUSAR, cpiEUYoYR, cpiEUMoMR, bceR, btpR, bundR] =
    await Promise.allSettled([
      fetchYahoo('^VIX'),
      fetchYahoo('^GSPC'),
      fetchYahoo('^TNX'),           // Treasury 10Y
      fetchYahoo('^FVX'),           // Treasury 5Y
      fetchYahoo('EURUSD=X'),
      fetchYahoo('GC=F'),           // Oro futures
      fetchYahoo('BZ=F'),           // Brent crude
      fetchYahoo('^STOXX50E'),      // Euro Stoxx 50
      fetchFREDLast('DFEDTARL'),    // Fed Funds Lower Limit (daily)
      fetchFREDYoY('CPIAUCSL'),     // CPI USA YoY (calcolato)
      fetchFREDYoY('CP0000EZ19M086NEST'), // HICP EU YoY (calcolato da indice Eurostat)
      fetchFREDLast('CPALTT01USM657N'), // CPI USA MoM (% change, già calcolato da FRED)
      fetchBCE(),
      fetchFREDLast('IRLTLT01ITM156N'), // BTP 10Y
      fetchFREDLast('IRLTLT01DEM156N'), // Bund 10Y
    ]);

  const vix = vixR.value?.prezzo ?? null;
  const sp500 = sp500R.value ?? null;
  const treasury10y = t10yR.value?.prezzo ?? null;
  const treasury5y = t5yR.value?.prezzo ?? null;
  const eurusd = eurusdR.value?.prezzo ?? null;
  const gold = goldR.value ?? null;
  const brent = brentR.value ?? null;
  const stoxx50 = stoxx50R.value ?? null;
  const fedFunds = fedR.value?.valore ?? FED_FUNDS_FALLBACK;
  const fedFundsSource = fedR.value?.valore != null ? 'FRED' : 'statico';
  const cpiUSA = cpiUSAR.value?.yoy ?? CPI_USA_FALLBACK;
  const cpiUSASource = cpiUSAR.value?.yoy != null ? 'FRED' : 'statico';
  // HICP EU: serie FRED, fallback a dato statico Trading Economics se null
  const inflEU = cpiEUYoYR.value?.yoy ?? INFL_EU_FALLBACK;
  const inflEUSource = cpiEUYoYR.value?.yoy != null ? 'FRED' : 'Trading Economics (statico)';
  // CPI USA MoM: serie FRED già in formato % change mensile
  const cpiUSAMoM = cpiEUMoMR.value?.valore ?? null;
  const bce = bceR.value ?? null;
  const btp10y = btpR.value?.valore ?? BTP_10Y_FALLBACK;
  const bund10y = bundR.value?.valore ?? BUND_10Y_FALLBACK;
  const bundSource = bundR.value?.valore != null ? 'FRED' : 'statico';
  // Spread in punti base (1% = 100 pb)
  const btpBundSpreadPct = (btp10y != null && bund10y != null)
    ? parseFloat((btp10y - bund10y).toFixed(3)) : null;
  const btpBundSpread = btpBundSpreadPct != null
    ? Math.round(btpBundSpreadPct * 100) : null; // in punti base

  const curvaUSA = (treasury10y != null && treasury5y != null)
    ? parseFloat((treasury10y - treasury5y).toFixed(2)) : null;
  const curvaInfo = interpretaCurva(curvaUSA);
  const stimaBCE = stimaPoliticaMonetaria(bce, inflEU, 2.0, 'BCE', brent?.prezzo);
  const stimaFed = stimaPoliticaMonetaria(fedFunds, cpiUSA, 2.0, 'Fed', brent?.prezzo);

  const dati = {
    vix, vixLabel: interpretaVIX(vix),
    sp500: sp500?.prezzo, sp500Perf1d: sp500?.perf1d, sp500Perf1m: sp500?.perf1m,
    treasury10y, treasury5y, curvaUSA, curvaInfo,
    eurusd, eurusdPerf1m: eurusdR.value?.perf1m ?? null,
    gold: gold?.prezzo, goldPerf1m: gold?.perf1m,
    stoxx50: stoxx50?.prezzo, stoxx50Perf1d: stoxx50?.perf1d, stoxx50Perf1m: stoxx50?.perf1m,
    bund10y, btp10y, btpBundSpread, btpBundSpreadPct,
    brent: brent?.prezzo, brentPerf1m: brent?.perf1m,
    fedFunds, cpiUSA, cpiUSAMoM, inflEU, inflEUSource, bce,
    stimaBCE, stimaFed,
    paesiMacro: PAESI_MACRO,
    implicazioni: generaImplicazioni({ vix, bce, inflEU, inflUSA: cpiUSA, treasury10y, treasury5y, bund10y, btpBundSpread, eurusd, brent: brent?.prezzo }),
    aggiornato: new Date().toISOString(),
  };

  console.log('[macro] Dati raccolti:', JSON.stringify({
    vix, treasury10y, fedFunds, cpiUSA, inflEU, bce, bund10y, btp10y, btpBundSpread
  }));

  const lines = [
    `## CONTESTO MACRO AGGIORNATO (${oggi}):`,
    fedFunds != null ? `- Tasso Fed (target lower): ${fedFunds}%` : null,
    bce != null ? `- Tasso BCE: ${bce}%` : null,
    cpiUSA != null ? `- Inflazione USA (CPI YoY): ${cpiUSA}%` : null,
    cpiUSAMoM != null ? `- Inflazione USA (CPI MoM): ${cpiUSAMoM > 0 ? '+' : ''}${cpiUSAMoM}%` : null,
    inflEU != null ? `- Inflazione EU (HICP YoY): ${inflEU}% (fonte: ${inflEUSource})` : null,
    vix != null ? `- VIX: ${vix} — ${interpretaVIX(vix)}` : null,
    treasury10y != null ? `- Treasury USA 10Y: ${treasury10y}%` : null,
    curvaUSA != null ? `- Curva tassi USA (10Y-5Y): ${curvaUSA}% — ${curvaInfo?.label}` : null,
    eurusd != null ? `- EUR/USD: ${eurusd}` : null,
    gold?.prezzo != null ? `- Oro: $${gold.prezzo}` : null,
    bund10y != null ? `- Bund 10Y: ${bund10y}%` : null,
    btpBundSpread != null ? `- Spread BTP-Bund: ${btpBundSpread} pb` : null,
    brent?.prezzo != null ? `- Petrolio Brent: $${brent.prezzo}` : null,
    stoxx50?.prezzo != null ? `- Euro Stoxx 50: ${stoxx50.prezzo}` : null,
    '',
    stimaBCE ? `## OUTLOOK BCE: ${stimaBCE.outlook}\n${stimaBCE.dettaglio}${stimaBCE.avvertenza ? '\n⚠️ ' + stimaBCE.avvertenza : ''}` : null,
    stimaFed ? `## OUTLOOK FED: ${stimaFed.outlook}\n${stimaFed.dettaglio}${stimaFed.avvertenza ? '\n⚠️ ' + stimaFed.avvertenza : ''}` : null,
    '',
    '## IMPLICAZIONI PER PROFILO:',
    ...dati.implicazioni.map(i => `- ${i}`),
  ].filter(l => l !== null);

  const macroContext = lines.join('\n');
  cache = macroContext;
  cacheDati = dati;
  cacheTimestamp = ora;
  return { testo: macroContext, dati };
}

async function getMacroContext() {
  const { testo } = await getMacroDati();
  return testo;
}

module.exports = { getMacroContext, getMacroDati };
