const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const authMiddleware = require('../middleware/auth');
const { log, EVENTI } = require('./logger');
console.log('[AI-FILE] caricato da:', __filename, 'righe totali:', require('fs').readFileSync(__filename,'utf8').split('\n').length);

const getAnthropic = () => {
  // Estrae ANTHROPIC_API_KEY dal valore di Var_002 (formato: "ANTHROPIC_API_KEY = sk-ant-...")
  let key = process.env.ANTHROPIC_API_KEY;
  if (!key && process.env.Var_002) {
    const match = process.env.Var_002.match(/ANTHROPIC_API_KEY\s*=\s*(sk-ant-[\w\-]+)/);
    if (match) key = match[1];
  }
  console.log('[AI] key trovata:', !!key, 'lunghezza:', key?.length);
  return new Anthropic({ apiKey: key });
};

const REGOLE_PROFILO = {
  Prudente: {
    rendimentoMin: 'inflazione +2% (rendimento netto minimo atteso ~4% annuo con inflazione IT al 2%)',
    rendimentoMax: 'inflazione +3.5%',
    minETF: 4, maxETF: 6, azionarioTarget: 25, azionarioRange: 10,
    terMax: 1.0, terPreferito: 0.5, capMin: 300,
    maxDrawdown: -25, maxDrawdownAbs: 25, volatilita: 16,
    hedged: 'preferire sempre prodotti hedged per valute non EUR',
    note: 'Inflazione italiana attuale ~2% — il portafoglio DEVE battere inflazione di almeno 2 punti. Privilegiare ETF obbligazionari con yield >3.5% e una quota azionaria difensiva (es. dividend, low volatility, healthcare).',
  },
  Bilanciato: {
    rendimentoMin: 'inflazione +2.5%', rendimentoMax: 'inflazione +5%',
    minETF: 5, maxETF: 8, azionarioTarget: 50, azionarioRange: 10,
    terMax: 1.8, terPreferito: 1.4, capMin: 200,
    maxDrawdown: -18,   // max drawdown 1y per singolo ETF: ≤18% in valore assoluto
    maxDrawdownAbs: 18, // valore positivo per display nei prompt
    volatilita: 15,     // vol media PONDERATA portafoglio ≤15%
    hedged: 'per max 50% degli ETF con valuta non EUR preferire hedged',
    note: 'Vol media ponderata portafoglio ≤15%. Azionario 40-60%. Max drawdown singolo ETF ≤18% (1y). Oro max 5%.',
  },
  Aggressivo: {
    rendimentoMin: 'inflazione +4.5%', rendimentoMax: 'inflazione +8%',
    minETF: 6, maxETF: 10, azionarioTarget: 80, azionarioRange: 10,
    terMax: 2.5, terPreferito: 2.0, capMin: 10,
    maxDrawdown: null, volatilita: null,
    hedged: 'per max 20% degli ETF con valuta non EUR preferire hedged',
  },
};

// ── Rendimento minimo per profilo (% annuo netto stimato) ─────────────────
const RENDIMENTO_MIN_PROFILO = {
  Prudente:   3.5,  // inflazione ~2% + 2% min = ~4%, netto ~3.5%
  Bilanciato: 4.5,  // inflazione ~2% + 2.5% min = ~4.5%
  Aggressivo: 6.0,  // inflazione ~2% + 4% min = ~6%
};

// Verifica se rendimento medio pesato bucket rispetta il minimo di profilo
function verificaRendimentoComplessivo(buckets, profilo) {
  if (!buckets || buckets.length < 2) return { ok: true, nota: '' };
  const bBrv = buckets.find(b => b.tipo === 'BREVE');
  const bLng = buckets.find(b => b.tipo === 'LUNGO');
  if (!bBrv || !bLng) return { ok: true, nota: '' };

  const pctB = bBrv.pct_allocazione / 100;
  const pctL = bLng.pct_allocazione / 100;
  const rendB = bBrv.rendimento_target_annuo || RENDIMENTO_MIN_PROFILO[profilo] * 0.6;
  const rendL = bLng.rendimento_target_annuo || RENDIMENTO_MIN_PROFILO[profilo] * 1.3;
  const rendMin = RENDIMENTO_MIN_PROFILO[profilo] || 4.0;

  const rendPesato = (pctB * rendB) + (pctL * rendL);
  const ok = rendPesato >= rendMin;

  return {
    ok,
    rendPesato: parseFloat(rendPesato.toFixed(2)),
    rendMin,
    nota: ok
      ? `Rendimento complessivo atteso ~${rendPesato.toFixed(1)}% >= minimo profilo ${rendMin}%`
      : `⚠️ ATTENZIONE: rendimento complessivo atteso ~${rendPesato.toFixed(1)}% < minimo profilo ${rendMin}%. Il bucket LUNGO deve compensare rendendo almeno ${((rendMin - pctB * rendB) / pctL).toFixed(1)}% annuo.`,
    targetLungoMinimo: parseFloat(((rendMin - pctB * rendB) / pctL).toFixed(2)),
  };
}

// ── Assegnazione automatica ETF ai bucket ────────────────────────────────
function assegnaBucketAutomatico(etf) {
  const cat  = (etf.categoria || '').toLowerCase();
  const name = (etf.name || '').toLowerCase();
  const sb   = (etf.smartBeta || '').toLowerCase();

  // BREVE: monetario/liquidità
  if (cat.includes('monetar') || cat.includes('liquidit')) return 'BREVE';
  if (name.includes('ultra-short') || name.includes('overnight') || name.includes('eonia') || name.includes('money market')) return 'BREVE';

  // BREVE: obbligazionario breve — controlla categoria E nome
  if (cat.includes('obblig') || cat.includes('government') || cat.includes('corporate')) {
    const isBreve = cat.includes('1-3') || cat.includes('1-5') || cat.includes('0-3') || cat.includes('breve') || cat.includes('short')
      || name.includes('1-3') || name.includes('1-5') || name.includes('0-3') || name.includes('short')
      || name.includes('1-3y') || name.includes('1-5y') || name.includes('0-3y');
    if (isBreve) return 'BREVE';
  }

  // BREVE: Smart Beta difensivi
  if (sb === 'low volatility' || sb === 'dividend') return 'BREVE';

  // LUNGO: azionario, tematico, emergenti, commodity, oro
  if (cat.includes('azionario') || cat.includes('equity') || cat.includes('tematico') || cat.includes('emergenti')) return 'LUNGO';
  if (cat.includes('oro') || cat.includes('commodity') || cat.includes('real asset') || cat.includes('metalli')) return 'LUNGO';
  if (sb === 'momentum' || sb === 'small cap' || sb === 'value') return 'LUNGO';

  return 'LUNGO';
}

// ── Descrizione testuale bucket per prompt ─────────────────────────────────
function descrizioneBucket(bucket, profilo, macroData, filosofia) {
  const orizzLabel = bucket.orizzonte_anni <= 4 ? 'BREVE' : bucket.orizzonte_anni >= 10 ? 'LUNGO' : 'MEDIO';
  const regoleBucket = {
    BREVE: {
      difensiva: {
        Prudente:   'BUCKET DIFENSIVO 🛡️: Protezione capitale con rendimento cedolare. DEVI scegliere ETF obbligazionari con duration 1-5 anni: Gov EUR 1-3Y, Corporate IG EUR 1-3Y, Inflation-Linked breve. 🚫 VIETATO: monetario overnight, ultra-short (duration < 1 anno), JPMorgan Ultra-Short, qualsiasi ETF con "Ultra-Short", "Overnight", "0-3M" nel nome. Max azionario 0%.',
        Bilanciato: 'BUCKET DIFENSIVO 🛡️: Stabilità con cedola. DEVI scegliere ETF obbligazionari con duration 1-5 anni: Gov EUR 1-3Y, Corporate IG EUR 1-5Y, Inflation-Linked. 🚫 VIETATO: monetario overnight, ultra-short (duration < 1 anno), JPMorgan Ultra-Short. Opzionalmente Low Volatility equity max 25%.',
        Aggressivo: 'BUCKET DIFENSIVO 🛡️: Riserva stabile con rendimento cedolare. DEVI scegliere ETF obbligazionari con duration 1-3 anni: Gov EUR 1-3Y (es. Xtrackers EUR Govt 1-3Y, iShares EUR Govt 1-3Y), Corporate IG EUR breve. 🚫 VIETATO: monetario overnight, ultra-short (duration < 1 anno), JPMorgan Ultra-Short IE00BD9MMF62, qualsiasi ETF con "Ultra-Short", "Overnight", "0-3M" nel nome.',
      },
      opportunistica: {
        Prudente:   'BUCKET OPPORTUNISTICO ⚡: Liquidità tattica massima. DEVI scegliere SOLO ETF monetari EUR (overnight, ultra-short, 0-3 mesi): JPMorgan Ultra-Short, Amundi Overnight, Xtrackers Overnight. NON usare obbligazionario a duration > 1Y. Pronto per acquisti rapidi su cali.',
        Bilanciato: 'BUCKET OPPORTUNISTICO ⚡: Polvere da sparo tattica. DEVI scegliere SOLO ETF monetari EUR puri (overnight/ultra-short 0-3 mesi). Con VIX >25 entra su azionario. NON usare obbligazionario a duration > 1Y.',
        Aggressivo: 'BUCKET OPPORTUNISTICO ⚡: Polvere da sparo per acquisti a sconto su crisi (VIX >25). DEVI scegliere SOLO ETF monetari EUR puri (overnight, ultra-short): JPMorgan Ultra-Short EUR IE00BD9MMF62, Amundi EUR Overnight. NON usare obbligazionario a duration > 1Y.',
      },
    },
    LUNGO: {
      difensiva: {
        Prudente:   'Crescita prudente. Azionario difensivo (Quality, Dividend), obblig. medio-lungo. Max azionario 35%.',
        Bilanciato: 'Crescita bilanciata. Mix azionario globale e obblig. Fattori Value/Quality. Azionario 50-70%.',
        Aggressivo: 'Massimizzazione. Azionario globale, emergenti, tematici, Small Cap, Momentum. Azionario 80%+.',
      },
      opportunistica: {
        Prudente:   'Crescita prudente con tilt difensivo. Azionario Quality e Dividend, obblig. medio termine.',
        Bilanciato: 'Mix azionario e obbligazionario. Mantieni esposizione per il rialzo di lungo periodo mentre il bucket breve aspetta opportunità.',
        Aggressivo: 'Azionario aggressivo globale, emergenti, tematici. Questo è il motore di rendimento mentre il bucket breve aspetta opportunità di acquisto.',
      },
    },
  };
  const fil = filosofia || 'difensiva';
  const regola = regoleBucket[orizzLabel]?.[fil]?.[profilo]
    || regoleBucket[orizzLabel]?.difensiva?.[profilo]
    || 'Parametri standard del profilo.';
  return `Bucket ${bucket.tipo} (${bucket.pct_allocazione}% capitale | Orizzonte: ${bucket.orizzonte_anni} anni | Filosofia: ${fil.toUpperCase()})
Regole: ${regola}
Target rendimento: ${bucket.rendimento_target_annuo ? bucket.rendimento_target_annuo + '% annuo' : 'non specificato (usa minimo profilo)'}`;
}

// ── Posizionamento tattico: matrice profilo × orizzonte × macro ──────────
function getPosizionetattica(profilo, orizzonteAnni, macro) {
  // Supporta sia valori numerici che etichette BREVE/MEDIO/LUNGO
  let anni;
  if (orizzonteAnni === 'BREVE') anni = 3;
  else if (orizzonteAnni === 'MEDIO') anni = 7;
  else if (orizzonteAnni === 'LUNGO') anni = 15;
  else anni = parseInt(orizzonteAnni) || 7;
  const breve = anni <= 3;
  const lungo = anni > 7;

  // Estrai indicatori macro rilevanti
  const vix = parseFloat(macro?.vix) || 20;
  const tassoFed = parseFloat(macro?.tassoFed) || 4.5;
  const tassoBce = parseFloat(macro?.tassoBce) || 3.0;
  const inflEU = parseFloat(macro?.inflEU) || 2.0;
  const inflUSA = parseFloat(macro?.inflUSA) || 3.0;
  const brent = parseFloat(macro?.brent) || 80;
  const spread = parseFloat(macro?.spreadBtp) || 120;
  const curva = parseFloat(macro?.curvaUSA) || 0; // 10Y-5Y in %

  // Scenari macro chiave
  const vixAlto = vix > 25;
  const vixMoltoAlto = vix > 35;
  const tassiAlti = tassoFed > 4.0 || tassoBce > 3.0;
  const tassiRischioRialzo = tassiAlti && brent > 85 && inflUSA > 3.0; // stagflazione latente
  const tagliAttesi = tassoFed < 4.0 || tassoBce < 3.0;
  const inflazioneAlta = inflEU > 3.0 || inflUSA > 3.5;
  const petrolioCaldo = brent > 90;
  const curvaNormale = curva > 0.3;
  const curvaInvertita = curva < -0.1;
  const spreadElevato = spread > 200;

  // Determina scenario prevalente
  let scenario = 'NEUTRO';
  if (tassiRischioRialzo) scenario = 'STAGFLAZIONE_LATENTE';
  else if (vixMoltoAlto) scenario = 'CRISI_MERCATI';
  else if (vixAlto && !tassiAlti) scenario = 'VOLATILITA_ELEVATA';
  else if (tagliAttesi && !inflazioneAlta) scenario = 'EASING_CICLO';
  else if (inflazioneAlta && !tassiAlti) scenario = 'INFLAZIONE_SURRISCALDATA';
  else if (petrolioCaldo) scenario = 'SHOCK_PETROLIO';
  else if (curvaInvertita) scenario = 'RECESSIONE_RISCHIO';
  else if (curvaNormale && !vixAlto) scenario = 'ESPANSIONE';

  // Matrice posizionamento per profilo + orizzonte + scenario
  const matrice = {
    STAGFLAZIONE_LATENTE: {
      Prudente: {
        breve: 'SCENARIO ATTUALE: tassi fermi con rischio rialzo (petrolio/guerra). PROTEGGITI: duration brevissima (1-2Y), inflation-linked EUR, monetario EUR overnight. EVITA: obbligazioni lungo termine, azionario growth. La BCE potrebbe non tagliare — non scommettere su duration.',
        medio: 'CAUTELA: mantieni obbligazioni breve-medio termine, quota inflation-linked. Azionario difensivo (healthcare, consumer staples, utility). Riduci esposizione tech e growth.',
        lungo: 'Scenario passeggero a lungo termine. Mantieni mix standard con quota inflation-linked. Azionario difensivo in sovrappeso rispetto a growth.',
      },
      Bilanciato: {
        breve: 'SCENARIO ATTUALE: tassi fermi con rischio rialzo. BILANCIA: 40% obblig. breve/inflation-linked, 30% azionario difensivo (energy, healthcare, commodity ETF), 30% monetario. RIDUCI: growth puro, tech, real estate.',
        medio: 'Mix difensivo-ciclico: energy ETF beneficia da petrolio alto, inflation-linked per protezione, azionario value e dividend. Riduci duration obbligazionaria.',
        lungo: 'Gestisci con calma. Quota commodity/energy in sovrappeso tattico. Azionario globale con tilt value.',
      },
      Aggressivo: {
        breve: 'SCENARIO ATTUALE: tassi fermi con rischio rialzo — OPPORTUNITA SELETTIVE. SOVRAPPESA: energy ETF (Brent alto), commodity, azionario value europeo, real assets. RIDUCI: tech growth puro, obbligazioni. In questo contesto il rischio è asimmetrico: chi sale guadagna molto.',
        medio: 'Tilt tattico verso value, energy, financials (beneficiano da tassi alti). Mantieni azionario globale. Riduci duration. Crypto/tematici ad alto beta solo con stop mentali.',
        lungo: 'Ciclo passeggero. Mantieni mix aggressivo standard con tilt verso inflation-resistant assets.',
      },
    },
    CRISI_MERCATI: {
      Prudente: { breve: 'VIX >35: massima difesa. Monetario EUR, obbligazioni governative breve, zero azionario se possibile. Attendi stabilizzazione.', medio: 'Crisi in corso: riduci azionario al minimo profilo, aumenta cash e obblig. gov. breve.', lungo: 'Le crisi sono temporanee su orizzonti lunghi. Mantieni esposizione, evita vendite in panico.' },
      Bilanciato: { breve: 'VIX >35: riduzione tattica azionario -10% dal target. Aumenta monetario. Niente acquisti aggressivi.', medio: 'Mantieni profilo ma con tilt difensivo. Opportunità in obblig. corp. investment grade.', lungo: 'Occasion di ribilanciamento. Mantieni o aumenta azionario se prezzi scendono molto.' },
      Aggressivo: { breve: 'VIX >35: le crisi profonde sono opportunità per l aggressivo. Tieni liquidità pronta per entrare su cali. Obbligazioni ZERO. Azionario globale e tematici su livelli bassi.', medio: 'Accumula su cali. Tematici AI, tech, emergenti a sconto.', lungo: 'Massima opportunità storica. Aumenta esposizione su cali prolungati.' },
    },
    EASING_CICLO: {
      Prudente: { breve: 'Tagli tassi: prolunga leggermente duration (3-5Y). Obbligazioni corporate investment grade beneficiano. Mantieni quota azionario difensivo.', medio: 'Contesto favorevole per obbligazioni. Allunga duration progressivamente.', lungo: 'Ottimo per obbligazioni lungo termine. Mantieni mix standard.' },
      Bilanciato: { breve: 'Tagli tassi: favorisce azionario growth e obbligazioni. Sovrappesa growth/tech moderatamente. Allunga duration.', medio: 'Ciclo espansivo: aumenta azionario verso upper range. Tech e growth in sovrappeso.', lungo: 'Contesto molto favorevole. Massimizza azionario nel range del profilo.' },
      Aggressivo: { breve: 'Tagli tassi = carburante per azionario growth. SOVRAPPESA: tech, growth, emergenti, tematici (AI, clean energy). Riduci obbligazioni al minimo.', medio: 'Ciclo rialzista. Massima esposizione azionario. Tematici e emergenti.', lungo: 'Espansione sostenuta. Azionario globale, emergenti, tematici. Niente obbligazioni.' },
    },
    SHOCK_PETROLIO: {
      Prudente:   { breve: 'Petrolio alto: inflazione importata in arrivo. PROTEGGITI: inflation-linked EUR, obblig. breve, monetario. EVITA: azionario ciclico, trasporti, consumer discretionary. Oro come hedge reale.', medio: 'Impatto transitorio sul medio termine. Mantieni quota inflation-linked, riduci duration. Azionario difensivo (utility, healthcare).', lungo: 'Lo shock petrolifero si riassorbe a lungo termine. Mix standard con piccola quota commodity come hedge.' },
      Bilanciato: { breve: 'Petrolio alto: favorisce energy ETF e commodity. SOVRAPPESA: energy, commodity, inflation-linked. RIDUCI: consumer discretionary, trasporti. Oro max 10% come hedge.', medio: 'Tilt verso value e dividend. Energy in sovrappeso tattico. Obbligazioni breve-medio termine.', lungo: 'Ciclo passeggero. Mantieni mix bilanciato con tilt commodity/energy.' },
      Aggressivo: { breve: 'Petrolio alto = opportunità energy. MASSIMIZZA: ETF energy, commodity, azionario value. Riduci obbligazioni. Oro per diversificazione.', medio: 'Energy e commodity in forte sovrappeso. Azionario globale con tilt value.', lungo: 'Mantieni aggressivo standard, energia come alpha tattico.' },
    },
    VOLATILITA_ELEVATA: {
      Prudente:   { breve: 'VIX >25: aumenta difensività. Monetario EUR, obblig. gov. breve. Riduci azionario verso lower bound del range.', medio: 'Volatilità elevata ma non crisi. Mantieni profilo, privilegia ETF Low Volatility e Quality.', lungo: 'Volatilità transitoria. Mantieni mix standard, non vendere.' },
      Bilanciato: { breve: 'VIX >25: tilt difensivo. Low Volatility e Dividend in sovrappeso. Riduci azionario ciclico.', medio: 'Selettività aumentata. Privilegia Quality e Low Volatility. Mantieni obblig. investment grade.', lungo: 'Opportunità di ribilanciamento. Mantieni esposizione azionaria.' },
      Aggressivo: { breve: 'VIX >25: attenzione selettiva. Riduci beta, aumenta Quality. Mantieni liquidità per opportunità.', medio: 'Volatilità crea occasioni. Accumula su cali. Tematici selettivi.', lungo: 'Mantieni aggressivo. La volatilità è normale su orizzonti lunghi.' },
    },
    INFLAZIONE_SURRISCALDATA: {
      Prudente:   { breve: 'Inflazione alta senza tassi alti: situazione anomala. Inflation-linked EUR obbligatorio. Evita obblig. nominali lungo termine. Oro come riserva di valore.', medio: 'Privilegia asset reali: inflation-linked, commodity ETF, real estate. Riduci nominali.', lungo: 'Inflazione transitoria a lungo termine. Mantieni mix con quota inflation-linked.' },
      Bilanciato: { breve: 'Inflazione alta: sovrappesa inflation-linked, commodity, real asset. Riduci obblig. nominali. Azionario value e dividend resistono meglio.', medio: 'Tilt verso asset reali e value. Energy e commodity come hedge inflazione.', lungo: 'Mix standard con quota commodity/inflation-linked per protezione.' },
      Aggressivo: { breve: 'Inflazione alta senza tassi alti = rally commodity e real asset. SOVRAPPESA: commodity, energy, real estate ETF. Tech e growth sotto pressione.', medio: 'Value e commodity in sovrappeso. Riduci duration obbligazionaria.', lungo: 'Mantieni aggressivo con tilt verso inflation-resistant assets.' },
    },
    RECESSIONE_RISCHIO: {
      Prudente:   { breve: 'Curva invertita: rischio recessione. MASSIMA DIFESA: obblig. gov. breve, monetario. Azionario al minimo del range. Quality e Low Volatility obbligatori.', medio: 'Recessione possibile: aumenta duration obbligazionaria (i tagli tassi sono vicini). Riduci azionario ciclico.', lungo: 'Le recessioni creano opportunità. Mantieni esposizione azionaria con tilt difensivo.' },
      Bilanciato: { breve: 'Curva invertita: tilt difensivo forte. Quality, Low Volatility, obblig. gov. medio termine. Riduci ciclici e small cap.', medio: 'Posizionati per tagli tassi: allunga duration obbligazionaria. Mantieni azionario difensivo.', lungo: 'Mantieni mix bilanciato. La recessione è un ciclo, non un trend.' },
      Aggressivo: { breve: 'Curva invertita: riduci beta. Quality over Momentum. Mantieni liquidità per entrare su minimi.', medio: 'Posizionati per la ripresa post-recessione. Accumula azionario globale su cali.', lungo: 'Massima opportunità storica. Accumula aggressivamente su cali.' },
    },
    ESPANSIONE: {
      Prudente:   { breve: 'Contesto espansivo con bassa volatilità. Mix standard del profilo. Puoi allungare leggermente la duration obbligazionaria.', medio: 'Ottimo per obbligazioni e azionario difensivo. Mantieni mix standard.', lungo: 'Fase espansiva favorevole. Mix standard ottimale.' },
      Bilanciato: { breve: 'Espansione con bassa volatilità: contesto ideale. Azionario verso upper bound del range. Momentum e Quality in sovrappeso.', medio: 'Contesto molto favorevole. Massimizza azionario nel range. Growth e Momentum premiati.', lungo: 'Fase espansiva prolungata. Mantieni azionario alto, diversificazione geografica.' },
      Aggressivo: { breve: 'Espansione con bassa volatilità: massima esposizione. Growth, Momentum, tematici. Obbligazioni al minimo.', medio: 'Condizioni ideali per aggressivo. Azionario globale, emergenti, tematici ad alto beta.', lungo: 'Espansione = massima opportunità. Azionario globale diversificato, zero obbligazioni.' },
    },
    NEUTRO: {
      Prudente: { breve: 'Contesto neutro. Applica regole standard del profilo.', medio: 'Standard.', lungo: 'Standard.' },
      Bilanciato: { breve: 'Contesto neutro. Mix standard.', medio: 'Standard.', lungo: 'Standard.' },
      Aggressivo: { breve: 'Contesto neutro. Azionario globale diversificato, tematici selettivi.', medio: 'Standard aggressivo.', lungo: 'Standard aggressivo.' },
    },
  };

  const fascia = breve ? 'breve' : lungo ? 'lungo' : 'medio';
  const profil = matrice[scenario] || matrice.NEUTRO;
  const posiz = profil[profilo] || profil.Bilanciato;
  const testo = posiz[fascia] || posiz.medio;

  return {
    scenario,
    testo,
    fascia,
    indicatori: { vix, tassoFed, tassoBce, inflEU, inflUSA, brent, spread, curva },
  };
}

// ── Fattori Smart Beta consigliati per scenario macro ────────────────────
function getSmartBetaSuggeriti(profilo, scenario, fascia) {
  // Matrice: scenario → fattori pro-ciclici vs difensivi
  const PROCICLIC  = ['Value', 'Momentum', 'Small Cap'];
  const DIFENSIVI  = ['Low Volatility', 'Quality', 'Dividend'];
  const NEUTRI     = ['Equal Weight', 'Multi-Factor'];

  const map = {
    STAGFLAZIONE_LATENTE: {
      Prudente:   { preferiti: ['Low Volatility', 'Quality', 'Dividend'], evitare: ['Momentum', 'Small Cap'] },
      Bilanciato: { preferiti: ['Value', 'Low Volatility', 'Dividend'], evitare: ['Small Cap', 'Momentum'] },
      Aggressivo: { preferiti: ['Value', 'Momentum'], evitare: ['Low Volatility'] },
    },
    CRISI_MERCATI: {
      Prudente:   { preferiti: ['Low Volatility', 'Quality'], evitare: ['Momentum', 'Small Cap', 'Value'] },
      Bilanciato: { preferiti: ['Quality', 'Low Volatility'], evitare: ['Small Cap', 'Momentum'] },
      Aggressivo: { preferiti: ['Momentum', 'Value'], evitare: ['Low Volatility'] },
    },
    EASING_CICLO: {
      Prudente:   { preferiti: ['Quality', 'Dividend'], evitare: ['Small Cap'] },
      Bilanciato: { preferiti: ['Momentum', 'Quality', 'Value'], evitare: [] },
      Aggressivo: { preferiti: ['Momentum', 'Small Cap', 'Value'], evitare: ['Low Volatility', 'Quality'] },
    },
    ESPANSIONE: {
      Prudente:   { preferiti: ['Quality', 'Dividend'], evitare: [] },
      Bilanciato: { preferiti: ['Momentum', 'Value', 'Quality'], evitare: [] },
      Aggressivo: { preferiti: ['Momentum', 'Small Cap', 'Value'], evitare: [] },
    },
    RECESSIONE_RISCHIO: {
      Prudente:   { preferiti: ['Low Volatility', 'Quality', 'Dividend'], evitare: ['Small Cap', 'Value', 'Momentum'] },
      Bilanciato: { preferiti: ['Quality', 'Low Volatility'], evitare: ['Small Cap', 'Momentum'] },
      Aggressivo: { preferiti: ['Quality', 'Value'], evitare: ['Momentum', 'Small Cap'] },
    },
    NEUTRO: {
      Prudente:   { preferiti: ['Quality', 'Low Volatility', 'Dividend'], evitare: [] },
      Bilanciato: { preferiti: ['Multi-Factor', 'Quality'], evitare: [] },
      Aggressivo: { preferiti: ['Momentum', 'Value', 'Multi-Factor'], evitare: [] },
    },
  };

  const scenarioMap = map[scenario] || map.NEUTRO;
  const result = scenarioMap[profilo] || scenarioMap.Bilanciato;

  // Modifica per orizzonte breve: privilegia sempre difensivi anche per Aggressivo
  if (fascia === 'breve' && profilo !== 'Aggressivo') {
    return { preferiti: ['Low Volatility', 'Quality', 'Dividend'], evitare: ['Small Cap', 'Momentum'] };
  }

  return result;
}

// ── Modulazione regole per orizzonte temporale ───────────────────────────
function modulaRegolePerOrizzonte(regoleBase, orizzonteAnni) {
  // Supporta sia valori numerici che etichette BREVE/MEDIO/LUNGO
  let anni;
  if (orizzonteAnni === 'BREVE') anni = 3;
  else if (orizzonteAnni === 'MEDIO') anni = 7;
  else if (orizzonteAnni === 'LUNGO') anni = 15;
  else anni = parseInt(orizzonteAnni) || 7;
  const r = { ...regoleBase };

  if (anni <= 3) {
    // BREVE: più conservativo, meno azionario, più stringente su volatilità e drawdown
    r.azionarioTarget = Math.max(r.azionarioTarget - 10, regoleBase.azionarioTarget - regoleBase.azionarioRange); // non scendere sotto il minimo del profilo
    r.azionarioRange = Math.max(5, (r.azionarioRange || 10) - 2);
    if (r.maxDrawdownAbs) r.maxDrawdownAbs = Math.max(10, r.maxDrawdownAbs - 5);
    if (r.maxDrawdown) r.maxDrawdown = Math.min(-10, r.maxDrawdown + 5);
    if (r.volatilita) r.volatilita = Math.max(8, r.volatilita - 3);
    r.noteOrizzonte = `Orizzonte BREVE (${anni} anni): quota azionaria ridotta ma NON sotto il minimo del profilo (${regoleBase.azionarioTarget - regoleBase.azionarioRange}%). Privilegia obbligazionario breve duration (1-3Y), liquidità EUR, bassa volatilità.`;
    r.durataObbligaz = 'breve (1-3 anni)';
    r.pesoCategoriePreferite = 'Obblig. Gov. EUR 1-3Y, Liquidità EUR, Obblig. Corp. EUR breve';
    r.pesoMacro = 'ALTO — contesto tassi e inflazione molto rilevante a breve';
  } else if (anni <= 7) {
    // MEDIO: regole standard, nessuna modifica
    r.noteOrizzonte = `Orizzonte MEDIO (${anni} anni): parametri standard del profilo. Mix bilanciato tra crescita e stabilità.`;
    r.durataObbligaz = 'medio (3-7 anni)';
    r.pesoCategoriePreferite = 'Mix standard del profilo';
    r.pesoMacro = 'MEDIO — contesto macro rilevante ma non determinante';
  } else {
    // LUNGO: più aggressivo, più azionario tollerato, volatilità meno vincolante
    r.azionarioTarget = Math.min(95, r.azionarioTarget + 5);
    if (r.maxDrawdownAbs) r.maxDrawdownAbs = Math.min(40, r.maxDrawdownAbs + 5);
    if (r.maxDrawdown) r.maxDrawdown = Math.max(-40, r.maxDrawdown - 5);
    if (r.volatilita) r.volatilita = Math.min(25, r.volatilita + 3);
    r.noteOrizzonte = `Orizzonte LUNGO (${anni} anni): quota azionaria leggermente aumentata, volatilità breve tollerata, privilegia crescita a lungo termine. Il mercato ha tempo di recuperare eventuali cali.`;
    r.durataObbligaz = 'lungo (7+ anni) o nessun vincolo';
    r.pesoCategoriePreferite = 'Azionario Globale, Azionario Emergenti, Azionario Tematico';
    r.pesoMacro = 'BASSO — cicli macro si livellano su orizzonti lunghi';
  }

  return r;
}

// ── Carica config AI dal DB (pesi modificabili) ────────────────────────────
async function getAIConfig(db) {
  try {
    const { rows } = await db.query("SELECT key, value FROM ai_config");
    const cfg = {};
    rows.forEach(r => {
      const v = parseFloat(r.value);
      cfg[r.key] = isNaN(v) ? r.value : v;
    });
    return cfg;
  } catch { return {}; }
}

// POST /api/ai/analisi

module.exports = (db, fetchETF, ETF_INFO_MAP) => {
  const router = express.Router();

// ─── Helper: validazione modifiche AI contro il catalogo ──────────────────
// Per ogni modifica `aggiungi`/`seleziona`:
//  - se ISIN nel catalogo + prezzo OK → arricchisce con dati reali, logga differenze
//  - se ISIN nel catalogo + prezzo stale → flag `_warningType: 'stale'`
//  - se ISIN non nel catalogo → flag `_warningType: 'isin_inventato'`
// Restituisce le modifiche modificate in-place (per riferimento) e statistiche.
async function validaModificheAI(modifiche, dbPool) {
  const stats = { totali: 0, arricchite: 0, stale: 0, inventati: 0 };
  if (!Array.isArray(modifiche) || modifiche.length === 0) return stats;

  // Filtra solo aggiungi/seleziona — deseleziona/ribilancia operano su ISIN già esistenti nel portafoglio
  const daValidare = modifiche.filter(m => m.azione === 'aggiungi' || m.azione === 'seleziona');
  if (daValidare.length === 0) return stats;
  stats.totali = daValidare.length;

  const isinList = daValidare.map(m => m.isin).filter(Boolean);
  if (isinList.length === 0) return stats;

  const placeholders = isinList.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await dbPool.query(
    `SELECT c.isin, c.name, c.ter, c.categoria, c.quotazione,
            (SELECT MAX(data) FROM prezzi_storici WHERE isin = c.isin) AS ultima_data,
            (SELECT prezzo FROM prezzi_storici WHERE isin = c.isin ORDER BY data DESC LIMIT 1) AS ultimo_prezzo_storico
     FROM etf_catalog c WHERE c.isin IN (${placeholders}) AND c.active = 1`,
    isinList
  );
  const catalogMap = new Map(rows.map(r => [r.isin, r]));

  for (const m of daValidare) {
    const cat = catalogMap.get(m.isin);
    if (!cat) {
      m._warningType = 'isin_inventato';
      m._warningMsg = `ISIN ${m.isin} non presente nel catalogo. L'AI potrebbe averlo inventato.`;
      stats.inventati += 1;
      console.log(`[validaModifiche] ⚠ ISIN INVENTATO: ${m.isin} (azione: ${m.azione}, motivo: ${(m.motivo || '').slice(0, 80)})`);
      continue;
    }

    // Logga differenze rilevanti tra dati AI e dati catalogo
    const diffLog = [];
    if (m.ter != null && Math.abs(parseFloat(m.ter) - parseFloat(cat.ter || 0)) > 0.05) {
      diffLog.push(`TER: AI=${m.ter} vs DB=${cat.ter}`);
    }
    const prezzoCat = cat.quotazione || cat.ultimo_prezzo_storico || 0;
    if (m.quotazione != null && prezzoCat > 0 && Math.abs(parseFloat(m.quotazione) - prezzoCat) / prezzoCat > 0.05) {
      diffLog.push(`Prezzo: AI=${m.quotazione} vs DB=${prezzoCat}`);
    }
    if (m.categoria && cat.categoria && m.categoria.toLowerCase() !== cat.categoria.toLowerCase()) {
      diffLog.push(`Categoria: AI="${m.categoria}" vs DB="${cat.categoria}"`);
    }
    if (diffLog.length > 0) {
      console.log(`[validaModifiche] ${m.isin} differenze AI/DB: ${diffLog.join(' | ')}`);
    }

    // Sovrascrivi sempre con dati catalogo (più affidabili)
    m.name = cat.name || m.name;
    m.ter = cat.ter != null ? cat.ter : m.ter;
    m.categoria = cat.categoria || m.categoria;
    m.quotazione = prezzoCat;

    // Verifica freschezza prezzo
    const dataPrezzo = cat.ultima_data ? new Date(cat.ultima_data) : null;
    const giorniStale = dataPrezzo ? (Date.now() - dataPrezzo.getTime()) / (1000 * 60 * 60 * 24) : 999;
    if (prezzoCat <= 0 || giorniStale > 30) {
      m._warningType = 'stale';
      m._warningMsg = `ETF ${m.isin} in catalogo ma prezzo non aggiornato${dataPrezzo ? ` (ultimo: ${dataPrezzo.toLocaleDateString('it-IT')})` : ' (mai fetchato)'}.`;
      stats.stale += 1;
    } else {
      stats.arricchite += 1;
    }
  }
  return stats;
}

// ─── Helper: retry chiamata AI per sostituire ISIN inventati ──────────────
async function retryISINInventati(modificheInventate, portfolio, dbPool) {
  if (!Array.isArray(modificheInventate) || modificheInventate.length === 0) return [];

  // Per ciascun ISIN inventato, raccogli le categorie target dal motivo/categoria AI
  // e prendi un campionamento del catalogo nelle stesse categorie.
  const categorieTarget = new Set();
  for (const m of modificheInventate) {
    if (m.categoria) categorieTarget.add(m.categoria);
  }

  // Catalogo filtrato: stesse categorie richieste, escludendo ISIN già nel portafoglio
  // e con prezzo valido recente (< 30gg)
  const isinNelPortafoglio = (portfolio.etfs || []).map(e => e.isin);
  const isinPlaceholders = isinNelPortafoglio.length > 0
    ? `AND c.isin NOT IN (${isinNelPortafoglio.map((_, i) => `$${i + 1}`).join(',')})`
    : '';
  const queryParams = [...isinNelPortafoglio];

  let queryWhere = `c.active = 1
    AND c.quotazione IS NOT NULL AND c.quotazione > 0
    AND EXISTS (SELECT 1 FROM prezzi_storici ps WHERE ps.isin = c.isin AND ps.data::date >= CURRENT_DATE - 30)
    ${isinPlaceholders}`;

  if (categorieTarget.size > 0) {
    const catParams = [...categorieTarget];
    const catPlaceholders = catParams.map((_, i) => `$${queryParams.length + i + 1}`).join(',');
    queryWhere += ` AND c.categoria IN (${catPlaceholders})`;
    queryParams.push(...catParams);
  }

  const { rows: candidati } = await dbPool.query(
    `SELECT c.isin, c.name, c.ter, c.categoria, c.quotazione, c.aum_mln, c.vol1y, c.maxdd1y, c.perf1y
     FROM etf_catalog c
     WHERE ${queryWhere}
     ORDER BY c.aum_mln DESC NULLS LAST
     LIMIT 30`,
    queryParams
  );

  if (candidati.length === 0) {
    console.log('[retryISIN] Nessun candidato disponibile nel catalogo per le categorie richieste');
    return [];
  }

  const catalogoStr = candidati.map(c =>
    `- ${c.isin} | ${c.name} | Cat:${c.categoria} | TER:${c.ter}% | Vol1A:${c.vol1y || 'N/D'}% | Prezzo:€${c.quotazione} | AUM:${c.aum_mln || 'N/D'}M€`
  ).join('\n');

  const richieste = modificheInventate.map((m, i) =>
    `${i + 1}. ISIN inventato: ${m.isin}\n   Categoria richiesta: ${m.categoria || 'N/D'}\n   Peso target: ${m.nuovaPct || 'N/D'}%\n   Motivo originale: ${m.motivo || 'N/D'}`
  ).join('\n\n');

  const prompt = `Hai proposto i seguenti ISIN che NON esistono nel catalogo. Per ciascuno, scegli un sostituto VALIDO dalla lista qui sotto, mantenendo lo stesso intento (categoria, scopo).

ISIN DA SOSTITUIRE:
${richieste}

CATALOGO DISPONIBILE (solo ETF con prezzo aggiornato):
${catalogoStr}

REGOLE:
- Scegli SOLO ISIN dalla lista qui sopra (sono ETF reali con prezzo aggiornato).
- Mantieni la stessa categoria del motivo originale, se possibile.
- Se non c'è un sostituto adeguato per qualche ISIN, NON inventarne uno: ometti quella riga.
- Mantieni la stessa nuovaPct dell'originale.
- Risposta in JSON puro, senza testo extra. Formato:
[
  { "isin_originale": "IE00XXX", "isin_sostituto": "IE00YYY", "motivo": "..." },
  ...
]`;

  try {
    const message = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    const testo = message.content?.[0]?.text || '';
    const matches = [...testo.matchAll(/\[([\s\S]*?)\]/g)];
    for (let i = matches.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse('[' + matches[i][1] + ']');
        if (Array.isArray(parsed) && parsed[0]?.isin_originale) {
          console.log(`[retryISIN] AI ha proposto ${parsed.length} sostituti su ${modificheInventate.length} richiesti`);
          return parsed;
        }
      } catch {}
    }
    console.log('[retryISIN] Risposta AI non parsabile come JSON');
    return [];
  } catch (e) {
    console.log('[retryISIN] Errore chiamata AI:', e.message);
    return [];
  }
}

router.post('/analisi', async (req, res) => {
  const { portfolio, opzioni } = req.body;
  if (!portfolio) return res.status(400).json({ error: 'Portfolio mancante' });
  console.log(`[${new Date().toLocaleTimeString()}] Analisi AI: ${portfolio.name}`);
  log(EVENTI.AI_ANALISI, { portafoglio: portfolio.name, profilo: portfolio.riskProfile, obiettivo: opzioni?.obiettivo || 'completa' }, req.user?.username).catch(() => {});

  // Carica contesto macro reale
  let macroData = {};
  let macroContext = '';
  try {
    const { getMacroDati } = require('./macro');
    const { testo, dati } = await getMacroDati();
    macroContext = testo || '';
    macroData = dati || {};
  } catch (e) { console.log('[AI] macro non disponibile:', e.message); }

  // Carica configurazione bucket se presente
  let buckets = [];
  try {
    const { rows: bRows } = await db.query('SELECT * FROM portfolio_buckets WHERE portfolio_id = $1', [portfolio.id]);
    buckets = bRows;
  } catch {}
  const hasBuckets = buckets.length >= 2;
  const checkRend = hasBuckets ? verificaRendimentoComplessivo(buckets, portfolio.riskProfile) : null;

  const etfSelezionatiRaw = portfolio.etfs.filter(e => e.selected);
  const etfNonSelezionati = portfolio.etfs.filter(e => !e.selected);

  // Arricchisci con dati reali da etf_catalog (maxdd1y, vol1y potrebbero essere 0 lato client)
  const isinList = etfSelezionatiRaw.map(e => `'${e.isin}'`).join(',');
  const catalogRows = isinList.length > 2
    ? (await db.query(`SELECT isin, maxdd1y, vol1y, aum_mln, smart_beta_factor FROM etf_catalog WHERE isin IN (${isinList})`)).rows
    : [];
  const catalogMap = new Map(catalogRows.map(r => [r.isin, r]));

  const etfSelezionati = etfSelezionatiRaw.map(e => {
    const cat = catalogMap.get(e.isin);
    return {
      ...e,
      maxDrawdown: (cat?.maxdd1y != null ? cat.maxdd1y : (e.maxDrawdown || null)),
      variabilita: (cat?.vol1y != null ? cat.vol1y : (e.variabilita || null)),
      smartBeta: cat?.smart_beta_factor || e.smartBeta || null,
      capitalizzazione: (cat?.aum_mln != null ? cat.aum_mln : (e.capitalizzazione || null)),
    };
  });

  const etfConAcquisto = etfSelezionati.filter(e => e.acquisto);
  const totInvestito = etfConAcquisto.reduce((s, e) => s + (e.acquisto.quantita * e.acquisto.quotazioneAcquisto), 0);
  const totAttuale = etfConAcquisto.reduce((s, e) => s + (e.acquisto.quantita * (e.quotazione || e.acquisto.quotazioneAcquisto)), 0);
  const totValore = etfConAcquisto.reduce((s,e) => s + e.acquisto.quantita * e.acquisto.quotazioneAcquisto, 0);
  const terPonderato = totValore > 0
    ? etfConAcquisto.reduce((s,e) => s + e.ter * (e.acquisto.quantita * e.acquisto.quotazioneAcquisto) / totValore, 0)
    : (etfSelezionati.reduce((s,e) => s + e.ter, 0) / (etfSelezionati.length || 1));
  const regoleBase = REGOLE_PROFILO[portfolio.riskProfile] || REGOLE_PROFILO.Bilanciato;
  const regole = modulaRegolePerOrizzonte(regoleBase, portfolio.orizzonteAnni || 5);
  const maxDDabs = regole.maxDrawdownAbs || Math.abs(regole.maxDrawdown || 18);
  // Conta quanti ETF hanno maxDrawdown reale (≠0) che viola il limite
  const etfConDatiDD = etfSelezionati.filter(e => e.maxDrawdown && e.maxDrawdown !== 0);
  const etfViolanoDD = etfConDatiDD.filter(e => Math.abs(e.maxDrawdown) > maxDDabs);

  // Calcola azionario attuale
  const catAzionarie = ['Azionario Globale','Azionario USA','Azionario Europa','Azionario Emergenti','Azionario Tematico','Azionario Pacifico'];
  const valAzionario = etfConAcquisto.filter(e => catAzionarie.some(c => (e.categoria||'').includes(c.replace('Azionario ','')))).reduce((s,e) => s + e.acquisto.quantita * e.acquisto.quotazioneAcquisto, 0);
  const percAzionario = totValore > 0 ? (valAzionario / totValore * 100).toFixed(1) : 'N/D';
  
  const etfCatalogoRaw = await getEtfPerProfilo(portfolio.riskProfile, false, false);

  const etfCatalogo = etfCatalogoRaw
    .filter(c => !portfolio.etfs.some(e => e.isin === c.isin))
    .slice(0, 40);

  // Età portafoglio in giorni (0 se data non disponibile)
  const dataCreazione = portfolio.createdAt || portfolio.created_at || null;
  const giorniVita = dataCreazione
    ? Math.floor((Date.now() - new Date(dataCreazione).getTime()) / (1000*60*60*24))
    : 999; // sconosciuta → nessun trattamento speciale

  const prompt = `Sei un consulente finanziario indipendente specializzato in ETF per investitori italiani. Analizza il portafoglio con RIGORE rispetto alle regole del profilo.

## PORTAFOGLIO: ${portfolio.name}
Profilo: ${portfolio.riskProfile} | Orizzonte: ${portfolio.orizzonteAnni || 'N/D'} anni | Max USA: ${portfolio.maxUSA || 'No max'}
ETF selezionati: ${etfSelezionati.length} (min: ${regole.minETF}, max: ${regole.maxETF}) | TER ponderato: ${terPonderato.toFixed(2)}% | Quota azionaria: ${percAzionario}%
Valore investito: €${totInvestito.toLocaleString('it-IT',{maximumFractionDigits:0})} | Valore attuale: €${totAttuale.toLocaleString('it-IT',{maximumFractionDigits:0})} | P&L: ${totInvestito>0?((totAttuale-totInvestito)/totInvestito*100).toFixed(2):'N/D'}%
${giorniVita < 7 ? `⚠️ PORTAFOGLIO CREATO ${giorniVita} GIORNI FA: è molto recente, l'AI ha già selezionato gli ETF ottimali. Non suggerire di deselezionare più di 1 ETF per violazione hard limit. Evita suggerimenti puramente stilistici.` : ''}

## ORIZZONTE TEMPORALE: ${portfolio.orizzonteAnni || 'N/D'} anni
${regole.noteOrizzonte || ''}

## POSIZIONAMENTO TATTICO (Profilo × Orizzonte × Macro)
${(() => { try {
  const pt = getPosizionetattica(portfolio.riskProfile, portfolio.orizzonteAnni || 5, macroData);
  const sb = getSmartBetaSuggeriti(portfolio.riskProfile, pt.scenario, pt.fascia);
  const etfSmartBeta = etfSelezionati.filter(e => e.smartBeta && e.smartBeta !== 'ESG').map(e => e.smartBeta + '(' + e.isin + ')').join(', ');
  const etfEsg = etfSelezionati.filter(e => e.smartBeta === 'ESG').map(e => e.isin).join(', ');
  return `Scenario macro corrente: ${pt.scenario}\n${pt.testo}\n\nFATTORI SMART BETA consigliati per questo scenario: PRIVILEGIA ${sb.preferiti.join(', ')}${sb.evitare.length ? ' | EVITA/RIDUCI ' + sb.evitare.join(', ') : ''}\n${etfSmartBeta ? 'ETF fattoriali in portafoglio: ' + etfSmartBeta + ' — valuta coerenza con fattori consigliati.' : ''}${etfEsg ? ' ETF ESG presenti: ' + etfEsg + ' (classificazione ESG — non influenza posizionamento tattico).' : ''}`;
} catch(e) { return ''; } })()}
${hasBuckets ? `
## PIANIFICAZIONE A DUE ORIZZONTI (Due Bucket)
Questo portafoglio e diviso in due componenti con logiche distinte:

${buckets.map(b => descrizioneBucket(b, portfolio.riskProfile, macroData)).join('\n\n')}

VINCOLO RENDIMENTO COMPLESSIVO:
${checkRend?.nota || ''}
${!checkRend?.ok ? `⚠️ AZIONE RICHIESTA: il bucket LUNGO deve essere piu aggressivo per raggiungere almeno ${checkRend?.targetLungoMinimo}% annuo.` : ''}

ASSEGNAZIONE ETF AI BUCKET (per ETF senza etichetta, usa questa logica):
- BREVE: obbligaz. breve duration, monetario, Low Volatility, Dividend
- LUNGO: azionario globale/tematico/emergenti, Quality, Value, Momentum, Small Cap
- In caso di dubbio: assegna a LUNGO

ANALISI PER SOTTO-PORTAFOGLIO:
Valuta separatamente la coerenza di ciascun bucket. Un ETF azionario in bucket BREVE e quasi sempre incoerente (segnalalo). Un ETF monetario in bucket LUNGO e uno spreco di potenziale (segnalalo se costituisce >20% del bucket lungo).` : ''}
Categorie obbligazionarie preferite per questo orizzonte: ${regole.durataObbligaz || 'standard'}
Peso contesto macro: ${regole.pesoMacro || 'MEDIO'}

## REGOLE VINCOLANTI PROFILO ${portfolio.riskProfile.toUpperCase()} — MODULATE PER ORIZZONTE (NON modificarle nell'analisi):
- Quota azionaria: ${regole.azionarioTarget}% target, range ammesso ${regole.azionarioTarget-regole.azionarioRange}%–${regole.azionarioTarget+regole.azionarioRange}%
- Volatilità media PONDERATA portafoglio: ≤${regole.volatilita}% annuo
- Max drawdown singolo ETF (1y): ≤${maxDDabs}% in valore assoluto
- Numero ETF: MINIMO ${regole.minETF}, MASSIMO ${regole.maxETF}
- TER ponderato: preferibile <${regole.terPreferito}%, massimo ${regole.terMax}%
- Capitalizzazione minima: ${regole.capMin}M€
- CORRELAZIONE (soft): correlazione stimata tra ogni coppia idealmente <0.6. Non applicare se causa violazione di altri hard limits.
- ${regole.note || ''}

## ETF SELEZIONATI (${etfSelezionati.length}):
${etfSelezionati.map(e => {
    const dd = e.maxDrawdown && e.maxDrawdown !== 0 ? e.maxDrawdown+'%' : 'N/D(non disponibile)';
    const vol = e.variabilita && e.variabilita !== 0 ? e.variabilita+'%' : 'N/D(non disponibile)';
    return `- ${e.name} (${e.isin}) | ${e.categoria||'N/D'}${e.smartBeta ? ' ['+e.smartBeta+']' : ''} | TER:${e.ter}% | Vol1A:${vol} | MaxDD1A:${dd} | Perf1A:${e.perf1y||0}% | Perf5A:${e.perf5y||0}% | AUM:${e.capitalizzazione||'N/D'}M€`;
  }).join('\n')}

## ETF NEL PORTAFOGLIO MA NON SELEZIONATI (${etfNonSelezionati.length}):
${etfNonSelezionati.slice(0,20).map(e => `- ${e.name} (${e.isin}) | ${e.categoria||'N/D'} | TER:${e.ter}% | Vol1A:${e.variabilita||'N/D'}% | Perf1A:${e.perf1y||0}%`).join('\n') || 'Nessuno'}

## ETF DAL CATALOGO COMPATIBILI COL PROFILO (puoi suggerire "aggiungi"):
${etfCatalogo.map(e => `- ${e.name} (${e.isin}) | ${e.categoria}${e.area_geografica ? ' · '+e.area_geografica : ''}${e.smartBeta ? ' ['+e.smartBeta+']' : ''} | TER:${e.ter}% | Quotaz:€${e.quotazione||0} | Vol1A:${e.variabilita||'N/D'}% | Perf1A:${e.perf1y||0}%`).join('\n')}

${macroContext}

## ISTRUZIONI RISPOSTA — segui ESATTAMENTE questo formato:

SEMAFORI:
diversificazione:VERDE|GIALLO|ROSSO:commento breve (max 80 caratteri)
correlazione:VERDE|GIALLO|ROSSO:commento breve (max 80 caratteri) — VERDE se max correlazione stimata <0.5, GIALLO 0.5-0.7, ROSSO >0.7
volatilita:VERDE|GIALLO|ROSSO:commento breve
drawdown:VERDE|GIALLO|ROSSO:commento breve
ter:VERDE|GIALLO|ROSSO:commento breve
azionario:VERDE|GIALLO|ROSSO:commento breve

METRICHE:
rend_lordo:X.X%
[STIMA rendimento atteso lordo annuo del portafoglio DOPO le modifiche suggerite (se le applica).
Calcola su media ponderata delle classi: azionario globale 7-9%, USA 8-10%, Europa 5-7%,
emergenti 7-10%, small cap 9-11%, obbligazionario govt 2-4%, corporate 3-5%, high yield 5-7%,
REIT/tematici 6-9%, oro 3-5%, monetario 2-3%. HARD LIMIT per profilo:
Prudente ≤4.5%, Bilanciato ≤7.0%, Aggressivo ≤10.0%. Un solo numero con 1 decimale.]

PUNTI_CHIAVE:
- punto 1 (max 120 caratteri)
- punto 2
- punto 3
- punto 4 (max 4 punti)

ANALISI_DETTAGLIATA:
[Analisi completa per il PDF — 400-600 parole, NO tabelle markdown con |, usa elenchi puntati e paragrafi. Valuta: composizione, rischio, costi, performance attesa, contesto macro, confronto con regole profilo]

MODIFICHE_JSON:
[{"azione":"seleziona"|"deseleziona"|"aggiungi"|"ribilancia","isin":"ISIN","motivo":"motivo max 100 car","name":"nome ETF (solo aggiungi)","quotazione":0.0,"ter":0.0,"categoria":"cat (solo aggiungi)","nuovaPct":0}]

REGOLE ASSOLUTE per MODIFICHE_JSON — LEGGILE TUTTE PRIMA DI RISPONDERE:

R1 — PORTAFOGLIO RECENTE: questo portafoglio ha ${giorniVita} giorni.
${giorniVita < 7 ? 'PORTAFOGLIO NUOVO (<7gg): se rispetta tutti i vincoli fondamentali scrivi []. Suggerisci al massimo 1 "ribilancia", ZERO "deseleziona".' : ''}

R2 — MINIMO ETF: dopo TUTTE le modifiche devono esserci ALMENO ${regole.minETF} ETF selezionati.
Situazione attuale: ${etfSelezionati.length} ETF selezionati.
Rimovibili senza violare minimo: max ${Math.max(0, etfSelezionati.length - regole.minETF)} ETF.
Se vuoi rimuovere di più: devi aggiungere sostituti dal CATALOGO per ogni rimozione extra.
Se non ci sono sostituti validi: usa "ribilancia" invece di "deseleziona".

R3 — MANTIENI CAPITALE (€${totInvestito.toLocaleString('it-IT',{maximumFractionDigits:0})}):
Il sistema ridistribuisce automaticamente il capitale rimosso sugli ETF rimanenti.
Quindi: per ogni "deseleziona" DEVI includere voci "ribilancia" o "aggiungi"/"seleziona" che assorbano il capitale.
Niente deseleziona isolato senza redistribuzione.

R3b — DATI MANCANTI = BENEFIT OF THE DOUBT:
Se MaxDD1A o Vol1A è "N/D(non disponibile)" o 0, NON flaggare come violazione. Il dato mancante significa che il filtro di creazione lo ha già accettato con dati incompleti — non reinventare valori.

R3c — TOLERANCE BAND (evita loop di analisi):
Non suggerire modifiche per scostamenti minori. Flagga SOLO se:
- Quota azionaria fuori dal range ${regole.azionarioTarget-regole.azionarioRange-5}%–${regole.azionarioTarget+regole.azionarioRange+5}% (range target ±5% extra)
- TER > ${regole.terMax*1.1}% (max +10% tolleranza)
- Vol media > ${(regole.volatilita||15)*1.1}% (max +10% tolleranza)
Se i valori sono dentro queste tolerance band allargate → scrivi [].

R4 — HARD LIMITS per "deseleziona" (UNICO motivo valido):
⚠️ USA SOLO i dati MaxDD1A forniti nella lista ETF sopra. NON usare la tua conoscenza di training sui drawdown storici degli ETF — quei valori potrebbero riferirsi a periodi diversi o non essere aggiornati. Se il dato non è nei dati che ti ho fornito, non puoi usarlo.
- Puoi proporre "deseleziona" SOLO se MaxDD1A è esplicitamente fornito come valore numerico ≠0 nella lista ETF sopra E supera ${maxDDabs}% in valore assoluto.
- Se MaxDD1A è "N/D(non disponibile)" o 0 nella lista: il dato non è nel nostro DB → NON è una violazione → non proporre deseleziona per quel motivo.
- AUM < ${Math.round(regole.capMin/2)}M€ (questo puoi verificarlo dai dati forniti)
- ETF con MaxDD REALMENTE violato secondo i dati forniti: ${etfViolanoDD.length > 0 ? etfViolanoDD.map(e=>`${e.isin}(${e.maxDrawdown}%)`).join(', ') : 'NESSUNO — non proporre deseleziona per MaxDD'}

R4b — CORRELAZIONE (soft):
Stima correlazione tra coppie di ETF. Se trovi coppia con correlazione >0.6:
- Proponi "deseleziona" su quello con peggior risk/reward (non su entrambi)
- SOLO SE esiste un sostituto nel CATALOGO con correlazione <0.6 con gli altri ETF E rispetta hard limits (R4)
- Se non esiste sostituto valido: segnala in PUNTI_CHIAVE ma non proporre modifiche (vincolo soft)
- Questo vincolo NON prevale su R4 (hard limits): non rimuovere ETF validi solo per correlazione se poi scendi sotto minETF senza sostituti

R5 — AZIONI:
"seleziona" → ETF già nel portafoglio non selezionato
"deseleziona" → solo R4/R4b, rispetta R2
"aggiungi" → SOLO ISIN dal CATALOGO sopra, non inventare
"ribilancia" → {"azione":"ribilancia","isin":"ISIN","nuovaPct":XX,"motivo":"..."}

R6 — NEWS: orizzonte ${portfolio.orizzonteAnni||5} anni → impatto ${(portfolio.orizzonteAnni||5)>=10?'BASSO (±5% peso)': (portfolio.orizzonteAnni||5)>=5?'MEDIO (±10% peso)':'ALTO (±15% peso)'}

R7 — Se conforme: []
R8 — CRITICO: JSON valido e COMPLETO. Non troncare.`;

  try {
    const message = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
    const testo = message.content[0].text;

    // Parsing robusto delle sezioni
    const getSection = (label, next) => {
      // NOTA: in new RegExp() serve \\n e [\\s\\S] (doppio backslash)
      const re = new RegExp(label + ':\\n([\\s\\S]*?)(?=\\n' + next + ':|$)');
      return (testo.match(re)?.[1] || '').trim();
    };

    // Semafori
    const semaforiRaw = getSection('SEMAFORI', 'METRICHE');
    const semafori = {};
    semaforiRaw.split('\n').forEach(r => {
      const p = r.trim().split(':');
      if (p.length >= 3) semafori[p[0]] = { stato: p[1], commento: p.slice(2).join(':') };
    });

    // Metriche (rendimento atteso)
    const metricheRaw = getSection('METRICHE', 'PUNTI_CHIAVE');
    const rendMatch = metricheRaw.match(/rend_lordo\s*:\s*(\d+[.,]\d+)\s*%?/i);
    const rendAttesoLordo = rendMatch ? parseFloat(rendMatch[1].replace(',', '.')) : null;

    // Punti chiave
    const puntiRaw = getSection('PUNTI_CHIAVE', 'ANALISI_DETTAGLIATA');
    const puntiChiave = puntiRaw.split('\n').filter(r => r.trim().startsWith('-')).map(r => r.replace(/^-\s*/, '').trim());

    // Analisi dettagliata
    const analisiDettagliata = getSection('ANALISI_DETTAGLIATA', 'MODIFICHE_JSON');

    // Modifiche JSON — robusto, prende l'ultimo blocco [...] nel testo
    let modifiche = [];
    const jsonMatches = [...testo.matchAll(/\[([\s\S]*?)\]/g)];
    for (let i = jsonMatches.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse('[' + jsonMatches[i][1] + ']');
        if (Array.isArray(parsed) && (parsed.length === 0 || parsed[0]?.azione)) {
          modifiche = parsed;
          break;
        }
      } catch {}
    }

    console.log(`  ✓ Analisi OK | semafori:${Object.keys(semafori).length} | punti:${puntiChiave.length} | modifiche:${modifiche.length}${rendAttesoLordo != null ? ` | rend:${rendAttesoLordo}%` : ''}`);

    // ── Validazione modifiche AI contro il catalogo ────────────────────────
    let stats = { totali: 0, arricchite: 0, stale: 0, inventati: 0 };
    if (modifiche.length > 0) {
      stats = await validaModificheAI(modifiche, db);
      console.log(`  [validaModifiche] tot:${stats.totali} arricchite:${stats.arricchite} stale:${stats.stale} inventati:${stats.inventati}`);

      // Retry solo se 2+ ISIN inventati (soglia decisa)
      const inventati = modifiche.filter(m => m._warningType === 'isin_inventato');
      if (inventati.length >= 2) {
        console.log(`  [retryISIN] Avvio retry per ${inventati.length} ISIN inventati`);
        const sostituti = await retryISINInventati(inventati, portfolio, db);

        // Applica i sostituti: per ogni mapping isin_originale → isin_sostituto,
        // sostituisci la modifica corrispondente con quella nuova.
        let applicati = 0;
        for (const sost of sostituti) {
          const idx = modifiche.findIndex(m => m.isin === sost.isin_originale);
          if (idx >= 0 && sost.isin_sostituto) {
            const mOrig = modifiche[idx];
            modifiche[idx] = {
              ...mOrig,
              isin: sost.isin_sostituto,
              motivo: sost.motivo || mOrig.motivo,
              _sostituito: { da: sost.isin_originale, motivo: 'Retry: ISIN originale non in catalogo' },
            };
            // Rimuovi flag warning precedente (verrà ri-validato sotto)
            delete modifiche[idx]._warningType;
            delete modifiche[idx]._warningMsg;
            applicati += 1;
          }
        }
        console.log(`  [retryISIN] ${applicati} sostituzioni applicate`);

        // Ri-valida le modifiche dopo i sostituiti
        if (applicati > 0) {
          const stats2 = await validaModificheAI(modifiche, db);
          console.log(`  [validaModifiche post-retry] tot:${stats2.totali} arricchite:${stats2.arricchite} stale:${stats2.stale} inventati:${stats2.inventati}`);
        }
      }
    }

    res.json({ semafori, puntiChiave, analisiDettagliata, modifiche, metriche: { rendAttesoLordo } });
  } catch (err) {
    console.error('[analisi]', err.message);
    res.status(500).json({ error: 'Errore analisi AI: ' + err.message });
  }
});


// POST /api/ai/genera-pdf — restituisce HTML stampabile (browser → Stampa → Salva PDF)
router.post('/genera-pdf', authMiddleware, (req, res) => {
  const { portfolio, semafori, puntiChiave, analisiDettagliata, modifiche, saldoMinusAttuale } = req.body;
  if (!portfolio || !analisiDettagliata) return res.status(400).json({ error: 'Dati mancanti' });

  const data = new Date().toLocaleDateString('it-IT');
  const statoColor = s => s==='VERDE'?'#22c55e':s==='GIALLO'?'#eab308':'#ef4444';
  const statoEmoji = s => s==='VERDE'?'✅':s==='GIALLO'?'⚠️':'🔴';

  const etfSelezionati = (portfolio.etfs||[]).filter(e=>e.selected);
  const totInvestito = etfSelezionati.filter(e=>e.acquisto).reduce((s,e)=>s+(e.acquisto.quantita*e.acquisto.quotazioneAcquisto),0);
  const fmt = n => n.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmt0 = n => n.toLocaleString('it-IT',{maximumFractionDigits:0});

  // ── SIMULAZIONE FISCALE ────────────────────────────────────────────────
  // Elabora le modifiche AI calcolando vendite (deseleziona + ribilancia al ribasso)
  // e acquisti (aggiungi + ribilancia al rialzo + seleziona), con calcolo tasse FIFO
  // e compensazione minusvalenze disponibili.
  let simulazione = null;
  if (Array.isArray(modifiche) && modifiche.length > 0) {
    const vendite = [];
    const acquisti = [];
    const modificheNonSimulate = []; // aggiunte che non si riescono a simulare (prezzo mancante / ETF non in catalogo)
    let minusDispSim = parseFloat(saldoMinusAttuale || 0);
    const saldoMinusIniziale = minusDispSim;
    let plusLordaTot = 0, plusCompensataTot = 0, minusGenerateTot = 0;
    let imponibileTot = 0, tasseTot = 0, capitaleLiberato = 0;

    for (const m of modifiche) {
      const etfCorrente = etfSelezionati.find(e => e.isin === m.isin);
      const qAttuale = etfCorrente?.acquisto?.quantita || 0;
      const prezzoAcq = etfCorrente?.acquisto?.quotazioneAcquisto || 0;
      const prezzoAtt = etfCorrente?.quotazione || prezzoAcq;

      let qDaVendere = 0, qDaComprare = 0, prezzoComprare = 0;

      if (m.azione === 'deseleziona') {
        qDaVendere = qAttuale;
      } else if (m.azione === 'ribilancia' && etfCorrente) {
        // Calcola la quantità target dalla nuova %. Base: totInvestito (simuliamo redistribuzione isocapitale)
        const valoreTarget = (parseFloat(m.nuovaPct || 0) / 100) * totInvestito;
        const qTarget = prezzoAtt > 0 ? Math.round((valoreTarget / prezzoAtt) * 10000) / 10000 : 0;
        if (qTarget < qAttuale) {
          qDaVendere = Math.round((qAttuale - qTarget) * 10000) / 10000;
        } else if (qTarget > qAttuale) {
          qDaComprare = Math.round((qTarget - qAttuale) * 10000) / 10000;
          prezzoComprare = prezzoAtt;
        }
      } else if (m.azione === 'aggiungi' || m.azione === 'seleziona') {
        // Il capitale per l'acquisto viene dal capitale liberato dalle vendite + reinvestimento
        const prezzoAcq2 = parseFloat(m.quotazione || prezzoAtt) || 0;
        if (prezzoAcq2 > 0) {
          // Quantità stimata: distribuzione in base alla nuovaPct se presente, altrimenti quota media
          const pctTarget = parseFloat(m.nuovaPct || (100 / ((modifiche.filter(x => x.azione === 'aggiungi' || x.azione === 'seleziona').length) || 1)));
          const valoreTarget = (pctTarget / 100) * totInvestito;
          qDaComprare = Math.round((valoreTarget / prezzoAcq2) * 10000) / 10000;
          prezzoComprare = prezzoAcq2;
        } else {
          // Prezzo non disponibile → modifica non simulabile, ma la registriamo per avvisare l'utente.
          // Il messaggio differisce in base al motivo (verificato dalla validazione AI):
          //  - isin_inventato: AI ha proposto un ISIN che non esiste nel catalogo
          //  - stale: ISIN esiste ma il prezzo è obsoleto
          //  - default: caso classico (custom, prezzo non ancora caricato)
          let problemaMsg;
          if (m._warningType === 'isin_inventato') {
            problemaMsg = m._warningMsg || `ISIN ${m.isin} non presente nel catalogo. L'AI potrebbe averlo inventato — non procedere senza verifica.`;
          } else if (m._warningType === 'stale') {
            problemaMsg = m._warningMsg || `ETF in catalogo ma prezzo non aggiornato. Aggiorna il catalogo o verifica manualmente sul broker.`;
          } else {
            problemaMsg = 'Prezzo non disponibile nel catalogo. L\'ETF potrebbe non essere in listino o non ancora censito. Verifica manualmente sul broker.';
          }
          modificheNonSimulate.push({
            isin: m.isin,
            name: m.name || m.isin,
            azione: m.azione,
            nuovaPct: m.nuovaPct,
            motivo: m.motivo,
            problema: problemaMsg,
            _warningType: m._warningType || 'unknown',
          });
        }
      }

      if (qDaVendere > 0 && prezzoAtt > 0) {
        const controvaloreVendita = qDaVendere * prezzoAtt;
        const costoAcquisto = qDaVendere * prezzoAcq;
        const plusLorda = controvaloreVendita - costoAcquisto;
        let minusUsata = 0, tasse = 0, imponibile = 0, minusGen = 0;
        if (plusLorda > 0) {
          minusUsata = Math.min(minusDispSim, plusLorda);
          imponibile = plusLorda - minusUsata;
          tasse = Math.round(imponibile * 0.26 * 100) / 100;
          minusDispSim = Math.max(0, minusDispSim - plusLorda);
          plusLordaTot += plusLorda;
          plusCompensataTot += minusUsata;
          imponibileTot += imponibile;
          tasseTot += tasse;
        } else if (plusLorda < 0) {
          minusGen = Math.abs(plusLorda);
          minusDispSim += minusGen;
          minusGenerateTot += minusGen;
        }
        capitaleLiberato += controvaloreVendita - tasse;
        vendite.push({
          isin: m.isin,
          name: etfCorrente?.name || m.isin,
          quantita: qDaVendere,
          prezzoAcq, prezzoVen: prezzoAtt,
          plusLorda, minusUsata, imponibile, tasse, minusGen,
          tipoAzione: m.azione,
        });
      }
      if (qDaComprare > 0 && prezzoComprare > 0) {
        acquisti.push({
          isin: m.isin,
          name: etfCorrente?.name || m.name || m.isin,
          quantita: qDaComprare,
          prezzo: prezzoComprare,
          controvalore: qDaComprare * prezzoComprare,
          tipoAzione: m.azione,
        });
      }
    }

    const totVendite = vendite.reduce((s, v) => s + v.quantita * v.prezzoVen, 0);
    let totAcquisti = acquisti.reduce((s, a) => s + a.controvalore, 0);
    let capitaleNettoDisponibile = totVendite - tasseTot;

    // ── Gestione deficit: vendite aggiuntive con priorità fiscale ────────────
    // Se gli acquisti proposti superano il capitale disponibile (es. ribilanciature
    // al rialzo senza vendite esplicite), generiamo vendite parziali dagli ETF non
    // toccati. Criterio: plusvalenza latente % crescente (prima chi ha guadagnato
    // meno o perso → tasse minime, compensazione minus).
    const deficit = totAcquisti - capitaleNettoDisponibile;
    const isinToccati = new Set(modifiche.map(m => m.isin));
    const etfNonToccati = etfSelezionati.filter(e =>
      !isinToccati.has(e.isin) && e.acquisto?.quantita > 0 && (e.quotazione || e.acquisto?.quotazioneAcquisto) > 0
    );

    if (deficit > 1 && etfNonToccati.length > 0) {
      // Ordina per plusvalenza latente % crescente (prima chi è meno in gain)
      const etfOrdinati = etfNonToccati
        .map(e => {
          const prezzo = e.quotazione || e.acquisto.quotazioneAcquisto;
          const plusPct = (prezzo - e.acquisto.quotazioneAcquisto) / e.acquisto.quotazioneAcquisto;
          return { e, prezzo, plusPct, valore: e.acquisto.quantita * prezzo };
        })
        .sort((a, b) => a.plusPct - b.plusPct);

      let daCoprire = deficit;
      for (const item of etfOrdinati) {
        if (daCoprire <= 1) break;
        const { e, prezzo } = item;
        // Stima tasse marginali sul venduto: se plusPct > 0, serve vendere un po' di più
        // per coprire anche la tassa 26%. Se plusPct <= 0, non ci sono tasse (e si genera minus).
        const plusUnit = prezzo - e.acquisto.quotazioneAcquisto;
        const tasseUnitarie = plusUnit > 0 ? plusUnit * 0.26 : 0;
        const nettoUnitario = prezzo - tasseUnitarie; // cosa rimane per €1 di prezzo di vendita al netto tassa marginale
        const qNecessarie = nettoUnitario > 0 ? daCoprire / nettoUnitario : 0;
        const qDisponibili = e.acquisto.quantita;
        const qDaVendere = Math.min(qNecessarie, qDisponibili);
        const qArr = Math.round(qDaVendere * 10000) / 10000;
        if (qArr <= 0) continue;

        const controv = qArr * prezzo;
        const costoAcq = qArr * e.acquisto.quotazioneAcquisto;
        const plusLorda = controv - costoAcq;
        let minusUsata = 0, tasse = 0, imponibile = 0, minusGen = 0;
        if (plusLorda > 0) {
          minusUsata = Math.min(minusDispSim, plusLorda);
          imponibile = plusLorda - minusUsata;
          tasse = Math.round(imponibile * 0.26 * 100) / 100;
          minusDispSim = Math.max(0, minusDispSim - plusLorda);
          plusLordaTot += plusLorda;
          plusCompensataTot += minusUsata;
          imponibileTot += imponibile;
          tasseTot += tasse;
        } else if (plusLorda < 0) {
          minusGen = Math.abs(plusLorda);
          minusDispSim += minusGen;
          minusGenerateTot += minusGen;
        }
        vendite.push({
          isin: e.isin,
          name: e.name || e.isin,
          quantita: qArr,
          prezzoAcq: e.acquisto.quotazioneAcquisto,
          prezzoVen: prezzo,
          plusLorda, minusUsata, imponibile, tasse, minusGen,
          tipoAzione: 'ribil_proporzionale',
        });
        daCoprire -= (controv - tasse);
      }
      // Ricalcolo totali
      const totVenditeAgg = vendite.reduce((s, v) => s + v.quantita * v.prezzoVen, 0);
      capitaleNettoDisponibile = totVenditeAgg - tasseTot;
    }

    // ── Distribuzione del residuo (caso opposto: acquisti < capitale netto) ─
    const residuoDaAllocare = capitaleNettoDisponibile - totAcquisti;
    if (residuoDaAllocare > 1 && etfNonToccati.length > 0) {
      const totPesi = etfNonToccati.reduce((s, e) => s + (e.acquisto.quantita * e.acquisto.quotazioneAcquisto), 0);
      etfNonToccati.forEach(e => {
        const prezzo = e.quotazione || e.acquisto.quotazioneAcquisto;
        const pesoPct = (e.acquisto.quantita * e.acquisto.quotazioneAcquisto) / totPesi;
        const quotaCapitale = residuoDaAllocare * pesoPct;
        const qAggiuntive = Math.round((quotaCapitale / prezzo) * 10000) / 10000;
        if (qAggiuntive > 0) {
          acquisti.push({
            isin: e.isin,
            name: e.name || e.isin,
            quantita: qAggiuntive,
            prezzo,
            controvalore: qAggiuntive * prezzo,
            tipoAzione: 'ridistribuzione',
          });
        }
      });
      totAcquisti = acquisti.reduce((s, a) => s + a.controvalore, 0);
    }

    simulazione = {
      vendite, acquisti, modificheNonSimulate,
      saldoMinusIniziale, saldoMinusFinale: minusDispSim,
      plusLordaTot, plusCompensataTot, imponibileTot, tasseTot, minusGenerateTot,
      totVendite, totAcquisti, capitaleNettoDisponibile,
      capitaleLiberatoNetto: capitaleLiberato,
    };
  }

  const html = `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<title>Analisi Portafoglio ${portfolio.name} — ${data}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 20pt; color: #1a1a2e; margin: 0 0 4px; }
  h2 { font-size: 13pt; color: #1a1a2e; border-bottom: 2px solid #eab308; padding-bottom: 4px; margin: 20px 0 10px; }
  h3 { font-size: 11pt; color: #1a1a2e; margin: 14px 0 6px; }
  .subtitle { color: #666; font-size: 10pt; margin-bottom: 20px; }
  .header-bar { background: #1a1a2e; color: white; padding: 16px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
  .header-bar h1 { color: white; }
  .semafori-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
  .semaforo { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; }
  .semaforo-label { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .semaforo-stato { font-weight: 700; font-size: 12pt; }
  .semaforo-commento { font-size: 9pt; color: #444; margin-top: 2px; }
  .punti-chiave { background: #f8f9fa; border-left: 4px solid #eab308; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 20px; }
  .punti-chiave ul { margin: 0; padding-left: 18px; }
  .punti-chiave li { margin: 4px 0; font-size: 10.5pt; }
  .analisi-body p { margin: 0 0 8px; }
  .analisi-body ul { padding-left: 18px; }
  .analisi-body li { margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 10px; }
  th { background: #1a1a2e; color: white; padding: 6px 8px; text-align: left; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f9fafb; }
  .modifiche-item { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 9pt; font-weight: 700; }
  .badge-add { background: #dcfce7; color: #166534; }
  .badge-rem { background: #fee2e2; color: #991b1b; }
  .badge-reb { background: #dbeafe; color: #1e40af; }
  .sim-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; margin: 10px 0; }
  .sim-saldo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 10px 0; }
  .sim-saldo { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; background: white; }
  .sim-saldo-label { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.3px; }
  .sim-saldo-val { font-size: 13pt; font-weight: 700; }
  .sim-riassunto { background: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 16px; border-radius: 0 6px 6px 0; margin-top: 12px; font-size: 10pt; }
  .sim-riassunto strong { color: #1e3a8a; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.pos { color: #166534; font-weight: 600; }
  td.neg { color: #991b1b; font-weight: 600; }
  .disclaimer { font-size: 8.5pt; color: #666; font-style: italic; margin-top: 8px; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 8.5pt; color: #999; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<div class="header-bar">
  <div>
    <h1>${portfolio.name}</h1>
    <div style="color:#ccc;font-size:9.5pt">Profilo: ${portfolio.riskProfile} · Orizzonte: ${portfolio.orizzonteAnni||'N/D'} anni · ${data}</div>
  </div>
  <div style="text-align:right;color:#ccc;font-size:9.5pt">
    <div>ETF selezionati: ${etfSelezionati.length}</div>
    <div>Valore investito: €${fmt0(totInvestito)}</div>
  </div>
</div>

${semafori && Object.keys(semafori).length > 0 ? `
<h2>Valutazione Sintetica</h2>
<div class="semafori-grid">
${Object.entries(semafori).map(([k,v])=>`
  <div class="semaforo">
    <div class="semaforo-label">${k.charAt(0).toUpperCase()+k.slice(1)}</div>
    <div class="semaforo-stato" style="color:${statoColor(v.stato)}">${statoEmoji(v.stato)} ${v.stato}</div>
    <div class="semaforo-commento">${v.commento||''}</div>
  </div>`).join('')}
</div>` : ''}

${puntiChiave && puntiChiave.length > 0 ? `
<div class="punti-chiave">
  <strong>Punti Chiave</strong>
  <ul>${puntiChiave.map(p=>`<li>${p}</li>`).join('')}</ul>
</div>` : ''}

<h2>Analisi Dettagliata</h2>
<div class="analisi-body">
${analisiDettagliata
  .replace(/^## (.+)$/gm,'<h3 style="color:#eab308;margin:14px 0 6px">$1</h3>')
  .replace(/^### (.+)$/gm,'<h4 style="margin:10px 0 4px">$1</h4>')
  .replace(/^\*\*(.+)\*\*$/gm,'<strong>$1</strong>')
  .replace(/^- (.+)$/gm,'<li>$1</li>')
  .replace(/(<li>[\s\S]*?<\/li>)/g,'<ul>$1</ul>')
  .replace(/\n{2,}/g,'</p><p>')
  .replace(/^(?!<[hul])/gm,'')
  }
</div>

<h2>Composizione Portafoglio</h2>
<table>
  <tr><th>ETF</th><th>ISIN</th><th>Categoria</th><th>TER%</th><th>Perf.1A</th><th>Valore €</th></tr>
  ${etfSelezionati.map(e=>{
    const val = e.acquisto ? (e.acquisto.quantita*e.acquisto.quotazioneAcquisto) : 0;
    return `<tr><td>${e.name||e.isin}</td><td style="font-family:monospace;font-size:8.5pt">${e.isin}</td><td>${e.categoria||'—'}</td><td>${(e.ter||0).toFixed(2)}%</td><td>${e.perf1y>0?'+':''}${(e.perf1y||0).toFixed(1)}%</td><td>${val>0?'€'+fmt0(val):'—'}</td></tr>`;
  }).join('')}
</table>

${modifiche && modifiche.length > 0 ? `
<h2>Modifiche Consigliate</h2>
${modifiche.map(m=>{
  const badge = m.azione==='aggiungi'||m.azione==='seleziona' ? 'badge-add' : m.azione==='ribilancia' ? 'badge-reb' : 'badge-rem';
  const label = m.azione==='aggiungi'?'AGGIUNGI':m.azione==='seleziona'?'ATTIVA':m.azione==='ribilancia'?`RIBILANCIA ${m.nuovaPct||''}%`:'RIMUOVI';
  return `<div class="modifiche-item"><span class="badge ${badge}">${label}</span><div><strong>${m.isin}</strong> — ${m.motivo||''}</div></div>`;
}).join('')}` : '<p style="color:#22c55e;font-weight:600">✓ Il portafoglio è già conforme alle regole del profilo.</p>'}

${simulazione ? `
<h2>Simulazione Fiscale — se applichi le modifiche al prezzo attuale</h2>
<p style="font-size:10pt;color:#444;margin:0 0 10px">
  Le vendite sotto sono calcolate usando le quotazioni aggiornate al ${data}.
  La tassazione è al 26% sulla plusvalenza al netto delle minusvalenze compensabili disponibili
  (metodo FIFO). Questa è una simulazione: il portafoglio non viene modificato.
</p>

<div class="sim-saldo-grid">
  <div class="sim-saldo">
    <div class="sim-saldo-label">Saldo Minusvalenze — attuale</div>
    <div class="sim-saldo-val" style="color:#1a1a2e">€${fmt(simulazione.saldoMinusIniziale)}</div>
  </div>
  <div class="sim-saldo">
    <div class="sim-saldo-label">Saldo Minusvalenze — post simulazione</div>
    <div class="sim-saldo-val" style="color:${simulazione.saldoMinusFinale >= simulazione.saldoMinusIniziale ? '#166534' : '#991b1b'}">€${fmt(simulazione.saldoMinusFinale)}</div>
  </div>
</div>

${simulazione.vendite.length > 0 ? `
<h3>Vendite simulate</h3>
<p style="font-size:9pt;color:#666;margin:-4px 0 8px">
  Include le vendite esplicite dalle modifiche AI (RIMUOVI, RIBIL. ↓) e le vendite aggiuntive
  generate automaticamente per coprire ribilanciature al rialzo senza contropartita (RIBIL. PROP.).
  Quest'ultime sono prelevate dagli ETF non toccati dalle modifiche, in ordine di plusvalenza
  latente crescente per minimizzare il carico fiscale.
</p>
<table>
  <tr>
    <th>ETF</th><th>Azione</th><th style="text-align:right">Quote</th>
    <th style="text-align:right">Prz.Acq</th><th style="text-align:right">Prz.Ven</th>
    <th style="text-align:right">Plus/Minus</th><th style="text-align:right">Minus comp.</th>
    <th style="text-align:right">Imponibile</th><th style="text-align:right">Tasse 26%</th>
  </tr>
  ${simulazione.vendite.map(v=>`
    <tr>
      <td>${v.name}<br><span style="font-family:monospace;font-size:8pt;color:#666">${v.isin}</span></td>
      <td><span class="badge ${v.tipoAzione==='deseleziona'?'badge-rem':'badge-reb'}">${
        v.tipoAzione==='deseleziona'?'RIMUOVI':
        v.tipoAzione==='ribil_proporzionale'?'RIBIL. PROP.':'RIBIL. ↓'
      }</span></td>
      <td class="num">${v.quantita.toLocaleString('it-IT',{maximumFractionDigits:2})}</td>
      <td class="num">€${fmt(v.prezzoAcq)}</td>
      <td class="num">€${fmt(v.prezzoVen)}</td>
      <td class="num ${v.plusLorda>=0?'pos':'neg'}">${v.plusLorda>=0?'+':''}€${fmt(v.plusLorda)}</td>
      <td class="num">${v.minusUsata>0?'−€'+fmt(v.minusUsata):'—'}</td>
      <td class="num">${v.imponibile>0?'€'+fmt(v.imponibile):'—'}</td>
      <td class="num ${v.tasse>0?'neg':''}">${v.tasse>0?'€'+fmt(v.tasse):'—'}</td>
    </tr>
  `).join('')}
  <tr style="background:#fef3c7;font-weight:700">
    <td colspan="5" style="text-align:right">TOTALI</td>
    <td class="num ${simulazione.plusLordaTot - simulazione.minusGenerateTot >= 0 ? 'pos' : 'neg'}">
      ${simulazione.plusLordaTot - simulazione.minusGenerateTot >= 0 ? '+' : ''}€${fmt(simulazione.plusLordaTot - simulazione.minusGenerateTot)}
    </td>
    <td class="num">${simulazione.plusCompensataTot > 0 ? '−€'+fmt(simulazione.plusCompensataTot) : '—'}</td>
    <td class="num">€${fmt(simulazione.imponibileTot)}</td>
    <td class="num neg">€${fmt(simulazione.tasseTot)}</td>
  </tr>
</table>
` : '<p><em>Nessuna vendita prevista dalle modifiche proposte.</em></p>'}

${simulazione.acquisti.length > 0 ? `
<h3>Acquisti simulati (da eseguire sul broker)</h3>
<p style="font-size:9pt;color:#666;margin:-4px 0 8px">
  Include le ribilanciature esplicite suggerite dall'AI e la ridistribuzione automatica
  del capitale residuo (vendite al netto delle tasse, meno acquisti espliciti) sugli ETF
  rimasti non toccati dalle modifiche, in proporzione al loro peso attuale.
</p>
<table>
  <tr>
    <th>ETF</th><th>Azione</th>
    <th style="text-align:right">Quote</th>
    <th style="text-align:right">Prezzo</th>
    <th style="text-align:right">Controvalore</th>
  </tr>
  ${simulazione.acquisti.map(a=>`
    <tr>
      <td>${a.name}<br><span style="font-family:monospace;font-size:8pt;color:#666">${a.isin}</span></td>
      <td><span class="badge ${a.tipoAzione==='ribilancia'||a.tipoAzione==='ridistribuzione'?'badge-reb':'badge-add'}">
        ${a.tipoAzione==='aggiungi'?'AGGIUNGI':a.tipoAzione==='seleziona'?'ATTIVA':a.tipoAzione==='ridistribuzione'?'RIDISTRIB.':'RIBIL. ↑'}
      </span></td>
      <td class="num">${a.quantita.toLocaleString('it-IT',{maximumFractionDigits:2})}</td>
      <td class="num">€${fmt(a.prezzo)}</td>
      <td class="num">€${fmt(a.controvalore)}</td>
    </tr>
  `).join('')}
</table>
` : ''}

${simulazione.modificheNonSimulate && simulazione.modificheNonSimulate.length > 0 ? `
<div style="background:#fef2f2; border:1px solid #fca5a5; border-left:4px solid #dc2626; border-radius:0 6px 6px 0; padding:12px 16px; margin-top:14px; font-size:10pt">
  <strong style="color:#991b1b">⚠️ Modifiche AI non simulate (${simulazione.modificheNonSimulate.length})</strong>
  <p style="margin:6px 0 8px;color:#444">
    Le modifiche seguenti sono state proposte dall'AI ma non è stato possibile simularle perché
    il prezzo dell'ETF non è disponibile (non ancora in catalogo, quotazione mancante, o ISIN non verificato):
  </p>
  <ul style="margin:6px 0 0;padding-left:18px">
  ${simulazione.modificheNonSimulate.map(m=>`
    <li style="margin:4px 0">
      <strong>${m.azione === 'aggiungi' ? 'AGGIUNGI' : 'ATTIVA'}</strong>
      <code style="font-family:monospace;font-size:9pt;background:#fff;padding:1px 4px;border-radius:3px">${m.isin}</code>
      ${m.name && m.name !== m.isin ? `— ${m.name}` : ''}
      ${m.nuovaPct ? ` al ${m.nuovaPct}%` : ''}
      <br><span style="font-size:9pt;color:#666">${m.motivo || ''}</span>
      <br><span style="font-size:9pt;color:#991b1b;font-style:italic">${m.problema}</span>
    </li>
  `).join('')}
  </ul>
</div>
` : ''}

<div class="sim-riassunto">
  <strong>Riassunto:</strong> Vendite totali €${fmt0(simulazione.totVendite)} ·
  Tasse stimate <strong style="color:#991b1b">€${fmt0(simulazione.tasseTot)}</strong> ·
  Capitale netto disponibile €${fmt0(simulazione.capitaleNettoDisponibile)} ·
  Acquisti proposti €${fmt0(simulazione.totAcquisti)}
  ${simulazione.totAcquisti > simulazione.capitaleNettoDisponibile + 1
    ? `<br><span style="color:#991b1b">⚠️ Gli acquisti proposti (€${fmt0(simulazione.totAcquisti)}) superano il capitale netto disponibile (€${fmt0(simulazione.capitaleNettoDisponibile)}) di €${fmt0(simulazione.totAcquisti - simulazione.capitaleNettoDisponibile)}. Sul broker dovrai integrare con liquidità aggiuntiva o ridurre proporzionalmente gli acquisti.</span>`
    : ''}
</div>

<p class="disclaimer">
  Calcolo fiscale semplificato: aliquota 26% sulla plusvalenza al netto delle minus compensabili.
  Non considera costi di transazione, bolli, differenze di regime fiscale o situazioni particolari.
  Verifica sempre con il tuo intermediario o commercialista.
</p>
` : ''}

<div class="footer">
  Analisi generata da ETF Portfolio Manager · powered by Claude · ${data}<br>
  <em>Questo documento è a scopo informativo e non costituisce consulenza finanziaria personalizzata.</em>
</div>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// POST /api/ai/confronta
router.post('/confronta', async (req, res) => {
  const { etf1, etf2 } = req.body;
  if (!etf1 || !etf2) return res.status(400).json({ error: 'Invia etf1 e etf2' });
  const prompt = `Sei un consulente finanziario esperto in ETF. Confronta questi due ETF e consiglia quale preferire.

## ETF 1: ${etf1.name} (${etf1.isin})
TER: ${etf1.ter}% | Tax: ${etf1.tassazione}% | Cap: ${etf1.capitalizzazione}M€ | Quotazione: €${etf1.quotazione}
Perf 1M: ${etf1.perf1m}% | 6M: ${etf1.perf6m}% | 1A: ${etf1.perf1y}% | 5A: ${etf1.perf5y}%

## ETF 2: ${etf2.name} (${etf2.isin})
TER: ${etf2.ter}% | Tax: ${etf2.tassazione}% | Cap: ${etf2.capitalizzazione}M€ | Quotazione: €${etf2.quotazione}
Perf 1M: ${etf2.perf1m}% | 6M: ${etf2.perf6m}% | 1A: ${etf2.perf1y}% | 5A: ${etf2.perf5y}%

Fornisci: 1) Tabella comparativa 2) Vantaggi ETF1 3) Vantaggi ETF2 4) Verdetto 5) Ha senso tenerli entrambi?`;

  try {
    const message = await getAnthropic().messages.create({
      model: 'claude-opus-4-6', max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ analisi: message.content[0].text });
  } catch (err) {
    res.status(500).json({ error: 'Errore confronto AI: ' + err.message });
  }
});


// ── Carica ETF dal DB filtrati per profilo di rischio ──────────────────────
async function getEtfPerProfilo(profilo, escludiDistribuzione = false, filtriRilassati = false) {
  const regole = REGOLE_PROFILO[profilo] || REGOLE_PROFILO.Bilanciato;

  // filtriRilassati=true per pool alternative (vincoli più ampi per avere sempre 2 alternative per TOP)
  const filtri = filtriRilassati ? {
    Prudente:   { maxVol: 20,  maxDrawdown: -30,  maxDd5y: -30,  minAum: 200, maxTer: 1.0 },
    Bilanciato: { maxVol: 25,  maxDrawdown: -35,  maxDd5y: -35,  minAum: 50,  maxTer: 1.8 },
    Aggressivo: { maxVol: 999, maxDrawdown: -999, maxDd5y: -999, minAum: 10,  maxTer: 2.5 },
  } : {
    Prudente:   { maxVol: 16,  maxDrawdown: -25,  maxDd5y: -25,  minAum: 300, maxTer: 1.0 },
    Bilanciato: { maxVol: 15,  maxDrawdown: -18,  maxDd5y: -18,  minAum: 100, maxTer: 1.8 },
    Aggressivo: { maxVol: 999, maxDrawdown: -999, maxDd5y: -999, minAum: 10,  maxTer: 2.5 },
  };
  const f = filtri[profilo] || filtri.Bilanciato;

  // Eccezione filtri vol/dd per commodity e oro: hanno vol più alta per natura
  // ma sono asset reali importanti per diversificazione — filtri allargati a 22%/−25%
  const escludiVolFilter = profilo !== 'Aggressivo'
    ? `AND (vol1y IS NULL OR vol1y <= $3
           OR categoria IN ('Oro / Materie Prime', 'Commodity', 'Real Asset')
           OR name ILIKE '%gold%' OR name ILIKE '%oro%' OR name ILIKE '%commodity%')`
    : `AND (vol1y IS NULL OR vol1y <= $3)`;

  const escludiDdFilter = profilo !== 'Aggressivo'
    ? `AND maxdd1y IS NOT NULL AND (maxdd1y >= $4
           OR (maxdd1y >= -25 AND (categoria IN ('Oro / Materie Prime', 'Commodity', 'Real Asset')
               OR name ILIKE '%gold%' OR name ILIKE '%oro%' OR name ILIKE '%commodity%')))`
    : `AND maxdd1y IS NOT NULL AND maxdd1y >= $4`;

  // Per profilo Aggressivo: escludi obbligazionari piccoli e poco redditizi
  const escludiObblAggressivo = profilo === 'Aggressivo'
    ? `AND NOT (
        (name LIKE '%Bond%' OR name LIKE '%Govt%' OR name LIKE '%Treasury%'
         OR name LIKE '%Obblig%' OR name LIKE '%BTP%' OR name LIKE '%Corporate%'
         OR name LIKE '%Inflation%' OR name LIKE '%Monetary%' OR name LIKE '%EONIA%'
         OR name LIKE '%Overnight%' OR name LIKE '%Gov%')
        AND (aum_mln < 300 OR (perf1y IS NOT NULL AND perf1y < 3))
      )`
    : '';

  // ISIN con prezzo disponibile: ticker_yahoo nel catalogo OPPURE prezzo in prezzi_storici
  let isinConPrezzoInDB = new Set();
  try {
    // ETF con ticker Yahoo nel catalogo
    const { rows: _tickerRows } = await db.query("SELECT isin FROM etf_catalog WHERE ticker_yahoo IS NOT NULL AND ticker_yahoo != ''");
    _tickerRows.forEach(r => isinConPrezzoInDB.add(r.isin));
    // ETF con prezzo storico recente
    const cutoffTicker = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10);
    const { rows: _pricedIsins } = await db.query('SELECT DISTINCT isin FROM prezzi_storici WHERE data >= $1 AND prezzo > 0', [cutoffTicker]);
    _pricedIsins.forEach(r => isinConPrezzoInDB.add(r.isin));
  } catch {}

  const { rows: _rawRows } = await db.query(`
    SELECT isin, name, valuta, aum_mln, ter,
           perf1m, perf6m, perf1y, perf5y,
           perf2024, perf2023, perf2022,
           vol1y, vol3y, vol5y,
           maxdd1y, maxdd5y, maxdd_max,
           distribuzione, categoria, area_geografica, smart_beta_factor,
           data_lancio, partecipazioni, sostenibile
    FROM etf_catalog
    WHERE active = 1
      AND aum_mln >= $1
      AND (ter IS NULL OR ter <= $2)
      ${escludiVolFilter}
      ${escludiDdFilter}
      AND (maxdd5y IS NULL OR maxdd5y >= $5)
      AND (perf1y IS NOT NULL OR perf5y IS NOT NULL)
      ${escludiObblAggressivo}
    ORDER BY aum_mln DESC
    LIMIT 300
  `, [f.minAum, f.maxTer, f.maxVol, f.maxDrawdown, f.maxDd5y]);
  const rows = _rawRows
    .filter(e => isinConPrezzoInDB.has(e.isin))
    .filter(e => !escludiDistribuzione || e.distribuzione !== 'Distribuzione')
    .filter(e => e.perf1y !== null || e.perf5y !== null);

  return rows.map(e => ({
    isin:             e.isin,
    name:             e.name,
    categoria:        e.categoria || 'N/D',
    area_geografica:  e.area_geografica || null,
    emittente:        e.name.split(' ')[0],
    ter:              e.ter ?? 0,
    tassazione:       26,
    capitalizzazione: e.aum_mln ?? 0,
    variabilita:      e.vol1y ?? 0,
    vol3y:            e.vol3y ?? null,
    vol5y:            e.vol5y ?? null,
    maxDrawdown:      e.maxdd1y ?? 0,
    maxDrawdown5y:    e.maxdd5y ?? 0,
    maxDrawdownMax:   e.maxdd_max ?? null,
    valuta:           e.valuta || 'EUR',
    quotazione:       0,
    perf1m:           e.perf1m ?? 0,
    perf6m:           e.perf6m ?? 0,
    perf1y:           e.perf1y ?? 0,
    perf5y:           e.perf5y ?? 0,
    perf2024:         e.perf2024 ?? null,
    perf2023:         e.perf2023 ?? null,
    perf2022:         e.perf2022 ?? null,
    distribuzione:    e.distribuzione || 'N/D',
    dataLancio:       e.data_lancio ? new Date(e.data_lancio).getFullYear() : null,
    partecipazioni:   e.partecipazioni ?? null,
    sostenibile:      e.sostenibile ?? null,
  }));
}

// POST /api/ai/crea-portafoglio
router.post('/crea-portafoglio', async (req, res) => {
  const { profilo, orizzonteAnni, capitale, preferenze, escludiDistribuzione, maxUSA, rendimentoTarget, rendimentoTargetLungo } = req.body;
  if (!profilo) return res.status(400).json({ error: 'Dati mancanti' });

  // Carica ETF dal DB filtrati per profilo + notizie macro in parallelo
  const etfDisponibili = await getEtfPerProfilo(profilo, escludiDistribuzione);
  let macroData = {};
  let macroContext = '';
  try {
    const { getMacroDati } = require('./macro');
    const { testo, dati } = await getMacroDati();
    macroContext = testo || '';
    macroData = dati || {};
  } catch (e) { console.log('[AI] macro non disponibile:', e.message); }
  const { bucketBreve, bucketLungo } = req.body; // opzionali: { pct, anni, targetRend }
  const hasBuckets = bucketBreve && bucketLungo;
  const filosofiaBucket = bucketBreve?.filosofia || 'difensiva';
  console.log(`  [bucket] hasBuckets=${!!hasBuckets} filosofia=${filosofiaBucket} bucketBreve=${JSON.stringify(bucketBreve)}`);

  // Per bucket DIFENSIVO: carica ETF obbligazionari breve da aggiungere al pool
  let etfBucketDifensivo = [];
  if (hasBuckets && filosofiaBucket === 'difensiva') {
    try {
      const { rows: obBreve } = await db.query(`
        SELECT isin, name, ter, categoria FROM etf_catalog
        WHERE quotazione > 0
        AND categoria IN ('Obbligazionario Governativo', 'Obbligazionario Corporate')
        AND (name ILIKE '%1-3%' OR name ILIKE '%1-5%' OR name ILIKE '%0-3%' OR name ILIKE '%short%')
        AND (name NOT ILIKE '%ultra-short%' AND name NOT ILIKE '%overnight%'
             AND name NOT ILIKE '%0-1%' AND name NOT ILIKE '%fed funds%')
        AND ter <= 0.25
        AND aum_mln >= 200
        ORDER BY aum_mln DESC
        LIMIT 8
      `);
      etfBucketDifensivo = obBreve;
      console.log(`  [bucket difensivo] ETF obblig breve: ${obBreve.map(e => e.isin).join(', ')}`);
    } catch (e) { console.log('  [bucket difensivo] errore query:', e.message); }
  }
  const checkRend = hasBuckets
    ? verificaRendimentoComplessivo(
        [{tipo:'BREVE', pct_allocazione: bucketBreve.pct, orizzonte_anni: bucketBreve.anni, rendimento_target_annuo: bucketBreve.targetRend},
         {tipo:'LUNGO', pct_allocazione: bucketLungo.pct, orizzonte_anni: bucketLungo.anni, rendimento_target_annuo: bucketLungo.targetRend}],
        profilo)
    : null;
  console.log(`[${new Date().toLocaleTimeString()}] Crea portafoglio AI: ${profilo}, ETF disponibili dal DB: ${etfDisponibili.length}, capitale: €${capitale || 'N/D'}`);
  log(EVENTI.AI_CREA_PORTAFOGLIO, { profilo, capitale: capitale || null, maxUSA, nEtfDisponibili: etfDisponibili.length }, req.user?.username).catch(() => {});

  // Forza aggiunta ETF obblig breve al pool per bucket difensivo
  // (vengono esclusi dal filtro Aggressivo perché hanno perf1y bassa)
  if (hasBuckets && filosofiaBucket === 'difensiva' && etfBucketDifensivo.length > 0) {
    const isinGiaPresenti = new Set(etfDisponibili.map(e => e.isin));
    for (const etf of etfBucketDifensivo) {
      if (!isinGiaPresenti.has(etf.isin)) {
        try {
          const { rows: det } = await db.query(
            `SELECT isin, name, valuta, aum_mln, ter, perf1m, perf6m, perf1y, perf5y,
                    perf2024, perf2023, perf2022, vol1y, vol3y, maxdd1y, maxdd5y, maxdd_max,
                    distribuzione, data_lancio, partecipazioni, sostenibile, categoria
             FROM etf_catalog WHERE isin = $1`, [etf.isin]
          );
          if (det[0]) {
            const e = det[0];
            etfDisponibili.push({
              isin: e.isin, name: e.name, categoria: e.categoria || 'Obbligazionario Governativo',
              emittente: e.name.split(' ')[0], ter: e.ter ?? 0, tassazione: 26,
              capitalizzazione: e.aum_mln ?? 0, variabilita: e.vol1y ?? 0,
              vol3y: e.vol3y ?? null, vol5y: null, maxDrawdown: e.maxdd1y ?? 0,
              maxDrawdown5y: e.maxdd5y ?? 0, maxDrawdownMax: e.maxdd_max ?? null,
              valuta: e.valuta || 'EUR', quotazione: 0,
              perf1m: e.perf1m ?? 0, perf6m: e.perf6m ?? 0,
              perf1y: e.perf1y ?? 0, perf5y: e.perf5y ?? 0,
              perf2024: e.perf2024 ?? null, perf2023: e.perf2023 ?? null, perf2022: e.perf2022 ?? null,
              distribuzione: e.distribuzione || 'N/D',
              dataLancio: e.data_lancio ? new Date(e.data_lancio).getFullYear() : null,
              partecipazioni: e.partecipazioni ?? null, sostenibile: e.sostenibile ?? null,
            });
            console.log(`  [bucket difensivo] ✓ Aggiunto al pool: ${etf.isin}`);
          }
        } catch (err) { console.log(`  [bucket difensivo] errore aggiunta ${etf.isin}:`, err.message); }
      }
    }
  }

  const regoleBase = REGOLE_PROFILO[profilo] || REGOLE_PROFILO.Bilanciato;
  const regole = modulaRegolePerOrizzonte(regoleBase, orizzonteAnni || 5);
  const conCapitale = capitale && parseFloat(capitale) > 0;

  const prompt = `Sei un consulente finanziario esperto in ETF per investitori italiani.
Crea un portafoglio ETF ottimale rispettando RIGOROSAMENTE le regole del profilo indicato.

## PARAMETRI INVESTITORE:
- Profilo: ${profilo}
- Orizzonte temporale: ${parseInt(orizzonteAnni||5)<=3 ? 'BREVE (entro 5 anni)' : parseInt(orizzonteAnni||5)<=7 ? 'MEDIO (5-10 anni)' : 'LUNGO (oltre 10 anni)'}
- Classe orizzonte: ${parseInt(orizzonteAnni||5)<=3?'BREVE (<=3 anni)':parseInt(orizzonteAnni||5)<=7?'MEDIO (3-7 anni)':'LUNGO (>7 anni)'}
- ${regole.noteOrizzonte || ''}
- POSIZIONAMENTO TATTICO: ${(() => { try { const pt = getPosizionetattica(profilo, orizzonteAnni||5, macroData); return `[${pt.scenario}] ${pt.testo}`; } catch(e) { return 'standard'; } })()}
- Categorie obbligazionarie consigliate per orizzonte: ${regole.durataObbligaz || 'standard'}
- Categorie da privilegiare: ${regole.pesoCategoriePreferite || 'mix standard'}
- Capitale disponibile: ${conCapitale ? `€${parseFloat(capitale).toLocaleString('it-IT')}` : 'non specificato'}
- Preferenze utente: ${preferenze || 'nessuna'}
- Limite esposizione USA: ${maxUSA && maxUSA !== 'No max' ? maxUSA : 'nessun limite'}
${preferenze ? `
⚠️ ISTRUZIONE PRIORITARIA: L'utente ha espresso preferenze specifiche ("${preferenze}"). DEVI rispettarle includendo almeno 1 ETF che soddisfi questa richiesta, anche se non è il tuo primo candidato per rendimento. Le preferenze dell'utente hanno priorità su criteri di ottimizzazione secondari come correlazione e diversificazione stilistica.` : ''}

## REGOLE OBBLIGATORIE PROFILO ${profilo.toUpperCase()}:
- Rendimento atteso: ${regole.rendimentoMin} / ${regole.rendimentoMax}
- ⚠️ VINCOLO RENDIMENTO MINIMO: il portafoglio deve avere un rendimento lordo atteso ≥ ${rendimentoTarget ? (rendimentoTarget - 0.5).toFixed(1) : RENDIMENTO_MIN_PROFILO[profilo] || 4.0}% annuo.
- 🎯 OBIETTIVO RENDIMENTO LORDO: ${rendimentoTarget ? `L'utente ha scelto un obiettivo di ${rendimentoTarget}% lordo annuo${hasBuckets && rendimentoTargetLungo ? ` (il bucket LUNGO da solo deve puntare a ~${rendimentoTargetLungo}% lordo per compensare il bucket BREVE)` : ''}. Costruisci il portafoglio per avvicinarti il più possibile a questo target scegliendo asset class con rendimento storico appropriato.` : `Usa il range standard del profilo.`}
- 🚫 VINCOLO RENDIMENTO MASSIMO: il rendimento lordo dichiarato NON può superare ${rendimentoTarget ? (rendimentoTarget + 1.0).toFixed(1) : {Prudente:'6.5',Bilanciato:'9.5',Aggressivo:'11.0'}[profilo] || '9.5'}% lordo annuo. Questo è un HARD LIMIT.
- ⚠️ METODO STIMA RENDIMENTO: usa SEMPRE questi rendimenti attesi storici di lungo periodo (20-30 anni), NON perf5y:
  Azionario Globale/USA/Europa: ~7% lordo | Emergenti: ~6-7% lordo | Obblig. Gov EUR: ~2-3% lordo | Obblig. Corp EUR: ~3-4% lordo | Inflation-Linked: ~2-3% lordo | Oro/Commodity: ~4-5% lordo | Monetario EUR: ~2-3% lordo
  Rendimento netto = lordo × 0.74 (dopo tasse 26%) − TER ponderato
- 🚫 RANGE AZIONARIO FISSO: il range azionario ${regole.azionarioTarget-regole.azionarioRange}%-${regole.azionarioTarget+regole.azionarioRange}% è FISSO e NON si espande con obiettivi di rendimento più alti. Per raggiungere rendimenti più alti usa asset class più performanti DENTRO il range (es. più emergenti, small cap, tematici growth) — NON aumentare la quota azionaria oltre il limite.
- Quota azionaria: OBBLIGATORIA tra ${regole.azionarioTarget-regole.azionarioRange}% e ${regole.azionarioTarget+regole.azionarioRange}% (target ${regole.azionarioTarget}%). Verifica i pesi prima di rispondere.
${hasBuckets ? `- 🚫 VINCOLO AZ CON BUCKET — LEGGI CON ATTENZIONE:
  Il bucket BREVE (${bucketBreve.pct}%) contiene solo ETF NON azionari (obblig/monetario).
  Il range azionario ${regole.azionarioTarget-regole.azionarioRange}%-${regole.azionarioTarget+regole.azionarioRange}% si applica SOLO al bucket LUNGO (${bucketLungo.pct}%).
  Quindi la quota azionaria SUL TOTALE PORTAFOGLIO deve essere tra ${Math.round((regole.azionarioTarget-regole.azionarioRange)*bucketLungo.pct/100)}% e ${Math.round((regole.azionarioTarget+regole.azionarioRange)*bucketLungo.pct/100)}%.
  Esempio con bucket BREVE ${bucketBreve.pct}%: se il LUNGO ha 80% AZ → totale portafoglio = ${Math.round(80*bucketLungo.pct/100)}% AZ ✅
  NON applicare il range ${regole.azionarioTarget-regole.azionarioRange}%-${regole.azionarioTarget+regole.azionarioRange}% al totale — sarebbe matematicamente impossibile con il bucket BREVE attivo.` : ''}
${profilo === 'Prudente' ? `- 🚫 AZIONARIO MAX 35% PRUDENTE: la somma di TUTTI gli ETF azionari (inclusi Tematici, ESG, Smart Beta) NON può superare 35%.` : ''}
- Numero ETF: massimo ${regole.maxETF}
- ⚠️ VINCOLO TER: il TER medio PONDERATO del portafoglio DEVE essere < ${regole.terPreferito}%. Se un singolo ETF ha TER > ${regole.terPreferito}%, includilo SOLO se porta un contributo di diversificazione o rendimento insostituibile. MAX assoluto per singolo ETF: ${regole.terMax}%. Un ETF con TER elevato che erode il rendimento sotto soglia NON deve essere incluso.
- Capitalizzazione minima per ETF: ${regole.capMin}M€
- ${regole.maxDrawdown ? `Max drawdown storico: ≤${Math.abs(regole.maxDrawdown)}% in valore assoluto` : 'Drawdown: nessun limite formale'}
- ${regole.volatilita ? `Volatilità storica: ≤${regole.volatilita}%` : 'Volatilità: nessun limite'}
- Hedging valuta: ${regole.hedged}
${regole.note ? `- NOTA IMPORTANTE: ${regole.note}` : ''}

## CATEGORIE AZIONARIE (usale per calcolare la quota azionaria):
Azionario Globale, Azionario USA, Azionario Europa, Azionario Emergenti, Azionario Tematico, Azionario Pacifico

${macroContext}
## ETF DISPONIBILI:
${etfDisponibili.map(e => {
  const vol = e.vol3y ? `Vol1A:${e.variabilita}% Vol3A:${e.vol3y}%` : `Vol1A:${e.variabilita}%`;
  const dd = e.maxDrawdownMax ? `DD1A:${e.maxDrawdown}% DDMax:${e.maxDrawdownMax}%` : `DD1A:${e.maxDrawdown}%`;
  const perf = e.perf2024 ? `Perf1A:${e.perf1y}% Perf2024:${e.perf2024}% Perf2023:${e.perf2023 || 'N/D'}%` : `Perf1A:${e.perf1y}% Perf5A:${e.perf5y}%`;
  const extra = [
    e.dataLancio ? `Anno:${e.dataLancio}` : null,
    e.partecipazioni ? `Titoli:${e.partecipazioni}` : null,
    e.sostenibile ? 'ESG' : null,
  ].filter(Boolean).join(' ');
  return `- ${e.name} (${e.isin}) | Cat:${e.categoria}${e.area_geografica ? ' · Area:'+e.area_geografica : ''} | TER:${e.ter}% | ${vol} | ${dd} | ${perf} | AUM:${e.capitalizzazione}M€${extra ? ' | '+extra : ''}`;
}).join('\n')}

## VINCOLI AGGIUNTIVI OBBLIGATORI:
- La volatilità media PONDERATA del portafoglio non deve superare ${regole.volatilita !== null ? regole.volatilita+'%' : 'nessun limite'} annuo
- NON includere ETF con vol1y > 20% per profilo Bilanciato
- L'oro (ETF fisico sull'oro) massimo 5% del portafoglio per profilo Bilanciato
${profilo === 'Aggressivo' ? `- ⚠️ DIVERSIFICAZIONE AGGRESSIVO: NON costruire un portafoglio 100% azionario. Includi SEMPRE almeno 1 ETF non azionario (oro, commodity, o monetario se bucket attivo) con peso ≥ 5%.${hasBuckets && filosofiaBucket === 'difensiva' ? ` Il bucket BREVE difensivo (${bucketBreve.pct}%) conta come quota non azionaria — non serve aggiungere altro OB nel bucket LUNGO.` : ''}
${hasBuckets ? `- 🚫 LIMITE OB AGGRESSIVO CON BUCKET: il bucket BREVE (${bucketBreve.pct}%) è già obbligazionario per definizione. Il bucket LUNGO NON deve contenere ETF obbligazionari salvo eccezioni (inflation-linked max 5%). La quota OB del bucket BREVE NON conta verso il limite OB del profilo — il limite OB 0-20% si applica SOLO agli ETF obbligazionari nel bucket LUNGO.` : '- 🚫 LIMITE OB AGGRESSIVO: la quota obbligazionaria totale deve restare tra 0% e 20%. Se superi 20% elimina ETF obbligazionari o sostituiscili con azionario/commodity.'}` : ''}
${profilo === 'Bilanciato' ? `- ⚠️ VINCOLO OB BILANCIATO: la quota obbligazionaria totale deve essere tra il 25% e il 45%. Se superi il 45% sposta peso verso azionario. Se sei sotto il 25% aggiungi un ETF obbligazionario.${hasBuckets ? ` Con bucket BREVE attivo (${bucketBreve.pct}%): la quota OB del bucket BREVE NON conta verso questo limite — il limite 25-45% si applica solo agli ETF OB nel bucket LUNGO.` : ''}
- ⚠️ STABILITÀ BILANCIATO: per il nucleo del portafoglio privilegia ETF con AUM > 1B€ e storia > 5 anni. Usa ETF più piccoli o specializzati solo come satellite con peso max 15% ciascuno.` : ''}
${maxUSA && maxUSA !== 'No max' ? `- ⚠️ VINCOLO TASSATIVO MAX USA: la somma dei pesi degli ETF con esposizione prevalente agli USA (categoria "Azionario USA" o ETF S&P500/Nasdaq/Russell) NON deve superare ${maxUSA} del portafoglio totale. Questo è un hard limit — NON può essere ignorato per nessun motivo.` : '- Esposizione USA: nessun limite'}
- ⚠️ VINCOLO CATEGORIA UNICA: per ciascuna categoria del catalogo (es. "Obbligazionario Corporate", "Obbligazionario Governativo", "Azionario Globale", "Azionario USA", "Azionario Emergenti", "Liquidità / Monetario", ecc.) seleziona AL MASSIMO UN ETF. Due ETF della stessa categoria sono ridondanti: stessa esposizione, doppio TER, slot sprecato. UNICA ECCEZIONE consentita: nel caso "Obbligazionario Governativo" puoi avere DUE ETF se e solo se sono uno a duration BREVE (1-3y) e uno a duration LUNGA (10y+) — in quel caso indica esplicitamente nel motivo "duration breve" e "duration lunga". Per tutte le altre categorie il vincolo è assoluto.
- Le performance passate NON sono garanzia di rendimenti futuri: usa perf1y/5y solo per confronto relativo, NON come stima di rendimento futuro
- ⚠️ NESSUN PLACEHOLDER: ogni ETF in PORTAFOGLIO_JSON deve essere un ETF reale presente nella lista qui sopra (con ISIN valido e nome corretto). NON inventare ISIN, NON inserire placeholder, NON usare ETF con peso 0% per "riempire" il numero richiesto. Se non riesci a trovare ETF sufficienti per coprire tutti i requisiti, restituisci MENO ETF (anche solo il minimo richiesto dal profilo) — è meglio meno ETF veri che riempire con segnaposto.
${escludiDistribuzione ? `- VINCOLO TASSATIVO: seleziona SOLO ETF ad Accumulazione (Acc). ESCLUDI ASSOLUTAMENTE qualsiasi ETF a Distribuzione (Dist/Distributing). Questo vale sia per i consigliati che per le alternative. Se un ETF ha "Distributing" o "Dist" nel nome o nel suo tipo di replica, NON includerlo.` : ''}

## VINCOLO CORRELAZIONE (differenziato per profilo e asset class):
Stima la correlazione tra ogni coppia di ETF in base a categoria, area geografica e fattori.

**Soglie per profilo ${profilo}:**
${profilo === 'Prudente'
  ? '- Azionario vs Azionario: correlazione max 0.70 — il pool obbligazionario è naturalmente correlato, non penalizzarlo\n- Obbligazionario vs Obbligazionario: correlazione max 0.85 — accettabile per natura della categoria\n- Cross asset class: nessun limite — azionario + obbligazionario sono sempre decorrelati'
  : profilo === 'Bilanciato'
  ? '- Azionario vs Azionario: correlazione max 0.60 — evita duplicati geografici e settoriali\n- Obbligazionario vs Obbligazionario: correlazione max 0.75 — varietà di duration e tipo\n- Cross asset class: nessun limite'
  : '- Azionario vs Azionario: correlazione max 0.50 — massima diversificazione, evita overlap geografici\n- Obbligazionario vs Obbligazionario: correlazione max 0.70\n- Cross asset class: nessun limite'}

Esempi alta correlazione AZIONARIA (da evitare): due ETF MSCI World, due ETF S&P500, due ETF Value globali, due ETF Consumer Staples (anche se aree diverse).
Esempi bassa correlazione: azionario globale + emergenti, azionario + obbligazionario, azionario + oro, Europa + Asia.
- Questo vincolo è SOFT per obbligazionari: se rispettarlo richiede di sforare vol o drawdown, puoi ignorarlo.
- È più RIGIDO per azionari: due ETF azionari con correlazione stimata >soglia devono essere giustificati esplicitamente.
- Vincola le alternative: le alternative devono avere correlazione <soglia con i consigliati già selezionati.
- Nella SPIEGAZIONE indica le coppie con correlazione stimata più alta.

## FORMATO RISPOSTA — SEGUI ESATTAMENTE, NON DEVIARE:
⚠️ CRITICO: NON usare tabelle markdown (|col|col|), NON fare calcoli intermedi lunghi, NON ribilanciare più volte. Fai i calcoli mentalmente e scrivi SOLO il risultato finale.
⚠️ NON scrivere verifiche correlazioni, check pesi, ragionamenti intermedi — solo il risultato.

${hasBuckets ? `## PIANIFICAZIONE A DUE ORIZZONTI — VINCOLO OBBLIGATORIO:
Filosofia scelta dall'utente: ${filosofiaBucket.toUpperCase()}

${descrizioneBucket({tipo:'BREVE', pct_allocazione: bucketBreve.pct, orizzonte_anni: bucketBreve.anni}, profilo, macroData, filosofiaBucket)}

${descrizioneBucket({tipo:'LUNGO', pct_allocazione: bucketLungo.pct, orizzonte_anni: bucketLungo.anni}, profilo, macroData, filosofiaBucket)}

🚫 VINCOLO BUCKET ASSOLUTO — VERIFICA OBBLIGATORIA PRIMA DEL JSON:
1. La somma dei pesi degli ETF assegnati a bucket BREVE DEVE essere ESATTAMENTE ${bucketBreve.pct}% (±3% tolleranza).
2. La somma dei pesi degli ETF assegnati a bucket LUNGO DEVE essere ESATTAMENTE ${bucketLungo.pct}% (±3% tolleranza).
3. 🚫 MASSIMO 1 ETF nel bucket BREVE — concentra tutto il peso su un singolo ETF.
4. Il bucket BREVE NON può contenere ETF azionari.
5. VERIFICA FINALE: scrivi "Bucket BREVE: XX% — Bucket LUNGO: YY%" prima del JSON.
${filosofiaBucket === 'difensiva' && etfBucketDifensivo.length > 0 ? `
✅ ETF OBBLIGAZIONARI BREVE TERMINE per bucket DIFENSIVO (scegli da questa lista):
${etfBucketDifensivo.map(e => `- ${e.isin} | ${e.name} | TER ${e.ter}% | ${e.categoria}`).join('\n')}
🚫 VIETATO per bucket DIFENSIVO: IE00BD9MMF62 e qualsiasi ETF con "Ultra-Short", "Overnight", "0-1Y", "Fed Funds" nel nome.` : ''}
` : ''}
SPIEGAZIONE:
[Max 2 frasi: logica del portafoglio. NON citare rendimenti specifici. NON tabelle.]
[Una riga: METRICHE: azionaria:XX% | vol:XX% | TER:XX% | maxDD:-XX% | corr_max:0.XX | rend_lordo:XX%]

VERIFICA:
quota_azionaria: XX% (range ${hasBuckets ? `${Math.round((regole.azionarioTarget-regole.azionarioRange)*bucketLungo.pct/100)}%-${Math.round((regole.azionarioTarget+regole.azionarioRange)*bucketLungo.pct/100)}% sul totale` : `${regole.azionarioTarget-regole.azionarioRange}%-${regole.azionarioTarget+regole.azionarioRange}%`})
somma_pesi: 100%
limite_az: min=${hasBuckets ? Math.round((regole.azionarioTarget-regole.azionarioRange)*bucketLungo.pct/100) : regole.azionarioTarget-regole.azionarioRange}% max=${hasBuckets ? Math.round((regole.azionarioTarget+regole.azionarioRange)*bucketLungo.pct/100) : regole.azionarioTarget+regole.azionarioRange}%
🚫 BLOCCO: se quota_azionaria > ${hasBuckets ? Math.round((regole.azionarioTarget+regole.azionarioRange)*bucketLungo.pct/100) : regole.azionarioTarget+regole.azionarioRange}% → DEVI ridurla prima di procedere. Sposta peso in eccesso su oro o commodity.
🚫 BLOCCO: se quota_azionaria < ${hasBuckets ? Math.round((regole.azionarioTarget-regole.azionarioRange)*bucketLungo.pct/100) : regole.azionarioTarget-regole.azionarioRange}% → DEVI aumentarla prima di procedere. Sposta peso da OB/LIQ a azionario.

PORTAFOGLIO_JSON:
[{"isin": "ISIN", "peso": 30, "motivo": "max 80 caratteri"}]

REGOLE FORMATO:
- Il JSON deve essere l'ULTIMA cosa che scrivi
- Pesi devono sommare a 100. Max ${regole.maxETF} ETF. Solo ISIN dalla lista disponibile
- Se la quota azionaria non rientra nel range: correggi i pesi PRIMA di scrivere il JSON
- NON aggiungere nulla dopo il JSON`;

  try {
    const message = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });
    const testo = message.content[0].text;
    const parti = testo.split('PORTAFOGLIO_JSON:');
    const spiegazione = parti[0].replace('SPIEGAZIONE:', '').trim();

    // Estrai rendimento lordo dalla riga METRICHE
    const rendLordoMatch = spiegazione.match(/rend_lordo:([\d.]+)%/i)
      || spiegazione.match(/rendimento[^:]*lordo[^:]*:?\s*[~≈]?(\d+[\.,]\d+)\s*%/i);
    const rendAttesoLordoBackend = rendLordoMatch ? parseFloat(rendLordoMatch[1].replace(',', '.')) : null;
    if (rendAttesoLordoBackend) console.log(`  [crea-portafoglio] rend_lordo estratto: ${rendAttesoLordoBackend}%`);
    let selezione = [];
    if (parti[1]) {
      try { selezione = JSON.parse(parti[1].trim().match(/\[[\s\S]*\]/)?.[0] || '[]'); } catch (e) {
        console.log(`  [crea-portafoglio] Errore parse JSON: ${e.message}`);
        console.log(`  [crea-portafoglio] Testo raw dopo PORTAFOGLIO_JSON: ${parti[1].slice(0, 300)}`);
      }
    } else {
      console.log(`  [crea-portafoglio] PORTAFOGLIO_JSON non trovato nella risposta AI`);
      console.log(`  [crea-portafoglio] Risposta AI (prime 500 char): ${testo.slice(0, 500)}`);
    }
    console.log(`  [crea-portafoglio] AI ha selezionato ${selezione.length} ETF: ${selezione.map(s => s.isin).join(', ')}`);
    // Se 0 ETF, logga la risposta completa per debug
    if (selezione.length === 0) {
      console.log(`  [crea-portafoglio] RISPOSTA AI COMPLETA:\n${testo}`);
    }
    // Verifica quali ISIN non sono nel pool disponibile
    const isinDisponibili = new Set(etfDisponibili.map(e => e.isin));
    const isinNonTrovati = selezione.filter(s => !isinDisponibili.has(s.isin));
    if (isinNonTrovati.length > 0) {
      console.log(`  [crea-portafoglio] ⚠ ISIN non nel pool disponibile: ${isinNonTrovati.map(s => s.isin).join(', ')}`);
    }



    // ETF_INFO_MAP — SOLO FALLBACK per ETF non ancora in prezzi_storici DB
    // Prezzi verificati da Yahoo Finance 13/03/2026. FONTE PRIMARIA = prezzi_storici DB.
    // ⚠️ Non aggiornare questi manualmente — aggiornare invece tramite "Aggiorna Prezzi"
    const ETF_INFO_MAP = {
      // ── Azionario Globale ──
      'IE00B4L5Y983': { q: 112.18, a: 2009 }, // iShares MSCI World (IWDA.AS)
      'IE00B3XXRP09': { q: 147.18, a: 2012 }, // Vanguard FTSE All-World dist (VWRL.AS)
      'IE00BK5BQT80': { q: 147.18, a: 2019 }, // Vanguard FTSE All-World Acc (VWCE.DE)
      'IE00B4L5YX21': { q: 41.00,  a: 2005 }, // SPDR MSCI World (SWRD.MI)
      'LU1681041782': { q: 19.61,  a: 2018 }, // Xtrackers MSCI World Swap (LCUW.DE)
      // ── Azionario USA ──
      'IE00B5BMR087': { q: 626.23, a: 2010 }, // iShares Core S&P 500 (CSPX.AS)
      'IE00B3ZW0K18': { q: 45.79,  a: 2010 }, // iShares S&P 500 EUR Hedged (IUES.AS)
      'IE0032077012': { q: 524.35, a: 2002 }, // Invesco Nasdaq-100 (EQQQ.MI)
      // ── Azionario Europa ──
      'IE00B4K48X80': { q: 69.50,  a: 2010 }, // iShares Core MSCI Europe (IESE.MI)
      'LU1681043599': { q: 110.68, a: 2000 }, // Amundi MSCI Europe (MEUR.DE)
      'IE00B53L3W79': { q: 54.20,  a: 2002 }, // iShares Core EURO STOXX 50 (EXW1.DE)
      // ── Azionario Emergenti ──
      'IE00BKM4GZ66': { q: 76.59,  a: 2014 }, // iShares Core MSCI EM IMI (AEME.MI)
      'IE00B4L5YC18': { q: 40.82,  a: 2014 }, // iShares Core MSCI EM IMI USD (EMIM.AS)
      'LU1050469367': { q: 15.82,  a: 2014 }, // Amundi MSCI Emerging Markets
      'LU1829219655': { q: 153.92, a: 2018 }, // Amundi MSCI Emerging (CRPE.MI)
      'LU1681045370': { q: 6.58,   a: 2016 }, // Amundi MSCI EM (AEEM.PA)
      // ── Azionario con Hedge valuta ──
      'IE00B441G979': { q: 40.09,  a: 2014 }, // iShares MSCI World EUR Hedged (IWDE.AS)
      // ── Azionario Factor/Smart Beta ──
      'IE00BP3QZB59': { q: 39.50,  a: 2014 }, // iShares Edge MSCI World Value (IWVL.AS)
      'IE00B3VVMM84': { q: 8.05,   a: 2009 }, // iShares MSCI World Small Cap (IUSN.DE)
      // ── Tematici ──
      'IE00BGDQ0H97': { q: 26.54,  a: 2015 }, // iShares Automation & Robotics (RBOT.MI)
      'IE00B4JNQZ49': { q: 34.57,  a: 2016 }, // iShares Healthcare Innovation (IQQL.DE)
      'IE00BYVJRP78': { q: 49.70,  a: 2018 }, // iShares Global Clean Energy (IQQH.MI)
      'IE00BFG0R112': { q: 7.48,   a: 2016 }, // iShares MSCI EM IMI ESG (IEME.MI)
      'IE00BD4DXW77': { q: 23.68,  a: 2018 }, // iShares Core MSCI Pacific (CPAC.MI)
      // ── Obbligazionario Gov EUR ──
      'IE00B3FH7618': { q: 141.90, a: 2006 }, // iShares € Govt Bond 1-3yr (IBGS.AS)
      'IE00B4WXJJ64': { q: 235.00, a: 2008 }, // iShares € Inflation Linked (IBCI.AS) — quota alta reale
      'LU0290358497': { q: 148.63, a: 2007 }, // Xtrackers EUR Overnight (XEON.DE)
      // ── Obbligazionario Corp EUR ──
      'IE00B3F81R35': { q: 107.07, a: 2009 }, // iShares Core EUR Corp Bond (IEAG.AS)
      'IE00B3F81409': { q: 124.28, a: 2003 }, // iShares € Corp Bond (IBCX.AS)
      'IE00B66F4759': { q: 91.93,  a: 2010 }, // iShares EUR High Yield (IHYG.MI)
      'IE00BJK55C48': { q: 5.12,   a: 2017 }, // iShares EUR HY Corp Bond ESG (XHYA.DE)
      // ── Oro / Materie Prime ──
      'FR0013416716': { q: 47.80,  a: 2019 }, // Amundi Physical Gold ETC (GOLD.AS)
      'IE00B4ND3602': { q: 427.75, a: 2011 }, // iShares Physical Gold (SGLD.MI)
      'DE000A1EK0G3': { q: 175.96, a: 2011 }, // Xetra-Gold (4GLD.DE)
      'DE000A0S9GB0': { q: 142.85, a: 2007 }, // iShares Gold (IGLN.AS)
      // ── Amundi Multi-Asset ──
      'LU1829218749': { q: 221.66, a: 2018 }, // Amundi MSCI World (CW8.PA)
      'LU1437016972': { q: 12.50,  a: 2016 }, // Amundi MSCI World (altra classe)
      'LU0908500753': { q: 14.82,  a: 2013 }, // Amundi Core Stoxx Europe 600 (C600.PA)
      // ── ETF Xtrackers / vari frequenti nel catalogo ──
      'IE00BJ0KDQ92': { q: 82.50,  a: 2014 }, // Xtrackers MSCI World UCITS ETF 1C (XDWD.DE)
      'IE00BL25JM42': { q: 35.20,  a: 2013 }, // Xtrackers MSCI World Value UCITS ETF 1C (XDEV.DE)
      'LU0478205379': { q: 162.50, a: 2010 }, // Xtrackers II EUR Corporate Bond UCITS ETF (XBLC.DE)
      'IE00B6R52259': { q: 93.40,  a: 2011 }, // iShares MSCI ACWI UCITS ETF (IUSQ.DE)
      'IE00BGSF1X88': { q: 103.20, a: 2019 }, // iShares USD Treasury Bond 0-1yr (IB01.AS)
      'IE00B3RBWM25': { q: 118.50, a: 2012 }, // Vanguard FTSE All-World (Dist) (VWRL.AS)
      'IE00B3YCGJ38': { q: 47.80,  a: 2010 }, // Invesco S&P 500 UCITS ETF Acc (SPXS.MI)
      'IE0031442068': { q: 554.00, a: 2002 }, // iShares Core S&P 500 USD (Dist) (CSP1.AS)
      'IE0005042456': { q: 38.50,  a: 2000 }, // iShares Core FTSE 100 (ISF.L)
    };

    // Leggi prezzi aggiornati da prezzi_storici DB — tutti gli ISIN del catalogo (per consigliati E alternative)
    const prezziDB = {};
    const quotazioniCatalogo = {}; // fallback: quotazione diretta dal catalogo
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // ultimi 30gg
      // Leggi tutti i prezzi recenti in una query sola
      const { rows: allPrezzi } = await db.query(
        'SELECT isin, prezzo FROM prezzi_storici WHERE data >= $1 AND prezzo > 0 ORDER BY data DESC',
        [cutoff]
      );
      // Tieni solo il più recente per ISIN
      allPrezzi.forEach(r => { if (!prezziDB[r.isin]) prezziDB[r.isin] = r.prezzo; });
      console.log(`  [crea-portafoglio] Prezzi da DB: ${Object.keys(prezziDB).length} ISIN disponibili`);
      // Leggi quotazione diretta dal catalogo come fallback per ETF senza prezzi_storici
      const { rows: quotRows } = await db.query(
        'SELECT isin, quotazione FROM etf_catalog WHERE quotazione IS NOT NULL AND quotazione > 0'
      );
      quotRows.forEach(r => { quotazioniCatalogo[r.isin] = r.quotazione; });
      console.log(`  [crea-portafoglio] Quotazioni catalogo (fallback): ${Object.keys(quotazioniCatalogo).length} ISIN`);
    } catch (e) {
      console.log('  [crea-portafoglio] Errore lettura prezzi DB:', e.message);
    }

    // Arricchisci ogni ETF con dati catalogo e calcola acquisti
    // Priorità: prezziDB (Yahoo reale, aggiornato 7gg) -> ETF_INFO_MAP (fallback statico)
    selezione = selezione.map(s => {
      const etf = etfDisponibili.find(e => e.isin === s.isin);
      if (!etf) return s;
      const info = ETF_INFO_MAP[s.isin] || {};
      // Priorità: 1) prezzi_storici DB (Yahoo aggiornato) 2) ETF_INFO_MAP (statico) 3) quotazione catalogo
      const quotazioneReale = prezziDB[s.isin] || info.q || quotazioniCatalogo[s.isin] || 0;
      const annoNascita = info.a || null;
      if (prezziDB[s.isin]) console.log(`    ${s.isin}: EUR${quotazioneReale} (DB Yahoo)`);
      else if (info.q) console.log(`    ${s.isin}: EUR${quotazioneReale} (mappa fallback)`);
      else if (quotazioniCatalogo[s.isin]) console.log(`    ${s.isin}: EUR${quotazioneReale} (catalogo fallback)`);
      else console.log(`    ${s.isin}: EUR0 WARN nessun prezzo`);
      const enriched = {
        ...s,
        name: etf.name,
        ter: etf.ter,
        categoria: etf.categoria,
        valuta: etf.valuta,
        perf1y: etf.perf1y,
        perf5y: etf.perf5y,
        capitalizzazione: etf.capitalizzazione,
        variabilita: etf.variabilita,
        maxDrawdown: etf.maxDrawdown ?? null,
        maxDrawdown5y: etf.maxDrawdown5y ?? null,
        smartBeta: etf.smartBeta || null,
        annoNascita,
        quotazioneAcquisto: quotazioneReale || null,
        bucket: hasBuckets ? assegnaBucketAutomatico({ ...etf, name: etf.name }) : undefined,
      };
      if (conCapitale && quotazioneReale > 0 && s.peso) {
        const cap = parseFloat(capitale);
        const valoreAllocato = cap * (s.peso / 100);
        const quantita = Math.floor(valoreAllocato / quotazioneReale);
        return { ...enriched, quantita: quantita > 0 ? quantita : null, valoreAllocato: parseFloat(valoreAllocato.toFixed(2)), valoreEffettivo: quantita > 0 ? parseFloat((quantita * quotazioneReale).toFixed(2)) : 0 };
      }
      return enriched;
    });
    // Costruisci selezioneConAlternative:
    // PRIMA dedup correlazione (ora selezione è arricchita con name e categoria)
    // Poi raccogli tutti gli ISIN consigliati, POI cerca alternative escludendo tutti i consigliati

    // ── DEDUP CORRELAZIONE post-arricchimento ──
    {
      const FATTORI_CORR = ['value', 'growth', 'momentum', 'quality', 'low vol', 'low volatility',
                        'dividend', 'small cap', 'small-cap', 'nasdaq', 's&p 500', 's&p500',
                        'stoxx 50', 'stoxx50', 'high yield', 'inflation', 'aggregate',
                        'government', 'treasury', 'corporate', 'emerging', 'world'];

      // Settori tematici: se due ETF appartengono allo stesso settore ma aree diverse
      // vengono considerati correlati (es. Consumer Staples WW + Consumer Staples EU)
      const SETTORI_TEMATICI = [
        'consumer staples', 'consumer discret', 'health', 'healthcare', 'salute',
        'energy', 'energia', 'financial', 'banche', 'technology', 'tecnolog',
        'utilities', 'utility', 'industrial', 'material', 'real estate', 'immobil',
        'communication', 'telecom', 'infrastructure', 'clean energy', 'robotics',
        'automation', 'water', 'food', 'agri',
      ];
      const getSettore = (name) => {
        const n = (name || '').toLowerCase();
        return SETTORI_TEMATICI.find(s => n.includes(s)) || null;
      };

      const getFattoreCorr = (name) => {
        const n = (name || '').toLowerCase();
        return FATTORI_CORR.find(f => n.includes(f)) || '__generic__';
      };

      // Chiave dedup: categoria geografica macro + fattore + settore tematico
      // Due ETF con stesso settore tematico (es. Consumer Staples) ma area diversa
      // vengono trattati come correlati e deduplicati
      // Per obbligazionari: dedup più permissivo per Prudente (natura alta correlazione)
      const isObbligazionario = (etf) => (etf.categoria || '').toLowerCase().includes('obblig') ||
        (etf.categoria || '').toLowerCase().includes('governat') ||
        (etf.categoria || '').toLowerCase().includes('corporate') ||
        (etf.categoria || '').toLowerCase().includes('monetar');

      const getCatKeyCorr = (etf) => {
        const settore = getSettore(etf.name);
        if (settore) {
          // Per tematici settoriali: ignora l'area geografica, usa solo il settore
          return `settore::${settore}`;
        }
        // Per obbligazionari con profilo Prudente: dedup solo su categoria+fattore_principale
        // (evita di rimuovere obbligazionari naturalmente correlati ma complementari per duration)
        if (isObbligazionario(etf) && profilo === 'Prudente') {
          const cat = (etf.categoria || 'sconosciuta').toLowerCase().replace(/\s+/g, '_');
          const fattore = getFattoreCorr(etf.name);
          // Per Prudente: distingui anche per duration (short/long) così non rimuove diversità
          const duration = etf.name.toLowerCase().includes('1-3') || etf.name.toLowerCase().includes('short') ? 'short'
            : etf.name.toLowerCase().includes('7-10') || etf.name.toLowerCase().includes('long') ? 'long' : 'mid';
          return `${cat}::${fattore}::${duration}`;
        }
        const cat = (etf.categoria || 'sconosciuta').toLowerCase().replace(/\s+/g, '_');
        const fattore = getFattoreCorr(etf.name);
        return `${cat}::${fattore}`;
      };

      const catKeyUsed = new Map(); // key → etf
      const selezioneDedup = [];
      for (const s of selezione) {
        const key = getCatKeyCorr(s);
        if (catKeyUsed.has(key)) {
          const existing = catKeyUsed.get(key);
          // Tieni quello col peso maggiore (scelta AI più convinta)
          const keep = (s.peso || 0) >= (existing.peso || 0) ? s : existing;
          const remove = keep === s ? existing : s;
          console.log(`  [corr-dedup] RIMOSSO ${remove.isin} (${remove.name}) — stessa categoria+fattore di ${keep.isin}, key: ${key}`);
          if (keep !== existing) {
            selezioneDedup.splice(selezioneDedup.indexOf(existing), 1);
            selezioneDedup.push(keep);
            catKeyUsed.set(key, keep);
          }
          // altrimenti l'existing rimane, il nuovo viene semplicemente scartato
        } else {
          selezioneDedup.push(s);
          catKeyUsed.set(key, s);
        }
      }

      // Controllo: non scendere mai sotto minETF
      const regoleCorr = REGOLE_PROFILO[profilo] || REGOLE_PROFILO.Bilanciato;
      if (selezioneDedup.length < regoleCorr.minETF) {
        console.log(`  [corr-dedup] ANNULLATO: dopo dedup resterebbero ${selezioneDedup.length} ETF < minETF(${regoleCorr.minETF}). Dedup non applicato.`);
        // Non toccare selezione — mantieni tutto com'è
      } else if (selezioneDedup.length < selezione.length) {
        console.log(`  [corr-dedup] ${selezione.length - selezioneDedup.length} ETF rimossi. Ricalcolo pesi...`);
        // Rinormalizza pesi a 100
        const totPeso = selezioneDedup.reduce((t, e) => t + (e.peso || 0), 0);
        if (totPeso > 0 && totPeso !== 100) {
          selezioneDedup.forEach(e => { e.peso = Math.round(e.peso * 100 / totPeso); });
          const diff = 100 - selezioneDedup.reduce((t, e) => t + e.peso, 0);
          if (diff !== 0) selezioneDedup[0].peso += diff;
          // Ricalcola anche quantita/valoreAllocato con il nuovo peso
          if (conCapitale) {
            const cap = parseFloat(capitale);
            selezioneDedup.forEach(e => {
              if (e.quotazioneAcquisto > 0) {
                e.valoreAllocato = parseFloat((cap * e.peso / 100).toFixed(2));
                e.quantita = Math.floor(e.valoreAllocato / e.quotazioneAcquisto) || null;
                e.valoreEffettivo = e.quantita ? parseFloat((e.quantita * e.quotazioneAcquisto).toFixed(2)) : 0;
              }
            });
          }
        }
        selezione.length = 0;
        selezione.push(...selezioneDedup);
      }
    }
    const isinConsigliati = new Set(selezione.map(s => s.isin));
    selezione.forEach(s => { s.tipo = 'consigliato'; });

    // Pool per alternative: filtri rilassati (vol<=25%, dd>=-35%) per avere sempre 2 alternative per TOP
    const etfPerAlternative = await getEtfPerProfilo(profilo, false, true);

    const selezioneConAlternative = [];
    const isinUsatiPerAlternative = new Set(isinConsigliati); // parte già con tutti i consigliati esclusi

    selezione.forEach(s => {
      selezioneConAlternative.push(s);

      // Alternative: stessa categoria, ISIN non consigliato e non già usato come alternativa
      const alternative = etfPerAlternative
        .filter(e => e.categoria === s.categoria && !isinUsatiPerAlternative.has(e.isin))
        .slice(0, 1)
        .map((e, idx) => {
          isinUsatiPerAlternative.add(e.isin);
          const info = ETF_INFO_MAP[e.isin] || {};
          const quotazioneAlt = prezziDB[e.isin] || info.q || null;
          return {
            isin: e.isin,
            name: e.name,
            ter: e.ter,
            categoria: e.categoria,
            valuta: e.valuta,
            perf1m: e.perf1m ?? 0,
            perf6m: e.perf6m ?? 0,
            perf1y: e.perf1y ?? 0,
            perf5y: e.perf5y ?? 0,
            capitalizzazione: e.capitalizzazione,
            variabilita: e.variabilita,
            peso: 0,
            motivo: `Alternativa a ${s.name} — stessa categoria ${s.categoria}`,
            tipo: 'alternativa1',
            quotazioneAcquisto: quotazioneAlt,
            annoNascita: info.a || null,
            quantita: null,
          };
        });
      selezioneConAlternative.push(...alternative);
    });

    // Fetch Yahoo in tempo reale per ETF ancora senza prezzo — solo se hanno ticker nel DB
    const etfSenzaPrezzo = selezioneConAlternative.filter(e => !e.quotazioneAcquisto || e.quotazioneAcquisto <= 0);
    if (etfSenzaPrezzo.length > 0) {
      // Carica ticker dal DB per questi ISIN
      const isinSenzaPrezzo = etfSenzaPrezzo.map(e => e.isin);
      const placeholdersTicker = isinSenzaPrezzo.map((_, i) => `$${i+1}`).join(',');
      let tickerDBMap = {};
      try {
        const { rows: tickerRows } = await db.query(
          `SELECT isin, ticker_yahoo FROM etf_catalog WHERE isin IN (${placeholdersTicker}) AND ticker_yahoo IS NOT NULL AND ticker_yahoo != ''`,
          isinSenzaPrezzo
        );
        tickerRows.forEach(r => { tickerDBMap[r.isin] = r.ticker_yahoo; });
      } catch {}
      const etfConTicker = etfSenzaPrezzo.filter(e => tickerDBMap[e.isin]);
      console.log(`  Fetch Yahoo live per ${etfConTicker.length}/${etfSenzaPrezzo.length} ETF senza prezzo (con ticker)...`);
      for (const etf of etfConTicker) {
        const fetched = await fetchETF(etf.isin);
        if (fetched?.quotazione > 0) {
          etf.quotazioneAcquisto = fetched.quotazione;
          // Ricalcola quantita per i consigliati
          if (etf.tipo === 'consigliato' && conCapitale && etf.peso) {
            const cap = parseFloat(capitale);
            const valoreAllocato = cap * (etf.peso / 100);
            const quantita = Math.floor(valoreAllocato / fetched.quotazione);
            etf.quantita = quantita > 0 ? quantita : null;
            etf.valoreEffettivo = quantita > 0 ? parseFloat((quantita * fetched.quotazione).toFixed(2)) : 0;
          }
          // Salva in prezzi_storici per i prossimi reload
          try {
            const oggi = new Date().toISOString().slice(0, 10);
            await db.query(
              `INSERT INTO prezzi_storici (isin, data, prezzo) VALUES ($1, $2, $3)
               ON CONFLICT(isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo`,
              [etf.isin, oggi, fetched.quotazione]
            );
          } catch {}
          console.log(`    ✓ ${etf.isin}: EUR${fetched.quotazione} (Yahoo live)`);
        } else {
          console.log(`    ✗ ${etf.isin}: prezzo non trovato`);
        }
        await new Promise(r => setTimeout(r, 300)); // rate limiting
      }
    }

    // ── Verifica vincolo maxUSA ──────────────────────────────────────────────
    let avvisoMaxUSA = null;
    if (maxUSA && maxUSA !== 'No max') {
      const limiteUSA = parseInt(maxUSA); // es. "30" → 30
      const catUSA = ['Azionario USA'];
      const totPesoUSA = selezione
        .filter(e => catUSA.some(c => (e.categoria || '').includes(c)) ||
                     /s&p|nasdaq|russell|dow jones/i.test(e.name))
        .reduce((sum, e) => sum + (e.peso || 0), 0);
      if (totPesoUSA > limiteUSA) {
        avvisoMaxUSA = `⚠️ Attenzione: l'esposizione USA risultante è ${totPesoUSA.toFixed(0)}%, superiore al limite impostato di ${maxUSA}. L'AI ha incluso ETF globali (es. MSCI World) che hanno una componente USA significativa ma non sono classificati come "Azionario USA" puri.`;
        console.log(`  [maxUSA] VIOLAZIONE: ${totPesoUSA.toFixed(0)}% > ${limiteUSA}%`);
      } else {
        console.log(`  [maxUSA] OK: esposizione USA ${totPesoUSA.toFixed(0)}% <= ${limiteUSA}%`);
      }
    }

    // Calcola scenario macro da includere nella risposta (per il frontend)
    let scenarioMacro = 'NEUTRO';
    try {
      const pt = getPosizionetattica(profilo, orizzonteAnni || 5, macroData);
      scenarioMacro = pt.scenario || 'NEUTRO';
    } catch (e) { /* fallback NEUTRO */ }

    console.log(`  ✓ Portafoglio AI: ${selezione.length} ETF consigliati + ${selezioneConAlternative.length - selezione.length} alternative | scenario: ${scenarioMacro}`);
    const bucketInfo = hasBuckets ? {
      attivo: true,
      filosofia: filosofiaBucket,
      breve: { pct: bucketBreve.pct, anni: bucketBreve.anni },
      lungo: { pct: bucketLungo.pct, anni: bucketLungo.anni },
    } : null;
    res.json({ spiegazione, selezione: selezioneConAlternative, capitaleUsato: conCapitale ? parseFloat(capitale) : null, avvisoMaxUSA, scenarioMacro, bucketInfo, rendAttesoLordo: rendAttesoLordoBackend });
  } catch (err) {
    res.status(500).json({ error: 'Errore creazione portafoglio AI: ' + err.message });
  }
});


  return router;
};
