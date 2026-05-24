# -*- coding: utf-8 -*-
"""
import_foglio3.py
Importa i nuovi campi dal Foglio3 dell'Excel nel DB Railway.
Aggiunge colonne mancanti e aggiorna i valori per ogni ISIN.

Nuovi campi:
  perf1s       ← 1S (performance 1 settimana)
  perf2025     ← 2025
  perf2024     ← 2024
  perf2023     ← 2023
  perf2022     ← 2022
  vol3y        ← Volatilità 3A
  vol5y        ← Volatilità 5A
  maxdd3y      ← Max. drawdown 3A
  maxdd_max    ← Max. drawdown MAX (massimo storico)
  data_lancio  ← Data di lancio
  sostenibile  ← Sostenibilità (Si/No → boolean)
  partecipazioni ← Partecipazioni (numero titoli)
  prestito_titoli ← Prestito titoli (Si/No → boolean)

Uso:
  pip install psycopg2-binary openpyxl pandas
  python import_foglio3.py
"""

import psycopg2
import pandas as pd
import numpy as np
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB_URL     = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"
EXCEL_PATH = r"D:\Documenti\Casa\ETF_App\Lista_ETF_-_032726.xlsx"

# Mappa colonne Excel → colonne DB
COLONNE = {
    '1S':                  ('perf1s',          'NUMERIC(8,4)'),
    '2025':                ('perf2025',         'NUMERIC(8,4)'),
    '2024':                ('perf2024',         'NUMERIC(8,4)'),
    '2023':                ('perf2023',         'NUMERIC(8,4)'),
    '2022':                ('perf2022',         'NUMERIC(8,4)'),
    'Volatilità 3A':       ('vol3y',            'NUMERIC(8,4)'),
    'Volatilità 5A':       ('vol5y',            'NUMERIC(8,4)'),
    'Max. drawdown 3A':    ('maxdd3y',          'NUMERIC(8,4)'),
    'Max. drawdown MAX':   ('maxdd_max',        'NUMERIC(8,4)'),
    'Data di lancio':      ('data_lancio',      'DATE'),
    'Sostenibilità':       ('sostenibile',      'BOOLEAN'),
    'Partecipazioni':      ('partecipazioni',   'INTEGER'),
    'Prestito titoli':     ('prestito_titoli',  'BOOLEAN'),
}

def pulisci(val, tipo_db):
    """Converte il valore Excel nel tipo DB corretto."""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    if isinstance(val, str) and val.strip() in ('-', '', 'N/A', 'nan'):
        return None
    try:
        if tipo_db == 'BOOLEAN':
            return str(val).strip().lower() in ('si', 'sì', 'yes', 'true', '1')
        if tipo_db == 'DATE':
            return pd.to_datetime(val).date() if pd.notna(val) else None
        if tipo_db == 'INTEGER':
            return int(float(str(val).replace(',', '.')))
        if tipo_db.startswith('NUMERIC'):
            v = float(str(val).replace(',', '.'))
            # I valori JustETF sono in formato decimale (es. 0.082 = 8.2%)
            # Convertiamo in percentuale se il valore assoluto è < 2
            # (esclude valori già in percentuale come 82% che sarebbe 0.82)
            if abs(v) < 2:
                return round(v * 100, 4)
            return round(v, 4)
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

    # ── Step 1: Aggiungi colonne mancanti nel DB ──────────────────────────
    print("=== STEP 1: Verifica e aggiunta colonne mancanti ===")
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'etf_catalog'
    """)
    colonne_esistenti = {r[0] for r in cur.fetchall()}

    for col_excel, (col_db, tipo_db) in COLONNE.items():
        if col_db not in colonne_esistenti:
            cur.execute(f"ALTER TABLE etf_catalog ADD COLUMN IF NOT EXISTS {col_db} {tipo_db}")
            conn.commit()
            print(f"  + Aggiunta colonna: {col_db} ({tipo_db})")
        else:
            print(f"  ✓ Già presente: {col_db}")

    # ── Step 2: Aggiorna i valori per ogni ISIN ───────────────────────────
    print(f"\n=== STEP 2: Aggiornamento {len(df)} ETF ===")
    col_db_list = [col_db for _, (col_db, _) in COLONNE.items()]
    ok = 0
    non_trovati = 0
    ticker_aggiornati = 0

    set_clause = ', '.join([f"{col} = %s" for col in col_db_list])
    query = f"UPDATE etf_catalog SET {set_clause} WHERE isin = %s"

    for i, (_, row) in enumerate(df.iterrows()):
        isin = row['ISIN']
        valori = []
        for col_excel, (col_db, tipo_db) in COLONNE.items():
            val = row.get(col_excel)
            valori.append(pulisci(val, tipo_db))

        valori.append(isin)
        cur.execute(query, valori)

        if cur.rowcount > 0:
            ok += 1
        else:
            non_trovati += 1

        # Aggiorna ticker_yahoo SOLO se è NULL o vuoto nel DB
        # Non sovrascrivere mai ticker già presenti (mnemonici funzionanti)
        ticker_excel = str(row.get('Ticker', '') or '').strip()
        if ticker_excel and ticker_excel not in ('-', 'nan', 'None'):
            cur.execute("""
                UPDATE etf_catalog
                SET ticker_yahoo = %s
                WHERE isin = %s
                  AND (ticker_yahoo IS NULL OR ticker_yahoo = '')
            """, [ticker_excel, isin])
            if cur.rowcount > 0:
                ticker_aggiornati += 1

        if (i + 1) % 500 == 0:
            conn.commit()
            print(f"  [{i+1}/{len(df)}] OK:{ok} non_trovati:{non_trovati} ticker_new:{ticker_aggiornati}")

    conn.commit()
    cur.close()
    conn.close()

    print(f"\n{'='*55}")
    print(f"Aggiornati:         {ok}")
    print(f"Non trovati nel DB: {non_trovati}")
    print(f"Ticker aggiunti:    {ticker_aggiornati} (solo dove era NULL)")
    print(f"\nCompletato!")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrotto.")
        sys.exit(0)
