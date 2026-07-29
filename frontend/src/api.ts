import type { AgentContext, AgentPatchApplyResult, AgentPatchPreconditionResult, AgentPlan, AgentResultComparison, AgentResultRef, AgentTask, AiModelDiscovery, AiSettings, AiSettingsInput, Asset, AssetFileStatus, AssetFolderRepairPreview, AssetRepairIssue, AssetRepairMatch, AudioCategory, CommandHistoryStorageStats, DesktopProjectSession, EditorAppearance, Project, ProjectCreationOptions, RecentProject, RecoverySnapshot, ScriptImportPreview } from './types';
import { readLargeValue, writeLargeValue } from './core/storage';
import type { PersistedCommandHistory } from './hooks/useCommandHistory';

const waitForDesktopApi = async () => {
  const ready = () => typeof window.pywebview?.api?.load_project_session === 'function';
  if (ready()) return window.pywebview!.api;
  const desktopHost = window.__HIKARI_DESKTOP__ === true;
  if (!desktopHost) return undefined;
  await new Promise<void>((resolve) => {
    let interval = 0;
    let timeout = 0;
    const finish = () => {
      if (!ready()) return;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      resolve();
    };
    interval = window.setInterval(() => {
      if (window.pywebview?.api) finish();
    }, 100);
    timeout = window.setTimeout(finish, 30000);
    window.addEventListener('pywebviewready', finish, { once: true });
  });
  return ready() ? window.pywebview!.api : undefined;
};

let currentProjectSession: Omit<DesktopProjectSession, 'project'> | null = null;

const acceptProjectSession = (session: DesktopProjectSession): Project => {
  currentProjectSession = { projectPath: session.projectPath, sessionToken: session.sessionToken };
  return session.project;
};

const withTimeout = async <T>(promise: Promise<T>, milliseconds = 4000): Promise<T> => {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('Desktop API timed out')), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
};

export async function getEditorAppearance(): Promise<EditorAppearance | null> {
  const api = await waitForDesktopApi();
  return api ? withTimeout(api.get_editor_appearance()) : null;
}

export async function saveEditorAppearance(appearance: EditorAppearance): Promise<EditorAppearance> {
  const api = await waitForDesktopApi();
  if (api) return withTimeout(api.save_editor_appearance(appearance));
  localStorage.setItem('hikari-editor-appearance', JSON.stringify(appearance));
  return appearance;
}

export async function loadProject(fallback: Project): Promise<Project> {
  try {
    const api = await waitForDesktopApi();
    if (api) {
      return acceptProjectSession(await withTimeout(api.load_project_session(), 30000));
    }
  } catch (error) {
    console.error('Python project loading failed', error);
    if (window.__HIKARI_DESKTOP__ === true) throw error;
  }
  if (window.__HIKARI_DESKTOP__ === true) throw new Error('桌面项目服务未就绪，已停止加载以保护项目文件');
  const cached = await readLargeValue('hikari-project');
  return cached ? JSON.parse(cached) as Project : fallback;
}

export async function saveProject(project: Project) {
  const api = await waitForDesktopApi();
  if (api) {
    if (!currentProjectSession) throw new Error('桌面项目会话尚未建立，请重新打开项目');
    return withTimeout(api.save_project(project, project.meta.id, currentProjectSession.projectPath, currentProjectSession.sessionToken));
  }
  if (window.__HIKARI_DESKTOP__ === true) throw new Error('桌面项目服务未就绪，未执行保存');
  const encoded = JSON.stringify(project);
  await writeLargeValue('hikari-project', encoded);
  return { ok: true, path: '浏览器预览缓存', bytes: encoded.length };
}

export async function saveProjectAs(project: Project) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('另存为仅在桌面应用中可用');
  const result = await withTimeout(api.save_project_as_session(project), 30000);
  if (result) currentProjectSession = { projectPath: result.projectPath, sessionToken: result.sessionToken };
  return result;
}

export async function callWindow(action: 'minimize_window' | 'toggle_maximize' | 'close_window') {
  const api = await waitForDesktopApi();
  return api?.[action]();
}

export async function setProjectCreationWindowMode(enabled: boolean) {
  const api = await waitForDesktopApi();
  return api?.set_project_creation_mode(enabled);
}

export async function newProject(name: string): Promise<Project> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('新建项目仅在桌面应用中可用');
  return acceptProjectSession(await withTimeout(api.new_project_session(name), 30000));
}

export async function openProject(): Promise<Project | null> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('打开项目仅在桌面应用中可用');
  const session = await withTimeout(api.open_project_dialog_session(), 30000);
  return session ? acceptProjectSession(session) : null;
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  const api = await waitForDesktopApi();
  return api ? withTimeout(api.list_recent_projects()) : [];
}

export async function openRecentProject(path: string): Promise<Project> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('最近项目仅在桌面应用中可用');
  return acceptProjectSession(await withTimeout(api.open_recent_project_session(path), 30000));
}

export async function createProject(options: ProjectCreationOptions): Promise<Project> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('新建项目仅在桌面应用中可用');
  return acceptProjectSession(await withTimeout(api.create_project_session(options), 60000));
}

export async function selectProjectLocation(): Promise<string | null> {
  const api = await waitForDesktopApi();
  if (!api) return null;
  return withTimeout(api.select_project_location(), 30000);
}

export async function openProjectPath(path: string): Promise<Project> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('项目路径打开仅在桌面应用中可用');
  return acceptProjectSession(await withTimeout(api.open_project_path_session(path), 30000));
}

export async function setProjectPinned(path: string, pinned: boolean): Promise<RecentProject[]> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('固定项目仅在桌面应用中可用');
  return withTimeout(api.set_project_pinned(path, pinned));
}

export async function importAssets(paths?: string[], audioCategory?: AudioCategory) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('素材导入仅在桌面应用中可用');
  return withTimeout(api.import_assets(paths, audioCategory), 60000);
}

export async function inspectAssets(assets: Asset[]): Promise<AssetFileStatus[]> {
  const api = await waitForDesktopApi();
  if (!api) return assets.filter((asset) => asset.path.startsWith('builtin/')).map((asset) => ({ assetId: asset.id, exists: true, size: asset.size, location: 'builtin' as const }));
  return withTimeout(api.inspect_assets(assets), 30000);
}

export async function replaceAssetFile(assetId: string) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('重新定位素材仅在桌面应用中可用');
  return withTimeout(api.replace_asset_file(assetId), 60000);
}

export async function previewAssetFolderRepair(issues: AssetRepairIssue[]): Promise<AssetFolderRepairPreview | null> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('文件夹自动匹配仅在桌面应用中可用');
  return withTimeout(api.preview_asset_folder_repair(issues), 10 * 60 * 1000);
}

export async function applyAssetFolderRepair(matches: AssetRepairMatch[]): Promise<Asset[]> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('文件夹自动修复仅在桌面应用中可用');
  return withTimeout(api.apply_asset_folder_repair(matches), 10 * 60 * 1000);
}

export async function getAsrStatus() {
  const api = await waitForDesktopApi();
  if (!api) return { available: false, loaded: false, loading: false, model: 'small', message: 'ASR 仅在桌面版中可用' };
  return withTimeout(api.get_asr_status());
}

export async function loadAsrModel() {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('ASR 仅在桌面版中可用');
  return withTimeout(api.load_asr_model(), 120000);
}

export async function transcribeAudio(assets: Asset[], concurrency: number, force: boolean) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('ASR 仅在桌面版中可用');
  return withTimeout(api.transcribe_audio(assets, concurrency, force), 30 * 60 * 1000);
}

export async function previewScriptImport(): Promise<ScriptImportPreview | null> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('剧本导入仅在桌面应用中可用');
  return withTimeout(api.preview_script_import(), 30000);
}

export async function exportRenpy(project: Project) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('导出仅在桌面应用中可用');
  return withTimeout(api.export_renpy(project), 30000);
}

export async function buildWeb(project: Project) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('构建仅在桌面应用中可用');
  return withTimeout(api.build_web(project), 30000);
}

export async function buildWindows(project: Project) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('Windows 构建仅在桌面应用中可用');
  return withTimeout(api.build_windows(project), 15 * 60 * 1000);
}

export async function getAiSettings(): Promise<AiSettings> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 仅在桌面应用中可用');
  return withTimeout(api.get_ai_settings());
}

export async function saveAiSettings(settings: AiSettingsInput): Promise<AiSettings> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 仅在桌面应用中可用');
  return withTimeout(api.save_ai_settings(settings));
}

export async function discoverAiModels(settings: AiSettingsInput): Promise<AiModelDiscovery> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('模型发现仅在桌面应用中可用');
  return withTimeout(api.discover_ai_models({ ...settings, probe: true, probeLimit: 4 }), 120000);
}

export async function runAiAgent(instruction: string, project: Project): Promise<AgentPlan> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 仅在桌面应用中可用');
  return withTimeout(api.run_ai_agent(instruction, project), 120000);
}

export async function startAiTask(instruction: string, project: Project, context: AgentContext): Promise<AgentTask> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 任务仅在桌面应用中可用');
  return withTimeout(api.start_ai_task(instruction, project, context), 10000);
}

export async function listAiTasks(): Promise<AgentTask[]> {
  const api = await waitForDesktopApi();
  if (!api) return [];
  return withTimeout(api.list_ai_tasks(), 10000);
}

export async function getAiTask(taskId: string, afterSeq = 0): Promise<AgentTask> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 任务仅在桌面应用中可用');
  return withTimeout(api.get_ai_task(taskId, afterSeq), 10000);
}

export async function pauseAiTask(taskId: string): Promise<AgentTask> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 任务仅在桌面应用中可用');
  return withTimeout(api.pause_ai_task(taskId), 10000);
}

export async function resumeAiTask(taskId: string, project: Project): Promise<AgentTask> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 任务仅在桌面应用中可用');
  return withTimeout(api.resume_ai_task(taskId, project), 10000);
}

export async function restartAiTaskFromCheckpoint(taskId: string, checkpointId: string, project: Project): Promise<AgentTask> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 任务仅在桌面应用中可用');
  return withTimeout(api.restart_ai_task_from_checkpoint(taskId, checkpointId, project), 10000);
}

export async function loadCommandHistory(): Promise<PersistedCommandHistory<Project> | null> {
  const api = await waitForDesktopApi();
  if (!api) return null;
  return withTimeout(api.load_command_history(), 10000);
}

export async function loadCommandHistoryStats(): Promise<CommandHistoryStorageStats> {
  const api = await waitForDesktopApi();
  if (!api) return { version: 2, bytes: 0, uncompressedBytes: 0, compressionRate: 0, commandCount: 0, ordinaryCount: 0, pinnedCount: 0, snapshotCount: 0 };
  return withTimeout(api.load_command_history_stats(), 10000);
}

export async function loadRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  const api = await waitForDesktopApi();
  if (!api) return null;
  return withTimeout(api.load_recovery_snapshot(), 10000);
}

export async function saveCommandHistory(history: PersistedCommandHistory<Project>) {
  const api = await waitForDesktopApi();
  if (!api) {
    const commands = history.undo.length + history.redo.length + (history.version === 2 ? history.archive?.length ?? 0 : 0);
    const pinned = [...history.undo, ...history.redo, ...(history.version === 2 ? history.archive ?? [] : [])].filter((command) => command.pinned).length;
    return { ok: true, path: 'browser-memory', version: history.version, bytes: 0, uncompressedBytes: history.version === 2 ? history.storage?.uncompressedBytes ?? 0 : 0, compressionRate: 0, commandCount: commands, ordinaryCount: commands - pinned, pinnedCount: pinned, snapshotCount: history.version === 2 ? history.snapshots.length : commands * 2 };
  }
  return withTimeout(api.save_command_history(history), 30000);
}

export async function retryAiTaskOperations(taskId: string, operationIndexes: number[], project: Project): Promise<AgentTask> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('Agent 局部重试仅在桌面应用中可用');
  return withTimeout(api.retry_ai_task_operations(taskId, operationIndexes, project), 10000);
}

export async function checkAiPatchPreconditions(taskId: string, operationIndexes: number[], project: Project): Promise<AgentPatchPreconditionResult> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('Agent Patch 冲突检测仅在桌面应用中可用');
  return withTimeout(api.check_ai_patch_preconditions(taskId, operationIndexes, project), 10000);
}

export async function applyAiPatch(taskId: string, operationIndexes: number[], project: Project): Promise<AgentPatchApplyResult> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('Agent Patch 原子应用仅在桌面应用中可用');
  return withTimeout(api.apply_ai_patch(taskId, operationIndexes, project), 30000);
}

export async function rebaseAiPatch(taskId: string, operationIndexes: number[], project: Project): Promise<AgentTask> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('Agent Patch 重新生成仅在桌面应用中可用');
  return withTimeout(api.rebase_ai_patch(taskId, operationIndexes, project), 10000);
}

export async function compareAiTaskResults(left: AgentResultRef, right: AgentResultRef): Promise<AgentResultComparison> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('Agent 结果比较仅在桌面应用中可用');
  return withTimeout(api.compare_ai_task_results(left, right), 10000);
}

export async function cancelAiTask(taskId: string): Promise<AgentTask> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 任务仅在桌面应用中可用');
  return withTimeout(api.cancel_ai_task(taskId), 10000);
}
