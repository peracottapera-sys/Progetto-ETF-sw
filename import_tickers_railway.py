"""
import_tickers_railway.py
Aggiorna etf_catalog su Railway con i ticker Yahoo dalla mappa del codice.

Uso:
  python import_tickers_railway.py
"""

import psycopg2

DB_URL = "postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway"

# Mappa ISIN → Ticker Yahoo (da etf.js)
ISIN_TICKER_MAP = {
  'IE00B4L5Y983':'IWDA.AS','LU1681041782':'LCUW.DE','IE00B4K48X80':'IESE.MI',
  'LU1681043599':'MEUR.DE','IE00B3F81R35':'IEAG.AS','LU1829218749':'LYTR.DE',
  'IE00B3F81409':'IBCX.AS','LU1829219655':'CRPE.MI','IE00B4L5YC18':'EMIM.AS',
  'LU1681045370':'AEEM.PA','IE00B3FH7618':'IBGS.AS','IE00B4WXJJ64':'IBCI.AS',
  'LU1650490474':'EM13.MI','LU1650491282':'GISG.MI','IE00B3XXRP09':'VWCE.DE',
  'IE00B5BMR087':'CSPX.AS','IE00B4L5YX21':'SPPW.DE','IE0032077012':'EQQQ.MI',
  'IE00BYVJRP78':'XNAS.DE','IE00B4JNQZ49':'QDVE.DE','IE00BFG0R112':'HEAL.MI',
  'IE00B66F4759':'IHYG.MI','IE00BD4DXW77':'XHYA.DE','IE00B3VVMM84':'IUSN.DE',
  'IE00B4ND3602':'SGLD.MI','DE000A1EK0G3':'GLDA.DE','DE000A0S9GB0':'4GLD.DE',
  'IE00BKM4GZ66':'AEME.MI','IE00BGDQ0H97':'ISPY.MI','IE00B53L4350':'IMIB.MI',
  'LU0274212538':'CSMIB.MI','IE00B53QDK08':'IJPN.AS','LU0659580079':'XMAS.DE',
  'IE00B5L8K969':'CSEMAS.MI','IE00B5L01S80':'IPRP.AS','LU0489337690':'XREA.DE',
  'IE00B7LW3080':'XBTP.MI','IE00B3F81K65':'IITB.MI','IE00B14X4S71':'IBTS.AS',
  'IE00B1FZS798':'IBTM.MI','IE00BGPP6599':'IBGL.MI','LU0290358497':'XEON.DE',
  'FR0010510800':'LEONIA.MI','IE00BK5BQT80':'VWCE.DE','IE00B3ZW0K18':'IUES.AS',
  'IE00B441G979':'IWDE.AS','FR0013416716':'GOLD.AS','IE00BJK55C48':'EHYA.MI',
  'IE00BP3QZB59':'IWVL.AS','IE00B53L3W79':'EXW1.DE','LU1781541179':'AMUS.PA',
  'LU1437016972':'LCWD.MI','IE00BJ0KDQ92':'XDWD.DE','IE00BL25JM42':'XDEV.DE',
  'LU0478205379':'XBLC.DE','LU0908500753':'MEUD.PA','IE00B6R52259':'IUSQ.DE',
  'IE00BGSF1X88':'IB01.AS','IE00B3RBWM25':'VWRL.AS','IE00B3YCGJ38':'SPXS.MI',
  'IE0031442068':'CSP1.AS','IE0005042456':'ISF.L','IE00BFMXXD54':'VUSA.AS',
  'IE00BZ043R46':'AGGH.AS','IE00B6YXC331':'SSAC.AS','IE00B44Z5B48':'SPYX.DE',
}

def main():
    print(f"Connessione a Railway PostgreSQL...")
    conn = psycopg2.connect(DB_URL, sslmode='require', connect_timeout=15)
    cur = conn.cursor()
    print("Connesso!")

    aggiornati = 0
    non_trovati = 0

    for isin, ticker in ISIN_TICKER_MAP.items():
        cur.execute(
            "UPDATE etf_catalog SET ticker_yahoo = %s WHERE isin = %s",
            [ticker, isin]
        )
        if cur.rowcount > 0:
            aggiornati += 1
        else:
            non_trovati += 1

    conn.commit()
    cur.close()
    conn.close()

    print(f"\nCompletato!")
    print(f"  Ticker aggiornati: {aggiornati}")
    print(f"  ISIN non trovati nel catalogo: {non_trovati}")
    print(f"\nOra l'aggiornamento prezzi alle 18:00 funzionerà per {aggiornati} ETF.")
    print(f"Puoi anche forzare l'aggiornamento manuale dall'app.")

if __name__ == "__main__":
    main()
