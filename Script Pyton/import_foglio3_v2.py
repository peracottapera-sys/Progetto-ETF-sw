# -*- coding: utf-8 -*-
"""
import_foglio3_v2.py
Aggiorna i campi NULL nel DB usando i dati del Foglio3.
NON sovrascrive valori già presenti — integra solo dove mancano.

Uso:
  pip install psycopg2-binary openpyxl pandas
  python import_foglio3_v2.py
"""

import psycopg2
import pandas as pd
import numpy as np
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB_URL     = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"
EXCEL_PATH = r"D:\Documenti\Casa\ETF_App\Lista_ETF_-_032726.xlsx"

# Mappa colonna Excel → colonna DB
COLONNE = {
    '1S':                           'perf1s',
    '2025':                         'perf2025',
    '2024':                         'perf2024',
    '2023':                         'perf2023',
    '2022':                         'perf2022',
    'Volatilità 3A':                'vol3y',
    'Volatilità 5A':                'vol5y',
    'Max. drawdown 3A':             'maxdd3y',
    'Max. drawdown MAX':            'maxdd_max',
    'Data di lancio':               'data_lancio',
    'Sostenibilità':                'sostenibile',
    'Partecipazioni':               'partecipazioni',
    'Prestito titoli':              'prestito_titoli',
    '1M':                           'perf1m',
    '6M':                           'perf6m',
    '1A':                           'perf1y',
    '5A':                           'perf5y',
    'Volatilità 1A':                'vol1y',
    'Max. drawdown 1A':             'maxdd1y',
    'Max. drawdown 5A':             'maxdd5y',
    'Dim. del fondo\xa0(in mln €)': 'aum_mln',
    'TER p.a.':                     'ter',
    'Valuta del fondo':             'valuta',
    'Distribuzione':                'distribuzione',
    'Replica':                      'replica',
    'Ticker':                       'ticker_yahoo',
}

CAMPI_PCT  = {'perf1s','perf2025','perf2024','perf2023','perf2022','perf1m','perf6m','ter',
              'perf1y','perf5y','vol1y','vol3y','vol5y','maxdd1y','maxdd3y','maxdd5y','maxdd_max'}
CAMPI_BOOL = {'sostenibile', 'prestito_titoli'}
CAMPI_DATE = {'data_lancio'}
CAMPI_INT  = {'partecipazioni'}
CAMPI_NUM  = {'aum_mln'}
CAMPI_TEXT = {'valuta', 'distribuzione', 'replica', 'ticker_yahoo'}

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

    print(f"=== Aggiornamento campi NULL per {len(df)} ETF ===")
    print("(sovrascrive solo valori NULL, non tocca dati già presenti)\n")

    campi_compilati = {col_db: 0 for col_db in COLONNE.values()}

    for i, (_, row) in enumerate(df.iterrows()):
        isin = row['ISIN']

        for col_excel, col_db in COLONNE.items():
            val    = row.get(col_excel)
            valore = pulisci(val, col_db)
            if valore is None:
                continue

            # Testo: aggiorna se NULL o stringa vuota
            if col_db in CAMPI_TEXT:
                cur.execute(f"""
                    UPDATE etf_catalog SET {col_db} = %s
                    WHERE isin = %s
                      AND ({col_db} IS NULL OR {col_db} = '')
                """, [valore, isin])
            else:
                cur.execute(f"""
                    UPDATE etf_catalog SET {col_db} = %s
                    WHERE isin = %s AND {col_db} IS NULL
                """, [valore, isin])

            if cur.rowcount > 0:
                campi_compilati[col_db] += 1

        if (i + 1) % 500 == 0:
            conn.commit()
            tot = sum(campi_compilati.values())
            print(f"  [{i+1}/{len(df)}] Celle aggiornate finora: {tot}")

    conn.commit()
    cur.close()
    conn.close()

    print(f"\n{'='*55}")
    print("Celle aggiornate per campo:")
    tot = 0
    for col_db, n in sorted(campi_compilati.items(), key=lambda x: -x[1]):
        if n > 0:
            print(f"  {col_db:<22}: {n}")
            tot += n
    print(f"\nTotale celle compilate: {tot}")
    print("Completato!")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrotto.")
        sys.exit(0)
