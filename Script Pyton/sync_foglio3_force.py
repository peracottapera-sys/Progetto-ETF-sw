# -*- coding: utf-8 -*-
"""
sync_foglio3_force.py
Sovrascrive TUTTI i campi di performance e dati dal Foglio3 nel DB,
indipendentemente dal valore attuale (anche se non NULL).

Campi aggiornati:
  perf1s, perf1m, perf3m, perf6m, perf1y, perf3y, perf5y, ytd
  perf2025, perf2024, perf2023, perf2022
  vol1y, vol3y, vol5y
  maxdd1y, maxdd3y, maxdd5y, maxdd_max
  aum_mln, ter, data_lancio, distribuzione, valuta, replica
  sostenibile, partecipazioni, prestito_titoli
  ticker_yahoo (solo se NULL o vuoto nel DB)

Uso:
  pip install psycopg2-binary openpyxl pandas
  python sync_foglio3_force.py
"""

import psycopg2
import pandas as pd
import numpy as np
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB_URL     = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"
EXCEL_PATH = r"D:\Documenti\Casa\ETF_App\Lista_ETF_-_032726.xlsx"

CAMPI_PCT  = {'perf1s','perf1m','perf6m','perf1y','perf5y',
              'perf2025','perf2024','perf2023','perf2022',
              'vol1y','vol3y','vol5y',
              'maxdd1y','maxdd3y','maxdd5y','maxdd_max',
              'ter'}
CAMPI_BOOL = {'sostenibile', 'prestito_titoli'}
CAMPI_DATE = {'data_lancio'}
CAMPI_INT  = {'partecipazioni'}
CAMPI_NUM  = {'aum_mln'}
CAMPI_TEXT = {'valuta', 'distribuzione', 'replica'}

# Mappa colonna Excel → colonna DB
COLONNE = {
    '1S':                           'perf1s',
    '1M':                           'perf1m',
    '6M':                           'perf6m',
    '1A':                           'perf1y',
    '5A':                           'perf5y',
    '2025':                         'perf2025',
    '2024':                         'perf2024',
    '2023':                         'perf2023',
    '2022':                         'perf2022',
    'Volatilità 1A':                'vol1y',
    'Volatilità 3A':                'vol3y',
    'Volatilità 5A':                'vol5y',
    'Max. drawdown 1A':             'maxdd1y',
    'Max. drawdown 3A':             'maxdd3y',
    'Max. drawdown 5A':             'maxdd5y',
    'Max. drawdown MAX':            'maxdd_max',
    'Dim. del fondo\xa0(in mln €)': 'aum_mln',
    'TER p.a.':                     'ter',
    'Data di lancio':               'data_lancio',
    'Distribuzione':                'distribuzione',
    'Valuta del fondo':             'valuta',
    'Replica':                      'replica',
    'Sostenibilità':                'sostenibile',
    'Partecipazioni':               'partecipazioni',
    'Prestito titoli':              'prestito_titoli',
}

def pulisci(val, col_db):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    if isinstance(val, str) and val.strip() in ('-', '', 'N/A', 'nan', 'None'):
        return None
    try:
        if col_db in CAMPI_BOOL:
            return str(val).strip().lower() in ('si', 'sì', 'yes', 'true', '1')
        if col_db in CAMPI_DATE:
            return pd.to_datetime(val).date() if pd.notna(val) else None
        if col_db in CAMPI_INT:
            return int(float(str(val).replace(',', '.')))
        if col_db in CAMPI_PCT:
            v = float(str(val).replace(',', '.'))
            return round(v * 100, 4) if abs(v) < 2 else round(v, 4)
        if col_db in CAMPI_NUM:
            return float(str(val).replace(',', '.'))
        if col_db in CAMPI_TEXT:
            s = str(val).strip()
            return s if s else None
    except:
        return None
    return None

def main():
    print("Lettura Excel (Foglio3)...")
    df = pd.read_excel(EXCEL_PATH, sheet_name='Foglio3', header=None, skiprows=1)
    df.columns = df.iloc[0]
    df = df.drop(index=0).reset_index(drop=True)
    df['ISIN'] = df['ISIN'].astype(str).str.strip()
    df = df[df['ISIN'].str.len() == 12]
    print(f"ETF nel Foglio3: {len(df)}")

    print("Connessione a Railway PostgreSQL...")
    conn = psycopg2.connect(DB_URL, sslmode='require', connect_timeout=15)
    cur  = conn.cursor()
    print("Connesso!\n")

    col_db_list = list(COLONNE.values())
    set_clause = ', '.join([f"{col} = %s" for col in col_db_list])
    query_force = f"UPDATE etf_catalog SET {set_clause} WHERE isin = %s"

    ok = 0
    skip = 0
    non_trovati = 0
    campi_valorizzati = {c: 0 for c in col_db_list}

    print(f"=== Sync forzato {len(df)} ETF ===")

    for i, (_, row) in enumerate(df.iterrows()):
        isin = row['ISIN']
        valori = []
        ha_dati = False

        for col_excel, col_db in COLONNE.items():
            val = row.get(col_excel)
            v = pulisci(val, col_db)
            valori.append(v)
            if v is not None:
                ha_dati = True
                campi_valorizzati[col_db] += 1

        if not ha_dati:
            skip += 1
            continue

        valori.append(isin)
        cur.execute(query_force, valori)

        if cur.rowcount > 0:
            ok += 1
        else:
            non_trovati += 1

        # Ticker: aggiorna solo se NULL o vuoto
        ticker_excel = str(row.get('Ticker', '') or '').strip()
        if ticker_excel and ticker_excel not in ('-', 'nan', 'None'):
            cur.execute("""
                UPDATE etf_catalog SET ticker_yahoo = %s
                WHERE isin = %s AND (ticker_yahoo IS NULL OR ticker_yahoo = '')
            """, [ticker_excel, isin])

        if (i + 1) % 500 == 0:
            conn.commit()
            print(f"  [{i+1}/{len(df)}] OK:{ok} skip:{skip} non_trovati:{non_trovati}")

    conn.commit()
    cur.close()
    conn.close()

    print(f"\n{'='*55}")
    print(f"Aggiornati:     {ok}")
    print(f"Senza dati:     {skip}")
    print(f"Non in DB:      {non_trovati}")
    print(f"\nTop campi valorizzati:")
    for col, n in sorted(campi_valorizzati.items(), key=lambda x: -x[1])[:10]:
        print(f"  {col:<22}: {n}")
    print("\nCompletato!")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrotto.")
        sys.exit(0)
