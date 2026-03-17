const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const authMiddleware = require('../middleware/auth');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// POST /api/ai/analisi

module.exports = (db, fetchETF, ETF_INFO_MAP) => {
  const router = express.Router();

router.post('/analisi', async (req, res) => {
  const { portfolio } = req.body;
  if (!portfolio) return res.status(400).json({ error: 'Portfolio mancante' });
  console.log(`[${new Date().toLocaleTimeString()}] Analisi AI: ${portfolio.name}`);

  const [news] = await Promise.all([fetchMacroNews()]);
  const macroContext = buildMacroContext(news, portfolio.orizzonteAnni || 5);

  const etfSelezionatiRaw = portfolio.etfs.filter(e => e.selected);
  const etfNonSelezionati = portfolio.etfs.filter(e => !e.selected);

  // Arricchisci con dati reali da etf_catalog (maxdd1y, vol1y potrebbero essere 0 lato client)
  const isinList = etfSelezionatiRaw.map(e => `'${e.isin}'`).join(',');
  const catalogRows = isinList.length > 2
    ? (await db.query(`SELECT isin, maxdd1y, vol1y, aum_mln FROM etf_catalog WHERE isin IN (${isinList})`)).rows
    : [];
  const catalogMap = new Map(catalogRows.map(r => [r.isin, r]));

  const etfSelezionati = etfSelezionatiRaw.map(e => {
    const cat = catalogMap.get(e.isin);
    return {
      ...e,
      maxDrawdown: (cat?.maxdd1y != null ? cat.maxdd1y : (e.maxDrawdown || null)),
      variabilita: (cat?.vol1y != null ? cat.vol1y : (e.variabilita || null)),
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
  const regole = REGOLE_PROFILO[portfolio.riskProfile] || REGOLE_PROFILO.Bilanciato;
  const maxDDabs = regole.maxDrawdownAbs || Math.abs(regole.maxDrawdown || 18);
  // Conta quanti ETF hanno maxDrawdown reale (≠0) che viola il limite
  const etfConDatiDD = etfSelezionati.filter(e => e.maxDrawdown && e.maxDrawdown !== 0);
  const etfViolanoDD = etfConDatiDD.filter(e => Math.abs(e.maxDrawdown) > maxDDabs);

  // Calcola azionario attuale
  const catAzionarie = ['Azionario Globale','Azionario USA','Azionario Europa','Azionario Emergenti','Azionario Tematico','Azionario Pacifico'];
  const valAzionario = etfConAcquisto.filter(e => catAzionarie.some(c => (e.categoria||'').includes(c.replace('Azionario ','')))).reduce((s,e) => s + e.acquisto.quantita * e.acquisto.quotazioneAcquisto, 0);
  const percAzionario = totValore > 0 ? (valAzionario / totValore * 100).toFixed(1) : 'N/D';

  const etfCatalogo = await getEtfPerProfilo(portfolio.riskProfile, false, false)
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

## REGOLE VINCOLANTI PROFILO ${portfolio.riskProfile.toUpperCase()} (NON modificarle nell'analisi):
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
    return `- ${e.name} (${e.isin}) | ${e.categoria||'N/D'} | TER:${e.ter}% | Vol1A:${vol} | MaxDD1A:${dd} | Perf1A:${e.perf1y||0}% | Perf5A:${e.perf5y||0}% | AUM:${e.capitalizzazione||'N/D'}M€`;
  }).join('\n')}

## ETF NEL PORTAFOGLIO MA NON SELEZIONATI (${etfNonSelezionati.length}):
${etfNonSelezionati.slice(0,20).map(e => `- ${e.name} (${e.isin}) | ${e.categoria||'N/D'} | TER:${e.ter}% | Vol1A:${e.variabilita||'N/D'}% | Perf1A:${e.perf1y||0}%`).join('\n') || 'Nessuno'}

## ETF DAL CATALOGO COMPATIBILI COL PROFILO (puoi suggerire "aggiungi"):
${etfCatalogo.map(e => `- ${e.name} (${e.isin}) | ${e.categoria} | TER:${e.ter}% | Quotaz:€${e.quotazione||0} | Vol1A:${e.variabilita||'N/D'}% | Perf1A:${e.perf1y||0}%`).join('\n')}

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
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4500,
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
    const message = await anthropic.messages.create({
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

  // Lista ISIN con ticker Yahoo noto — gli unici che possiamo prezzare correttamente
  const ISIN_CON_TICKER_NOTO = new Set([
    // ETF_MASTER (45 ETF verificati con prezzi reali)
    'IE00B4L5Y983','IE00B3XXRP09','IE00BK5BQT80','IE00B4L5YX21','LU1681041782',
    'IE00B5BMR087','IE00B3ZW0K18','IE0032077012','IE00B4K48X80','LU1681043599',
    'IE00B53L3W79','IE00BKM4GZ66','IE00B4L5YC18','LU1050469367','LU1829219655',
    'LU1681045370','IE00B441G979','IE00BP3QZB59','IE00B3VVMM84','IE00BGDQ0H97',
    'IE00B4JNQZ49','IE00BYVJRP78','IE00BFG0R112','IE00BD4DXW77','IE00B3FH7618',
    'IE00B4WXJJ64','LU0290358497','IE00B3F81R35','IE00B3F81409','IE00B66F4759',
    'IE00BJK55C48','FR0013416716','IE00B4ND3602','DE000A1EK0G3','DE000A0S9GB0',
    'LU1829218749','LU1437016972','LU0908500753','IE00BJ0KDQ92','IE00BL25JM42',
    'LU0478205379','IE00B6R52259','IE00BGSF1X88','IE00B3RBWM25','IE00B3YCGJ38',
    'IE0031442068','IE0005042456',
    // ETF con ticker verificati nella ISIN_TICKER_MAP
    'IE00B3VVMM84','LU1931974692','LU1781541179','IE00B14X4S71','IE00B1FZS798',
    'IE00BGPP6599','IE00BGDQ0H97',
  ]);

  // Aggiungi anche ISIN con prezzo in prezzi_storici (già fetchati con successo)
  let isinConPrezzoInDB = new Set();
  try {
    const cutoffTicker = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10);
    const { rows: _pricedIsins } = await db.query('SELECT DISTINCT isin FROM prezzi_storici WHERE data >= $1 AND prezzo > 0', [cutoffTicker]);
    _pricedIsins.forEach(r => isinConPrezzoInDB.add(r.isin));
  } catch {}

  const { rows: _rawRows } = await db.query(`
    SELECT isin, name, valuta, aum_mln, ter,
           perf1m, perf6m, perf1y, perf5y,
           vol1y, maxdd1y, maxdd5y, distribuzione, categoria
    FROM etf_catalog
    WHERE active = 1
      AND aum_mln >= $1
      AND (ter IS NULL OR ter <= $2)
      AND (vol1y IS NULL OR vol1y <= $3)
      AND maxdd1y IS NOT NULL AND maxdd1y >= $4
      AND (maxdd5y IS NULL OR maxdd5y >= $5)
      ${escludiObblAggressivo}
    ORDER BY aum_mln DESC
    LIMIT 300
  `, [f.minAum, f.maxTer, f.maxVol, f.maxDrawdown, f.maxDd5y]);
  const rows = _rawRows
    .filter(e => ISIN_CON_TICKER_NOTO.has(e.isin) || isinConPrezzoInDB.has(e.isin))
    .filter(e => !escludiDistribuzione || e.distribuzione !== 'Distribuzione');

  return rows.map(e => ({
    isin:             e.isin,
    name:             e.name,
    categoria:        e.categoria || 'N/D',
    emittente:        e.name.split(' ')[0],
    ter:              e.ter ?? 0,
    tassazione:       26,
    capitalizzazione: e.aum_mln ?? 0,
    variabilita:      e.vol1y ?? 0,
    maxDrawdown:      e.maxdd1y ?? 0,
    maxDrawdown5y:    e.maxdd5y ?? 0,
    valuta:           e.valuta || 'EUR',
    quotazione:       0,
    perf1m:           e.perf1m ?? 0,
    perf6m:           e.perf6m ?? 0,
    perf1y:           e.perf1y ?? 0,
    perf5y:           e.perf5y ?? 0,
    distribuzione:    e.distribuzione || 'N/D',
  }));
}

// POST /api/ai/crea-portafoglio
router.post('/crea-portafoglio', async (req, res) => {
  const { profilo, orizzonteAnni, capitale, preferenze, escludiDistribuzione } = req.body;
  if (!profilo) return res.status(400).json({ error: 'Dati mancanti' });

  // Carica ETF dal DB filtrati per profilo + notizie macro in parallelo
  const [etfDisponibili, news] = await Promise.all([
    getEtfPerProfilo(profilo, escludiDistribuzione),
    fetchMacroNews(),
  ]);
  const macroContext = buildMacroContext(news, orizzonteAnni || 5);
  console.log(`[${new Date().toLocaleTimeString()}] Crea portafoglio AI: ${profilo}, ETF disponibili dal DB: ${etfDisponibili.length}, capitale: €${capitale || 'N/D'}`);

  const regole = REGOLE_PROFILO[profilo] || REGOLE_PROFILO.Bilanciato;
  const conCapitale = capitale && parseFloat(capitale) > 0;

  const prompt = `Sei un consulente finanziario esperto in ETF per investitori italiani.
Crea un portafoglio ETF ottimale rispettando RIGOROSAMENTE le regole del profilo indicato.

## PARAMETRI INVESTITORE:
- Profilo: ${profilo}
- Orizzonte temporale: ${orizzonteAnni} anni
- Capitale disponibile: ${conCapitale ? `€${parseFloat(capitale).toLocaleString('it-IT')}` : 'non specificato'}
- Preferenze: ${preferenze || 'nessuna'}

## REGOLE OBBLIGATORIE PROFILO ${profilo.toUpperCase()}:
- Rendimento atteso: ${regole.rendimentoMin} / ${regole.rendimentoMax}
- Quota azionaria: OBBLIGATORIA tra ${regole.azionarioTarget-regole.azionarioRange}% e ${regole.azionarioTarget+regole.azionarioRange}% (target ${regole.azionarioTarget}%). Verifica i pesi prima di rispondere.
- Numero ETF: massimo ${regole.maxETF}
- TER portafoglio: preferibile <${regole.terPreferito}%, max ${regole.terMax}%
- Capitalizzazione minima per ETF: ${regole.capMin}M€
- ${regole.maxDrawdown ? `Max drawdown storico: ≤${Math.abs(regole.maxDrawdown)}% in valore assoluto` : 'Drawdown: nessun limite formale'}
- ${regole.volatilita ? `Volatilità storica: ≤${regole.volatilita}%` : 'Volatilità: nessun limite'}
- Hedging valuta: ${regole.hedged}
${regole.note ? `- NOTA IMPORTANTE: ${regole.note}` : ''}

## CATEGORIE AZIONARIE (usale per calcolare la quota azionaria):
Azionario Globale, Azionario USA, Azionario Europa, Azionario Emergenti, Azionario Tematico, Azionario Pacifico

${macroContext}
## ETF DISPONIBILI:
${etfDisponibili.map(e => `- ${e.name} (${e.isin}) | Cat: ${e.categoria} | TER: ${e.ter}% | Vol1A: ${e.variabilita}% | Cap: ${e.capitalizzazione}M€ | Perf1A: ${e.perf1y}% | Perf5A: ${e.perf5y}%`).join('\n')}

## VINCOLI AGGIUNTIVI OBBLIGATORI:
- La volatilità media PONDERATA del portafoglio non deve superare ${regole.volatilita !== null ? regole.volatilita+'%' : 'nessun limite'} annuo
- NON includere ETF con vol1y > 20% per profilo Bilanciato
- L'oro (ETF fisico sull'oro) massimo 5% del portafoglio per profilo Bilanciato
- Le performance passate NON sono garanzia di rendimenti futuri: usa perf1y/5y solo per confronto relativo, NON come stima di rendimento futuro
${escludiDistribuzione ? `- VINCOLO TASSATIVO: seleziona SOLO ETF ad Accumulazione (Acc). ESCLUDI ASSOLUTAMENTE qualsiasi ETF a Distribuzione (Dist/Distributing). Questo vale sia per i consigliati che per le alternative. Se un ETF ha "Distributing" o "Dist" nel nome o nel suo tipo di replica, NON includerlo.` : ''}

## VINCOLO CORRELAZIONE (soft, tutti i profili):
Stima la correlazione tra ogni coppia di ETF in base a categoria, area geografica e fattori.
Regola: correlazione stimata tra due ETF NON deve superare 0.6.
Esempi di alta correlazione (>0.6): due ETF azionari globali MSCI World, due ETF Value globali, due ETF S&P500.
Esempi di bassa correlazione (<0.4): azionario + obbligazionario, azionario + liquidità, globale + emergenti.
- Questo vincolo è SOFT: se rispettarlo richiede di sforare vol o drawdown oltre le soglie del profilo, puoi ignorarlo.
- Vincola le alternative: per ogni ETF top, le alternative devono avere correlazione <0.6 con gli altri ETF già selezionati. Se non trovi 2 alternative con correlazione bassa, proponi solo 1 alternativa (non zero).
- Nella SPIEGAZIONE indica esplicitamente le coppie con correlazione stimata più alta.

## FORMATO RISPOSTA:
SPIEGAZIONE:
[Max 2 frasi: logica del portafoglio e scelte principali. NON citare rendimenti attesi specifici. NON ripetere i calcoli numerici — quelli vanno nella sezione VERIFICA.]
[Poi su una riga: METRICHE: azionaria:XX% | vol:XX% | TER:XX% | maxDD:-XX% | corr_max:0.XX]

VERIFICA:
quota_azionaria: XX% (deve essere tra ${regole.azionarioTarget-regole.azionarioRange}% e ${regole.azionarioTarget+regole.azionarioRange}%)
somma_pesi: 100%

PORTAFOGLIO_JSON:
[{"isin": "ISIN", "peso": 30, "motivo": "motivo breve"}]

I pesi devono sommare a 100. Max ${regole.maxETF} ETF. Solo ISIN dalla lista disponibile.
IMPORTANTE: se la quota azionaria calcolata non rientra nel range obbligatorio, ribilancia i pesi prima di rispondere.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6', max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const testo = message.content[0].text;
    const parti = testo.split('PORTAFOGLIO_JSON:');
    const spiegazione = parti[0].replace('SPIEGAZIONE:', '').trim();
    let selezione = [];
    if (parti[1]) {
      try { selezione = JSON.parse(parti[1].trim().match(/\[[\s\S]*\]/)?.[0] || '[]'); } catch {}
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
    } catch (e) {
      console.log('  [crea-portafoglio] Errore lettura prezzi DB:', e.message);
    }

    // Arricchisci ogni ETF con dati catalogo e calcola acquisti
    // Priorità: prezziDB (Yahoo reale, aggiornato 7gg) -> ETF_INFO_MAP (fallback statico)
    selezione = selezione.map(s => {
      const etf = etfDisponibili.find(e => e.isin === s.isin);
      if (!etf) return s;
      const info = ETF_INFO_MAP[s.isin] || {};
      const quotazioneReale = prezziDB[s.isin] || info.q || 0;
      const annoNascita = info.a || null;
      if (prezziDB[s.isin]) console.log(`    ${s.isin}: EUR${quotazioneReale} (DB Yahoo)`);
      else if (info.q) console.log(`    ${s.isin}: EUR${quotazioneReale} (mappa fallback)`);
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
      const getFattoreCorr = (name) => {
        const n = (name || '').toLowerCase();
        return FATTORI_CORR.find(f => n.includes(f)) || '__generic__';
      };
      const getCatKeyCorr = (etf) => {
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

    // Fetch Yahoo in tempo reale per ETF ancora senza prezzo (non in prezziDB né in ETF_INFO_MAP)
    const etfSenzaPrezzo = selezioneConAlternative.filter(e => !e.quotazioneAcquisto || e.quotazioneAcquisto <= 0);
    if (etfSenzaPrezzo.length > 0) {
      console.log(`  Fetch Yahoo live per ${etfSenzaPrezzo.length} ETF senza prezzo...`);
      for (const etf of etfSenzaPrezzo) {
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

    console.log(`  ✓ Portafoglio AI: ${selezione.length} ETF consigliati + ${selezioneConAlternative.length - selezione.length} alternative`);
    res.json({ spiegazione, selezione: selezioneConAlternative, capitaleUsato: conCapitale ? parseFloat(capitale) : null });
  } catch (err) {
    res.status(500).json({ error: 'Errore creazione portafoglio AI: ' + err.message });
  }
});


  return router;
};
