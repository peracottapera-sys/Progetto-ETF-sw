# -*- coding: utf-8 -*-
"""
import_nuovi_etf_foglio3.py
Importa gli ETF presenti nel Foglio3 ma NON ancora in etf_catalog.
Inserisce tutti i campi disponibili inclusi quelli nuovi.

Uso:
  pip install psycopg2-binary openpyxl pandas
  python import_nuovi_etf_foglio3.py
"""

import psycopg2
import pandas as pd
import numpy as np
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB_URL     = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"
EXCEL_PATH = r"D:\Documenti\Casa\ETF_App\Lista_ETF_-_032726.xlsx"

def pct(val):
    """Converte valore decimale JustETF in percentuale. Es: 0.082 → 8.2"""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    if isinstance(val, str) and val.strip() in ('-', '', 'N/A'):
        return None
    try:
        v = float(str(val).replace(',', '.'))
        if abs(v) < 2:
            return round(v * 100, 4)
        return round(v, 4)
    except:
        return None

def num(val):
    """Converte in float, None se non valido."""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    if isinstance(val, str) and val.strip() in ('-', '', 'N/A'):
        return None
    try:
        return float(str(val).replace(',', '.'))
    except:
        return None

def intero(val):
    try:
        v = float(str(val).replace(',', '.'))
        return int(v)
    except:
        return None

def boolean(val):
    if val is None:
        return None
    return str(val).strip().lower() in ('si', 'sì', 'yes', 'true', '1')

def data(val):
    try:
        return pd.to_datetime(val).date() if pd.notna(val) else None
    except:
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

    # Leggi ISIN già presenti nel DB
    cur.execute("SELECT isin FROM etf_catalog")
    isin_esistenti = {r[0] for r in cur.fetchall()}
    print(f"ISIN già nel DB: {len(isin_esistenti)}")

    # Filtra solo i nuovi
    df_nuovi = df[~df['ISIN'].isin(isin_esistenti)].copy()
    print(f"ETF da inserire: {len(df_nuovi)}\n")

    if len(df_nuovi) == 0:
        print("Nessun nuovo ETF da inserire.")
        return

    inseriti = 0
    errori = 0

    for _, row in df_nuovi.iterrows():
        isin = row['ISIN']
        try:
            cur.execute("""
                INSERT INTO etf_catalog (
                    isin, name, valuta, aum_mln, ter,
                    perf1m, perf6m, perf1y, perf5y,
                    perf1s, perf2025, perf2024, perf2023, perf2022,
                    vol1y, vol3y, vol5y,
                    maxdd1y, maxdd5y, maxdd_max,
                    data_lancio, distribuzione, sostenibile,
                    partecipazioni, prestito_titoli,
                    replica, ticker_yahoo,
                    active, quotazione
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s,
                    1, 0
                )
                ON CONFLICT (isin) DO NOTHING
            """, [
                isin,
                str(row.get('Nome del Fondo', '') or '').strip(),
                str(row.get('Valuta del fondo', '') or '').strip(),
                num(row.get('Dim. del fondo\xa0(in mln €)')),
                num(row.get('TER p.a.')),
                # performance
                pct(row.get('1M')), pct(row.get('6M')),
                pct(row.get('1A')), pct(row.get('5A')),
                pct(row.get('1S')),
                pct(row.get('2025')), pct(row.get('2024')),
                pct(row.get('2023')), pct(row.get('2022')),
                # volatilità
                pct(row.get('Volatilità 1A')),
                pct(row.get('Volatilità 3A')),
                pct(row.get('Volatilità 5A')),
                # drawdown
                pct(row.get('Max. drawdown 1A')),
                pct(row.get('Max. drawdown 5A')),
                pct(row.get('Max. drawdown MAX')),
                # altri campi
                data(row.get('Data di lancio')),
                str(row.get('Distribuzione', '') or '').strip(),
                boolean(row.get('Sostenibilità')),
                intero(row.get('Partecipazioni')),
                boolean(row.get('Prestito titoli')),
                str(row.get('Replica', '') or '').strip(),
                str(row.get('Ticker', '') or '').strip() or None,
            ])
            inseriti += 1
            if inseriti % 50 == 0:
                conn.commit()
                print(f"  Inseriti: {inseriti}/{len(df_nuovi)}")
        except Exception as e:
            conn.rollback()  # CRITICO: resetta la transazione dopo ogni errore
            errori += 1
            print(f"  ERRORE {isin}: {e}")

    conn.commit()
    cur.close()
    conn.close()

    print(f"\n{'='*55}")
    print(f"Inseriti:  {inseriti}")
    print(f"Errori:    {errori}")
    print(f"\nCompletato!")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrotto.")
        sys.exit(0)
