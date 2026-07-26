import type { ConditionOperator, Project, StoryBlock } from '../types';
import type { AudioChannelState, EngineSnapshot, EngineState, EngineTraceEntry, SaveGame, StageState } from './types';

export const ENGINE_VERSION = 3;
const MAX_SETTLE_STEPS = 1000;
const MAX_ROLLBACKS = 100;
const MAX_BACKLOG = 500;
const MAX_TRACE_ENTRIES = 2000;
const clone = <T,>(value: T): T => structuredClone(value);

const emptyAudioChannel = (): AudioChannelState => ({ playing: false, volume: 1, loop: false, fadeDuration: 0 });
const initialStage = (): StageState => ({
  transitionDuration: 0,
  sceneLayers: [],
  characters: {},
  camera: { x: 0, y: 0, zoom: 1, rotation: 0, shake: 0, filter: 'none', duration: 0 },
});

function snapshot(state: EngineState): EngineSnapshot {
  const {
    rollbackStack: _rollbackStack,
    stepsExecuted: _stepsExecuted,
    executionTrace: _executionTrace,
    traceCursor: _traceCursor,
    ...rest
  } = state;
  return clone(rest);
}

type TraceLocation = Pick<EngineTraceEntry, 'fragmentId' | 'instructionPointer' | 'blockId' | 'blockType' | 'step'>;

function appendTrace(state: EngineState, locations: TraceLocation[]): EngineState {
  if (!locations.length) return state;
  const currentTrace = state.traceCursor < state.executionTrace.length - 1
    ? state.executionTrace.slice(0, state.traceCursor + 1)
    : state.executionTrace;
  const finalSnapshot = snapshot(state);
  const appended = locations.map((location, index): EngineTraceEntry => ({
    ...location,
    id: `${location.fragmentId}:${location.instructionPointer}:${currentTrace.length + index}`,
    snapshot: clone(finalSnapshot),
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

function withRollback(state: EngineState): EngineState {
  return { ...state, rollbackStack: [...state.rollbackStack, snapshot(state)].slice(-MAX_ROLLBACKS) };
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
  return state;
}

export function compareValues(left: unknown, operator: ConditionOperator | undefined, right: unknown): boolean {
  if (operator === 'neq') return left !== right;
  if (operator === 'gt') return Number(left) > Number(right);
  if (operator === 'gte') return Number(left) >= Number(right);
  if (operator === 'lt') return Number(left) < Number(right);
  if (operator === 'lte') return Number(left) <= Number(right);
  return left === right;
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
    const voiceAsset = project.assets.find((asset) => asset.id === block.voice || asset.name === block.voice || asset.path.endsWith(block.voice ?? ''));
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

function settle(project: Project, initial: EngineState): EngineState {
  let state = initial;
  for (let guard = 0; guard < MAX_SETTLE_STEPS; guard += 1) {
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
      return appendTrace(visibleState, [traceLocation(visibleState, current)]);
    }
    const location = traceLocation(state, current);
    if (current.type === 'scene' || current.type === 'sound' || current.type === 'characterShow' || current.type === 'characterHide' || current.type === 'camera' || current.type === 'setVariable') {
      state = { ...applySideEffect(state, current, project), instructionPointer: state.instructionPointer + 1, stepsExecuted: state.stepsExecuted + 1 };
    } else if (current.type === 'jump') {
      state = goTo(project, { ...state, stepsExecuted: state.stepsExecuted + 1 }, current.target);
    } else if (current.type === 'condition') {
      const passed = compareValues(state.variables[current.variable ?? ''], current.operator, current.compareValue);
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
        return appendTrace(state, [{ ...location, step: state.stepsExecuted }]);
      }
      state = { ...state, fragmentId: frame.fragmentId, instructionPointer: frame.instructionPointer, callStack: state.callStack.slice(0, -1), stepsExecuted: state.stepsExecuted + 1 };
    }
    state = appendTrace(state, [{ ...location, step: state.stepsExecuted }]);
    if (state.error) return state;
  }
  return { ...state, finished: true, error: `流程执行超过 ${MAX_SETTLE_STEPS} 步，可能存在无限循环` };
}

export function createEngineState(project: Project, fragmentId = project.activeFragmentId): EngineState {
  return settle(project, { fragmentId, instructionPointer: 0, variables: clone(project.variables), stage: initialStage(), audio: { bgm: emptyAudioChannel(), sfx: emptyAudioChannel(), voice: emptyAudioChannel() }, callStack: [], readBlocks: {}, backlog: [], rollbackStack: [], stepsExecuted: 0, executionTrace: [], traceCursor: -1, finished: false });
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

export function advanceEngine(project: Project, state: EngineState): EngineState {
  const current = currentBlock(project, state);
  if (!current || current.type === 'branch') return state;
  if (current.type !== 'dialogue' && current.type !== 'narration') {
    return settle(project, { ...state, finished: false, error: undefined });
  }
  let next = withRollback(state);
  if (current.type === 'dialogue' || current.type === 'narration') {
    const voiceAsset = current.type === 'dialogue' && current.voice
      ? project.assets.find((asset) => asset.id === current.voice || asset.name === current.voice || asset.path.endsWith(current.voice ?? ''))
      : undefined;
    next = { ...next, readBlocks: { ...next.readBlocks, [current.id]: true }, backlog: [...next.backlog, { blockId: current.id, fragmentId: state.fragmentId, speaker: current.type === 'dialogue' ? resolveDialogueSpeaker(project, current, state.variables) : undefined, text: current.text ?? '', voiceAssetId: voiceAsset?.id, timestamp: Date.now() }].slice(-MAX_BACKLOG) };
  }
  return settle(project, { ...next, instructionPointer: state.instructionPointer + 1, finished: false, error: undefined });
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

export function seekEngine(project: Project, fragmentId: string, targetIndex: number): EngineState {
  let state = createEngineState(project, fragmentId);
  const blocks = project.scripts[fragmentId] ?? [];
  const limit = Math.max(0, Math.min(targetIndex, Math.max(0, blocks.length - 1)));
  for (let guard = 0; !state.finished && state.fragmentId === fragmentId && state.instructionPointer < limit && guard < MAX_SETTLE_STEPS; guard += 1) {
    const current = currentBlock(project, state);
    state = current?.type === 'branch' ? settle(project, { ...state, instructionPointer: state.instructionPointer + 1 }) : advanceEngine(project, state);
  }
  return { ...state, rollbackStack: [] };
}

export function createSaveGame(project: Project, state: EngineState, slotType: SaveGame['slotType'] = 'manual', label?: string, metadata: Partial<Pick<SaveGame, 'slotId' | 'fragmentName' | 'chapterName' | 'playTimeSeconds' | 'thumbnail'>> = {}): SaveGame {
  return { projectId: project.meta.id, projectVersion: project.version, engineVersion: ENGINE_VERSION, savedAt: new Date().toISOString(), slotType, label, ...metadata, state: clone(state), historySummary: { readCount: Object.keys(state.readBlocks).length, backlogCount: state.backlog.length } };
}

export function loadSaveGame(project: Project, save: SaveGame, currentVariables: Record<string, string | number | boolean> = {}): EngineState {
  if (save.projectId !== project.meta.id) throw new Error('存档不属于当前项目');
  if (save.engineVersion > ENGINE_VERSION) throw new Error(`存档引擎版本 ${save.engineVersion} 高于当前版本 ${ENGINE_VERSION}`);
  const raw = clone(save.state) as EngineState & { audio?: unknown; stage?: unknown };
  const audio = raw.audio && 'bgm' in raw.audio ? raw.audio : { bgm: { ...(raw.audio as AudioChannelState), playing: Boolean((raw.audio as AudioChannelState)?.track) }, sfx: emptyAudioChannel(), voice: emptyAudioChannel() };
  const stage = raw.stage && 'characters' in raw.stage ? { ...initialStage(), ...raw.stage, sceneLayers: raw.stage.sceneLayers ?? [] } : { ...initialStage(), ...(raw.stage as Partial<StageState>) };
  const executionTrace = raw.executionTrace ?? [];
  const sharedVariableNames = Object.entries(project.variableDefinitions ?? {}).filter(([, definition]) => definition.persistence === 'shared').map(([name]) => name);
  return { ...raw, stage: stage as StageState, audio: audio as EngineState['audio'], variables: preserveSharedVariables(raw.variables ?? {}, currentVariables, sharedVariableNames), readBlocks: raw.readBlocks ?? {}, backlog: raw.backlog ?? [], rollbackStack: [], stepsExecuted: raw.stepsExecuted ?? 0, executionTrace, traceCursor: Math.min(raw.traceCursor ?? executionTrace.length - 1, executionTrace.length - 1) };
}
