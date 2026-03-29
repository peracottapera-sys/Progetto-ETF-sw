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
  const sb   = (etf.smartBeta || '').toLowerCase();
  const name = (etf.name || '').toLowerCase();

  // BREVE: monetario, liquidità, ultra-short, overnight
  if (cat.includes('monetar') || cat.includes('liquidit')) return 'BREVE';
  if (name.includes('ultra-short') || name.includes('ultra short') || name.includes('overnight')
      || name.includes('eonia') || name.includes('estr') || name.includes('money market')) return 'BREVE';

  // BREVE: obbligazionario breve duration
  if (cat.includes('obblig') && (cat.includes('1-3') || cat.includes('breve') || cat.includes('short')
      || cat.includes('0-1') || cat.includes('1-5') || cat.includes('0-3'))) return 'BREVE';

  // BREVE: categoria "Altro" con vol bassa → probabilmente monetario/breve non classificato
  if (cat === 'altro' && etf.variabilita !== undefined && parseFloat(etf.variabilita) < 2) return 'BREVE';

  // BREVE: Smart Beta difensivi
  if (sb === 'low volatility' || sb === 'dividend') return 'BREVE';

  // LUNGO: azionario, tematico, emergenti, commodity
  if (cat.includes('azionario') || cat.includes('equity') || cat.includes('tematico') || cat.includes('emergenti')) return 'LUNGO';
  if (cat.includes('commodity') || cat.includes('real asset')) return 'LUNGO';

  // ORO: bucket dipende dalla filosofia — di default LUNGO ma può essere hedge nel breve
  // L'AI decide in base al contesto, qui lo mettiamo LUNGO come default
  if (cat.includes('oro') || cat.includes('metalli') || cat.includes('gold') || name.includes('gold') || name.includes(' oro')) return 'LUNGO';

  // Smart Beta growth
  if (sb === 'momentum' || sb === 'small cap' || sb === 'value') return 'LUNGO';

  // Default: LUNGO
  return 'LUNGO';
}

// ── Descrizione testuale bucket per prompt ─────────────────────────────────
function descrizioneBucket(bucket, profilo, macroData, filosofia = 'difensiva') {
  const orizzLabel = bucket.orizzonte_anni <= 4 ? 'BREVE' : bucket.orizzonte_anni >= 10 ? 'LUNGO' : 'MEDIO';

  const regoleBucket = {
    BREVE: {
      difensiva: {
        Prudente:   'BUCKET DIFENSIVO: Protezione capitale. Solo obblig. breve duration (1-3Y), monetario EUR, Low Volatility. Max azionario 10%. DEVI includere almeno 1 ETF monetario o obbligazionario breve.',
        Bilanciato: 'BUCKET DIFENSIVO: Stabilita. Obblig. breve-medio, Dividend, Low Vol. Max azionario 25%. DEVI includere almeno 1 ETF difensivo (monetario, obblig. breve o Low Volatility).',
        Aggressivo: 'BUCKET DIFENSIVO: Riserva stabile. Obblig. breve termine, monetario EUR. Max azionario 20%. DEVI includere almeno 1 ETF monetario o obbligazionario breve per la protezione del capitale a breve.',
      },
      opportunistica: {
        Prudente:   'BUCKET OPPORTUNISTICO: Liquidita tattica. Monetario EUR ad alto rendimento, obblig. breve. Pronto per acquisti opportunistici. DEVI includere almeno 1 ETF monetario.',
        Bilanciato: 'BUCKET OPPORTUNISTICO: Liquidita tattica da impiegare su cali di mercato (VIX elevato). Monetario EUR, obblig. breve, eventualmente ETF con bassa correlazione al mercato. DEVI includere almeno 1 ETF monetario o quasi-monetario.',
        Aggressivo: 'BUCKET OPPORTUNISTICO: Polvere da sparo per acquisti a sconto durante crisi. Monetario EUR o obblig. breve a breve duration. Con VIX >25 questo bucket e pronto per entrare su azionario a prezzi scontati. DEVI includere almeno 1 ETF monetario o obbligazionario breve.',
      },
    },
    LUNGO: {
      difensiva: {
        Prudente:   'BUCKET CRESCITA: Crescita prudente. Azionario difensivo (Quality, Dividend), obblig. medio-lungo. Max azionario 35%.',
        Bilanciato: 'BUCKET CRESCITA: Crescita bilanciata. Mix azionario globale e obblig. Fattori Value/Quality. Azionario 50-70%.',
        Aggressivo: 'BUCKET CRESCITA: Massimizzazione. Azionario globale, emergenti, tematici, Small Cap, Momentum. Azionario 80%+.',
      },
      opportunistica: {
        Prudente:   'BUCKET CRESCITA: Crescita prudente con tilt difensivo. Azionario Quality e Dividend, obblig. medio termine.',
        Bilanciato: 'BUCKET CRESCITA: Mix azionario e obbligazionario. Mantieni esposizione per il rialzo di lungo periodo mentre il bucket breve aspetta opportunita.',
        Aggressivo: 'BUCKET CRESCITA: Azionario aggressivo globale, emergenti, tematici. Questo e il motore di rendimento mentre il bucket breve aspetta opportunita di acquisto.',
      },
    },
  };

  const regola = regoleBucket[orizzLabel]?.[filosofia]?.[profilo]
    || regoleBucket[orizzLabel]?.difensiva?.[profilo]
    || 'Parametri standard del profilo.';

  const orizzonteLabel = bucket.orizzonte_anni >= 10 ? "oltre 10 anni" : bucket.orizzonte_anni + " anni";
  return `Bucket ${bucket.tipo} (${bucket.pct_allocazione}% capitale | Orizzonte: ${orizzonteLabel} | Filosofia: ${filosofia.toUpperCase()})
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
    r.azionarioTarget = Math.max(0, r.azionarioTarget - 10);
    r.azionarioRange = Math.max(5, (r.azionarioRange || 10) - 2);
    if (r.maxDrawdownAbs) r.maxDrawdownAbs = Math.max(10, r.maxDrawdownAbs - 5);
    if (r.maxDrawdown) r.maxDrawdown = Math.min(-10, r.maxDrawdown + 5);
    if (r.volatilita) r.volatilita = Math.max(8, r.volatilita - 3);
    r.noteOrizzonte = `Orizzonte BREVE (${anni} anni): ridotta quota azionaria, privilegia obbligazionario breve duration (1-3Y), liquidità EUR, bassa volatilità. Il capitale potrebbe servire presto.`;
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
${etfCatalogo.map(e => `- ${e.name} (${e.isin}) | ${e.categoria}${e.smartBeta ? ' ['+e.smartBeta+']' : ''} | TER:${e.ter}% | Quotaz:€${e.quotazione||0} | Vol1A:${e.variabilita||'N/D'}% | Perf1A:${e.perf1y||0}%`).join('\n')}

${macroContext}

## ISTRUZIONI RISPOSTA — segui ESATTAMENTE questo formato:

SEMAFORI:
diversificazione:VERDE|GIALLO|ROSSO:commento breve (max 80 caratteri)
correlazione:VERDE|GIALLO|ROSSO:commento breve (max 80 caratteri) — VERDE se max correlazione stimata <0.5, GIALLO 0.5-0.7, ROSSO >0.7
volatilita:VERDE|GIALLO|ROSSO:commento breve
drawdown:VERDE|GIALLO|ROSSO:commento breve
ter:VERDE|GIALLO|ROSSO:commento breve
azionario:VERDE|GIALLO|ROSSO:commento breve

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
    const semaforiRaw = getSection('SEMAFORI', 'PUNTI_CHIAVE');
    const semafori = {};
    semaforiRaw.split('\n').forEach(r => {
      const p = r.trim().split(':');
      if (p.length >= 3) semafori[p[0]] = { stato: p[1], commento: p.slice(2).join(':') };
    });

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

    console.log(`  ✓ Analisi OK | semafori:${Object.keys(semafori).length} | punti:${puntiChiave.length} | modifiche:${modifiche.length}`);
    res.json({ semafori, puntiChiave, analisiDettagliata, modifiche });
  } catch (err) {
    console.error('[analisi]', err.message);
    res.status(500).json({ error: 'Errore analisi AI: ' + err.message });
  }
});


// POST /api/ai/genera-pdf — restituisce HTML stampabile (browser → Stampa → Salva PDF)
router.post('/genera-pdf', authMiddleware, (req, res) => {
  const { portfolio, semafori, puntiChiave, analisiDettagliata, modifiche } = req.body;
  if (!portfolio || !analisiDettagliata) return res.status(400).json({ error: 'Dati mancanti' });

  const data = new Date().toLocaleDateString('it-IT');
  const statoColor = s => s==='VERDE'?'#22c55e':s==='GIALLO'?'#eab308':'#ef4444';
  const statoEmoji = s => s==='VERDE'?'✅':s==='GIALLO'?'⚠️':'🔴';

  const etfSelezionati = (portfolio.etfs||[]).filter(e=>e.selected);
  const totInvestito = etfSelezionati.filter(e=>e.acquisto).reduce((s,e)=>s+(e.acquisto.quantita*e.acquisto.quotazioneAcquisto),0);

  const html = `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<title>Analisi Portafoglio ${portfolio.name} — ${data}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 20pt; color: #1a1a2e; margin: 0 0 4px; }
  h2 { font-size: 13pt; color: #1a1a2e; border-bottom: 2px solid #eab308; padding-bottom: 4px; margin: 20px 0 10px; }
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
    <div>Valore investito: €${totInvestito.toLocaleString('it-IT',{maximumFractionDigits:0})}</div>
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
    return `<tr><td>${e.name||e.isin}</td><td style="font-family:monospace;font-size:8.5pt">${e.isin}</td><td>${e.categoria||'—'}</td><td>${(e.ter||0).toFixed(2)}%</td><td>${e.perf1y>0?'+':''}${(e.perf1y||0).toFixed(1)}%</td><td>${val>0?'€'+val.toLocaleString('it-IT',{maximumFractionDigits:0}):'—'}</td></tr>`;
  }).join('')}
</table>

${modifiche && modifiche.length > 0 ? `
<h2>Modifiche Consigliate</h2>
${modifiche.map(m=>{
  const badge = m.azione==='aggiungi'||m.azione==='seleziona' ? 'badge-add' : m.azione==='ribilancia' ? 'badge-reb' : 'badge-rem';
  const label = m.azione==='aggiungi'?'AGGIUNGI':m.azione==='seleziona'?'ATTIVA':m.azione==='ribilancia'?`RIBILANCIA ${m.nuovaPct||''}%`:'RIMUOVI';
  return `<div class="modifiche-item"><span class="badge ${badge}">${label}</span><div><strong>${m.isin}</strong> — ${m.motivo||''}</div></div>`;
}).join('')}` : '<p style="color:#22c55e;font-weight:600">✓ Il portafoglio è già conforme alle regole del profilo.</p>'}

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
    WITH pool_grande AS (
      -- Top 270 ETF per AUM (i "grandi" — sempre eligibili)
      SELECT isin, name, valuta, aum_mln, ter,
             perf1m, perf6m, perf1y, perf5y,
             perf2024, perf2023, perf2022,
             vol1y, vol3y, vol5y,
             maxdd1y, maxdd5y, maxdd_max,
             distribuzione, categoria, smart_beta_factor,
             data_lancio, partecipazioni, sostenibile
      FROM etf_catalog
      WHERE active = 1
        AND aum_mln >= $1
        AND (ter IS NULL OR ter <= $2)
        ${escludiVolFilter}
        ${escludiDdFilter}
        AND (maxdd5y IS NULL OR maxdd5y >= $5)
        AND (perf1y IS NOT NULL OR perf5y IS NOT NULL OR perf6m IS NOT NULL)
        ${escludiObblAggressivo}
      ORDER BY aum_mln DESC
      LIMIT 270
    ),
    pool_giovani AS (
      -- Top 30 ETF giovani sotto soglia AUM (promettenti)
      SELECT isin, name, valuta, aum_mln, ter,
             perf1m, perf6m, perf1y, perf5y,
             perf2024, perf2023, perf2022,
             vol1y, vol3y, vol5y,
             maxdd1y, maxdd5y, maxdd_max,
             distribuzione, categoria, smart_beta_factor,
             data_lancio, partecipazioni, sostenibile
      FROM etf_catalog
      WHERE active = 1
        AND aum_mln >= 10
        AND aum_mln < $1
        AND data_lancio >= CURRENT_DATE - INTERVAL '3 years'
        AND (ter IS NULL OR ter <= $2)
        AND (perf1y IS NOT NULL OR perf5y IS NOT NULL OR perf6m IS NOT NULL)
        ${escludiObblAggressivo}
      ORDER BY data_lancio DESC
      LIMIT 30
    )
    SELECT * FROM pool_grande
    UNION
    SELECT * FROM pool_giovani
  `, [f.minAum, f.maxTer, f.maxVol, f.maxDrawdown, f.maxDd5y]);
  const rows = _rawRows
    .filter(e => isinConPrezzoInDB.has(e.isin))
    .filter(e => !escludiDistribuzione || e.distribuzione !== 'Distribuzione')
    .filter(e => e.perf1y !== null || e.perf5y !== null);

  return rows.map(e => ({
    isin:             e.isin,
    name:             e.name,
    categoria:        e.categoria || 'N/D',
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
  const { profilo, orizzonteAnni, capitale, preferenze, escludiDistribuzione, maxUSA } = req.body;
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
  const { bucketBreve, bucketLungo } = req.body;
  const hasBuckets = bucketBreve && bucketLungo;
  const filosofiaBucket = bucketBreve?.filosofia || 'difensiva'; // 'difensiva' | 'opportunistica'
  const checkRend = hasBuckets
    ? verificaRendimentoComplessivo(
        [{tipo:'BREVE', pct_allocazione: bucketBreve.pct, orizzonte_anni: bucketBreve.anni, rendimento_target_annuo: bucketBreve.targetRend},
         {tipo:'LUNGO', pct_allocazione: bucketLungo.pct, orizzonte_anni: bucketLungo.anni, rendimento_target_annuo: bucketLungo.targetRend}],
        profilo)
    : null;
  console.log(`[${new Date().toLocaleTimeString()}] Crea portafoglio AI: ${profilo}, ETF disponibili dal DB: ${etfDisponibili.length}, capitale: €${capitale || 'N/D'}`);
  log(EVENTI.AI_CREA_PORTAFOGLIO, { profilo, capitale: capitale || null, maxUSA, nEtfDisponibili: etfDisponibili.length }, req.user?.username).catch(() => {});

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
- ⚠️ VINCOLO RENDIMENTO MINIMO: il portafoglio deve avere un rendimento atteso NETTO stimato ≥ ${RENDIMENTO_MIN_PROFILO[profilo] || 4.0}% annuo.
- 🚫 VINCOLO RENDIMENTO MASSIMO ASSOLUTO: il rendimento netto atteso dichiarato NON PUÒ MAI superare ${{Prudente:'4.5',Bilanciato:'7.0',Aggressivo:'10.0'}[profilo] || '7.0'}% annuo. Questo è un HARD LIMIT invalicabile. Se il tuo calcolo supera questo valore, hai sbagliato metodo — riparti dai rendimenti storici di lungo periodo nella tabella sotto.
- ⚠️ METODO STIMA RENDIMENTO OBBLIGATORIO: usa ESCLUSIVAMENTE questi rendimenti attesi storici di lungo periodo (20-30 anni). Le performance 2022-2024 sono VIETATE come base di stima:
  Azionario Globale/USA/Europa: ~7% lordo | Emergenti: ~6-7% lordo | Obblig. Gov EUR: ~2-3% lordo | Obblig. Corp EUR: ~3-4% lordo | Inflation-Linked: ~2-3% lordo | Oro/Commodity: ~4-5% lordo | Monetario EUR: ~2-3% lordo
  Rendimento netto = (rendimento lordo asset class × peso%) sommato su tutti gli ETF × 0.74 (tasse 26%) − TER ponderato
- Quota azionaria: OBBLIGATORIA tra ${regole.azionarioTarget-regole.azionarioRange}% e ${regole.azionarioTarget+regole.azionarioRange}% (target ${regole.azionarioTarget}%). Verifica i pesi prima di rispondere.
- Numero ETF: massimo ${regole.maxETF}
- ⚠️ VINCOLO TER: il TER medio PONDERATO del portafoglio DEVE essere < ${regole.terPreferito}%. Se un singolo ETF ha TER > ${regole.terPreferito}%, includilo SOLO se porta un contributo di diversificazione o rendimento insostituibile. MAX assoluto per singolo ETF: ${regole.terMax}%. Un ETF con TER elevato che erode il rendimento sotto soglia NON deve essere incluso.
- Capitalizzazione minima per ETF: ${regole.capMin}M€
- ${regole.maxDrawdown ? `Max drawdown storico: ≤${Math.abs(regole.maxDrawdown)}% in valore assoluto` : 'Drawdown: nessun limite formale'}
- ${regole.volatilita ? `Volatilità storica: ≤${regole.volatilita}%` : 'Volatilità: nessun limite'}
- Hedging valuta: ${regole.hedged}
${regole.note ? `- NOTA IMPORTANTE: ${regole.note}` : ''}

## CATEGORIE AZIONARIE (usale per calcolare la quota azionaria):
Azionario Globale, Azionario USA, Azionario Europa, Azionario Emergenti, Azionario Tematico, Azionario Pacifico

${hasBuckets ? `## PIANIFICAZIONE A DUE ORIZZONTI — VINCOLO OBBLIGATORIO:
Filosofia scelta dall'utente: ${filosofiaBucket.toUpperCase()}

${descrizioneBucket({tipo:'BREVE', pct_allocazione: bucketBreve.pct, orizzonte_anni: bucketBreve.anni}, profilo, macroData, filosofiaBucket)}

${descrizioneBucket({tipo:'LUNGO', pct_allocazione: bucketLungo.pct, orizzonte_anni: bucketLungo.anni}, profilo, macroData, filosofiaBucket)}

⚠️ REGOLA CRITICA BUCKET: DEVI selezionare ETF per ENTRAMBI i bucket. Il bucket BREVE deve avere almeno 1 ETF (preferibilmente monetario o obbligazionario breve). Il bucket LUNGO riceve il resto. Se le preferenze utente non sono compatibili con il bucket breve, includi comunque 1 ETF difensivo/monetario nel breve e concentra le preferenze nel lungo.
` : ''}

${macroContext}
## ETF DISPONIBILI:
${etfDisponibili.map(e => {
  const vol = e.vol3y ? `Vol1A:${e.variabilita}% Vol3A:${e.vol3y}%` : `Vol1A:${e.variabilita}%`;
  const dd = e.maxDrawdownMax ? `DD1A:${e.maxDrawdown}% DDMax:${e.maxDrawdownMax}%` : `DD1A:${e.maxDrawdown}%`;
  // Per Aggressivo: mostra anche perf1y/5y come segnale di selezione relativa
  // Per Prudente/Bilanciato: solo annuali storiche per evitare proiezioni distorte
  const perf = profilo === 'Aggressivo'
    ? [
        e.perf1y != null ? `Perf1A:${e.perf1y}%[solo confronto]` : null,
        e.perf2024 != null ? `2024:${e.perf2024}%` : null,
        e.perf2023 != null ? `2023:${e.perf2023}%` : null,
        e.perf2022 != null ? `2022:${e.perf2022}%` : null,
      ].filter(Boolean).join(' ')
    : [
        e.perf2024 != null ? `2024:${e.perf2024}%` : null,
        e.perf2023 != null ? `2023:${e.perf2023}%` : null,
        e.perf2022 != null ? `2022:${e.perf2022}%` : null,
      ].filter(Boolean).join(' ') || (e.perf1y != null ? `Perf1A:${e.perf1y}%` : 'N/D');
  const extra = [
    e.dataLancio ? `Anno:${e.dataLancio}` : null,
    e.partecipazioni ? `Titoli:${e.partecipazioni}` : null,
    e.sostenibile ? 'ESG' : null,
  ].filter(Boolean).join(' ');
  return `- ${e.name} (${e.isin}) | Cat:${e.categoria} | TER:${e.ter}% | ${vol} | ${dd} | ${perf} | AUM:${e.capitalizzazione}M€${extra ? ' | '+extra : ''}`;
}).join('\n')}

## VINCOLI AGGIUNTIVI OBBLIGATORI:
- La volatilità media PONDERATA del portafoglio non deve superare ${regole.volatilita !== null ? regole.volatilita+'%' : 'nessun limite'} annuo
- NON includere ETF con vol1y > 20% per profilo Bilanciato
- L'oro (ETF fisico sull'oro) massimo 5% del portafoglio per profilo Bilanciato
- ⚠️ VINCOLO ETF PICCOLI: ETF con AUM < 50M€ sono fondi giovani in crescita — includi al massimo ${{Prudente:1,Bilanciato:2,Aggressivo:3}[profilo]||2} ETF sotto 50M€ nel portafoglio finale. Preferisci sempre ETF con AUM > 100M€ a parità di altre caratteristiche.
${maxUSA && maxUSA !== 'No max' ? `- ⚠️ VINCOLO TASSATIVO MAX USA: la somma dei pesi degli ETF con esposizione prevalente agli USA (categoria "Azionario USA" o ETF S&P500/Nasdaq/Russell) NON deve superare ${maxUSA} del portafoglio totale. Questo è un hard limit — NON può essere ignorato per nessun motivo.` : '- Esposizione USA: nessun limite'}
- Le performance passate NON sono garanzia di rendimenti futuri: usa perf1y/5y solo per confronto relativo, NON come stima di rendimento futuro
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

SPIEGAZIONE:
[Max 2 frasi: logica del portafoglio. NON citare rendimenti specifici. NON tabelle.]
[Una riga: METRICHE: azionaria:XX% | vol:XX% | TER:XX% | maxDD:-XX% | corr_max:0.XX]

VERIFICA:
quota_azionaria: XX% (range ${regole.azionarioTarget-regole.azionarioRange}%-${regole.azionarioTarget+regole.azionarioRange}%)
somma_pesi: 100%

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
        maxDrawdown: etf.maxDrawdown ?? null,       // FIX: era mancante → DD max N/D
        maxDrawdown5y: etf.maxDrawdown5y ?? null,   // FIX: era mancante → DD max 5A N/D
        smartBeta: etf.smartBeta || null,           // FIX: era mancante → Smart Beta —
        annoNascita,
        quotazioneAcquisto: quotazioneReale || null,
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
    selezione.forEach(s => {
      s.tipo = 'consigliato';
      // Assegna bucket automatico se la pianificazione a due orizzonti è attiva
      if (hasBuckets) {
        s.bucket = assegnaBucketAutomatico(s);
      }
    });

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

    // Info bucket per il frontend (se pianificazione a due orizzonti attiva)
    const bucketInfo = hasBuckets ? {
      attivo: true,
      breve: { pct: bucketBreve.pct, anni: bucketBreve.anni },
      lungo: { pct: bucketLungo.pct, anni: bucketLungo.anni },
    } : null;

    console.log(`  ✓ Portafoglio AI: ${selezione.length} ETF consigliati + ${selezioneConAlternative.length - selezione.length} alternative | scenario: ${scenarioMacro}`);
    res.json({ spiegazione, selezione: selezioneConAlternative, capitaleUsato: conCapitale ? parseFloat(capitale) : null, avvisoMaxUSA, scenarioMacro, bucketInfo });
  } catch (err) {
    res.status(500).json({ error: 'Errore creazione portafoglio AI: ' + err.message });
  }
});


  return router;
};
