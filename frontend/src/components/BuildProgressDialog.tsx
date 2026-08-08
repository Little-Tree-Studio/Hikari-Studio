import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, FileCode2, FolderOpen, Globe2, LoaderCircle, PackageCheck, Play, Timer, X } from 'lucide-react';
import { motion } from 'motion/react';
import { launchBuildOutput, openBuildOutput } from '../api';
import { buildKindLabel, type BuildProgressTask } from '../core/buildProgress';

interface BuildProgressDialogProps {
  task: BuildProgressTask;
  close: () => void;
}

const elapsedLabel = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}分 ${seconds.toString().padStart(2, '0')}秒` : `${seconds}秒`;
};

export function BuildProgressDialog({ task, close }: BuildProgressDialogProps) {
  const [now, setNow] = useState(Date.now());
  const [actionBusy, setActionBusy] = useState<'open' | 'launch' | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  useEffect(() => {
    if (task.status !== 'running') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [task.status]);
  useEffect(() => {
    setActionBusy(null);
    setActionError('');
    setActionMessage('');
  }, [task.id]);
  const running = task.status === 'running';
  const elapsed = (task.finishedAt ?? now) - task.startedAt;
  const TargetIcon = task.kind === 'web' ? Globe2 : task.kind === 'windows' ? PackageCheck : FileCode2;
  const runOutputAction = async (action: 'open' | 'launch') => {
    if (!task.outputPath || actionBusy) return;
    setActionBusy(action);
    setActionError('');
    setActionMessage('');
    try {
      if (action === 'open') await openBuildOutput(task.outputPath);
      else await launchBuildOutput(task.outputPath);
      setActionMessage(action === 'open' ? '已打开输出目录' : '游戏已启动');
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionBusy(null);
    }
  };

  return <div className="modal-backdrop build-progress-backdrop">
    <section className={`modal build-progress-dialog ${task.status}`} role="dialog" aria-modal="true" aria-labelledby="build-progress-title" aria-live="polite">
      <header className="modal-header">
        <div className="build-progress-heading"><span><TargetIcon /></span><div><strong id="build-progress-title">{running ? '正在构建' : task.status === 'completed' ? '构建完成' : '构建失败'}</strong><small>{task.projectName} · {buildKindLabel(task.kind)}</small></div></div>
        {!running && <button className="icon-button" title="关闭" onClick={close}><X /></button>}
      </header>
      <div className="modal-body build-progress-body">
        <div className="build-progress-summary">
          <div className={`build-progress-status-icon ${task.status}`}>{running ? <LoaderCircle className="spin" /> : task.status === 'completed' ? <CheckCircle2 /> : <AlertTriangle />}</div>
          <div><strong>{running ? task.steps.find((step) => step.status === 'active')?.label : task.status === 'completed' ? '游戏产物已经生成' : '构建未能完成'}</strong><span>{running ? task.steps.find((step) => step.status === 'active')?.detail : task.status === 'completed' ? '所有构建步骤均已完成。' : task.error}</span></div>
          <b>{task.progress}%</b>
        </div>
        <div className="build-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress}><motion.i animate={{ width: `${task.progress}%` }} transition={{ duration: .24, ease: [.2, .8, .2, 1] }} /></div>
        <ol className="build-progress-steps">
          {task.steps.map((step, index) => <li className={step.status} key={step.id}>
            <span>{step.status === 'completed' ? <CheckCircle2 /> : step.status === 'active' ? <LoaderCircle className="spin" /> : step.status === 'failed' ? <AlertTriangle /> : <Circle />}</span>
            <div><strong>{index + 1}. {step.label}</strong><small>{step.detail}</small></div>
            <em>{step.status === 'completed' ? '完成' : step.status === 'active' ? '进行中' : step.status === 'failed' ? '失败' : '等待'}</em>
          </li>)}
        </ol>
        {task.outputPath && <div className="build-output-path"><PackageCheck /><span><strong>输出位置</strong><code title={task.outputPath}>{task.outputPath}</code></span></div>}
        {task.error && <div className="build-progress-error"><AlertTriangle /><span><strong>错误信息</strong>{task.error}</span></div>}
        {actionError && <div className="build-progress-error"><AlertTriangle /><span><strong>操作未完成</strong>{actionError}</span></div>}
        {actionMessage && <div className="build-output-action-success"><CheckCircle2 />{actionMessage}</div>}
      </div>
      <footer className="modal-footer build-progress-footer"><span><Timer />已用时 {elapsedLabel(elapsed)}</span>{running ? <small>构建完成前请保持编辑器运行</small> : task.status === 'completed' && task.outputPath ? <div className="build-progress-actions"><button className="button ghost" disabled={actionBusy !== null} onClick={() => void runOutputAction('open')}>{actionBusy === 'open' ? <LoaderCircle className="spin" /> : <FolderOpen />}打开输出目录</button><button className="button primary" title={task.kind === 'renpy' ? "Ren'Py 导出仅包含脚本，请在 Ren'Py Launcher 中运行" : '立即运行游戏'} disabled={actionBusy !== null || task.kind === 'renpy'} onClick={() => void runOutputAction('launch')}>{actionBusy === 'launch' ? <LoaderCircle className="spin" /> : <Play />}立即运行游戏</button><button className="button ghost" disabled={actionBusy !== null} onClick={close}>完成</button></div> : <button className="button primary" onClick={close}>完成</button>}</footer>
    </section>
  </div>;
}
