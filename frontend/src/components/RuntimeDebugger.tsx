import { useMemo, useState } from "react";
import { CircleAlert, CircleCheck, GitBranch, Layers3, ListChecks, Play, Terminal, Trash2, TriangleAlert, Variable } from "lucide-react";
import { diagnoseProject } from "../engine-core/diagnostics";
import { simulateProjectBranches } from "../engine-core/simulation";
import type { BranchSimulationResult, EngineState } from "../engine-core/types";
import type { Project } from "../types";

export interface RuntimeConsoleEntry {
  id: string;
  level: "info" | "error";
  message: string;
}

interface RuntimeDebuggerProps {
  project: Project;
  state: EngineState;
  consoleEntries: RuntimeConsoleEntry[];
  updateVariable: (name: string, raw: string) => void;
  clearConsole: () => void;
  locate: (fragmentId: string, blockIndex: number) => void;
}

type DebugTab = "variables" | "stack" | "console" | "problems" | "simulation";

export function RuntimeDebugger({ project, state, consoleEntries, updateVariable, clearConsole, locate }: RuntimeDebuggerProps) {
  const [tab, setTab] = useState<DebugTab>("variables");
  const [simulation, setSimulation] = useState<BranchSimulationResult | null>(null);
  const diagnostics = useMemo(() => diagnoseProject(project), [project]);
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;

  return (
    <div className="runtime-debugger">
      <div className="runtime-debug-tabs">
        <button className={tab === "variables" ? "active" : ""} onClick={() => setTab("variables")}><Variable />变量</button>
        <button className={tab === "stack" ? "active" : ""} onClick={() => setTab("stack")}><Layers3 />调用栈</button>
        <button className={tab === "console" ? "active" : ""} onClick={() => setTab("console")}><Terminal />Console</button>
        <button className={tab === "problems" ? "active" : ""} onClick={() => setTab("problems")}><ListChecks />问题{diagnostics.length > 0 && <em className={errorCount ? "has-errors" : ""}>{diagnostics.length}</em>}</button>
        <button className={tab === "simulation" ? "active" : ""} onClick={() => setTab("simulation")}><GitBranch />全分支</button>
      </div>

      {tab === "variables" && <div className="runtime-variable-list">
        {Object.entries(state.variables).map(([name, value]) => <label key={name}>
          <span><code>{name}</code><small>{typeof value}</small></span>
          {typeof value === "boolean"
            ? <select value={String(value)} onChange={(event) => updateVariable(name, event.target.value)}><option value="true">true</option><option value="false">false</option></select>
            : <input value={String(value)} type={typeof value === "number" ? "number" : "text"} onChange={(event) => updateVariable(name, event.target.value)} />}
        </label>)}
        {!Object.keys(state.variables).length && <div className="runtime-empty">当前没有运行时变量</div>}
      </div>}

      {tab === "stack" && <div className="runtime-stack">
        <article className="current"><strong>当前上下文</strong><span>{state.fragmentId}</span><small>OP {state.instructionPointer + 1}</small></article>
        {[...state.callStack].reverse().map((frame, index) => <article key={`${frame.fragmentId}-${frame.instructionPointer}-${index}`}><strong>返回 #{state.callStack.length - index}</strong><span>{frame.fragmentId}</span><small>OP {frame.instructionPointer + 1}</small></article>)}
        {!state.callStack.length && <div className="runtime-empty">当前不在 Fragment 调用中</div>}
      </div>}

      {tab === "console" && <div className="runtime-console-panel">
        <button className="runtime-console-clear" title="清空 Console" onClick={clearConsole}><Trash2 /></button>
        <div className="runtime-console">
          {consoleEntries.map((entry) => <div className={entry.level} key={entry.id}>
            {entry.level === "error" ? <CircleAlert /> : <Terminal />}
            <time>{new Date(Number(entry.id.split("-")[0])).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
            <span>{entry.message}</span>
          </div>)}
          {!consoleEntries.length && <div className="runtime-empty">Console 暂无日志</div>}
        </div>
      </div>}

      {tab === "problems" && <div className="runtime-problems">
        {diagnostics.map((item, index) => <button
          key={`${item.code}-${item.fragmentId ?? item.relatedId ?? index}-${item.blockIndex ?? index}`}
          className={item.severity}
          disabled={!item.fragmentId}
          onClick={() => item.fragmentId && locate(item.fragmentId, item.blockIndex ?? 0)}
        >
          {item.severity === "error" ? <CircleAlert /> : item.severity === "warning" ? <TriangleAlert /> : <CircleCheck />}
          <span><strong>{item.message}</strong><small>{item.code}{item.fragmentId ? ` · ${item.fragmentId}${item.blockIndex !== undefined ? ` · Block ${item.blockIndex + 1}` : ""}` : ""}</small></span>
        </button>)}
        {!diagnostics.length && <div className="runtime-empty"><CircleCheck />未发现项目问题</div>}
      </div>}

      {tab === "simulation" && <div className="branch-simulation-panel">
        <header><div><strong>全分支模拟</strong><small>使用共享 engine-core 遍历条件、变量与所有选项</small></div><button className="button primary" onClick={() => setSimulation(simulateProjectBranches(project))}><Play />运行模拟</button></header>
        {simulation ? <>
          <div className="branch-simulation-stats"><div><span>路径</span><strong>{simulation.pathCount}</strong></div><div><span>Fragment</span><strong>{simulation.coverage.fragments.percent}%</strong></div><div><span>Block</span><strong>{simulation.coverage.blocks.percent}%</strong></div><div><span>选项</span><strong>{simulation.coverage.branchOptions.percent}%</strong></div></div>
          {simulation.truncated && <div className="simulation-warning"><TriangleAlert />状态空间超过当前限制，结果未被标记为完整通过</div>}
          <div className="simulation-path-list">{simulation.paths.map((path) => <button key={path.id} className={`simulation-path status-${path.status}`} disabled={!path.location} onClick={() => path.location && locate(path.location.fragmentId, path.location.blockIndex ?? 0)}><span>{path.status === 'completed' ? <CircleCheck /> : <CircleAlert />}</span><div><strong>{path.message}</strong><small>{path.visitedFragments.join(' → ')} · {path.steps} OP{path.choices.length ? ` · ${path.choices.map((choice) => choice.text).join(' / ')}` : ''}</small></div><em>{path.status}</em></button>)}</div>
        </> : <div className="runtime-empty">运行后显示通关路径、死路、循环与覆盖率</div>}
      </div>}

      <div className="runtime-context-bar"><span>运行上下文：{state.fragmentId} · 执行 {state.stepsExecuted} 步</span><em>{state.error ? "错误" : state.finished ? "已结束" : "运行中"}</em></div>
    </div>
  );
}
