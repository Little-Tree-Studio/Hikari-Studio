import React from 'react';
import ReactDOM from 'react-dom/client';
import type { Project } from '../types';
import { GameRuntime } from './GameRuntime';
import { getBlockConformanceCase } from '../engine-core/blockConformance';
import '../styles.css';
import '../save-games.css';
import './runtime.css';

declare global {
  interface Window { SLIDE_PROJECT?: Project }
}

const root = document.getElementById('game-root');
if (!root) throw new Error('Slide runtime root is missing');

const conformanceCase = getBlockConformanceCase(new URLSearchParams(window.location.search).get('block-conformance'));
const project = conformanceCase?.project ?? window.SLIDE_PROJECT;
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {project ? <GameRuntime project={project} conformanceCaseId={conformanceCase?.id} /> : <main className="runtime-fatal"><strong>游戏数据加载失败</strong><span>project.js 未提供 SLIDE_PROJECT。</span></main>}
  </React.StrictMode>,
);
