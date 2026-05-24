# -*- coding: utf-8 -*-
"""
fix_ter_decimali.py
Arrotonda tutti i valori TER a 2 cifre decimali nel DB.
Es: 0.120000005 → 0.12, 0.3800000001 → 0.38

Uso: python fix_ter_decimali.py
"""

import psycopg2
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB_URL = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"

def main():
    print("Connessione a Railway DB...")
    conn = psycopg2.connect(DB_URL, sslmode='require', connect_timeout=15)
    cur  = conn.cursor()

    # Conta quanti TER hanno più di 2 decimali significativi
    cur.execute("""
        SELECT COUNT(*) FROM etf_catalog 
        WHERE ter IS NOT NULL AND ter != ROUND(ter::numeric, 2)
    """)
    n = cur.fetchone()[0]
    print(f"TER da correggere: {n}")

    # Arrotonda tutti a 2 decimali
    cur.execute("""
        UPDATE etf_catalog 
        SET ter = ROUND(ter::numeric, 2)
        WHERE ter IS NOT NULL AND ter != ROUND(ter::numeric, 2)
    """)
    aggiornati = cur.rowcount
    conn.commit()

    # Verifica
    cur.execute("SELECT MIN(ter), MAX(ter), AVG(ter) FROM etf_catalog WHERE ter IS NOT NULL")
    r = cur.fetchone()
    print(f"Aggiornati: {aggiornati}")
    print(f"Dopo: min={r[0]:.2f}% max={r[1]:.2f}% avg={r[2]:.4f}%")

    cur.close()
    conn.close()
    print("Completato!")

if __name__ == "__main__":
    main()
