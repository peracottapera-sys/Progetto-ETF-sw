import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import LoginPage from './pages/LoginPage';
import PortfolioSelector from './pages/PortfolioSelector';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Performance from './pages/Performance';
import { Settings, Report } from './pages/SettingsReport';
import Reports from './pages/Reports';
import AdminLogs from './pages/AdminLogs';
import AiRuns from './pages/AiRuns';

function AppInner() {
  const { currentUser, currentPortfolio } = useApp();
  const [activeTab, setActiveTab] = useState('dashboard');

  if (!currentUser) return <LoginPage />;
  if (!currentPortfolio) return <PortfolioSelector />;

  const pages = {
    dashboard: <Dashboard setActiveTab={setActiveTab} />,
    performance: <Performance />,
    report: <Report />,
    storico: <Reports />,
    settings: <Settings />,
    'ai-runs': <AiRuns />,
    logs: <AdminLogs />,
  };

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
      {pages[activeTab] || <Dashboard />}
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}