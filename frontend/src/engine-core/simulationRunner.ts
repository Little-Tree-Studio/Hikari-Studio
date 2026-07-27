import type { Project } from '../types';
import type { BranchSimulationExecution, BranchSimulationProgress, BranchSimulationRequest, BranchSimulationResult } from './types';

const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 8;

interface CacheEntry { createdAt: number; result: BranchSimulationResult }
interface RunOptions { signal?: AbortSignal; onProgress?: (progress: BranchSimulationProgress) => void; bypassCache?: boolean }
interface WorkerResponse { id: string; type: 'progress' | 'result' | 'error'; progress?: BranchSimulationProgress; result?: BranchSimulationResult; message?: string }
type WorkerFactory = () => Worker;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function fastHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function branchSimulationFingerprint(project: Project, request: BranchSimulationRequest = {}): string {
  const relevant = {
    version: project.version, activeFragmentId: project.activeFragmentId, chapters: project.chapters, scripts: project.scripts, variables: project.variables,
    variableDefinitions: project.variableDefinitions, characters: project.characters, scenes: project.scenes, assets: project.assets,
    request,
  };
  return fastHash(stableStringify(relevant));
}

const abortError = () => new DOMException('全分支模拟已取消', 'AbortError');

export class BranchSimulationRunner {
  private readonly cache = new Map<string, CacheEntry>();
  constructor(private readonly workerFactory: WorkerFactory = () => new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module', name: 'hikari-branch-simulation' })) {}

  clearCache() { this.cache.clear(); }

  async run(project: Project, request: BranchSimulationRequest = {}, options: RunOptions = {}): Promise<BranchSimulationExecution> {
    if (options.signal?.aborted) throw abortError();
    const projectFingerprint = branchSimulationFingerprint(project, request);
    const cached = this.cache.get(projectFingerprint);
    if (!options.bypassCache && cached && Date.now() - cached.createdAt <= CACHE_TTL_MS) {
      this.cache.delete(projectFingerprint);
      this.cache.set(projectFingerprint, cached);
      options.onProgress?.({ phase: 'completed', completedPaths: cached.result.pathCount, queuedPaths: 0, scenarioCount: cached.result.scenarioCount, stepsExecuted: cached.result.paths.reduce((sum, path) => sum + path.steps, 0), percent: 100 });
      return { result: structuredClone(cached.result), cacheHit: true, projectFingerprint };
    }
    if (cached) this.cache.delete(projectFingerprint);

    return new Promise<BranchSimulationExecution>((resolve, reject) => {
      const worker = this.workerFactory();
      const id = crypto.randomUUID();
      let settled = false;
      const cleanup = () => { options.signal?.removeEventListener('abort', onAbort); worker.terminate(); };
      const finish = (callback: () => void) => { if (settled) return; settled = true; cleanup(); callback(); };
      const onAbort = () => finish(() => reject(abortError()));
      options.signal?.addEventListener('abort', onAbort, { once: true });
      worker.onerror = (event) => finish(() => reject(new Error(event.message || '全分支模拟 Worker 执行失败')));
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.id !== id || settled) return;
        if (message.type === 'progress' && message.progress) { options.onProgress?.(message.progress); return; }
        if (message.type === 'error') { finish(() => reject(new Error(message.message || '全分支模拟失败'))); return; }
        if (message.type === 'result' && message.result) {
          this.cache.set(projectFingerprint, { createdAt: Date.now(), result: structuredClone(message.result) });
          while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
          finish(() => resolve({ result: message.result!, cacheHit: false, projectFingerprint }));
        }
      };
      try {
        worker.postMessage({ id, project, request });
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }
}

export const branchSimulationRunner = new BranchSimulationRunner();
