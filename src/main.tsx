import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { logHistory } from './app/data';
import './ui/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

window.addEventListener('unhandledrejection', (e) => void logHistory('app', 'unhandled', String(e.reason)).catch(() => undefined));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // A new version is offered on Home, never switched in under a session (audit task 15).
        const offer = (w: ServiceWorker | null) => {
          if (!w || !navigator.serviceWorker.controller) return;
          (window as unknown as { __waitingWorker?: ServiceWorker }).__waitingWorker = w;
          window.dispatchEvent(new CustomEvent('app-update', { detail: w }));
        };
        offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => w.state === 'installed' && offer(w));
        });
        // Reload only after the parent chose "Update now" (not on the very first install).
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if ((window as unknown as { __updating?: boolean }).__updating) location.reload();
        });
      })
      .catch(() => {
        /* offline support unavailable; the app still works online */
      });
  });
}
