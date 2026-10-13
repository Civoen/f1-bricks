import { useMemo } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { demoBackend } from './demo/demoBackend';
import { apiBackend } from './lib/backend';
import { DEMO_MODE } from './lib/config';
import { CircuitDetail } from './pages/CircuitDetail';
import { Circuits } from './pages/Circuits';
import { Dashboard } from './pages/Dashboard';
import { DriverDetail } from './pages/DriverDetail';
import { History } from './pages/History';
import { LogLap } from './pages/LogLap';
import { Stats } from './pages/Stats';
import { DataProvider } from './state/data';

function Shell() {
  const backend = useMemo(() => (DEMO_MODE ? demoBackend() : apiBackend()), []);
  return (
    <DataProvider backend={backend}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="log" element={<LogLap />} />
          <Route path="circuits" element={<Circuits />} />
          <Route path="circuits/:slug" element={<CircuitDetail />} />
          <Route path="drivers/:slug" element={<DriverDetail />} />
          <Route path="history" element={<History />} />
          <Route path="stats" element={<Stats />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DataProvider>
  );
}

// Hash routing is only for static previews hosted without SPA rewrites;
// production on Cloudflare Pages uses normal URLs (see public/_redirects).
const Router = import.meta.env.VITE_HASH_ROUTER === 'true' ? HashRouter : BrowserRouter;

export function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Shell />
    </Router>
  );
}
