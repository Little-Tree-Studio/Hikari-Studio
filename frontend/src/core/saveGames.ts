import { createSaveGame } from '../engine-core/runtime';
import type { EngineState, SaveGame } from '../engine-core/types';
import type { Project } from '../types';
import { deleteLargeValue, readLargeValue, writeLargeValue } from './storage';

const SAVE_FORMAT_VERSION = 1;
const MANUAL_SLOT_COUNT = 8;

interface SaveEnvelope {
  formatVersion: number;
  checksum: string;
  save: SaveGame;
}

export interface SaveSlotRecord {
  slotId: string;
  slotType: SaveGame['slotType'];
  label: string;
  status: 'empty' | 'valid' | 'corrupt';
  save?: SaveGame;
  recovered?: boolean;
  error?: string;
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

const saveKey = (projectId: string, slotId: string) => `hikari-save:${projectId}:${slotId}`;
const backupKey = (projectId: string, slotId: string) => `${saveKey(projectId, slotId)}:backup`;
const legacyQuickKey = (projectId: string) => `hikari-save-${projectId}-quick`;
const sharedKey = (projectId: string) => `hikari-shared:${projectId}`;

function checksum(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function encodeSave(save: SaveGame) {
  const payload = JSON.stringify(save);
  const envelope: SaveEnvelope = { formatVersion: SAVE_FORMAT_VERSION, checksum: checksum(payload), save };
  return JSON.stringify(envelope);
}

function decodeSave(encoded: string, projectId: string): SaveGame {
  const parsed = JSON.parse(encoded) as SaveEnvelope | SaveGame;
  if ('save' in parsed) {
    if (parsed.formatVersion > SAVE_FORMAT_VERSION) throw new Error(`存档格式 ${parsed.formatVersion} 高于当前支持版本`);
    const payload = JSON.stringify(parsed.save);
    if (checksum(payload) !== parsed.checksum) throw new Error('存档校验失败，文件可能已损坏');
    if (parsed.save.projectId !== projectId) throw new Error('存档属于其他项目');
    return parsed.save;
  }
  if (parsed.projectId !== projectId || !parsed.state || !parsed.savedAt) throw new Error('旧存档结构不完整');
  return parsed;
}

async function readValidSave(key: string, projectId: string) {
  const encoded = await readLargeValue(key);
  return encoded ? { encoded, save: decodeSave(encoded, projectId) } : null;
}

async function migrateLegacyQuickSave(projectId: string) {
  if (await readLargeValue(saveKey(projectId, 'quick'))) return;
  const legacy = await readLargeValue(legacyQuickKey(projectId));
  if (!legacy) return;
  const save = decodeSave(legacy, projectId);
  save.slotId = 'quick';
  save.slotType = 'quick';
  save.label = '快速存档';
  await writeLargeValue(saveKey(projectId, 'quick'), encodeSave(save));
  await deleteLargeValue(legacyQuickKey(projectId));
}

export async function listSaveSlots(project: Project): Promise<SaveSlotRecord[]> {
  await migrateLegacyQuickSave(project.meta.id);
  return Promise.all(SAVE_SLOTS.map(async (slot) => {
    const key = saveKey(project.meta.id, slot.slotId);
    try {
      const current = await readValidSave(key, project.meta.id);
      if (!current) return { ...slot, status: 'empty' as const };
      return { ...slot, status: 'valid' as const, save: current.save };
    } catch (error) {
      try {
        const backup = await readValidSave(backupKey(project.meta.id, slot.slotId), project.meta.id);
        if (!backup) throw error;
        await writeLargeValue(key, backup.encoded);
        return { ...slot, status: 'valid' as const, save: backup.save, recovered: true };
      } catch {
        return { ...slot, status: 'corrupt' as const, error: error instanceof Error ? error.message : String(error) };
      }
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
  if (previous) await writeLargeValue(backupKey(project.meta.id, slotId), previous);
  const fragment = project.chapters.flatMap((chapter) => chapter.fragments.map((item) => ({ ...item, chapterName: chapter.name }))).find((item) => item.id === state.fragmentId);
  const save = createSaveGame(project, state, slot.slotType, slot.label, {
    slotId,
    thumbnail,
    playTimeSeconds,
    fragmentName: fragment?.name ?? state.fragmentId,
    chapterName: fragment?.chapterName,
  });
  await writeLargeValue(key, encodeSave(save));
  await writeSharedVariables(project, state.variables);
  return save;
}

export async function readSaveSlot(project: Project, slotId: string) {
  const current = await readValidSave(saveKey(project.meta.id, slotId), project.meta.id);
  if (!current) throw new Error('该槽位还没有存档');
  return current.save;
}

export async function deleteSaveSlot(projectId: string, slotId: string) {
  await Promise.all([deleteLargeValue(saveKey(projectId, slotId)), deleteLargeValue(backupKey(projectId, slotId))]);
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
