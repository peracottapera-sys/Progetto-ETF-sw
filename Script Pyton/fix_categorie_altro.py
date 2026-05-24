# -*- coding: utf-8 -*-
"""
fix_categorie_altro.py
Classifica automaticamente gli ETF con categoria NULL o 'Altro'
basandosi sul nome dell'ETF.

Uso: python fix_categorie_altro.py [--dry-run]
"""

import psycopg2
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB_URL = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"

# Regole di classificazione basate su keyword nel nome ETF
# Ordine importante: le regole più specifiche prima
REGOLE = [
    # Crypto / ETP digitali
    ('Materie Prime - Crypto', [
        'crypto', 'bitcoin', 'ethereum', 'blockchain', 'digital asset',
        'coinshares', 'btc etp', 'eth etp', '21shares', 'wisdomtree crypto',
        'valour', 'avalanche', 'binance', 'chainlink', 'dogecoin', 'stellar',
        'polkadot', 'solana', 'cardano', 'ripple', 'xrp', 'defi', 'web3',
        'amina', 'staking etp', 'crypto basket', 'coindesk', 'lido staked',
        'algorand', 'celestia', 'polygon etn', 'smart contract leaders',
        'sui etn', 'tron etn', 'virtune', 'stablecoin index', 'physical ai', 'bitwise physical', 'litecoin etp',
        'humanoids', 'magnificent 7 options', 'mstr option'
    ]),
    # Liquidità / Monetario
    ('Liquidità / Monetario', [
        'ultra-short', 'ultrashort', 'overnight', 'eonia', 'ester', 'monetary',
        'money market', 'cash', 'liquidity', 'ultra short', 'floating rate',
        '0-1y', '0-3 month', '1-3 month', '0-6 month', 'fed funds rate',
        'short duration income', 'short duration cash', 'aaa clo',
        'clo fund', 'clo ucits', 'at1 coco'
    ]),
    # Obbligazionario Governativo
    ('Obbligazionario Governativo', [
        'vanguard u.s. treasury', 'us inflation expectations', 'us breakeven',
        'govt bond', 'government bond', 'treasury bond', 'us treasuries',
        'us treasury', 'bund', 'btp', 'oat', 'gilt', 'sovereign',
        'global government', 'world government', 'emu government',
        'euro government', 'core global government', 'euro inflation',
        'inflation linked', 'inflation-linked', 'tips', 'linker',
        'breakeven', 'index linked', 'real rate', 'iboxx germany covered',
        'china government', 'china gov', 'emg gov', 'emu gov',
        'government 1-3', 'government 3-5', 'government 5-7',
        'government 7-10', 'government 10', 'gov 1-10', 'gov 5-7',
        'lifecycle', 'longevity 20', 'target date'
    ]),
    # Obbligazionario Corporate
    ('Obbligazionario Corporate', [
        'corporate bond', 'corp bond', 'corporate 1-3', 'corporate 3-5',
        'investment grade bond', 'ig bond', 'eur corp', 'usd corp',
        'euro corporate', 'high yield bond', 'hy bond', 'fallen angel', 'axa im global high yield',
        'aggregate bond', 'global aggregate', 'aggregate proceeds',
        'broad bond', 'fixed income', 'green bond', 'sustainable bond',
        'social bond', 'convertible bond', 'credit bond', 'esg bond',
        'scored bond', 'corporate scored', 'liquid corp', 'bbg euro',
        'bbg us liquid', 'us corporate', 'euro area liquid corp',
        'preferred shares', 'variable rate preferred', 'income fund ucits'
    ]),
    # Obbligazionario Emergenti
    ('Obbligazionario Emergenti', [
        'emerging market bond', 'em bond', 'emerging bond',
        'local currency bond', 'hard currency bond',
        'jpmorgan em bond', 'em debt', 'emerging debt', 'em local bond',
        'esg emerging bond', 'esg usd emerging markets bond',
        'cny china gov', 'china gov bond'
    ]),
    # Azionario USA
    ('Azionario USA', [
        'l&g s&p 100', 's&p u.s. banks', 'communication services select', 'us energy select', 'millennials ucits',
        "s&p 500", 'sp500', 'nasdaq', 'russell 2000', 'russell 1000',
        'dow jones', 'us equity', 'usa equity', 'north america equity',
        'msci usa', 'msci north america', 'ftse usa', 'us large cap',
        'us small cap', 'us mid cap', 'us total market', 's&p500',
        'us esg equity', 'ftse north america', 'vanguard ftse north america',
        'us fundamental large cap', 'active us growth', 'us mega cap',
        'us dividend tilt', 'us quality growth', 'us efficient core',
        'ftse rafi us', 'global buyback', 's&p us banks', 'us materials sector',
        'us industrials sector', 'us communications'
    ]),
    # Azionario Europa
    ('Azionario Europa', [
        'xtrackers ftse 250', 'vanguard ftse 250',
        'stoxx europe', 'euro stoxx', 'msci europe', 'ftse europe',
        'europe equity', 'european equity', 'dax', 'cac 40', 'ftse 100',
        'msci emu', 'eurozone equity', 'pan european', 'stoxx 600',
        'eurostoxx', 'f.a.z.', 'smi ', 'swiss market', 'switzerland titan',
        'dj switzerland', 'prime europe', 'prime eurozone', 'msci switzerland',
        'quality europe', 'growth europe', 'value europe', 'emu equity',
        'ftse 250', 'europe ex uk', 'europe defence', 'european defence',
        'europe defense', 'making europe great', 'alpha enhanced europe',
        'europe quality aristocrats', 'europe growth strength',
        'eurozone alphadex', 'germany alphadex', 'ftse rafi europe',
        'europe quality dividend', 'eurozone efficient core',
        'swiss large cap', 'slx ucits', 'sli ucits', 'bloomberg eurozone pab',
        'ossiam europe', 'europe defense vision', 'xtrackers s&p europe'
    ]),
    # Azionario Emergenti
    ('Azionario Emergenti', [
        'sse star market', 'star market 50', 'kraneShares', 'frontier swap',
        'msci emerging', 'ftse emerging', 'emerging market equity',
        'em equity', 'msci em ', 'msci china', 'msci india', 'msci brazil',
        'msci korea', 'msci taiwan', 'asia pacific ex japan', 'bric',
        'frontier market', 'em ex china', 'emerging ex china',
        'msci eastern europe', 'msci turkey', 'msci greece', 'msci nordic',
        'msci singapore', 'msci philippines', 'msci mexico', 'msci canada',
        'msci hong kong', 'msci united kingdom', 'chixnext', 'chinext',
        'csi 300', 'csi500', 'csi a500', 'nifty 50', 'india tech',
        'china a 300', 's&p/asx 200', 'australia', 'gcc select',
        'eastern europe ex russia', 'vanguard ftse 250',
        'vanguard germany', 'em screened', 'vanguard esg emerging',
        'emerging markets screened', 'climate transition emerging',
        'esg usd emerging', 'ex-state-owned', 'ftse rafi europe'
    ]),
    # Azionario Globale
    ('Azionario Globale', [
        'msci world', 'ftse all-world', 'ftse allworld', 'msci acwi',
        'global equity', 'world equity', 'all world', 'all-world',
        'developed market equity', 'msci developed', 'global titans',
        'dj global titans', 'prime all country', 'prime global',
        'all country world', 'amundi prime global', 'world esg',
        'msci acwi sri', 'global sustainable equity', 'core global equity',
        'msci ac world', 'xtrackers msci ac world', 'world green tech',
        'bloomberg world pab', 'global screened', 'msci global sdg',
        'global social fairness', 'msci global', 'world quality growth',
        'global quality growth', 'global efficient core',
        'global ex-usa quality', 'megatrends ucits', 'tech megatrends',
        'msci resilient future', 'robeco dynamic theme', 'hanetf saturna', 'saturna al-kawthar', 'saturna al-kawthar',
        'climate aware global', 'xtrackers world', 'wisdomtree world',
        'franklin ftse developed'
    ]),
    # Azionario Pacifico
    ('Azionario Pacifico', [
        'pacific equity', 'japan equity', 'msci japan', 'msci pacific',
        'topix', 'nikkei', 'asia equity', 'msci asia ex japan',
        'ftse japan', 'australia equity', 'asia ex japan equity',
        's&p/asx', 'canadian enhanced', 'msci canada', 'eurizon msci canada',
        'franklin ftse saudi', 'saudi arabia'
    ]),
    # Smart Beta / Fattori
    ('Azionario - Smart Beta', [
        'quality factor', 'value factor', 'momentum factor', 'low volatility',
        'minimum volatility', 'dividend aristocrat', 'high dividend',
        'multifactor', 'multi-factor', 'equal weight', 'smart beta',
        'quality income', 'dividend quality', 'low risk equity',
        'alpha enhanced', 'activebeta', 'alphadex', 'ftse rafi',
        'quality aristocrats', 'rising dividend achievers', 'us momentum',
        'cape global sector', 'cape us sector', 'shiller barclays',
        'serenity euro', 'global quality', 'quality growth ucits',
        'dividend achievers', 'quality dividend growth',
        'vanguard lifestrategy', 'strategic allocation', 'portfolio ucits',
        'xtrackers portfolio', 'multi-asset conservative', 'multi-asset balanced',
        'multi-asset growth', 'balanced allocation', 'conservative allocation',
        'growth allocation', 'investlinx balanced', 'investlinx capital'
    ]),
    # Small/Mid Cap
    ('Azionario - Small/Mid Cap', [
        'small cap', 'smallcap', 'mid cap', 'midcap', 'small & mid',
        'small-cap', 'micro cap', 'stoxx europe small', 'msci europe small',
        'world small cap', 'global small cap', 'smaller companies',
        'ftse 250', 'junior uranium', 'sprott junior'
    ]),
    # Tematici Difesa
    ('Azionario Tematico - Difesa', [
        'defence', 'defense', 'aerospace', 'military', 'security innovation',
        'bloomberg defence', 'future of defence', 'indo-pac defence',
        'european defence', 'europe defence', 'defence screened',
        'drone ucits', 'ukraine reconstruction'
    ]),
    # Tematici Salute
    ('Azionario Tematico - Salute', [
        'healthcare', 'health care', 'pharma', 'biotech', 'medical',
        'msci health', 'global health', 'life science', 'genomics',
        'aging', 'wellbeing', 'ark genomic', 'biorevolution',
        'bioproduction', 'nuclear power', 'good health sdg',
        'future of health', 'longevity'
    ]),
    # Tematici ESG/Green
    ('Azionario Tematico - ESG/Green', [
        'clean energy', 'renewable energy', 'climate change', 'low carbon',
        'paris aligned', 'net zero', 'fossil fuel free', 'green transition',
        'clean tech', 'circular economy', 'biodiversity', 'bioenergy',
        'new energy', 'smart cities', 'smart mobility', 'green economy',
        'clean future', 'energy transition equity', 'sustainable future of food',
        'future of food', 'scarce resources', 'environmental impact',
        'rize environmental', 'guinness sustainable', 'sdg '
    ]),
    # Tematici Tecnologia
    ('Azionario Tematico - Tecnologia', [
        'technology equity', 'tech equity', 'semiconductor', 'robotics',
        'automation', 'cybersecurity', 'cloud computing', 'artificial intelligence',
        'software equity', 'internet equity', 'fintech', 'msci information tech',
        'data centre', 'metaverse', '5g equity', 'connectivity equity',
        'ark innovation', 'digital equity', 'e-commerce', 'internet of things',
        'video games', 'esports', 'gaming', 'future mobility', 'autonomous',
        'electric vehicle', 'msci innovation', 'next generation internet',
        'nextg ucits', 'innovative transaction', 'quantum computing',
        'web 3.0', 'physical ai', 'humanoids and drones', 'space innovators',
        'space & defence innovation', 'us fundamental large'
    ]),
    # Tematici Energia / Risorse
    ('Azionario Tematico - Energia', [
        'energy sector equity', 'oil sector equity', 'petroleum equity',
        'msci energy sector', 'stoxx energy sector', 'global energy sector',
        'commodity producers equity', 'global carbon reduced', 'carbon reduced',
        'uranium', 'nuclear energy', 'nuclear economies', 'hydrogen economy',
        'battery solutions', 'disruptive materials', 'rare earth',
        'strategic metals', 'mining ucits', 'global mining',
        'energy transition metals', 'battery metals', 's&p global energy'
    ]),
    # Settoriali
    ('Azionario Tematico - Settoriale', [
        'gender equality', 'travel ucits', 'ecommerce logistics', 'l&g ecommerce',
        'goshawk global balanced', 'global infrastructure', 'europe infrastructure',
        'yieldmax ultra option', 'wisdomtree zinc',
        'consumer discretionary', 'consumer staples', 's&p global consumer',
        's&p global industrial', 's&p global utilities', 'communications select', 'invesco communications s&p',
        'industrials select', 'materials select', 'energy select',
        'european autos', 'european basic resources', 'european chemicals',
        'european construction', 'european food', 'european household',
        'european industrials', 'european media', 'european telecoms',
        'european travel', 'invesco european', 'real estate equity', 'reit',
        'infrastructure equity', 'financials equity', 'uk property',
        'us industrials sector', 'us materials sector'
    ]),
    # Materie Prime - Metalli Preziosi
    ('Materie Prime - Metalli Preziosi', [
        'physical gold', 'physical silver', 'physical platinum',
        'precious metal', 'xetra-gold', 'bullion', 'gold etc',
        'silver etc', 'ubs gold', 'invesco gold', 'wisdomtree gold',
        'wisdomtree silver', 'sg etc gold', 'platinum eur hedged',
        'platinum etc', 'wisdomtree platinum'
    ]),
    # Materie Prime - Commodities
    ('Materie Prime - Commodities', [
        'bloomberg commodity', 'gsci', 'diversified commodity',
        'agriculture etf', 'industrial metal', 'copper etp',
        'crude oil etp', 'brent etp', 'wti etp', 'natural gas etp',
        'cmci composite', 'energy & metals', 'cocoa', 'cotton',
        'gasoline', 'grains', 'heating oil', 'lean hogs', 'live cattle',
        'soybeans', 'softs', 'sugar', 'zinc', 'wisdomtree energy',
        'energy longer dated', 'energy enhanced', 'uranium etp',
        'physical uranium', 'battery metals etp', 'energy transition metals',
        'wisdomtree bloomberg wti'
    ]),
    # Catch-all per i rimanenti non classificati dalle regole principali
    ('Obbligazionario Corporate', ['axa im global high yield', 'franklin euro ig corporate', 'fair oaks aaa', 'regan total return']),
    ('Materie Prime - Crypto', ['bitwise physical litecoin', 'litecoin etp']),
    ('Azionario USA', ['fineco am active collection us', 'fineco am dynamically hedged', 'invesco communications s&p us']),
    ('Azionario Europa', ['fineco am active collection europe', 'franklin european quality dividend']),
    ('Azionario Globale', ['fineco am active collection world', 'hanetf saturna', 'saturna al-kawthar', 'saba capital investment']),
    ('Azionario Tematico - ESG/Green', ['global x hydrogen']),
    ('Azionario Tematico - Energia', ['first trust indxx future economy metals']),
]

def classifica(name):
    """Classifica un ETF basandosi sul nome."""
    name_lower = name.lower()
    for categoria, keywords in REGOLE:
        for kw in keywords:
            if kw.lower() in name_lower:
                return categoria
    return None  # Non classificato

def main():
    dry_run = '--dry-run' in sys.argv
    if dry_run:
        print('=== DRY RUN — nessuna modifica al DB ===')

    print('Connessione a Railway DB...')
    conn = psycopg2.connect(DB_URL, sslmode='require', connect_timeout=15)
    cur = conn.cursor()

    # Recupera ETF con categoria NULL o 'Altro'
    cur.execute("""
        SELECT isin, name, categoria 
        FROM etf_catalog 
        WHERE categoria IS NULL OR categoria = 'Altro'
        ORDER BY name
    """)
    rows = cur.fetchall()
    print(f'ETF da classificare: {len(rows)}')
    print()

    aggiornati = 0
    non_classificati = []

    for isin, name, cat_attuale in rows:
        nuova_cat = classifica(name)
        if nuova_cat:
            print(f'  {"[DRY]" if dry_run else "[FIX]"} {isin} | {name[:50]:<50} → {nuova_cat}')
            if not dry_run:
                cur.execute(
                    'UPDATE etf_catalog SET categoria = %s WHERE isin = %s',
                    [nuova_cat, isin]
                )
            aggiornati += 1
        else:
            non_classificati.append((isin, name, cat_attuale))

    if not dry_run:
        conn.commit()

    print()
    print(f'=== RISULTATO ===')
    print(f'Classificati:     {aggiornati}')
    print(f'Non classificati: {len(non_classificati)}')

    if non_classificati:
        print()
        print('=== ETF NON CLASSIFICATI (richiedono revisione manuale) ===')
        for isin, name, cat in non_classificati:
            print(f'  {isin} | {name}')

    cur.close()
    conn.close()
    print()
    print('Completato!')

if __name__ == '__main__':
    main()
