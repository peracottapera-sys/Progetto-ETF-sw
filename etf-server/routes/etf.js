const express = require('express');
const axios   = require('axios');

const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

const ISIN_TICKER_MAP = {
  'IE00B4L5Y983':'IWDA.AS','LU1681041782':'LCUW.DE','IE00B4K48X80':'IESE.MI',
  'LU1681043599':'MEUR.DE','IE00B3F81R35':'IEAG.AS','LU1829218749':'LYTR.DE',
  'IE00B3F81409':'IBCX.AS','LU1829219655':'CRPE.MI','IE00B4L5YC18':'EMIM.AS',
  'LU1681045370':'AEEM.PA','IE00B3FH7618':'IBGS.AS','IE00B4WXJJ64':'IBCI.AS',
  'LU1650490474':'EM13.MI','LU1650491282':'GISG.MI','IE00B3XXRP09':'VWCE.DE',
  'IE00B5BMR087':'CSPX.AS','IE00B4L5YX21':'SPPW.DE','IE0032077012':'EQQQ.MI',
  'IE00BYVJRP78':'XNAS.DE','IE00B4JNQZ49':'QDVE.DE','IE00BFG0R112':'HEAL.MI',
  'IE00B66F4759':'IHYG.MI','IE00BD4DXW77':'XHYA.DE','IE00B3VVMM84':'IUSN.DE',
  'IE00B4ND3602':'SGLD.MI','DE000A1EK0G3':'GLDA.DE','DE000A0S9GB0':'4GLD.DE',
  'IE00BKM4GZ66':'AEME.MI','IE00BGDQ0H97':'ISPY.MI','IE00B53L4350':'IMIB.MI',
  'LU0274212538':'CSMIB.MI','IE00B53QDK08':'IJPN.AS','LU0659580079':'XMAS.DE',
  'IE00B5L8K969':'CSEMAS.MI','IE00B5L01S80':'IPRP.AS','LU0489337690':'XREA.DE',
  'IE00B7LW3080':'XBTP.MI','IE00B3F81K65':'IITB.MI','IE00B14X4S71':'IBTS.AS',
  'IE00B1FZS798':'IBTM.MI','IE00BGPP6599':'IBGL.MI','LU0290358497':'XEON.DE',
  'FR0010510800':'LEONIA.MI','IE00BK5BQT80':'VWCE.DE','IE00B3ZW0K18':'IUES.AS',
  'IE00B441G979':'IWDE.AS','FR0013416716':'GOLD.AS','IE00BJK55C48':'EHYA.MI',
  'IE00BP3QZB59':'IWVL.AS','IE00B53L3W79':'EXW1.DE','LU1781541179':'AMUS.PA',
  'LU1437016972':'LCWD.MI','IE00BJ0KDQ92':'XDWD.DE','IE00BL25JM42':'XDEV.DE',
  'LU0478205379':'XBLC.DE','LU0908500753':'MEUD.PA','IE00B6R52259':'IUSQ.DE',
  'IE00BGSF1X88':'IB01.AS','IE00B3RBWM25':'VWRL.AS','IE00B3YCGJ38':'SPXS.MI',
  'IE0031442068':'CSP1.AS','IE0005042456':'ISF.L','IE00BFMXXD54':'VUSA.AS',
  'IE00BZ043R46':'AGGH.AS','IE00B6YXC331':'SSAC.AS','IE00B44Z5B48':'SPYX.DE',
};

const ETF_INFO_MAP = {
  'IE00B4L5Y983':{q:112.18,a:2009},'IE00B3XXRP09':{q:147.18,a:2012},
  'IE00BK5BQT80':{q:147.18,a:2019},'IE00B4L5YX21':{q:41.00,a:2005},
  'LU1681041782':{q:19.61,a:2018},'IE00B5BMR087':{q:626.23,a:2010},
  'IE00B3ZW0K18':{q:45.79,a:2010},'IE0032077012':{q:524.35,a:2002},
  'IE00B4K48X80':{q:69.50,a:2010},'LU1681043599':{q:110.68,a:2000},
  'IE00B53L3W79':{q:54.20,a:2002},'IE00BKM4GZ66':{q:76.59,a:2014},
  'IE00B4L5YC18':{q:40.82,a:2014},'LU1050469367':{q:15.82,a:2014},
  'LU1829219655':{q:153.92,a:2018},'LU1681045370':{q:6.58,a:2016},
  'IE00B441G979':{q:40.09,a:2014},'IE00BP3QZB59':{q:39.50,a:2014},
  'IE00B3VVMM84':{q:8.05,a:2009},'IE00BGDQ0H97':{q:26.54,a:2015},
  'IE00B4JNQZ49':{q:34.57,a:2016},'IE00BYVJRP78':{q:49.70,a:2018},
  'IE00BFG0R112':{q:7.48,a:2016},'IE00BD4DXW77':{q:23.68,a:2018},
  'IE00B3FH7618':{q:141.90,a:2006},'IE00B4WXJJ64':{q:235.00,a:2008},
  'LU0290358497':{q:148.63,a:2007},'IE00B3F81R35':{q:107.07,a:2009},
  'IE00B3F81409':{q:124.28,a:2003},'IE00B66F4759':{q:91.93,a:2010},
  'IE00BJK55C48':{q:5.12,a:2017},'FR0013416716':{q:47.80,a:2019},
  'IE00B4ND3602':{q:427.75,a:2011},'DE000A1EK0G3':{q:175.96,a:2011},
  'DE000A0S9GB0':{q:142.85,a:2007},'LU1829218749':{q:221.66,a:2018},
  'LU1437016972':{q:12.50,a:2016},'LU0908500753':{q:14.82,a:2013},
  'IE00BJ0KDQ92':{q:82.50,a:2014},'IE00BL25JM42':{q:35.20,a:2013},
  'LU0478205379':{q:162.50,a:2010},'IE00B6R52259':{q:93.40,a:2011},
  'IE00BGSF1X88':{q:103.20,a:2019},'IE00B3RBWM25':{q:118.50,a:2012},
  'IE00B3YCGJ38':{q:47.80,a:2010},'IE0031442068':{q:554.00,a:2002},
  'IE0005042456':{q:38.50,a:2000},
};

async function fetchQuote(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5y&includePrePost=false`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const closes = result.indicators?.quote?.[0]?.close || [];
    const timestamps = result.timestamp || [];
    const validi = closes.map((c, i) => ({ c, t: timestamps[i] })).filter(x => x.c != null);
    if (validi.length < 2) return null;
    const prezzoAttuale = meta.regularMarketPrice || validi[validi.length - 1].c;
    const l = validi.length;
    const perf = (idx) => {
      if (idx < 0 || idx >= l) return null;
      const from = validi[idx].c;
      return from ? parseFloat(((prezzoAttuale - from) / from * 100).toFixed(2)) : null;
    };
    return {
      ticker, quotazione: parseFloat(prezzoAttuale.toFixed(3)),
      perf1m: perf(l - 22), perf6m: perf(l - 126), perf1y: perf(l - 252), perf5y: perf(0),
      valuta: meta.currency || 'EUR', nome: meta.longName || meta.shortName || ticker,
      capitalizzazione: null, ter: null,
    };
  } catch (err) {
    console.error(`  Errore fetch ${ticker}:`, err.message);
    return null;
  }
}

async function fetchETF(isin) {
  const ticker = ISIN_TICKER_MAP[isin];
  if (ticker) {
    const dati = await fetchQuote(ticker);
    if (dati) return { isin, ...dati, fonte: 'yahoo', aggiornato: new Date().toISOString() };
  }
  for (const suf of ['.MI', '.AS', '.DE', '.PA', '.F', '.L', '.SW', '.IR', '.SG']) {
    const t = isin + suf;
    const dati = await fetchQuote(t);
    if (dati?.quotazione) {
      console.log(`  ✓ Trovato automatico: ${t}`);
      return { isin, ...dati, fonte: 'yahoo', aggiornato: new Date().toISOString() };
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

module.exports = (db) => {
  const router = express.Router();

  router.get('/:isin', async (req, res) => {
    const { isin } = req.params;
    console.log(`[${new Date().toLocaleTimeString()}] Richiesta: ${isin}`);
    const dati = await fetchETF(isin);
    if (!dati) return res.status(404).json({ error: `Dati non trovati per ${isin}` });
    res.json(dati);
  });

  router.post('/batch', async (req, res) => {
    const { isins } = req.body;
    if (!isins || !Array.isArray(isins)) return res.status(400).json({ error: 'Invia un array di ISIN' });
    console.log(`[${new Date().toLocaleTimeString()}] Batch: ${isins.length} ETF`);
    const risultati = {};
    for (const isin of isins) {
      const dati = await fetchETF(isin);
      if (dati) {
        risultati[isin] = dati;
        if (dati.quotazione > 0) {
          const oggi = new Date().toISOString().slice(0, 10);
          await db.query(`
            INSERT INTO prezzi_storici (isin, data, prezzo, perf1m, perf6m, perf1y, perf5y) VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT(isin, data) DO UPDATE SET prezzo=EXCLUDED.prezzo, perf1m=EXCLUDED.perf1m,
              perf6m=EXCLUDED.perf6m, perf1y=EXCLUDED.perf1y, perf5y=EXCLUDED.perf5y
          `, [isin, oggi, dati.quotazione, dati.perf1m, dati.perf6m, dati.perf1y, dati.perf5y]);
        }
      }
      await new Promise(r => setTimeout(r, 600));
    }
    console.log(`  ✓ Batch completato: ${Object.keys(risultati).length}/${isins.length}`);
    res.json(risultati);
  });

  return router;
};

module.exports.fetchETF = fetchETF;
module.exports.ETF_INFO_MAP = ETF_INFO_MAP;
