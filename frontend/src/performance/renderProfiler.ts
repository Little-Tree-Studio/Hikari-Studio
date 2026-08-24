import type { ProfilerOnRenderCallback } from 'react';
import type { BlockType, ComponentRenderPerformance, ComponentRenderSurface, DialogueStoryCardRegion, RenderCommitPerformance } from '../types';

const surfaces = new Set<ComponentRenderSurface>([
  'app-shell',
  'chapter-tree',
  'script-page',
  'block-list',
  'preview',
  'inspector',
]);
const storyCardTypes = new Set<BlockType>([
  'scene', 'sound', 'characterShow', 'characterHide', 'camera', 'narration', 'dialogue',
  'branch', 'setVariable', 'modifyVariable', 'condition', 'jump', 'call', 'return',
]);
const storyCardPrefix = 'story-card:';
const dialogueRegions = new Set<DialogueStoryCardRegion>(['speaker', 'expression', 'body']);
const dialogueRegionPrefix = 'dialogue-region:';

type MutableMeasurement = ComponentRenderPerformance & { firstStartTimeMs?: number };
type RenderProfileSession = {
  reloadId: string;
  measurements: Map<ComponentRenderSurface, MutableMeasurement>;
};

export interface VirtualListMeasurementBatch {
  source: 'initial' | 'observer';
  durationMs: number;
  firstMeasurements: number;
  remeasurements: number;
  observerCallbacks: number;
  revisionFlushed: boolean;
  observedRows: number;
  viewportMeasured: boolean;
  viewportUpdated: boolean;
  viewportRangeFlushed: boolean;
}

let activeSession: RenderProfileSession | null = null;

const duration = (value: number) => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return Number(Math.max(0, Math.min(300_000, safeValue)).toFixed(3));
};

export function beginComponentRenderProfile(reloadId: string): void {
  activeSession = { reloadId, measurements: new Map() };
}

function measurementFor(surface: ComponentRenderSurface): MutableMeasurement {
  const current = activeSession?.measurements.get(surface);
  if (current) return current;
  return {
    commits: 0,
    mounts: 0,
    updates: 0,
    actualDurationMs: 0,
    mountDurationMs: 0,
    updateDurationMs: 0,
    baseDurationMs: 0,
    lastCommitTimeMs: 0,
  };
}

function emptyRenderMeasurement(): RenderCommitPerformance {
  return {
    commits: 0,
    mounts: 0,
    updates: 0,
    actualDurationMs: 0,
    mountDurationMs: 0,
    updateDurationMs: 0,
    baseDurationMs: 0,
    lastCommitTimeMs: 0,
  };
}

function recordStoryCardRenderMeasurement(
  blockType: BlockType,
  phase: 'mount' | 'update' | 'nested-update',
  actualDurationMs: number,
  baseDurationMs: number,
  commitTimeMs: number,
): void {
  if (!activeSession) return;
  const blockList = measurementFor('block-list');
  const current = blockList.storyCardTypes?.[blockType] ?? emptyRenderMeasurement();
  current.commits += 1;
  if (phase === 'mount') {
    current.mounts += 1;
    current.mountDurationMs = duration(current.mountDurationMs + actualDurationMs);
  } else {
    current.updates += 1;
    current.updateDurationMs = duration(current.updateDurationMs + actualDurationMs);
  }
  current.actualDurationMs = duration(current.actualDurationMs + actualDurationMs);
  current.baseDurationMs = duration(current.baseDurationMs + baseDurationMs);
  current.lastCommitTimeMs = duration(Math.max(current.lastCommitTimeMs, commitTimeMs));
  blockList.storyCardTypes = { ...blockList.storyCardTypes, [blockType]: current };
  activeSession.measurements.set('block-list', blockList);
}

function recordDialogueRegionMeasurement(
  region: DialogueStoryCardRegion,
  phase: 'mount' | 'update' | 'nested-update',
  actualDurationMs: number,
  baseDurationMs: number,
  commitTimeMs: number,
): void {
  if (!activeSession) return;
  const blockList = measurementFor('block-list');
  const current = blockList.dialogueRegions?.[region] ?? emptyRenderMeasurement();
  current.commits += 1;
  if (phase === 'mount') {
    current.mounts += 1;
    current.mountDurationMs = duration(current.mountDurationMs + actualDurationMs);
  } else {
    current.updates += 1;
    current.updateDurationMs = duration(current.updateDurationMs + actualDurationMs);
  }
  current.actualDurationMs = duration(current.actualDurationMs + actualDurationMs);
  current.baseDurationMs = duration(current.baseDurationMs + baseDurationMs);
  current.lastCommitTimeMs = duration(Math.max(current.lastCommitTimeMs, commitTimeMs));
  blockList.dialogueRegions = { ...blockList.dialogueRegions, [region]: current };
  activeSession.measurements.set('block-list', blockList);
}

export function recordComponentRenderMeasurement(
  surface: ComponentRenderSurface,
  phase: 'mount' | 'update' | 'nested-update',
  actualDurationMs: number,
  baseDurationMs: number,
  startTimeMs: number,
  commitTimeMs: number,
): void {
  if (!activeSession) return;
  const current = measurementFor(surface);
  current.commits += 1;
  if (phase === 'mount') {
    current.mounts += 1;
    current.mountDurationMs = duration(current.mountDurationMs + actualDurationMs);
  } else {
    current.updates += 1;
    current.updateDurationMs = duration(current.updateDurationMs + actualDurationMs);
  }
  current.actualDurationMs = duration(current.actualDurationMs + actualDurationMs);
  current.baseDurationMs = duration(Math.max(current.baseDurationMs, baseDurationMs));
  current.firstStartTimeMs = current.firstStartTimeMs === undefined
    ? duration(startTimeMs)
    : duration(Math.min(current.firstStartTimeMs, startTimeMs));
  current.lastCommitTimeMs = duration(Math.max(current.lastCommitTimeMs, commitTimeMs));
  activeSession.measurements.set(surface, current);
}

export function recordVirtualListMeasurement(batch: VirtualListMeasurementBatch): void {
  if (!activeSession) return;
  const current = measurementFor('block-list');
  current.firstMeasurementDurationMs = duration(
    (current.firstMeasurementDurationMs ?? 0) + (batch.source === 'initial' ? batch.durationMs : 0),
  );
  current.observerMeasurementDurationMs = duration(
    (current.observerMeasurementDurationMs ?? 0) + (batch.source === 'observer' ? batch.durationMs : 0),
  );
  current.firstMeasurements = Math.min(100_000, (current.firstMeasurements ?? 0) + Math.max(0, batch.firstMeasurements));
  current.remeasurements = Math.min(100_000, (current.remeasurements ?? 0) + Math.max(0, batch.remeasurements));
  current.observerCallbacks = Math.min(100_000, (current.observerCallbacks ?? 0) + Math.max(0, batch.observerCallbacks));
  current.revisionFlushes = Math.min(100_000, (current.revisionFlushes ?? 0) + (batch.revisionFlushed ? 1 : 0));
  current.peakObservedRows = Math.max(current.peakObservedRows ?? 0, Math.max(0, batch.observedRows));
  current.viewportMeasurements = Math.min(100_000, (current.viewportMeasurements ?? 0) + (batch.viewportMeasured ? 1 : 0));
  current.viewportUpdates = Math.min(100_000, (current.viewportUpdates ?? 0) + (batch.viewportUpdated ? 1 : 0));
  current.viewportRangeFlushes = Math.min(100_000, (current.viewportRangeFlushes ?? 0) + (batch.viewportRangeFlushed ? 1 : 0));
  activeSession.measurements.set('block-list', current);
}

export const recordComponentRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  if (id.startsWith(dialogueRegionPrefix)) {
    const region = id.slice(dialogueRegionPrefix.length) as DialogueStoryCardRegion;
    if (dialogueRegions.has(region)) recordDialogueRegionMeasurement(region, phase, actualDuration, baseDuration, commitTime);
    return;
  }
  if (id.startsWith(storyCardPrefix)) {
    const blockType = id.slice(storyCardPrefix.length) as BlockType;
    if (storyCardTypes.has(blockType)) recordStoryCardRenderMeasurement(blockType, phase, actualDuration, baseDuration, commitTime);
    return;
  }
  if (!surfaces.has(id as ComponentRenderSurface)) return;
  recordComponentRenderMeasurement(id as ComponentRenderSurface, phase, actualDuration, baseDuration, startTime, commitTime);
};

export function finishComponentRenderProfile(reloadId: string): Partial<Record<ComponentRenderSurface, ComponentRenderPerformance>> {
  if (!activeSession || activeSession.reloadId !== reloadId) return {};
  const result: Partial<Record<ComponentRenderSurface, ComponentRenderPerformance>> = {};
  for (const [surface, measurement] of activeSession.measurements) {
    const { firstStartTimeMs: _firstStartTimeMs, ...publicMeasurement } = measurement;
    result[surface] = publicMeasurement;
  }
  activeSession = null;
  return result;
}

export function cancelComponentRenderProfile(reloadId?: string): void {
  if (!reloadId || activeSession?.reloadId === reloadId) activeSession = null;
}
