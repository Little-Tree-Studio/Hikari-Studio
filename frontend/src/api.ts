import type { AgentPlan, AgentTask, AiModelDiscovery, AiSettings, AiSettingsInput, Asset, AssetFileStatus, AssetFolderRepairPreview, AssetRepairIssue, AssetRepairMatch, AudioCategory, Project, RecentProject, ScriptImportPreview } from './types';
import { readLargeValue, writeLargeValue } from './core/storage';

const waitForDesktopApi = async () => {
  if (window.pywebview?.api) return window.pywebview.api;
  const desktopHost = window.__HIKARI_DESKTOP__ === true;
  if (!desktopHost) return undefined;
  await new Promise<void>((resolve) => {
    let interval = 0;
    let timeout = 0;
    const finish = () => {
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
  return window.pywebview?.api;
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

export async function loadProject(fallback: Project): Promise<Project> {
  try {
    const api = await waitForDesktopApi();
    if (api) {
      const encoded = await withTimeout(api.load_project_json(), 30000);
      return JSON.parse(encoded) as Project;
    }
  } catch (error) {
    console.error('Python project loading failed', error);
  }
  const cached = await readLargeValue('hikari-project');
  return cached ? JSON.parse(cached) as Project : fallback;
}

export async function saveProject(project: Project) {
  try {
    const api = await waitForDesktopApi();
    if (api) return await withTimeout(api.save_project(project));
  } catch (error) {
    console.error('Python project saving failed', error);
  }
  {
    const encoded = JSON.stringify(project);
    await writeLargeValue('hikari-project', encoded);
    return { ok: true, path: '浏览器预览缓存', bytes: encoded.length };
  }
}

export async function saveProjectAs(project: Project) {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('另存为仅在桌面应用中可用');
  return withTimeout(api.save_project_as(project), 30000);
}

export async function callWindow(action: 'minimize_window' | 'toggle_maximize' | 'close_window') {
  const api = await waitForDesktopApi();
  return api?.[action]();
}

export async function newProject(name: string): Promise<Project> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('新建项目仅在桌面应用中可用');
  return withTimeout(api.new_project(name));
}

export async function openProject(): Promise<Project | null> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('打开项目仅在桌面应用中可用');
  return withTimeout(api.open_project_dialog(), 30000);
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  const api = await waitForDesktopApi();
  return api ? withTimeout(api.list_recent_projects()) : [];
}

export async function openRecentProject(path: string): Promise<Project> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('最近项目仅在桌面应用中可用');
  return withTimeout(api.open_recent_project(path), 30000);
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

export async function startAiTask(instruction: string, project: Project): Promise<AgentTask> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 任务仅在桌面应用中可用');
  return withTimeout(api.start_ai_task(instruction, project), 10000);
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

export async function cancelAiTask(taskId: string): Promise<AgentTask> {
  const api = await waitForDesktopApi();
  if (!api) throw new Error('AI Agent 任务仅在桌面应用中可用');
  return withTimeout(api.cancel_ai_task(taskId), 10000);
}
