import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Box, BugPlay, CheckCircle2, ExternalLink, FileCode2, FolderOpen, LoaderCircle, MonitorCog, PackageX, RefreshCw, RotateCcw, RouteOff, ShieldCheck, X } from 'lucide-react';
import { preflightBuild, selectExportLocation } from '../api';
import { diagnosticSummary } from '../engine-core/diagnostics';
import type { BranchSimulationProgress } from '../engine-core/types';
import type { BuildPreflightCategory, BuildPreflightReport, BuildTarget, Project } from '../types';

interface BuildPublishDialogProps {
  project: Project;
  close: () => void;
  runBuild: (kind: BuildTarget | 'renpy', report?: BuildPreflightReport, outputRoot?: string) => void;
  locate: (fragmentId: string, blockIndex?: number) => void;
  outputRoot: string;
  updateOutputRoot: (path: string) => void;
}

const CATEGORY_META: Record<BuildPreflightCategory, { label: string; icon: typeof PackageX }> = {
  assets: { label: '素材', icon: PackageX },
  flow: { label: '流程', icon: BugPlay },
  reachability: { label: '可达性', icon: RouteOff },
  compatibility: { label: '兼容性', icon: MonitorCog },
};

export function BuildPublishDialog({ project, close, runBuild, locate, outputRoot, updateOutputRoot }: BuildPublishDialogProps) {
  const [target, setTarget] = useState<BuildTarget>('web');
  const [report, setReport] = useState<BuildPreflightReport | null>(null);
  const [progress, setProgress] = useState<BranchSimulationProgress | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [selectingLocation, setSelectingLocation] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const renpy = useMemo(() => diagnosticSummary(project), [project]);

  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    setReport(null);
    setError('');
    setProgress(null);
    void preflightBuild(project, target, { signal: controller.signal, onProgress: setProgress })
      .then((next) => setReport(next))
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [project, retryToken, target]);

  const categoryCounts = (Object.keys(CATEGORY_META) as BuildPreflightCategory[]).map((category) => ({
    category,
    errors: report?.issues.filter((item) => item.category === category && item.severity === 'error').length ?? 0,
    warnings: report?.issues.filter((item) => item.category === category && item.severity === 'warning').length ?? 0,
  }));

  const chooseOutputRoot = async () => {
    setSelectingLocation(true);
    setLocationError('');
    try {
      const selected = await selectExportLocation();
      if (selected) updateOutputRoot(selected);
    } catch (reason) {
      setLocationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSelectingLocation(false);
    }
  };

  return <div className="modal-backdrop" onClick={close}>
    <section className="modal wide build-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="build-publish-title" onClick={(event) => event.stopPropagation()}>
      <header className="modal-header">
        <div><strong id="build-publish-title">构建与发布</strong><small>逻辑模拟与桌面文件检查使用同一份报告</small></div>
        <button className="icon-button" title="关闭" onClick={close}><X /></button>
      </header>
      <div className="modal-body build-publish-body">
        <div className="publish-options build-targets">
          <button className={`publish-card ${target === 'web' ? 'selected' : ''}`} onClick={() => setTarget('web')}><ExternalLink /><strong>Web 游戏</strong><small>HTML5 独立游戏包</small></button>
          <button className={`publish-card ${target === 'windows' ? 'selected' : ''}`} onClick={() => setTarget('windows')}><Box /><strong>Windows 游戏</strong><small>WebView2 桌面游戏包</small></button>
          <button className="publish-card renpy" disabled={renpy.errors > 0} onClick={() => runBuild('renpy', undefined, outputRoot.trim() || undefined)}><FileCode2 /><strong>Ren'Py 导出</strong><small>{renpy.errors ? `${renpy.errors} 个错误需要处理` : '使用兼容子集导出脚本'}</small></button>
        </div>

        <section className="build-output-location" aria-label="导出位置">
          <div><FolderOpen /><span><strong>导出位置</strong><small>将按游戏名称和目标平台创建子目录，不会清空所选文件夹</small></span></div>
          <div className="build-output-location-control">
            <input aria-label="导出路径" value={outputRoot} placeholder="使用 Windows 默认构建目录" onChange={(event) => { updateOutputRoot(event.target.value); setLocationError(''); }} />
            {outputRoot && <button className="icon-button" title="恢复默认导出位置" onClick={() => updateOutputRoot('')}><RotateCcw /></button>}
            <button className="button ghost" disabled={selectingLocation} onClick={() => void chooseOutputRoot()}>{selectingLocation ? <LoaderCircle className="spin" /> : <FolderOpen />}选择文件夹</button>
          </div>
          {locationError && <p><AlertTriangle />{locationError}</p>}
        </section>

        {checking && <div className="build-preflight-progress"><LoaderCircle className="spin" /><div><strong>正在执行全分支模拟</strong><span>{progress ? `${progress.percent}% · ${progress.completedPaths} 条路径 · ${progress.stepsExecuted.toLocaleString()} OP` : '正在准备 Worker'}</span><i><b style={{ width: `${progress?.percent ?? 4}%` }} /></i></div></div>}
        {error && <div className="build-preflight-error"><AlertTriangle /><span><strong>检查未完成</strong>{error}</span><button className="button ghost" onClick={() => setRetryToken((value) => value + 1)}><RefreshCw />重试</button></div>}

        {report && <>
          <div className={`build-preflight-verdict ${report.blocked ? 'blocked' : 'ready'}`}>
            {report.blocked ? <AlertTriangle /> : <ShieldCheck />}
            <div><strong>{report.blocked ? '构建已阻止' : '可以开始构建'}</strong><span>{report.errors} 个错误 · {report.warnings} 个警告 · {report.stats.simulatedPaths} 条模拟路径 · {report.simulation.coveragePercent}% Fragment 覆盖</span></div>
            <em>{target === 'web' ? 'WEB' : 'WINDOWS'}</em>
          </div>
          <div className="build-preflight-categories">
            {categoryCounts.map(({ category, errors, warnings }) => { const meta = CATEGORY_META[category]; const Icon = meta.icon; return <article className={errors ? 'has-errors' : ''} key={category}><Icon /><span><strong>{meta.label}</strong><small>{errors ? `${errors} 错误` : warnings ? `${warnings} 警告` : '通过'}</small></span></article>; })}
          </div>
          <div className="build-preflight-stats"><span>{report.stats.bundledAssets} / {report.stats.assets} 个素材打包</span><span>{report.stats.blocks} 个 Block</span><span>{report.stats.fragments} 个 Fragment</span><span>{report.stats.unreachableFragments} 个不可达</span></div>
          <div className="diagnostic-list build-preflight-issues">
            {report.issues.map((item, index) => <button className={item.severity} disabled={!item.fragmentId} key={`${item.code}-${item.fragmentId}-${item.blockId}-${index}`} onClick={() => { if (!item.fragmentId) return; close(); locate(item.fragmentId, item.blockIndex); }}>
              {item.severity === 'error' ? <AlertTriangle /> : item.severity === 'warning' ? <MonitorCog /> : <CheckCircle2 />}
              <strong>{CATEGORY_META[item.category].label} · {item.code}</strong>
              <span>{item.message}</span>
              <small>{item.fragmentId ? `${item.fragmentId}${item.blockIndex !== undefined ? ` · Block ${item.blockIndex + 1}` : ''}` : '项目级'}</small>
            </button>)}
            {!report.issues.length && <div className="build-preflight-empty"><CheckCircle2 />未发现构建问题</div>}
          </div>
        </>}
      </div>
      <footer className="modal-footer build-publish-footer">
        <span>{report?.simulation.truncated ? '模拟达到状态空间上限，请检查警告后再构建。' : report?.blocked ? '修复红色阻断项后重新检查。' : '警告不会阻止构建，但可能造成运行时差异。'}</span>
        <button className="button ghost" onClick={close}>取消</button>
        <button className="button primary" disabled={checking || !report || report.blocked} onClick={() => report && runBuild(target, report, outputRoot.trim() || undefined)}>{checking ? <LoaderCircle className="spin" /> : <ShieldCheck />}开始构建</button>
      </footer>
    </section>
  </div>;
}
