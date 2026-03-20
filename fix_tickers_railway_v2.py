# -*- coding: utf-8 -*-
"""
fix_tickers_railway.py — Verifica e corregge i ticker Yahoo di tutti gli ETF nel catalogo
Uso: python fix_tickers_railway.py

Legge tutti gli ETF con ticker_yahoo dal DB Railway, testa ogni ticker su Yahoo Finance,
per quelli che danno 404 prova i suffissi alternativi e aggiorna il DB.
"""

import psycopg2
import requests
import time
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ── Connessione Railway ────────────────────────────────────────────────────
DB_URL = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
SUFFISSI = ['.MI', '.AS', '.DE', '.PA', '.L', '.F', '.SW', '.VX', '.LSE']
TIMEOUT = 8

def testa_ticker(ticker):
    """Ritorna il prezzo se il ticker funziona, None altrimenti"""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d"
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        if r.status_code != 200:
            return None
        data = r.json()
        prezzo = data.get('chart', {}).get('result', [{}])[0].get('meta', {}).get('regularMarketPrice')
        return float(prezzo) if prezzo and float(prezzo) > 0 else None
    except:
        return None

def main():
    print(f"Connessione a Railway DB...")
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # Leggi tutti gli ETF con ticker
    cur.execute("""
        SELECT isin, ticker_yahoo, name
        FROM etf_catalog
        WHERE active = 1 AND ticker_yahoo IS NOT NULL AND ticker_yahoo != ''
        ORDER BY aum_mln DESC NULLS LAST
    """)
    etfs = cur.fetchall()
    print(f"ETF da verificare: {len(etfs)}")

    ok = 0
    fix = 0
    fail = 0
    skip = 0

    for i, (isin, ticker, name) in enumerate(etfs):
        sys.stdout.write(f"\r[{i+1}/{len(etfs)}] {ticker:<20} ", )
        sys.stdout.flush()

        # Testa ticker attuale
        prezzo = testa_ticker(ticker)
        if prezzo:
            ok += 1
            sys.stdout.write(f"OK {prezzo}\n")
            time.sleep(0.3)
            continue

        # Ticker non funziona — prova suffissi
        trovato = False
        base_isin = isin  # prova con ISIN puro + suffisso
        for suf in SUFFISSI:
            candidato = base_isin + suf
            if candidato == ticker:
                continue  # già provato
            prezzo2 = testa_ticker(candidato)
            if prezzo2:
                # Aggiorna nel DB
                cur.execute(
                    "UPDATE etf_catalog SET ticker_yahoo = %s WHERE isin = %s",
                    (candidato, isin)
                )
                conn.commit()
                print(f"\n  FIX: {ticker} → {candidato} (€{prezzo2:.3f}) | {name[:40]}")
                fix += 1
                trovato = True
                break
            time.sleep(0.2)

        if not trovato:
            print(f"\n  FAIL - Nessun ticker trovato per {isin} ({name[:40]})")
            fail += 1

        time.sleep(0.4)

    conn.close()
    print(f"\n{'='*50}")
    print(f"Risultati: ✓ {ok} OK | FIX {fix} corretti | FAIL {fail} non trovati")
    print(f"Script completato.")

if __name__ == '__main__':
    main()
