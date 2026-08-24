import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StandalonePreviewApp } from './components/StandalonePreviewApp';
import { BlockConformancePreviewApp } from './components/BlockConformancePreviewApp';
import { runEngineSelfTest } from './engine-core/selftest';
import { getBlockConformanceCase } from './engine-core/blockConformance';
import { EditorAppearanceProvider } from './core/editorAppearance';
import { installGlobalErrorCapture } from './core/logger';
import './styles.css';
import './save-games.css';
import './design-system/tokens.css';
import './design-system/motion.css';
import './design-system/components.css';
import './design-system/controls.css';
import './design-system/project-launch.css';

installGlobalErrorCapture();

const engineTestRequested = new URLSearchParams(window.location.search).has('engine-test');
const blockConformanceCase = getBlockConformanceCase(new URLSearchParams(window.location.search).get('block-conformance'));
if (import.meta.env.DEV || engineTestRequested) window.__SLIDE_RUNTIME_SELF_TEST__ = runEngineSelfTest;
if (engineTestRequested) document.documentElement.dataset.engineSelfTest = JSON.stringify(runEngineSelfTest());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>{blockConformanceCase
      ? <BlockConformancePreviewApp testCase={blockConformanceCase} />
      : new URLSearchParams(window.location.search).has('preview')
        ? <StandalonePreviewApp />
        : <EditorAppearanceProvider><App /></EditorAppearanceProvider>}</ErrorBoundary>
  </React.StrictMode>,
);
