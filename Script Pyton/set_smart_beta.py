"""
set_smart_beta.py — Popola smart_beta_factor nel catalogo ETF
Usa il nome dell'ETF per riconoscere il fattore Smart Beta.
Gira una volta sola dal PC locale.
"""
import psycopg2
import re

DB_URL = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"

# Regole di matching: (pattern regex sul nome ETF, fattore)
# Ordine importante: prima i più specifici
RULES = [
    # Low Volatility / Minimum Variance
    (r'minimum.volatilit|min.vol|low.vol|minimum.variance|bassa.volatilit', 'Low Volatility'),
    # Quality / Fundamentals
    (r'quality|fundamental|profitabilit|msci.world.quality|msci.europe.quality', 'Quality'),
    # Value
    (r'\bvalue\b|enhanced.value|msci.world.value|msci.europe.value|stoxx.europe.*value', 'Value'),
    # Momentum
    (r'momentum', 'Momentum'),
    # Small Cap
    (r'small.cap|small.cap|smallcap|micro.cap|msci.*small', 'Small Cap'),
    # Equal Weight
    (r'equal.weight|equally.weight', 'Equal Weight'),
    # Dividend / Income
    (r'dividend|dividendo|high.yield.*equity|income|distribuzione|euro.stoxx.*select.*dividend|stoxx.*global.*select.*dividend|msci.*high.*dividend', 'Dividend'),
    # Multi-Factor
    (r'multi.factor|multifactor|factor.mix|diversified.factor', 'Multi-Factor'),
    # ESG / SRI (non Smart Beta ma utile classificare)
    (r'\besg\b|\bsri\b|socially.responsible|sustainable|climate|paris.aligned|low.carbon', 'ESG'),
]

def detect_factor(name):
    if not name:
        return None
    n = name.lower()
    for pattern, factor in RULES:
        if re.search(pattern, n):
            return factor
    return None

conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

cur.execute("SELECT isin, name FROM etf_catalog WHERE active = 1")
etfs = cur.fetchall()
print(f"ETF totali: {len(etfs)}")

aggiornati = {}
for isin, name in etfs:
    factor = detect_factor(name)
    if factor:
        aggiornati[factor] = aggiornati.get(factor, 0) + 1
        cur.execute("UPDATE etf_catalog SET smart_beta_factor = %s WHERE isin = %s", (factor, isin))

conn.commit()

print("\nFattori assegnati:")
for f, n in sorted(aggiornati.items(), key=lambda x: -x[1]):
    print(f"  {f}: {n} ETF")

total = sum(aggiornati.values())
print(f"\nTotale con fattore: {total} / {len(etfs)} ({100*total//len(etfs)}%)")

conn.close()
print("Done.")
