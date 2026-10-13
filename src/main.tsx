import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';

// Service worker: caches the app shell only and updates itself automatically.
// (Not registered in static hash-routed previews.)
if (import.meta.env.VITE_HASH_ROUTER !== 'true') registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
