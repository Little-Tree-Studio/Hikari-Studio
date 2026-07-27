import { describe, expect, it } from 'vitest';
import type { Project } from '../../types';
import { simulateProjectBranches } from '../simulation';
import { BranchSimulationRunner, branchSimulationFingerprint } from '../simulationRunner';
import { testProject } from './fixtures';

class FakeSimulationWorker {
  static created = 0;
  static terminated = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  constructor(private readonly respond = true) { FakeSimulationWorker.created += 1; }
  postMessage(message: { id: string; project: Project; request: Record<string, unknown> }) {
    if (!this.respond) return;
    queueMicrotask(() => {
      const result = simulateProjectBranches(message.project, message.request, { onProgress: (progress) => this.onmessage?.({ data: { id: message.id, type: 'progress', progress } } as MessageEvent) });
      this.onmessage?.({ data: { id: message.id, type: 'result', result } } as MessageEvent);
    });
  }
  terminate() { FakeSimulationWorker.terminated += 1; }
}

describe('branch simulation worker runner', () => {
  it('reports progress and reuses a fingerprinted cached result', async () => {
    FakeSimulationWorker.created = 0;
    FakeSimulationWorker.terminated = 0;
    const runner = new BranchSimulationRunner(() => new FakeSimulationWorker() as unknown as Worker);
    const project = testProject({ start: [{ id: 'line', type: 'narration', text: 'hello' }] });
    const progress: number[] = [];
    const first = await runner.run(project, {}, { onProgress: (item) => progress.push(item.percent) });
    const second = await runner.run(project);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.result).toEqual(first.result);
    expect(progress.at(-1)).toBe(100);
    expect(FakeSimulationWorker.created).toBe(1);
    expect(FakeSimulationWorker.terminated).toBe(1);
  });

  it('invalidates the cache when project content changes', async () => {
    FakeSimulationWorker.created = 0;
    const runner = new BranchSimulationRunner(() => new FakeSimulationWorker() as unknown as Worker);
    const project = testProject({ start: [{ id: 'line', type: 'narration', text: 'before' }] });
    const before = branchSimulationFingerprint(project);
    await runner.run(project);
    project.scripts.start[0] = { ...project.scripts.start[0], text: 'after' };
    expect(branchSimulationFingerprint(project)).not.toBe(before);
    expect((await runner.run(project)).cacheHit).toBe(false);
    expect(FakeSimulationWorker.created).toBe(2);
  });

  it('terminates the worker immediately when aborted', async () => {
    FakeSimulationWorker.terminated = 0;
    const runner = new BranchSimulationRunner(() => new FakeSimulationWorker(false) as unknown as Worker);
    const controller = new AbortController();
    const running = runner.run(testProject({ start: [] }), {}, { signal: controller.signal });
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeSimulationWorker.terminated).toBe(1);
  });
});
