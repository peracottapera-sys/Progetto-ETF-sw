import psycopg2, csv

DB_URL = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"

conn = psycopg2.connect(DB_URL, sslmode='require', connect_timeout=15)
cur = conn.cursor()
cur.execute("SELECT isin, name FROM etf_catalog WHERE categoria IS NULL OR categoria = 'Altro' ORDER BY name")
rows = cur.fetchall()

with open('etf_altro.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['isin', 'name'])
    w.writerows(rows)

print(f'Esportati {len(rows)} ETF in etf_altro.csv')
conn.close()