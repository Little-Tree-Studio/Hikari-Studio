import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StandalonePreviewApp } from './components/StandalonePreviewApp';
import { runEngineSelfTest } from './engine-core/selftest';
import './styles.css';
import './save-games.css';

const engineTestRequested = new URLSearchParams(window.location.search).has('engine-test');
if (import.meta.env.DEV || engineTestRequested) window.__HIKARI_RUNTIME_SELF_TEST__ = runEngineSelfTest;
if (engineTestRequested) document.documentElement.dataset.engineSelfTest = JSON.stringify(runEngineSelfTest());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>{new URLSearchParams(window.location.search).has('preview') ? <StandalonePreviewApp /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
