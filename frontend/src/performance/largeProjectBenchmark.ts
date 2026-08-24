import { analyzeAssetReferences } from '../core/assetReferences';
import { evaluateTimelineAtTime } from '../core/timeline';
import { createBuildPreflightReport } from '../engine-core/buildPreflight';
import { diagnoseProject } from '../engine-core/diagnostics';
import { EngineSeekCache, seekEngine, type EngineSeekCacheStats } from '../engine-core/runtime';
import type { Project, StageTimeline, StoryBlock, TimelineClip, TimelineTrack, TimelineTrackKind } from '../types';

export const LARGE_PROJECT_PROFILE = {
  chapters: 10,
  fragments: 100,
  blocks: 10_000,
  assets: 5_000,
  timelineClips: 1_000,
} as const;

const MAX_HOT_SEEK_FRAGMENTS = 8;

export const LARGE_PROJECT_BUDGETS = {
  generation: 3_000,
  serialization: 3_000,
  parsing: 3_000,
  assetReferences: 5_000,
  diagnostics: 8_000,
  buildPreflight: 12_000,
  timelineEvaluation: 3_000,
  previewSeek: 8_000,
  previewSeekCached: 1_000,
  serializedBytes: 32 * 1024 * 1024,
} as const;

export interface LargeProjectShape {
  chapters: number;
  fragments: number;
  blocks: number;
  assets: number;
  timelineClips: number;
}

export interface LargeProjectBenchmarkMeasurement {
  name: keyof Omit<typeof LARGE_PROJECT_BUDGETS, 'serializedBytes'>;
  durationMs: number;
  heapDeltaBytes?: number;
  retainedHeapDeltaBytes?: number;
}

export interface LargeProjectBenchmarkReport {
  version: 1;
  generatedAt: string;
  shape: LargeProjectShape;
  serializedBytes: number;
  bundledAssets: number;
  assetReferences: number;
  diagnostics: number;
  preflightIssues: number;
  timelineEvaluations: number;
  previewSeeks: number;
  cachedPreviewSeeks: number;
  seekCacheStats: EngineSeekCacheStats;
  previewSeekCacheRetainedBytes?: number;
  previewSeekSampleStateBytes: number;
  measurements: LargeProjectBenchmarkMeasurement[];
  totalDurationMs: number;
  budgets: typeof LARGE_PROJECT_BUDGETS;
  violations: string[];
}

const blockFor = (index: number): StoryBlock => {
  const assetId = `asset-${index % 2_500}`;
  const audioAssetId = `asset-${2_500 + (index % 1_500)}`;
  const fragmentId = `fragment-${Math.floor(index / 100)}`;
  switch (index % 13) {
    case 0: return { id: `block-${index}`, type: 'scene', title: `Scene ${index}`, assetId, transition: 'dissolve', duration: 0.4 };
    case 1: return { id: `block-${index}`, type: 'sound', title: `Audio ${index}`, assetId: audioAssetId, channel: index % 20 ? 'sfx' : 'bgm', action: 'play', volume: 0.7, loop: index % 20 === 0 };
    case 2: return { id: `block-${index}`, type: 'characterShow', characterId: 'benchmark-hero', expression: index % 20 ? 'default' : 'smile', position: 'center', scale: 1, opacity: 1, layer: 1, animation: 'fade' };
    case 3: return { id: `block-${index}`, type: 'camera', cameraX: index % 40, cameraY: -(index % 20), zoom: 1 + (index % 5) * 0.05, rotation: 0, shake: 0, filter: 'none', duration: 0.3 };
    case 4: return { id: `block-${index}`, type: 'setVariable', variable: `flag-${index % 50}`, value: index };
    case 5: return { id: `block-${index}`, type: 'dialogue', speaker: 'Benchmark Hero', expression: index % 20 ? 'default' : 'smile', text: `Dialogue line ${index}`, voice: audioAssetId };
    case 6: return { id: `block-${index}`, type: 'narration', text: `Narration line ${index}` };
    case 7: return { id: `block-${index}`, type: 'branch', title: `Branch ${index}`, options: [{ text: 'Continue', target: fragmentId }] };
    case 8: return { id: `block-${index}`, type: 'condition', variable: `flag-${index % 50}`, operator: 'gte', compareValue: 1 };
    case 9: return { id: `block-${index}`, type: 'jump', target: fragmentId };
    case 10: return { id: `block-${index}`, type: 'call', target: fragmentId };
    case 11: return { id: `block-${index}`, type: 'return' };
    default: return { id: `block-${index}`, type: 'characterHide', characterId: 'benchmark-hero', animation: 'fade', duration: 0.2 };
  }
};

const keyframeProperty = (kind: TimelineTrackKind) => kind === 'scene'
  ? 'opacity'
  : kind === 'character'
    ? 'x'
    : kind === 'camera'
      ? 'zoom'
      : 'volume';

function timelineFor(fragmentIndex: number): StageTimeline {
  const kinds: TimelineTrackKind[] = ['scene', 'character', 'camera', 'audio'];
  const tracks: TimelineTrack[] = kinds.map((kind) => ({ id: `timeline-${fragmentIndex}-${kind}`, name: kind, kind, clips: [] }));
  for (let clipIndex = 0; clipIndex < 10; clipIndex += 1) {
    const kind = kinds[clipIndex % kinds.length];
    const globalClipIndex = fragmentIndex * 10 + clipIndex;
    const property = keyframeProperty(kind);
    const clip: TimelineClip = {
      id: `timeline-clip-${globalClipIndex}`,
      name: `Clip ${globalClipIndex}`,
      start: clipIndex * 2,
      duration: 2,
      blockId: `block-${fragmentIndex * 100 + clipIndex}`,
      assetId: kind === 'audio' ? `asset-${2_500 + globalClipIndex % 1_500}` : `asset-${globalClipIndex % 2_500}`,
      characterId: kind === 'character' ? 'benchmark-hero' : undefined,
      audioChannel: kind === 'audio' ? 'bgm' : undefined,
      keyframes: [
        { id: `keyframe-${globalClipIndex}-start`, time: 0, property, value: kind === 'camera' ? 1 : kind === 'character' ? 30 : 0, easing: 'linear' },
        { id: `keyframe-${globalClipIndex}-end`, time: 2, property, value: kind === 'camera' ? 1.2 : kind === 'character' ? 70 : 1, easing: 'easeInOut' },
      ],
    };
    tracks[clipIndex % tracks.length].clips.push(clip);
  }
  return { version: 1, fragmentId: `fragment-${fragmentIndex}`, duration: 22, fps: 30, tracks };
}

export function createLargeProjectBenchmarkFixture(): Project {
  const fragments = Array.from({ length: LARGE_PROJECT_PROFILE.fragments }, (_, index) => ({ id: `fragment-${index}`, name: `Fragment ${index}` }));
  const chapters = Array.from({ length: LARGE_PROJECT_PROFILE.chapters }, (_, chapterIndex) => ({
    id: `chapter-${chapterIndex}`,
    name: `Chapter ${chapterIndex}`,
    entry: chapterIndex === 0,
    fragments: fragments.slice(chapterIndex * 10, chapterIndex * 10 + 10),
  }));
  const scripts = Object.fromEntries(fragments.map((fragment, fragmentIndex) => [
    fragment.id,
    Array.from({ length: 100 }, (_, blockIndex) => blockFor(fragmentIndex * 100 + blockIndex)),
  ]));
  const assets = Array.from({ length: LARGE_PROJECT_PROFILE.assets }, (_, index) => ({
    id: `asset-${index}`,
    kind: index < 2_500 ? 'image' : index < 4_000 ? 'audio' : index < 4_500 ? 'video' : 'font',
    name: `Asset ${index}`,
    path: `assets/files/asset-${index}.${index < 2_500 ? 'webp' : index < 4_000 ? 'ogg' : index < 4_500 ? 'webm' : 'woff2'}`,
    size: 16_384 + index,
    forceBundle: index % 997 === 0,
    audioCategory: index >= 2_500 && index < 4_000 ? 'sfx' as const : undefined,
  }));
  const timelines = Object.fromEntries(fragments.map((fragment, index) => [fragment.id, timelineFor(index)]));
  const variables = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`flag-${index}`, 0]));
  const variableDefinitions = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`flag-${index}`, { type: 'number' as const, scope: 'project' as const, persistence: 'slot' as const }]));

  return {
    version: 3,
    meta: { id: 'large-project-benchmark', name: 'Large Project Benchmark', author: 'Slide Studio', resolution: [1920, 1080], updatedAt: '2026-08-02T00:00:00.000Z' },
    characters: [{ id: 'benchmark-hero', name: 'Benchmark Hero', color: '#d65b4a', expressions: ['default', 'smile'], portraits: { default: 'asset-0', smile: 'asset-1' }, defaultPosition: 'center', defaultScale: 1, defaultLayer: 1 }],
    scenes: Array.from({ length: 100 }, (_, index) => ({ id: `scene-${index}`, name: `Scene ${index}`, layers: [{ id: `scene-layer-${index}`, name: 'Background', assetId: `asset-${index}`, opacity: 1, blendMode: 'normal' as const, offsetX: 0, offsetY: 0, scale: 1, distance: 1 }] })),
    chapters,
    activeFragmentId: 'fragment-0',
    scripts,
    timelines,
    assets,
    variables,
    variableDefinitions,
    settings: { textSpeed: 35, autoSave: true, skipRead: true, editorSession: { openFragmentIds: ['fragment-0'], selectedBlockByFragment: { 'fragment-0': 5 }, scrollTopByFragment: { 'fragment-0': 0 }, inspectorDock: 'preview', scriptView: 'cards' } },
    locale: { default: 'zh-CN', languages: ['zh-CN'] },
    ui: { theme: 'slide-light', dialogueStyle: 'glass' },
  };
}

export function largeProjectShape(project: Project): LargeProjectShape {
  return {
    chapters: project.chapters.length,
    fragments: project.chapters.reduce((total, chapter) => total + chapter.fragments.length, 0),
    blocks: Object.values(project.scripts).reduce((total, blocks) => total + blocks.length, 0),
    assets: project.assets.length,
    timelineClips: Object.values(project.timelines ?? {}).reduce((total, timeline) => total + timeline.tracks.reduce((trackTotal, track) => trackTotal + track.clips.length, 0), 0),
  };
}

function heapBytes(): number | undefined {
  const browserMemory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  if (typeof browserMemory === 'number') return browserMemory;
  const nodeProcess = (globalThis as unknown as { process?: { memoryUsage?: () => { heapUsed: number } } }).process;
  return nodeProcess?.memoryUsage?.().heapUsed;
}

function collectGarbage(): boolean {
  const gc = (globalThis as unknown as { gc?: () => void }).gc;
  if (typeof gc !== 'function') return false;
  gc();
  gc();
  return true;
}

function measured<T>(name: LargeProjectBenchmarkMeasurement['name'], operation: () => T): { value: T; measurement: LargeProjectBenchmarkMeasurement } {
  const canCollect = collectGarbage();
  const heapBefore = heapBytes();
  const startedAt = performance.now();
  const value = operation();
  const durationMs = performance.now() - startedAt;
  const heapAfter = heapBytes();
  if (canCollect) collectGarbage();
  const retainedHeapAfter = canCollect ? heapBytes() : undefined;
  return {
    value,
    measurement: {
      name,
      durationMs: Number(durationMs.toFixed(3)),
      heapDeltaBytes: heapBefore === undefined || heapAfter === undefined ? undefined : heapAfter - heapBefore,
      retainedHeapDeltaBytes: heapBefore === undefined || retainedHeapAfter === undefined ? undefined : retainedHeapAfter - heapBefore,
    },
  };
}

export function benchmarkViolations(report: Omit<LargeProjectBenchmarkReport, 'violations'>): string[] {
  const violations = report.measurements
    .filter((measurement) => measurement.durationMs > LARGE_PROJECT_BUDGETS[measurement.name])
    .map((measurement) => `${measurement.name} ${measurement.durationMs.toFixed(1)}ms exceeds ${LARGE_PROJECT_BUDGETS[measurement.name]}ms`);
  if (report.serializedBytes > LARGE_PROJECT_BUDGETS.serializedBytes) violations.push(`serialized project ${report.serializedBytes} bytes exceeds ${LARGE_PROJECT_BUDGETS.serializedBytes} bytes`);
  return violations;
}

async function yieldForWeakCollection(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  collectGarbage();
}

export async function runLargeProjectBenchmark(): Promise<LargeProjectBenchmarkReport> {
  const measurements: LargeProjectBenchmarkMeasurement[] = [];
  const generated = measured('generation', createLargeProjectBenchmarkFixture);
  measurements.push(generated.measurement);
  const project = generated.value;

  const serialized = measured('serialization', () => JSON.stringify(project));
  measurements.push(serialized.measurement);
  const parsed = measured('parsing', () => JSON.parse(serialized.value) as Project);
  measurements.push(parsed.measurement);

  const references = measured('assetReferences', () => analyzeAssetReferences(parsed.value));
  measurements.push(references.measurement);
  const diagnostics = measured('diagnostics', () => diagnoseProject(parsed.value));
  measurements.push(diagnostics.measurement);
  const preflight = measured('buildPreflight', () => createBuildPreflightReport(parsed.value, 'web'));
  measurements.push(preflight.measurement);

  let timelineEvaluations = 0;
  const timelineEvaluation = measured('timelineEvaluation', () => {
    for (const timeline of Object.values(parsed.value.timelines ?? {})) {
      for (let index = 0; index < 10; index += 1) {
        evaluateTimelineAtTime(timeline, index * 2 + 1);
        timelineEvaluations += 1;
      }
    }
  });
  measurements.push(timelineEvaluation.measurement);

  let previewSeeks = 0;
  let previewSeekSampleState: ReturnType<typeof seekEngine> | undefined;
  const seekCache = new EngineSeekCache();
  collectGarbage();
  const stablePreviewHeapBefore = heapBytes();
  const previewSeek = measured('previewSeek', () => {
    for (let index = 0; index < LARGE_PROJECT_PROFILE.fragments; index += 1) {
      const state = seekEngine(parsed.value, `fragment-${index}`, 99, seekCache);
      if (!previewSeekSampleState) previewSeekSampleState = state;
      previewSeeks += 1;
    }
  });
  await yieldForWeakCollection();
  const stablePreviewHeapAfter = heapBytes();
  if (stablePreviewHeapBefore !== undefined && stablePreviewHeapAfter !== undefined) {
    previewSeek.measurement.retainedHeapDeltaBytes = stablePreviewHeapAfter - stablePreviewHeapBefore;
  }
  measurements.push(previewSeek.measurement);

  let cachedPreviewSeeks = 0;
  const previewSeekCached = measured('previewSeekCached', () => {
    for (let index = 0; index < LARGE_PROJECT_PROFILE.fragments; index += 1) {
      const hotFragment = LARGE_PROJECT_PROFILE.fragments - MAX_HOT_SEEK_FRAGMENTS + (index % MAX_HOT_SEEK_FRAGMENTS);
      seekEngine(parsed.value, `fragment-${hotFragment}`, 99, seekCache);
      cachedPreviewSeeks += 1;
    }
  });
  measurements.push(previewSeekCached.measurement);
  const seekCacheStats = seekCache.stats();
  collectGarbage();
  const heapBeforeCacheClear = heapBytes();
  seekCache.clear();
  collectGarbage();
  const heapAfterCacheClear = heapBytes();
  const previewSeekCacheRetainedBytes = heapBeforeCacheClear === undefined || heapAfterCacheClear === undefined
    ? undefined
    : Math.max(0, heapBeforeCacheClear - heapAfterCacheClear);

  const base = {
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    shape: largeProjectShape(project),
    serializedBytes: new TextEncoder().encode(serialized.value).byteLength,
    bundledAssets: references.value.bundledIds.size,
    assetReferences: Object.values(references.value.references).reduce((total, items) => total + items.length, 0),
    diagnostics: diagnostics.value.length,
    preflightIssues: preflight.value.issues.length,
    timelineEvaluations,
    previewSeeks,
    cachedPreviewSeeks,
    seekCacheStats,
    previewSeekCacheRetainedBytes,
    previewSeekSampleStateBytes: new TextEncoder().encode(JSON.stringify(previewSeekSampleState)).byteLength,
    measurements,
    totalDurationMs: Number(measurements.reduce((total, item) => total + item.durationMs, 0).toFixed(3)),
    budgets: LARGE_PROJECT_BUDGETS,
  };
  return { ...base, violations: benchmarkViolations(base) };
}
