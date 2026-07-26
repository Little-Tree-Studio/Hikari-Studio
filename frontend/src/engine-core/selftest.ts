import type { Project } from '../types';
import { analyzeAssetReferences } from '../core/assetReferences';
import { diagnosticSummary } from './diagnostics';
import { advanceEngine, chooseBranch, createEngineState, createSaveGame, currentBlock, loadSaveGame, restoreTraceState, rollbackEngine } from './runtime';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(`Engine self-test failed: ${message}`); };

export function runEngineSelfTest() {
  const project: Project = {
    version: 3,
    meta: { id: 'engine-self-test', name: 'Engine Self Test', author: '', resolution: [1280, 720], updatedAt: '' },
    characters: [{ id: 'hero', name: 'Hero', color: '#d65b4a', expressions: ['默认', '微笑'], portraits: { 默认: 'hero-default', 微笑: 'hero-smile' } }],
    chapters: [{ id: 'chapter', name: 'Chapter', entry: true, fragments: [{ id: 'start', name: 'Start' }] }],
    activeFragmentId: 'start',
    scripts: { start: [
      { id: 'show', type: 'characterShow', characterId: 'hero', position: 'left' },
      { id: 'camera', type: 'camera', zoom: 1.3, filter: 'sepia' },
      { id: 'music', type: 'sound', channel: 'bgm', action: 'play', title: 'theme', volume: .5 },
      { id: 'line', type: 'dialogue', speaker: 'Hero', expression: '微笑', text: 'Hello', voice: 'hero-voice' },
      { id: 'hide', type: 'characterHide', characterId: 'hero' },
      { id: 'end', type: 'narration', text: 'End' },
    ] },
    assets: [{ id: 'hero-default', kind: 'character', name: 'Hero Default', path: 'hero-default.png' }, { id: 'hero-smile', kind: 'character', name: 'Hero Smile', path: 'hero-smile.png' }, { id: 'hero-voice', kind: 'audio', name: 'Hero Voice', path: 'hero-voice.ogg', audioCategory: 'voice', duration: 1.2 }],
    variables: { score: 0, sharedUnlock: false },
    variableDefinitions: {
      score: { type: 'number', scope: 'project', persistence: 'slot', displayName: 'Score', description: '' },
      sharedUnlock: { type: 'boolean', scope: 'project', persistence: 'shared', displayName: 'Shared unlock', description: '' },
    },
    settings: { textSpeed: 35, autoSave: true, skipRead: true },
  };
  let state = createEngineState(project);
  assert(currentBlock(project, state)?.id === 'line', 'side effects should settle before dialogue');
  assert(state.stage.characters.hero?.position === 'left', 'character show should update stage');
  assert(state.stage.characters.hero?.assetId === 'hero-smile', 'dialogue expression should load its configured portrait');
  assert(state.stage.camera.zoom === 1.3 && state.stage.camera.filter === 'sepia', 'camera should update');
  assert(state.audio.bgm.playing && state.audio.bgm.volume === .5, 'BGM channel should play');
  assert(state.audio.voice.playing && state.audio.voice.assetId === 'hero-voice', 'dialogue voice should start on the voice channel');
  assert(state.executionTrace.map((entry) => entry.blockId).join(',') === 'show,camera,music,line', 'initial settle should record the actual OP path');
  assert(state.traceCursor === 3, 'trace cursor should point at the visible dialogue');
  state = advanceEngine(project, state);
  assert(currentBlock(project, state)?.id === 'end', 'character hide should settle before narration');
  assert(!state.stage.characters.hero, 'character hide should remove stage character');
  assert(state.readBlocks.line && state.backlog.length === 1, 'dialogue should enter read state and backlog');
  assert(!state.audio.voice.playing && state.backlog[0].voiceAssetId === 'hero-voice', 'the next visible line should stop voice and preserve its backlog reference');
  assert(state.executionTrace.map((entry) => entry.blockId).join(',') === 'show,camera,music,line,hide,end', 'advance should append side effects and the next visible OP');
  const firstOp = restoreTraceState(state, 0);
  assert(firstOp.instructionPointer === 1, 'the first OP snapshot should stop immediately after character show');
  assert(firstOp.stage.camera.zoom === 1 && !firstOp.audio.bgm.playing, 'each OP snapshot should exclude later camera and audio effects');
  const restored = restoreTraceState(state, 3);
  assert(restored.fragmentId === 'start' && restored.instructionPointer === 3, 'trace restore should recover the selected runtime location');
  assert(restored.stage.characters.hero?.assetId === 'hero-smile', 'trace restore should recover stage state');
  assert(restored.executionTrace.length === state.executionTrace.length && restored.traceCursor === 3, 'trace restore should keep history and move its cursor');
  const save = createSaveGame(project, state, 'quick');
  assert(save.engineVersion === 3, 'new saves should use engine version 3');
  const loaded = loadSaveGame(project, save, { ...state.variables, sharedUnlock: true });
  assert(loaded.instructionPointer === state.instructionPointer, 'save/load should preserve pointer');
  assert(loaded.executionTrace.length === state.executionTrace.length, 'save/load should preserve execution trace');
  assert(loaded.variables.sharedUnlock === true, 'load should preserve the current shared variable value');
  const sharedState = { ...state, variables: { ...state.variables, sharedUnlock: true } };
  const rolled = rollbackEngine(sharedState, ['sharedUnlock']);
  assert(rolled.instructionPointer === 3, 'rollback should restore previous visible block');
  assert(rolled.variables.sharedUnlock === true, 'rollback should preserve shared variables');
  const restoredShared = restoreTraceState(sharedState, 0, ['sharedUnlock']);
  assert(restoredShared.variables.sharedUnlock === true, 'trace restore should preserve shared variables');
  const legacyState: Partial<typeof save.state> = structuredClone(save.state);
  delete legacyState.executionTrace;
  delete legacyState.traceCursor;
  const legacySave = { ...structuredClone(save), engineVersion: 2, state: legacyState as typeof save.state };
  const migratedLegacy = loadSaveGame(project, legacySave);
  assert(migratedLegacy.executionTrace.length === 0 && migratedLegacy.traceCursor === -1, 'legacy saves without execution trace should migrate');
  const flowProject = structuredClone(project);
  flowProject.chapters[0].fragments = [{ id: 'choice', name: 'Choice' }, { id: 'selected', name: 'Selected' }, { id: 'ending', name: 'Ending' }];
  flowProject.activeFragmentId = 'choice';
  flowProject.scripts = {
    choice: [{ id: 'pick', type: 'branch', title: 'Pick', options: [{ text: 'Selected', target: 'selected' }, { text: 'Unused', target: 'ending' }] }],
    selected: [{ id: 'score', type: 'setVariable', variable: 'score', value: 1 }, { id: 'call-ending', type: 'call', target: 'ending' }],
    ending: [{ id: 'ending-line', type: 'narration', text: 'Ending' }],
  };
  let flowState = createEngineState(flowProject);
  flowState = chooseBranch(flowProject, flowState, 'selected');
  assert(flowState.executionTrace.map((entry) => entry.blockId).join(',') === 'pick,score,call-ending,ending-line', 'branch trace should only contain the selected path and called fragment');
  assert(flowState.callStack.length === 1 && flowState.variables.score === 1, 'trace path should preserve call stack and variable effects');
  const diagnostics = diagnosticSummary(project);
  const portraitlessProject = structuredClone(project);
  portraitlessProject.characters[0].portraits = {};
  portraitlessProject.scripts.start = [{ id: 'portraitless-line', type: 'dialogue', speaker: 'Hero', text: 'Still visible' }];
  const portraitlessState = createEngineState(portraitlessProject);
  assert(Boolean(portraitlessState.stage.characters.hero), 'characters without a portrait should remain selectable through an editor placeholder');
  assert(!portraitlessState.stage.characters.hero.assetId, 'portraitless placeholders should not invent an asset reference');
  const referenceProject = structuredClone(project);
  referenceProject.characters[0].overlays = [{ id: 'overlay', name: 'Overlay', assetId: 'missing-overlay', opacity: 1, layer: 1 }];
  referenceProject.ui = { theme: 'hikari-light', dialogueStyle: 'glass', title: { backgroundAssetId: 'missing-title', logoAssetId: 'hero-smile' } };
  const referenceReport = analyzeAssetReferences(referenceProject);
  assert(referenceReport.missing.some((item) => item.assetId === 'missing-overlay'), 'character overlay assets should participate in missing-reference diagnostics');
  assert(referenceReport.missing.some((item) => item.assetId === 'missing-title'), 'game UI images should participate in missing-reference diagnostics');
  assert(referenceReport.references['hero-smile']?.some((item) => item.sourceType === 'ui'), 'game UI assets should participate in reference and bundle analysis');
  return { ok: true, engineVersion: save.engineVersion, current: currentBlock(project, state)?.id, readCount: Object.keys(state.readBlocks).length, backlogCount: state.backlog.length, traceCount: state.executionTrace.length, characterCount: Object.keys(state.stage.characters).length, diagnosticErrors: diagnostics.errors, diagnosticWarnings: diagnostics.warnings };
}
