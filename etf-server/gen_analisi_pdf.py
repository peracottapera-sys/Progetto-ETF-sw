#!/usr/bin/env python3
"""
gen_analisi_pdf.py — genera PDF analisi portafoglio ETF
Argomenti: python3 gen_analisi_pdf.py <json_input_path> <output_pdf_path>
"""
import sys, json
sys.stdout.reconfigure(encoding='utf-8')

from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm

def semaforo_color(stato):
    s = (stato or '').upper()
    if s == 'VERDE': return colors.HexColor('#22c55e')
    if s == 'GIALLO': return colors.HexColor('#f59e0b')
    if s == 'ROSSO': return colors.HexColor('#ef4444')
    return colors.HexColor('#6b7280')

def build_pdf(data, out_path):
    portfolio = data.get('portfolio', {})
    semafori = data.get('semafori', {})
    punti_chiave = data.get('puntiChiave', [])
    analisi_lunga = data.get('analisiDettagliata', '')
    modifiche = data.get('modifiche', [])
    etf_selezionati = [e for e in portfolio.get('etfs', []) if e.get('selected')]

    DARK  = colors.HexColor('#1a1a2e')
    GOLD  = colors.HexColor('#d4af37')
    GRAY  = colors.HexColor('#6b7280')
    LIGHT = colors.HexColor('#f8fafc')
    GREEN = colors.HexColor('#22c55e')
    RED   = colors.HexColor('#ef4444')

    doc = SimpleDocTemplate(out_path, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=18*mm)

    title_s  = ParagraphStyle('T',  fontName='Helvetica-Bold',   fontSize=20, textColor=DARK,  spaceAfter=4)
    sub_s    = ParagraphStyle('S',  fontName='Helvetica',        fontSize=11, textColor=GRAY,  spaceAfter=12)
    h2_s     = ParagraphStyle('H2', fontName='Helvetica-Bold',   fontSize=13, textColor=DARK,  spaceBefore=12, spaceAfter=6)
    body_s   = ParagraphStyle('B',  fontName='Helvetica',        fontSize=10, textColor=DARK,  leading=15, spaceAfter=3)
    bullet_s = ParagraphStyle('BU', fontName='Helvetica',        fontSize=10, textColor=DARK,  leading=15, leftIndent=12, spaceAfter=3)
    small_s  = ParagraphStyle('SM', fontName='Helvetica',        fontSize=8,  textColor=GRAY)
    sem_lbl_s= ParagraphStyle('SL', fontName='Helvetica-Bold',   fontSize=9,  textColor=DARK)

    import datetime
    oggi = datetime.date.today().strftime('%d/%m/%Y')

    story = []

    # ── HEADER ──
    story.append(Paragraph('Analisi AI Portafoglio', title_s))
    story.append(Paragraph(
        f"{portfolio.get('name','—')} &nbsp;|&nbsp; Profilo: {portfolio.get('riskProfile','—')} &nbsp;|&nbsp; {oggi}",
        sub_s))
    story.append(HRFlowable(width='100%', thickness=1.5, color=GOLD, spaceAfter=14))

    # ── SEMAFORI ──
    SEM_LABELS = {
        'diversificazione': 'Diversificazione',
        'volatilita':       'Volatilita / Rischio',
        'drawdown':         'Max Drawdown',
        'ter':              'Costi (TER)',
        'azionario':        'Quota Azionaria',
    }
    if semafori:
        story.append(Paragraph('Valutazione per Area', h2_s))
        rows = []
        for key, lbl in SEM_LABELS.items():
            if key not in semafori: continue
            s = semafori[key]
            stato   = s.get('stato','') if isinstance(s, dict) else str(s)
            comment = s.get('commento','') if isinstance(s, dict) else ''
            col = semaforo_color(stato)
            rows.append([
                Paragraph(f'<font color="{col.hexval()}">&#9679;</font>', body_s),
                Paragraph(lbl, sem_lbl_s),
                Paragraph(f'<font color="{col.hexval()}"><b>{stato.upper()}</b></font>', body_s),
                Paragraph(comment[:80], small_s),
            ])
        if rows:
            t = Table(rows, colWidths=[10*mm, 48*mm, 22*mm, None])
            t.setStyle(TableStyle([
                ('VALIGN',        (0,0), (-1,-1), 'MIDDLE'),
                ('ROWBACKGROUNDS',(0,0), (-1,-1), [LIGHT, colors.white]),
                ('BOTTOMPADDING', (0,0), (-1,-1), 5),
                ('TOPPADDING',    (0,0), (-1,-1), 5),
                ('LEFTPADDING',   (0,0), (-1,-1), 4),
            ]))
            story.append(t)
            story.append(Spacer(1, 10))

    # ── PUNTI CHIAVE ──
    if punti_chiave:
        story.append(Paragraph('Punti Chiave', h2_s))
        for p in punti_chiave:
            story.append(Paragraph(f'• {p}', bullet_s))
        story.append(Spacer(1, 8))

    # ── ANALISI DETTAGLIATA ──
    story.append(HRFlowable(width='100%', thickness=0.5, color=GRAY, spaceAfter=10))
    story.append(Paragraph('Analisi Dettagliata', h2_s))
    for line in analisi_lunga.split('\n'):
        line = line.strip()
        if not line:
            story.append(Spacer(1, 4))
            continue
        if line.startswith('## ') or line.startswith('# '):
            story.append(Paragraph(line.lstrip('# '), h2_s))
        elif line.startswith('- ') or line.startswith('* '):
            story.append(Paragraph('• ' + line[2:], bullet_s))
        elif line.startswith('---'):
            story.append(HRFlowable(width='100%', thickness=0.3, color=GRAY, spaceAfter=4))
        else:
            # Converti **bold** in tag reportlab
            import re
            line = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', line)
            story.append(Paragraph(line, body_s))

    # ── TABELLA ETF ──
    if etf_selezionati:
        story.append(Spacer(1, 10))
        story.append(HRFlowable(width='100%', thickness=0.5, color=GRAY, spaceAfter=10))
        story.append(Paragraph('ETF in Portafoglio', h2_s))
        hdr = ['ETF', 'ISIN', 'Categoria', 'TER', 'Perf.1A', 'Perf.5A', 'Vol.1A']
        rows2 = [[Paragraph(f'<b>{h}</b>', small_s) for h in hdr]]
        for e in etf_selezionati:
            rows2.append([
                Paragraph((e.get('name','') or '')[:35], small_s),
                Paragraph(e.get('isin',''), small_s),
                Paragraph((e.get('categoria','') or '')[:20], small_s),
                Paragraph(f"{e.get('ter',0):.2f}%", small_s),
                Paragraph(f"{e.get('perf1y',0):.1f}%", small_s),
                Paragraph(f"{e.get('perf5y',0):.1f}%", small_s),
                Paragraph(f"{e.get('variabilita',0):.1f}%", small_s),
            ])
        t2 = Table(rows2, colWidths=[55*mm, 28*mm, 35*mm, 14*mm, 15*mm, 15*mm, 14*mm])
        t2.setStyle(TableStyle([
            ('BACKGROUND',    (0,0), (-1,0), DARK),
            ('TEXTCOLOR',     (0,0), (-1,0), colors.white),
            ('ROWBACKGROUNDS',(0,1), (-1,-1), [LIGHT, colors.white]),
            ('FONTSIZE',      (0,0), (-1,-1), 7.5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('TOPPADDING',    (0,0), (-1,-1), 4),
            ('GRID',          (0,0), (-1,-1), 0.25, GRAY),
        ]))
        story.append(t2)

    # ── MODIFICHE CONSIGLIATE ──
    if modifiche:
        story.append(Spacer(1, 10))
        story.append(HRFlowable(width='100%', thickness=0.5, color=GRAY, spaceAfter=10))
        story.append(Paragraph('Modifiche Consigliate', h2_s))
        for m in modifiche:
            azione = m.get('azione','')
            col_a = GREEN if azione in ['seleziona','aggiungi'] else RED
            symbol = '+' if azione in ['seleziona','aggiungi'] else '-'
            story.append(Paragraph(
                f'<font color="{col_a.hexval()}"><b>{symbol} {azione.upper()}</b></font> '
                f'&nbsp; {m.get("isin","")} &nbsp;— {m.get("motivo","")}',
                bullet_s))

    # ── FOOTER ──
    story.append(Spacer(1, 14))
    story.append(HRFlowable(width='100%', thickness=0.5, color=GRAY, spaceAfter=6))
    story.append(Paragraph(
        'Analisi generata da AI — non costituisce consulenza finanziaria regolamentata. '
        'Le performance passate non garantiscono risultati futuri.',
        small_s))

    doc.build(story)
    print(f'OK:{out_path}')

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Uso: python3 gen_analisi_pdf.py <input.json> <output.pdf>')
        sys.exit(1)
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        data = json.load(f)
    build_pdf(data, sys.argv[2])
