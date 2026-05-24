# -*- coding: utf-8 -*-
"""
import_tickers_v3.py
Aggiorna ticker_yahoo nel DB Railway usando i ticker mnemonici dal Foglio3 dell'Excel.
SOVRASCRIVE anche i ticker in formato ISIN.suffisso (es. IE00B86MWN23.IR)
con il ticker mnemonico reale (es. MVEU.MI).

Uso:
  pip install psycopg2-binary openpyxl requests pandas openpyxl
  python import_tickers_v3.py

Logica suffissi per domicilio:
  Irlanda/Lussemburgo/Jersey/Paesi bassi → prova .MI .AS .DE .PA .L .F .SW .IR
  Germania → prova .DE .F .MI .AS
  Francia → prova .PA .MI .AS .DE
  Svizzera → prova .SW .VX .MI .DE
"""

import psycopg2
import requests
import pandas as pd
import time
import sys
import io
import re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB_URL     = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"
EXCEL_PATH = r"D:\Documenti\Casa\ETF_App\Lista_ETF_-_032726.xlsx"

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
TIMEOUT = 8

# Suffissi prioritari per domicilio
SUFFISSI_PER_DOMICILIO = {
    'Irlanda':        ['.MI', '.AS', '.DE', '.PA', '.L', '.F', '.SW', '.IR'],
    'Lussemburgo':    ['.DE', '.PA', '.MI', '.AS', '.F', '.SW'],
    'Jersey':         ['.MI', '.AS', '.DE', '.PA', '.L', '.SW'],
    'Germania':       ['.DE', '.F', '.MI', '.AS', '.PA'],
    'Francia':        ['.PA', '.MI', '.AS', '.DE', '.F'],
    'Svizzera':       ['.SW', '.VX', '.MI', '.DE', '.AS'],
    'Liechtenstein':  ['.DE', '.MI', '.AS', '.PA'],
    'Paesi bassi':    ['.AS', '.MI', '.DE', '.PA'],
    'Svezia':         ['.ST', '.MI', '.AS', '.DE'],
    'Regno Unito':    ['.L', '.MI', '.AS', '.DE'],
}
SUFFISSI_DEFAULT = ['.MI', '.AS', '.DE', '.PA', '.L', '.F', '.SW', '.IR']

def is_isin_ticker(ticker):
    """Ritorna True se il ticker è nel formato ISIN.suffisso (da sovrascrivere)"""
    if not ticker:
        return False
    return bool(re.match(r'^[A-Z]{2}[A-Z0-9]{10}\.', ticker))

def testa_ticker(ticker):
    """Ritorna il prezzo se il ticker funziona su Yahoo, None altrimenti"""
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

def trova_ticker_con_suffisso(ticker_base, domicilio):
    """Prova ticker_base + suffissi nell'ordine del domicilio, ritorna (ticker_completo, prezzo)"""
    suffissi = SUFFISSI_PER_DOMICILIO.get(domicilio, SUFFISSI_DEFAULT)
    for suf in suffissi:
        candidato = ticker_base + suf
        prezzo = testa_ticker(candidato)
        if prezzo:
            return candidato, prezzo
        time.sleep(0.15)
    return None, None

def main():
    print("Lettura Excel (Foglio3)...")
    df2 = pd.read_excel(EXCEL_PATH, sheet_name='Foglio3', header=None, skiprows=1)
    df2.columns = df2.iloc[0]
    df2 = df2.drop(index=0).reset_index(drop=True)
    df2 = df2.dropna(subset=['ISIN', 'Ticker'])
    df2['ISIN']   = df2['ISIN'].astype(str).str.strip()
    df2['Ticker'] = df2['Ticker'].astype(str).str.strip()
    df2['Domicilio del fondo'] = df2['Domicilio del fondo'].astype(str).str.strip()

    # Rimuovi duplicati ISIN (tieni prima occorrenza)
    df2 = df2.drop_duplicates(subset=['ISIN'], keep='first')
    ticker_map = dict(zip(df2['ISIN'], zip(df2['Ticker'], df2['Domicilio del fondo'])))
    print(f"Ticker nel Foglio3: {len(ticker_map)}")

    print("Connessione a Railway PostgreSQL...")
    conn = psycopg2.connect(DB_URL, sslmode='require', connect_timeout=15)
    cur  = conn.cursor()
    print("Connesso!\n")

    # Leggi tutti gli ETF attivi dal DB
    cur.execute("""
        SELECT isin, ticker_yahoo, name
        FROM etf_catalog
        WHERE active = 1
        ORDER BY aum_mln DESC NULLS LAST
    """)
    db_etfs = {r[0]: {'ticker': r[1], 'name': r[2]} for r in cur.fetchall()}
    print(f"ETF attivi nel DB: {len(db_etfs)}")

    # Identifica cosa fare per ogni ETF
    da_aggiornare = []   # ticker ISIN.suffisso da correggere con mnemonico
    da_verificare = []   # ticker mnemonico già OK o assente
    for isin, info in db_etfs.items():
        ticker_db = info['ticker'] or ''
        if isin in ticker_map:
            ticker_base, domicilio = ticker_map[isin]
            if is_isin_ticker(ticker_db):
                # Ha ticker ISIN.suffisso → da correggere con mnemonico
                da_aggiornare.append((isin, ticker_db, ticker_base, domicilio, info['name']))
            elif not ticker_db:
                # Nessun ticker → da trovare
                da_verificare.append((isin, ticker_base, domicilio, info['name']))
            # else: ha già ticker mnemonico → OK, non toccare

    print(f"ETF con ticker ISIN.suffisso da correggere: {len(da_aggiornare)}")
    print(f"ETF senza ticker da aggiungere:             {len(da_verificare)}")
    print(f"Stima tempo: ~{(len(da_aggiornare) + len(da_verificare)) * 1.5 / 60:.0f} minuti\n")
    print("Premi CTRL+C per interrompere — i progressi vengono salvati.\n")

    oggi = __import__('datetime').date.today().isoformat()
    ok = fix = non_trovati = 0
    totale = len(da_aggiornare) + len(da_verificare)
    contatore = 0

    # ── Fase 1: correzione ticker ISIN.suffisso ───────────────────────────
    print(f"=== FASE 1: Correzione {len(da_aggiornare)} ticker ISIN.suffisso ===")
    for isin, ticker_vecchio, ticker_base, domicilio, name in da_aggiornare:
        contatore += 1
        ticker_nuovo, prezzo = trova_ticker_con_suffisso(ticker_base, domicilio)
        if ticker_nuovo and prezzo:
            cur.execute(
                "UPDATE etf_catalog SET ticker_yahoo = %s, quotazione = %s WHERE isin = %s",
                [ticker_nuovo, prezzo, isin]
            )
            cur.execute("""
                INSERT INTO prezzi_storici (isin, data, prezzo) VALUES (%s, %s, %s)
                ON CONFLICT (isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo
            """, [isin, oggi, prezzo])
            conn.commit()
            fix += 1
            print(f"[{contatore}/{totale}] FIX {ticker_vecchio} → {ticker_nuovo} @ €{prezzo:.2f} | {name[:35]}")
        else:
            non_trovati += 1
            print(f"[{contatore}/{totale}] FAIL {isin} ({ticker_base}+suffisso) | {name[:35]}")
        time.sleep(0.3)

    # ── Fase 2: ETF senza ticker ──────────────────────────────────────────
    print(f"\n=== FASE 2: Aggiunta {len(da_verificare)} ticker mancanti ===")
    for isin, ticker_base, domicilio, name in da_verificare:
        contatore += 1
        ticker_nuovo, prezzo = trova_ticker_con_suffisso(ticker_base, domicilio)
        if ticker_nuovo and prezzo:
            cur.execute(
                "UPDATE etf_catalog SET ticker_yahoo = %s, quotazione = %s WHERE isin = %s",
                [ticker_nuovo, prezzo, isin]
            )
            cur.execute("""
                INSERT INTO prezzi_storici (isin, data, prezzo) VALUES (%s, %s, %s)
                ON CONFLICT (isin, data) DO UPDATE SET prezzo = EXCLUDED.prezzo
            """, [isin, oggi, prezzo])
            conn.commit()
            ok += 1
            print(f"[{contatore}/{totale}] NEW {isin} → {ticker_nuovo} @ €{prezzo:.2f} | {name[:35]}")
        else:
            non_trovati += 1
            print(f"[{contatore}/{totale}] FAIL {isin} ({ticker_base}+suffisso) | {name[:35]}")
        time.sleep(0.3)

    cur.close()
    conn.close()

    print(f"\n{'='*55}")
    print(f"FIX (ISIN.suffisso → mnemonico): {fix}")
    print(f"NEW (aggiunti ex-novo):           {ok}")
    print(f"FAIL (non trovati su Yahoo):      {non_trovati}")
    print(f"\nCompletato! Domani il job notturno userà i ticker corretti.")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrotto. I progressi sono stati salvati.")
        sys.exit(0)
