import type { AudioChannel, BlockType, CameraFilter, CharacterDimension, CharacterOverlay, CharacterPosition, EnterExitAnimation, Project, SceneBlendMode, StoryBlock } from '../types';

export interface BlockSchemaField {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array';
  required?: boolean;
  values?: readonly string[];
}

export interface BlockIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface BlockDefinition<T extends StoryBlock = StoryBlock> {
  type: BlockType;
  version: number;
  label: string;
  schema: Record<string, BlockSchemaField>;
  create: (project: Project) => T;
  execute?: (state: EngineState, block: T, project: Project) => EngineState;
  diagnose: (block: T, project: Project) => BlockIssue[];
  migrate: (block: Record<string, unknown>, fromVersion: number) => T;
}

export interface StageCharacterState {
  characterId: string;
  expression: string;
  assetId?: string;
  position: CharacterPosition;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  layer: number;
  animation: EnterExitAnimation;
  width?: CharacterDimension;
  height?: CharacterDimension;
  overlays?: CharacterOverlay[];
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  shake: number;
  filter: CameraFilter;
  duration: number;
}

export interface StageSceneLayerState {
  id: string;
  name: string;
  assetId?: string;
  opacity: number;
  blendMode: SceneBlendMode;
  x: number;
  y: number;
  scale: number;
  layer: number;
  distance?: number;
}

export interface StageState {
  backgroundAssetId?: string;
  transition?: string;
  transitionDuration: number;
  sceneLayers: StageSceneLayerState[];
  characters: Record<string, StageCharacterState>;
  camera: CameraState;
}

export interface AudioChannelState {
  track?: string;
  assetId?: string;
  playing: boolean;
  volume: number;
  loop: boolean;
  fadeDuration: number;
}

export type AudioMixerState = Record<AudioChannel, AudioChannelState>;

export interface BacklogEntry {
  blockId: string;
  fragmentId: string;
  speaker?: string;
  text: string;
  voiceAssetId?: string;
  timestamp: number;
}

export interface EngineSnapshot {
  fragmentId: string;
  instructionPointer: number;
  variables: Record<string, string | number | boolean>;
  stage: StageState;
  audio: AudioMixerState;
  callStack: Array<{ fragmentId: string; instructionPointer: number }>;
  readBlocks: Record<string, true>;
  backlog: BacklogEntry[];
  finished: boolean;
  error?: string;
}

export interface EngineTraceEntry {
  id: string;
  step: number;
  fragmentId: string;
  instructionPointer: number;
  blockId: string;
  blockType: BlockType;
  snapshot: EngineSnapshot;
}

export interface EngineState extends EngineSnapshot {
  rollbackStack: EngineSnapshot[];
  stepsExecuted: number;
  executionTrace: EngineTraceEntry[];
  traceCursor: number;
}

export interface SaveGame {
  projectId: string;
  projectVersion: number;
  engineVersion: number;
  savedAt: string;
  slotId?: string;
  slotType: 'manual' | 'quick' | 'auto';
  label?: string;
  fragmentName?: string;
  chapterName?: string;
  playTimeSeconds?: number;
  thumbnail?: string;
  state: EngineState;
  historySummary: { readCount: number; backlogCount: number };
  migration?: { fromEngineVersion: number; migratedAt: string };
}

export interface ProjectDiagnostic extends BlockIssue {
  fragmentId?: string;
  blockId?: string;
  blockIndex?: number;
  relatedId?: string;
}

export interface BranchSimulationRequest {
  entryFragmentId?: string;
  variableOverrides?: Record<string, string | number | boolean>;
  maxPaths?: number;
  maxStepsPerPath?: number;
  maxVariableScenarios?: number;
}

export interface BranchSimulationProgress {
  phase: 'preparing' | 'traversing' | 'finalizing' | 'completed';
  completedPaths: number;
  queuedPaths: number;
  scenarioCount: number;
  stepsExecuted: number;
  percent: number;
}

export type BranchSimulationPathStatus = 'completed' | 'dead-end' | 'loop' | 'error' | 'truncated';

export interface BranchSimulationLocation {
  fragmentId: string;
  blockId?: string;
  blockIndex?: number;
}

export interface BranchSimulationPath {
  id: string;
  status: BranchSimulationPathStatus;
  steps: number;
  choices: Array<{ blockId: string; text: string; target: string }>;
  initialVariables: Record<string, string | number | boolean>;
  finalVariables: Record<string, string | number | boolean>;
  visitedFragments: string[];
  message: string;
  location?: BranchSimulationLocation;
}

export interface BranchSimulationResult {
  entryFragmentId: string;
  generatedAt: string;
  limits: { maxPaths: number; maxStepsPerPath: number; maxVariableScenarios: number };
  truncated: boolean;
  truncationReason?: 'path-limit' | 'variable-scenario-limit';
  scenarioCount: number;
  pathCount: number;
  coverage: {
    fragments: { visited: number; total: number; percent: number; unreachable: string[] };
    blocks: { visited: number; total: number; percent: number };
    branchOptions: { visited: number; total: number; percent: number };
  };
  summary: Record<BranchSimulationPathStatus, number>;
  variableConflicts: Array<{ name: string; observedTypes: string[]; locations: BranchSimulationLocation[] }>;
  paths: BranchSimulationPath[];
}

export interface BranchSimulationExecution {
  result: BranchSimulationResult;
  cacheHit: boolean;
  projectFingerprint: string;
}
