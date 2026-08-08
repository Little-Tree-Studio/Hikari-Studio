import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineState, createSaveGame } from '../../engine-core/runtime';
import { testProject } from '../../engine-core/__tests__/fixtures';

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock('../storage', () => ({
  readLargeValue: vi.fn(async (key: string) => storage.get(key) ?? null),
  writeLargeValue: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  deleteLargeValue: vi.fn(async (key: string) => { storage.delete(key); }),
}));

import { acknowledgeSaveSlotNotice, decodeSaveData, encodeSaveData, listSaveSlots, readSaveSlotWithRecovery, writeSaveSlot } from '../saveGames';

const project = () => testProject({ start: [{ id: 'line', type: 'narration', text: 'hello' }] });
const key = (slotId: string) => `hikari-save:vitest-project:${slotId}`;

describe('save storage recovery', () => {
  beforeEach(() => storage.clear());

  it('falls back to the last verified backup when the primary save is corrupt', async () => {
    const currentProject = project();
    const first = createEngineState(currentProject);
    await writeSaveSlot(currentProject, first, 'auto', undefined, 5);
    await writeSaveSlot(currentProject, { ...first, instructionPointer: 1 }, 'auto', undefined, 10);
    storage.set(key('auto'), '{broken');

    const recovered = await readSaveSlotWithRecovery(currentProject, 'auto');

    expect(recovered.recovered).toBe(true);
    expect(recovered.save.playTimeSeconds).toBe(5);
    expect(decodeSaveData(storage.get(key('auto'))!, currentProject.meta.id).playTimeSeconds).toBe(5);
  });

  it('marks a slot corrupt when both the primary and backup are unreadable', async () => {
    const currentProject = project();
    storage.set(key('auto'), '{broken-primary');
    storage.set(`${key('auto')}:backup`, '{broken-backup');

    const slots = await listSaveSlots(currentProject);
    const auto = slots.find((slot) => slot.slotId === 'auto');

    expect(auto).toMatchObject({ status: 'corrupt', errorCode: 'CORRUPT', error: '存档不是有效的 JSON 数据' });
    expect(storage.get(key('auto'))).toBe('{broken-primary');
    expect(storage.get(`${key('auto')}:backup`)).toBe('{broken-backup');
  });

  it('rejects a modified payload whose checksum no longer matches', () => {
    const currentProject = project();
    const save = createSaveGame(currentProject, createEngineState(currentProject));
    const envelope = JSON.parse(encodeSaveData(save)) as { save: typeof save };
    envelope.save.state.instructionPointer = 999;

    expect(() => decodeSaveData(JSON.stringify(envelope), currentProject.meta.id)).toThrow('存档校验失败');
  });

  it('recovers a valid backup when the primary record disappeared during a write', async () => {
    const currentProject = project();
    const save = createSaveGame(currentProject, createEngineState(currentProject), 'quick', '快速存档');
    storage.set(`${key('quick')}:backup`, encodeSaveData(save));

    const recovered = await readSaveSlotWithRecovery(currentProject, 'quick');

    expect(recovered.recovered).toBe(true);
    expect(storage.has(key('quick'))).toBe(true);
  });

  it('repairs the automatic slot from its last valid save and reports the fallback', async () => {
    const currentProject = project();
    const state = createEngineState(currentProject);
    const backup = createSaveGame(currentProject, state, 'auto', '自动存档', { slotId: 'auto', playTimeSeconds: 42 });
    storage.set(key('auto'), '{interrupted-auto-save');
    storage.set(`${key('auto')}:backup`, encodeSaveData(backup));

    const slots = await listSaveSlots(currentProject);
    const auto = slots.find((slot) => slot.slotId === 'auto');

    expect(auto).toMatchObject({ status: 'valid', recovered: true, warnings: ['主存档不可用，已恢复最后一个有效备份'] });
    expect(auto?.save?.playTimeSeconds).toBe(42);
    expect(decodeSaveData(storage.get(key('auto'))!, currentProject.meta.id).playTimeSeconds).toBe(42);
    expect(await readSaveSlotWithRecovery(currentProject, 'auto')).toMatchObject({ recovered: true });
    acknowledgeSaveSlotNotice(currentProject.meta.id, 'auto');
    expect(await readSaveSlotWithRecovery(currentProject, 'auto')).toMatchObject({ recovered: false });
  });

  it('keeps project mismatch and future engine versions distinct from corruption', async () => {
    const currentProject = project();
    const save = createSaveGame(currentProject, createEngineState(currentProject));
    storage.set(key('manual-1'), encodeSaveData({ ...save, projectId: 'another-game' }));
    storage.set(key('manual-2'), encodeSaveData({ ...save, engineVersion: 999 }));

    const slots = await listSaveSlots(currentProject);

    expect(slots.find((slot) => slot.slotId === 'manual-1')).toMatchObject({ status: 'mismatch', errorCode: 'PROJECT_MISMATCH' });
    expect(slots.find((slot) => slot.slotId === 'manual-2')).toMatchObject({ status: 'incompatible', errorCode: 'FUTURE_ENGINE_VERSION' });
  });

  it('rejects future storage formats before attempting engine migration', () => {
    const currentProject = project();
    const save = createSaveGame(currentProject, createEngineState(currentProject));
    const envelope = JSON.parse(encodeSaveData(save)) as { formatVersion: number };
    envelope.formatVersion = 999;

    expect(() => decodeSaveData(JSON.stringify(envelope), currentProject.meta.id)).toThrow('高于当前支持版本');
  });

  it('migrates legacy engine state and rewrites it in the current format', async () => {
    const currentProject = project();
    const save = createSaveGame(currentProject, createEngineState(currentProject), 'manual');
    const legacyState = structuredClone(save.state) as Partial<typeof save.state>;
    delete legacyState.executionTrace;
    delete legacyState.traceCursor;
    storage.set(key('manual-1'), encodeSaveData({ ...save, engineVersion: 2, state: legacyState as typeof save.state }));

    const migrated = await readSaveSlotWithRecovery(currentProject, 'manual-1');
    const persisted = decodeSaveData(storage.get(key('manual-1'))!, currentProject.meta.id);

    expect(migrated.migrated).toBe(true);
    expect(persisted.engineVersion).toBe(3);
    expect(persisted.migration?.fromEngineVersion).toBe(2);
  });

  it('does not replace a healthy backup with a corrupt primary record', async () => {
    const currentProject = project();
    const state = createEngineState(currentProject);
    await writeSaveSlot(currentProject, state, 'quick', undefined, 1);
    await writeSaveSlot(currentProject, state, 'quick', undefined, 2);
    storage.set(key('quick'), '{broken');

    await writeSaveSlot(currentProject, state, 'quick', undefined, 3);

    const backup = decodeSaveData(storage.get(`${key('quick')}:backup`)!, currentProject.meta.id);
    expect(backup.playTimeSeconds).toBe(1);
  });
});
