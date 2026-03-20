"""
find_tickers_railway.py
Trova automaticamente il ticker Yahoo per ogni ETF nel catalogo
e aggiorna direttamente il DB Railway.

Uso:
  pip install psycopg2-binary requests
  python find_tickers_railway.py

Lo script è riprendibile — salta gli ISIN già con ticker.
Stima tempo: ~30 minuti per 2681 ETF (200ms pausa per evitare ban Yahoo)
"""

import psycopg2
import requests
import time
import sys

DB_URL = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
SUFFISSI = ['.MI', '.AS', '.DE', '.PA', '.L', '.F', '.SW', '.BR', '.AX', '.TO']

def test_ticker(ticker):
    """Restituisce il prezzo se il ticker è valido su Yahoo, altrimenti None."""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d"
        r = requests.get(url, headers=HEADERS, timeout=8)
        data = r.json()
        prezzo = data.get('chart', {}).get('result', [{}])[0].get('meta', {}).get('regularMarketPrice')
        if prezzo and prezzo > 0:
            return prezzo
    except:
        pass
    return None

def find_ticker(isin):
    """Prova tutti i suffissi e restituisce (ticker, prezzo) se trovato."""
    for suf in SUFFISSI:
        ticker = isin + suf
        prezzo = test_ticker(ticker)
        if prezzo:
            return ticker, prezzo
        time.sleep(0.15)
    return None, None

def main():
    print("Connessione a Railway PostgreSQL...")
    conn = psycopg2.connect(DB_URL, sslmode='require', connect_timeout=15)
    cur = conn.cursor()
    print("Connesso!\n")

    # Carica ETF senza ticker
    cur.execute("""
        SELECT isin FROM etf_catalog 
        WHERE active = 1 
        AND (ticker_yahoo IS NULL OR ticker_yahoo = '')
        ORDER BY aum_mln DESC NULLS LAST
    """)
    etfs = [r[0] for r in cur.fetchall()]
    totale = len(etfs)
    print(f"ETF senza ticker: {totale}")
    print(f"Stima tempo: ~{totale * 0.2 * len(SUFFISSI) / 60:.0f} minuti nel caso peggiore\n")
    print("Premi CTRL+C per interrompere — i progressi vengono salvati in tempo reale.\n")

    trovati = 0
    non_trovati = 0

    for i, isin in enumerate(etfs, 1):
        ticker, prezzo = find_ticker(isin)
        
        if ticker:
            cur.execute(
                "UPDATE etf_catalog SET ticker_yahoo = %s, quotazione = %s WHERE isin = %s",
                [ticker, prezzo, isin]
            )
            # Salva anche in prezzi_storici
            oggi = __import__('datetime').date.today().isoformat()
            cur.execute("""
                INSERT INTO prezzi_storici (isin, data, prezzo) VALUES (%s, %s, %s)
                ON CONFLICT (isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo
            """, [isin, oggi, prezzo])
            conn.commit()
            trovati += 1
            print(f"[{i}/{totale}] ✓ {isin} → {ticker} @ €{prezzo:.2f}")
        else:
            non_trovati += 1
            if i % 50 == 0:
                print(f"[{i}/{totale}] ... {trovati} trovati finora, {non_trovati} non trovati")

        time.sleep(0.2)

    cur.close()
    conn.close()

    print(f"\n✅ Completato!")
    print(f"   Ticker trovati e salvati: {trovati}")
    print(f"   ETF senza ticker:         {non_trovati}")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrotto dall'utente. I progressi sono stati salvati.")
        sys.exit(0)
