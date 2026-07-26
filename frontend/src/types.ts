export type BlockType = 'scene' | 'sound' | 'characterShow' | 'characterHide' | 'camera' | 'narration' | 'dialogue' | 'branch' | 'setVariable' | 'condition' | 'jump' | 'call' | 'return';
export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
export type AudioChannel = 'bgm' | 'sfx' | 'voice';
export type AudioAction = 'play' | 'stop';
export type CharacterPosition = 'farLeft' | 'left' | 'center' | 'right' | 'farRight' | 'custom';
export type EnterExitAnimation = 'none' | 'fade' | 'slideLeft' | 'slideRight' | 'zoom';
export type CameraFilter = 'none' | 'monochrome' | 'sepia' | 'blur' | 'vignette';
export type SceneBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay';

export interface SceneLayer {
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

export interface SceneDefinitionLayer {
  id: string;
  name: string;
  assetId?: string;
  opacity: number;
  blendMode: SceneBlendMode;
  offsetX: number;
  offsetY: number;
  scale: number;
  distance: number;
  visible?: boolean;
}

export interface SceneDefinition {
  id: string;
  name: string;
  groupId?: string;
  layers: SceneDefinitionLayer[];
}

export interface SceneGroup {
  id: string;
  name: string;
  color: string;
  collapsed?: boolean;
}

export interface BranchOption {
  text: string;
  target: string;
}

export interface StoryBlockData {
  id: string;
  type: BlockType;
  version?: number;
  title?: string;
  text?: string;
  speaker?: string;
  expression?: string;
  displayNameSchemeId?: string;
  voice?: string;
  transition?: string;
  duration?: number;
  volume?: number;
  loop?: boolean;
  assetId?: string;
  sceneId?: string;
  options?: BranchOption[];
  variable?: string;
  value?: string | number | boolean;
  operator?: ConditionOperator;
  compareValue?: string | number | boolean;
  trueTarget?: string;
  falseTarget?: string;
  target?: string;
  channel?: AudioChannel;
  action?: AudioAction;
  fadeDuration?: number;
  characterId?: string;
  position?: CharacterPosition;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  layer?: number;
  animation?: EnterExitAnimation;
  cameraX?: number;
  cameraY?: number;
  zoom?: number;
  rotation?: number;
  shake?: number;
  filter?: CameraFilter;
  layers?: SceneLayer[];
}

interface BlockBase extends Partial<Omit<StoryBlockData, 'id' | 'type'>> { id: string; version?: number }
export interface SceneBlock extends BlockBase { type: 'scene'; title?: string; assetId?: string; sceneId?: string; transition?: string; duration?: number; layers?: SceneLayer[] }
export interface SoundBlock extends BlockBase { type: 'sound'; title?: string; assetId?: string; channel?: AudioChannel; action?: AudioAction; volume?: number; loop?: boolean; fadeDuration?: number }
export interface CharacterShowBlock extends BlockBase { type: 'characterShow'; characterId?: string; expression?: string; assetId?: string; position?: CharacterPosition; x?: number; y?: number; scale?: number; opacity?: number; layer?: number; animation?: EnterExitAnimation; duration?: number }
export interface CharacterHideBlock extends BlockBase { type: 'characterHide'; characterId?: string; animation?: EnterExitAnimation; duration?: number }
export interface CameraBlock extends BlockBase { type: 'camera'; cameraX?: number; cameraY?: number; zoom?: number; rotation?: number; shake?: number; filter?: CameraFilter; duration?: number }
export interface NarrationBlock extends BlockBase { type: 'narration'; text?: string }
export interface DialogueBlock extends BlockBase { type: 'dialogue'; text?: string; speaker?: string; expression?: string; displayNameSchemeId?: string; voice?: string }
export interface BranchBlock extends BlockBase { type: 'branch'; title?: string; options?: BranchOption[] }
export interface SetVariableBlock extends BlockBase { type: 'setVariable'; variable?: string; value?: string | number | boolean }
export interface ConditionBlock extends BlockBase { type: 'condition'; variable?: string; operator?: ConditionOperator; compareValue?: string | number | boolean; trueTarget?: string; falseTarget?: string }
export interface JumpBlock extends BlockBase { type: 'jump'; target?: string }
export interface CallBlock extends BlockBase { type: 'call'; target?: string }
export interface ReturnBlock extends BlockBase { type: 'return' }

export type StoryBlock = SceneBlock | SoundBlock | CharacterShowBlock | CharacterHideBlock | CameraBlock | NarrationBlock | DialogueBlock | BranchBlock | SetVariableBlock | ConditionBlock | JumpBlock | CallBlock | ReturnBlock;
export type StoryBlockPatch = Partial<Omit<StoryBlockData, 'id' | 'type'>>;
export type StoryBlockInput = Omit<StoryBlockData, 'id'> & { type: BlockType };

export interface Fragment { id: string; name: string }
export interface Chapter { id: string; name: string; entry?: boolean; disabled?: boolean; fragments: Fragment[] }
export type DisplayNameSchemeKind = 'fixed' | 'variable' | 'attribute';
export interface DisplayNameScheme { id: string; name: string; kind: DisplayNameSchemeKind; value: string }
export interface PortraitCrop { x: number; y: number; zoom: number }
export interface CharacterDimension { value?: number; unit: 'px' | '%' }
export interface CharacterOverlay {
  id: string;
  name: string;
  assetId?: string;
  opacity: number;
  layer: number;
  overrideSize?: boolean;
  width?: CharacterDimension;
  height?: CharacterDimension;
}
export interface Character {
  id: string;
  name: string;
  color: string;
  expressions: string[];
  portraits?: Record<string, string>;
  description?: string;
  defaultScale?: number;
  defaultPosition?: CharacterPosition;
  defaultLayer?: number;
  attributes?: Record<string, string>;
  displayNameSchemes?: DisplayNameScheme[];
  portraitCrops?: Record<string, PortraitCrop>;
  portraitWidth?: CharacterDimension;
  portraitHeight?: CharacterDimension;
  keepAspectRatio?: boolean;
  overlays?: CharacterOverlay[];
}
export type AudioCategory = 'bgm' | 'sfx' | 'voice';
export type AsrStatus = 'pending' | 'processing' | 'success' | 'failed';
export interface Asset {
  id: string;
  kind: string;
  name: string;
  path: string;
  uri?: string;
  size?: number;
  contentHash?: string;
  forceBundle?: boolean;
  audioCategory?: AudioCategory;
  duration?: number;
  voiceCharacterId?: string;
  asrText?: string;
  asrStatus?: AsrStatus;
  asrError?: string;
}
export interface AssetRepairIssue {
  assetId: string;
  name: string;
  path?: string;
  size?: number;
  contentHash?: string;
  reason?: string;
  references?: number;
}
export interface AssetRepairMatch {
  assetId: string;
  name: string;
  expectedPath: string;
  sourcePath: string;
  fileName: string;
  reason: string;
  score: number;
}
export interface AssetRepairAmbiguous {
  assetId: string;
  name: string;
  expectedPath: string;
  reason: string;
  score: number;
  candidates: { sourcePath: string; fileName: string }[];
}
export interface AssetFolderRepairPreview {
  folder: string;
  scannedFiles: number;
  matches: AssetRepairMatch[];
  ambiguous: AssetRepairAmbiguous[];
  unmatched: { assetId: string; name: string; expectedPath: string }[];
}
export type VariableType = 'boolean' | 'number' | 'string';
export type VariableScope = 'project' | 'system';
export type VariablePersistence = 'slot' | 'shared';
export interface VariableDefinition {
  displayName?: string;
  description?: string;
  type: VariableType;
  scope: VariableScope;
  persistence: VariablePersistence;
}
export type InspectorDock = 'preview' | 'editor' | 'floating';
export type ChapterScheduleMode = 'basic' | 'advanced';

export type GameUiThemePreset = 'modern' | 'classic' | 'minimal';
export type SpeakerStyle = 'plain' | 'accent' | 'plate';
export interface GameUiTheme {
  preset: GameUiThemePreset;
  fontFamily: string;
  fontAssetId?: string;
  dialogueFontSize: number;
  dialogueTextColor: string;
  dialogueGradientColor: string;
  dialogueBottomOpacity: number;
  dialogueTopOpacity: number;
  dialogueHeight: number;
  speakerColor: string;
  speakerFontSize: number;
  speakerWeight: number;
  speakerStyle: SpeakerStyle;
  accentColor: string;
  buttonTextColor: string;
  systemPanelColor: string;
  systemPanelOpacity: number;
  savePanelColor: string;
  saveSlotColor: string;
  cornerRadius: number;
}

export interface Project {
  version: number;
  meta: { id: string; name: string; author: string; resolution: [number, number]; updatedAt: string; gameVersion?: string };
  characters: Character[];
  scenes?: SceneDefinition[];
  sceneGroups?: SceneGroup[];
  chapters: Chapter[];
  activeFragmentId: string;
  scripts: Record<string, StoryBlock[]>;
  assets: Asset[];
  variables: Record<string, string | number | boolean>;
  variableDefinitions?: Record<string, VariableDefinition>;
  settings: {
    textSpeed: number;
    autoSave: boolean;
    skipRead: boolean;
    autoPlay?: boolean;
    autoPlayDelay?: number;
    fastForward?: boolean;
    narrativeMap?: { positions: Record<string, { x: number; y: number }> };
    chapterScheduling?: { mode: ChapterScheduleMode; preprocessingChapterId?: string };
    editorSession?: {
      openFragmentIds: string[];
      selectedBlockByFragment?: Record<string, number>;
      scrollTopByFragment?: Record<string, number>;
      inspectorDock?: InspectorDock;
      scriptView?: 'cards' | 'plain' | 'code' | 'json';
    };
  };
  locale?: { default: string; languages: string[] };
  translations?: Record<string, string>;
  ui?: {
    theme: string;
    dialogueStyle: string;
    title?: { backgroundAssetId?: string; logoAssetId?: string; subtitle?: string };
    runtimeTheme?: GameUiTheme;
  };
}

export interface DesktopApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; diagnostics?: unknown[] };
}

export interface DesktopApi {
  get_app_info(): Promise<{ name: string; version: string; platform: string; projectPath: string }>;
  load_project(): Promise<Project>;
  load_project_json(): Promise<string>;
  save_project(project: Project): Promise<{ ok: boolean; path: string; bytes: number }>;
  read_runtime_value(key: string): Promise<string | null>;
  write_runtime_value(key: string, value: string): Promise<boolean>;
  delete_runtime_value(key: string): Promise<boolean>;
  save_project_as(project: Project): Promise<{ ok: boolean; path: string; bytes: number } | null>;
  new_project(name: string): Promise<Project>;
  open_project_dialog(): Promise<Project | null>;
  list_recent_projects(): Promise<RecentProject[]>;
  open_recent_project(path: string): Promise<Project>;
  set_project_pinned(path: string, pinned: boolean): Promise<RecentProject[]>;
  import_assets(paths?: string[], audioCategory?: AudioCategory): Promise<Asset[]>;
  inspect_assets(assets: Asset[]): Promise<AssetFileStatus[]>;
  replace_asset_file(assetId: string, path?: string): Promise<Asset | null>;
  preview_asset_folder_repair(issues: AssetRepairIssue[], folder?: string): Promise<AssetFolderRepairPreview | null>;
  apply_asset_folder_repair(matches: AssetRepairMatch[]): Promise<Asset[]>;
  get_asr_status(): Promise<AsrServiceStatus>;
  load_asr_model(): Promise<DesktopApiResult<AsrServiceStatus>>;
  transcribe_audio(assets: Asset[], concurrency: number, force: boolean): Promise<DesktopApiResult<AsrTranscription[]>>;
  preview_script_import(path?: string): Promise<ScriptImportPreview | null>;
  export_renpy(project: Project): Promise<{ ok: boolean; path: string }>;
  build_web(project: Project): Promise<{ ok: boolean; path: string }>;
  build_windows(project: Project): Promise<{ ok: boolean; path: string }>;
  minimize_window(): Promise<boolean>;
  toggle_maximize(): Promise<boolean>;
  close_window(): Promise<boolean>;
  get_ai_settings(): Promise<AiSettings>;
  save_ai_settings(settings: AiSettingsInput): Promise<AiSettings>;
  run_ai_agent(instruction: string, project: Project): Promise<AgentPlan>;
}

export interface RecentProject {
  path: string;
  name: string;
  updatedAt: string;
  pinned: boolean;
  exists: boolean;
}

export interface AsrServiceStatus {
  available: boolean;
  loaded: boolean;
  loading: boolean;
  model: string;
  message: string;
}

export interface AsrTranscription {
  assetId: string;
  text?: string;
  duration?: number;
  status: 'success' | 'failed';
  error?: string;
}

export interface AssetFileStatus {
  assetId: string;
  exists: boolean;
  size?: number;
  location: 'builtin' | 'project';
}

export interface AppNotification {
  id: string;
  title: string;
  detail: string;
  tone: 'info' | 'success' | 'error';
  createdAt: number;
  read: boolean;
}

export interface ScriptImportPreview {
  sourceName: string;
  format: 'TXT' | 'Markdown' | 'Hikari JSON';
  blocks: StoryBlock[];
  warnings: string[];
}

export interface AiSettings {
  url: string;
  model: string;
  temperature: number;
  hasKey: boolean;
}

export interface AiSettingsInput {
  url: string;
  model: string;
  temperature: number;
  apiKey?: string;
}

export type AgentOperation =
  | { type: 'add_blocks'; fragmentId: string; blocks: StoryBlockInput[] }
  | { type: 'create_fragment'; chapterId: string; name: string; blocks: StoryBlockInput[] }
  | { type: 'update_project'; name?: string; author?: string };

export interface AgentPlan {
  summary: string;
  assumptions: string[];
  operations: AgentOperation[];
}

declare global {
  interface Window {
    __HIKARI_DESKTOP__?: boolean;
    pywebview?: { api: DesktopApi };
    __HIKARI_RUNTIME_SELF_TEST__?: () => { ok: boolean; engineVersion: number; current?: string; readCount: number; backlogCount: number; characterCount: number; diagnosticErrors: number; diagnosticWarnings: number };
  }
}
