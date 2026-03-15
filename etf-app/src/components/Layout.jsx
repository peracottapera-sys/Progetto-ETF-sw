import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

const NavIcon = ({ d }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export default function Layout({ children, activeTab, setActiveTab }) {
  const { currentUser, currentPortfolio, selectPortfolio, logout } = useApp();
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Portafoglio', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z' },
    { id: 'performance', label: 'Performance', icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
    { id: 'report', label: 'Report', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8' },
    { id: 'storico', label: 'Storico Op.', icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 0-1-1v0M9 12h6M9 16h6' },
    { id: 'settings', label: 'Impostazioni', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
  ];

  const riskColors = { Prudente: '#10b981', Bilanciato: '#f59e0b', Aggressivo: '#ef4444' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <div style={{
        width: collapsed ? 64 : 220, minHeight: '100vh',
        background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', transition: 'width 0.25s ease',
        position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100
      }}>
        <div style={{
          padding: collapsed ? '20px 0' : '20px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, justifyContent: collapsed ? 'center' : 'flex-start'
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
            background: 'var(--accent-gold-dim)', border: '1px solid var(--border-strong)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-gold)" strokeWidth="1.5">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
          </div>
          {!collapsed && (
            <span style={{ fontFamily: 'DM Serif Display, serif', fontSize: 15, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              ETF Portfolio
            </span>
          )}
        </div>

        {!collapsed && currentPortfolio && (
          <div style={{
            margin: '12px 12px 4px', padding: '10px 12px',
            background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)'
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Portafoglio attivo
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4, wordBreak: 'break-word' }}>
              {currentPortfolio.name}
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
              background: `${riskColors[currentPortfolio.riskProfile]}22`,
              color: riskColors[currentPortfolio.riskProfile]
            }}>
              {currentPortfolio.riskProfile}
            </div>
          </div>
        )}

        <nav style={{ flex: 1, padding: '8px 8px' }}>
          {navItems.map(item => (
            <button key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                gap: collapsed ? 0 : 10, justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '10px' : '10px 12px', borderRadius: 8, border: 'none',
                background: activeTab === item.id ? 'var(--bg-elevated)' : 'transparent',
                color: activeTab === item.id ? 'var(--accent-gold)' : 'var(--text-secondary)',
                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 500,
                transition: 'all 0.15s', marginBottom: 2,
                borderLeft: activeTab === item.id ? '2px solid var(--accent-gold)' : '2px solid transparent'
              }}
              title={collapsed ? item.label : ''}
            >
              <NavIcon d={item.icon} />
              {!collapsed && item.label}
            </button>
          ))}
        </nav>

        <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border)' }}>
          {!collapsed && (
            <div style={{
              padding: '8px 12px', marginBottom: 8,
              background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)'
            }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>{currentUser.username}</div>
              {currentUser.email && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{currentUser.email}</div>}
            </div>
          )}
          <button onClick={() => selectPortfolio(null)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? 10 : '8px 12px', borderRadius: 8, border: 'none',
              background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
              fontSize: 12, fontFamily: 'DM Sans, sans-serif', marginBottom: 4
            }} title={collapsed ? 'Cambia portafoglio' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>
            {!collapsed && 'Cambia portafoglio'}
          </button>
          <button onClick={logout}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? 10 : '8px 12px', borderRadius: 8, border: 'none',
              background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
              fontSize: 12, fontFamily: 'DM Sans, sans-serif'
            }} title={collapsed ? 'Esci' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9"/>
            </svg>
            {!collapsed && 'Esci'}
          </button>
          <button onClick={() => setCollapsed(c => !c)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 8, marginTop: 8, borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer'
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ marginLeft: collapsed ? 64 : 220, flex: 1, transition: 'margin-left 0.25s ease', minHeight: '100vh' }}>
        {children}
      </div>
    </div>
  );
}