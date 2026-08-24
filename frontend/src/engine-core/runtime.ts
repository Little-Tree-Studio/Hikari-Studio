import type { ConditionOperator, Project, StoryBlock } from '../types';
import type { AudioChannelState, EngineSnapshot, EngineState, EngineTraceEntry, SaveGame, SaveGameCompatibility, SaveGameLoadErrorCode, SaveGameLoadResult, StageState } from './types';
import { assetMatchesTrack } from '../core/audio';

export const ENGINE_VERSION = 3;
const MAX_SETTLE_STEPS = 1000;
const MAX_ROLLBACKS = 100;
const MAX_BACKLOG = 500;
const MAX_TRACE_ENTRIES = 2000;
const SEEK_CHECKPOINT_INTERVAL = 8;
const clone = <T,>(value: T): T => structuredClone(value);

interface ExecutionOptions {
  cloneSnapshots: boolean;
  captureRollback: boolean;
  visitedControlStates?: Set<string>;
}

const RUNTIME_EXECUTION: ExecutionOptions = { cloneSnapshots: true, captureRollback: true };
const SEEK_EXECUTION: ExecutionOptions = { cloneSnapshots: false, captureRollback: false };

export class SaveGameLoadError extends Error {
  constructor(public readonly code: SaveGameLoadErrorCode, message: string) {
    super(message);
    this.name = 'SaveGameLoadError';
  }
}

const emptyAudioChannel = (): AudioChannelState => ({ playing: false, volume: 1, loop: false, fadeDuration: 0 });
const initialStage = (): StageState => ({
  transitionDuration: 0,
  sceneLayers: [],
  characters: {},
  camera: { x: 0, y: 0, zoom: 1, rotation: 0, shake: 0, filter: 'none', duration: 0 },
});

function snapshot(state: EngineState, cloneSnapshot = true): EngineSnapshot {
  const {
    rollbackStack: _rollbackStack,
    stepsExecuted: _stepsExecuted,
    executionTrace: _executionTrace,
    traceCursor: _traceCursor,
    ...rest
  } = state;
  return cloneSnapshot ? clone(rest) : rest;
}

type TraceLocation = Pick<EngineTraceEntry, 'fragmentId' | 'instructionPointer' | 'blockId' | 'blockType' | 'step'>;

function appendTrace(state: EngineState, locations: TraceLocation[], cloneSnapshots = true): EngineState {
  if (!locations.length) return state;
  const currentTrace = state.traceCursor < state.executionTrace.length - 1
    ? state.executionTrace.slice(0, state.traceCursor + 1)
    : state.executionTrace;
  const finalSnapshot = snapshot(state, cloneSnapshots);
  const appended = locations.map((location, index): EngineTraceEntry => ({
    ...location,
    id: `${location.fragmentId}:${location.instructionPointer}:${currentTrace.length + index}`,
    snapshot: cloneSnapshots ? clone(finalSnapshot) : finalSnapshot,
  }));
  const executionTrace = [...currentTrace, ...appended].slice(-MAX_TRACE_ENTRIES);
  return { ...state, executionTrace, traceCursor: executionTrace.length - 1 };
}

function traceLocation(state: EngineState, block: StoryBlock): TraceLocation {
  return {
    fragmentId: state.fragmentId,
    instructionPointer: state.instructionPointer,
    blockId: block.id,
    blockType: block.type,
    step: state.stepsExecuted,
  };
}

function withRollback(state: EngineState, cloneSnapshot = true): EngineState {
  return { ...state, rollbackStack: [...state.rollbackStack, snapshot(state, cloneSnapshot)].slice(-MAX_ROLLBACKS) };
}

function applySideEffect(state: EngineState, block: StoryBlock, project: Project): EngineState {
  if (block.type === 'scene') {
    return { ...state, stage: { ...state.stage, backgroundAssetId: block.assetId, sceneLayers: [...(block.layers ?? [])].sort((left, right) => left.layer - right.layer), transition: block.transition, transitionDuration: block.duration ?? 0 } };
  }
  if (block.type === 'sound') {
    const channel = block.channel ?? 'bgm';
    const previous = state.audio[channel];
    const next = block.action === 'stop'
      ? { ...previous, playing: false, fadeDuration: block.fadeDuration ?? 0 }
      : { track: block.title, assetId: block.assetId, playing: true, volume: block.volume ?? 1, loop: block.loop ?? false, fadeDuration: block.fadeDuration ?? 0 };
    return { ...state, audio: { ...state.audio, [channel]: next } };
  }
  if (block.type === 'characterShow' && block.characterId) {
    const character = project.characters.find((item) => item.id === block.characterId);
    const position = block.position ?? character?.defaultPosition ?? 'center';
    const positionX = { farLeft: 10, left: 28, center: 50, right: 72, farRight: 90, custom: block.x ?? 50 }[position];
    const expression = block.expression ?? '默认';
    return { ...state, stage: { ...state.stage, characters: { ...state.stage.characters, [block.characterId]: { characterId: block.characterId, expression, assetId: block.assetId ?? character?.portraits?.[expression], position, x: positionX, y: block.y ?? 100, scale: block.scale ?? character?.defaultScale ?? 1, opacity: block.opacity ?? 1, layer: block.layer ?? character?.defaultLayer ?? 0, animation: block.animation ?? 'fade', width: character?.portraitWidth, height: character?.portraitHeight, overlays: character?.overlays } } } };
  }
  if (block.type === 'characterHide' && block.characterId) {
    const characters = { ...state.stage.characters };
    delete characters[block.characterId];
    return { ...state, stage: { ...state.stage, characters } };
  }
  if (block.type === 'camera') {
    return { ...state, stage: { ...state.stage, camera: { x: block.cameraX ?? 0, y: block.cameraY ?? 0, zoom: block.zoom ?? 1, rotation: block.rotation ?? 0, shake: block.shake ?? 0, filter: block.filter ?? 'none', duration: block.duration ?? 0 } } };
  }
  if (block.type === 'setVariable' && block.variable) {
    return { ...state, variables: { ...state.variables, [block.variable]: block.value ?? '' } };
  }
  if (block.type === 'modifyVariable' && block.variable) {
    const current = toComparable(state.variables[block.variable]);
    const base = typeof current === 'number' ? current : 0;
    const operand = Number(block.operand);
    const safeOperand = Number.isFinite(operand) ? operand : 1;
    let next: number;
    switch (block.operation) {
      case 'subtract': next = base - safeOperand; break;
      case 'multiply': next = base * safeOperand; break;
      case 'divide': next = safeOperand === 0 ? base : base / safeOperand; break;
      default: next = base + safeOperand;
    }
    return { ...state, variables: { ...state.variables, [block.variable]: next } };
  }
  return state;
}

/**
 * 变量比较的统一语义：数字串与数字按数值比较，避免 `3 neq '3'` 为 true 的
 * 跨类型歧义；非数值字符串回退为字典序比较；布尔值保持严格相等语义。
 */
const toComparable = (value: unknown): string | number | boolean => {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return String(value ?? '');
};

export function compareValues(left: unknown, operator: ConditionOperator | undefined, right: unknown): boolean {
  const comparableLeft = toComparable(left);
  const comparableRight = toComparable(right);
  if (operator === 'neq') return comparableLeft !== comparableRight;
  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    if (typeof comparableLeft === 'number' && typeof comparableRight === 'number') {
      if (operator === 'gt') return comparableLeft > comparableRight;
      if (operator === 'gte') return comparableLeft >= comparableRight;
      if (operator === 'lt') return comparableLeft < comparableRight;
      return comparableLeft <= comparableRight;
    }
    const leftText = String(comparableLeft);
    const rightText = String(comparableRight);
    if (operator === 'gt') return leftText > rightText;
    if (operator === 'gte') return leftText >= rightText;
    if (operator === 'lt') return leftText < rightText;
    return leftText <= rightText;
  }
  return comparableLeft === comparableRight;
}

function goTo(project: Project, state: EngineState, target?: string): EngineState {
  if (!target || !project.scripts[target]) return { ...state, finished: true, error: `无效的片段目标：${target || '未设置'}` };
  return { ...state, fragmentId: target, instructionPointer: 0, finished: false };
}

function prepareVisible(state: EngineState, block: StoryBlock, project: Project): EngineState {
  if (block.type !== 'dialogue' && block.type !== 'narration') return state;
  let next = state.audio.voice.playing
    ? { ...state, audio: { ...state.audio, voice: { ...state.audio.voice, playing: false, fadeDuration: .12 } } }
    : state;
  if (block.type !== 'dialogue') return next;
  if (block.voice) {
    const voiceAsset = project.assets.find((asset) => assetMatchesTrack(asset, block.voice));
    next = { ...next, audio: { ...next.audio, voice: { track: voiceAsset?.name ?? block.voice, assetId: voiceAsset?.id, playing: true, volume: 1, loop: false, fadeDuration: 0 } } };
  }

  const character = project.characters.find((item) => item.name === block.speaker || item.id === block.speaker);
  const expression = block.expression ?? character?.expressions[0] ?? '默认';
  const assetId = character?.portraits?.[expression];
  if (!character) return next;

  const previous = next.stage.characters[character.id];
  const stageCharacter = previous
    ? { ...previous, expression, assetId }
    : { characterId: character.id, expression, assetId, position: character.defaultPosition ?? 'center' as const, x: 50, y: 100, scale: character.defaultScale ?? 1, opacity: 1, layer: character.defaultLayer ?? 0, animation: 'fade' as const, width: character.portraitWidth, height: character.portraitHeight, overlays: character.overlays };
  return { ...next, stage: { ...next.stage, characters: { ...next.stage.characters, [character.id]: stageCharacter } } };
}

const variablesFingerprintCache = new WeakMap<Record<string, string | number | boolean>, string>();

function variablesFingerprint(variables: Record<string, string | number | boolean>): string {
  const cached = variablesFingerprintCache.get(variables);
  if (cached !== undefined) return cached;
  const fingerprint = Object.keys(variables)
    .sort()
    .map((name) => `${JSON.stringify(name)}:${JSON.stringify(variables[name])}`)
    .join(',');
  variablesFingerprintCache.set(variables, fingerprint);
  return fingerprint;
}

function controlStateFingerprint(state: EngineState): string {
  const callStack = state.callStack
    .map((frame) => `${JSON.stringify(frame.fragmentId)}:${frame.instructionPointer}`)
    .join(',');
  return `${JSON.stringify(state.fragmentId)}\u001f${state.instructionPointer}\u001f${variablesFingerprint(state.variables)}\u001f${callStack}`;
}

function settle(project: Project, initial: EngineState, options: ExecutionOptions = RUNTIME_EXECUTION): EngineState {
  let state = initial;
  for (let guard = 0; guard < MAX_SETTLE_STEPS; guard += 1) {
    if (options.visitedControlStates) {
      const fingerprint = controlStateFingerprint(state);
      if (options.visitedControlStates.has(fingerprint)) {
        return { ...state, finished: true, error: `预览定位检测到确定性循环：${state.fragmentId} · Block ${state.instructionPointer + 1}` };
      }
      options.visitedControlStates.add(fingerprint);
    }
    const blocks = project.scripts[state.fragmentId] ?? [];
    if (state.instructionPointer >= blocks.length) {
      const frame = state.callStack.at(-1);
      if (!frame) return { ...state, finished: true };
      state = { ...state, fragmentId: frame.fragmentId, instructionPointer: frame.instructionPointer, callStack: state.callStack.slice(0, -1) };
      continue;
    }
    const current = blocks[state.instructionPointer];
    if (current.type === 'narration' || current.type === 'dialogue' || current.type === 'branch') {
      const visibleState = prepareVisible(state, current, project);
      return appendTrace(visibleState, [traceLocation(visibleState, current)], options.cloneSnapshots);
    }
    const location = traceLocation(state, current);
    if (current.type === 'scene' || current.type === 'sound' || current.type === 'characterShow' || current.type === 'characterHide' || current.type === 'camera' || current.type === 'setVariable' || current.type === 'modifyVariable') {
      state = { ...applySideEffect(state, current, project), instructionPointer: state.instructionPointer + 1, stepsExecuted: state.stepsExecuted + 1 };
    } else if (current.type === 'jump') {
      state = goTo(project, { ...state, stepsExecuted: state.stepsExecuted + 1 }, current.target);
    } else if (current.type === 'condition') {
      const right = current.compareVariable ? state.variables[current.compareVariable] : current.compareValue;
      const passed = compareValues(state.variables[current.variable ?? ''], current.operator, right);
      const target = passed ? current.trueTarget : current.falseTarget;
      state = target ? goTo(project, state, target) : { ...state, instructionPointer: state.instructionPointer + 1 };
      state = { ...state, stepsExecuted: state.stepsExecuted + 1 };
    } else if (current.type === 'call') {
      const frame = { fragmentId: state.fragmentId, instructionPointer: state.instructionPointer + 1 };
      state = goTo(project, { ...state, callStack: [...state.callStack, frame], stepsExecuted: state.stepsExecuted + 1 }, current.target);
    } else if (current.type === 'return') {
      const frame = state.callStack.at(-1);
      if (!frame) {
        state = { ...state, finished: true, error: '返回指令没有对应的调用栈帧', stepsExecuted: state.stepsExecuted + 1 };
        return appendTrace(state, [{ ...location, step: state.stepsExecuted }], options.cloneSnapshots);
      }
      state = { ...state, fragmentId: frame.fragmentId, instructionPointer: frame.instructionPointer, callStack: state.callStack.slice(0, -1), stepsExecuted: state.stepsExecuted + 1 };
    }
    state = appendTrace(state, [{ ...location, step: state.stepsExecuted }], options.cloneSnapshots);
    if (state.error) return state;
  }
  return { ...state, finished: true, error: `流程执行超过 ${MAX_SETTLE_STEPS} 步，可能存在无限循环` };
}

function createEngineStateWithOptions(project: Project, fragmentId: string, options: ExecutionOptions): EngineState {
  return settle(project, {
    fragmentId,
    instructionPointer: 0,
    variables: options.cloneSnapshots ? clone(project.variables) : { ...project.variables },
    stage: initialStage(),
    audio: { bgm: emptyAudioChannel(), sfx: emptyAudioChannel(), voice: emptyAudioChannel() },
    callStack: [],
    readBlocks: {},
    backlog: [],
    rollbackStack: [],
    stepsExecuted: 0,
    executionTrace: [],
    traceCursor: -1,
    finished: false,
  }, options);
}

export function createEngineState(project: Project, fragmentId = project.activeFragmentId): EngineState {
  return createEngineStateWithOptions(project, fragmentId, RUNTIME_EXECUTION);
}

export function currentBlock(project: Project, state: EngineState): StoryBlock | undefined {
  return project.scripts[state.fragmentId]?.[state.instructionPointer];
}

export function resolveDialogueSpeaker(project: Project, block: StoryBlock | undefined, variables: Record<string, string | number | boolean>): string {
  if (block?.type !== 'dialogue') return '';
  const character = project.characters.find((item) => item.id === block.speaker || item.name === block.speaker);
  if (!character) return block.speaker ?? '';
  const scheme = character.displayNameSchemes?.find((item) => item.id === block.displayNameSchemeId);
  if (!scheme) return character.name;
  const resolved = scheme.kind === 'fixed' ? scheme.value : scheme.kind === 'variable' ? variables[scheme.value] : character.attributes?.[scheme.value];
  return String(resolved ?? '').trim() || character.name;
}

function advanceEngineWithOptions(project: Project, state: EngineState, options: ExecutionOptions): EngineState {
  const current = currentBlock(project, state);
  if (!current || current.type === 'branch') return state;
  if (current.type !== 'dialogue' && current.type !== 'narration') {
    return settle(project, { ...state, finished: false, error: undefined }, options);
  }
  let next = options.captureRollback ? withRollback(state, options.cloneSnapshots) : state;
  if (current.type === 'dialogue' || current.type === 'narration') {
    const voiceAsset = current.type === 'dialogue' && current.voice
      ? project.assets.find((asset) => assetMatchesTrack(asset, current.voice))
      : undefined;
    next = { ...next, readBlocks: { ...next.readBlocks, [current.id]: true }, backlog: [...next.backlog, { blockId: current.id, fragmentId: state.fragmentId, speaker: current.type === 'dialogue' ? resolveDialogueSpeaker(project, current, state.variables) : undefined, text: current.text ?? '', voiceAssetId: voiceAsset?.id, timestamp: Date.now() }].slice(-MAX_BACKLOG) };
  }
  return settle(project, { ...next, instructionPointer: state.instructionPointer + 1, finished: false, error: undefined }, options);
}

export function advanceEngine(project: Project, state: EngineState): EngineState {
  return advanceEngineWithOptions(project, state, RUNTIME_EXECUTION);
}

export function chooseBranch(project: Project, state: EngineState, target: string): EngineState {
  const next = withRollback(state);
  if (!project.scripts[target]) return { ...next, finished: true, error: `无效的分支目标：${target}` };
  return settle(project, { ...next, fragmentId: target, instructionPointer: 0, finished: false, error: undefined });
}

function preserveSharedVariables(
  restored: Record<string, string | number | boolean>,
  current: Record<string, string | number | boolean>,
  sharedVariableNames: readonly string[],
) {
  if (!sharedVariableNames.length) return restored;
  const variables = { ...restored };
  for (const name of sharedVariableNames) if (name in current) variables[name] = current[name];
  return variables;
}

export function rollbackEngine(state: EngineState, sharedVariableNames: readonly string[] = []): EngineState {
  const previous = state.rollbackStack.at(-1);
  if (!previous) return state;
  let traceCursor = -1;
  for (let index = state.executionTrace.length - 1; index >= 0; index -= 1) {
    const entry = state.executionTrace[index];
    if (entry.snapshot.fragmentId === previous.fragmentId && entry.snapshot.instructionPointer === previous.instructionPointer) {
      traceCursor = index;
      break;
    }
  }
  if (traceCursor < 0) traceCursor = Math.max(-1, state.traceCursor - 1);
  return { ...clone(previous), variables: preserveSharedVariables(previous.variables, state.variables, sharedVariableNames), rollbackStack: state.rollbackStack.slice(0, -1), stepsExecuted: state.executionTrace[traceCursor]?.step ?? state.stepsExecuted, executionTrace: state.executionTrace.slice(0, traceCursor + 1), traceCursor };
}

export function restoreTraceState(state: EngineState, traceIndex: number, sharedVariableNames: readonly string[] = []): EngineState {
  const traceCursor = Math.max(0, Math.min(traceIndex, state.executionTrace.length - 1));
  const entry = state.executionTrace[traceCursor];
  if (!entry) return state;
  const rollbackStack = state.executionTrace.slice(0, traceCursor).map((item) => clone(item.snapshot)).slice(-MAX_ROLLBACKS);
  return {
    ...clone(entry.snapshot),
    variables: preserveSharedVariables(entry.snapshot.variables, state.variables, sharedVariableNames),
    rollbackStack,
    stepsExecuted: entry.step,
    executionTrace: state.executionTrace,
    traceCursor,
  };
}

interface FragmentSeekCacheSource {
  scripts: Project['scripts'];
  characters: Project['characters'];
  assets: Project['assets'];
  variables: Project['variables'];
}

interface FragmentSeekCacheEntry {
  source: FragmentSeekCacheSource;
  initialState?: EngineState;
  checkpoints: Map<number, EngineState>;
  results: Map<number, EngineState | WeakRef<EngineState>>;
}

const MAX_CACHED_SEEK_FRAGMENTS = 128;
const MAX_CACHED_SEEK_CHECKPOINT_FRAGMENTS = 8;
const MAX_CACHED_SEEK_RESULTS = 64;
const MAX_CACHED_SEEK_CHECKPOINTS = 128;

export interface EngineSeekCacheStats {
  exactHits: number;
  checkpointHits: number;
  misses: number;
  invalidations: number;
  evictions: number;
  weakReclaims: number;
  cachedFragments: number;
  cachedResults: number;
  cachedStrongResults: number;
  cachedWeakResults: number;
  cachedCheckpoints: number;
}

function seekCacheSource(project: Project): FragmentSeekCacheSource {
  return { scripts: project.scripts, characters: project.characters, assets: project.assets, variables: project.variables };
}

function matchesSeekCacheSource(left: FragmentSeekCacheSource, right: FragmentSeekCacheSource): boolean {
  return left.scripts === right.scripts
    && left.characters === right.characters
    && left.assets === right.assets
    && left.variables === right.variables;
}

function detachSeekState(state: EngineState): EngineState {
  return {
    ...state,
    variables: { ...state.variables },
    stage: {
      ...state.stage,
      sceneLayers: state.stage.sceneLayers.map((layer) => ({ ...layer })),
      camera: { ...state.stage.camera },
      characters: Object.fromEntries(Object.entries(state.stage.characters).map(([id, character]) => [id, {
        ...character,
        overlays: character.overlays?.map((overlay) => ({ ...overlay })),
      }])),
    },
    audio: {
      bgm: { ...state.audio.bgm },
      sfx: { ...state.audio.sfx },
      voice: { ...state.audio.voice },
    },
    callStack: state.callStack.map((frame) => ({ ...frame })),
    readBlocks: { ...state.readBlocks },
    backlog: state.backlog.map((entry) => ({ ...entry })),
    rollbackStack: [],
    executionTrace: state.executionTrace.slice(),
  };
}

export class EngineSeekCache {
  private scriptCaches = new WeakMap<Project['scripts'], Map<string, FragmentSeekCacheEntry>>();
  private checkpointFragmentLrus = new WeakMap<Project['scripts'], string[]>();
  private activeProjectCache?: Map<string, FragmentSeekCacheEntry>;
  private counters: EngineSeekCacheStats = {
    exactHits: 0,
    checkpointHits: 0,
    misses: 0,
    invalidations: 0,
    evictions: 0,
    weakReclaims: 0,
    cachedFragments: 0,
    cachedResults: 0,
    cachedStrongResults: 0,
    cachedWeakResults: 0,
    cachedCheckpoints: 0,
  };

  clear(): void {
    this.scriptCaches = new WeakMap();
    this.checkpointFragmentLrus = new WeakMap();
    this.activeProjectCache = undefined;
    this.counters = {
      exactHits: 0,
      checkpointHits: 0,
      misses: 0,
      invalidations: 0,
      evictions: 0,
      weakReclaims: 0,
      cachedFragments: 0,
      cachedResults: 0,
      cachedStrongResults: 0,
      cachedWeakResults: 0,
      cachedCheckpoints: 0,
    };
  }

  stats(): EngineSeekCacheStats {
    const entries = this.activeProjectCache ? [...this.activeProjectCache.values()] : [];
    let cachedStrongResults = 0;
    let cachedWeakResults = 0;
    for (const entry of entries) {
      for (const [index, cached] of entry.results) {
        if (!(cached instanceof WeakRef)) {
          cachedStrongResults += 1;
          continue;
        }
        if (cached.deref()) cachedWeakResults += 1;
        else {
          entry.results.delete(index);
          this.counters.weakReclaims += 1;
        }
      }
    }
    return {
      ...this.counters,
      cachedFragments: entries.length,
      cachedResults: cachedStrongResults + cachedWeakResults,
      cachedStrongResults,
      cachedWeakResults,
      cachedCheckpoints: entries.reduce((total, entry) => total + entry.checkpoints.size, 0),
    };
  }

  seek(project: Project, fragmentId: string, targetIndex: number): EngineState {
    const blocks = project.scripts[fragmentId] ?? [];
    const requestedIndex = Number.isFinite(targetIndex) ? Math.floor(targetIndex) : 0;
    const limit = Math.max(0, Math.min(requestedIndex, Math.max(0, blocks.length - 1)));
    let projectCache = this.scriptCaches.get(project.scripts);
    if (!projectCache) {
      projectCache = new Map();
      this.scriptCaches.set(project.scripts, projectCache);
      this.checkpointFragmentLrus.set(project.scripts, []);
    }
    this.activeProjectCache = projectCache;

    const source = seekCacheSource(project);
    let entry = projectCache.get(fragmentId);
    if (entry && !matchesSeekCacheSource(entry.source, source)) {
      projectCache.delete(fragmentId);
      entry = undefined;
      this.counters.invalidations += 1;
    }
    if (!entry) {
      const initialVisited = new Set<string>();
      const initialState = createEngineStateWithOptions(project, fragmentId, { ...SEEK_EXECUTION, visitedControlStates: initialVisited });
      entry = {
        source,
        initialState,
        checkpoints: new Map([[initialState.instructionPointer, initialState]]),
        results: new Map(),
      };
      projectCache.set(fragmentId, entry);
      while (projectCache.size > MAX_CACHED_SEEK_FRAGMENTS) {
        const oldestFragment = projectCache.keys().next().value;
        if (oldestFragment === undefined) break;
        projectCache.delete(oldestFragment);
        const checkpointLru = this.checkpointFragmentLrus.get(project.scripts);
        if (checkpointLru) {
          const hotIndex = checkpointLru.indexOf(oldestFragment);
          if (hotIndex >= 0) checkpointLru.splice(hotIndex, 1);
        }
        this.counters.evictions += 1;
      }
    } else {
      projectCache.delete(fragmentId);
      projectCache.set(fragmentId, entry);
    }

    const checkpointLru = this.checkpointFragmentLrus.get(project.scripts) ?? [];
    const currentHotIndex = checkpointLru.indexOf(fragmentId);
    if (currentHotIndex >= 0) checkpointLru.splice(currentHotIndex, 1);
    checkpointLru.push(fragmentId);
    this.checkpointFragmentLrus.set(project.scripts, checkpointLru);
    while (checkpointLru.length > MAX_CACHED_SEEK_CHECKPOINT_FRAGMENTS) {
      const releasedFragmentId = checkpointLru.shift();
      if (!releasedFragmentId) break;
      const releasedEntry = projectCache.get(releasedFragmentId);
      if (!releasedEntry) continue;
      releasedEntry.initialState = undefined;
      releasedEntry.checkpoints.clear();
      for (const [index, cached] of releasedEntry.results) {
        if (!(cached instanceof WeakRef)) releasedEntry.results.set(index, new WeakRef(cached));
      }
    }

    const cachedExact = entry.results.get(limit);
    const exact = cachedExact instanceof WeakRef ? cachedExact.deref() : cachedExact;
    if (exact) {
      this.counters.exactHits += 1;
      entry.results.delete(limit);
      entry.results.set(limit, exact);
      return detachSeekState(exact);
    }
    if (cachedExact) {
      entry.results.delete(limit);
      this.counters.weakReclaims += 1;
    }
    this.counters.misses += 1;

    if (!entry.initialState) {
      const initialVisited = new Set<string>();
      entry.initialState = createEngineStateWithOptions(project, fragmentId, { ...SEEK_EXECUTION, visitedControlStates: initialVisited });
      entry.checkpoints.set(entry.initialState.instructionPointer, entry.initialState);
    }

    let state = entry.initialState;
    for (const checkpoint of entry.checkpoints.values()) {
      if (checkpoint.finished || checkpoint.error || checkpoint.fragmentId !== fragmentId) continue;
      if (checkpoint.instructionPointer <= limit && checkpoint.instructionPointer > state.instructionPointer) state = checkpoint;
    }
    if (state !== entry.initialState) this.counters.checkpointHits += 1;

    const visitedControlStates = new Set<string>([controlStateFingerprint(state)]);
    const options: ExecutionOptions = { ...SEEK_EXECUTION, visitedControlStates };
    let guard = 0;
    for (; !state.finished && state.fragmentId === fragmentId && state.instructionPointer < limit && guard < MAX_SETTLE_STEPS; guard += 1) {
      const current = currentBlock(project, state);
      state = current?.type === 'branch'
        ? settle(project, { ...state, instructionPointer: state.instructionPointer + 1 }, options)
        : advanceEngineWithOptions(project, state, options);
      if (
        !state.finished
        && !state.error
        && state.fragmentId === fragmentId
        && state.instructionPointer % SEEK_CHECKPOINT_INTERVAL === 0
        && !entry.checkpoints.has(state.instructionPointer)
      ) {
        entry.checkpoints.set(state.instructionPointer, state);
        while (entry.checkpoints.size > MAX_CACHED_SEEK_CHECKPOINTS) {
          const removable = [...entry.checkpoints.keys()].find((pointer) => pointer !== entry.initialState?.instructionPointer);
          if (removable === undefined) break;
          entry.checkpoints.delete(removable);
          this.counters.evictions += 1;
        }
      }
    }
    if (guard >= MAX_SETTLE_STEPS && !state.finished && !state.error) {
      state = { ...state, finished: true, error: `预览定位超过 ${MAX_SETTLE_STEPS} 步，可能存在无限循环` };
    }
    const result = { ...state, rollbackStack: [] };
    if (!result.finished && !result.error && result.fragmentId === fragmentId && !entry.checkpoints.has(result.instructionPointer)) {
      entry.checkpoints.set(result.instructionPointer, result);
      while (entry.checkpoints.size > MAX_CACHED_SEEK_CHECKPOINTS) {
        const removable = [...entry.checkpoints.keys()].find((pointer) => pointer !== entry.initialState?.instructionPointer);
        if (removable === undefined) break;
        entry.checkpoints.delete(removable);
        this.counters.evictions += 1;
      }
    }
    entry.results.set(limit, result);
    while (entry.results.size > MAX_CACHED_SEEK_RESULTS) {
      const oldestResult = entry.results.keys().next().value;
      if (oldestResult === undefined) break;
      entry.results.delete(oldestResult);
      this.counters.evictions += 1;
    }
    return detachSeekState(result);
  }
}

const MAX_CACHED_TRACE_RESTORES = 128;

export interface EngineTraceRestoreCacheStats {
  exactHits: number;
  misses: number;
  invalidations: number;
  evictions: number;
  cachedResults: number;
}

function sharedTraceRestoreState(
  restored: EngineState,
  currentVariables: Record<string, string | number | boolean>,
  sharedVariableNames: readonly string[],
): EngineState {
  const variables = preserveSharedVariables(restored.variables, currentVariables, sharedVariableNames);
  return variables === restored.variables ? restored : { ...restored, variables };
}

export class EngineTraceRestoreCache {
  private traceCaches = new WeakMap<EngineState['executionTrace'], Map<number, EngineState>>();
  private activeTrace?: EngineState['executionTrace'];
  private activeCache?: Map<number, EngineState>;
  private counters: EngineTraceRestoreCacheStats = { exactHits: 0, misses: 0, invalidations: 0, evictions: 0, cachedResults: 0 };

  clear(): void {
    this.traceCaches = new WeakMap();
    this.activeTrace = undefined;
    this.activeCache = undefined;
    this.counters = { exactHits: 0, misses: 0, invalidations: 0, evictions: 0, cachedResults: 0 };
  }

  stats(): EngineTraceRestoreCacheStats {
    return { ...this.counters, cachedResults: this.activeCache?.size ?? 0 };
  }

  restore(state: EngineState, traceIndex: number, sharedVariableNames: readonly string[] = []): EngineState {
    const trace = state.executionTrace;
    if (!trace.length) return state;
    const traceCursor = Math.max(0, Math.min(Math.floor(traceIndex), trace.length - 1));
    if (this.activeTrace && this.activeTrace !== trace) this.counters.invalidations += 1;
    this.activeTrace = trace;
    let cache = this.traceCaches.get(trace);
    if (!cache) {
      cache = new Map();
      this.traceCaches.set(trace, cache);
    }
    this.activeCache = cache;

    const exact = cache.get(traceCursor);
    if (exact) {
      this.counters.exactHits += 1;
      cache.delete(traceCursor);
      cache.set(traceCursor, exact);
      return sharedTraceRestoreState(exact, state.variables, sharedVariableNames);
    }
    this.counters.misses += 1;

    const entry = trace[traceCursor];
    const rollbackStart = Math.max(0, traceCursor - MAX_ROLLBACKS);
    const restored: EngineState = {
      ...entry.snapshot,
      rollbackStack: trace.slice(rollbackStart, traceCursor).map((item) => item.snapshot),
      stepsExecuted: entry.step,
      executionTrace: trace,
      traceCursor,
    };
    cache.set(traceCursor, restored);
    while (cache.size > MAX_CACHED_TRACE_RESTORES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
      this.counters.evictions += 1;
    }
    return sharedTraceRestoreState(restored, state.variables, sharedVariableNames);
  }
}

let defaultEngineSeekCache: EngineSeekCache | undefined;

export function seekEngine(project: Project, fragmentId: string, targetIndex: number, cache?: EngineSeekCache): EngineState {
  const activeCache = cache ?? (defaultEngineSeekCache ??= new EngineSeekCache());
  return activeCache.seek(project, fragmentId, targetIndex);
}

export function createSaveGame(project: Project, state: EngineState, slotType: SaveGame['slotType'] = 'manual', label?: string, metadata: Partial<Pick<SaveGame, 'slotId' | 'fragmentName' | 'chapterName' | 'playTimeSeconds' | 'thumbnail'>> = {}): SaveGame {
  return { projectId: project.meta.id, projectVersion: project.version, engineVersion: ENGINE_VERSION, savedAt: new Date().toISOString(), slotType, label, ...metadata, state: clone(state), historySummary: { readCount: Object.keys(state.readBlocks).length, backlogCount: state.backlog.length } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSaveState(project: Project, save: SaveGame, currentVariables: Record<string, string | number | boolean>, warnings: string[]): EngineState {
  if (!isRecord(save.state)) throw new SaveGameLoadError('INVALID_SAVE_STATE', '存档运行状态缺失或格式无效');
  const raw = clone(save.state) as EngineState & { audio?: unknown; stage?: unknown };
  if (typeof raw.fragmentId !== 'string' || !project.scripts[raw.fragmentId]) {
    throw new SaveGameLoadError('MISSING_FRAGMENT', `存档引用的剧情片段已不存在：${String(raw.fragmentId ?? '未设置')}`);
  }
  if (!Number.isFinite(raw.instructionPointer)) throw new SaveGameLoadError('INVALID_SAVE_STATE', '存档指令位置无效');
  const legacyAudio = isRecord(raw.audio) ? raw.audio as unknown as AudioChannelState : undefined;
  const audio = isRecord(raw.audio) && 'bgm' in raw.audio
    ? raw.audio as EngineState['audio']
    : { bgm: { ...emptyAudioChannel(), ...legacyAudio, playing: Boolean(legacyAudio?.track) }, sfx: emptyAudioChannel(), voice: emptyAudioChannel() };
  const rawStage = isRecord(raw.stage) ? raw.stage as Partial<StageState> : {};
  const stage = 'characters' in rawStage
    ? { ...initialStage(), ...rawStage, sceneLayers: rawStage.sceneLayers ?? [], characters: rawStage.characters ?? {} }
    : { ...initialStage(), ...rawStage };
  const executionTrace = Array.isArray(raw.executionTrace) ? raw.executionTrace : [];
  const callStack = Array.isArray(raw.callStack)
    ? raw.callStack.filter((frame) => frame && typeof frame.fragmentId === 'string' && Boolean(project.scripts[frame.fragmentId]) && Number.isFinite(frame.instructionPointer))
    : [];
  if (callStack.length !== (Array.isArray(raw.callStack) ? raw.callStack.length : 0)) warnings.push('已移除指向不存在片段的调用栈记录');
  const sharedVariableNames = Object.entries(project.variableDefinitions ?? {}).filter(([, definition]) => definition.persistence === 'shared').map(([name]) => name);
  const fragmentLength = project.scripts[raw.fragmentId].length;
  const instructionPointer = Math.max(0, Math.min(Math.floor(raw.instructionPointer), fragmentLength));
  if (instructionPointer !== raw.instructionPointer) warnings.push('存档指令位置已调整到当前剧情范围');
  return {
    ...raw,
    fragmentId: raw.fragmentId,
    instructionPointer,
    stage: stage as StageState,
    audio: {
      bgm: { ...emptyAudioChannel(), ...audio.bgm },
      sfx: { ...emptyAudioChannel(), ...audio.sfx },
      voice: { ...emptyAudioChannel(), ...audio.voice },
    },
    variables: preserveSharedVariables(isRecord(raw.variables) ? raw.variables as Record<string, string | number | boolean> : {}, currentVariables, sharedVariableNames),
    callStack,
    readBlocks: isRecord(raw.readBlocks) ? raw.readBlocks as Record<string, true> : {},
    backlog: Array.isArray(raw.backlog) ? raw.backlog : [],
    rollbackStack: [],
    stepsExecuted: Number.isFinite(raw.stepsExecuted) ? raw.stepsExecuted : 0,
    executionTrace,
    traceCursor: Math.max(-1, Math.min(Number.isFinite(raw.traceCursor) ? raw.traceCursor : executionTrace.length - 1, executionTrace.length - 1)),
    finished: Boolean(raw.finished),
  };
}

export function inspectSaveGameCompatibility(project: Project, save: SaveGame): SaveGameCompatibility {
  if (save.projectId !== project.meta.id) throw new SaveGameLoadError('PROJECT_MISMATCH', '该存档属于其他游戏，已阻止读取');
  const fromEngineVersion = Number.isFinite(save.engineVersion) ? save.engineVersion : 1;
  if (fromEngineVersion > ENGINE_VERSION) throw new SaveGameLoadError('FUTURE_ENGINE_VERSION', `存档引擎版本 ${fromEngineVersion} 高于当前版本 ${ENGINE_VERSION}`);
  const warnings: string[] = [];
  if (save.projectVersion > project.version) warnings.push(`存档来自更新的项目版本 v${save.projectVersion}，部分内容可能发生变化`);
  else if (save.projectVersion < project.version) warnings.push(`存档来自项目 v${save.projectVersion}，将按当前项目 v${project.version} 兼容读取`);
  return { warnings, migrated: fromEngineVersion < ENGINE_VERSION, fromEngineVersion };
}

export function loadSaveGameWithReport(project: Project, source: SaveGame, currentVariables: Record<string, string | number | boolean> = {}): SaveGameLoadResult {
  const compatibility = inspectSaveGameCompatibility(project, source);
  const warnings = [...compatibility.warnings];
  const state = normalizeSaveState(project, source, currentVariables, warnings);
  const save = clone(source);
  if (compatibility.migrated) {
    save.engineVersion = ENGINE_VERSION;
    save.state = clone(state);
    save.migration = { fromEngineVersion: compatibility.fromEngineVersion, migratedAt: new Date().toISOString(), steps: [`engine-${compatibility.fromEngineVersion}-to-${ENGINE_VERSION}`] };
  }
  return { save, state, warnings, migrated: compatibility.migrated, fromEngineVersion: compatibility.fromEngineVersion };
}

export function loadSaveGame(project: Project, save: SaveGame, currentVariables: Record<string, string | number | boolean> = {}): EngineState {
  return loadSaveGameWithReport(project, save, currentVariables).state;
}
