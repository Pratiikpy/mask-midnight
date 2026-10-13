import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Register the service worker.
//
// Only in a production build: in dev, a worker caching the shell fights Vite's
// hot reload and serves yesterday's module graph, which costs an hour of
// debugging a change that did land.
//
// The worker is what makes the app installable on a phone. It caches the shell
// and nothing else — see public/sw.js for what it deliberately will not touch.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e: unknown) => {
      // Not fatal: the app works without it, minus offline and install.
      console.warn('service worker registration failed', e);
    });
  });
}
