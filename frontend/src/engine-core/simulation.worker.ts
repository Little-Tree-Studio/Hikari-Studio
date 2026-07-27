/// <reference lib="webworker" />

import type { Project } from '../types';
import { simulateProjectBranches } from './simulation';
import type { BranchSimulationProgress, BranchSimulationRequest, BranchSimulationResult } from './types';

interface SimulationWorkerRequest { id: string; project: Project; request: BranchSimulationRequest }
type SimulationWorkerResponse =
  | { id: string; type: 'progress'; progress: BranchSimulationProgress }
  | { id: string; type: 'result'; result: BranchSimulationResult }
  | { id: string; type: 'error'; message: string };

const worker = self as DedicatedWorkerGlobalScope;
worker.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  const { id, project, request } = event.data;
  try {
    const result = simulateProjectBranches(project, request, {
      onProgress: (progress) => worker.postMessage({ id, type: 'progress', progress } satisfies SimulationWorkerResponse),
    });
    worker.postMessage({ id, type: 'result', result } satisfies SimulationWorkerResponse);
  } catch (error) {
    worker.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies SimulationWorkerResponse);
  }
};

export {};
