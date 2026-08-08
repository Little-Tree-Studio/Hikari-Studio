import { describe, expect, it } from 'vitest';
import { EngineSeekCache, EngineTraceRestoreCache, restoreTraceState, seekEngine } from '../runtime';
import { testProject } from './fixtures';

const linearProject = () => testProject({
  start: [
    { id: 'scene-a', type: 'scene', assetId: 'background-a' },
    { id: 'set-flag', type: 'setVariable', variable: 'visited', value: true },
    { id: 'line-a', type: 'dialogue', speaker: 'Hero', text: 'First line' },
    { id: 'scene-b', type: 'scene', assetId: 'background-b' },
    { id: 'line-b', type: 'narration', text: 'Second line' },
    { id: 'scene-c', type: 'scene', assetId: 'background-c' },
    { id: 'line-c', type: 'narration', text: 'Third line' },
  ],
}, { visited: false });

describe('fragment seek snapshots', () => {
  it('returns detached states from an exact cached result', () => {
    const project = linearProject();
    const cache = new EngineSeekCache();
    const first = seekEngine(project, 'start', 4, cache);

    expect(first.instructionPointer).toBe(4);
    expect(first.variables.visited).toBe(true);
    expect(first.stage.backgroundAssetId).toBe('background-b');
    expect(first.executionTrace.map((entry) => entry.blockId)).toEqual(['scene-a', 'set-flag', 'line-a', 'scene-b', 'line-b']);
    first.variables.visited = false;
    first.stage.camera.x = 99;
    first.executionTrace.pop();

    const projectWithUpdatedEditorState = { ...project, settings: { ...project.settings, textSpeed: 60 } };
    const second = seekEngine(projectWithUpdatedEditorState, 'start', 4, cache);
    expect(second.variables.visited).toBe(true);
    expect(second.stage.camera.x).toBe(0);
    expect(second.executionTrace.map((entry) => entry.blockId)).toEqual(['scene-a', 'set-flag', 'line-a', 'scene-b', 'line-b']);
    const restored = restoreTraceState(second, 2);
    expect(restored.instructionPointer).toBe(2);
    expect(restored.stage.backgroundAssetId).toBe('background-a');
    expect(restored.variables.visited).toBe(true);
    expect(cache.stats()).toMatchObject({ exactHits: 1, misses: 1, invalidations: 0 });
  });

  it('continues a later seek from the nearest fragment checkpoint', () => {
    const project = linearProject();
    const cache = new EngineSeekCache();

    seekEngine(project, 'start', 4, cache);
    const later = seekEngine(project, 'start', 6, cache);

    expect(later.instructionPointer).toBe(6);
    expect(later.stage.backgroundAssetId).toBe('background-c');
    expect(later.executionTrace.at(-1)?.blockId).toBe('line-c');
    expect(cache.stats()).toMatchObject({ exactHits: 0, checkpointHits: 1, misses: 2 });
  });

  it('invalidates fragment snapshots when project execution inputs change', () => {
    const project = linearProject();
    const cache = new EngineSeekCache();
    expect(seekEngine(project, 'start', 4, cache).stage.backgroundAssetId).toBe('background-b');

    project.scripts = {
      ...project.scripts,
      start: project.scripts.start.map((block) => block.id === 'scene-b' ? { ...block, assetId: 'background-replaced' } : block),
    };

    expect(seekEngine(project, 'start', 4, cache).stage.backgroundAssetId).toBe('background-replaced');
    project.variables = { ...project.variables, visited: true };
    seekEngine(project, 'start', 4, cache);
    expect(cache.stats()).toMatchObject({ exactHits: 0, misses: 3, invalidations: 1 });
  });

  it('stops an unreachable preview target at the first deterministic cycle', () => {
    const project = testProject({
      start: [
        { id: 'scene', type: 'scene', assetId: 'background' },
        { id: 'line', type: 'narration', text: 'Looping line' },
        { id: 'loop', type: 'jump', target: 'start' },
        { id: 'unreachable', type: 'narration', text: 'Never reached' },
      ],
    });

    const state = seekEngine(project, 'start', 3, new EngineSeekCache());
    expect(state.error).toContain('确定性循环');
    expect(state.stepsExecuted).toBeLessThan(20);
    expect(state.executionTrace.length).toBeLessThan(20);
  });

  it('bounds historical seek results with LRU eviction', () => {
    const project = testProject({
      start: Array.from({ length: 80 }, (_, index) => ({ id: `line-${index}`, type: 'narration' as const, text: `Line ${index}` })),
    });
    const cache = new EngineSeekCache();

    for (let index = 0; index < 80; index += 1) seekEngine(project, 'start', index, cache);
    expect(cache.stats()).toMatchObject({ misses: 80, exactHits: 0 });
    expect(cache.stats().evictions).toBeGreaterThan(0);

    seekEngine(project, 'start', 0, cache);
    expect(cache.stats().misses).toBe(81);
  });

  it('reuses structurally shared OP trace restores and bounds them with LRU eviction', () => {
    const project = testProject({
      start: Array.from({ length: 200 }, (_, index) => ({ id: `line-${index}`, type: 'narration' as const, text: `Line ${index}` })),
    });
    const state = seekEngine(project, 'start', 199, new EngineSeekCache());
    const cache = new EngineTraceRestoreCache();

    for (let index = 0; index < state.executionTrace.length; index += 1) cache.restore(state, index);
    expect(cache.stats()).toMatchObject({ misses: 200, exactHits: 0, cachedResults: 128, evictions: 72 });

    const restored = cache.restore(state, 199);
    expect(restored.instructionPointer).toBe(199);
    expect(restored.rollbackStack).toHaveLength(100);
    expect(cache.stats()).toMatchObject({ misses: 200, exactHits: 1, cachedResults: 128 });
  });

  it('preserves current shared variables without changing cached trace snapshots', () => {
    const project = linearProject();
    const state = seekEngine(project, 'start', 6, new EngineSeekCache());
    const cache = new EngineTraceRestoreCache();
    const current = { ...state, variables: { ...state.variables, sharedUnlock: true } };

    const first = cache.restore(current, 2, ['sharedUnlock']);
    const second = cache.restore({ ...current, variables: { ...current.variables, sharedUnlock: false } }, 2, ['sharedUnlock']);

    expect(first.variables.sharedUnlock).toBe(true);
    expect(second.variables.sharedUnlock).toBe(false);
    expect(cache.stats().exactHits).toBe(1);
  });
});
