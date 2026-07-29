import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StandalonePreviewApp } from './components/StandalonePreviewApp';
import { runEngineSelfTest } from './engine-core/selftest';
import { EditorAppearanceProvider } from './core/editorAppearance';
import './styles.css';
import './save-games.css';
import './design-system/tokens.css';
import './design-system/motion.css';
import './design-system/components.css';
import './design-system/project-launch.css';

const engineTestRequested = new URLSearchParams(window.location.search).has('engine-test');
if (import.meta.env.DEV || engineTestRequested) window.__HIKARI_RUNTIME_SELF_TEST__ = runEngineSelfTest;
if (engineTestRequested) document.documentElement.dataset.engineSelfTest = JSON.stringify(runEngineSelfTest());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>{new URLSearchParams(window.location.search).has('preview') ? <StandalonePreviewApp /> : <EditorAppearanceProvider><App /></EditorAppearanceProvider>}</ErrorBoundary>
  </React.StrictMode>,
);
