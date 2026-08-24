import type { BlockType, Project, StoryBlock } from '../types';
import { advanceEngine, chooseBranch, createEngineState, currentBlock } from './runtime';
import type { EngineState } from './types';

export type BlockConformanceAction =
  | { type: 'advance' }
  | { type: 'choose'; target: string };

export interface BlockConformanceObservation {
  location: { fragmentId: string; instructionPointer: number };
  current: {
    id: string;
    type: BlockType;
    text: string | null;
    speaker: string | null;
    title: string | null;
    options: Array<{ text: string; target: string }>;
  } | null;
  variables: Record<string, string | number | boolean>;
  stage: {
    backgroundAssetId: string | null;
    transition: string | null;
    transitionDuration: number;
    sceneLayers: Array<{
      id: string;
      assetId: string | null;
      opacity: number;
      blendMode: string;
      x: number;
      y: number;
      scale: number;
      layer: number;
      distance: number | null;
    }>;
    characters: Array<{
      characterId: string;
      expression: string;
      assetId: string | null;
      position: string;
      x: number;
      y: number;
      scale: number;
      opacity: number;
      layer: number;
      animation: string;
    }>;
    camera: EngineState['stage']['camera'];
  };
  audio: Record<'bgm' | 'sfx' | 'voice', {
    track: string | null;
    assetId: string | null;
    playing: boolean;
    volume: number;
    loop: boolean;
    fadeDuration: number;
  }>;
  callStack: Array<{ fragmentId: string; instructionPointer: number }>;
  readBlocks: string[];
  backlog: Array<{ blockId: string; fragmentId: string; speaker: string | null; text: string; voiceAssetId: string | null }>;
  trace: string[];
  finished: boolean;
  error: string | null;
}

export interface BlockConformanceCase {
  id: BlockType;
  project: Project;
  actions: BlockConformanceAction[];
  initialExpected: Record<string, unknown>;
  finalExpected: Record<string, unknown>;
}

export interface BlockConformanceRun {
  id: BlockType;
  observations: BlockConformanceObservation[];
}

export interface BlockConformanceHarness {
  surface: 'editor-preview' | 'web-runtime';
  caseId: BlockType;
  matrixVersion: string;
  getObservation: () => BlockConformanceObservation;
  advance: () => void;
  choose: (target: string) => void;
  reset: () => void;
}

const imageUri = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

function projectFor(scripts: Record<string, StoryBlock[]>, variables: Project['variables'] = {}): Project {
  const fragmentIds = Object.keys(scripts);
  return {
    version: 3,
    meta: { id: 'block-conformance', name: 'Block Conformance', author: '', resolution: [1280, 720], updatedAt: '' },
    characters: [{
      id: 'hero',
      name: 'Hero',
      color: '#d65b4a',
      expressions: ['default', 'smile'],
      portraits: { default: 'hero-default', smile: 'hero-smile' },
      defaultPosition: 'center',
      defaultScale: 1,
      defaultLayer: 1,
    }],
    chapters: [{ id: 'chapter', name: 'Chapter', entry: true, fragments: fragmentIds.map((id) => ({ id, name: id })) }],
    activeFragmentId: 'start',
    scripts,
    assets: [
      { id: 'background', kind: 'scene', name: 'Background', path: 'background.gif', uri: imageUri },
      { id: 'layer', kind: 'scene', name: 'Layer', path: 'layer.gif', uri: imageUri },
      { id: 'hero-default', kind: 'character', name: 'Hero Default', path: 'hero-default.gif', uri: imageUri },
      { id: 'hero-smile', kind: 'character', name: 'Hero Smile', path: 'hero-smile.gif', uri: imageUri },
      { id: 'music', kind: 'audio', name: 'Theme', path: 'theme.ogg', audioCategory: 'bgm' },
      { id: 'voice', kind: 'audio', name: 'Voice', path: 'voice.ogg', audioCategory: 'voice' },
    ],
    variables,
    settings: { textSpeed: 100, autoSave: false, skipRead: true },
  };
}

const end = (id = 'end', text = 'End'): StoryBlock => ({ id, type: 'narration', text });

export const BLOCK_CONFORMANCE_MATRIX: readonly BlockConformanceCase[] = [
  {
    id: 'scene',
    project: projectFor({ start: [
      { id: 'case-scene', type: 'scene', assetId: 'background', transition: 'crossfade', duration: 0.8, layers: [{ id: 'mist', name: 'Mist', assetId: 'layer', opacity: 0.45, blendMode: 'screen', x: 52, y: 48, scale: 1.1, layer: 3, distance: 1.4 }] },
      end(),
    ] }),
    actions: [],
    initialExpected: { current: { id: 'end', type: 'narration' }, stage: { backgroundAssetId: 'background', transition: 'crossfade', transitionDuration: 0.8, sceneLayers: [{ id: 'mist', assetId: 'layer', opacity: 0.45, blendMode: 'screen', x: 52, y: 48, scale: 1.1, layer: 3, distance: 1.4 }] }, trace: ['case-scene', 'end'] },
    finalExpected: {},
  },
  {
    id: 'sound',
    project: projectFor({ start: [{ id: 'case-sound', type: 'sound', title: 'Theme', assetId: 'music', channel: 'bgm', action: 'play', volume: 0.35, loop: true, fadeDuration: 0.4 }, end()] }),
    actions: [],
    initialExpected: { audio: { bgm: { track: 'Theme', assetId: 'music', playing: true, volume: 0.35, loop: true, fadeDuration: 0.4 } }, trace: ['case-sound', 'end'] },
    finalExpected: {},
  },
  {
    id: 'characterShow',
    project: projectFor({ start: [{ id: 'case-character-show', type: 'characterShow', characterId: 'hero', expression: 'smile', position: 'custom', x: 63, y: 92, scale: 1.1, opacity: 0.8, layer: 4, animation: 'slideLeft' }, end()] }),
    actions: [],
    initialExpected: { stage: { characters: [{ characterId: 'hero', expression: 'smile', assetId: 'hero-smile', position: 'custom', x: 63, y: 92, scale: 1.1, opacity: 0.8, layer: 4, animation: 'slideLeft' }] }, trace: ['case-character-show', 'end'] },
    finalExpected: {},
  },
  {
    id: 'characterHide',
    project: projectFor({ start: [{ id: 'setup-character', type: 'characterShow', characterId: 'hero' }, { id: 'case-character-hide', type: 'characterHide', characterId: 'hero', animation: 'fade' }, end()] }),
    actions: [],
    initialExpected: { stage: { characters: [] }, trace: ['setup-character', 'case-character-hide', 'end'] },
    finalExpected: {},
  },
  {
    id: 'camera',
    project: projectFor({ start: [{ id: 'case-camera', type: 'camera', cameraX: 18, cameraY: -7, zoom: 1.25, rotation: 3, shake: 0.2, filter: 'sepia', duration: 1.2 }, end()] }),
    actions: [],
    initialExpected: { stage: { camera: { x: 18, y: -7, zoom: 1.25, rotation: 3, shake: 0.2, filter: 'sepia', duration: 1.2 } }, trace: ['case-camera', 'end'] },
    finalExpected: {},
  },
  {
    id: 'narration',
    project: projectFor({ start: [{ id: 'case-narration', type: 'narration', text: 'Narration contract' }] }),
    actions: [{ type: 'advance' }],
    initialExpected: { current: { id: 'case-narration', type: 'narration', text: 'Narration contract' }, finished: false },
    finalExpected: { current: null, finished: true, readBlocks: ['case-narration'], backlog: [{ blockId: 'case-narration', fragmentId: 'start', speaker: null, text: 'Narration contract', voiceAssetId: null }] },
  },
  {
    id: 'dialogue',
    project: projectFor({ start: [{ id: 'case-dialogue', type: 'dialogue', speaker: 'Hero', expression: 'smile', text: 'Dialogue contract', voice: 'voice' }, end()] }),
    actions: [{ type: 'advance' }],
    initialExpected: { current: { id: 'case-dialogue', type: 'dialogue', text: 'Dialogue contract', speaker: 'Hero' }, stage: { characters: [{ characterId: 'hero', expression: 'smile', assetId: 'hero-smile' }] }, audio: { voice: { assetId: 'voice', playing: true } } },
    finalExpected: { current: { id: 'end', type: 'narration' }, readBlocks: ['case-dialogue'], backlog: [{ blockId: 'case-dialogue', fragmentId: 'start', speaker: 'Hero', text: 'Dialogue contract', voiceAssetId: 'voice' }], audio: { voice: { playing: false } } },
  },
  {
    id: 'branch',
    project: projectFor({ start: [{ id: 'case-branch', type: 'branch', title: 'Choose', options: [{ text: 'Continue', target: 'selected' }] }], selected: [end('selected-line', 'Selected')] }),
    actions: [{ type: 'choose', target: 'selected' }],
    initialExpected: { current: { id: 'case-branch', type: 'branch', title: 'Choose', options: [{ text: 'Continue', target: 'selected' }] } },
    finalExpected: { location: { fragmentId: 'selected', instructionPointer: 0 }, current: { id: 'selected-line', type: 'narration' }, trace: ['case-branch', 'selected-line'] },
  },
  {
    id: 'setVariable',
    project: projectFor({ start: [{ id: 'case-set-variable', type: 'setVariable', variable: 'score', value: 7 }, end()] }, { score: 0 }),
    actions: [],
    initialExpected: { variables: { score: 7 }, trace: ['case-set-variable', 'end'] },
    finalExpected: {},
  },
  {
    id: 'modifyVariable',
    project: projectFor({ start: [{ id: 'case-modify-variable', type: 'modifyVariable', variable: 'score', operation: 'add', operand: 5 }, end()] }, { score: 2 }),
    actions: [],
    initialExpected: { variables: { score: 7 }, trace: ['case-modify-variable', 'end'] },
    finalExpected: {},
  },
  {
    id: 'condition',
    project: projectFor({ start: [{ id: 'case-condition', type: 'condition', variable: 'score', compareVariable: 'threshold', operator: 'gte', trueTarget: 'passed', falseTarget: 'failed' }], passed: [end('passed-line', 'Passed')], failed: [end('failed-line', 'Failed')] }, { score: 7, threshold: 5 }),
    actions: [],
    initialExpected: { location: { fragmentId: 'passed', instructionPointer: 0 }, current: { id: 'passed-line', type: 'narration' }, trace: ['case-condition', 'passed-line'] },
    finalExpected: {},
  },
  {
    id: 'jump',
    project: projectFor({ start: [{ id: 'case-jump', type: 'jump', target: 'target' }], target: [end('target-line', 'Target')] }),
    actions: [],
    initialExpected: { location: { fragmentId: 'target', instructionPointer: 0 }, current: { id: 'target-line', type: 'narration' }, trace: ['case-jump', 'target-line'] },
    finalExpected: {},
  },
  {
    id: 'call',
    project: projectFor({ start: [{ id: 'case-call', type: 'call', target: 'called' }, end('after-call', 'After')], called: [end('called-line', 'Called')] }),
    actions: [],
    initialExpected: { location: { fragmentId: 'called', instructionPointer: 0 }, current: { id: 'called-line', type: 'narration' }, callStack: [{ fragmentId: 'start', instructionPointer: 1 }], trace: ['case-call', 'called-line'] },
    finalExpected: {},
  },
  {
    id: 'return',
    project: projectFor({ start: [{ id: 'setup-call', type: 'call', target: 'called' }, end('after-return', 'After return')], called: [{ id: 'case-return', type: 'return' }] }),
    actions: [],
    initialExpected: { location: { fragmentId: 'start', instructionPointer: 1 }, current: { id: 'after-return', type: 'narration' }, callStack: [], trace: ['setup-call', 'case-return', 'after-return'], error: null },
    finalExpected: {},
  },
] as const;

export const BLOCK_CONFORMANCE_MATRIX_VERSION = '2026.08.25.1';
export const BLOCK_CONFORMANCE_TYPES = [
  'scene',
  'sound',
  'characterShow',
  'characterHide',
  'camera',
  'narration',
  'dialogue',
  'branch',
  'setVariable',
  'modifyVariable',
  'condition',
  'jump',
  'call',
  'return',
] as const satisfies readonly BlockType[];

export function getBlockConformanceCase(id: string | null | undefined): BlockConformanceCase | undefined {
  return BLOCK_CONFORMANCE_MATRIX.find((item) => item.id === id);
}

function sortedRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

export function observeEngineState(project: Project, state: EngineState): BlockConformanceObservation {
  const block = currentBlock(project, state);
  const audioChannel = (channel: 'bgm' | 'sfx' | 'voice') => ({
    track: state.audio[channel].track ?? null,
    assetId: state.audio[channel].assetId ?? null,
    playing: state.audio[channel].playing,
    volume: state.audio[channel].volume,
    loop: state.audio[channel].loop,
    fadeDuration: state.audio[channel].fadeDuration,
  });
  return {
    location: { fragmentId: state.fragmentId, instructionPointer: state.instructionPointer },
    current: block ? {
      id: block.id,
      type: block.type,
      text: 'text' in block ? block.text ?? null : null,
      speaker: block.type === 'dialogue' ? block.speaker ?? null : null,
      title: 'title' in block ? block.title ?? null : null,
      options: block.type === 'branch' ? structuredClone(block.options ?? []) : [],
    } : null,
    variables: sortedRecord(state.variables),
    stage: {
      backgroundAssetId: state.stage.backgroundAssetId ?? null,
      transition: state.stage.transition ?? null,
      transitionDuration: state.stage.transitionDuration,
      sceneLayers: state.stage.sceneLayers.map((layer) => ({
        id: layer.id,
        assetId: layer.assetId ?? null,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        x: layer.x,
        y: layer.y,
        scale: layer.scale,
        layer: layer.layer,
        distance: layer.distance ?? null,
      })).sort((left, right) => left.layer - right.layer || left.id.localeCompare(right.id)),
      characters: Object.values(state.stage.characters).map((character) => ({
        characterId: character.characterId,
        expression: character.expression,
        assetId: character.assetId ?? null,
        position: character.position,
        x: character.x,
        y: character.y,
        scale: character.scale,
        opacity: character.opacity,
        layer: character.layer,
        animation: character.animation,
      })).sort((left, right) => left.characterId.localeCompare(right.characterId)),
      camera: structuredClone(state.stage.camera),
    },
    audio: { bgm: audioChannel('bgm'), sfx: audioChannel('sfx'), voice: audioChannel('voice') },
    callStack: structuredClone(state.callStack),
    readBlocks: Object.keys(state.readBlocks).sort(),
    backlog: state.backlog.map((entry) => ({
      blockId: entry.blockId,
      fragmentId: entry.fragmentId,
      speaker: entry.speaker ?? null,
      text: entry.text,
      voiceAssetId: entry.voiceAssetId ?? null,
    })),
    trace: state.executionTrace.map((entry) => entry.blockId),
    finished: state.finished,
    error: state.error ?? null,
  };
}

export function applyBlockConformanceAction(project: Project, state: EngineState, action: BlockConformanceAction): EngineState {
  return action.type === 'choose'
    ? chooseBranch(project, state, action.target)
    : advanceEngine(project, state);
}

export function runBlockConformanceCase(testCase: BlockConformanceCase): BlockConformanceRun {
  let state = createEngineState(testCase.project);
  const observations = [observeEngineState(testCase.project, state)];
  for (const action of testCase.actions) {
    state = applyBlockConformanceAction(testCase.project, state, action);
    observations.push(observeEngineState(testCase.project, state));
  }
  return { id: testCase.id, observations };
}
