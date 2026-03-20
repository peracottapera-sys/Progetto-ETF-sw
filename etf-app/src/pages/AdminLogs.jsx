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
  const [expanded, setExpanded] = useState({});

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (filtroEvento) params.set('evento', filtroEvento);
      // Nota: filtri come 'AI_', '_PORTAFOGLIO', 'AGGIORNA_PREZZI' sono prefissi parziali
      if (filtroUtente) params.set('utente', filtroUtente);
      const res = await fetch(`${API}/api/admin/logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { fetchLogs(); }, [filtroEvento]);

  const fmtTs = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const fmtDettagli = (det) => {
    if (!det) return '';
    const obj = typeof det === 'string' ? JSON.parse(det) : det;
    return Object.entries(obj)
      .filter(([k]) => !['userId', 'password'].includes(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  };

  // Raggruppa per giorno
  const logPerGiorno = {};
  logs.forEach(l => {
    const giorno = new Date(l.ts).toLocaleDateString('it-IT');
    if (!logPerGiorno[giorno]) logPerGiorno[giorno] = [];
    logPerGiorno[giorno].push(l);
  });

  return (
    <div style={{ padding: '0 0 28px 0' }}>
      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', padding: '14px 28px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ fontFamily: 'DM Serif Display, serif', fontSize: 22, margin: 0 }}>📋 Log Attività</h2>
          <button onClick={fetchLogs} disabled={loading}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 12 }}>
            {loading ? '⏳' : '🔄 Aggiorna'}
          </button>
        </div>

        {/* Filtri */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {FILTRI_EVENTO.map(f => (
            <button key={f.value} onClick={() => setFiltroEvento(f.value)}
              style={{ padding: '4px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11,
                background: filtroEvento === f.value ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                color: filtroEvento === f.value ? '#fff' : 'var(--text-muted)', fontWeight: filtroEvento === f.value ? 600 : 400 }}>
              {f.label}
            </button>
          ))}
          <input placeholder="Filtra per utente..." value={filtroUtente}
            onChange={e => setFiltroUtente(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchLogs()}
            style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 11, width: 140 }} />
        </div>
      </div>

      <div style={{ padding: '16px 28px' }}>
        {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Caricamento...</div>}

        {!loading && logs.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            Nessun log trovato. I log vengono registrati man mano che l'app viene usata.
          </div>
        )}

        {Object.entries(logPerGiorno).map(([giorno, righe]) => (
          <div key={giorno} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
              {giorno} · {righe.length} eventi
            </div>

            {righe.map((l, i) => {
              const emoji = EVENTO_EMOJI[l.evento] || '•';
              const colore = EVENTO_COLORE[l.evento] || 'var(--text-secondary)';
              const det = typeof l.dettagli === 'string' ? JSON.parse(l.dettagli || '{}') : (l.dettagli || {});
              const isOpen = expanded[l.id];

              return (
                <div key={l.id} onClick={() => setExpanded(e => ({ ...e, [l.id]: !e[l.id] }))}
                  style={{ display: 'flex', gap: 10, padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                    marginBottom: 2, background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)',
                    border: '1px solid transparent', transition: 'border-color 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>

                  <span style={{ fontSize: 14, flexShrink: 0, width: 20 }}>{emoji}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: colore }}>{l.evento}</span>
                      {l.utente && l.utente !== '—' && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-primary)', padding: '1px 6px', borderRadius: 10 }}>
                          {l.utente}
                        </span>
                      )}
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {new Date(l.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: isOpen ? 'normal' : 'nowrap' }}>
                      {fmtDettagli(det)}
                    </div>

                    {isOpen && Object.keys(det).length > 0 && (
                      <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 6,
                        fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
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
        ))}

        {logs.length > 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
            Mostrati {logs.length} eventi · max 200 per pagina · clicca su una riga per espandere i dettagli
          </div>
        )}
      </div>
    </div>
  );
}
