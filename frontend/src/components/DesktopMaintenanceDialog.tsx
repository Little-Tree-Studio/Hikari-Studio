import { Activity, AlertTriangle, CheckCircle2, Download, FileWarning, History, LoaderCircle, RefreshCw, Send, Settings2, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { checkForUpdates, deleteCrashReport, downloadUpdate, getAppInfo, getCrashReport, getCrashReports, getProjectReloadPerformance, getUpdateStatus, installDownloadedUpdate, submitCrashReport } from '../api';
import type { AppInfo, BlockType, ComponentRenderSurface, CrashReport, CrashReportCenter, DialogueStoryCardRegion, ProjectReloadPerformance, UpdateStatus } from '../types';
import { AnimatedModal } from './ui/AnimatedModal';
import { Select } from './ui/Select';

interface Props {
  open: boolean;
  close: () => void;
  notify: (message: string, tone?: 'error' | 'success') => void;
  requestConfirm: (options: { title: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
}

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const dateTime = (value?: string) => value ? new Date(value).toLocaleString() : '尚未检查';
const formatMs = (value?: number) => `${(value ?? 0).toFixed(value !== undefined && value < 10 ? 2 : 1)} ms`;
const componentLabels: Record<ComponentRenderSurface, string> = {
  'app-shell': '应用外壳',
  'chapter-tree': '章节树',
  'script-page': '剧本工作区',
  'block-list': 'Block 列表',
  preview: '实时预览',
  inspector: '属性检查器',
};
const blockTypeLabels: Record<BlockType, string> = {
  scene: '场景', sound: '音频', characterShow: '显示角色', characterHide: '隐藏角色', camera: '摄像机',
  narration: '旁白', dialogue: '对白', branch: '分支', setVariable: '设置变量', condition: '条件',
  jump: '跳转', call: '调用片段', return: '返回',
};
const dialogueRegionLabels: Record<DialogueStoryCardRegion, string> = { speaker: '角色与显示名', expression: '表情选择', body: '正文与语音' };

export function DesktopMaintenanceDialog({ open, close, notify, requestConfirm }: Props) {
  const [tab, setTab] = useState<'updates' | 'performance' | 'crashes'>('updates');
  const [app, setApp] = useState<AppInfo | null>(null);
  const [updates, setUpdates] = useState<UpdateStatus | null>(null);
  const [crashes, setCrashes] = useState<CrashReportCenter>({ uploadConfigured: false, reports: [] });
  const [selectedReport, setSelectedReport] = useState<CrashReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [channel, setChannel] = useState<'stable' | 'beta'>('beta');
  const [reloadPerformance, setReloadPerformance] = useState<ProjectReloadPerformance | null>(null);

  const refreshCrashes = async () => {
    const center = await getCrashReports();
    setCrashes(center);
    if (selectedReport && !center.reports.some((report) => report.id === selectedReport.id)) setSelectedReport(null);
  };

  useEffect(() => {
    if (!open) return;
    setBusy('loading');
    void Promise.all([getAppInfo(), getUpdateStatus(), getCrashReports(), getProjectReloadPerformance()]).then(([info, status, center, profile]) => {
      setApp(info);
      setUpdates(status);
      setChannel(status.channel);
      setCrashes(center);
      setReloadPerformance(profile);
    }).catch((error) => notify(`维护中心加载失败：${String(error)}`, 'error')).finally(() => setBusy(null));
  }, [open]);

  const runCheck = async () => {
    setBusy('check');
    try { const status = await checkForUpdates(true, channel); setUpdates(status); notify(status.status === 'available' ? `发现 Hikari Studio ${status.manifest?.version}` : '当前已是最新版本'); }
    catch (error) { notify(`检查更新失败：${String(error)}`, 'error'); }
    finally { setBusy(null); }
  };
  const runDownload = async () => {
    setBusy('download');
    try { setUpdates(await downloadUpdate()); notify('安装包下载完成并通过 SHA-256 校验'); }
    catch (error) { notify(`更新下载失败：${String(error)}`, 'error'); }
    finally { setBusy(null); }
  };
  const runInstall = async (version?: string) => {
    const accepted = await requestConfirm({ title: version ? `安装 Hikari Studio ${version}` : '安装已下载更新', message: '安装程序会关闭当前编辑器。请确认项目已经保存，安装完成后可重新打开。', confirmText: '启动安装' });
    if (!accepted) return;
    setBusy(`install-${version ?? 'latest'}`);
    try {
      const result = await installDownloadedUpdate(true, version);
      if (!result.ok) throw new Error(result.error?.message ?? '安装程序无法启动');
      notify('已启动经过校验的安装程序');
    } catch (error) { notify(`启动安装失败：${String(error)}`, 'error'); }
    finally { setBusy(null); }
  };
  const openReport = async (id: string) => {
    setBusy(`report-${id}`);
    try { setSelectedReport(await getCrashReport(id)); }
    catch (error) { notify(`读取崩溃报告失败：${String(error)}`, 'error'); }
    finally { setBusy(null); }
  };
  const sendReport = async () => {
    if (!selectedReport) return;
    const accepted = await requestConfirm({ title: '发送脱敏崩溃报告', message: '仅发送右侧预览中的脱敏数据。项目正文、素材内容、Agent 原始提示和 API Key 不会包含在报告中。', confirmText: '确认发送' });
    if (!accepted) return;
    setBusy(`send-${selectedReport.id}`);
    try {
      const result = await submitCrashReport(selectedReport.id, true);
      if (!result.ok) throw new Error(result.error?.message ?? '报告发送失败');
      setSelectedReport(null);
      await refreshCrashes();
      notify('崩溃报告已发送');
    } catch (error) { notify(`崩溃报告发送失败：${String(error)}`, 'error'); }
    finally { setBusy(null); }
  };
  const removeReport = async () => {
    if (!selectedReport) return;
    if (!await requestConfirm({ title: '删除本地崩溃报告', message: '报告将从本机永久删除，且不会上传。', confirmText: '删除报告', danger: true })) return;
    await deleteCrashReport(selectedReport.id);
    setSelectedReport(null);
    await refreshCrashes();
    notify('本地崩溃报告已删除');
  };

  const isBusy = busy !== null;
  return <AnimatedModal open={open} close={close} className="maintenance-dialog" labelledBy="maintenance-title">
    <header className="modal-header maintenance-header"><div className="modal-heading-icon"><Settings2 /></div><div><strong id="maintenance-title">Hikari Studio 维护中心</strong><small>更新、安装回退与隐私可控的崩溃恢复</small></div><button className="icon-button" title="关闭" onClick={close}><X /></button></header>
    <nav className="maintenance-tabs"><button className={tab === 'updates' ? 'active' : ''} onClick={() => setTab('updates')}><RefreshCw />软件更新</button><button className={tab === 'performance' ? 'active' : ''} onClick={() => setTab('performance')}><Activity />重载性能</button><button className={tab === 'crashes' ? 'active' : ''} onClick={() => setTab('crashes')}><FileWarning />崩溃报告{crashes.reports.length > 0 && <span>{crashes.reports.length}</span>}</button></nav>
    {tab === 'updates' ? <div className="maintenance-body">
      <section className="maintenance-version"><div className="maintenance-logo">H</div><div><strong>{app?.name ?? 'Hikari Studio'}</strong><span>v{app?.version ?? updates?.currentVersion ?? '0.4.0-beta.1'} · {channel === 'beta' ? 'Beta 预览通道' : '稳定通道'}</span></div><label>更新通道<Select value={channel} disabled={isBusy} onChange={(value) => setChannel(value as 'stable' | 'beta')}><option value="beta">Beta</option><option value="stable">Stable</option></Select></label></section>
      <section className={`update-state-card ${updates?.status ?? 'idle'}`}>{updates?.status === 'available' || updates?.status === 'downloaded' ? <Download /> : updates?.status === 'error' ? <AlertTriangle /> : <CheckCircle2 />}<div><strong>{updates?.status === 'available' ? `新版本 ${updates.manifest?.version} 可用` : updates?.status === 'downloaded' ? `${updates.download?.version} 已通过校验` : updates?.status === 'error' ? '上次检查未完成' : '当前版本状态正常'}</strong><span>{updates?.error?.message ?? `上次检查：${dateTime(updates?.lastCheckedAt)}`}</span></div><button className="button ghost" disabled={isBusy} onClick={() => void runCheck()}>{busy === 'check' ? <LoaderCircle className="spin" /> : <RefreshCw />}检查更新</button></section>
      {updates?.manifest && <section className="release-notes"><header><div><strong>Hikari Studio {updates.manifest.version}</strong><small>{dateTime(updates.manifest.publishedAt)} · {formatBytes(updates.manifest.installer.size)}</small></div>{updates.status === 'downloaded' ? <button className="button primary" disabled={isBusy} onClick={() => void runInstall()}><Upload />安装更新</button> : <button className="button primary" disabled={isBusy} onClick={() => void runDownload()}>{busy === 'download' ? <LoaderCircle className="spin" /> : <Download />}下载并校验</button>}</header><p>{updates.manifest.notes || '该版本没有附加发行说明。'}</p><footer><ShieldCheck />安装前强制验证 SHA-256；不会静默更新。</footer></section>}
      <section className="rollback-section"><header><div><strong>本地安装包</strong><small>最多保留两个经过校验的版本，用于安装或回退</small></div><History /></header>{updates?.rollbackInstallers.length ? <div>{updates.rollbackInstallers.map((installer) => <article key={installer.version}><span><strong>Hikari Studio {installer.version}</strong><small>{formatBytes(installer.size)} · {dateTime(installer.downloadedAt)}</small></span><button className="button ghost compact" disabled={isBusy} onClick={() => void runInstall(installer.version)}>安装</button></article>)}</div> : <div className="maintenance-empty">尚无本地安装包</div>}</section>
    </div> : tab === 'performance' ? <div className="maintenance-body performance-report">{reloadPerformance ? <>
      <section className="performance-summary"><Activity /><div><strong>最近一次完整项目重载</strong><span>{dateTime(reloadPerformance.recordedAt ?? reloadPerformance.backend.recordedAt)} · {reloadPerformance.surface === 'project-launcher' ? '项目启动页' : '编辑器'}</span></div><b>{formatMs(reloadPerformance.frontend?.totalReloadMs ?? reloadPerformance.backend.pythonTotalMs)}</b></section>
      <section className="performance-metrics"><article><span>Python 项目读取</span><strong>{formatMs(reloadPerformance.backend.projectLoadMs)}</strong></article><article><span>Python JSON 序列化</span><strong>{formatMs(reloadPerformance.backend.pythonSerializationMs)}</strong></article><article><span>Python 载荷压缩</span><strong>{formatMs(reloadPerformance.backend.pythonCompressionMs)}</strong></article><article><span>Qt WebEngine 传输估算</span><strong>{formatMs(reloadPerformance.frontend?.webViewTransferEstimateMs)}</strong></article><article><span>前端载荷解压</span><strong>{formatMs(reloadPerformance.frontend?.payloadDecodeMs)}</strong></article><article><span>前端 JSON 解析</span><strong>{formatMs(reloadPerformance.frontend?.jsonParseMs)}</strong></article><article><span>历史与恢复状态</span><strong>{formatMs(reloadPerformance.frontend?.historyRestoreMs)}</strong></article><article><span>React 提交</span><strong>{formatMs(reloadPerformance.frontend?.reactCommitMs)}</strong></article><article><span>稳定绘制等待</span><strong>{formatMs(reloadPerformance.frontend?.stablePaintMs)}</strong></article><article><span>启动至稳定画面</span><strong>{formatMs(reloadPerformance.frontend?.bootToStablePaintMs)}</strong></article></section>
      <section className="performance-components"><header><strong>React 首次渲染组件</strong><small>挂载、更新、动态测量与提交次数</small></header><div>{(Object.entries(reloadPerformance.frontend?.componentRenders ?? {}) as [ComponentRenderSurface, NonNullable<ProjectReloadPerformance['frontend']>['componentRenders'][ComponentRenderSurface]][]).map(([surface, measurement]) => measurement && <article className={surface === 'block-list' ? 'block-list-performance' : ''} key={surface}><span>{componentLabels[surface]}</span><strong>{formatMs(measurement.actualDurationMs)}</strong><small>挂载 {formatMs(measurement.mountDurationMs)} · 更新 {formatMs(measurement.updateDurationMs)} · {measurement.commits} 次</small>{surface === 'block-list' && <><small>首次测量 {formatMs(measurement.firstMeasurementDurationMs)} · 重测 {formatMs(measurement.observerMeasurementDurationMs)} · Observer {measurement.observerCallbacks ?? 0} 次 · Revision {measurement.revisionFlushes ?? 0} 次 · 峰值 {measurement.peakObservedRows ?? 0} 行</small>{measurement.storyCardTypes && <div className="story-card-performance"><strong>StoryCard 类型挂载</strong>{(Object.entries(measurement.storyCardTypes) as [BlockType, NonNullable<typeof measurement.storyCardTypes>[BlockType]][]).sort((left, right) => (right[1]?.mountDurationMs ?? 0) - (left[1]?.mountDurationMs ?? 0)).map(([type, card]) => card && <span key={type}><b>{blockTypeLabels[type]}</b><em>{card.mounts} 张 · {formatMs(card.mountDurationMs)} · 均值 {formatMs(card.mounts ? card.mountDurationMs / card.mounts : 0)}</em></span>)}</div>}{measurement.dialogueRegions && <div className="story-card-performance dialogue-region-performance"><strong>对白卡片内部挂载</strong>{(Object.entries(measurement.dialogueRegions) as [DialogueStoryCardRegion, NonNullable<typeof measurement.dialogueRegions>[DialogueStoryCardRegion]][]).sort((left, right) => (right[1]?.mountDurationMs ?? 0) - (left[1]?.mountDurationMs ?? 0)).map(([region, value]) => value && <span key={region}><b>{dialogueRegionLabels[region]}</b><em>{formatMs(value.mountDurationMs)} · 更新 {formatMs(value.updateDurationMs)}</em></span>)}</div>}</>}</article>)}</div></section>
      <section className="performance-payload"><header><div><strong>测试负载</strong><small>{formatBytes(reloadPerformance.backend.payloadBytes)} 原始 JSON · {formatBytes(reloadPerformance.backend.transportBytes ?? reloadPerformance.backend.payloadBytes)} 桥接载荷</small></div><ShieldCheck /></header><div><span>{reloadPerformance.backend.counts.chapters}<small>章节</small></span><span>{reloadPerformance.backend.counts.fragments}<small>片段</small></span><span>{reloadPerformance.backend.counts.blocks}<small>Block</small></span><span>{reloadPerformance.backend.counts.assets}<small>素材</small></span><span>{reloadPerformance.backend.counts.timelineClips}<small>时间轴片段</small></span></div><footer>报告只记录阶段耗时、载荷大小和数量，不包含项目正文、路径或素材内容。</footer></section>
    </> : <div className="maintenance-empty"><Activity /><strong>暂无完整重载报告</strong><span>重新启动桌面安装版后，此处将展示 Python、Qt WebEngine 和 React 各阶段耗时。</span></div>}</div> : <div className="maintenance-body crash-layout"><aside><header><strong>待处理报告</strong><button className="icon-button tiny" title="刷新" disabled={isBusy} onClick={() => void refreshCrashes()}><RefreshCw /></button></header>{crashes.reports.length ? crashes.reports.map((report) => <button className={selectedReport?.id === report.id ? 'active' : ''} key={report.id} onClick={() => void openReport(report.id)}><FileWarning /><span><strong>{report.kind}</strong><small>{report.message}</small><time>{dateTime(report.createdAt)}</time></span></button>) : <div className="maintenance-empty"><CheckCircle2 />没有待处理的崩溃报告</div>}</aside><section className="crash-preview">{selectedReport ? <><header><div><strong>{selectedReport.kind}</strong><small>{selectedReport.source} · {dateTime(selectedReport.createdAt)}</small></div><code>{selectedReport.fingerprint}</code></header><div className="privacy-note"><ShieldCheck /><span><strong>本地脱敏预览</strong><small>只会发送此处数据；敏感内容已在 Python 后端写盘前移除。</small></span></div><pre>{JSON.stringify(selectedReport, null, 2)}</pre><footer><button className="button ghost danger" disabled={isBusy} onClick={() => void removeReport()}><Trash2 />删除</button><button className="button primary" disabled={isBusy || !crashes.uploadConfigured} title={crashes.uploadConfigured ? '发送报告' : '报告服务尚未配置'} onClick={() => void sendReport()}>{busy === `send-${selectedReport.id}` ? <LoaderCircle className="spin" /> : <Send />}发送报告</button></footer></> : <div className="maintenance-empty"><FileWarning /><strong>选择一份报告查看脱敏内容</strong><span>报告不会自动上传。</span></div>}</section></div>}
  </AnimatedModal>;
}
