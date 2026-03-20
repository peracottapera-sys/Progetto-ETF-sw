import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AppContext = createContext(null);
const STORAGE_KEY = 'etf_app_data';
const TOKEN_KEY = 'etf_app_token';
const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

// ── ETF master list (sempre disponibile, usata come base) ──
export const ETF_MASTER = [
  // ── AZIONARIO GLOBALE ──
  { isin: 'IE00B4L5Y983', name: 'iShares Core MSCI World UCITS ETF', emittente: 'BlackRock', ter: 0.20, perf1m: 2.1, perf6m: 8.4, perf1y: 18.2, perf5y: 72.4, tassazione: 26, quotazione: 112.18, annoNascita: 2009, capitalizzazione: 62000, variabilita: 14.2, maxDrawdown: -33.8, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'consigliato' },
  { isin: 'LU1681041782', name: 'Amundi MSCI World UCITS ETF', emittente: 'Amundi', ter: 0.12, perf1m: 1.9, perf6m: 7.8, perf1y: 17.1, perf5y: 68.9, tassazione: 26, quotazione: 19.61, annoNascita: 2018, capitalizzazione: 8200, variabilita: 14.0, maxDrawdown: -33.2, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  { isin: 'IE00B3XXRP09', name: 'Vanguard FTSE All-World UCITS ETF', emittente: 'Vanguard', ter: 0.22, perf1m: 2.0, perf6m: 8.1, perf1y: 17.8, perf5y: 71.2, tassazione: 26, quotazione: 147.18, annoNascita: 2012, capitalizzazione: 18900, variabilita: 14.1, maxDrawdown: -33.5, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  { isin: 'IE00B5BMR087', name: 'iShares Core S&P 500 UCITS ETF', emittente: 'BlackRock', ter: 0.07, perf1m: 2.4, perf6m: 9.2, perf1y: 22.1, perf5y: 89.4, tassazione: 26, quotazione: 626.23, annoNascita: 2010, capitalizzazione: 52000, variabilita: 15.8, maxDrawdown: -33.9, categoria: 'Azionario USA', valuta: 'USD', hedged: false, tipo: 'consigliato' },
  { isin: 'IE00B4L5YX21', name: 'iShares Core MSCI World UCITS ETF (Acc)', emittente: 'BlackRock', ter: 0.20, perf1m: 2.1, perf6m: 8.3, perf1y: 17.9, perf5y: 71.8, tassazione: 26, quotazione: 41.00, annoNascita: 2005, capitalizzazione: 45000, variabilita: 14.1, maxDrawdown: -33.6, categoria: 'Azionario USA', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  // ── AZIONARIO EUROPA ──
  { isin: 'IE00B4K48X80', name: 'iShares Core MSCI Europe UCITS ETF', emittente: 'BlackRock', ter: 0.12, perf1m: 1.4, perf6m: 5.8, perf1y: 9.6, perf5y: 38.2, tassazione: 26, quotazione: 69.50, annoNascita: 2010, capitalizzazione: 7800, variabilita: 13.1, maxDrawdown: -28.4, categoria: 'Azionario Europa', valuta: 'EUR', hedged: false, tipo: 'consigliato' },
  { isin: 'LU1681043599', name: 'Amundi MSCI Europe UCITS ETF', emittente: 'Amundi', ter: 0.15, perf1m: 1.2, perf6m: 5.2, perf1y: 8.9, perf5y: 35.4, tassazione: 26, quotazione: 110.68, annoNascita: 2000, capitalizzazione: 3100, variabilita: 13.4, maxDrawdown: -28.9, categoria: 'Azionario Europa', valuta: 'EUR', hedged: false, tipo: 'alternativa1' },
  // ── AZIONARIO EMERGENTI ──
  { isin: 'IE00B4L5YC18', name: 'iShares Core MSCI EM IMI UCITS ETF', emittente: 'BlackRock', ter: 0.18, perf1m: 1.2, perf6m: 4.6, perf1y: 8.8, perf5y: 22.4, tassazione: 26, quotazione: 40.82, annoNascita: 2014, capitalizzazione: 18200, variabilita: 17.6, maxDrawdown: -31.2, categoria: 'Azionario Emergenti', valuta: 'USD', hedged: false, tipo: 'consigliato' },
  { isin: 'LU1681045370', name: 'Amundi MSCI Emerging Markets UCITS ETF', emittente: 'Amundi', ter: 0.14, perf1m: 1.0, perf6m: 4.1, perf1y: 8.2, perf5y: 20.1, tassazione: 26, quotazione: 6.58, annoNascita: 2016, capitalizzazione: 2900, variabilita: 17.2, maxDrawdown: -30.8, categoria: 'Azionario Emergenti', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  { isin: 'IE00BKM4GZ66', name: 'iShares Core MSCI EM IMI UCITS ETF USD (Acc)', emittente: 'BlackRock', ter: 0.18, perf1m: 1.1, perf6m: 4.3, perf1y: 8.5, perf5y: 21.8, tassazione: 26, quotazione: 76.59, annoNascita: 2014, capitalizzazione: 14500, variabilita: 17.4, maxDrawdown: -31.0, categoria: 'Azionario Emergenti', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  // ── AZIONARIO TECH / NASDAQ ──
  { isin: 'IE0032077012', name: 'Invesco EQQQ Nasdaq-100 UCITS ETF', emittente: 'Invesco', ter: 0.30, perf1m: 3.2, perf6m: 11.4, perf1y: 28.6, perf5y: 124.3, tassazione: 26, quotazione: 524.35, annoNascita: 2002, capitalizzazione: 8900, variabilita: 21.4, maxDrawdown: -35.1, categoria: 'Azionario Tech', valuta: 'USD', hedged: false, tipo: 'consigliato' },
  { isin: 'IE00BGDQ0H97', name: 'iShares S&P 500 IT Sector UCITS ETF', emittente: 'BlackRock', ter: 0.15, perf1m: 2.8, perf6m: 10.2, perf1y: 24.3, perf5y: 108.6, tassazione: 26, quotazione: 26.54, annoNascita: 2015, capitalizzazione: 4200, variabilita: 20.1, maxDrawdown: -34.2, categoria: 'Azionario Tech', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  { isin: 'IE00BYVJRP78', name: 'Xtrackers MSCI World IT UCITS ETF', emittente: 'Xtrackers', ter: 0.25, perf1m: 2.9, perf6m: 10.8, perf1y: 26.1, perf5y: 115.2, tassazione: 26, quotazione: 49.70, annoNascita: 2018, capitalizzazione: 2100, variabilita: 20.8, maxDrawdown: -34.8, categoria: 'Azionario Tech', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  // ── AZIONARIO HEALTHCARE ──
  { isin: 'IE00B4JNQZ49', name: 'iShares Healthcare Innovation UCITS ETF', emittente: 'BlackRock', ter: 0.40, perf1m: 1.1, perf6m: 3.8, perf1y: 7.2, perf5y: 31.4, tassazione: 26, quotazione: 34.57, annoNascita: 2016, capitalizzazione: 2800, variabilita: 16.2, maxDrawdown: -28.6, categoria: 'Azionario Healthcare', valuta: 'USD', hedged: false, tipo: 'consigliato' },
  { isin: 'IE00BFG0R112', name: 'SPDR MSCI World Health Care UCITS ETF', emittente: 'SPDR', ter: 0.30, perf1m: 1.0, perf6m: 3.5, perf1y: 6.8, perf5y: 29.8, tassazione: 26, quotazione: 7.48, annoNascita: 2016, capitalizzazione: 1200, variabilita: 15.8, maxDrawdown: -27.4, categoria: 'Azionario Healthcare', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  // ── OBBLIGAZIONARIO GOV EUR ──
  { isin: 'IE00B3F81R35', name: 'iShares Core € Govt Bond UCITS ETF', emittente: 'BlackRock', ter: 0.07, perf1m: 0.8, perf6m: 2.1, perf1y: 4.2, perf5y: 8.1, tassazione: 12.5, quotazione: 107.07, annoNascita: 2009, capitalizzazione: 9800, variabilita: 5.2, maxDrawdown: -12.1, categoria: 'Obblig. Gov. EUR', valuta: 'EUR', hedged: false, tipo: 'consigliato' },
  { isin: 'LU1829218749', name: 'Amundi € Govies 1-3Y UCITS ETF', emittente: 'Amundi', ter: 0.05, perf1m: 0.4, perf6m: 1.2, perf1y: 3.1, perf5y: 5.8, tassazione: 12.5, quotazione: 221.66, annoNascita: 2018, capitalizzazione: 3200, variabilita: 2.1, maxDrawdown: -4.2, categoria: 'Obblig. Gov. EUR', valuta: 'EUR', hedged: false, tipo: 'alternativa1' },
  { isin: 'IE00B3FH7618', name: 'iShares € Govt Bond 1-3yr UCITS ETF', emittente: 'BlackRock', ter: 0.07, perf1m: 0.3, perf6m: 1.0, perf1y: 2.8, perf5y: 4.9, tassazione: 12.5, quotazione: 141.90, annoNascita: 2006, capitalizzazione: 5800, variabilita: 1.8, maxDrawdown: -3.8, categoria: 'Obblig. Gov. EUR 1-3Y', valuta: 'EUR', hedged: false, tipo: 'consigliato' },
  // ── OBBLIGAZIONARIO CORP EUR ──
  { isin: 'IE00B3F81409', name: 'iShares € Corp Bond UCITS ETF', emittente: 'BlackRock', ter: 0.20, perf1m: 0.9, perf6m: 2.8, perf1y: 5.1, perf5y: 12.3, tassazione: 26, quotazione: 124.28, annoNascita: 2003, capitalizzazione: 7600, variabilita: 4.8, maxDrawdown: -15.2, categoria: 'Obblig. Corp. EUR', valuta: 'EUR', hedged: false, tipo: 'consigliato' },
  { isin: 'LU1829219655', name: 'Amundi € Corporate Bond UCITS ETF', emittente: 'Amundi', ter: 0.14, perf1m: 0.7, perf6m: 2.4, perf1y: 4.6, perf5y: 10.8, tassazione: 26, quotazione: 153.92, annoNascita: 2018, capitalizzazione: 1800, variabilita: 4.5, maxDrawdown: -14.6, categoria: 'Obblig. Corp. EUR', valuta: 'EUR', hedged: false, tipo: 'alternativa1' },
  // ── OBBLIGAZIONARIO HIGH YIELD ──
  { isin: 'IE00B66F4759', name: 'iShares € High Yield Corp Bond UCITS ETF', emittente: 'BlackRock', ter: 0.50, perf1m: 0.6, perf6m: 3.2, perf1y: 7.8, perf5y: 18.4, tassazione: 26, quotazione: 91.93, annoNascita: 2010, capitalizzazione: 6200, variabilita: 7.2, maxDrawdown: -22.4, categoria: 'Obblig. High Yield', valuta: 'EUR', hedged: false, tipo: 'consigliato' },
  { isin: 'IE00BD4DXW77', name: 'Xtrackers EUR High Yield Bond UCITS ETF', emittente: 'Xtrackers', ter: 0.20, perf1m: 0.5, perf6m: 3.0, perf1y: 7.4, perf5y: 17.2, tassazione: 26, quotazione: 23.68, annoNascita: 2018, capitalizzazione: 1400, variabilita: 7.0, maxDrawdown: -21.8, categoria: 'Obblig. High Yield', valuta: 'EUR', hedged: false, tipo: 'alternativa1' },
  // ── OBBLIGAZIONARIO INFLATION ──
  { isin: 'IE00B4WXJJ64', name: 'iShares € Inflation Linked Govt Bond UCITS ETF', emittente: 'BlackRock', ter: 0.10, perf1m: 0.5, perf6m: 1.8, perf1y: 3.6, perf5y: 7.2, tassazione: 12.5, quotazione: 235.00, annoNascita: 2008, capitalizzazione: 3400, variabilita: 6.1, maxDrawdown: -16.8, categoria: 'Obblig. Inflation EUR', valuta: 'EUR', hedged: false, tipo: 'consigliato' },
  // ── COMMODITIES / ORO ──
  { isin: 'IE00B4ND3602', name: 'iShares Physical Gold ETC', emittente: 'BlackRock', ter: 0.12, perf1m: 1.8, perf6m: 12.4, perf1y: 28.4, perf5y: 68.2, tassazione: 26, quotazione: 427.75, annoNascita: 2011, capitalizzazione: 12800, variabilita: 12.4, maxDrawdown: -18.6, categoria: 'Commodities Oro', valuta: 'USD', hedged: false, tipo: 'consigliato' },
  { isin: 'DE000A1EK0G3', name: 'Xtrackers Physical Gold ETC (EUR)', emittente: 'Xtrackers', ter: 0.25, perf1m: 1.7, perf6m: 12.1, perf1y: 27.8, perf5y: 66.4, tassazione: 26, quotazione: 175.96, annoNascita: 2011, capitalizzazione: 3200, variabilita: 12.2, maxDrawdown: -18.2, categoria: 'Commodities Oro', valuta: 'EUR', hedged: false, tipo: 'alternativa1' },
  { isin: 'DE000A0S9GB0', name: 'Xetra-Gold ETC', emittente: 'Deutsche Boerse', ter: 0.00, perf1m: 1.8, perf6m: 12.3, perf1y: 28.1, perf5y: 67.8, tassazione: 26, quotazione: 142.85, annoNascita: 2007, capitalizzazione: 9800, variabilita: 12.3, maxDrawdown: -18.4, categoria: 'Commodities Oro', valuta: 'EUR', hedged: false, tipo: 'alternativa1' },
  // ── AZIONARIO SMALL CAP ──
  { isin: 'IE00B3VVMM84', name: 'iShares MSCI World Small Cap UCITS ETF', emittente: 'BlackRock', ter: 0.35, perf1m: 1.4, perf6m: 5.2, perf1y: 10.4, perf5y: 42.8, tassazione: 26, quotazione: 8.05, annoNascita: 2009, capitalizzazione: 4800, variabilita: 18.4, maxDrawdown: -36.2, categoria: 'Azionario Small Cap', valuta: 'USD', hedged: false, tipo: 'consigliato' },
  { isin: 'LU0290358497', name: 'Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C', emittente: 'Xtrackers', ter: 0.10, perf1m: 0.3, perf6m: 0.8, perf1y: 3.9, perf5y: 8.2, tassazione: 12.5, quotazione: 148.63, annoNascita: 2007, capitalizzazione: 19000, variabilita: 0.3, maxDrawdown: -0.5, categoria: 'Liquidità EUR', valuta: 'EUR', hedged: false, tipo: 'consigliato' },
  // ── ETF frequentemente suggeriti dall'AI ──
  { isin: 'IE00BK5BQT80', name: 'Vanguard FTSE All-World UCITS ETF USD Accumulating', emittente: 'Vanguard', ter: 0.22, perf1m: 1.8, perf6m: 7.2, perf1y: 17.94, perf5y: 68.88, tassazione: 26, quotazione: 147.18, annoNascita: 2019, capitalizzazione: 36000, variabilita: 14.1, maxDrawdown: -33.5, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  { isin: 'IE00B3ZW0K18', name: 'iShares S&P 500 EUR Hedged UCITS ETF (Acc)', emittente: 'iShares', ter: 0.20, perf1m: -2.76, perf6m: 1.97, perf1y: 19.56, perf5y: 62.69, tassazione: 26, quotazione: 45.79, annoNascita: 2010, capitalizzazione: 7800, variabilita: 14.2, maxDrawdown: -33.9, categoria: 'Azionario USA', valuta: 'EUR', hedged: true, tipo: 'consigliato' },
  { isin: 'FR0013416716', name: 'Amundi Physical Gold ETC (C)', emittente: 'Amundi', ter: 0.12, perf1m: 4.73, perf6m: 43.81, perf1y: 66.99, perf5y: 208.23, tassazione: 26, quotazione: 47.80, annoNascita: 2017, capitalizzazione: 12200, variabilita: 12.4, maxDrawdown: -18.6, categoria: 'Commodities Oro', valuta: 'EUR', hedged: false, tipo: 'consigliato' },
  { isin: 'IE00B441G979', name: 'iShares MSCI World EUR Hedged UCITS ETF (Acc)', emittente: 'iShares', ter: 0.55, perf1m: -3.00, perf6m: 3.59, perf1y: 19.56, perf5y: 59.66, tassazione: 26, quotazione: 40.09, annoNascita: 2014, capitalizzazione: 4700, variabilita: 14.0, maxDrawdown: -33.4, categoria: 'Azionario Globale', valuta: 'EUR', hedged: true, tipo: 'alternativa1' },
  { isin: 'IE00BP3QZB59', name: 'iShares Edge MSCI World Value Factor UCITS ETF', emittente: 'iShares', ter: 0.25, perf1m: -2.73, perf6m: 18.52, perf1y: 30.58, perf5y: 84.11, tassazione: 26, quotazione: 39.50, annoNascita: 2014, capitalizzazione: 5000, variabilita: 13.8, maxDrawdown: -30.2, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  { isin: 'IE00BJK55C48', name: 'iShares EUR High Yield Corp Bond ESG UCITS ETF', emittente: 'iShares', ter: 0.50, perf1m: 0.4, perf6m: 2.8, perf1y: 6.9, perf5y: 15.2, tassazione: 26, quotazione: 5.12, annoNascita: 2017, capitalizzazione: 2800, variabilita: 6.8, maxDrawdown: -21.5, categoria: 'Obblig. High Yield', valuta: 'EUR', hedged: false, tipo: 'alternativa1' },
  { isin: 'IE00B53L3W79', name: 'iShares Core EURO STOXX 50 UCITS ETF', emittente: 'iShares', ter: 0.10, perf1m: 1.1, perf6m: 5.4, perf1y: 9.2, perf5y: 36.8, tassazione: 26, quotazione: 54.20, annoNascita: 2002, capitalizzazione: 8400, variabilita: 13.2, maxDrawdown: -28.1, categoria: 'Azionario Europa', valuta: 'EUR', hedged: false, tipo: 'alternativa1' },
  { isin: 'LU0908500753', name: 'Amundi Core Stoxx Europe 600 UCITS ETF Acc', emittente: 'Amundi', ter: 0.07, perf1m: 1.4, perf6m: 5.8, perf1y: 15.49, perf5y: 63.11, tassazione: 26, quotazione: 14.82, annoNascita: 2013, capitalizzazione: 16900, variabilita: 13.0, maxDrawdown: -27.8, categoria: 'Azionario Europa', valuta: 'EUR', hedged: false, tipo: 'alternativa1' },
  // ── ETF Xtrackers / vari frequenti nel catalogo AI ──
  { isin: 'IE00BJ0KDQ92', name: 'Xtrackers MSCI World UCITS ETF 1C', emittente: 'Xtrackers', ter: 0.12, perf1m: -0.57, perf6m: 5.24, perf1y: 16.40, perf5y: 75.51, tassazione: 26, quotazione: 82.50, annoNascita: 2014, capitalizzazione: 16600, variabilita: 14.1, maxDrawdown: -33.5, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'alternativa2' },
  { isin: 'IE00BL25JM42', name: 'Xtrackers MSCI World Value UCITS ETF 1C', emittente: 'Xtrackers', ter: 0.25, perf1m: -2.57, perf6m: 18.72, perf1y: 30.71, perf5y: 84.69, tassazione: 26, quotazione: 35.20, annoNascita: 2013, capitalizzazione: 3700, variabilita: 13.5, maxDrawdown: -29.8, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'alternativa2' },
  { isin: 'LU0478205379', name: 'Xtrackers II EUR Corporate Bond UCITS ETF 1C', emittente: 'Xtrackers', ter: 0.09, perf1m: -1.05, perf6m: 0.24, perf1y: 3.24, perf5y: -0.22, tassazione: 26, quotazione: 162.50, annoNascita: 2010, capitalizzazione: 4800, variabilita: 4.6, maxDrawdown: -15.0, categoria: 'Obblig. Corp. EUR', valuta: 'EUR', hedged: false, tipo: 'alternativa1' },
  { isin: 'IE00B6R52259', name: 'iShares MSCI ACWI UCITS ETF USD (Acc)', emittente: 'iShares', ter: 0.20, perf1m: -0.59, perf6m: 6.49, perf1y: 17.99, perf5y: 69.71, tassazione: 26, quotazione: 93.40, annoNascita: 2011, capitalizzazione: 12900, variabilita: 14.1, maxDrawdown: -33.6, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'alternativa2' },
  { isin: 'IE00BGSF1X88', name: 'iShares USD Treasury Bond 0-1yr UCITS ETF (Acc)', emittente: 'iShares', ter: 0.07, perf1m: 3.16, perf6m: 2.93, perf1y: -1.76, perf5y: 21.23, tassazione: 26, quotazione: 103.20, annoNascita: 2019, capitalizzazione: 15300, variabilita: 1.2, maxDrawdown: -3.2, categoria: 'Obblig. Gov. USA', valuta: 'USD', hedged: false, tipo: 'alternativa1' },
  { isin: 'IE00B3RBWM25', name: 'Vanguard FTSE All-World UCITS ETF (USD) Distributing', emittente: 'Vanguard', ter: 0.22, perf1m: -0.57, perf6m: 6.59, perf1y: 17.95, perf5y: 68.88, tassazione: 26, quotazione: 118.50, annoNascita: 2012, capitalizzazione: 19400, variabilita: 14.1, maxDrawdown: -33.5, categoria: 'Azionario Globale', valuta: 'USD', hedged: false, tipo: 'alternativa2' },
  { isin: 'IE00B3YCGJ38', name: 'Invesco S&P 500 UCITS ETF Acc', emittente: 'Invesco', ter: 0.05, perf1m: 0.34, perf6m: 4.29, perf1y: 15.76, perf5y: 90.23, tassazione: 26, quotazione: 47.80, annoNascita: 2010, capitalizzazione: 31100, variabilita: 15.5, maxDrawdown: -33.8, categoria: 'Azionario USA', valuta: 'USD', hedged: false, tipo: 'alternativa2' },
  { isin: 'IE0031442068', name: 'iShares Core S&P 500 UCITS ETF USD (Dist)', emittente: 'iShares', ter: 0.07, perf1m: 0.24, perf6m: 4.09, perf1y: 15.57, perf5y: 88.34, tassazione: 26, quotazione: 554.00, annoNascita: 2002, capitalizzazione: 16900, variabilita: 15.5, maxDrawdown: -33.8, categoria: 'Azionario USA', valuta: 'USD', hedged: false, tipo: 'alternativa2' },
  { isin: 'IE0005042456', name: 'iShares Core FTSE 100 UCITS ETF GBP (Dist)', emittente: 'iShares', ter: 0.07, perf1m: 0.09, perf6m: 12.81, perf1y: 22.75, perf5y: 81.57, tassazione: 26, quotazione: 38.50, annoNascita: 2000, capitalizzazione: 16900, variabilita: 12.8, maxDrawdown: -26.4, categoria: 'Azionario Europa', valuta: 'GBP', hedged: false, tipo: 'alternativa2' },
];

// ── Demo portfolio di default (solo localStorage fallback) ──
const DEMO_PORTFOLIO = {
  id: 'p1', userId: 'u1', name: 'Portafoglio_Bilanciato_001',
  riskProfile: 'Bilanciato', maxUSA: 'No max', createdAt: '2024-01-15',
  etfs: ETF_MASTER.map(e => ({
    ...e, selected: ['IE00B4L5Y983','IE00B4K48X80','IE00B3F81R35','IE00B3F81409','IE00B4L5YC18'].includes(e.isin),
    acquisto: e.isin === 'IE00B4L5Y983' ? { quantita: 10, quotazioneAcquisto: 92.15, dataAcquisto: '2024-03-10' }
            : e.isin === 'IE00B4K48X80' ? { quantita: 8, quotazioneAcquisto: 68.40, dataAcquisto: '2024-03-10' }
            : e.isin === 'IE00B3F81R35' ? { quantita: 5, quotazioneAcquisto: 118.90, dataAcquisto: '2024-03-10' }
            : null
  }))
};

// ── Helper API con JWT ──
function authHeaders(token) {
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// Merge ETF con selezioni/acquisti dal DB.
// Il server ora restituisce in ogni sel: quotazione (da prezzi_storici), name, ter, perf ecc.
// ETF_MASTER rimane come override di qualità per gli ETF noti (prezzi statici aggiornati 13/03/2026).
// Priorità quotazione: prezzi_storici DB (sel.quotazione) > ETF_MASTER (statico) > 0
function mergeEtfs(selections, acquisti) {
  const masterMap = new Map(ETF_MASTER.map(e => [e.isin, e]));

  // Portafoglio vuoto → mostra catalogo completo (ETF_MASTER)
  if (selections.length === 0) {
    return ETF_MASTER.map(etf => ({ ...etf, selected: false, acquisto: null }));
  }

  // Deduplicazione per ISIN
  const seenIsins = new Set();
  return selections
    .filter(sel => {
      if (seenIsins.has(sel.isin)) return false;
      seenIsins.add(sel.isin);
      return true;
    })
    .map(sel => {
      const master = masterMap.get(sel.isin); // dati statici di qualità (ETF_MASTER)
      const acq = acquisti.find(a => a.isin === sel.isin);

      // Quotazione: preferisci il prezzo reale da DB (sel.quotazione), poi ETF_MASTER
      const quotazione = (sel.quotazione > 0)
        ? sel.quotazione
        : (master?.quotazione ?? 0);

      return {
        isin:             sel.isin,
        // nome: server embedded > ETF_MASTER > ISIN
        name:             master?.name            || sel.name             || sel.isin,
        emittente:        master?.emittente        || sel.emittente        || sel.isin.slice(0, 2),
        ter:              master?.ter              ?? sel.ter              ?? 0,
        tassazione:       master?.tassazione       ?? 26,
        quotazione,
        annoNascita:      master?.annoNascita       ?? sel.annoNascita      ?? null,
        capitalizzazione: master?.capitalizzazione ?? sel.capitalizzazione ?? 0,
        variabilita:      master?.variabilita      ?? sel.variabilita      ?? 0,
        maxDrawdown:      master?.maxDrawdown      ?? sel.maxDrawdown      ?? 0,
        categoria:        master?.categoria        || sel.categoria        || 'Altro',
        valuta:           master?.valuta           || sel.valuta           || 'EUR',
        hedged:           master?.hedged           ?? false,
        tipo:             sel.tipo                 || master?.tipo         || 'consigliato',
        perf1m:           master?.perf1m           ?? sel.perf1m           ?? 0,
        perf6m:           master?.perf6m           ?? sel.perf6m           ?? 0,
        perf1y:           master?.perf1y           ?? sel.perf1y           ?? 0,
        perf5y:           master?.perf5y           ?? sel.perf5y           ?? 0,
        selected:         !!sel.selected,
        acquisto:         acq
          ? { quantita: acq.quantita, quotazioneAcquisto: acq.quotazione_acquisto, dataAcquisto: acq.data_acquisto }
          : null,
      };
    });
}

export function AppProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || null);
  const [currentPortfolioId, setCurrentPortfolioId] = useState(null);
  const [pendingAIResult, setPendingAIResult] = useState(null); // {portfolioId, selezione, spiegazione}
  const [portfolios, setPortfolios] = useState([]);
  const [dbMode, setDbMode] = useState(false); // true = server DB, false = localStorage
  const [dbStatus, setDbStatus] = useState('checking'); // 'checking' | 'online' | 'offline'

  // ── Controlla se server è disponibile ──
  const checkServer = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) { setDbMode(true); setDbStatus('online'); return true; }
    } catch {}
    setDbMode(false); setDbStatus('offline');
    return false;
  }, []);

  // ── Al mount: verifica server e ripristina sessione ──
  useEffect(() => {
    const init = async () => {
      const online = await checkServer();
      if (online) {
        if (token) {
          try {
            const res = await fetch(`${API}/api/auth/me`, { headers: authHeaders(token) });
            if (res.ok) {
              const { user } = await res.json();
              setCurrentUser(user);
              await loadPortfoliosFromDB(token, user.id);
              return;
            }
          } catch {}
          // Token scaduto/invalido — pulisci e mostra login
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
        }
        // Server online ma nessun token → mostra schermata login (currentUser rimane null)
        return;
      }
      // Server offline → fallback localStorage con utente demo
      loadFromLocalStorage();
    };
    init();
  }, []); // eslint-disable-line

  // ── Carica portafogli dal DB ──
  const loadPortfoliosFromDB = async (tok, userId, autoSelect = false) => {
    try {
      const res = await fetch(`${API}/api/portfolios`, { headers: authHeaders(tok) });
      const dbPortfolios = await res.json();

      const full = await Promise.all(dbPortfolios.map(async (p) => {
        const [selRes, acqRes] = await Promise.all([
          fetch(`${API}/api/portfolios/${p.id}/etf-selections`, { headers: authHeaders(tok) }),
          fetch(`${API}/api/portfolios/${p.id}/acquisti`, { headers: authHeaders(tok) }),
        ]);
        const selections = await selRes.json();
        const acquisti = await acqRes.json();

        // Il server embedded già quotazione + dati catalogo in ogni selection
        return {
          id: p.id, userId, name: p.name,
          riskProfile: p.risk_profile, maxUSA: p.max_usa,
          createdAt: p.created_at?.slice(0, 10),
          etfs: mergeEtfs(selections, acquisti),
        };
      }));

      // Se nessun portafoglio nel DB, crea quello demo
      if (full.length === 0) {
        await createPortfolioDB(tok, userId, 'Portafoglio_Bilanciato_001', 'Bilanciato', 'No max');
        return;
      }
      setPortfolios(full);
      // FIX 3: autoSelect solo dopo login esplicito, NON al mount (che mostra selezione portafoglio)
      if (autoSelect && full.length === 1) setCurrentPortfolioId(full[0].id);
      // Se più portafogli o mount iniziale: lascia currentPortfolioId null → mostra PortfolioSelector
    } catch (err) {
      console.warn('Fallback localStorage:', err.message);
      loadFromLocalStorage();
    }
  };

  // ── Fallback localStorage ──
  const loadFromLocalStorage = () => {
    setDbMode(false);
    setPortfolios([DEMO_PORTFOLIO]);
    setCurrentPortfolioId('p1');
    setCurrentUser({ id: 'u1', username: 'demo', email: 'demo@email.com' });
  };

  // ── AUTH ──
  const login = async (username, password) => {
    const online = await checkServer();
    if (online) {
      try {
        const res = await fetch(`${API}/api/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error };
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setCurrentUser(data.user);
        await loadPortfoliosFromDB(data.token, data.user.id, false);

        // Check aggiornamento prezzi: se non ancora aggiornati oggi, lancia in background
        try {
          const upRes = await fetch(`${API}/api/admin/last-update`, {
            headers: { Authorization: `Bearer ${data.token}` },
          });
          const upData = await upRes.json();
          if (upData.needsUpdate) {
            console.log('[login] Prezzi non aggiornati oggi, avvio aggiornamento in background...');
            fetch(`${API}/api/admin/trigger-update`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
              body: JSON.stringify({ motivo: 'login-check' }),
            }).catch(() => {});
          }
        } catch {} // non bloccare il login se fallisce il check

        return { ok: true };
      } catch {}
    }
    // Fallback
    if (username === 'demo' && password === 'demo123') {
      loadFromLocalStorage();
      return { ok: true };
    }
    return { ok: false, error: 'Server non raggiungibile. Solo utente demo disponibile.' };
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setCurrentUser(null);
    setCurrentPortfolioId(null);
    setPortfolios([]);
  };

  const register = async (username, password, email) => {
    const online = await checkServer();
    if (!online) return { ok: false, error: 'Server non raggiungibile.' };
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error };
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setCurrentUser(data.user);
    await loadPortfoliosFromDB(data.token, data.user.id);
    return { ok: true };
  };

  const updateUser = async (userId, updates) => {
    if (dbMode && token) {
      await fetch(`${API}/api/auth/user`, {
        method: 'PUT', headers: authHeaders(token),
        body: JSON.stringify(updates),
      });
    }
    setCurrentUser(u => ({ ...u, ...updates }));
  };

  // ── PORTAFOGLI ──
  const getUserPortfolios = () => portfolios;
  const selectPortfolio = (id) => setCurrentPortfolioId(id);
  const currentPortfolio = portfolios.find(p => p.id === currentPortfolioId) || null;

  const createPortfolioDB = async (tok, userId, name, riskProfile, maxUSA, noSelect = false) => {
    const res = await fetch(`${API}/api/portfolios`, {
      method: 'POST', headers: authHeaders(tok),
      body: JSON.stringify({ name, riskProfile, maxUSA }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error };
    const newP = { id: data.id, userId, name, riskProfile, maxUSA, createdAt: new Date().toISOString().slice(0, 10), etfs: mergeEtfs([], []) };
    setPortfolios(ps => [...ps, newP]);
    if (!noSelect) setCurrentPortfolioId(data.id);
    return { ok: true, id: data.id };
  };

  const createPortfolio = async (name, riskProfile, maxUSA, noSelect = false) => {
    if (portfolios.length >= 3) return { ok: false, error: 'Massimo 3 portafogli per utente' };
    const idx = String(portfolios.length + 1).padStart(3, '0');
    const newName = (name || `Portafoglio_${riskProfile}_${idx}`).slice(0, 30);
    if (dbMode && token) return createPortfolioDB(token, currentUser.id, newName, riskProfile, maxUSA, noSelect);
    // localStorage fallback
    const newP = { id: 'p' + Date.now(), userId: currentUser.id, name: newName, riskProfile, maxUSA, createdAt: new Date().toISOString().slice(0, 10), etfs: ETF_MASTER.map(e => ({ ...e, selected: false, acquisto: null })) };
    setPortfolios(ps => [...ps, newP]);
    if (!noSelect) setCurrentPortfolioId(newP.id);
    return { ok: true, id: newP.id };
  };

  const updatePortfolio = async (id, updates) => {
    if (dbMode && token) {
      await fetch(`${API}/api/portfolios/${id}`, {
        method: 'PUT', headers: authHeaders(token), body: JSON.stringify(updates),
      });
    }
    setPortfolios(ps => ps.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const deletePortfolio = async (id) => {
    if (dbMode && token) {
      await fetch(`${API}/api/portfolios/${id}`, { method: 'DELETE', headers: authHeaders(token) });
    }
    setPortfolios(ps => ps.filter(p => p.id !== id));
    if (currentPortfolioId === id) setCurrentPortfolioId(portfolios.find(p => p.id !== id)?.id || null);
  };

  // ── ETF SELEZIONE ──
  const toggleEtfSelection = async (portfolioId, isin, forceSelected, etfObj) => {
    const portfolio = portfolios.find(p => p.id === portfolioId);
    const etf = portfolio?.etfs.find(e => e.isin === isin);

    if (!etf && etfObj) {
      // ETF non in portafoglio: aggiungilo con selected=true
      const nuovoEtf = { ...etfObj, selected: true, acquisto: null };
      setPortfolios(ps => ps.map(p => {
        if (p.id !== portfolioId) return p;
        return { ...p, etfs: [...p.etfs, nuovoEtf] };
      }));
      if (dbMode && token) {
        fetch(`${API}/api/portfolios/${portfolioId}/etf-selections`, {
          method: 'POST', headers: authHeaders(token),
          body: JSON.stringify({ isin, selected: true, tipo: etfObj.tipo || 'personalizzato' }),
        }).catch(() => {});
      }
      return;
    }

    if (!etf) return;

    const newSelected = forceSelected !== undefined ? forceSelected : !etf.selected;
    // Aggiorna state locale subito
    setPortfolios(ps => ps.map(p => {
      if (p.id !== portfolioId) return p;
      return { ...p, etfs: p.etfs.map(e => e.isin === isin ? { ...e, selected: newSelected } : e) };
    }));
    // Persisti su DB
    if (dbMode && token) {
      fetch(`${API}/api/portfolios/${portfolioId}/etf-selections`, {
        method: 'POST', headers: authHeaders(token),
        body: JSON.stringify({ isin, selected: newSelected, tipo: etf.tipo }),
      }).catch(() => {});
    }
  };

  // ── ACQUISTI ──
  const saveAcquisto = async (portfolioId, isin, acquisto) => {
    setPortfolios(ps => ps.map(p => {
      if (p.id !== portfolioId) return p;
      return { ...p, etfs: p.etfs.map(e => e.isin === isin ? { ...e, acquisto } : e) };
    }));
    if (dbMode && token) {
      fetch(`${API}/api/portfolios/${portfolioId}/acquisti`, {
        method: 'POST', headers: authHeaders(token),
        body: JSON.stringify({ isin, ...acquisto, quotazioneAcquisto: acquisto.quotazioneAcquisto }),
      }).catch(() => {});
    }
  };

  // ── APPLICA PORTAFOGLIO AI ──
  // Rimpiazza COMPLETAMENTE la lista ETF del portafoglio con solo quelli dell'AI
  const applicaPortafoglioAI = async (portfolioId, selezione, capitale) => {
    const today = new Date().toISOString().slice(0, 10);
    const masterMap = new Map(ETF_MASTER.map(e => [e.isin, e]));

    // Deduplicazione per ISIN: se stesso ISIN è sia consigliato (_selected=true) che alternativa,
    // vince sempre il consigliato — costruiamo una mappa isin→entry preferendo _selected=true
    const isinMap = new Map();
    for (const s of selezione) {
      const existing = isinMap.get(s.isin);
      if (!existing || (s._selected && !existing._selected)) {
        isinMap.set(s.isin, s); // sostituisci solo se il nuovo ha _selected=true e il vecchio no
      }
    }
    const selezioneDedup = Array.from(isinMap.values());
    console.log('[dedup] input:', selezione.length, '→ output:', selezioneDedup.length,
      '| selected:', selezioneDedup.filter(s=>s._selected).map(s=>s.isin));

    // Costruisci nuoviEtfs per lo stato locale
    const nuoviEtfs = selezioneDedup.map((s) => {
      const isSelected = !!s._selected;
      const master = masterMap.get(s.isin);
      const quotazione = s.quotazioneAcquisto || master?.quotazione || 0;
      return {
        isin: s.isin,
        name: s.name || master?.name || s.isin,
        emittente: master?.emittente || (s.name || '').split(' ')[0] || s.isin.slice(0,2),
        ter: s.ter ?? master?.ter ?? 0,
        tassazione: master?.tassazione ?? 26,
        quotazione,
        annoNascita: s.annoNascita || master?.annoNascita || null,
        capitalizzazione: s.capitalizzazione ?? master?.capitalizzazione ?? 0,
        variabilita: s.variabilita ?? master?.variabilita ?? 0,
        maxDrawdown: s.maxDrawdown ?? master?.maxDrawdown ?? 0,
        categoria: s.categoria || master?.categoria || 'Altro',
        valuta: s.valuta || master?.valuta || 'EUR',
        hedged: master?.hedged ?? false,
        tipo: s.tipo || 'consigliato',
        perf1m: s.perf1m ?? master?.perf1m ?? 0,
        perf6m: s.perf6m ?? master?.perf6m ?? 0,
        perf1y: s.perf1y ?? master?.perf1y ?? 0,
        perf5y: s.perf5y ?? master?.perf5y ?? 0,
        selected: isSelected,
        acquisto: (isSelected && capitale && s.quantita > 0 && quotazione > 0)
          ? { quantita: s.quantita, quotazioneAcquisto: quotazione, dataAcquisto: today }
          : null,
      };
    });

    // Aggiorna stato locale subito
    setPortfolios(ps => ps.map(p =>
      p.id !== portfolioId ? p : { ...p, etfs: nuoviEtfs }
    ));

    if (!dbMode || !token) return;

    // Prepara payload per endpoint atomico
    const etfsPayload = nuoviEtfs.map(e => ({
      isin: e.isin,
      selected: e.selected,
      tipo: e.tipo,
      quotazione: e.quotazione,
    }));
    const acquistiPayload = nuoviEtfs
      .filter(e => e.acquisto?.quantita > 0)
      .map(e => ({
        isin: e.isin,
        quantita: e.acquisto.quantita,
        quotazioneAcquisto: e.acquisto.quotazioneAcquisto,
        dataAcquisto: today,
      }));
    const prezziPayload = nuoviEtfs
      .filter(e => e.quotazione > 0)
      .map(e => ({ isin: e.isin, prezzo: e.quotazione }));

    console.log(`[applicaPortafoglioAI] Invio ${etfsPayload.length} ETF (${etfsPayload.filter(e=>e.selected).length} selected) al server...`);

    // UNA sola chiamata — transazione atomica server-side
    const res = await fetch(`${API}/api/portfolios/${portfolioId}/apply-ai`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ etfs: etfsPayload, acquisti: acquistiPayload, prezzi: prezziPayload }),
    }).catch(err => { console.error('[apply-ai] fetch error:', err); return null; });

    if (res?.ok) {
      const result = await res.json();
      console.log(`[apply-ai] DB conferma: ${result.etfsInDB} ETF, ${result.selezionatiInDB} selected`);
    } else {
      console.error('[apply-ai] Errore server:', res?.status);
    }

    // Rileggi da DB per sincronizzare UI con stato reale
    await loadPortfoliosFromDB(token, currentUser?.id);
  };

  // ── AGGIORNA PREZZI ──
  const aggiornaPrezziBatch = async (portfolioId) => {
    const portfolio = portfolios.find(p => p.id === portfolioId);
    if (!portfolio) return { ok: false, error: 'Portafoglio non trovato' };
    const isins = [...new Set(portfolio.etfs.map(e => e.isin))];
    const authHdr = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    try {
      // 1. Forza fetch Yahoo per ogni ETF del portafoglio
      await fetch(`${API}/api/etf-catalog/admin/trigger-update`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ motivo: 'manual', isins }),
      }).catch(() => {});

      // 2. Aspetta 4 secondi che il server aggiorni
      await new Promise(r => setTimeout(r, 4000));

      // 3. Rileggi prezzi aggiornati
      const res = await fetch(`${API}/api/etf-catalog/batch`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ isins }),
      });
      const risultatiArr = await res.json();

      // 4. Converti array → mappa per isin
      const risultati = {};
      (Array.isArray(risultatiArr) ? risultatiArr : []).forEach(r => {
        if (r.isin) risultati[r.isin] = r;
      });

      // 5. Aggiorna in memoria
      setPortfolios(ps => ps.map(p => {
        if (p.id !== portfolioId) return p;
        return {
          ...p, etfs: p.etfs.map(e => {
            const r = risultati[e.isin];
            if (!r || !r.quotazione) return e;
            return { ...e, quotazione: r.quotazione, perf1m: r.perf1m ?? e.perf1m, perf6m: r.perf6m ?? e.perf6m, perf1y: r.perf1y ?? e.perf1y, perf5y: r.perf5y ?? e.perf5y };
          })
        };
      }));

      const aggiornati = Object.values(risultati).filter(r => r.quotazione > 0).length;
      return { ok: true, trovati: aggiornati, totale: isins.length };
    } catch (e) {
      return { ok: false, error: 'Errore: ' + e.message };
    }
  };

  const getMinusvalenze = async (portfolioId) => {
    if (!dbMode || !token) return { saldo: 0, manuali: [] };
    try {
      const res = await fetch(`${API}/api/portfolios/${portfolioId}/minusvalenze`, { headers: authHeaders(token) });
      return res.ok ? await res.json() : { saldo: 0, manuali: [] };
    } catch { return { saldo: 0, manuali: [] }; }
  };

  const salvaMinusvalenzaManuale = async (portfolioId, importo, data_scadenza, note, condivisa = true) => {
    if (!dbMode || !token) return { ok: false };
    const res = await fetch(`${API}/api/portfolios/${portfolioId}/minusvalenze/manuali`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ importo, data_scadenza, note, condivisa }),
    });
    return res.ok ? await res.json() : { ok: false };
  };

  const eliminaMinusvalenzaManuale = async (portfolioId, mid) => {
    if (!dbMode || !token) return { ok: false };
    const res = await fetch(`${API}/api/portfolios/${portfolioId}/minusvalenze/manuali/${mid}`, {
      method: 'DELETE', headers: authHeaders(token),
    });
    return res.ok ? await res.json() : { ok: false };
  };
  const registraVendita = async (portfolioId, isin, quantita_venduta, quotazione_vendita, data_vendita, note) => {
    if (!dbMode || !token) return { ok: false, error: 'Richiede connessione al server' };
    try {
      const res = await fetch(`${API}/api/portfolios/${portfolioId}/vendite`, {
        method: 'POST', headers: authHeaders(token),
        body: JSON.stringify({ isin, quantita_venduta, quotazione_vendita, data_vendita, note }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error };
      // Aggiorna stato locale
      await loadPortfoliosFromDB(token, currentUser?.id);
      return { ok: true, ...data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  const getVendite = async (portfolioId) => {
    if (!dbMode || !token) return [];
    try {
      const res = await fetch(`${API}/api/portfolios/${portfolioId}/vendite`, { headers: authHeaders(token) });
      return res.ok ? await res.json() : [];
    } catch { return []; }
  };

  const annullaVendita = async (portfolioId, vendita_id) => {
    if (!dbMode || !token) return { ok: false };
    try {
      const res = await fetch(`${API}/api/portfolios/${portfolioId}/vendite/${vendita_id}`, {
        method: 'DELETE', headers: authHeaders(token),
      });
      const data = await res.json();
      if (data.ok) await loadPortfoliosFromDB(token, currentUser?.id);
      return data;
    } catch { return { ok: false }; }
  };

  return (
    <AppContext.Provider value={{
      currentUser, currentPortfolio, currentPortfolioId,
      dbMode, dbStatus, token,
      pendingAIResult, setPendingAIResult,
      login, logout, register, updateUser,
      getUserPortfolios, selectPortfolio,
      createPortfolio, updatePortfolio, deletePortfolio,
      toggleEtfSelection, saveAcquisto, aggiornaPrezziBatch, applicaPortafoglioAI, loadPortfoliosFromDB,
      registraVendita, getVendite, annullaVendita,
      getMinusvalenze, salvaMinusvalenzaManuale, eliminaMinusvalenzaManuale,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
