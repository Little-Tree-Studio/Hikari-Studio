import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Activity, AlertTriangle, ArrowRight, BookOpenCheck, Bot, Box, Check, Clock3, Database, GitCompare, GitFork, KeyRound, ListTodo, LoaderCircle, Pause, Play, RefreshCw, RotateCcw, Settings2, Sparkles, Star, Wrench, XCircle } from 'lucide-react';
import { cancelAiTask, compareAiTaskResults, discoverAiModels, getAiSettings, getAiTask, listAiTasks, pauseAiTask, rebaseAiPatch, restartAiTaskFromCheckpoint, resumeAiTask, retryAiTaskOperations, saveAiSettings, startAiTask } from '../api';
import type { AgentComparisonTarget, AgentContext, AgentOperation, AgentPatchApplyResult, AgentPatchPreconditionResult, AgentPlan, AgentResultComparison, AgentResultRef, AgentTask, AgentTaskEvent, AgentTaskStatus, AiModelDiscovery, AiSettingsInput, Project } from '../types';
import { simulateProjectBranches } from '../engine-core/simulation';
import { diagnoseProject } from '../engine-core/diagnostics';
import { groupModels, MODEL_CATEGORY_LABEL, recommendedModelId } from './aiModelCatalog';
import { ProductionMemoryDialog } from './ProductionMemoryDialog';

interface AiAgentPanelProps {
  project: Project;
  applyPlan: (taskId: string, operationIndexes: number[], operations: AgentOperation[]) => Promise<AgentPatchApplyResult>;
  requestBuild: (target: 'web' | 'windows' | 'renpy') => void;
  notify: (message: string, tone?: 'error' | 'success') => void;
  navigateTarget?: (target: AgentComparisonTarget) => void;
  selectedBlockIndexes?: number[];
  updateProject: (updater: (project: Project) => Project, label?: string) => void;
  locateEditor?: (fragmentId: string, blockIndex: number) => void;
}

const operationName: Record<AgentOperation['type'], string> = { add_blocks: '添加 Block', insert_blocks: '插入 Block', update_blocks: '更新 Block', move_blocks: '移动 Block', create_fragment: '创建片段', update_project: '更新项目信息', upsert_character: '配置角色', update_asset: '更新素材引用', upsert_variable: '配置变量', update_branch: '修改分支', update_production_memory: '更新制作记忆' };
const taskStatusName: Record<AgentTaskStatus, string> = { queued: '排队中', running: '执行中', pausing: '正在暂停', paused: '已暂停', cancelling: '正在取消', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
const pausableTaskStatuses: AgentTaskStatus[] = ['queued', 'running', 'pausing'];
const resumableTaskStatuses: AgentTaskStatus[] = ['paused', 'interrupted'];
const cancellableTaskStatuses: AgentTaskStatus[] = ['queued', 'running', 'pausing', 'paused', 'cancelling'];

function taskTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function eventIcon(event: AgentTaskEvent) {
  if (event.type === 'completed' || event.type === 'tool_finished') return <Check />;
  if (event.type === 'checkpoint_saved' || event.type === 'checkpoint_restored' || event.type === 'checkpoint_selected') return <Database />;
  if (event.type === 'failed' || event.type === 'model_failed') return <XCircle />;
  if (event.type === 'paused' || event.type === 'pause_requested') return <Pause />;
  if (event.type === 'resumed') return <RotateCcw />;
  if (event.type === 'queued') return <ListTodo />;
  return <Activity />;
}

function refValue(reference: AgentResultRef) { return `${reference.taskId}:${reference.checkpointId ?? 'result'}`; }
function operationDetail(operation: AgentOperation) {
  if (operation.type === 'add_blocks') return `${operation.fragmentId} · ${operation.blocks.length} Blocks`;
  if (operation.type === 'insert_blocks') return `${operation.fragmentId} · ${operation.position} · ${operation.blocks.length} Blocks`;
  if (operation.type === 'update_blocks') return `${operation.fragmentId} · ${operation.updates.length} Blocks`;
  if (operation.type === 'move_blocks') return `${operation.fragmentId} · ${operation.blockIds.length} Blocks · ${operation.position}`;
  if (operation.type === 'create_fragment') return `${operation.name} · ${operation.blocks.length} Blocks`;
  if (operation.type === 'update_project') return [operation.name, operation.author].filter(Boolean).join(' / ');
  if (operation.type === 'upsert_character') return `${operation.name} · ${operation.expressions?.length ?? 0} 个表情 · ${Object.keys(operation.portraits ?? {}).length} 个立绘引用`;
  if (operation.type === 'update_asset') return `${operation.assetId}${operation.forceBundle !== undefined ? ` · ${operation.forceBundle ? '强制打包' : '按引用打包'}` : ''}`;
  if (operation.type === 'upsert_variable') return `${operation.name} · ${operation.valueType} · ${String(operation.defaultValue)}`;
  if (operation.type === 'update_production_memory') return `世界观 · ${operation.memory.characterRules.length + operation.memory.styleRules.length + operation.memory.facts.length + operation.memory.restrictions.length} 条规则`;
  return `${operation.fragmentId} · ${operation.options.length} 个选项`;
}

export function AiAgentPanel({ project, applyPlan, requestBuild, notify, navigateTarget, selectedBlockIndexes = [], updateProject, locateEditor }: AiAgentPanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [settings, setSettings] = useState<AiSettingsInput>({ url: 'https://api.openai.com/v1', model: 'gpt-5-mini', fallbackModels: [], temperature: 0.4, apiKey: '' });
  const [hasKey, setHasKey] = useState(false);
  const [instruction, setInstruction] = useState('为当前片段补写一段有悬念的角色对话，并给玩家三个会影响后续剧情的选择。');
  const [mode, setMode] = useState<'assistant' | 'director'>('assistant');
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [selectedOperationIndexes, setSelectedOperationIndexes] = useState<Set<number>>(new Set());
  const [appliedOperationIndexes, setAppliedOperationIndexes] = useState<Set<number>>(new Set());
  const [patchCheck, setPatchCheck] = useState<AgentPatchPreconditionResult | null>(null);
  const [checkingPatch, setCheckingPatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<AiModelDiscovery | null>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
  const [restartingCheckpointId, setRestartingCheckpointId] = useState<string | null>(null);
  const [compareLeft, setCompareLeft] = useState('');
  const [compareRight, setCompareRight] = useState('');
  const [comparison, setComparison] = useState<AgentResultComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [validationDelta, setValidationDelta] = useState<{ beforeErrors: number; afterErrors: number; beforeWarnings: number; afterWarnings: number; beforeCoverage: number; afterCoverage: number; beforeProblems: number; afterProblems: number } | null>(null);
  const eventCursor = useRef(0);
  const planOwnerRef = useRef<string | null>(null);

  useEffect(() => {
    void getAiSettings().then((value) => {
      setSettings({ url: value.url, model: value.model, fallbackModels: value.fallbackModels, temperature: value.temperature, apiKey: '' });
      setHasKey(value.hasKey);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const listed = await listAiTasks();
        if (stopped) return;
        setTasks(listed);
        const selectedTask = activeTaskId ? listed.find((task) => task.id === activeTaskId) : undefined;
        const taskId = selectedTask?.id ?? listed.find((task) => ['queued', 'running', 'pausing', 'paused', 'cancelling'].includes(task.status))?.id ?? null;
        if (activeTaskId !== taskId) {
          eventCursor.current = 0;
          setActiveTaskId(taskId);
          setActiveTask(null);
          setPlan(null);
        }
        if (taskId) {
          const snapshot = await getAiTask(taskId, eventCursor.current);
          if (stopped) return;
          const incoming = snapshot.events ?? [];
          if (incoming.length) eventCursor.current = Math.max(eventCursor.current, ...incoming.map((event) => event.seq));
          setActiveTask((current) => {
            const previous = current?.id === snapshot.id ? current.events ?? [] : [];
            const events = [...previous, ...incoming].filter((event, index, all) => all.findIndex((candidate) => candidate.seq === event.seq) === index);
            return { ...snapshot, events };
          });
          if (snapshot.plan) {
            if (planOwnerRef.current !== snapshot.id) {
              planOwnerRef.current = snapshot.id;
              setSelectedOperationIndexes(new Set(snapshot.plan.operations.map((_, index) => index)));
              setAppliedOperationIndexes(new Set(snapshot.appliedOperationIndexes ?? []));
              setPatchCheck(null);
            }
            setPlan(snapshot.plan);
          }
        }
      } catch {
        // Polling failures are transient; explicit actions still surface errors.
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 700);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [activeTaskId, project.meta.id]);

  const save = async () => {
    try {
      setBusy(true);
      const result = await saveAiSettings(settings);
      setHasKey(result.hasKey);
      setSettings((current) => ({ ...current, apiKey: '' }));
      setSettingsOpen(false);
      notify('AI 服务配置已保存');
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    try {
      setSubmitting(true);
      setPlan(null);
      planOwnerRef.current = null;
      const simulation = simulateProjectBranches(project);
      const context: AgentContext = {
        mode,
        activeFragmentId: project.activeFragmentId,
        selectedBlockIndexes,
        branchSimulation: {
          generatedAt: simulation.generatedAt,
          truncated: simulation.truncated,
          pathCount: simulation.pathCount,
          scenarioCount: simulation.scenarioCount,
          coverage: simulation.coverage,
          summary: simulation.summary,
          variableConflicts: simulation.variableConflicts,
          problemPaths: simulation.paths.filter((path) => path.status !== 'completed').slice(0, 20),
        },
      };
      const task = await startAiTask(instruction, project, context);
      eventCursor.current = 0;
      setActiveTaskId(task.id);
      setActiveTask(task);
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const selectTask = (task: AgentTask) => {
    eventCursor.current = 0;
    setActiveTaskId(task.id);
    setActiveTask(task);
    setPlan(null);
    planOwnerRef.current = null;
  };

  const controlTask = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!activeTask) return;
    try {
      const next = action === 'pause' ? await pauseAiTask(activeTask.id) : action === 'resume' ? await resumeAiTask(activeTask.id, project) : await cancelAiTask(activeTask.id);
      setActiveTask((current) => current ? { ...current, ...next, events: current.events } : next);
      setTasks((current) => current.map((task) => task.id === next.id ? { ...task, ...next } : task));
    } catch (error) {
      notify(String(error), 'error');
    }
  };

  const restartFromCheckpoint = async (checkpointId: string) => {
    if (!activeTask) return;
    try {
      setRestartingCheckpointId(checkpointId);
      const next = await restartAiTaskFromCheckpoint(activeTask.id, checkpointId, project);
      eventCursor.current = 0;
      setTasks((current) => [next, ...current.filter((task) => task.id !== next.id)]);
      setActiveTaskId(next.id);
      setActiveTask(next);
      setPlan(null);
      planOwnerRef.current = null;
      notify('已从所选检查点创建派生任务');
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setRestartingCheckpointId(null);
    }
  };

  const discover = async () => {
    try {
      setDiscovering(true);
      const result = await discoverAiModels(settings);
      setDiscovery(result);
      const recommended = recommendedModelId(result.models, result.recommendedModelId);
      setSettings((current) => {
        const selected = result.models.find((model) => model.id === current.model);
        const model = recommended ?? (selected?.health === 'unavailable' ? '' : current.model);
        return { ...current, model, fallbackModels: result.fallbackModelIds ?? [] };
      });
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setDiscovering(false);
    }
  };

  const streamedText = (activeTask?.events ?? []).filter((event) => event.type === 'text_delta' && (typeof event.data.attempt !== 'number' || event.data.attempt === activeTask?.attempt)).map((event) => typeof event.data.delta === 'string' ? event.data.delta : '').join('');
  const historyEvents = (activeTask?.events ?? []).filter((event) => event.type !== 'text_delta');
  const pendingOperationIndexes = plan ? plan.operations.map((_, index) => index).filter((index) => !appliedOperationIndexes.has(index)) : [];
  const selectedPendingIndexes = pendingOperationIndexes.filter((index) => selectedOperationIndexes.has(index));
  const comparisonOptions = useMemo(() => tasks.flatMap((task) => [
    ...(task.plan || task.hasPlan ? [{ value: refValue({ taskId: task.id }), label: `${task.instruction} · 最终结果`, ref: { taskId: task.id } as AgentResultRef }] : []),
    ...(task.checkpoints ?? []).map((checkpoint) => ({ value: refValue({ taskId: task.id, checkpointId: checkpoint.id }), label: `${task.instruction} · 检查点 ${checkpoint.step}`, ref: { taskId: task.id, checkpointId: checkpoint.id } as AgentResultRef })),
  ]), [tasks]);
  const taskRows = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const children = new Map<string, AgentTask[]>();
    const roots: AgentTask[] = [];
    for (const task of tasks) { if (task.parentTaskId && byId.has(task.parentTaskId)) children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task]); else roots.push(task); }
    const rows: Array<{ task: AgentTask; depth: number }> = [];
    const append = (task: AgentTask, depth: number, seen: Set<string>) => { if (seen.has(task.id)) return; const nextSeen = new Set(seen).add(task.id); rows.push({ task, depth }); for (const child of [...(children.get(task.id) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) append(child, depth + 1, nextSeen); };
    for (const root of roots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) append(root, 0, new Set());
    return rows;
  }, [tasks]);

  useEffect(() => {
    if (comparisonOptions.length < 2) return;
    if (!compareRight) setCompareRight(comparisonOptions[0].value);
    if (!compareLeft) setCompareLeft(comparisonOptions[1].value);
  }, [comparisonOptions, compareLeft, compareRight]);

  const compareResults = async () => {
    const left = comparisonOptions.find((item) => item.value === compareLeft)?.ref;
    const right = comparisonOptions.find((item) => item.value === compareRight)?.ref;
    if (!left || !right) return;
    try { setComparing(true); setComparison(await compareAiTaskResults(left, right)); }
    catch (error) { notify(String(error), 'error'); }
    finally { setComparing(false); }
  };

  const toggleOperation = (index: number) => { setPatchCheck(null); setSelectedOperationIndexes((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; }); };
  const applySelectedOperations = async () => {
    if (!plan || !activeTask || !selectedPendingIndexes.length) return;
    try {
      setCheckingPatch(true);
      const beforeDiagnostics = diagnoseProject(project);
      const beforeSimulation = simulateProjectBranches(project);
      const result = await applyPlan(activeTask.id, selectedPendingIndexes, selectedPendingIndexes.map((index) => plan.operations[index]));
      setPatchCheck(result);
      if (!result.ok) { notify(`检测到 ${result.conflicts.length} 项过期冲突，Patch 尚未应用`, 'error'); return; }
      setAppliedOperationIndexes((current) => new Set([...current, ...result.appliedOperationIndexes]));
      setSelectedOperationIndexes(new Set());
      setPatchCheck(null);
      if (result.project) {
        const afterDiagnostics = diagnoseProject(result.project);
        const afterSimulation = simulateProjectBranches(result.project);
        setValidationDelta({ beforeErrors: beforeDiagnostics.filter((item) => item.severity === 'error').length, afterErrors: afterDiagnostics.filter((item) => item.severity === 'error').length, beforeWarnings: beforeDiagnostics.filter((item) => item.severity === 'warning').length, afterWarnings: afterDiagnostics.filter((item) => item.severity === 'warning').length, beforeCoverage: beforeSimulation.coverage.branchOptions.percent, afterCoverage: afterSimulation.coverage.branchOptions.percent, beforeProblems: beforeSimulation.summary.error + beforeSimulation.summary.loop + beforeSimulation.summary['dead-end'] + beforeSimulation.summary.truncated, afterProblems: afterSimulation.summary.error + afterSimulation.summary.loop + afterSimulation.summary['dead-end'] + afterSimulation.summary.truncated });
      }
      notify(`已原子应用并保存 ${result.appliedOperationIndexes.length} 项修改`, 'success');
    } catch (error) { notify(String(error), 'error'); }
    finally { setCheckingPatch(false); }
  };
  const retryRemainingOperations = async () => {
    if (!activeTask || !pendingOperationIndexes.length) return;
    try {
      setSubmitting(true);
      const next = await retryAiTaskOperations(activeTask.id, pendingOperationIndexes, project);
      eventCursor.current = 0;
      planOwnerRef.current = null;
      setTasks((current) => [next, ...current.filter((task) => task.id !== next.id)]);
      setActiveTaskId(next.id);
      setActiveTask(next);
      setPlan(null);
      setSelectedOperationIndexes(new Set());
      setAppliedOperationIndexes(new Set());
      notify(`已创建派生任务，重新规划 ${pendingOperationIndexes.length} 项未接受修改`);
    } catch (error) { notify(String(error), 'error'); }
    finally { setSubmitting(false); }
  };
  const rebaseConflictedOperations = async () => {
    if (!activeTask || !patchCheck?.conflicts.length) return;
    const indexes = [...new Set(patchCheck.conflicts.map((conflict) => conflict.operationIndex))];
    try {
      setSubmitting(true);
      const next = await rebaseAiPatch(activeTask.id, indexes, project);
      eventCursor.current = 0;
      planOwnerRef.current = null;
      setTasks((current) => [next, ...current.filter((task) => task.id !== next.id)]);
      setActiveTaskId(next.id); setActiveTask(next); setPlan(null); setPatchCheck(null);
      setSelectedOperationIndexes(new Set()); setAppliedOperationIndexes(new Set());
      notify(`已基于最新项目重新生成 ${indexes.length} 项冲突 Patch`);
    } catch (error) { notify(String(error), 'error'); }
    finally { setSubmitting(false); }
  };

  return <div className="agent-page">
    <header className="agent-header"><div><span className="agent-kicker"><Sparkles /> AI 制作 Agent</span><h1>把制作目标交给 Agent</h1><p>Agent 会读取当前项目并生成可审查的结构化改动，确认后才写入项目。</p></div><div className="agent-header-actions"><button className="button ghost" onClick={() => setMemoryOpen(true)}><BookOpenCheck />制作记忆</button><button className="button ghost" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 />服务配置</button></div></header>
    {settingsOpen && <section className="agent-settings">
      <div className="field full"><label>OpenAI 兼容 API URL</label><input value={settings.url} onChange={(event) => { setSettings({ ...settings, url: event.target.value }); setDiscovery(null); }} placeholder="https://api.openai.com/v1" /></div>
      <div className="field full"><label>API Key {hasKey && <span className="configured"><Check />已安全保存</span>}</label><div className="key-input"><KeyRound /><input type="password" value={settings.apiKey} onChange={(event) => { setSettings({ ...settings, apiKey: event.target.value }); setDiscovery(null); }} placeholder={hasKey ? '留空以继续使用已保存密钥' : 'sk-...'} /></div></div>
      <div className="model-discovery-toolbar full"><div><strong>模型目录与健康探测</strong><span>读取 /models，并对高分候选验证连接和工具调用</span></div><button className="button ghost" disabled={discovering || !settings.url.trim()} onClick={() => void discover()}>{discovering ? <LoaderCircle className="spin" /> : <RefreshCw />}发现并探测</button></div>
      {discovery && <div className="model-catalog full">
        <header><span><Database />{discovery.source === 'upstream' ? '上游模型目录' : '内置模型目录'}</span><small>{discovery.models.length} 个模型{discovery.catalogCached ? ' · 目录缓存' : ''}{discovery.healthCache ? ` · 健康缓存 ${discovery.healthCache.cachedHits} · 新探测 ${discovery.healthCache.probed}` : ''}</small></header>
        {discovery.warning && <p className="model-warning">{discovery.warning}</p>}
        <div className="model-groups">{groupModels(discovery.models).map((group) => <section key={group.category}><strong>{MODEL_CATEGORY_LABEL[group.category]}</strong><div>{group.models.map((model) => <button type="button" className={`${settings.model === model.id ? 'active' : ''} health-${model.health}`} key={model.id} title={model.healthMessage} onClick={() => setSettings({ ...settings, model: model.id, fallbackModels: (discovery.fallbackModelIds ?? []).filter((id) => id !== model.id) })}><span>{model.name}{model.recommended && <em><Star />推荐</em>}</span><small>{model.id}</small><i>{[model.supportsTools && '工具', model.supportsStructuredOutput && '结构化', model.supportsVision && '视觉'].filter(Boolean).join(' · ') || '能力未知'}</i><b><Activity />{model.circuitState === 'open' ? '熔断冷却中' : model.health === 'healthy' ? '健康' : model.health === 'degraded' ? '降级' : model.health === 'unavailable' ? '不可用' : '未探测'}{model.latencyMs ? ` · ${model.latencyMs} ms` : ''}{model.health !== 'unknown' ? ` · ${model.healthScore} 分` : ''}</b></button>)}</div></section>)}</div>
      </div>}
      <div className="field"><label>模型 ID（可手动输入）</label><input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} placeholder="输入上游支持的模型 ID" /></div>
      <div className="field"><label>Temperature</label><input type="number" min="0" max="1.5" step="0.1" value={settings.temperature} onChange={(event) => setSettings({ ...settings, temperature: Number(event.target.value) })} /></div>
      <div className="agent-settings-actions full"><span>{settings.fallbackModels?.length ? `已准备 ${settings.fallbackModels.length} 个自动回退模型` : '发现和选择不会自动保存'}</span><button className="button primary" disabled={busy || !settings.model.trim()} onClick={() => void save()}><Check />保存配置</button></div>
    </section>}
    <div className="agent-workspace"><section className="agent-compose"><div className="agent-section-title"><Bot /><div><strong>制作需求</strong><span>当前上下文：{project.meta.name} / {project.activeFragmentId}</span></div></div><div className="agent-mode-switch"><button className={mode === 'assistant' ? 'active' : ''} onClick={() => setMode('assistant')}>制作助手</button><button className={mode === 'director' ? 'active' : ''} onClick={() => { setMode('director'); if (!instruction.trim() || instruction.startsWith('为当前片段补写')) setInstruction('为当前选中的剧情设计完整演出：安排场景、角色出入场与表情、镜头、BGM、音效和转场。只使用项目已有素材，并保持对白与分支逻辑不变。'); }}>导演模式</button></div><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} /><div className="agent-actions"><span>{mode === 'director' ? '导演模式会先读取制作记忆并验证全分支' : hasKey ? '服务已配置' : '需要先填写 API Key'}</span><button className="button primary" disabled={submitting || !instruction.trim() || !hasKey} onClick={() => void run()}>{submitting ? <LoaderCircle className="spin" /> : <Play />}{submitting ? '正在加入队列' : mode === 'director' ? '生成演出方案' : '生成制作计划'}</button></div>
        <section className="agent-task-queue"><header><div><GitFork /><strong>任务分支树</strong></div><span>{tasks.length} 项</span></header>{tasks.length === 0 ? <div className="agent-task-list-empty">当前项目还没有 Agent 任务</div> : <div className="agent-task-list branch-tree">{taskRows.map(({ task, depth }) => <button type="button" className={`agent-task-item status-${task.status} ${activeTaskId === task.id ? 'active' : ''} ${task.parentTaskId ? 'derived' : ''}`} style={{ '--branch-offset': `${depth * 20}px` } as CSSProperties} key={task.id} onClick={() => selectTask(task)}><span className="branch-rail">{task.parentTaskId ? <GitFork /> : <ListTodo />}</span><span className="agent-task-status">{taskStatusName[task.status]}</span><strong>{task.displayInstruction ?? task.instruction}</strong><small><Clock3 />{taskTime(task.updatedAt)} · 第 {task.attempt} 次执行{task.remainingOperationIndexes?.length ? ` · 局部重试 ${task.remainingOperationIndexes.length} 项` : task.sourceCheckpointId ? ' · 检查点重跑' : ''}</small></button>)}</div>}</section>
        <section className="agent-compare"><header><div><GitCompare /><strong>结构化结果比较</strong></div><span>任务或检查点</span></header><div className="agent-compare-pickers"><select value={compareLeft} onChange={(event) => { setCompareLeft(event.target.value); setComparison(null); }}>{comparisonOptions.map((item) => <option key={`left-${item.value}`} value={item.value}>{item.label}</option>)}</select><ArrowRight /><select value={compareRight} onChange={(event) => { setCompareRight(event.target.value); setComparison(null); }}>{comparisonOptions.map((item) => <option key={`right-${item.value}`} value={item.value}>{item.label}</option>)}</select></div><button className="button ghost" disabled={comparing || !compareLeft || !compareRight || compareLeft === compareRight} onClick={() => void compareResults()}>{comparing ? <LoaderCircle className="spin" /> : <GitCompare />}比较结果</button></section>
      </section>
      <section className="agent-result"><div className="agent-section-title"><Sparkles /><div><strong>{activeTask ? '任务执行与变更预览' : '变更预览'}</strong><span>{activeTask ? `${taskStatusName[activeTask.status]} · 第 ${activeTask.attempt} 次执行${activeTask.checkpointStep ? ` · 检查点 ${activeTask.checkpointStep}` : ''}` : '应用后可使用撤销恢复'}</span></div></div>
        {activeTask && <div className={`agent-task-runtime status-${activeTask.status}`}><div><span className="agent-task-status">{taskStatusName[activeTask.status]}</span><strong>{activeTask.instruction}</strong>{activeTask.error && <small>{activeTask.error}</small>}</div><div className="agent-task-controls">{pausableTaskStatuses.includes(activeTask.status) && <button className="button ghost" disabled={activeTask.status === 'pausing'} onClick={() => void controlTask('pause')}><Pause />{activeTask.status === 'pausing' ? '等待暂停' : '暂停'}</button>}{resumableTaskStatuses.includes(activeTask.status) && <button className="button ghost" onClick={() => void controlTask('resume')}><RotateCcw />恢复</button>}{cancellableTaskStatuses.includes(activeTask.status) && <button className="button danger" disabled={activeTask.status === 'cancelling'} onClick={() => void controlTask('cancel')}><XCircle />{activeTask.status === 'cancelling' ? '正在取消' : '取消'}</button>}</div></div>}
        {activeTask && !!activeTask.checkpoints?.length && <section className="agent-checkpoint-timeline"><header><div><GitFork /><strong>执行检查点</strong></div><span>{activeTask.checkpoints.length} 个节点</span></header><div className="agent-checkpoint-track">{activeTask.checkpoints.map((checkpoint) => { const lastTool = checkpoint.toolNames[checkpoint.toolNames.length - 1]; const selected = activeTask.currentCheckpointId === checkpoint.id; return <article className={`${selected ? 'current' : ''} ${checkpoint.inherited ? 'inherited' : ''}`} key={checkpoint.id}><div className="agent-checkpoint-marker"><span>{checkpoint.step}</span></div><div className="agent-checkpoint-copy"><strong>工具步骤 {checkpoint.step}{selected ? ' · 当前恢复点' : ''}</strong><small>{checkpoint.model || '未知模型'} · 第 {checkpoint.attempt} 次执行 · {taskTime(checkpoint.createdAt)}</small><span>{lastTool ? `最近完成：${lastTool}` : `模型轮次 ${checkpoint.round}`}{checkpoint.inherited ? ' · 继承节点' : ''}</span></div><button className="button ghost" disabled={restartingCheckpointId !== null} onClick={() => void restartFromCheckpoint(checkpoint.id)}>{restartingCheckpointId === checkpoint.id ? <LoaderCircle className="spin" /> : <RotateCcw />}从此重跑</button></article>; })}</div></section>}
        {activeTask && streamedText && <div className="agent-stream-output" aria-live="polite"><header><Sparkles /><strong>模型实时输出</strong><span>{activeTask.status === 'running' ? '生成中' : '已停止'}</span></header><pre>{streamedText}</pre></div>}
        {activeTask && !!historyEvents.length && <div className="agent-event-stream"><header><Activity /><strong>执行历史</strong><span>{historyEvents.length} 条</span></header><div>{historyEvents.map((event) => <article className={`agent-event-row event-${event.type}`} key={event.seq}><span>{eventIcon(event)}</span><div><strong>{event.message}</strong><small>{taskTime(event.timestamp)}</small></div><em>#{event.seq}</em></article>)}</div></div>}
        {comparison && <section className="agent-comparison-result"><header><GitCompare /><div><strong>{comparison.left.label} → {comparison.right.label}</strong><span>{comparison.categories.reduce((sum, category) => sum + category.items.length, 0)} 项结构化差异</span></div></header>{comparison.categories.length === 0 ? <div className="agent-no-changes">两个结果没有结构化差异</div> : comparison.categories.map((category) => <div className="agent-diff-category" key={category.name}><strong>{category.name}<span>{category.items.length}</span></strong>{category.items.map((item, index) => <article className={`diff-${item.status}`} key={`${category.name}-${index}`}><i>{item.status === 'added' ? '+' : item.status === 'removed' ? '−' : '~'}</i><span>{item.summary}</span>{item.target && navigateTarget && <button type="button" className="icon-button" title="在编辑器中打开" onClick={() => navigateTarget(item.target!)}><ArrowRight /></button>}</article>)}</div>)}</section>}
        {!plan && !activeTask && <div className="agent-empty"><Bot /><strong>等待制作任务</strong><span>Agent 的修改不会自动写入项目。</span></div>}{!plan && activeTask && !activeTask.events?.length && <div className="agent-empty compact"><LoaderCircle className="spin" /><strong>正在准备任务</strong><span>状态更新会在这里实时显示。</span></div>}{plan && <><div className="plan-summary"><strong>{plan.summary}</strong>{plan.model && <span>实际模型：{plan.model}{plan.failoverHistory?.length ? ` · 已自动切换 ${plan.failoverHistory.length} 次` : ''}</span>}{plan.assumptions.map((item) => <span key={item}>{item}</span>)}</div>{validationDelta && <section className="agent-validation-delta"><header><ListTodo /><strong>应用前后验证</strong></header><div><span>诊断错误<strong>{validationDelta.beforeErrors} → {validationDelta.afterErrors}</strong></span><span>诊断警告<strong>{validationDelta.beforeWarnings} → {validationDelta.afterWarnings}</strong></span><span>分支覆盖<strong>{validationDelta.beforeCoverage}% → {validationDelta.afterCoverage}%</strong></span><span>异常路径<strong>{validationDelta.beforeProblems} → {validationDelta.afterProblems}</strong></span></div></section>}
        {!!plan.toolCalls?.length && <div className="agent-tool-trace"><header><Wrench /><strong>工具执行记录</strong><small>{plan.toolCalls.length} 次</small></header>{plan.toolCalls.map((call, index) => <div className={call.ok ? '' : 'failed'} key={`${call.name}-${index}`}><span>{call.name}</span><em>{call.permission}</em><small>{call.ok ? call.summary ?? '完成' : call.summary ?? '失败'}</small></div>)}</div>}
        {patchCheck?.stale && <section className={`agent-patch-conflicts ${patchCheck.canApply ? 'safe' : 'blocked'}`}><header>{patchCheck.canApply ? <Check /> : <AlertTriangle />}<div><strong>{patchCheck.canApply ? '项目版本已变化，选中目标未冲突' : 'Patch 已过期，检测到目标冲突'}</strong><span>{patchCheck.canApply ? '可以继续应用当前选择' : `${patchCheck.conflicts.length} 个前置条件不再成立`}</span></div></header>{patchCheck.conflicts.map((conflict, index) => <article key={`${conflict.operationIndex}-${conflict.scope}-${index}`}><span>#{conflict.operationIndex + 1}</span><div><strong>{operationName[conflict.operationType as AgentOperation['type']] ?? conflict.operationType}</strong><small>{conflict.message} · {conflict.scope}</small></div></article>)}{!patchCheck.canApply && <div className="agent-conflict-actions"><button className="button ghost" onClick={() => { const blocked = new Set(patchCheck.conflicts.map((conflict) => conflict.operationIndex)); setSelectedOperationIndexes((current) => new Set([...current].filter((index) => !blocked.has(index)))); setPatchCheck(null); }}>排除冲突项</button><button className="button primary" disabled={submitting} onClick={() => void rebaseConflictedOperations()}><RefreshCw />基于当前项目重新生成</button></div>}</section>}
        {!!plan.operations.length && <div className="operation-selection-toolbar"><label><input type="checkbox" checked={pendingOperationIndexes.length > 0 && selectedPendingIndexes.length === pendingOperationIndexes.length} onChange={(event) => { setPatchCheck(null); setSelectedOperationIndexes(event.target.checked ? new Set(pendingOperationIndexes) : new Set()); }} />选择全部未处理项</label><span>已接受 {appliedOperationIndexes.size} · 未接受 {pendingOperationIndexes.length - selectedPendingIndexes.length}</span></div>}
        <div className="operation-list selectable">{plan.operations.map((operation, index) => { const applied = appliedOperationIndexes.has(index); const selected = selectedOperationIndexes.has(index); return <article className={`${applied ? 'applied' : ''} ${!applied && !selected ? 'excluded' : ''}`} key={index}><label className="operation-check"><input type="checkbox" disabled={applied} checked={applied || selected} onChange={() => toggleOperation(index)} /><span>{index + 1}</span></label><div><strong>{operationName[operation.type]}</strong><small>{operationDetail(operation)}</small></div><em>{applied ? '已接受' : selected ? '待应用' : '未接受'}</em></article>; })}</div>
        {!!plan.requestedBuilds?.length && <div className="agent-build-requests">{plan.requestedBuilds.map((request) => <article key={request.target}><Box /><div><strong>{request.target === 'web' ? 'Web 游戏' : request.target === 'windows' ? 'Windows 游戏' : "Ren'Py"} 构建请求</strong><small>{request.blocked ? '诊断存在错误，暂时无法构建' : pendingOperationIndexes.length ? '请先处理项目修改' : '需要单独确认，不会随项目修改自动执行'}</small></div><button className="button ghost" disabled={request.blocked || pendingOperationIndexes.length > 0} onClick={() => requestBuild(request.target)}>确认构建</button></article>)}</div>}
        {plan.operations.length > 0 ? pendingOperationIndexes.length > 0 ? <div className="agent-patch-actions"><button className="button ghost" disabled={submitting || !activeTask} onClick={() => void retryRemainingOperations()}><RotateCcw />重新执行未接受项（{pendingOperationIndexes.length}）</button><button className="button primary" disabled={!selectedPendingIndexes.length || checkingPatch} onClick={() => void applySelectedOperations()}>{checkingPatch ? <LoaderCircle className="spin" /> : <Check />}{checkingPatch ? '检查项目版本' : `应用选中的 ${selectedPendingIndexes.length} 项`}</button></div> : <div className="agent-no-changes">全部修改已接受并应用</div> : <div className="agent-no-changes">Agent 未请求项目写入</div>}</>}</section>
    </div>
    {memoryOpen && <ProductionMemoryDialog project={project} selectedBlockIndexes={selectedBlockIndexes} close={() => setMemoryOpen(false)} locate={(fragmentId, blockId) => { const blockIndex = blockId ? (project.scripts[fragmentId] ?? []).findIndex((block) => block.id === blockId) : 0; setMemoryOpen(false); locateEditor?.(fragmentId, Math.max(0, blockIndex)); }} save={(memory) => { updateProject((current) => ({ ...current, productionMemory: memory }), '更新制作记忆'); setMemoryOpen(false); notify('制作记忆已保存'); }} />}
  </div>;
}
