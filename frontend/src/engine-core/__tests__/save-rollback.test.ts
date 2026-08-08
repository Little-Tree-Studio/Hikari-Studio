import { describe, expect, it } from 'vitest';
import type { SaveGame } from '../types';
import { advanceEngine, createEngineState, createSaveGame, currentBlock, loadSaveGame, loadSaveGameWithReport, rollbackEngine, SaveGameLoadError } from '../runtime';
import { testProject } from './fixtures';

function dialogueProject() {
  return testProject({
    start: [
      { id: 'line-one', type: 'narration', text: 'one' },
      { id: 'line-two', type: 'narration', text: 'two' },
    ],
  }, { route: 1, sharedUnlock: false }, {
    variableDefinitions: {
      route: { type: 'number', scope: 'project', persistence: 'slot' },
      sharedUnlock: { type: 'boolean', scope: 'project', persistence: 'shared' },
    },
  });
}

describe('save games and rollback', () => {
  it('creates an isolated save snapshot with history metadata', () => {
    const project = dialogueProject();
    const state = advanceEngine(project, createEngineState(project));
    const save = createSaveGame(project, state, 'quick', 'Quick save', { slotId: 'quick-1', playTimeSeconds: 12 });

    state.variables.route = 99;
    expect(save.state.variables.route).toBe(1);
    expect(save.slotType).toBe('quick');
    expect(save.slotId).toBe('quick-1');
    expect(save.historySummary).toEqual({ readCount: 1, backlogCount: 1 });
  });

  it('restores slot variables while preserving shared variables', () => {
    const project = dialogueProject();
    const state = advanceEngine(project, createEngineState(project));
    const save = createSaveGame(project, { ...state, variables: { route: 2, sharedUnlock: false } });
    const loaded = loadSaveGame(project, save, { route: 8, sharedUnlock: true });

    expect(loaded.variables.route).toBe(2);
    expect(loaded.variables.sharedUnlock).toBe(true);
    expect(loaded.rollbackStack).toEqual([]);
  });

  it('migrates engine v2 saves without trace fields', () => {
    const project = dialogueProject();
    const state = createEngineState(project);
    const current = createSaveGame(project, state);
    const legacyState = structuredClone(current.state) as Partial<typeof current.state>;
    delete legacyState.executionTrace;
    delete legacyState.traceCursor;
    const legacy = { ...current, engineVersion: 2, state: legacyState as SaveGame['state'] };

    const result = loadSaveGameWithReport(project, legacy);
    expect(result.state.executionTrace).toEqual([]);
    expect(result.state.traceCursor).toBe(-1);
    expect(result.migrated).toBe(true);
    expect(result.save.engineVersion).toBe(3);
    expect(result.save.migration).toMatchObject({ fromEngineVersion: 2, steps: ['engine-2-to-3'] });
  });

  it('migrates engine v1 stage and audio state into the current schema', () => {
    const project = dialogueProject();
    const current = createSaveGame(project, createEngineState(project));
    const legacyState = structuredClone(current.state) as unknown as Record<string, unknown>;
    legacyState.audio = { track: 'legacy-theme', volume: 0.4, loop: true };
    legacyState.stage = { backgroundAssetId: 'legacy-background' };
    delete legacyState.callStack;
    delete legacyState.readBlocks;
    delete legacyState.backlog;
    delete legacyState.rollbackStack;
    delete legacyState.stepsExecuted;
    delete legacyState.executionTrace;
    delete legacyState.traceCursor;
    const legacy = { ...current, engineVersion: 1, state: legacyState as unknown as SaveGame['state'] };

    const result = loadSaveGameWithReport(project, legacy);

    expect(result.migrated).toBe(true);
    expect(result.save.engineVersion).toBe(3);
    expect(result.save.migration).toMatchObject({ fromEngineVersion: 1, steps: ['engine-1-to-3'] });
    expect(result.state.stage).toMatchObject({ backgroundAssetId: 'legacy-background', characters: {}, sceneLayers: [] });
    expect(result.state.audio.bgm).toMatchObject({ track: 'legacy-theme', volume: 0.4, loop: true, playing: true });
    expect(result.state.audio.sfx.playing).toBe(false);
    expect(result.state.audio.voice.playing).toBe(false);
    expect(result.state.callStack).toEqual([]);
    expect(result.state.executionTrace).toEqual([]);
    expect(result.state.traceCursor).toBe(-1);
  });

  it('rejects foreign and future saves', () => {
    const project = dialogueProject();
    const save = createSaveGame(project, createEngineState(project));

    expect(() => loadSaveGame(project, { ...save, projectId: 'other-project' })).toThrow('属于其他游戏');
    expect(() => loadSaveGame(project, { ...save, engineVersion: 999 })).toThrow('高于当前版本');
  });

  it('provides stable error codes for project mismatch and future saves', () => {
    const project = dialogueProject();
    const save = createSaveGame(project, createEngineState(project));

    for (const [candidate, code] of [
      [{ ...save, projectId: 'other-project' }, 'PROJECT_MISMATCH'],
      [{ ...save, engineVersion: 999 }, 'FUTURE_ENGINE_VERSION'],
    ] as const) {
      try {
        loadSaveGame(project, candidate);
        throw new Error('Expected save loading to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(SaveGameLoadError);
        expect((error as SaveGameLoadError).code).toBe(code);
      }
    }
  });

  it('warns when a save targets another project revision and clamps stale positions', () => {
    const project = dialogueProject();
    const save = createSaveGame(project, createEngineState(project));
    save.projectVersion = 2;
    save.state.instructionPointer = 999;

    const result = loadSaveGameWithReport(project, save);
    expect(result.state.instructionPointer).toBe(2);
    expect(result.warnings).toEqual([
      '存档来自项目 v2，将按当前项目 v3 兼容读取',
      '存档指令位置已调整到当前剧情范围',
    ]);
  });

  it('rejects saves whose active fragment no longer exists', () => {
    const project = dialogueProject();
    const save = createSaveGame(project, createEngineState(project));
    save.state.fragmentId = 'removed-fragment';

    expect(() => loadSaveGame(project, save)).toThrow('剧情片段已不存在');
  });

  it('rolls back visible progress and keeps shared values', () => {
    const project = dialogueProject();
    const first = createEngineState(project);
    const second = advanceEngine(project, first);
    const withSharedUnlock = { ...second, variables: { ...second.variables, sharedUnlock: true } };
    const rolled = rollbackEngine(withSharedUnlock, ['sharedUnlock']);

    expect(currentBlock(project, rolled)?.id).toBe('line-one');
    expect(rolled.variables.sharedUnlock).toBe(true);
    expect(rolled.readBlocks['line-one']).toBeUndefined();
    expect(rolled.rollbackStack).toHaveLength(0);
  });
});
