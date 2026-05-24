# -*- coding: utf-8 -*-
"""
fix_tickers_senza_prezzo.py
Verifica e corregge i ticker Yahoo SOLO per gli ETF con quotazione=0.
Molto più veloce di fix_tickers_railway_v2.py — lavora solo sui 207 ETF problematici.

Logica:
  1. Testa il ticker mnemonico attuale (es. WCOE.MI)
  2. Se fallisce, prova anche il ticker mnemonico con suffissi alternativi
     (es. WCOE.AS, WCOE.DE, WCOE.PA, ...)
  3. Se tutto fallisce, prova ISIN+suffisso come ultimo resort
  4. Aggiorna ticker_yahoo e quotazione nel DB se trova un prezzo valido
  5. NON sovrascrive mai un ticker mnemonico funzionante

Uso:
  pip install psycopg2-binary requests
  python fix_tickers_senza_prezzo.py
"""

import psycopg2
import requests
import time
import sys
import io
import re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB_URL  = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
SUFFISSI = ['.MI', '.AS', '.DE', '.PA', '.L', '.F', '.SW', '.VX', '.IR', '.SG', '.LSE', '.ST', '.BR', '.HM', '.MU', '.DU', '.HA', '.BE']
TIMEOUT  = 8

def is_isin_ticker(ticker):
    return bool(re.match(r'^[A-Z]{2}[A-Z0-9]{10}\.', ticker or ''))

def testa_ticker(ticker):
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
    print("Connessione a Railway DB...")
    conn = psycopg2.connect(DB_URL, sslmode='require', connect_timeout=15)
    cur  = conn.cursor()

    # Solo ETF con ticker ma senza prezzo
    cur.execute("""
        SELECT isin, ticker_yahoo, name
        FROM etf_catalog
        WHERE active = 1
          AND ticker_yahoo IS NOT NULL AND ticker_yahoo != ''
          AND (quotazione IS NULL OR quotazione = 0)
        ORDER BY aum_mln DESC NULLS LAST
    """)
    etfs = cur.fetchall()
    print(f"ETF con ticker ma senza prezzo: {len(etfs)}")
    print(f"Stima tempo: ~{len(etfs) * 2 / 60:.0f} minuti\n")
    print("Premi CTRL+C per interrompere — i progressi vengono salvati.\n")

    ok = fix = fail = 0
    oggi = __import__('datetime').date.today().isoformat()

    for i, (isin, ticker, name) in enumerate(etfs):
        print(f"[{i+1}/{len(etfs)}] {ticker:<20} | {name[:40]}")

        # 1) Testa ticker attuale
        prezzo = testa_ticker(ticker)
        if prezzo:
            cur.execute("UPDATE etf_catalog SET quotazione = %s WHERE isin = %s", [prezzo, isin])
            cur.execute("""INSERT INTO prezzi_storici (isin, data, prezzo) VALUES (%s, %s, %s)
                ON CONFLICT (isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo""", [isin, oggi, prezzo])
            conn.commit()
            print(f"  ✓ Ticker attuale OK: {ticker} @ €{prezzo:.3f}")
            ok += 1
            time.sleep(0.3)
            continue

        # 2) Se il ticker è mnemonico (es. WCOE.MI), prova altri suffissi con la stessa base
        trovato = False
        base_mnem = ticker.rsplit('.', 1)[0] if '.' in ticker and not is_isin_ticker(ticker) else None

        if base_mnem:
            for suf in SUFFISSI:
                candidato = base_mnem + suf
                if candidato == ticker:
                    continue
                prezzo2 = testa_ticker(candidato)
                if prezzo2:
                    cur.execute("UPDATE etf_catalog SET ticker_yahoo = %s, quotazione = %s WHERE isin = %s",
                                [candidato, prezzo2, isin])
                    cur.execute("""INSERT INTO prezzi_storici (isin, data, prezzo) VALUES (%s, %s, %s)
                        ON CONFLICT (isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo""", [isin, oggi, prezzo2])
                    conn.commit()
                    print(f"  FIX mnem: {ticker} → {candidato} @ €{prezzo2:.3f}")
                    fix += 1
                    trovato = True
                    break
                time.sleep(0.15)

        # 3) Ultimo resort: ISIN + suffisso (solo se ticker era già ISIN.suffisso o non trovato sopra)
        if not trovato:
            for suf in SUFFISSI:
                candidato = isin + suf
                if candidato == ticker:
                    continue
                prezzo3 = testa_ticker(candidato)
                if prezzo3:
                    # Salva solo se il ticker attuale non è mnemonico reale
                    if is_isin_ticker(ticker) or not base_mnem:
                        cur.execute("UPDATE etf_catalog SET ticker_yahoo = %s, quotazione = %s WHERE isin = %s",
                                    [candidato, prezzo3, isin])
                        cur.execute("""INSERT INTO prezzi_storici (isin, data, prezzo) VALUES (%s, %s, %s)
                            ON CONFLICT (isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo""", [isin, oggi, prezzo3])
                        conn.commit()
                        print(f"  FIX isin: {ticker} → {candidato} @ €{prezzo3:.3f}")
                    else:
                        # Ha ticker mnemonico ma nessun suffisso funziona — salva solo il prezzo
                        cur.execute("UPDATE etf_catalog SET quotazione = %s WHERE isin = %s", [prezzo3, isin])
                        cur.execute("""INSERT INTO prezzi_storici (isin, data, prezzo) VALUES (%s, %s, %s)
                            ON CONFLICT (isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo""", [isin, oggi, prezzo3])
                        conn.commit()
                        print(f"  PREZZO via ISIN: {isin+suf} @ €{prezzo3:.3f} (ticker mnemonico {ticker} mantenuto)")
                    fix += 1
                    trovato = True
                    break
                time.sleep(0.15)

        # 4) ISIN nudo — Yahoo a volte risponde direttamente all'ISIN
        if not trovato:
            prezzo4 = testa_ticker(isin)
            if prezzo4:
                cur.execute("UPDATE etf_catalog SET quotazione = %s WHERE isin = %s", [prezzo4, isin])
                cur.execute("""INSERT INTO prezzi_storici (isin, data, prezzo) VALUES (%s, %s, %s)
                    ON CONFLICT (isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo""", [isin, oggi, prezzo4])
                conn.commit()
                print(f"  FIX ISIN nudo: {isin} @ €{prezzo4:.3f} (ticker invariato)")
                fix += 1
                trovato = True

        if not trovato:
            print(f"  FAIL — nessun ticker funzionante per {isin}")
            fail += 1

        time.sleep(0.4)

    cur.close()
    conn.close()

    print(f"\n{'='*55}")
    print(f"OK (ticker attuale funziona):  {ok}")
    print(f"FIX (ticker o suffisso corretto): {fix}")
    print(f"FAIL (irrecuperabili):         {fail}")
    print(f"\nCompletato!")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrotto. I progressi sono stati salvati.")
        sys.exit(0)
