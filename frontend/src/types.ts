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

export type LanguageCode = string;
export interface LocalizedBlockText {
  text?: string;
  title?: string;
  speaker?: string;
  options?: string[];
  voice?: string;
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
  scanWarnings: { code: string; path?: string; message: string }[];
  hashCacheHits: number;
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

export type ProductionMemorySection = 'characterRules' | 'styleRules' | 'facts' | 'restrictions';
export interface ProductionMemoryReference { fragmentId: string; blockId?: string; note?: string }
export interface ProductionMemoryEntry {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  references: ProductionMemoryReference[];
  updatedAt: string;
}
export interface ProductionMemory {
  version: 1;
  world: string;
  characterRules: ProductionMemoryEntry[];
  styleRules: ProductionMemoryEntry[];
  facts: ProductionMemoryEntry[];
  restrictions: ProductionMemoryEntry[];
  updatedAt: string;
}

export type TimelineTrackKind = 'scene' | 'character' | 'camera' | 'audio';
export type TimelineEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'cubicBezier';
export interface TimelineKeyframe {
  id: string;
  time: number;
  property: string;
  value: string | number | boolean;
  easing: TimelineEasing;
  bezier?: [number, number, number, number];
}
export interface TimelineClip {
  id: string;
  name: string;
  start: number;
  duration: number;
  blockId?: string;
  assetId?: string;
  characterId?: string;
  audioChannel?: AudioChannel;
  sourceOffset?: number;
  keyframes: TimelineKeyframe[];
}
export interface TimelineTrack {
  id: string;
  name: string;
  kind: TimelineTrackKind;
  muted?: boolean;
  locked?: boolean;
  height?: number;
  collapsed?: boolean;
  groupId?: string;
  clips: TimelineClip[];
}
export interface TimelineTrackGroup { id: string; name: string; collapsed?: boolean }
export interface TimelineMarker { id: string; name: string; time: number; color?: string }
export interface TimelineLoopRegion { start: number; end: number; enabled: boolean }
export interface StageTimeline {
  version: 1;
  fragmentId: string;
  duration: number;
  fps: number;
  tracks: TimelineTrack[];
  groups?: TimelineTrackGroup[];
  markers?: TimelineMarker[];
  loopRegion?: TimelineLoopRegion;
}

export interface Project {
  version: number;
  meta: { id: string; name: string; author: string; resolution: [number, number]; updatedAt: string; gameVersion?: string; description?: string; windowTitle?: string; backgroundColor?: string };
  characters: Character[];
  scenes?: SceneDefinition[];
  sceneGroups?: SceneGroup[];
  chapters: Chapter[];
  activeFragmentId: string;
  scripts: Record<string, StoryBlock[]>;
  timelines?: Record<string, StageTimeline>;
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
    narrativeMap?: { positions: Record<string, { x: number; y: number }>; viewMode?: 'graph' | 'flow' };
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
  translations?: Record<LanguageCode, Record<string, LocalizedBlockText>>;
  ui?: {
    theme: string;
    dialogueStyle: string;
    title?: { backgroundAssetId?: string; logoAssetId?: string; subtitle?: string };
    runtimeTheme?: GameUiTheme;
  };
  productionMemory?: ProductionMemory;
}

export interface DesktopApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; diagnostics?: unknown[] };
}

export type BuildTarget = 'web' | 'windows';
export type BrowserMode = 'system' | 'cefsharp';
export type BuildPreflightCategory = 'assets' | 'flow' | 'reachability' | 'compatibility';

export interface BuildPreflightIssue {
  severity: 'error' | 'warning' | 'info';
  blocking: boolean;
  category: BuildPreflightCategory;
  code: string;
  message: string;
  fragmentId?: string;
  blockId?: string;
  blockIndex?: number;
  relatedId?: string;
  source?: 'engine' | 'simulation' | 'desktop';
}

export interface BuildPreflightReport {
  version: 1;
  target: BuildTarget;
  projectId: string;
  generatedAt: string;
  blocked: boolean;
  errors: number;
  warnings: number;
  issues: BuildPreflightIssue[];
  stats: {
    assets: number;
    bundledAssets: number;
    fragments: number;
    blocks: number;
    unreachableFragments: number;
    simulatedPaths: number;
  };
  simulation: {
    completed: boolean;
    truncated: boolean;
    loops: number;
    runtimeErrors: number;
    coveragePercent: number;
  };
}

export interface BuildResult {
  ok: boolean;
  path?: string;
  preflight?: BuildPreflightReport;
  error?: { code: string; message: string; diagnostics?: BuildPreflightIssue[] };
}

export type EditorThemeId = 'slide-light' | 'graphite' | 'sakura-studio' | 'high-contrast';
export type EditorCornerStyle = 'sharp' | 'soft' | 'rounded';
export interface EditorAppearance {
  version: 1;
  mode: 'system' | 'fixed';
  themeId: EditorThemeId;
  accentColor?: string;
  motion: 'system' | 'full' | 'reduced';
  cornerStyle: EditorCornerStyle;
}

export interface RecoverySnapshot {
  project: Project;
  updatedAt: string;
  recoveredDuringLoad: boolean;
}

export interface RecoverySnapshotStatus {
  exists: boolean;
  updatedAt: string | null;
  bytes: number;
  recoveredDuringLoad: boolean;
}

export interface CommandHistoryStorageStats {
  version: 1 | 2;
  bytes: number;
  uncompressedBytes: number;
  compressionRate: number;
  commandCount: number;
  ordinaryCount: number;
  pinnedCount: number;
  snapshotCount: number;
}

export interface DesktopProjectSession {
  project: Project;
  projectPath: string;
  sessionToken: string;
}

export interface ProjectReloadBackendPerformance {
  version: 1;
  reloadId: string;
  recordedAt: string;
  projectLoadMs: number;
  pythonSerializationMs: number;
  pythonCompressionMs: number;
  pythonTotalMs: number;
  payloadBytes: number;
  transportBytes: number;
  counts: { chapters: number; fragments: number; blocks: number; assets: number; timelineClips: number };
}

export interface ProjectReloadFrontendPerformance {
  apiWaitMs: number;
  bridgeRoundTripMs: number;
  webViewTransferEstimateMs: number;
  payloadDecodeMs: number;
  jsonParseMs: number;
  frontendSessionLoadMs: number;
  commandHistoryLoadMs: number;
  recoverySnapshotLoadMs: number;
  historyStatsLoadMs: number;
  historyRestoreMs: number;
  stateDispatchMs: number;
  reactCommitMs: number;
  stablePaintMs: number;
  totalReloadMs: number;
  bootToStablePaintMs: number;
  componentRenders: Partial<Record<ComponentRenderSurface, ComponentRenderPerformance>>;
}

export type ComponentRenderSurface = 'app-shell' | 'chapter-tree' | 'script-page' | 'block-list' | 'preview' | 'inspector';
export type DialogueStoryCardRegion = 'speaker' | 'expression' | 'body';

export interface RenderCommitPerformance {
  commits: number;
  mounts: number;
  updates: number;
  actualDurationMs: number;
  mountDurationMs: number;
  updateDurationMs: number;
  baseDurationMs: number;
  lastCommitTimeMs: number;
}

export interface ComponentRenderPerformance extends RenderCommitPerformance {
  storyCardTypes?: Partial<Record<BlockType, RenderCommitPerformance>>;
  dialogueRegions?: Partial<Record<DialogueStoryCardRegion, RenderCommitPerformance>>;
  firstMeasurementDurationMs?: number;
  observerMeasurementDurationMs?: number;
  firstMeasurements?: number;
  remeasurements?: number;
  observerCallbacks?: number;
  revisionFlushes?: number;
  peakObservedRows?: number;
  viewportMeasurements?: number;
  viewportUpdates?: number;
  viewportRangeFlushes?: number;
}

export interface ProjectReloadPerformance {
  version: 1;
  complete: boolean;
  recordedAt?: string;
  surface: 'editor' | 'project-launcher' | null;
  backend: ProjectReloadBackendPerformance;
  frontend: ProjectReloadFrontendPerformance | null;
}

export interface ProfiledDesktopProjectSession extends Omit<DesktopProjectSession, 'project'> {
  encoding?: 'plain-json' | 'gzip-base64';
  projectPayload?: string;
  projectJson?: string;
  backend: ProjectReloadBackendPerformance;
}

export interface ProjectLoadPerformance {
  reloadId: string;
  startedAt: number;
  backend: ProjectReloadBackendPerformance;
  apiWaitMs: number;
  bridgeRoundTripMs: number;
  webViewTransferEstimateMs: number;
  payloadDecodeMs: number;
  jsonParseMs: number;
  frontendSessionLoadMs: number;
}

export interface AppInfo {
  name: string;
  version: string;
  channel: 'stable' | 'beta';
  platform: string;
  projectPath: string;
  dataPath: string;
  buildPath: string;
  startupProjectRequested: boolean;
}

export interface UpdateManifest {
  schemaVersion: 1;
  version: string;
  channel: 'stable' | 'beta';
  publishedAt: string;
  notes: string;
  releaseUrl: string;
  minimumVersion?: string;
  installer: { url: string; sha256: string; size: number };
}

export interface DownloadedInstaller {
  version: string;
  size: number;
  downloadedAt: string;
}

export interface UpdateStatus {
  status: 'idle' | 'available' | 'up-to-date' | 'downloaded' | 'error';
  channel: 'stable' | 'beta';
  currentVersion: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  manifest?: UpdateManifest;
  download?: DownloadedInstaller;
  rollbackInstallers: DownloadedInstaller[];
  error?: { code: string; message: string };
}

export interface CrashReportSummary {
  id: string;
  createdAt: string;
  source: string;
  kind: string;
  message: string;
  fingerprint: string;
}

export interface CrashReport extends CrashReportSummary {
  schemaVersion: 1;
  app: { name: string; version: string };
  system: { platform: string; release: string; architecture: string };
  stack: string;
  context: Record<string, unknown>;
}

export interface CrashReportCenter {
  uploadConfigured: boolean;
  reports: CrashReportSummary[];
}

export interface ProjectCreationOptions {
  template: 'blank' | 'sample';
  name: string;
  projectDirectory?: string;
  author?: string;
  description?: string;
  resolution: [number, number];
  windowTitle?: string;
  backgroundColor?: string;
}

export interface DesktopApi {
  get_editor_appearance(): Promise<EditorAppearance>;
  save_editor_appearance(appearance: EditorAppearance): Promise<EditorAppearance>;
  get_app_info(): Promise<AppInfo>;
  get_update_status(): Promise<UpdateStatus>;
  check_for_updates(force?: boolean, channel?: 'stable' | 'beta'): Promise<UpdateStatus>;
  download_update(): Promise<UpdateStatus>;
  install_downloaded_update(confirmed?: boolean, version?: string): Promise<{ ok: boolean; version?: string; path?: string; error?: { code: string; message: string } }>;
  get_crash_reports(): Promise<CrashReportCenter>;
  get_crash_report(reportId: string): Promise<CrashReport>;
  report_frontend_crash(payload: Record<string, unknown>): Promise<CrashReportSummary>;
  submit_crash_report(reportId: string, confirmed?: boolean): Promise<{ ok: boolean; reportId?: string; remoteId?: string; error?: { code: string; message: string } }>;
  delete_crash_report(reportId: string): Promise<boolean>;
  load_project(): Promise<Project>;
  load_project_json(): Promise<string>;
  load_project_session(): Promise<DesktopProjectSession>;
  load_project_session_profiled(reloadId: string, supportsCompression?: boolean): Promise<ProfiledDesktopProjectSession>;
  report_project_reload_performance(reloadId: string, surface: 'editor' | 'project-launcher', frontend: ProjectReloadFrontendPerformance): Promise<ProjectReloadPerformance>;
  get_project_reload_performance(): Promise<ProjectReloadPerformance | null>;
  report_preview_seek_performance(report: import('./performance/previewSeekProfiler').PreviewSeekPerformanceReport): Promise<import('./performance/previewSeekProfiler').PreviewSeekPerformanceReport>;
  get_preview_seek_performance(): Promise<import('./performance/previewSeekProfiler').PreviewSeekPerformanceReport | null>;
  save_project(project: Project, expectedProjectId?: string, expectedProjectPath?: string, sessionToken?: string): Promise<{ ok: boolean; path: string; bytes: number }>;
  load_command_history(): Promise<import('./hooks/useCommandHistory').PersistedCommandHistory<Project> | null>;
  load_command_history_stats(): Promise<CommandHistoryStorageStats>;
  save_command_history(history: import('./hooks/useCommandHistory').PersistedCommandHistory<Project>): Promise<{ ok: boolean; path: string } & CommandHistoryStorageStats>;
  load_recovery_snapshot(): Promise<RecoverySnapshot | null>;
  get_recovery_snapshot_status(): Promise<RecoverySnapshotStatus>;
  read_runtime_value(key: string): Promise<string | null>;
  write_runtime_value(key: string, value: string): Promise<boolean>;
  delete_runtime_value(key: string): Promise<boolean>;
  save_project_as(project: Project): Promise<{ ok: boolean; path: string; bytes: number } | null>;
  save_project_as_session(project: Project): Promise<({ ok: boolean; path: string; bytes: number } & Omit<DesktopProjectSession, 'project'>) | null>;
  new_project(name: string): Promise<Project>;
  new_project_session(name: string): Promise<DesktopProjectSession>;
  create_project_session(options: ProjectCreationOptions): Promise<DesktopProjectSession>;
  select_project_location(): Promise<string | null>;
  select_export_location(): Promise<string | null>;
  open_project_dialog(): Promise<Project | null>;
  open_project_dialog_session(): Promise<DesktopProjectSession | null>;
  list_recent_projects(): Promise<RecentProject[]>;
  open_recent_project(path: string): Promise<Project>;
  open_recent_project_session(path: string): Promise<DesktopProjectSession>;
  open_project_path(path: string): Promise<Project>;
  open_project_path_session(path: string): Promise<DesktopProjectSession>;
  set_project_pinned(path: string, pinned: boolean): Promise<RecentProject[]>;
  import_assets(paths?: string[], audioCategory?: AudioCategory): Promise<Asset[]>;
  inspect_assets(assets: Asset[]): Promise<AssetFileStatus[]>;
  replace_asset_file(assetId: string, path?: string): Promise<Asset | null>;
  preview_asset_folder_repair(issues: AssetRepairIssue[], folder?: string): Promise<AssetFolderRepairPreview | null>;
  apply_asset_folder_repair(matches: AssetRepairMatch[]): Promise<Asset[]>;
  get_asr_status(): Promise<AsrServiceStatus>;
  load_asr_model(): Promise<DesktopApiResult<AsrServiceStatus>>;
  transcribe_audio(assets: Asset[], concurrency: number, force: boolean): Promise<DesktopApiResult<AsrTranscription[]>>;
  preview_script_import(path?: string | null, characters?: Character[], rules?: ScriptImportRules): Promise<ScriptImportPreview | null>;
  read_clipboard_text(): Promise<string>;
  write_clipboard_text(text: string): Promise<boolean>;
  preview_clipboard_script(fallbackText?: string, characters?: Character[], rules?: ScriptImportRules): Promise<ScriptImportPreview>;
  export_renpy(project: Project, outputRoot?: string): Promise<{ ok: boolean; path: string }>;
  preflight_build(project: Project, target: BuildTarget, frontendReport: BuildPreflightReport): Promise<BuildPreflightReport>;
  build_web(project: Project, preflight?: BuildPreflightReport, outputRoot?: string): Promise<BuildResult>;
  build_windows(project: Project, preflight?: BuildPreflightReport, outputRoot?: string, browserMode?: BrowserMode): Promise<BuildResult>;
  open_build_output(path: string): Promise<{ ok: boolean; path: string }>;
  launch_build_output(path: string): Promise<{ ok: boolean; path: string }>;
  minimize_window(): Promise<boolean>;
  set_project_creation_mode(enabled: boolean): Promise<boolean>;
  toggle_maximize(): Promise<boolean>;
  close_window(): Promise<boolean>;
  get_ai_settings(): Promise<AiSettings>;
  save_ai_settings(settings: AiSettingsInput): Promise<AiSettings>;
  discover_ai_models(settings: AiSettingsInput): Promise<AiModelDiscovery>;
  run_ai_agent(instruction: string, project: Project): Promise<AgentPlan>;
  start_ai_task(instruction: string, project: Project, context: AgentContext): Promise<AgentTask>;
  retry_ai_task_operations(taskId: string, operationIndexes: number[], project: Project): Promise<AgentTask>;
  check_ai_patch_preconditions(taskId: string, operationIndexes: number[], project: Project): Promise<AgentPatchPreconditionResult>;
  apply_ai_patch(taskId: string, operationIndexes: number[], project: Project): Promise<AgentPatchApplyResult>;
  rebase_ai_patch(taskId: string, operationIndexes: number[], project: Project): Promise<AgentTask>;
  list_ai_tasks(): Promise<AgentTask[]>;
  get_ai_task(taskId: string, afterSeq?: number): Promise<AgentTask>;
  pause_ai_task(taskId: string): Promise<AgentTask>;
  resume_ai_task(taskId: string, project: Project): Promise<AgentTask>;
  restart_ai_task_from_checkpoint(taskId: string, checkpointId: string, project: Project): Promise<AgentTask>;
  compare_ai_task_results(left: AgentResultRef, right: AgentResultRef): Promise<AgentResultComparison>;
  cancel_ai_task(taskId: string): Promise<AgentTask>;
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
  format: 'TXT' | 'Markdown' | 'Slide JSON';
  blocks: StoryBlock[];
  warnings: string[];
  matches?: ScriptImportMatch[];
  rules?: ScriptImportRules;
}

export interface ScriptImportRules {
  dialogueSeparator: 'auto' | 'colon' | 'tab';
  expressionSyntax: 'auto' | 'brackets' | 'parentheses' | 'pipe' | 'none';
  characterMatching: 'smart' | 'exact';
  unknownCharacter: 'keep' | 'narration';
  defaultExpression: string;
  mergeNarrationLines: boolean;
}

export interface ScriptImportMatch {
  blockId: string;
  line: number;
  rawSpeaker: string;
  rawExpression?: string;
  characterId?: string;
  characterName?: string;
  characterStatus: 'exact' | 'alias' | 'smart' | 'manual' | 'unmatched';
  expression: string;
  expressionStatus: 'exact' | 'smart' | 'manual' | 'default' | 'fallback' | 'unverified';
  expressionSyntax: 'brackets' | 'parentheses' | 'pipe' | 'none';
}

export interface AiSettings {
  url: string;
  model: string;
  fallbackModels: string[];
  temperature: number;
  hasKey: boolean;
}

export interface AiSettingsInput {
  url: string;
  model: string;
  fallbackModels?: string[];
  temperature: number;
  apiKey?: string;
  probe?: boolean;
  probeLimit?: number;
  forceRefresh?: boolean;
}

export type AiModelCategory = 'reasoning' | 'general' | 'vision' | 'fast' | 'unknown';
export type AiModelSource = 'upstream' | 'builtin' | 'manual';

export interface AiModelInfo {
  id: string;
  name: string;
  category: AiModelCategory;
  source: AiModelSource;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  contextWindow?: number | null;
  recommended?: boolean;
  health: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  healthScore: number;
  latencyMs?: number | null;
  healthMessage?: string;
  lastCheckedAt?: string | null;
  failureCount?: number | null;
  circuitState?: 'closed' | 'open' | 'half_open' | null;
  nextRetryAt?: string | null;
}

export interface AiModelDiscovery {
  models: AiModelInfo[];
  recommendedModelId?: string;
  fallbackModelIds?: string[];
  source: 'upstream' | 'builtin';
  warning?: string;
  catalogCached?: boolean;
  healthCache?: { ttlSeconds: number; cachedHits: number; staleEntries: number; probed: number };
}

export interface AgentContext {
  mode?: 'assistant' | 'director';
  activeFragmentId: string;
  selectedBlockIndexes: number[];
  projectFingerprint?: string;
  branchSimulation: {
    generatedAt: string;
    truncated: boolean;
    pathCount: number;
    scenarioCount: number;
    coverage: import('./engine-core/types').BranchSimulationResult['coverage'];
    summary: import('./engine-core/types').BranchSimulationResult['summary'];
    variableConflicts: import('./engine-core/types').BranchSimulationResult['variableConflicts'];
    problemPaths: import('./engine-core/types').BranchSimulationPath[];
  };
}

export type AgentOperation =
  | { type: 'add_blocks'; fragmentId: string; blocks: StoryBlockInput[] }
  | { type: 'insert_blocks'; fragmentId: string; anchorBlockId?: string; position: 'before' | 'after' | 'start' | 'end'; blocks: StoryBlockInput[] }
  | { type: 'update_blocks'; fragmentId: string; updates: Array<{ blockId: string; patch: StoryBlockPatch }> }
  | { type: 'move_blocks'; fragmentId: string; blockIds: string[]; anchorBlockId?: string; position: 'before' | 'after' | 'start' | 'end' }
  | { type: 'create_fragment'; chapterId: string; name: string; blocks: StoryBlockInput[] }
  | { type: 'update_project'; name?: string; author?: string }
  | { type: 'upsert_character'; characterId?: string; name: string; color?: string; description?: string; expressions?: string[]; portraits?: Record<string, string>; defaultPosition?: CharacterPosition; defaultScale?: number }
  | { type: 'update_asset'; assetId: string; name?: string; forceBundle?: boolean; audioCategory?: AudioCategory; voiceCharacterId?: string }
  | { type: 'upsert_variable'; name: string; defaultValue: string | number | boolean; valueType: VariableType; displayName?: string; description?: string; persistence: VariablePersistence }
  | { type: 'update_branch'; fragmentId: string; blockId: string; title: string; options: BranchOption[] }
  | { type: 'update_production_memory'; memory: ProductionMemory };

export interface AgentPlan {
  summary: string;
  assumptions: string[];
  operations: AgentOperation[];
  toolCalls?: AgentToolTrace[];
  requestedBuilds?: AgentBuildRequest[];
  usage?: Record<string, number>;
  model?: string;
  failoverHistory?: Array<{ model: string; status: 'unavailable' | 'circuit_open'; message: string }>;
}

export interface AgentToolTrace {
  name: string;
  permission: 'read' | 'edit' | 'validate' | 'build' | 'unknown';
  ok: boolean;
  summary?: string;
}

export interface AgentBuildRequest {
  target: 'web' | 'windows' | 'renpy';
  blocked: boolean;
  requiresConfirmation: true;
}

export type AgentTaskStatus = 'queued' | 'running' | 'pausing' | 'paused' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface AgentTaskEvent {
  seq: number;
  timestamp: string;
  type: string;
  message: string;
  data: Record<string, unknown>;
}

export interface AgentCheckpoint {
  id: string;
  createdAt: string;
  attempt: number;
  step: number;
  round: number;
  model?: string | null;
  toolNames: string[];
  inherited?: boolean;
}

export interface AgentTask {
  id: string;
  instruction: string;
  displayInstruction?: string;
  status: AgentTaskStatus;
  projectId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  attempt: number;
  checkpointStep?: number;
  checkpointModel?: string | null;
  currentCheckpointId?: string | null;
  checkpoints?: AgentCheckpoint[];
  parentTaskId?: string | null;
  sourceCheckpointId?: string | null;
  remainingOperationIndexes?: number[];
  appliedOperationIndexes?: number[];
  projectVersion?: { fingerprint: string; capturedAt: string } | null;
  lastEventSeq: number;
  events?: AgentTaskEvent[];
  plan?: AgentPlan | null;
  hasPlan?: boolean;
  error?: string | null;
  context?: AgentContext;
}

export interface AgentPatchConflict { operationIndex: number; operationType: AgentOperation['type'] | 'unknown'; scope: string; expectedHash?: string; currentHash?: string; message: string }
export interface AgentPatchPreconditionResult { taskId: string; stale: boolean; canApply: boolean; baseFingerprint?: string | null; currentFingerprint: string; conflicts: AgentPatchConflict[] }
export interface AgentPatchApplyResult extends AgentPatchPreconditionResult { ok: boolean; project?: Project; appliedOperationIndexes: number[]; summary?: string; save?: { ok: boolean; path: string; bytes: number; version: number } }

export interface AgentResultRef { taskId: string; checkpointId?: string | null }
export interface AgentComparisonTarget { kind: 'fragment' | 'chapter' | 'character' | 'asset' | 'variable' | 'memory' | 'project'; id?: string | null }
export interface AgentComparisonItem { status: 'added' | 'removed' | 'modified'; summary: string; target?: AgentComparisonTarget | null; value: Record<string, unknown> }
export interface AgentComparisonCategory { name: string; items: AgentComparisonItem[] }
export interface AgentResultComparison {
  left: AgentResultRef & { label: string; instruction: string };
  right: AgentResultRef & { label: string; instruction: string };
  categories: AgentComparisonCategory[];
}

declare global {
  interface Window {
    __SLIDE_DESKTOP__?: boolean;
    __SLIDE_BOOT_STARTED_AT__?: number;
    __SLIDE_LAST_PROJECT_RELOAD__?: ProjectReloadPerformance;
    __SLIDE_PREVIEW_SEEK_PERFORMANCE__?: import('./performance/previewSeekProfiler').PreviewSeekPerformanceReport;
    __SLIDE_RPC__?: { baseUrl: string; token: string };
    pywebview?: { api: DesktopApi };
    __SLIDE_RUNTIME_SELF_TEST__?: () => { ok: boolean; engineVersion: number; current?: string; readCount: number; backlogCount: number; characterCount: number; diagnosticErrors: number; diagnosticWarnings: number };
  }
}
