import type { AgentContext, AgentPatchApplyResult, AgentPatchPreconditionResult, AgentResultComparison, AgentResultRef, AgentTask, AiModelDiscovery, AiSettings, AiSettingsInput, AppInfo, Asset, AssetFileStatus, AssetFolderRepairPreview, AssetRepairIssue, AssetRepairMatch, AudioCategory, BrowserMode, BuildPreflightReport, BuildResult, BuildTarget, Character, CommandHistoryStorageStats, CrashReport, CrashReportCenter, CrashReportSummary, DesktopProjectSession, EditorAppearance, ProfiledDesktopProjectSession, Project, ProjectCreationOptions, ProjectLoadPerformance, ProjectReloadFrontendPerformance, ProjectReloadPerformance, RecentProject, RecoverySnapshot, RecoverySnapshotStatus, ScriptImportPreview, ScriptImportRules, UpdateStatus } from './types';
import type { PreviewSeekPerformanceReport } from './performance/previewSeekProfiler';
import { readLargeValue, writeLargeValue } from './core/storage';
import type { PersistedCommandHistory } from './hooks/useCommandHistory';
import { runBuildPreflight } from './engine-core/buildPreflight';
import type { BranchSimulationProgress } from './engine-core/types';

const waitForDesktopApi = async () => {
  const ready = () => typeof window.pywebview?.api?.load_project_session === 'function';
  if (ready()) return window.pywebview!.api;
  const desktopHost = window.__SLIDE_DESKTOP__ === true;
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

const reloadMark = (reloadId: string, phase: string) => performance.mark(`slide.reload.${reloadId}.${phase}`);
const createReloadId = () => `reload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const supportsCompressedProjectPayload = () => typeof DecompressionStream === 'function' && typeof atob === 'function';

const decodeProjectPayload = async (session: ProfiledDesktopProjectSession): Promise<string> => {
  if (!session.projectPayload) {
    if (session.projectJson) return session.projectJson;
    throw new Error('桌面项目服务返回了空载荷');
  }
  if (!session.encoding || session.encoding === 'plain-json') return session.projectPayload;
  if (session.encoding !== 'gzip-base64') throw new Error(`不支持的项目载荷编码：${String(session.encoding)}`);
  if (!supportsCompressedProjectPayload()) throw new Error('当前 Qt WebEngine 不支持 gzip 项目载荷，请更新 Qt WebEngine');
  const binary = atob(session.projectPayload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const decompressed = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressed).text();
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
  localStorage.setItem('slide-editor-appearance', JSON.stringify(appearance));
  return appearance;
}

export async function getAppInfo(): Promise<AppInfo> {
  const api = await waitForDesktopApi();
  if (!api) return { name: 'Slide Studio', version: '0.4.0-beta.1', channel: 'beta', platform: 'Web', projectPath: '', dataPath: '', buildPath: '', startupProjectRequested: false };
  return withTimeout(api.get_app_info());
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const api = await waitForDesktopApi();
  if (!api) return { status: 'idle', channel: 'beta', currentVersion: '0.4.0-beta.1', rollbackInstallers: [] };
  return withTimeout(api.get_update_status());
}

export async function checkForUpdates(force = true, channel: 'stable' | 'beta' = 'beta'): Promise<UpdateStatus> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('更新检查仅在桌面应用中可用');
  return withTimeout(api.check_for_updates(force, channel), 30000);
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('更新下载仅在桌面应用中可用');
  return withTimeout(api.download_update(), 30 * 60 * 1000);
}

export async function installDownloadedUpdate(confirmed: boolean, version?: string) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('更新安装仅在桌面应用中可用');
  return withTimeout(api.install_downloaded_update(confirmed, version), 30000);
}

export async function getCrashReports(): Promise<CrashReportCenter> {
  const api = await waitForDesktopApi();
  return api ? withTimeout(api.get_crash_reports()) : { uploadConfigured: false, reports: [] };
}

export async function getCrashReport(reportId: string): Promise<CrashReport> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('崩溃报告仅在桌面应用中可用');
  return withTimeout(api.get_crash_report(reportId));
}

export async function reportFrontendCrash(payload: Record<string, unknown>): Promise<CrashReportSummary | null> {
  const api = await waitForDesktopApi();
  if (!api) return null;
  return withTimeout(api.report_frontend_crash(payload));
}

export async function submitCrashReport(reportId: string, confirmed: boolean) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('崩溃报告上传仅在桌面应用中可用');
  return withTimeout(api.submit_crash_report(reportId, confirmed), 30000);
}

export async function deleteCrashReport(reportId: string) {
  const api = await waitForDesktopApi();
  if (!api) return true;
  return withTimeout(api.delete_crash_report(reportId));
}

export async function loadProjectWithPerformance(fallback: Project): Promise<{ project: Project; performance: ProjectLoadPerformance | null }> {
  const startedAt = performance.now();
  const reloadId = createReloadId();
  reloadMark(reloadId, 'frontend-start');
  try {
    const apiWaitStarted = performance.now();
    const api = await waitForDesktopApi();
    const apiWaitMs = performance.now() - apiWaitStarted;
    reloadMark(reloadId, 'api-ready');
    if (api) {
      if (typeof api.load_project_session_profiled === 'function') {
        const bridgeStarted = performance.now();
        const session = await withTimeout(api.load_project_session_profiled(reloadId, supportsCompressedProjectPayload()), 30000);
        const bridgeRoundTripMs = performance.now() - bridgeStarted;
        reloadMark(reloadId, 'bridge-complete');
        const decodeStarted = performance.now();
        const projectJson = await decodeProjectPayload(session);
        const payloadDecodeMs = performance.now() - decodeStarted;
        reloadMark(reloadId, 'payload-decoded');
        const parseStarted = performance.now();
        const project = JSON.parse(projectJson) as Project;
        const jsonParseMs = performance.now() - parseStarted;
        reloadMark(reloadId, 'json-parsed');
        currentProjectSession = { projectPath: session.projectPath, sessionToken: session.sessionToken };
        return {
          project,
          performance: {
            reloadId,
            startedAt,
            backend: session.backend,
            apiWaitMs,
            bridgeRoundTripMs,
            webViewTransferEstimateMs: Math.max(0, bridgeRoundTripMs - session.backend.pythonTotalMs),
            payloadDecodeMs,
            jsonParseMs,
            frontendSessionLoadMs: performance.now() - startedAt,
          },
        };
      }
      return { project: acceptProjectSession(await withTimeout(api.load_project_session(), 30000)), performance: null };
    }
  } catch (error) {
    console.error('Python project loading failed', error);
    if (window.__SLIDE_DESKTOP__ === true) throw error;
  }
  if (window.__SLIDE_DESKTOP__ === true) throw new Error('桌面项目服务未就绪，已停止加载以保护项目文件');
  const cached = await readLargeValue('slide-project');
  return { project: cached ? JSON.parse(cached) as Project : fallback, performance: null };
}

export async function loadProject(fallback: Project): Promise<Project> {
  return (await loadProjectWithPerformance(fallback)).project;
}

export async function reportProjectReloadPerformance(reloadId: string, surface: 'editor' | 'project-launcher', frontend: ProjectReloadFrontendPerformance): Promise<ProjectReloadPerformance | null> {
  const api = await waitForDesktopApi();
  if (!api || typeof api.report_project_reload_performance !== 'function') return null;
  return withTimeout(api.report_project_reload_performance(reloadId, surface, frontend));
}

export async function getProjectReloadPerformance(): Promise<ProjectReloadPerformance | null> {
  const api = await waitForDesktopApi();
  if (!api || typeof api.get_project_reload_performance !== 'function') return window.__SLIDE_LAST_PROJECT_RELOAD__ ?? null;
  return withTimeout(api.get_project_reload_performance());
}

export async function reportPreviewSeekPerformance(report: PreviewSeekPerformanceReport): Promise<PreviewSeekPerformanceReport | null> {
  const api = await waitForDesktopApi();
  if (!api || typeof api.report_preview_seek_performance !== 'function') return report;
  return withTimeout(api.report_preview_seek_performance(report));
}

export async function getPreviewSeekPerformance(): Promise<PreviewSeekPerformanceReport | null> {
  const api = await waitForDesktopApi();
  if (!api || typeof api.get_preview_seek_performance !== 'function') return window.__SLIDE_PREVIEW_SEEK_PERFORMANCE__ ?? null;
  return withTimeout(api.get_preview_seek_performance());
}

export async function saveProject(project: Project) {
  const api = await waitForDesktopApi();
  if (api) {
    if (!currentProjectSession) throw new Error('桌面项目会话尚未建立，请重新打开项目');
    return withTimeout(api.save_project(project, project.meta.id, currentProjectSession.projectPath, currentProjectSession.sessionToken));
  }
  if (window.__SLIDE_DESKTOP__ === true) throw new Error('桌面项目服务未就绪，未执行保存');
  const encoded = JSON.stringify(project);
  await writeLargeValue('slide-project', encoded);
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

export async function selectExportLocation(): Promise<string | null> {
  const api = await waitForDesktopApi();
  if (!api) return null;
  return withTimeout(api.select_export_location(), 30000);
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

export async function previewScriptImport(characters: Character[], rules: ScriptImportRules): Promise<ScriptImportPreview | null> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('剧本导入仅在桌面应用中可用');
  return withTimeout(api.preview_script_import(null, characters, rules), 30000);
}

export async function readClipboardText(fallback = ''): Promise<string> {
  const api = await waitForDesktopApi();
  if (api && typeof api.read_clipboard_text === 'function') {
    try { return await withTimeout(api.read_clipboard_text(), 5000); } catch { /* use the WebView or editor fallback */ }
  }
  try { return await navigator.clipboard.readText() || fallback; } catch { return fallback; }
}

export async function writeClipboardText(text: string): Promise<boolean> {
  const api = await waitForDesktopApi();
  if (api && typeof api.write_clipboard_text === 'function') {
    try { return await withTimeout(api.write_clipboard_text(text), 5000); } catch { /* preserve the editor-local fallback */ }
  }
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

const previewClipboardFallback = (text: string, rules?: ScriptImportRules): ScriptImportPreview => {
  const prefix = 'SLIDE_BLOCKS_V1\n';
  if (text.startsWith(prefix)) {
    try {
      const blocks = JSON.parse(text.slice(prefix.length));
      if (Array.isArray(blocks)) return { sourceName: '浏览器剪贴板', format: 'Slide JSON', blocks, warnings: [], rules };
    } catch { /* report an empty preview below */ }
  }
  const blocks = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const dialogue = /^([^：:]{1,30})[：:]\s*(.+)$/.exec(line);
    return dialogue
      ? { id: `clipboard-${Date.now().toString(36)}-${index}`, type: 'dialogue' as const, speaker: dialogue[1].trim(), text: dialogue[2].trim(), expression: '默认' }
      : { id: `clipboard-${Date.now().toString(36)}-${index}`, type: 'narration' as const, text: line };
  });
  return { sourceName: '浏览器剪贴板', format: 'TXT', blocks, warnings: blocks.length ? ['Web 开发模式使用兼容解析；桌面版由 Python 处理'] : ['剪贴板中没有文本'], rules };
};

export async function previewClipboardScript(fallback = '', characters: Character[] = [], rules?: ScriptImportRules): Promise<ScriptImportPreview> {
  const api = await waitForDesktopApi();
  if (api && typeof api.preview_clipboard_script === 'function') return withTimeout(api.preview_clipboard_script(fallback, characters, rules), 10000);
  return previewClipboardFallback(await readClipboardText(fallback), rules);
}

export async function exportRenpy(project: Project, outputRoot?: string) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('导出仅在桌面应用中可用');
  return withTimeout(api.export_renpy(project, outputRoot), 30000);
}

export class BuildPreflightRejected extends Error {
  constructor(public readonly report: BuildPreflightReport, message = `构建前检查发现 ${report.errors} 个阻断问题`) {
    super(message);
    this.name = 'BuildPreflightRejected';
  }
}

export async function preflightBuild(project: Project, target: BuildTarget, options: { signal?: AbortSignal; onProgress?: (progress: BranchSimulationProgress) => void; bypassCache?: boolean } = {}) {
  const frontendReport = await runBuildPreflight(project, target, options);
  const api = await waitForDesktopApi();
  if (!api || typeof api.preflight_build !== 'function') return frontendReport;
  return withTimeout(api.preflight_build(project, target, frontendReport), 30000);
}

function acceptedBuild(result: BuildResult): asserts result is BuildResult & { ok: true; path: string } {
  if (result.ok && result.path) return;
  if (result.preflight) throw new BuildPreflightRejected(result.preflight, result.error?.message);
  throw new Error(result.error?.message ?? '构建失败，桌面端没有返回产物路径');
}

export async function buildWeb(project: Project, preflight?: BuildPreflightReport, outputRoot?: string) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('构建仅在桌面应用中可用');
  const result = await withTimeout(api.build_web(project, preflight, outputRoot), 30000);
  acceptedBuild(result);
  return result;
}

export async function buildWindows(project: Project, preflight?: BuildPreflightReport, outputRoot?: string, browserMode: BrowserMode = 'cefsharp') {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('Windows 构建仅在桌面应用中可用');
  const result = await withTimeout(api.build_windows(project, preflight, outputRoot, browserMode), 15 * 60 * 1000);
  acceptedBuild(result);
  return result;
}

export async function openBuildOutput(path: string) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('打开输出目录仅在桌面应用中可用');
  return withTimeout(api.open_build_output(path), 30000);
}

export async function launchBuildOutput(path: string) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('运行构建产物仅在桌面应用中可用');
  return withTimeout(api.launch_build_output(path), 30000);
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

export async function clearAiKey(): Promise<AiSettings> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 仅在桌面应用中可用');
  return withTimeout(api.clear_ai_key());
}

export async function discoverAiModels(settings: AiSettingsInput): Promise<AiModelDiscovery> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('模型发现仅在桌面应用中可用');
  return withTimeout(api.discover_ai_models({ ...settings, probe: true, probeLimit: 4 }), 120000);
}

export async function optimizeBlockText(text: string, kind: 'narration' | 'dialogue', context?: Record<string, unknown>): Promise<string> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI 文本优化仅在桌面应用中可用');
  return withTimeout(api.optimize_block_text(text, kind, context), 60000);
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

export async function getRecoverySnapshotStatus(): Promise<RecoverySnapshotStatus> {
  const api = await waitForDesktopApi();
  if (!api || typeof api.get_recovery_snapshot_status !== 'function') return { exists: false, updatedAt: null, bytes: 0, recoveredDuringLoad: false };
  return withTimeout(api.get_recovery_snapshot_status(), 10000);
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
