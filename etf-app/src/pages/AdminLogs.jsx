import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

const API = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

const EVENTO_EMOJI = {
  LOGIN: '🔐', LOGOUT: '🚪', REGISTER: '👤',
  CREA_PORTAFOGLIO: '📁', ELIMINA_PORTAFOGLIO: '🗑️', MODIFICA_PORTAFOGLIO: '✏️',
  ACQUISTO: '🛒', VENDITA: '💰', ELIMINA_ACQUISTO: '↩️', ANNULLA_VENDITA: '↩️',
  AI_ANALISI: '🤖', AI_CREA_PORTAFOGLIO: '✨', AI_APPLICA: '✅',
  AGGIORNA_PREZZI_MANUALE: '🔄', AGGIORNA_PREZZI_AUTO: '⏰', AGGIORNA_PREZZI_SELETTIVO: '🔄',
  SERVER_START: '🚀', SERVER_ERROR: '❌',
};

const EVENTO_COLORE = {
  LOGIN: 'var(--accent-blue)', REGISTER: 'var(--accent-blue)',
  CREA_PORTAFOGLIO: 'var(--accent-green)', ACQUISTO: 'var(--accent-green)', AI_APPLICA: 'var(--accent-green)',
  ELIMINA_PORTAFOGLIO: 'var(--accent-red)', VENDITA: 'var(--accent-amber)',
  AI_ANALISI: 'var(--accent-blue)', AI_CREA_PORTAFOGLIO: 'var(--accent-blue)',
  AGGIORNA_PREZZI_AUTO: 'var(--accent-amber)', AGGIORNA_PREZZI_SELETTIVO: 'var(--accent-amber)',
  SERVER_START: 'var(--accent-green)', SERVER_ERROR: 'var(--accent-red)',
};

const FILTRI_EVENTO = [
  { label: 'Tutti', value: '' },
  { label: '🤖 AI', value: 'AI_' },
  { label: '🛒 Acquisti', value: 'ACQUISTO' },
  { label: '💰 Vendite', value: 'VENDITA' },
  { label: '📁 Portafogli', value: '_PORTAFOGLIO' },
  { label: '🔄 Prezzi', value: 'AGGIORNA_PREZZI' },
  { label: '🔐 Auth', value: 'LOGIN' },
  { label: '🚀 Sistema', value: 'SERVER_' },
];

export default function AdminLogs() {
  const { token } = useApp();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtroEvento, setFiltroEvento] = useState('');
  const [filtroUtente, setFiltroUtente] = useState('');
  const [expandedRows, setExpandedRows] = useState({});
  const [openDays, setOpenDays] = useState({});         // accordion giorni — tutti chiusi di default
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  const authHdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const fetchLogs = async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ limit: 500 });
      if (filtroEvento) params.set('evento', filtroEvento);
      if (filtroUtente) params.set('utente', filtroUtente);
      const res = await fetch(`${API}/api/admin/logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setLogs(data.logs || []);
      setOpenDays({});        // tutti i giorni chiusi al caricamento
      setExpandedRows({});
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { fetchLogs(); }, [filtroEvento]);

  // ── Selezione riga ────────────────────────────────────────────────────
  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    setSelected(selected.size === logs.length ? new Set() : new Set(logs.map(l => l.id)));
  };

  // Seleziona/deseleziona tutte le righe di un giorno
  const toggleSelectDay = (righe, e) => {
    e.stopPropagation();
    const ids = righe.map(l => l.id);
    const tuttiSel = ids.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (tuttiSel) ids.forEach(id => n.delete(id));
      else ids.forEach(id => n.add(id));
      return n;
    });
  };

  // ── Accordion ─────────────────────────────────────────────────────────
  const toggleDay = (giorno) => setOpenDays(d => ({ ...d, [giorno]: !d[giorno] }));

  // ── Elimina ───────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Eliminare ${selected.size} log selezionati?`)) return;
    setDeleting(true);
    try {
      await fetch(`${API}/api/admin/logs`, {
        method: 'DELETE', headers: authHdr,
        body: JSON.stringify({ ids: [...selected] }),
      });
      setSelected(new Set());
      await fetchLogs();
    } catch {}
    finally { setDeleting(false); }
  };

  // ── Export CSV ────────────────────────────────────────────────────────
  const exportCSV = () => {
    const righe = selected.size > 0 ? logs.filter(l => selected.has(l.id)) : logs;
    const header = ['ID', 'Data', 'Ora', 'Evento', 'Utente', 'Dettagli'];
    const rows = righe.map(l => {
      const d   = new Date(l.ts);
      const det = typeof l.dettagli === 'string' ? JSON.parse(l.dettagli || '{}') : (l.dettagli || {});
      const detStr = Object.entries(det)
        .filter(([k]) => k !== 'password')
        .map(([k, v]) => `${k}=${v}`).join(' | ');
      return [
        l.id,
        d.toLocaleDateString('it-IT'),
        d.toLocaleTimeString('it-IT'),
        l.evento,
        l.utente || '—',
        detStr,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv  = [header.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `log_etf_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Helper dettagli ───────────────────────────────────────────────────
  const fmtDettagli = (det) => {
    if (!det) return '';
    const obj = typeof det === 'string' ? JSON.parse(det) : det;
    return Object.entries(obj)
      .filter(([k]) => !['userId', 'password'].includes(k))
      .map(([k, v]) => `${k}: ${v}`).join(' · ');
  };

  // ── Raggruppa per giorno ──────────────────────────────────────────────
  const logPerGiorno = {};
  logs.forEach(l => {
    const g = new Date(l.ts).toLocaleDateString('it-IT');
    if (!logPerGiorno[g]) logPerGiorno[g] = [];
    logPerGiorno[g].push(l);
  });

  return (
    <div style={{ padding: '0 0 28px 0' }}>

      {/* ── Toolbar sticky ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border)', padding: '14px 28px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ fontFamily: 'DM Serif Display, serif', fontSize: 22, margin: 0 }}>📋 Log Attività</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selected.size > 0 && (
              <>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selected.size} selezionati</span>
                <button onClick={handleDelete} disabled={deleting}
                  style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-red)',
                    color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {deleting ? '⏳' : '🗑️ Elimina'}
                </button>
              </>
            )}
            <button onClick={exportCSV}
              title={selected.size > 0 ? `Esporta ${selected.size} selezionati` : 'Esporta tutti i log visibili'}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 12 }}>
              📥 {selected.size > 0 ? `CSV (${selected.size})` : 'CSV'}
            </button>
            <button onClick={fetchLogs} disabled={loading}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 12 }}>
              {loading ? '⏳' : '🔄 Aggiorna'}
            </button>
          </div>
        </div>

        {/* Filtri */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {logs.length > 0 && (
            <button onClick={toggleSelectAll}
              style={{ padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11,
                background: selected.size === logs.length ? 'rgba(239,68,68,0.15)' : 'var(--bg-secondary)',
                color: selected.size === logs.length ? 'var(--accent-red)' : 'var(--text-muted)' }}>
              {selected.size === logs.length ? '☑ Deseleziona tutti' : '☐ Seleziona tutti'}
            </button>
          )}
          {FILTRI_EVENTO.map(f => (
            <button key={f.value} onClick={() => setFiltroEvento(f.value)}
              style={{ padding: '4px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11,
                background: filtroEvento === f.value ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                color: filtroEvento === f.value ? '#fff' : 'var(--text-muted)',
                fontWeight: filtroEvento === f.value ? 600 : 400 }}>
              {f.label}
            </button>
          ))}
          <input placeholder="Filtra per utente..." value={filtroUtente}
            onChange={e => setFiltroUtente(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchLogs()}
            style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 11, width: 140 }} />
        </div>
      </div>

      {/* ── Lista giorni ── */}
      <div style={{ padding: '16px 28px' }}>
        {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Caricamento...</div>}
        {!loading && logs.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Nessun log trovato.</div>
        )}

        {Object.entries(logPerGiorno).map(([giorno, righe]) => {
          const isOpen       = !!openDays[giorno];
          const ids          = righe.map(l => l.id);
          const nSel         = ids.filter(id => selected.has(id)).length;
          const tuttiSel     = nSel === ids.length;
          const parzSel      = nSel > 0 && !tuttiSel;

          return (
            <div key={giorno} style={{ marginBottom: 6 }}>

              {/* ── Testata giorno ── */}
              <div onClick={() => toggleDay(giorno)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  borderRadius: isOpen ? '8px 8px 0 0' : 8,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  cursor: 'pointer', userSelect: 'none' }}>

                {/* Chevron */}
                <span style={{ fontSize: 10, color: 'var(--text-muted)', transition: 'transform 0.15s',
                  transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', width: 10 }}>▶</span>

                {/* Checkbox giorno */}
                <div onClick={e => toggleSelectDay(righe, e)}
                  style={{ flexShrink: 0, width: 15, height: 15, borderRadius: 3, cursor: 'pointer',
                    border: `2px solid ${tuttiSel ? 'var(--accent-red)' : parzSel ? 'var(--accent-amber)' : 'var(--border)'}`,
                    background: tuttiSel ? 'var(--accent-red)' : parzSel ? 'rgba(251,191,36,0.25)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {tuttiSel && <span style={{ color: '#fff', fontSize: 8, fontWeight: 700 }}>✓</span>}
                  {parzSel  && <span style={{ color: 'var(--accent-amber)', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>−</span>}
                </div>

                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{giorno}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{righe.length} eventi</span>

                {nSel > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--accent-red)',
                    background: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                    {nSel} selezionati
                  </span>
                )}
              </div>

              {/* ── Righe del giorno ── */}
              {isOpen && (
                <div style={{ border: '1px solid var(--border)', borderTop: 'none',
                  borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
                  {righe.map((l, i) => {
                    const emoji     = EVENTO_EMOJI[l.evento] || '•';
                    const colore    = EVENTO_COLORE[l.evento] || 'var(--text-secondary)';
                    const det       = typeof l.dettagli === 'string' ? JSON.parse(l.dettagli || '{}') : (l.dettagli || {});
                    const isRowOpen = !!expandedRows[l.id];
                    const isSel     = selected.has(l.id);

                    return (
                      <div key={l.id}
                        onClick={() => setExpandedRows(e => ({ ...e, [l.id]: !e[l.id] }))}
                        style={{ display: 'flex', gap: 8, padding: '6px 10px', cursor: 'pointer',
                          background: isSel ? 'rgba(239,68,68,0.07)' : i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.03)',
                          borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                          borderLeft: `3px solid ${isSel ? 'var(--accent-red)' : 'transparent'}`,
                          transition: 'background 0.1s' }}
                        onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                        onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.03)'; }}>

                        {/* Checkbox riga */}
                        <div onClick={e => toggleSelect(l.id, e)}
                          style={{ flexShrink: 0, width: 15, height: 15, marginTop: 3, borderRadius: 3,
                            border: `2px solid ${isSel ? 'var(--accent-red)' : 'var(--border)'}`,
                            background: isSel ? 'var(--accent-red)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          {isSel && <span style={{ color: '#fff', fontSize: 8, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                        </div>

                        <span style={{ fontSize: 14, flexShrink: 0, width: 20 }}>{emoji}</span>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: colore }}>{l.evento}</span>
                            {l.utente && l.utente !== '—' && (
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-primary)',
                                padding: '1px 6px', borderRadius: 10 }}>
                                {l.utente}
                              </span>
                            )}
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                              {new Date(l.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: isRowOpen ? 'normal' : 'nowrap' }}>
                            {fmtDettagli(det)}
                          </div>
                          {isRowOpen && Object.keys(det).length > 0 && (
                            <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--bg-primary)',
                              borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                              {Object.entries(det).filter(([k]) => k !== 'password').map(([k, v]) => (
                                <div key={k}><span style={{ color: 'var(--accent-gold)' }}>{k}:</span> {String(v)}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {logs.length > 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12 }}>
            {logs.length} eventi · clicca testata per aprire/chiudere il giorno · checkbox testata per selezionare tutto il giorno · 📥 CSV esporta selezionati o tutti
          </div>
        )}
      </div>
    </div>
  );
}
