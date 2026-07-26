import { describe, expect, it } from 'vitest';
import type { SaveGame } from '../types';
import { advanceEngine, createEngineState, createSaveGame, currentBlock, loadSaveGame, rollbackEngine } from '../runtime';
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

    const loaded = loadSaveGame(project, legacy);
    expect(loaded.executionTrace).toEqual([]);
    expect(loaded.traceCursor).toBe(-1);
  });

  it('rejects foreign and future saves', () => {
    const project = dialogueProject();
    const save = createSaveGame(project, createEngineState(project));

    expect(() => loadSaveGame(project, { ...save, projectId: 'other-project' })).toThrow('存档不属于当前项目');
    expect(() => loadSaveGame(project, { ...save, engineVersion: 999 })).toThrow('高于当前版本');
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
