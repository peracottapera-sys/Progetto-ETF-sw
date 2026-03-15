// ── ETF Master List ──
// Fonte: lista manuale verificata con ticker Yahoo Finance funzionanti
// Per aggiungere nuovi ETF: usare il pannello Admin in Impostazioni

export const ETF_MASTER = [
  // ── AZIONARIO GLOBALE ──
  { isin: 'IE00B4L5Y983', name: 'iShares Core MSCI World UCITS ETF', emittente: 'BlackRock', ter: 0.20, tassazione: 26, quotazione: 98.42, annoNascita: 2009, capitalizzazione: 62000, variabilita: 14.2, maxDrawdown: -33.8, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'consigliato', perf1m: 2.1, perf6m: 8.4, perf1y: 18.2, perf5y: 72.4 },
  { isin: 'LU1681041782', name: 'Amundi MSCI World UCITS ETF', emittente: 'Amundi', ter: 0.12, tassazione: 26, quotazione: 43.21, annoNascita: 2018, capitalizzazione: 8200, variabilita: 14.0, maxDrawdown: -33.2, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 1.9, perf6m: 7.8, perf1y: 17.1, perf5y: 68.9 },
  { isin: 'IE00B3XXRP09', name: 'Vanguard FTSE All-World UCITS ETF', emittente: 'Vanguard', ter: 0.22, tassazione: 26, quotazione: 146.96, annoNascita: 2012, capitalizzazione: 18900, variabilita: 14.1, maxDrawdown: -33.5, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 2.0, perf6m: 8.1, perf1y: 17.8, perf5y: 71.2 },
  // ── AZIONARIO USA ──
  { isin: 'IE00B5BMR087', name: 'iShares Core S&P 500 UCITS ETF', emittente: 'BlackRock', ter: 0.07, tassazione: 26, quotazione: 624.77, annoNascita: 2010, capitalizzazione: 52000, variabilita: 15.8, maxDrawdown: -33.9, categoria: 'Azionario USA', valuta: 'USD', hedged: false, tipo: 'consigliato', perf1m: 2.4, perf6m: 9.2, perf1y: 22.1, perf5y: 89.4 },
  { isin: 'IE00B4L5YX21', name: 'SPDR S&P 500 UCITS ETF', emittente: 'SPDR', ter: 0.03, tassazione: 26, quotazione: 40.96, annoNascita: 2005, capitalizzazione: 45000, variabilita: 14.1, maxDrawdown: -33.6, categoria: 'Azionario USA', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 2.1, perf6m: 8.3, perf1y: 17.9, perf5y: 71.8 },
  // ── AZIONARIO EUROPA ──
  { isin: 'IE00B4K48X80', name: 'iShares Core MSCI Europe UCITS ETF', emittente: 'BlackRock', ter: 0.12, tassazione: 26, quotazione: 74.18, annoNascita: 2010, capitalizzazione: 7800, variabilita: 13.1, maxDrawdown: -28.4, categoria: 'Azionario Europa', valuta: 'EUR', hedged: false, tipo: 'consigliato', perf1m: 1.4, perf6m: 5.8, perf1y: 9.6, perf5y: 38.2 },
  { isin: 'LU1681043599', name: 'Amundi MSCI Europe UCITS ETF', emittente: 'Amundi', ter: 0.15, tassazione: 26, quotazione: 198.44, annoNascita: 2000, capitalizzazione: 3100, variabilita: 13.4, maxDrawdown: -28.9, categoria: 'Azionario Europa', valuta: 'EUR', hedged: false, tipo: 'alternativa1', perf1m: 1.2, perf6m: 5.2, perf1y: 8.9, perf5y: 35.4 },
  // ── AZIONARIO EMERGENTI ──
  { isin: 'IE00B4L5YC18', name: 'iShares Core MSCI EM IMI UCITS ETF', emittente: 'BlackRock', ter: 0.18, tassazione: 26, quotazione: 33.14, annoNascita: 2014, capitalizzazione: 18200, variabilita: 17.6, maxDrawdown: -31.2, categoria: 'Azionario Emergenti', valuta: 'USD', hedged: false, tipo: 'consigliato', perf1m: 1.2, perf6m: 4.6, perf1y: 8.8, perf5y: 22.4 },
  { isin: 'LU1681045370', name: 'Amundi MSCI Emerging Markets UCITS ETF', emittente: 'Amundi', ter: 0.14, tassazione: 26, quotazione: 6.84, annoNascita: 2016, capitalizzazione: 2900, variabilita: 17.2, maxDrawdown: -30.8, categoria: 'Azionario Emergenti', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 1.0, perf6m: 4.1, perf1y: 8.2, perf5y: 20.1 },
  { isin: 'IE00BKM4GZ66', name: 'iShares Core MSCI EM IMI UCITS ETF USD (Acc)', emittente: 'BlackRock', ter: 0.18, tassazione: 26, quotazione: 76.59, annoNascita: 2014, capitalizzazione: 14500, variabilita: 17.4, maxDrawdown: -31.0, categoria: 'Azionario Emergenti', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 1.1, perf6m: 4.3, perf1y: 8.5, perf5y: 21.8 },
  // ── AZIONARIO TECH / NASDAQ ──
  { isin: 'IE0032077012', name: 'Invesco EQQQ Nasdaq-100 UCITS ETF', emittente: 'Invesco', ter: 0.30, tassazione: 26, quotazione: 523.20, annoNascita: 2002, capitalizzazione: 8900, variabilita: 21.4, maxDrawdown: -35.1, categoria: 'Azionario Tech', valuta: 'USD', hedged: false, tipo: 'consigliato', perf1m: 3.2, perf6m: 11.4, perf1y: 28.6, perf5y: 124.3 },
  { isin: 'IE00BGDQ0H97', name: 'iShares S&P 500 IT Sector UCITS ETF', emittente: 'BlackRock', ter: 0.15, tassazione: 26, quotazione: 34.52, annoNascita: 2015, capitalizzazione: 4200, variabilita: 20.1, maxDrawdown: -34.2, categoria: 'Azionario Tech', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 2.8, perf6m: 10.2, perf1y: 24.3, perf5y: 108.6 },
  { isin: 'IE00BYVJRP78', name: 'Xtrackers MSCI World IT UCITS ETF', emittente: 'Xtrackers', ter: 0.25, tassazione: 26, quotazione: 49.57, annoNascita: 2018, capitalizzazione: 2100, variabilita: 20.8, maxDrawdown: -34.8, categoria: 'Azionario Tech', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 2.9, perf6m: 10.8, perf1y: 26.1, perf5y: 115.2 },
  // ── AZIONARIO HEALTHCARE ──
  { isin: 'IE00B4JNQZ49', name: 'iShares Healthcare Innovation UCITS ETF', emittente: 'BlackRock', ter: 0.40, tassazione: 26, quotazione: 26.58, annoNascita: 2016, capitalizzazione: 2800, variabilita: 16.2, maxDrawdown: -28.6, categoria: 'Azionario Healthcare', valuta: 'USD', hedged: false, tipo: 'consigliato', perf1m: 1.1, perf6m: 3.8, perf1y: 7.2, perf5y: 31.4 },
  { isin: 'IE00BFG0R112', name: 'SPDR MSCI World Health Care UCITS ETF', emittente: 'SPDR', ter: 0.30, tassazione: 26, quotazione: 7.46, annoNascita: 2016, capitalizzazione: 1200, variabilita: 15.8, maxDrawdown: -27.4, categoria: 'Azionario Healthcare', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 1.0, perf6m: 3.5, perf1y: 6.8, perf5y: 29.8 },
  // ── AZIONARIO SMALL CAP ──
  { isin: 'IE00B3VVMM84', name: 'iShares MSCI World Small Cap UCITS ETF', emittente: 'BlackRock', ter: 0.35, tassazione: 26, quotazione: 8.06, annoNascita: 2009, capitalizzazione: 4800, variabilita: 18.4, maxDrawdown: -36.2, categoria: 'Azionario Small Cap', valuta: 'USD', hedged: false, tipo: 'consigliato', perf1m: 1.4, perf6m: 5.2, perf1y: 10.4, perf5y: 42.8 },
  // ── OBBLIGAZIONARIO GOV EUR ──
  { isin: 'IE00B3F81R35', name: 'iShares Core € Govt Bond UCITS ETF', emittente: 'BlackRock', ter: 0.07, tassazione: 12.5, quotazione: 122.34, annoNascita: 2009, capitalizzazione: 9800, variabilita: 5.2, maxDrawdown: -12.1, categoria: 'Obblig. Gov. EUR', valuta: 'EUR', hedged: false, tipo: 'consigliato', perf1m: 0.8, perf6m: 2.1, perf1y: 4.2, perf5y: 8.1 },
  { isin: 'LU1829218749', name: 'Amundi € Govies 1-3Y UCITS ETF', emittente: 'Amundi', ter: 0.05, tassazione: 12.5, quotazione: 97.88, annoNascita: 2018, capitalizzazione: 3200, variabilita: 2.1, maxDrawdown: -4.2, categoria: 'Obblig. Gov. EUR', valuta: 'EUR', hedged: false, tipo: 'alternativa1', perf1m: 0.4, perf6m: 1.2, perf1y: 3.1, perf5y: 5.8 },
  { isin: 'IE00B3FH7618', name: 'iShares € Govt Bond 1-3yr UCITS ETF', emittente: 'BlackRock', ter: 0.07, tassazione: 12.5, quotazione: 160.75, annoNascita: 2006, capitalizzazione: 5800, variabilita: 1.8, maxDrawdown: -3.8, categoria: 'Obblig. Gov. EUR 1-3Y', valuta: 'EUR', hedged: false, tipo: 'consigliato', perf1m: 0.3, perf6m: 1.0, perf1y: 2.8, perf5y: 4.9 },
  // ── OBBLIGAZIONARIO CORP EUR ──
  { isin: 'IE00B3F81409', name: 'iShares € Corp Bond UCITS ETF', emittente: 'BlackRock', ter: 0.20, tassazione: 26, quotazione: 134.22, annoNascita: 2003, capitalizzazione: 7600, variabilita: 4.8, maxDrawdown: -15.2, categoria: 'Obblig. Corp. EUR', valuta: 'EUR', hedged: false, tipo: 'consigliato', perf1m: 0.9, perf6m: 2.8, perf1y: 5.1, perf5y: 12.3 },
  { isin: 'LU1829219655', name: 'Amundi € Corporate Bond UCITS ETF', emittente: 'Amundi', ter: 0.14, tassazione: 26, quotazione: 17.92, annoNascita: 2018, capitalizzazione: 1800, variabilita: 4.5, maxDrawdown: -14.6, categoria: 'Obblig. Corp. EUR', valuta: 'EUR', hedged: false, tipo: 'alternativa1', perf1m: 0.7, perf6m: 2.4, perf1y: 4.6, perf5y: 10.8 },
  // ── OBBLIGAZIONARIO HIGH YIELD ──
  { isin: 'IE00B66F4759', name: 'iShares € High Yield Corp Bond UCITS ETF', emittente: 'BlackRock', ter: 0.50, tassazione: 26, quotazione: 92.18, annoNascita: 2010, capitalizzazione: 6200, variabilita: 7.2, maxDrawdown: -22.4, categoria: 'Obblig. High Yield', valuta: 'EUR', hedged: false, tipo: 'consigliato', perf1m: 0.6, perf6m: 3.2, perf1y: 7.8, perf5y: 18.4 },
  { isin: 'IE00BD4DXW77', name: 'Xtrackers EUR High Yield Bond UCITS ETF', emittente: 'Xtrackers', ter: 0.20, tassazione: 26, quotazione: 23.70, annoNascita: 2018, capitalizzazione: 1400, variabilita: 7.0, maxDrawdown: -21.8, categoria: 'Obblig. High Yield', valuta: 'EUR', hedged: false, tipo: 'alternativa1', perf1m: 0.5, perf6m: 3.0, perf1y: 7.4, perf5y: 17.2 },
  // ── OBBLIGAZIONARIO INFLATION ──
  { isin: 'IE00B4WXJJ64', name: 'iShares € Inflation Linked Govt Bond UCITS ETF', emittente: 'BlackRock', ter: 0.10, tassazione: 12.5, quotazione: 26.88, annoNascita: 2008, capitalizzazione: 3400, variabilita: 6.1, maxDrawdown: -16.8, categoria: 'Obblig. Inflation EUR', valuta: 'EUR', hedged: false, tipo: 'consigliato', perf1m: 0.5, perf6m: 1.8, perf1y: 3.6, perf5y: 7.2 },
  // ── AZIONARIO ITALIA ──
  { isin: 'IE00B53L4350', name: 'iShares FTSE MIB UCITS ETF', emittente: 'BlackRock', ter: 0.35, tassazione: 26, quotazione: 27.03, annoNascita: 2006, capitalizzazione: 820, variabilita: 19.2, maxDrawdown: -42.1, categoria: 'Azionario Italia', valuta: 'EUR', hedged: false, tipo: 'consigliato', perf1m: 2.1, perf6m: 7.4, perf1y: 14.8, perf5y: 52.3 },
  { isin: 'LU0274212538', name: 'Xtrackers FTSE MIB UCITS ETF', emittente: 'Xtrackers', ter: 0.30, tassazione: 26, quotazione: 215.55, annoNascita: 2007, capitalizzazione: 480, variabilita: 19.4, maxDrawdown: -42.4, categoria: 'Azionario Italia', valuta: 'EUR', hedged: false, tipo: 'alternativa1', perf1m: 2.0, perf6m: 7.2, perf1y: 14.4, perf5y: 51.2 },
  // ── AZIONARIO GIAPPONE ──
  { isin: 'IE00B53QDK08', name: 'iShares MSCI Japan UCITS ETF', emittente: 'BlackRock', ter: 0.48, tassazione: 26, quotazione: 19.26, annoNascita: 2009, capitalizzazione: 3200, variabilita: 16.8, maxDrawdown: -30.2, categoria: 'Azionario Giappone', valuta: 'USD', hedged: false, tipo: 'consigliato', perf1m: 0.8, perf6m: 3.2, perf1y: 6.4, perf5y: 28.6 },
  { isin: 'LU0659580079', name: 'Xtrackers MSCI Japan UCITS ETF', emittente: 'Xtrackers', ter: 0.20, tassazione: 26, quotazione: 74.34, annoNascita: 2011, capitalizzazione: 1800, variabilita: 16.6, maxDrawdown: -29.8, categoria: 'Azionario Giappone', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 0.7, perf6m: 3.0, perf1y: 6.1, perf5y: 27.4 },
  // ── AZIONARIO EMERGENTI ASIA ──
  { isin: 'IE00B5L8K969', name: 'iShares MSCI EM Asia UCITS ETF', emittente: 'BlackRock', ter: 0.20, tassazione: 26, quotazione: 216.68, annoNascita: 2010, capitalizzazione: 4600, variabilita: 18.2, maxDrawdown: -32.4, categoria: 'Azionario Emergenti Asia', valuta: 'USD', hedged: false, tipo: 'consigliato', perf1m: 1.4, perf6m: 5.2, perf1y: 9.8, perf5y: 24.6 },
  // ── IMMOBILIARE (REIT) ──
  { isin: 'IE00B5L01S80', name: 'iShares EPRA Europe Property UCITS ETF', emittente: 'BlackRock', ter: 0.40, tassazione: 26, quotazione: 31.175, annoNascita: 2006, capitalizzazione: 1400, variabilita: 16.4, maxDrawdown: -38.2, categoria: 'Immobiliare (REIT)', valuta: 'EUR', hedged: false, tipo: 'consigliato', perf1m: 1.2, perf6m: 4.8, perf1y: 8.2, perf5y: 18.4 },
  { isin: 'LU0489337690', name: 'Xtrackers FTSE EPRA Eurozone UCITS ETF', emittente: 'Xtrackers', ter: 0.33, tassazione: 26, quotazione: 58.00, annoNascita: 2010, capitalizzazione: 680, variabilita: 16.8, maxDrawdown: -38.8, categoria: 'Immobiliare (REIT)', valuta: 'EUR', hedged: false, tipo: 'alternativa1', perf1m: 1.1, perf6m: 4.4, perf1y: 7.8, perf5y: 17.2 },
  // ── OBBLIG. GOV. ITALIA (BTP) ──
  { isin: 'IE00B7LW3080', name: 'iShares BTP UCITS ETF', emittente: 'BlackRock', ter: 0.20, tassazione: 12.5, quotazione: 68.55, annoNascita: 2012, capitalizzazione: 2100, variabilita: 8.4, maxDrawdown: -18.6, categoria: 'Obblig. Gov. Italia', valuta: 'EUR', hedged: false, tipo: 'consigliato', perf1m: 0.6, perf6m: 2.2, perf1y: 4.8, perf5y: 9.6 },
  { isin: 'IE00B3F81K65', name: 'iShares Italia Govt Bond UCITS ETF', emittente: 'BlackRock', ter: 0.20, tassazione: 12.5, quotazione: 150.50, annoNascita: 2009, capitalizzazione: 1400, variabilita: 8.2, maxDrawdown: -18.2, categoria: 'Obblig. Gov. Italia', valuta: 'EUR', hedged: false, tipo: 'alternativa1', perf1m: 0.5, perf6m: 2.0, perf1y: 4.4, perf5y: 9.1 },
  // ── OBBLIG. GOV. USA (TREASURY) ──
  { isin: 'IE00B14X4S71', name: 'iShares $ Treasury Bond 1-3yr UCITS ETF', emittente: 'BlackRock', ter: 0.07, tassazione: 26, quotazione: 112.50, annoNascita: 2007, capitalizzazione: 8200, variabilita: 2.4, maxDrawdown: -4.8, categoria: 'Obblig. Gov. USA', valuta: 'USD', hedged: false, tipo: 'consigliato', perf1m: 0.3, perf6m: 1.4, perf1y: 3.8, perf5y: 7.2 },
  { isin: 'IE00B1FZS798', name: 'iShares $ Treasury Bond 7-10yr UCITS ETF', emittente: 'BlackRock', ter: 0.07, tassazione: 26, quotazione: 152.11, annoNascita: 2006, capitalizzazione: 4800, variabilita: 7.8, maxDrawdown: -19.4, categoria: 'Obblig. Gov. USA', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 0.5, perf6m: 2.1, perf1y: 4.2, perf5y: 8.8 },
  { isin: 'IE00BGPP6599', name: 'iShares $ Treasury Bond 20+yr UCITS ETF', emittente: 'BlackRock', ter: 0.10, tassazione: 26, quotazione: 164.10, annoNascita: 2019, capitalizzazione: 1800, variabilita: 18.2, maxDrawdown: -38.4, categoria: 'Obblig. Gov. USA', valuta: 'USD', hedged: false, tipo: 'alternativa1', perf1m: 0.8, perf6m: 2.8, perf1y: 4.8, perf5y: 6.4 },
  // ── MERCATO MONETARIO EUR ──
  { isin: 'LU0290358497', name: 'Xtrackers II EUR Overnight Rate Swap UCITS ETF', emittente: 'Xtrackers', ter: 0.10, tassazione: 26, quotazione: 148.62, annoNascita: 2007, capitalizzazione: 5200, variabilita: 0.2, maxDrawdown: -0.4, categoria: 'Mercato Monetario', valuta: 'EUR', hedged: false, tipo: 'consigliato', perf1m: 0.3, perf6m: 1.8, perf1y: 3.6, perf5y: 6.2 },
  { isin: 'FR0010510800', name: 'Lyxor Euro Overnight Return UCITS ETF', emittente: 'Amundi', ter: 0.10, tassazione: 26, quotazione: 113.27, annoNascita: 2008, capitalizzazione: 2800, variabilita: 0.2, maxDrawdown: -0.3, categoria: 'Mercato Monetario', valuta: 'EUR', hedged: false, tipo: 'alternativa1', perf1m: 0.3, perf6m: 1.8, perf1y: 3.5, perf5y: 6.0 },
  // ── COMMODITIES / ORO ──
  { isin: 'IE00B4ND3602', name: 'iShares Physical Gold ETC', emittente: 'BlackRock', ter: 0.12, tassazione: 26, quotazione: 428.69, annoNascita: 2011, capitalizzazione: 12800, variabilita: 12.4, maxDrawdown: -18.6, categoria: 'Commodities Oro', valuta: 'USD', hedged: false, tipo: 'consigliato', perf1m: 1.8, perf6m: 12.4, perf1y: 28.4, perf5y: 68.2 },
  { isin: 'DE000A1EK0G3', name: 'Xtrackers Physical Gold ETC (EUR)', emittente: 'Xtrackers', ter: 0.25, tassazione: 26, quotazione: 176.41, annoNascita: 2011, capitalizzazione: 3200, variabilita: 12.2, maxDrawdown: -18.2, categoria: 'Commodities Oro', valuta: 'EUR', hedged: false, tipo: 'alternativa1', perf1m: 1.7, perf6m: 12.1, perf1y: 27.8, perf5y: 66.4 },
  { isin: 'DE000A0S9GB0', name: 'Xetra-Gold ETC', emittente: 'Deutsche Boerse', ter: 0.00, tassazione: 26, quotazione: 143.06, annoNascita: 2007, capitalizzazione: 9800, variabilita: 12.3, maxDrawdown: -18.4, categoria: 'Commodities Oro', valuta: 'EUR', hedged: false, tipo: 'alternativa1', perf1m: 1.8, perf6m: 12.3, perf1y: 28.1, perf5y: 67.8 },
];

// Categorie disponibili (per filtri e form)
export const CATEGORIE = [
  // Azionario
  'Azionario Globale',
  'Azionario USA',
  'Azionario Europa',
  'Azionario Italia',
  'Azionario Giappone',
  'Azionario Emergenti',
  'Azionario Emergenti Asia',
  'Azionario Tech',
  'Azionario Healthcare',
  'Azionario Small Cap',
  // Obbligazionario
  'Obblig. Gov. EUR',
  'Obblig. Gov. EUR 1-3Y',
  'Obblig. Gov. Italia',
  'Obblig. Gov. USA',
  'Obblig. Corp. EUR',
  'Obblig. High Yield',
  'Obblig. Inflation EUR',
  // Altro
  'Immobiliare (REIT)',
  'Commodities Oro',
  'Commodities Altro',
  'Mercato Monetario',
  'Multi-Asset',
];

export const EMITTENTI = [
  'BlackRock', 'Amundi', 'Vanguard', 'Xtrackers', 'Invesco',
  'SPDR', 'WisdomTree', 'VanEck', 'HSBC', 'UBS', 'Deutsche Boerse', 'Lyxor',
];
