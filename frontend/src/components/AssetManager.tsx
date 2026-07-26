import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  AlertTriangle, Archive, AudioLines, CheckCircle2, File, FileImage, FileText,
  Film, Folder, FolderOpen, HardDrive, Image, Link2, LocateFixed, PackageCheck,
  LoaderCircle, RefreshCw, Search, Trash2, Type, Upload, Wrench, X,
} from 'lucide-react';
import { applyAssetFolderRepair, importAssets, inspectAssets, previewAssetFolderRepair, replaceAssetFile } from '../api';
import { analyzeAssetReferences } from '../core/assetReferences';
import type { Asset, AssetFileStatus, AssetFolderRepairPreview, AssetRepairMatch, Project } from '../types';

type Commit = (updater: (project: Project) => Project, label?: string) => void;
type Notify = (message: string, tone?: 'error' | 'success') => void;

interface AssetManagerProps {
  project: Project;
  commit: Commit;
  notify: Notify;
  requestConfirm: (options: { title: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
  activate: (fragmentId: string, blockIndex?: number) => void;
}

const kinds = [
  { id: 'all', label: '全部', icon: Archive },
  { id: 'image', label: '图片', icon: FileImage },
  { id: 'audio', label: '音频', icon: AudioLines },
  { id: 'video', label: '视频', icon: Film },
  { id: 'font', label: '字体', icon: Type },
  { id: 'file', label: '其它', icon: File },
] as const;

const kindOf = (asset: Asset) => asset.kind === 'scene' || asset.kind === 'character' ? 'image' : asset.kind;
const directoryOf = (asset: Asset) => {
  const normalized = asset.path.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.length > 1) return parts.slice(0, -1).join('/');
  return '项目素材';
};
const formatBytes = (bytes = 0) => bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const supportedImage = (asset: Asset) => /\.(png|jpe?g|webp)$/i.test(asset.path || asset.name);

function AssetIcon({ asset }: { asset: Asset }) {
  const kind = kindOf(asset);
  if (kind === 'image' && asset.uri) return <img src={asset.uri} alt="" />;
  const Icon = kind === 'audio' ? AudioLines : kind === 'video' ? Film : kind === 'font' ? Type : FileText;
  return <Icon />;
}

export function AssetManager({ project, commit, notify, requestConfirm, activate }: AssetManagerProps) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [directory, setDirectory] = useState('all');
  const [stateFilter, setStateFilter] = useState<'all' | 'used' | 'unused' | 'missing' | 'forced'>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const [statuses, setStatuses] = useState<Record<string, AssetFileStatus>>({});
  const [scanning, setScanning] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [decodeFailures, setDecodeFailures] = useState<Set<string>>(() => new Set());
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairingId, setRepairingId] = useState<string>();
  const [folderPreview, setFolderPreview] = useState<AssetFolderRepairPreview>();
  const [matchingFolder, setMatchingFolder] = useState(false);
  const [applyingMatches, setApplyingMatches] = useState(false);
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(() => new Set());
  const report = useMemo(() => analyzeAssetReferences(project), [project]);
  const directories = useMemo(() => Array.from(new Set(project.assets.map(directoryOf))).sort((a, b) => a.localeCompare(b)), [project.assets]);
  const selected = project.assets.find((asset) => asset.id === selectedId);
  const missingFiles = project.assets.filter((asset) => statuses[asset.id]?.exists === false);
  const incompatibleImages = project.assets.filter((asset) => kindOf(asset) === 'image' && !supportedImage(asset));

  const scan = async () => {
    setScanning(true);
    try {
      const result = await inspectAssets(project.assets);
      const nextStatuses = Object.fromEntries(result.map((item) => [item.assetId, item]));
      setStatuses(nextStatuses);
      const failures = new Set<string>();
      await Promise.all(project.assets.filter((asset) => kindOf(asset) === 'image' && supportedImage(asset) && asset.uri && nextStatuses[asset.id]?.exists !== false).map((asset) => new Promise<void>((resolve) => {
        const image = new window.Image();
        const finish = (failed: boolean) => { if (failed) failures.add(asset.id); resolve(); };
        image.onload = () => finish(false); image.onerror = () => finish(true); image.src = asset.uri!;
      })));
      setDecodeFailures(failures);
    } catch (error) { notify(String(error), 'error'); } finally { setScanning(false); }
  };
  useEffect(() => { void scan(); }, [project.assets.map((asset) => `${asset.id}:${asset.path}:${asset.size}`).join('|')]);

  const shown = project.assets.filter((asset) => {
    const references = report.references[asset.id]?.length ?? 0;
    const missing = statuses[asset.id]?.exists === false || incompatibleImages.some((item) => item.id === asset.id) || decodeFailures.has(asset.id);
    return (kind === 'all' || kindOf(asset) === kind)
      && (directory === 'all' || directoryOf(asset) === directory)
      && (stateFilter === 'all' || stateFilter === 'used' && references > 0 || stateFilter === 'unused' && references === 0 || stateFilter === 'missing' && missing || stateFilter === 'forced' && asset.forceBundle)
      && `${asset.name} ${asset.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });

  const addImported = (assets: Asset[]) => {
    if (!assets.length) return;
    commit((current) => ({ ...current, assets: [...current.assets, ...assets] }), `导入 ${assets.length} 个素材`);
    notify(`已导入 ${assets.length} 个素材`);
  };
  const doImport = async (paths?: string[]) => {
    try { addImported(await importAssets(paths)); } catch (error) { notify(String(error), 'error'); }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault(); setDropActive(false);
    const paths = Array.from(event.dataTransfer.files).map((file) => (file as File & { path?: string }).path).filter((path): path is string => Boolean(path));
    if (!paths.length) { notify('请在桌面版中拖入本地素材文件', 'error'); return; }
    void doImport(paths);
  };
  const remove = async (asset: Asset) => {
    const references = report.references[asset.id]?.length ?? 0;
    if (references) { notify(`该素材仍被 ${references} 处内容引用，请先解除引用`, 'error'); return; }
    if (!await requestConfirm({ title: '删除素材', message: `从项目中移除“${asset.name}”？磁盘中的源文件不会被删除。`, confirmText: '删除', danger: true })) return;
    commit((current) => ({ ...current, assets: current.assets.filter((item) => item.id !== asset.id) }), `删除素材 ${asset.name}`);
    setSelectedId(undefined); notify('素材已从项目中移除');
  };
  const repairAsset = async (assetId: string) => {
    const asset = project.assets.find((item) => item.id === assetId);
    setRepairingId(assetId);
    try {
      const replacement = await replaceAssetFile(assetId);
      if (!replacement) return;
      commit((current) => {
        const existing = current.assets.find((item) => item.id === assetId);
        const next = { ...existing, ...replacement, id: assetId, forceBundle: existing?.forceBundle } as Asset;
        return { ...current, assets: existing ? current.assets.map((item) => item.id === assetId ? next : item) : [...current.assets, next] };
      }, `重新定位素材 ${asset?.name ?? assetId}`);
      notify('素材已更换，场景、角色和剧本预览已刷新');
    } catch (error) { notify(String(error), 'error'); } finally { setRepairingId(undefined); }
  };
  const relink = async (asset: Asset) => repairAsset(asset.id);
  const repairIssues = useMemo(() => {
    const issues = new Map<string, { assetId: string; name: string; reason: string; references: number }>();
    for (const asset of missingFiles) issues.set(asset.id, { assetId: asset.id, name: asset.name, reason: '源文件缺失', references: report.references[asset.id]?.length ?? 0 });
    for (const asset of incompatibleImages) issues.set(asset.id, { assetId: asset.id, name: asset.name, reason: '图片格式不兼容', references: report.references[asset.id]?.length ?? 0 });
    for (const assetId of decodeFailures) { const asset = project.assets.find((item) => item.id === assetId); if (asset) issues.set(assetId, { assetId, name: asset.name, reason: '图片损坏或无法解码', references: report.references[assetId]?.length ?? 0 }); }
    for (const reference of report.missing) { const previous = issues.get(reference.assetId); issues.set(reference.assetId, { assetId: reference.assetId, name: previous?.name ?? reference.assetId, reason: '素材记录丢失', references: (previous?.references ?? 0) + 1 }); }
    return [...issues.values()];
  }, [missingFiles.map((asset) => asset.id).join('|'), incompatibleImages.map((asset) => asset.id).join('|'), [...decodeFailures].join('|'), report]);
  const previewFolder = async () => {
    setMatchingFolder(true);
    try {
      const issues = repairIssues.map((issue) => {
        const asset = project.assets.find((item) => item.id === issue.assetId);
        return { ...issue, path: asset?.path ?? issue.assetId, size: asset?.size, contentHash: asset?.contentHash };
      });
      const preview = await previewAssetFolderRepair(issues);
      if (!preview) return;
      setFolderPreview(preview);
      setSelectedMatches(new Set(preview.matches.map((item) => item.assetId)));
      notify(`已扫描 ${preview.scannedFiles} 个素材文件，匹配 ${preview.matches.length} 项`);
    } catch (error) { notify(String(error), 'error'); } finally { setMatchingFolder(false); }
  };
  const mergeReplacements = (current: Project, replacements: Asset[]) => {
    const byId = new Map(replacements.map((item) => [item.id, item]));
    const known = new Set(current.assets.map((item) => item.id));
    const assets = current.assets.map((item) => {
      const replacement = byId.get(item.id);
      return replacement ? { ...item, ...replacement, id: item.id, forceBundle: item.forceBundle } : item;
    });
    for (const replacement of replacements) if (!known.has(replacement.id)) assets.push(replacement);
    return { ...current, assets };
  };
  const applyFolderMatches = async () => {
    if (!folderPreview) return;
    const matches = folderPreview.matches.filter((item) => selectedMatches.has(item.assetId));
    if (!matches.length) { notify('请至少选择一个无冲突匹配项', 'error'); return; }
    const confirmed = await requestConfirm({
      title: '应用文件夹修复',
      message: `将复制 ${matches.length} 个文件到项目素材目录，并保留现有素材 ID。此操作可通过项目历史撤销引用变更。`,
      confirmText: `修复 ${matches.length} 项`,
    });
    if (!confirmed) return;
    setApplyingMatches(true);
    try {
      const replacements = await applyAssetFolderRepair(matches);
      commit((current) => mergeReplacements(current, replacements), `自动修复 ${replacements.length} 个缺失素材`);
      setFolderPreview((current) => current ? { ...current, matches: current.matches.filter((item) => !selectedMatches.has(item.assetId)) } : current);
      setSelectedMatches(new Set());
      notify(`已修复 ${replacements.length} 个素材，所有引用已刷新`);
    } catch (error) { notify(String(error), 'error'); } finally { setApplyingMatches(false); }
  };
  const toggleMatch = (match: AssetRepairMatch) => setSelectedMatches((current) => {
    const next = new Set(current);
    if (next.has(match.assetId)) next.delete(match.assetId); else next.add(match.assetId);
    return next;
  });
  const update = (assetId: string, patch: Partial<Asset>, label: string) => commit((current) => ({ ...current, assets: current.assets.map((asset) => asset.id === assetId ? { ...asset, ...patch } : asset) }), label);

  return <div className={`asset-manager ${dropActive ? 'drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDropActive(true); }} onDragLeave={() => setDropActive(false)} onDrop={drop}>
    <header className="asset-manager-header"><div><h1>资源总览</h1><p>检查素材引用、磁盘文件与构建打包策略</p></div>{repairIssues.length > 0 && <button className="button warning" onClick={() => setRepairOpen(true)}><Wrench />修复全部· {repairIssues.length}</button>}<button className="button ghost" disabled={scanning} onClick={() => void scan()}><RefreshCw className={scanning ? 'spinning' : ''} />重新扫描</button><button className="button primary" onClick={() => void doImport()}><Upload />导入素材</button></header>
    <div className="asset-health-strip"><button className={stateFilter === 'all' ? 'active' : ''} onClick={() => setStateFilter('all')}><PackageCheck /><span><strong>{project.assets.length}</strong><small>登记素材</small></span></button><button className={stateFilter === 'used' ? 'active' : ''} onClick={() => setStateFilter('used')}><Link2 /><span><strong>{report.bundledIds.size}</strong><small>预计打包 · {formatBytes(report.bundledSize)}</small></span></button><button className={stateFilter === 'unused' ? 'active' : ''} onClick={() => setStateFilter('unused')}><Archive /><span><strong>{project.assets.filter((asset) => !report.references[asset.id]?.length).length}</strong><small>游离资源</small></span></button><button className={`${stateFilter === 'missing' ? 'active' : ''} ${repairIssues.length ? 'warning' : ''}`} onClick={() => setStateFilter('missing')}><AlertTriangle /><span><strong>{repairIssues.length}</strong><small>缺失、损坏或不兼容</small></span></button><button className={stateFilter === 'forced' ? 'active' : ''} onClick={() => setStateFilter('forced')}><HardDrive /><span><strong>{project.assets.filter((asset) => asset.forceBundle).length}</strong><small>强制打包</small></span></button></div>
    {repairIssues.length > 0 && <div className="asset-warning-banner"><AlertTriangle /><span><strong>发现 {repairIssues.length} 个资源问题</strong><small>包含缺失文件、损坏图片、不兼容格式或丢失引用</small></span><button onClick={() => setRepairOpen(true)}>修复全部</button></div>}
    {stateFilter === 'missing' && report.missing.length > 0 && <section className="missing-reference-panel"><header><AlertTriangle /><strong>找不到资源记录的引用</strong><span>重新导入对应素材，或前往引用位置解除关联</span></header><div>{report.missing.map((reference, index) => <button key={`${reference.sourceId}-${reference.assetId}-${index}`} onClick={() => reference.fragmentId && activate(reference.fragmentId, reference.blockIndex)}><strong>{reference.assetId}</strong><span>{reference.sourceName}</span><small>{reference.detail}</small><em>{reference.fragmentId ? '前往剧本' : '检查配置'}</em></button>)}</div></section>}
    <div className="asset-manager-workspace">
      <aside className="asset-filter-panel"><div className="asset-panel-heading"><FolderOpen /><strong>类型与目录</strong></div><section><small>素材类型</small>{kinds.map((item) => { const Icon = item.icon; const count = item.id === 'all' ? project.assets.length : project.assets.filter((asset) => kindOf(asset) === item.id).length; return <button className={kind === item.id ? 'active' : ''} key={item.id} onClick={() => setKind(item.id)}><Icon /><span>{item.label}</span><em>{count}</em></button>; })}</section><section><small>所在目录</small><button className={directory === 'all' ? 'active' : ''} onClick={() => setDirectory('all')}><FolderOpen /><span>全部目录</span><em>{project.assets.length}</em></button>{directories.map((item) => <button className={directory === item ? 'active' : ''} key={item} onClick={() => setDirectory(item)}><Folder /><span>{item}</span><em>{project.assets.filter((asset) => directoryOf(asset) === item).length}</em></button>)}</section></aside>
      <section className="asset-table-panel"><div className="asset-table-toolbar"><div className="asset-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或路径" />{query && <button onClick={() => setQuery('')}><X /></button>}</div><span>{shown.length} / {project.assets.length}</span></div><div className="asset-overview-table"><header><span>素材</span><span>类型 / 目录</span><span>大小</span><span>引用</span><span>打包策略</span><span>状态</span><span /></header><div>{shown.map((asset) => { const refs = report.references[asset.id] ?? []; const status = statuses[asset.id]; const missing = status?.exists === false; const bundled = report.bundledIds.has(asset.id); return <article className={`${selectedId === asset.id ? 'selected' : ''} ${missing ? 'missing' : ''}`} key={asset.id} onClick={() => setSelectedId(asset.id)}><span className="asset-name-cell"><span><AssetIcon asset={asset} /></span><span><strong>{asset.name}</strong><small>{asset.path}</small></span></span><span><strong>{kinds.find((item) => item.id === kindOf(asset))?.label ?? asset.kind}</strong><small>{directoryOf(asset)}</small></span><span>{formatBytes(status?.size ?? asset.size)}</span><span>{refs.length ? <button onClick={(event) => { event.stopPropagation(); setSelectedId(asset.id); }}><strong>{refs.length}</strong> 处</button> : <em>游离</em>}</span><span>{asset.forceBundle ? <b>强制打包</b> : bundled ? '随引用打包' : '不打包'}</span><span className={missing ? 'status-missing' : 'status-ok'}>{missing ? <><AlertTriangle />文件缺失</> : <><CheckCircle2 />正常</>}</span><button className="icon-button" title="删除素材" onClick={(event) => { event.stopPropagation(); void remove(asset); }}><Trash2 /></button></article>; })}{!shown.length && <div className="asset-table-empty"><Image /><strong>没有符合条件的素材</strong><span>调整筛选条件，或将文件拖入此窗口</span></div>}</div></div></section>
      <aside className="asset-inspector"><header><FileImage /><strong>素材详情</strong></header>{selected ? <div><div className="asset-inspector-preview"><AssetIcon asset={selected} /></div><label>显示名称<input value={selected.name} onChange={(event) => update(selected.id, { name: event.target.value }, '重命名素材')} /></label><dl><div><dt>资源 ID</dt><dd>{selected.id}</dd></div><div><dt>项目路径</dt><dd>{selected.path}</dd></div><div><dt>文件状态</dt><dd className={statuses[selected.id]?.exists === false ? 'danger' : ''}>{statuses[selected.id]?.exists === false ? '磁盘文件不存在' : '文件可用'}</dd></div><div><dt>引用次数</dt><dd>{report.references[selected.id]?.length ?? 0}</dd></div><div><dt>打包体积</dt><dd>{formatBytes(statuses[selected.id]?.size ?? selected.size)}</dd></div></dl><button className={`button full ${statuses[selected.id]?.exists === false ? 'warning' : 'ghost'}`} onClick={() => void relink(selected)}><LocateFixed />{statuses[selected.id]?.exists === false ? '重新定位文件' : '更换素材文件'}</button><label className="asset-force-toggle"><input type="checkbox" checked={selected.forceBundle ?? false} onChange={(event) => update(selected.id, { forceBundle: event.target.checked }, `${event.target.checked ? '强制打包' : '取消强制打包'} ${selected.name}`)} /><span><strong>强制打包</strong><small>即使没有直接引用也进入构建产物</small></span></label><section className="asset-inspector-references"><strong>引用详情</strong>{(report.references[selected.id] ?? []).map((reference, index) => <button key={`${reference.sourceId}-${index}`} onClick={() => reference.fragmentId && activate(reference.fragmentId, reference.blockIndex)}><span>{reference.sourceName}</span><small>{reference.detail}</small></button>)}{!report.references[selected.id]?.length && <p>该素材未被角色、场景或剧本使用。</p>}</section></div> : <div className="asset-inspector-empty"><FileImage /><span>选择素材查看引用与打包设置</span></div>}</aside>
    </div>
    {repairOpen && <div className="modal-backdrop asset-repair-backdrop" onClick={() => !applyingMatches && setRepairOpen(false)}><section className="modal asset-repair-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-repair-title" onClick={(event) => event.stopPropagation()}><header className="modal-header"><Wrench /><div><strong id="asset-repair-title">统一素材修复中心</strong><small>按文件名、扩展名和 SHA-256 哈希批量恢复素材引用</small></div><button className="icon-button" title="关闭" disabled={applyingMatches} onClick={() => setRepairOpen(false)}><X /></button></header>
      <div className="asset-folder-repair-toolbar"><div><FolderOpen /><span><strong>{folderPreview ? folderPreview.folder : '选择原素材所在文件夹'}</strong><small>{folderPreview ? `递归扫描 ${folderPreview.scannedFiles} 个支持的文件` : '扫描结果只会预览，确认前不会修改项目'}</small></span></div><button className="button primary" disabled={matchingFolder || applyingMatches} onClick={() => void previewFolder()}>{matchingFolder ? <LoaderCircle className="spinning" /> : <FolderOpen />}{matchingFolder ? '正在扫描' : folderPreview ? '重新选择文件夹' : '选择文件夹自动匹配'}</button></div>
      {folderPreview ? <div className="modal-body asset-folder-results"><div className="asset-repair-summary"><span className="success"><CheckCircle2 /><strong>{folderPreview.matches.length}</strong> 可修复</span><span className="warning"><AlertTriangle /><strong>{folderPreview.ambiguous.length}</strong> 冲突</span><span><Search /><strong>{folderPreview.unmatched.length}</strong> 未匹配</span></div>
        {folderPreview.matches.length > 0 && <section><header><strong>确定匹配</strong><small>仅勾选项会被复制并替换，素材 ID 保持不变</small></header>{folderPreview.matches.map((match) => <label className="asset-folder-match" key={match.assetId}><input type="checkbox" checked={selectedMatches.has(match.assetId)} onChange={() => toggleMatch(match)} /><span className="asset-repair-icon success"><CheckCircle2 /></span><span><strong>{match.name}</strong><small>{match.fileName} · {match.reason}</small><code>{match.sourcePath}</code></span><em>{match.score >= 400 ? '哈希' : match.score >= 300 ? '高' : match.score >= 200 ? '中' : '弱'}</em></label>)}</section>}
        {folderPreview.ambiguous.length > 0 && <section><header><strong>存在冲突</strong><small>多个候选同分，不会自动修复，请逐项手动定位</small></header>{folderPreview.ambiguous.map((item) => <article className="asset-folder-conflict" key={item.assetId}><span className="asset-repair-icon"><AlertTriangle /></span><span><strong>{item.name}</strong><small>{item.reason} · {item.candidates.length} 个候选</small><code>{item.candidates.map((candidate) => candidate.fileName).join(' · ')}</code></span><button className="button ghost" disabled={Boolean(repairingId)} onClick={() => void repairAsset(item.assetId)}><LocateFixed />手动选择</button></article>)}</section>}
        {folderPreview.unmatched.length > 0 && <section><header><strong>未找到匹配</strong><small>可手动重新定位，或换一个更完整的素材文件夹扫描</small></header>{folderPreview.unmatched.map((item) => <article className="asset-folder-unmatched" key={item.assetId}><span className="asset-repair-icon muted"><Search /></span><span><strong>{item.name}</strong><small>预期文件：{item.expectedPath}</small></span><button className="button ghost" disabled={Boolean(repairingId)} onClick={() => void repairAsset(item.assetId)}><LocateFixed />手动选择</button></article>)}</section>}
      </div> : <div className="modal-body asset-repair-list">{repairIssues.map((issue) => <article key={issue.assetId}><span className="asset-repair-icon"><AlertTriangle /></span><div><strong>{issue.name}</strong><small>{issue.reason} · {issue.references} 处引用</small><code>{issue.assetId}</code></div><button className="button ghost" disabled={Boolean(repairingId)} onClick={() => void repairAsset(issue.assetId)}>{repairingId === issue.assetId ? <LoaderCircle className="spinning" /> : <LocateFixed />}{repairingId === issue.assetId ? '正在替换' : '手动选择'}</button></article>)}{!repairIssues.length && <div className="asset-repair-complete"><CheckCircle2 /><strong>所有问题已修复</strong><span>可以关闭窗口继续制作。</span></div>}</div>}
      <footer className="modal-footer"><span>{folderPreview ? `已选择 ${selectedMatches.size} / ${folderPreview.matches.length} 项` : `剩余 ${repairIssues.length} 项`}</span>{folderPreview && <button className="button ghost" disabled={applyingMatches} onClick={() => { setFolderPreview(undefined); setSelectedMatches(new Set()); }}>返回问题列表</button>}<button className="button primary" disabled={applyingMatches || Boolean(folderPreview && !selectedMatches.size)} onClick={() => folderPreview ? void applyFolderMatches() : setRepairOpen(false)}>{applyingMatches && <LoaderCircle className="spinning" />}{folderPreview ? applyingMatches ? '正在修复' : `应用 ${selectedMatches.size} 项修复` : repairIssues.length ? '稍后继续' : '完成'}</button></footer></section></div>}
  </div>;
}
