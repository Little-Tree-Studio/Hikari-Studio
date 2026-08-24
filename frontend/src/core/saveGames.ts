import { createSaveGame, loadSaveGameWithReport, SaveGameLoadError } from '../engine-core/runtime';
import type { EngineState, SaveGame } from '../engine-core/types';
import type { Project } from '../types';
import { deleteLargeValue, readLargeValue, writeLargeValue } from './storage';

export const SAVE_FORMAT_VERSION = 1;
const MANUAL_SLOT_COUNT = 8;

interface SaveEnvelope {
  formatVersion: number;
  checksum: string;
  save: SaveGame;
}

interface SaveSlotNotice {
  signature: string;
  recovered: boolean;
  migrated: boolean;
  warnings: string[];
}

const saveSlotNotices = new Map<string, SaveSlotNotice>();

export type SaveStorageErrorCode = 'CORRUPT' | 'PROJECT_MISMATCH' | 'FUTURE_FORMAT' | 'EMPTY';

export class SaveStorageError extends Error {
  constructor(public readonly code: SaveStorageErrorCode, message: string) {
    super(message);
    this.name = 'SaveStorageError';
  }
}

export interface SaveSlotRecord {
  slotId: string;
  slotType: SaveGame['slotType'];
  label: string;
  status: 'empty' | 'valid' | 'corrupt' | 'mismatch' | 'incompatible';
  save?: SaveGame;
  recovered?: boolean;
  migrated?: boolean;
  warnings?: string[];
  errorCode?: SaveStorageErrorCode | SaveGameLoadError['code'];
  error?: string;
}

export interface SaveSlotReadResult {
  save: SaveGame;
  recovered: boolean;
  migrated: boolean;
  warnings: string[];
}

export const SAVE_SLOTS: Array<Pick<SaveSlotRecord, 'slotId' | 'slotType' | 'label'>> = [
  { slotId: 'quick', slotType: 'quick', label: '快速存档' },
  { slotId: 'auto', slotType: 'auto', label: '自动存档' },
  ...Array.from({ length: MANUAL_SLOT_COUNT }, (_, index) => ({
    slotId: `manual-${index + 1}`,
    slotType: 'manual' as const,
    label: `存档 ${String(index + 1).padStart(2, '0')}`,
  })),
];

const saveKey = (projectId: string, slotId: string) => `slide-save:${projectId}:${slotId}`;
const backupKey = (projectId: string, slotId: string) => `${saveKey(projectId, slotId)}:backup`;
const legacyQuickKey = (projectId: string) => `slide-save-${projectId}-quick`;
const sharedKey = (projectId: string) => `slide-shared:${projectId}`;
const noticeKey = (projectId: string, slotId: string) => `${projectId}:${slotId}`;

function checksum(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function withSaveSlotNotice(projectId: string, slotId: string, result: SaveSlotReadResult): SaveSlotReadResult {
  const key = noticeKey(projectId, slotId);
  const signature = checksum(JSON.stringify(result.save));
  if (result.recovered || result.migrated) {
    saveSlotNotices.set(key, {
      signature,
      recovered: result.recovered,
      migrated: result.migrated,
      warnings: result.warnings,
    });
  }
  const notice = saveSlotNotices.get(key);
  if (!notice || notice.signature !== signature) {
    if (notice) saveSlotNotices.delete(key);
    return result;
  }
  return {
    ...result,
    recovered: result.recovered || notice.recovered,
    migrated: result.migrated || notice.migrated,
    warnings: [...new Set([...notice.warnings, ...result.warnings])],
  };
}

export function acknowledgeSaveSlotNotice(projectId: string, slotId: string) {
  saveSlotNotices.delete(noticeKey(projectId, slotId));
}

export function encodeSaveData(save: SaveGame) {
  const payload = JSON.stringify(save);
  const envelope: SaveEnvelope = { formatVersion: SAVE_FORMAT_VERSION, checksum: checksum(payload), save };
  return JSON.stringify(envelope);
}

export function decodeSaveData(encoded: string, projectId: string): SaveGame {
  let parsed: SaveEnvelope | SaveGame;
  try {
    parsed = JSON.parse(encoded) as SaveEnvelope | SaveGame;
  } catch {
    throw new SaveStorageError('CORRUPT', '存档不是有效的 JSON 数据');
  }
  if (!parsed || typeof parsed !== 'object') throw new SaveStorageError('CORRUPT', '存档结构无效');
  if ('save' in parsed) {
    if (!parsed.save || typeof parsed.save !== 'object') throw new SaveStorageError('CORRUPT', '存档内容缺失');
    if (parsed.formatVersion > SAVE_FORMAT_VERSION) throw new SaveStorageError('FUTURE_FORMAT', `存档格式 ${parsed.formatVersion} 高于当前支持版本`);
    const payload = JSON.stringify(parsed.save);
    if (checksum(payload) !== parsed.checksum) throw new SaveStorageError('CORRUPT', '存档校验失败，文件可能已损坏');
    if (parsed.save.projectId !== projectId) throw new SaveStorageError('PROJECT_MISMATCH', '检测到其他游戏的存档，已阻止读取');
    return parsed.save;
  }
  if (parsed.projectId !== projectId) throw new SaveStorageError('PROJECT_MISMATCH', '检测到其他游戏的旧存档，已阻止读取');
  if (!parsed.state || !parsed.savedAt) throw new SaveStorageError('CORRUPT', '旧存档结构不完整');
  return parsed;
}

async function readValidSave(key: string, project: Project) {
  const encoded = await readLargeValue(key);
  if (!encoded) return null;
  const decoded = decodeSaveData(encoded, project.meta.id);
  const report = loadSaveGameWithReport(project, decoded);
  const normalized = report.migrated ? encodeSaveData(report.save) : encoded;
  return { encoded: normalized, save: report.save, migrated: report.migrated, warnings: report.warnings };
}

async function migrateLegacyQuickSave(project: Project) {
  const projectId = project.meta.id;
  if (await readLargeValue(saveKey(projectId, 'quick'))) return;
  const legacy = await readLargeValue(legacyQuickKey(projectId));
  if (!legacy) return;
  const report = loadSaveGameWithReport(project, decodeSaveData(legacy, projectId));
  const save = report.save;
  save.slotId = 'quick';
  save.slotType = 'quick';
  save.label = '快速存档';
  await writeLargeValue(saveKey(projectId, 'quick'), encodeSaveData(save));
  await deleteLargeValue(legacyQuickKey(projectId));
}

function failureDetails(error: unknown): Pick<SaveSlotRecord, 'status' | 'error' | 'errorCode'> {
  if (error instanceof SaveStorageError) {
    if (error.code === 'PROJECT_MISMATCH') return { status: 'mismatch', error: error.message, errorCode: error.code };
    if (error.code === 'FUTURE_FORMAT') return { status: 'incompatible', error: error.message, errorCode: error.code };
    return { status: 'corrupt', error: error.message, errorCode: error.code };
  }
  if (error instanceof SaveGameLoadError) {
    if (error.code === 'PROJECT_MISMATCH') return { status: 'mismatch', error: error.message, errorCode: error.code };
    if (error.code === 'FUTURE_ENGINE_VERSION') return { status: 'incompatible', error: error.message, errorCode: error.code };
    return { status: 'corrupt', error: error.message, errorCode: error.code };
  }
  return { status: 'corrupt', error: error instanceof Error ? error.message : String(error), errorCode: 'CORRUPT' };
}

async function readSlotWithRecovery(project: Project, slotId: string): Promise<SaveSlotReadResult | null> {
  const key = saveKey(project.meta.id, slotId);
  let primaryError: unknown;
  try {
    const current = await readValidSave(key, project);
    if (current) {
      if (current.migrated) await writeLargeValue(key, current.encoded);
      return { save: current.save, recovered: false, migrated: current.migrated, warnings: current.warnings };
    }
    primaryError = new SaveStorageError('EMPTY', '该槽位还没有存档');
  } catch (error) {
    primaryError = error;
  }

  try {
    const backup = await readValidSave(backupKey(project.meta.id, slotId), project);
    if (!backup) throw primaryError;
    await writeLargeValue(key, backup.encoded);
    return { save: backup.save, recovered: true, migrated: backup.migrated, warnings: ['主存档不可用，已恢复最后一个有效备份', ...backup.warnings] };
  } catch {
    if (primaryError instanceof SaveStorageError && primaryError.code === 'EMPTY') return null;
    throw primaryError;
  }
}

export async function listSaveSlots(project: Project): Promise<SaveSlotRecord[]> {
  await migrateLegacyQuickSave(project);
  return Promise.all(SAVE_SLOTS.map(async (slot) => {
    try {
      const currentResult = await readSlotWithRecovery(project, slot.slotId);
      const current = currentResult ? withSaveSlotNotice(project.meta.id, slot.slotId, currentResult) : null;
      if (!current) return { ...slot, status: 'empty' as const };
      return { ...slot, status: 'valid' as const, ...current };
    } catch (error) {
      return { ...slot, ...failureDetails(error) };
    }
  }));
}

export async function writeSaveSlot(
  project: Project,
  state: EngineState,
  slotId: string,
  thumbnail: string | undefined,
  playTimeSeconds: number,
) {
  const slot = SAVE_SLOTS.find((item) => item.slotId === slotId);
  if (!slot) throw new Error(`未知存档槽位：${slotId}`);
  const key = saveKey(project.meta.id, slotId);
  const previous = await readLargeValue(key);
  if (previous) {
    try {
      await readValidSave(key, project);
      await writeLargeValue(backupKey(project.meta.id, slotId), previous);
    } catch {
      // Keep the existing healthy backup when the current record is corrupt or incompatible.
    }
  }
  const fragment = project.chapters.flatMap((chapter) => chapter.fragments.map((item) => ({ ...item, chapterName: chapter.name }))).find((item) => item.id === state.fragmentId);
  const save = createSaveGame(project, state, slot.slotType, slot.label, {
    slotId,
    thumbnail,
    playTimeSeconds,
    fragmentName: fragment?.name ?? state.fragmentId,
    chapterName: fragment?.chapterName,
  });
  const encoded = encodeSaveData(save);
  await writeLargeValue(key, encoded);
  const verified = await readValidSave(key, project);
  if (!verified) throw new SaveStorageError('CORRUPT', '存档写入后校验失败');
  acknowledgeSaveSlotNotice(project.meta.id, slotId);
  await writeSharedVariables(project, state.variables);
  return save;
}

export async function readSaveSlot(project: Project, slotId: string) {
  return (await readSaveSlotWithRecovery(project, slotId)).save;
}

export async function readSaveSlotWithRecovery(project: Project, slotId: string): Promise<SaveSlotReadResult> {
  const current = await readSlotWithRecovery(project, slotId);
  if (!current) throw new SaveStorageError('EMPTY', '该槽位还没有存档');
  return withSaveSlotNotice(project.meta.id, slotId, current);
}

export async function deleteSaveSlot(projectId: string, slotId: string) {
  await Promise.all([deleteLargeValue(saveKey(projectId, slotId)), deleteLargeValue(backupKey(projectId, slotId))]);
  acknowledgeSaveSlotNotice(projectId, slotId);
}

export async function readSharedVariables(project: Project) {
  const encoded = await readLargeValue(sharedKey(project.meta.id));
  if (!encoded) return {};
  try {
    const parsed = JSON.parse(encoded) as Record<string, string | number | boolean>;
    return Object.fromEntries(Object.entries(parsed).filter(([name, value]) => project.variableDefinitions?.[name]?.persistence === 'shared' && ['string', 'number', 'boolean'].includes(typeof value)));
  } catch {
    return {};
  }
}

export async function writeSharedVariables(project: Project, variables: Record<string, string | number | boolean>) {
  const shared = Object.fromEntries(Object.entries(variables).filter(([name]) => project.variableDefinitions?.[name]?.persistence === 'shared'));
  await writeLargeValue(sharedKey(project.meta.id), JSON.stringify(shared));
}

function loadImage(uri?: string): Promise<HTMLImageElement | null> {
  if (!uri) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = uri;
  });
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}

export async function captureSaveThumbnail(project: Project, state: EngineState) {
  const width = 480;
  const height = 270;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.fillStyle = '#26343d';
  context.fillRect(0, 0, width, height);
  const assetUri = (assetId?: string) => project.assets.find((asset) => asset.id === assetId)?.uri;
  const background = await loadImage(assetUri(state.stage.backgroundAssetId));
  if (background) drawCover(context, background, width, height);
  for (const layer of [...state.stage.sceneLayers].sort((left, right) => left.layer - right.layer)) {
    const image = await loadImage(assetUri(layer.assetId));
    if (!image) continue;
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight) * layer.scale;
    const drawnWidth = image.naturalWidth * scale;
    const drawnHeight = image.naturalHeight * scale;
    context.globalAlpha = layer.opacity;
    context.drawImage(image, width * layer.x / 100 - drawnWidth / 2, height * layer.y / 100 - drawnHeight / 2, drawnWidth, drawnHeight);
  }
  for (const character of Object.values(state.stage.characters).sort((left, right) => left.layer - right.layer)) {
    const image = await loadImage(assetUri(character.assetId));
    if (!image) continue;
    const scale = Math.min(width * .38 / image.naturalWidth, height * .88 / image.naturalHeight) * character.scale;
    const drawnWidth = image.naturalWidth * scale;
    const drawnHeight = image.naturalHeight * scale;
    context.globalAlpha = character.opacity;
    context.drawImage(image, width * character.x / 100 - drawnWidth / 2, height - drawnHeight, drawnWidth, drawnHeight);
  }
  context.globalAlpha = 1;
  context.fillStyle = 'rgba(0,0,0,.22)';
  context.fillRect(0, height - 42, width, 42);
  try { return canvas.toDataURL('image/jpeg', .72); } catch { return undefined; }
}
