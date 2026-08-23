import type { BuildTarget } from '../types';

export type BuildKind = BuildTarget | 'renpy';
export type BuildProgressStatus = 'running' | 'completed' | 'failed';
export type BuildStepStatus = 'pending' | 'active' | 'completed' | 'failed';
export type BuildStepId = 'preflight' | 'save' | 'generate' | 'verify';

export interface BuildProgressStep {
  id: BuildStepId;
  label: string;
  detail: string;
  status: BuildStepStatus;
}

export interface BuildProgressTask {
  id: string;
  kind: BuildKind;
  projectName: string;
  status: BuildProgressStatus;
  progress: number;
  steps: BuildProgressStep[];
  startedAt: number;
  finishedAt?: number;
  outputPath?: string;
  error?: string;
}

const STEP_LABELS: Record<BuildKind, Array<Omit<BuildProgressStep, 'status'>>> = {
  web: [
    { id: 'preflight', label: '检查项目完整性', detail: '检查素材、流程、分支与 Web 兼容性' },
    { id: 'save', label: '保存项目快照', detail: '将当前编辑内容安全写入项目目录' },
    { id: 'generate', label: '生成 Web 游戏内容', detail: '整理引用素材、运行时和项目数据' },
    { id: 'verify', label: '确认输出产物', detail: '检查入口文件与发布目录' },
  ],
  windows: [
    { id: 'preflight', label: '检查项目完整性', detail: '检查素材、流程、分支与 Windows 兼容性' },
    { id: 'save', label: '保存项目快照', detail: '将当前编辑内容安全写入项目目录' },
    { id: 'generate', label: '组装 Windows 游戏', detail: '生成游戏内容并复制所选浏览器启动器' },
    { id: 'verify', label: '确认输出产物', detail: '检查启动程序与游戏数据目录' },
  ],
  renpy: [
    { id: 'preflight', label: '检查兼容语法', detail: '检查诊断错误和 Ren\'Py 兼容范围' },
    { id: 'save', label: '保存项目快照', detail: '将当前编辑内容安全写入项目目录' },
    { id: 'generate', label: '转换 Ren\'Py 脚本', detail: '转换角色、对白、分支和常用演出' },
    { id: 'verify', label: '确认输出产物', detail: '检查脚本文件与导出目录' },
  ],
};

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function createBuildProgressTask(kind: BuildKind, projectName: string, now = Date.now()): BuildProgressTask {
  return {
    id: `build-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    projectName,
    status: 'running',
    progress: 1,
    steps: STEP_LABELS[kind].map((step, index) => ({ ...step, status: index === 0 ? 'active' : 'pending' })),
    startedAt: now,
  };
}

export function updateBuildProgress(task: BuildProgressTask, stepId: BuildStepId, fraction = 0, detail?: string): BuildProgressTask {
  if (task.status !== 'running') return task;
  const index = task.steps.findIndex((step) => step.id === stepId);
  if (index < 0) return task;
  const progress = Math.max(task.progress, Math.min(99, Math.round(((index + clamp(fraction)) / task.steps.length) * 100)));
  return {
    ...task,
    progress,
    steps: task.steps.map((step, stepIndex) => ({
      ...step,
      detail: stepIndex === index && detail ? detail : step.detail,
      status: stepIndex < index ? 'completed' : stepIndex === index ? 'active' : 'pending',
    })),
  };
}

export function completeBuildProgress(task: BuildProgressTask, outputPath: string, now = Date.now()): BuildProgressTask {
  return {
    ...task,
    status: 'completed',
    progress: 100,
    outputPath,
    finishedAt: now,
    steps: task.steps.map((step) => ({ ...step, status: 'completed' })),
  };
}

export function failBuildProgress(task: BuildProgressTask, error: string, now = Date.now()): BuildProgressTask {
  return {
    ...task,
    status: 'failed',
    error,
    finishedAt: now,
    steps: task.steps.map((step) => ({ ...step, status: step.status === 'active' ? 'failed' : step.status })),
  };
}

export const buildKindLabel = (kind: BuildKind) => kind === 'web' ? 'Web 游戏' : kind === 'windows' ? 'Windows 游戏' : "Ren'Py 脚本";
