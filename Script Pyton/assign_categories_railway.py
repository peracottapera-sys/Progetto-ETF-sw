"""
assign_categories_railway.py
Assegna la categoria agli ETF nel DB Railway basandosi sul nome del fondo.

Uso:
  python assign_categories_railway.py
"""

import psycopg2

DB_URL = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"

# Regole di classificazione — ordine importante: più specifico prima
# Formato: (lista parole chiave nel nome, categoria)
REGOLE = [
    # ── Materie Prime ─────────────────────────────────────────────────────
    (['gold', 'oro', 'silver', 'argento', 'platinum', 'palladium', 'precious metal'],
     'Materie Prime - Metalli Preziosi'),
    (['commodity', 'commodities', 'materie prime', 'bloomberg commodity',
      'brent', 'crude oil', 'wti', 'natural gas', 'gas naturale',
      'oil & gas', 'oil and gas', 'energy commodity'],
     'Materie Prime - Energia'),
    (['agriculture', 'agricol', 'wheat', 'corn', 'soybean', 'coffee', 'sugar', 'cotton'],
     'Materie Prime - Agricoltura'),
    (['copper', 'aluminium', 'aluminum', 'nickel', 'zinc', 'industrial metal'],
     'Materie Prime - Metalli Industriali'),
    (['commodity', 'commodities'],
     'Materie Prime'),

    # ── Azionario USA ─────────────────────────────────────────────────────
    (['s&p 500', 'sp500', 's&p500', 'nasdaq', 'nasdaq-100', 'nasdaq 100',
      'russell 2000', 'russell 1000', 'dow jones', 'djia',
      'msci usa', 'msci north america', 'united states', ' usa ', 'us equity',
      'us stock', 'american'],
     'Azionario USA'),

    # ── Azionario Europa ──────────────────────────────────────────────────
    (['stoxx europe', 'stoxx 600', 'euro stoxx', 'eurostoxx', 'ftse europe',
      'msci europe', 'msci emu', 'dax', 'cac 40', 'ftse 100', 'ftse mib',
      'ftse italia', 'mib', 'ibex', 'atx', 'bel 20', 'aex',
      'europe equity', 'european equity', 'pan-european', 'pan european'],
     'Azionario Europa'),

    # ── Azionario Emergenti ───────────────────────────────────────────────
    (['emerging market', 'emerging markets', 'msci em', 'msci emerging',
      'ftse emerging', 'ftse em', 'bric', 'china', 'india', 'brazil',
      'vietnam', 'indonesia', 'taiwan', 'korea', 'thailand', 'malaysia',
      'latin america', 'latin amer', 'africa', 'frontier market'],
     'Azionario Emergenti'),

    # ── Azionario Giappone/Pacifico ───────────────────────────────────────
    (['japan', 'giappone', 'nikkei', 'topix', 'msci japan',
      'pacific', 'pacifico', 'asia pacific', 'australia', 'msci pacific',
      'ftse japan', 'ftse asia'],
     'Azionario Pacifico'),

    # ── Azionario Tematico ────────────────────────────────────────────────
    (['clean energy', 'renewable', 'solar', 'wind energy', 'green',
      'esg', 'sri', 'sustainable', 'socially responsible', 'climate',
      'carbon', 'low carbon'],
     'Azionario Tematico - ESG/Green'),
    (['technology', 'tech', 'information technology', 'semiconductor', 'cyber',
      'artificial intelligence', 'ai ', 'digital', 'software', 'cloud',
      'robotics', 'automation'],
     'Azionario Tematico - Tecnologia'),
    (['healthcare', 'health care', 'pharma', 'pharmaceutical', 'biotech',
      'biotechnology', 'medical', 'medtech'],
     'Azionario Tematico - Salute'),
    (['oil & gas', 'oil and gas', 'energy sector', 'oil services',
      'energy equit', 'exploration', 'drilling'],
     'Azionario Tematico - Energia'),
    (['real estate', 'reit', 'property', 'immobil'],
     'Azionario Tematico - Immobiliare'),
    (['infrastructure', 'infrastruttur', 'utilities', 'water'],
     'Azionario Tematico - Infrastrutture'),
    (['financial', 'bank', 'insurance', 'fintech'],
     'Azionario Tematico - Finanziario'),
    (['consumer', 'retail', 'brand', 'luxury'],
     'Azionario Tematico - Consumi'),
    (['dividend', 'high yield equity', 'income equity', 'high dividend'],
     'Azionario - Dividend'),
    (['value', 'low volatility', 'low vol', 'minimum variance', 'quality factor',
      'momentum factor', 'multi-factor', 'multifactor', 'factor'],
     'Azionario - Smart Beta'),
    (['small cap', 'smallcap', 'small-cap', 'mid cap', 'midcap', 'mid-cap'],
     'Azionario - Small/Mid Cap'),

    # ── Azionario Globale ─────────────────────────────────────────────────
    (['msci world', 'msci acwi', 'msci all country', 'ftse all-world',
      'ftse all world', 'ftse developed', 'global equity', 'world equity',
      'all world', 'developed world', 'developed market'],
     'Azionario Globale'),

    # ── Obbligazionario Governativo ───────────────────────────────────────
    (['btp', 'italy government', 'italian government', 'oat', 'bund',
      'gilt', 'treasury', 'us government', 'us treasury', 'tips',
      'inflation-linked', 'inflation linked', 'linker',
      'government bond', 'govt bond', 'sovereign', 'sovrano'],
     'Obbligazionario Governativo'),
    (['euro government', 'eur government', 'eurozone government',
      'euro area government', 'eur aggregate', 'euro aggregate',
      'aggregate bond', 'core government'],
     'Obbligazionario Governativo'),

    # ── Obbligazionario Corporate ─────────────────────────────────────────
    (['corporate bond', 'corp bond', 'investment grade', 'ig bond',
      'eur corporate', 'usd corporate', 'euro corporate'],
     'Obbligazionario Corporate'),
    (['high yield', 'junk bond', 'hy bond', 'speculative'],
     'Obbligazionario High Yield'),

    # ── Obbligazionario Emergenti ─────────────────────────────────────────
    (['emerging market bond', 'em bond', 'emerging bond',
      'emerging debt', 'em debt', 'local currency bond'],
     'Obbligazionario Emergenti'),

    # ── Liquidità / Monetario ─────────────────────────────────────────────
    (['money market', 'monetary', 'overnight', 'eonia', 'ester', 'estr',
      'liquidity', 'cash', 'ultra short', 'short term bond',
      't-bill', 'treasury bill'],
     'Liquidità / Monetario'),

    # ── Obbligazionario Generico ──────────────────────────────────────────
    (['bond', 'fixed income', 'obbligaz', 'debt', 'credit',
      'duration', 'maturity', 'coupon'],
     'Obbligazionario'),

    # ── Azionario Generico (fallback) ─────────────────────────────────────
    (['equity', 'stock', 'share', 'azionario', 'azioni'],
     'Azionario Globale'),
]

def assegna_categoria(name):
    """Assegna la categoria basandosi sul nome dell'ETF."""
    if not name:
        return None
    n = name.lower()
    for keywords, categoria in REGOLE:
        for kw in keywords:
            if kw.lower() in n:
                return categoria
    return 'Altro'

def main():
    print("Connessione a Railway PostgreSQL...")
    conn = psycopg2.connect(DB_URL, sslmode='require', connect_timeout=15)
    cur = conn.cursor()
    print("Connesso!\n")

    # Carica tutti gli ETF senza categoria
    cur.execute("SELECT isin, name FROM etf_catalog WHERE categoria IS NULL OR categoria = ''")
    etfs = cur.fetchall()
    print(f"ETF senza categoria: {len(etfs)}")

    # Assegna categorie
    aggiornati = 0
    per_categoria = {}

    for isin, name in etfs:
        cat = assegna_categoria(name)
        cur.execute("UPDATE etf_catalog SET categoria = %s WHERE isin = %s", [cat, isin])
        aggiornati += 1
        per_categoria[cat] = per_categoria.get(cat, 0) + 1

    conn.commit()

    # Mostra anche quelli già con categoria per verifica
    cur.execute("SELECT categoria, COUNT(*) as c FROM etf_catalog GROUP BY categoria ORDER BY c DESC")
    rows = cur.fetchall()

    cur.close()
    conn.close()

    print(f"\n✅ Categorie assegnate: {aggiornati}")
    print(f"\nDistribuzione categorie nel DB:")
    for cat, count in rows:
        print(f"  {cat or 'null':45s} {count:4d}")

if __name__ == "__main__":
    main()
