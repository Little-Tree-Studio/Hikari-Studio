import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import {
  AlertTriangle, ArrowDownAZ, CheckCircle2, ChevronDown, ChevronRight, Copy, Eye,
  EyeOff, FileImage, FolderPlus, GripVertical, Image, Layers3, LoaderCircle,
  LocateFixed, MoreHorizontal, Plus, Search, Trash2, Upload, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { importAssets, inspectAssets, replaceAssetFile } from '../api';
import { projectScenes, synchronizeSceneBlocks } from '../core/scenes';
import type { Asset, AssetFileStatus, Project, SceneDefinition, SceneDefinitionLayer, SceneGroup } from '../types';

type Props = {
  project: Project;
  commit: (updater: (project: Project) => Project, label?: string) => void;
  notify: (message: string, tone?: 'error' | 'success') => void;
  requestText: (options: { title: string; message?: string; placeholder?: string; initialValue?: string; confirmText?: string }) => Promise<string | null>;
  requestConfirm: (options: { title: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
  activate: (fragmentId: string, blockIndex?: number) => void;
};

const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const supportedImage = (name: string) => /\.(png|jpe?g|webp)$/i.test(name);
const fileToAsset = (file: File) => new Promise<Asset>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error(`无法读取 ${file.name}`));
  reader.onload = () => resolve({ id: makeId('asset'), kind: 'scene', name: file.name.replace(/\.[^.]+$/, ''), path: file.name, uri: String(reader.result), size: file.size });
  reader.readAsDataURL(file);
});
const newLayer = (asset?: Asset, index = 0): SceneDefinitionLayer => ({ id: makeId('scene-layer'), name: asset?.name ?? `图层 ${index + 1}`, assetId: asset?.id, opacity: 1, blendMode: 'normal', offsetX: 0, offsetY: 0, scale: 1, distance: 1, visible: true });
const sceneFromAsset = (asset: Asset, groupId?: string): SceneDefinition => ({ id: makeId('scene'), name: asset.name, groupId, layers: [newLayer(asset)] });

export function SceneManager({ project, commit, notify, requestText, requestConfirm, activate }: Props) {
  const scenes = projectScenes(project);
  const groups = project.sceneGroups ?? [];
  const [selectedId, setSelectedId] = useState(scenes[0]?.id ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(selectedId ? [selectedId] : []));
  const [selectionAnchor, setSelectionAnchor] = useState(selectedId);
  const [selectedLayerId, setSelectedLayerId] = useState(scenes[0]?.layers[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'manual' | 'name' | 'layers'>('manual');
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [layerTab, setLayerTab] = useState<'distance' | 'offset'>('distance');
  const [isolation, setIsolation] = useState<'all' | 'dim' | 'only'>('all');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<'list' | 'stage' | 'layers' | null>(null);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [assetStatuses, setAssetStatuses] = useState<Record<string, AssetFileStatus>>({});
  const [failedAssetIds, setFailedAssetIds] = useState<Set<string>>(() => new Set());
  const [relinkingAssetId, setRelinkingAssetId] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileModeRef = useRef<'scenes' | 'layers'>('scenes');
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = scenes.find((scene) => scene.id === selectedId) ?? scenes[0];
  const selectedLayer = selected?.layers.find((layer) => layer.id === selectedLayerId) ?? selected?.layers[0];
  const imageAssets = project.assets.filter((asset) => ['scene', 'image'].includes(asset.kind));
  const references = selected ? Object.entries(project.scripts).flatMap(([fragmentId, blocks]) => blocks.flatMap((block, blockIndex) => block.type === 'scene' && (block.sceneId === selected.id || (!block.sceneId && block.assetId === selected.layers.at(-1)?.assetId)) ? [{ fragmentId, blockIndex }] : [])) : [];

  useEffect(() => {
    if (!selected && scenes[0]) { setSelectedId(scenes[0].id); setSelectedIds(new Set([scenes[0].id])); setSelectedLayerId(scenes[0].layers[0]?.id ?? ''); }
    else if (selected && !selected.layers.some((layer) => layer.id === selectedLayerId)) setSelectedLayerId(selected.layers[0]?.id ?? '');
  }, [selected?.id, selected?.layers.map((layer) => layer.id).join('|'), scenes.length]);
  useEffect(() => { const close = () => setContextMenu(null); window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close); }, []);
  useEffect(() => {
    let cancelled = false;
    void inspectAssets(project.assets).then((items) => { if (!cancelled) setAssetStatuses(Object.fromEntries(items.map((item) => [item.assetId, item]))); }).catch(() => undefined);
    setFailedAssetIds(new Set());
    return () => { cancelled = true; };
  }, [project.assets.map((asset) => `${asset.id}:${asset.path}:${asset.uri ?? ''}:${asset.size ?? 0}`).join('|')]);

  const shownScenes = useMemo(() => {
    const filtered = scenes.filter((scene) => scene.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    return sort === 'name' ? [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) : sort === 'layers' ? [...filtered].sort((a, b) => b.layers.length - a.layers.length) : filtered;
  }, [scenes, query, sort]);
  const scenesInGroup = (groupId?: string) => shownScenes.filter((scene) => scene.groupId === groupId || (!groupId && !scene.groupId));

  const selectScene = (scene: SceneDefinition, event?: MouseEvent) => {
    setSelectedId(scene.id); setSelectedLayerId(scene.layers[0]?.id ?? '');
    setSelectedIds((current) => {
      if (event?.shiftKey) {
        const start = scenes.findIndex((item) => item.id === selectionAnchor); const end = scenes.findIndex((item) => item.id === scene.id);
        return new Set(scenes.slice(Math.min(start, end), Math.max(start, end) + 1).map((item) => item.id));
      }
      if (event?.ctrlKey || event?.metaKey) { const next = new Set(current); next.has(scene.id) ? next.delete(scene.id) : next.add(scene.id); return next.size ? next : new Set([scene.id]); }
      return new Set([scene.id]);
    });
    if (!event?.shiftKey) setSelectionAnchor(scene.id);
  };
  const patchScene = (patch: Partial<SceneDefinition>, label = '更新场景') => {
    if (!selected) return;
    commit((current) => {
      const nextScene = { ...projectScenes(current).find((scene) => scene.id === selected.id)!, ...patch };
      const next = { ...current, scenes: projectScenes(current).map((scene) => scene.id === selected.id ? nextScene : scene) };
      return synchronizeSceneBlocks(next, nextScene);
    }, `${label} ${selected.name}`);
  };
  const patchLayer = (layerId: string, patch: Partial<SceneDefinitionLayer>, label = '更新场景图层') => selected && patchScene({ layers: selected.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer) }, label);
  const addAssetsAsScenes = (assets: Asset[], groupId?: string) => {
    if (!assets.length) return;
    const normalized = assets.map((asset) => ({ ...asset, kind: 'scene' })); const created = normalized.map((asset) => sceneFromAsset(asset, groupId));
    commit((current) => ({ ...current, assets: [...current.assets, ...normalized.filter((asset) => !current.assets.some((item) => item.id === asset.id))], scenes: [...projectScenes(current), ...created] }), `从图片创建 ${created.length} 个场景`);
    setSelectedId(created[0].id); setSelectedIds(new Set(created.map((scene) => scene.id))); setSelectedLayerId(created[0].layers[0].id); notify(`已创建 ${created.length} 个场景`);
  };
  const addAssetsAsLayers = (assets: Asset[]) => {
    if (!selected || !assets.length) return;
    const normalized = assets.map((asset) => ({ ...asset, kind: 'scene' })); const layers = normalized.map((asset, index) => newLayer(asset, selected.layers.length + index));
    commit((current) => {
      const nextScene = { ...projectScenes(current).find((scene) => scene.id === selected.id)!, layers: [...selected.layers, ...layers] };
      return synchronizeSceneBlocks({ ...current, assets: [...current.assets, ...normalized.filter((asset) => !current.assets.some((item) => item.id === asset.id))], scenes: projectScenes(current).map((scene) => scene.id === selected.id ? nextScene : scene) }, nextScene);
    }, `添加 ${layers.length} 个场景图层`);
    setSelectedLayerId(layers[0].id); notify(`已添加 ${layers.length} 个图层`);
  };
  const handleFiles = async (files: FileList | File[], mode: 'scenes' | 'layers') => {
    try { const assets = await Promise.all(Array.from(files).filter((file) => supportedImage(file.name)).map(fileToAsset)); if (!assets.length) return notify('请选择 PNG、JPG、JPEG 或 WebP 图片', 'error'); mode === 'scenes' || !selected ? addAssetsAsScenes(assets) : addAssetsAsLayers(assets); } catch (error) { notify(String(error), 'error'); }
  };
  const chooseImages = async (mode: 'scenes' | 'layers') => {
    fileModeRef.current = mode;
    if (!window.__HIKARI_DESKTOP__) return fileInputRef.current?.click();
    try { const assets = await importAssets(); mode === 'scenes' || !selected ? addAssetsAsScenes(assets) : addAssetsAsLayers(assets); } catch (error) { notify(String(error), 'error'); }
  };
  const createEmpty = async () => {
    const name = await requestText({ title: '新建场景', message: '创建后可从素材库添加背景或拖入图片。', placeholder: '例如：教室·白天', confirmText: '创建场景' }); if (!name) return;
    const scene: SceneDefinition = { id: makeId('scene'), name, layers: [newLayer(undefined)] };
    commit((current) => ({ ...current, scenes: [...projectScenes(current), scene] }), `新建场景 ${name}`); setSelectedId(scene.id); setSelectedIds(new Set([scene.id])); setSelectedLayerId(scene.layers[0].id);
  };
  const duplicate = () => {
    const targets = scenes.filter((scene) => selectedIds.has(scene.id)); if (!targets.length) return;
    const copies = targets.map((scene) => ({ ...structuredClone(scene), id: makeId('scene'), name: `${scene.name}_副本`, layers: scene.layers.map((layer) => ({ ...layer, id: makeId('scene-layer') })) }));
    commit((current) => ({ ...current, scenes: [...projectScenes(current), ...copies] }), `复制 ${copies.length} 个场景`); setSelectedId(copies[0].id); setSelectedIds(new Set(copies.map((scene) => scene.id))); setSelectedLayerId(copies[0].layers[0]?.id ?? '');
  };
  const removeScenes = async () => {
    const targets = scenes.filter((scene) => selectedIds.has(scene.id)); const used = targets.reduce((sum, scene) => sum + Object.values(project.scripts).flat().filter((block) => block.type === 'scene' && block.sceneId === scene.id).length, 0);
    if (used) return notify(`所选场景仍被 ${used} 个 Scene Block 引用，无法删除`, 'error');
    if (!targets.length || !await requestConfirm({ title: `删除 ${targets.length} 个场景`, message: '场景引用的图片素材不会被删除。', confirmText: '删除', danger: true })) return;
    const remaining = scenes.filter((scene) => !selectedIds.has(scene.id)); commit((current) => ({ ...current, scenes: remaining }), `删除 ${targets.length} 个场景`); setSelectedId(remaining[0]?.id ?? ''); setSelectedIds(new Set(remaining[0] ? [remaining[0].id] : []));
  };
  const renameScene = async () => { if (!selected) return; const name = await requestText({ title: '重命名场景', initialValue: selected.name, confirmText: '重命名' }); if (name && name !== selected.name) patchScene({ name }, `重命名场景为 ${name}`); };
  const createGroup = async () => { const name = await requestText({ title: '新建场景分组', placeholder: '分组名称', confirmText: '创建分组' }); if (!name) return; const group: SceneGroup = { id: makeId('scene-group'), name, color: '#4f8f86' }; commit((current) => ({ ...current, sceneGroups: [...(current.sceneGroups ?? []), group] }), `新建场景分组 ${name}`); };
  const patchGroup = (id: string, patch: Partial<SceneGroup>) => commit((current) => ({ ...current, sceneGroups: (current.sceneGroups ?? []).map((group) => group.id === id ? { ...group, ...patch } : group) }), '更新场景分组');
  const removeGroup = async (group: SceneGroup) => { if (!await requestConfirm({ title: '删除场景分组', message: `删除“${group.name}”？组内场景会移回顶层。`, confirmText: '删除', danger: true })) return; commit((current) => ({ ...current, sceneGroups: (current.sceneGroups ?? []).filter((item) => item.id !== group.id), scenes: projectScenes(current).map((scene) => scene.groupId === group.id ? { ...scene, groupId: undefined } : scene) }), `删除场景分组 ${group.name}`); };
  const moveSelectedToGroup = (groupId?: string) => commit((current) => ({ ...current, scenes: projectScenes(current).map((scene) => selectedIds.has(scene.id) ? { ...scene, groupId } : scene) }), groupId ? '移动场景到分组' : '移出场景分组');
  const reorderLayer = (targetId: string) => { if (!selected || !draggedLayerId || targetId === draggedLayerId) return; const layers = [...selected.layers]; const from = layers.findIndex((layer) => layer.id === draggedLayerId); const to = layers.findIndex((layer) => layer.id === targetId); const [moving] = layers.splice(from, 1); layers.splice(to, 0, moving); patchScene({ layers }, '调整场景图层顺序'); setDraggedLayerId(null); };
  const layerIssue = (layer: SceneDefinitionLayer) => {
    if (!layer.assetId) return '未选择图片';
    const asset = project.assets.find((item) => item.id === layer.assetId);
    if (!asset) return '素材引用丢失';
    if (!supportedImage(asset.path || asset.name)) return '格式不兼容';
    if (assetStatuses[asset.id]?.exists === false) return '源文件缺失';
    if (!asset.uri) return '无法访问素材';
    if (failedAssetIds.has(asset.id)) return '图片损坏或无法解码';
    return undefined;
  };
  const relinkLayer = async (layer: SceneDefinitionLayer) => {
    if (!layer.assetId) return;
    setRelinkingAssetId(layer.assetId);
    try {
      const replacement = await replaceAssetFile(layer.assetId);
      if (!replacement) return;
      if (!supportedImage(replacement.path || replacement.name)) return notify('请选择 PNG、JPG、JPEG 或 WebP 图片', 'error');
      commit((current) => {
        const existing = current.assets.find((asset) => asset.id === layer.assetId);
        const next = { ...existing, ...replacement, id: layer.assetId, kind: 'scene', forceBundle: existing?.forceBundle } as Asset;
        return { ...current, assets: existing ? current.assets.map((asset) => asset.id === layer.assetId ? next : asset) : [...current.assets, next] };
      }, `重新定位场景图层 ${layer.name}`);
      notify('场景图层已恢复，剧本预览已刷新', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); } finally { setRelinkingAssetId(undefined); }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const editing = (event.target as HTMLElement | null)?.matches('input,textarea,select,[contenteditable="true"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); searchRef.current?.focus(); return; }
      if (editing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate(); }
      else if (event.key === 'F2') { event.preventDefault(); void renameScene(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); void removeScenes(); }
      else if (event.key === 'Escape') { setQuery(''); setSelectedIds(new Set(selected ? [selected.id] : [])); }
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); const index = scenes.findIndex((scene) => scene.id === selectedId); const next = scenes[Math.max(0, Math.min(scenes.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))]; if (next) selectScene(next); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [scenes, selectedId, selectedIds, selected]);

  const renderSceneButton = (scene: SceneDefinition) => {
    const thumbnail = project.assets.find((asset) => asset.id === scene.layers.at(-1)?.assetId);
    const count = Object.values(project.scripts).flat().filter((block) => block.type === 'scene' && (block.sceneId === scene.id || (!block.sceneId && block.assetId === scene.layers.at(-1)?.assetId))).length;
    return <button draggable key={scene.id} className={`scene-list-item ${selectedIds.has(scene.id) ? 'active' : ''}`} onClick={(event) => selectScene(scene, event)} onDoubleClick={() => void renameScene()} onDragStart={(event) => { if (!selectedIds.has(scene.id)) { setSelectedIds(new Set([scene.id])); setSelectedId(scene.id); } event.dataTransfer.setData('text/hikari-scene', scene.id); }}><span>{thumbnail?.uri ? <img src={thumbnail.uri} alt={scene.name} /> : <Image />}</span><span><strong>{scene.name}</strong><small>{scene.layers.length}L · {count ? `${count} 处引用` : '游离'}</small></span><em>{scene.layers.length}L</em><MoreHorizontal /></button>;
  };
  const parallaxStyle = (layer: SceneDefinitionLayer, index: number) => {
    const relativeZoom = 1 + (camera.zoom - 1) * layer.distance;
    return { opacity: layer.visible === false || isolation === 'only' && layer.id !== selectedLayer?.id ? 0 : (isolation === 'dim' && layer.id !== selectedLayer?.id ? .25 : layer.opacity), transform: `translate(calc(-50% + ${layer.offsetX - camera.x * layer.distance}%), calc(-50% + ${layer.offsetY - camera.y * layer.distance}%)) scale(${layer.scale * relativeZoom})`, zIndex: selected.layers.length - index, mixBlendMode: layer.blendMode } as React.CSSProperties;
  };

  return <div className="scene-manager">
    <header className="scene-manager-header"><div><h1>场景管理</h1><p>创建背景，编排真实图层、距离、偏移与镜头视差</p></div><button className="button ghost" onClick={() => void chooseImages('scenes')}><Upload />导入为场景</button><button className="button primary" onClick={() => void createEmpty()}><Plus />新建场景</button></header>
    <div className="scene-manager-workspace">
      <aside className={`scene-browser ${dropTarget === 'list' ? 'drop-active' : ''}`} onContextMenu={(event) => { if ((event.target as HTMLElement).closest('.scene-list-item')) return; event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }); }} onDragOver={(event) => { event.preventDefault(); setDropTarget('list'); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null); }} onDrop={(event) => { event.preventDefault(); setDropTarget(null); if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files, 'scenes'); }}>
        <div className="scene-browser-toolbar"><div className="asset-search"><Search /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索场景" /></div><button className="icon-button" title="排序" onClick={() => setSort((value) => value === 'manual' ? 'name' : value === 'name' ? 'layers' : 'manual')}><ArrowDownAZ /></button><button className="icon-button" title="新建场景" onClick={() => void createEmpty()}><Plus /></button></div>
        <div className="scene-browser-list"><div className="scene-root-list">{scenesInGroup().map(renderSceneButton)}</div>{groups.map((group) => <section className="scene-group" key={group.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.getData('text/hikari-scene')) moveSelectedToGroup(group.id); }}><header><button onClick={() => patchGroup(group.id, { collapsed: !group.collapsed })}>{group.collapsed ? <ChevronRight /> : <ChevronDown />}</button><i style={{ background: group.color }} /><strong>{group.name}</strong><small>{scenesInGroup(group.id).length}</small><input aria-label={`${group.name} 分组颜色`} type="color" value={group.color} onChange={(event) => patchGroup(group.id, { color: event.target.value })} /><button title="删除分组" onClick={() => void removeGroup(group)}><X /></button></header>{!group.collapsed && <div>{scenesInGroup(group.id).map(renderSceneButton)}</div>}</section>)}</div>
        <footer><span>{scenes.length} 个场景</span><button className="icon-button" title="新建分组" onClick={() => void createGroup()}><FolderPlus /></button>{selectedIds.size > 1 && <button className="icon-button" title={`删除 ${selectedIds.size} 个场景`} onClick={() => void removeScenes()}><Trash2 /></button>}</footer>
      </aside>
      {selected ? <main className={`scene-stage-panel ${dropTarget === 'stage' ? 'drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDropTarget('stage'); }} onDragLeave={() => setDropTarget(null)} onDrop={(event) => { event.preventDefault(); setDropTarget(null); if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files, 'layers'); }}>
        <div className="scene-stage-toolbar"><div><strong>{selected.name}</strong><small>{selected.layers.length > 1 ? '多层场景' : '单层场景'} · {references.length ? `${references.length} 处引用` : '游离'}</small></div><button className="icon-button" title="缩小镜头" onClick={() => setCamera((value) => ({ ...value, zoom: Math.max(.5, value.zoom - .1) }))}><ZoomOut /></button><span>{Math.round(camera.zoom * 100)}%</span><button className="icon-button" title="放大镜头" onClick={() => setCamera((value) => ({ ...value, zoom: Math.min(2, value.zoom + .1) }))}><ZoomIn /></button><button className="icon-button" title="恢复默认镜头" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}><LocateFixed /></button><button className={`icon-button isolation-${isolation}`} title="切换图层隔离" onClick={() => setIsolation((value) => value === 'all' ? 'dim' : value === 'dim' ? 'only' : 'all')}><Layers3 /></button></div>
        <div className="scene-stage"><div className="scene-stage-camera">{selected.layers.map((layer, index) => { const asset = project.assets.find((item) => item.id === layer.assetId); const issue = layerIssue(layer); return asset?.uri && !issue ? <img key={layer.id} className={layer.id === selectedLayer?.id ? 'selected' : ''} src={asset.uri} alt={layer.name} style={parallaxStyle(layer, index)} onError={() => setFailedAssetIds((current) => new Set(current).add(asset.id))} onClick={() => setSelectedLayerId(layer.id)} /> : null; })}{!selected.layers.some((layer) => !layerIssue(layer)) && <div className="scene-stage-empty error"><AlertTriangle /><strong>场景图层无法加载</strong><span>在右侧选择问题图层后重新定位素材</span></div>}</div><div className="scene-safe-area" /><span className="scene-camera-readout">镜头 {camera.x.toFixed(0)}, {camera.y.toFixed(0)} · {camera.zoom.toFixed(2)}x</span></div>
        <div className="scene-camera-controls"><label>镜头 X<input type="range" min="-30" max="30" value={camera.x} onChange={(event) => setCamera({ ...camera, x: Number(event.target.value) })} /></label><label>镜头 Y<input type="range" min="-30" max="30" value={camera.y} onChange={(event) => setCamera({ ...camera, y: Number(event.target.value) })} /></label><p>预览镜头仅用于检查视差，不写入剧本 Camera Block。</p></div>
        <section className="scene-reference-strip"><strong>剧本引用</strong>{references.map((reference) => <button key={`${reference.fragmentId}-${reference.blockIndex}`} onClick={() => activate(reference.fragmentId, reference.blockIndex)}>{reference.fragmentId} · Block {reference.blockIndex + 1}<span>前往</span></button>)}{!references.length && <span>当前场景未被剧本引用</span>}</section>
      </main> : <main className="scene-stage-panel empty"><Image /><strong>还没有场景</strong><button className="button primary" onClick={() => void createEmpty()}>创建第一个场景</button></main>}
      {selected && <aside className={`scene-layers-panel ${dropTarget === 'layers' ? 'drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDropTarget('layers'); }} onDragLeave={() => setDropTarget(null)} onDrop={(event) => { event.preventDefault(); setDropTarget(null); if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files, 'layers'); }}><header><div><Layers3 /><strong>图层</strong><span>{selected.layers.length}</span></div><button className="icon-button" title="从磁盘添加图层" onClick={() => void chooseImages('layers')}><Upload /></button><button className="icon-button" title="添加空图层" onClick={() => { const layer = newLayer(undefined, selected.layers.length); patchScene({ layers: [layer, ...selected.layers] }, '添加空场景图层'); setSelectedLayerId(layer.id); }}><Plus /></button></header>
        <div className="scene-layer-stack">{selected.layers.map((layer) => { const asset = project.assets.find((item) => item.id === layer.assetId); const issue = layerIssue(layer); return <article draggable className={`${layer.id === selectedLayer?.id ? 'active' : ''} ${issue ? 'asset-error' : ''}`} key={layer.id} onClick={() => setSelectedLayerId(layer.id)} onDragStart={() => setDraggedLayerId(layer.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderLayer(layer.id); }}><GripVertical /><span>{asset?.uri && !issue ? <img src={asset.uri} alt={layer.name} onError={() => setFailedAssetIds((current) => new Set(current).add(asset.id))} /> : issue && layer.assetId ? <AlertTriangle /> : <FileImage />}</span><div><input aria-label="图层名称" value={layer.name} onChange={(event) => patchLayer(layer.id, { name: event.target.value }, '重命名场景图层')} /><small className={issue ? 'error' : ''}>{issue ?? `距离 ${layer.distance.toFixed(2)} · 偏移 ${layer.offsetX}, ${layer.offsetY}`}</small></div><button className="icon-button" title={layer.visible === false ? '显示图层' : '隐藏图层'} onClick={(event) => { event.stopPropagation(); patchLayer(layer.id, { visible: layer.visible === false }); }}>{layer.visible === false ? <EyeOff /> : <Eye />}</button><button className="icon-button" title="删除图层" disabled={selected.layers.length <= 1} onClick={(event) => { event.stopPropagation(); if (selected.layers.length > 1) patchScene({ layers: selected.layers.filter((item) => item.id !== layer.id) }, '删除场景图层'); }}><Trash2 /></button></article>; })}</div>
        {selectedLayer && <div className="scene-layer-inspector"><div className="scene-layer-tabs"><button className={layerTab === 'distance' ? 'active' : ''} onClick={() => setLayerTab('distance')}>距离</button><button className={layerTab === 'offset' ? 'active' : ''} onClick={() => setLayerTab('offset')}>偏移</button></div><label>图层图片<select value={selectedLayer.assetId ?? ''} onChange={(event) => patchLayer(selectedLayer.id, { assetId: event.target.value || undefined }, '替换场景图层图片')}><option value="">未选择</option>{imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>{layerTab === 'distance' ? <div className="scene-distance-editor"><input aria-label="共享图层距离" className="vertical-distance" type="range" min=".1" max="2" step=".01" value={selectedLayer.distance} onChange={(event) => patchLayer(selectedLayer.id, { distance: Number(event.target.value) }, '调整图层距离')} onKeyDown={(event) => { if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const step = event.shiftKey ? .01 : .1; patchLayer(selectedLayer.id, { distance: Math.max(.1, Math.min(2, selectedLayer.distance + (event.key === 'ArrowUp' ? -step : step))) }, '调整图层距离'); }} /><div><span>远</span><label>距离值<input type="number" min=".1" max="2" step=".01" value={selectedLayer.distance} onChange={(event) => patchLayer(selectedLayer.id, { distance: Number(event.target.value) }, '调整图层距离')} /></label><p>1.0 表示无视差；近层对镜头运动更敏感。</p><span>近</span></div></div> : <div className="scene-offset-editor"><div className="offset-picker" onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); patchLayer(selectedLayer.id, { offsetX: Math.round((event.clientX - rect.left) / rect.width * 100 - 50), offsetY: Math.round((event.clientY - rect.top) / rect.height * 100 - 50) }, '调整图层偏移'); }}><i style={{ left: `${selectedLayer.offsetX + 50}%`, top: `${selectedLayer.offsetY + 50}%` }} /></div><div className="property-two-column"><label>X 偏移<input type="number" value={selectedLayer.offsetX} onChange={(event) => patchLayer(selectedLayer.id, { offsetX: Number(event.target.value) }, '调整图层偏移')} /></label><label>Y 偏移<input type="number" value={selectedLayer.offsetY} onChange={(event) => patchLayer(selectedLayer.id, { offsetY: Number(event.target.value) }, '调整图层偏移')} /></label></div></div>}<div className="property-two-column"><label>透明度<input type="number" min="0" max="1" step=".05" value={selectedLayer.opacity} onChange={(event) => patchLayer(selectedLayer.id, { opacity: Number(event.target.value) })} /></label><label>缩放<input type="number" min=".1" max="5" step=".05" value={selectedLayer.scale} onChange={(event) => patchLayer(selectedLayer.id, { scale: Number(event.target.value) })} /></label></div></div>}
        {selectedLayer && <div className={`scene-layer-health ${layerIssue(selectedLayer) ? 'error' : 'ready'}`}>{layerIssue(selectedLayer) ? <AlertTriangle /> : <CheckCircle2 />}<span><strong>{layerIssue(selectedLayer) ?? '图层素材已就绪'}</strong><small>{project.assets.find((asset) => asset.id === selectedLayer.assetId)?.path ?? selectedLayer.assetId ?? '请选择图片'}</small></span>{selectedLayer.assetId && <button className="icon-button" title="重新定位场景图层" disabled={relinkingAssetId === selectedLayer.assetId} onClick={() => void relinkLayer(selectedLayer)}>{relinkingAssetId === selectedLayer.assetId ? <LoaderCircle className="spinning" /> : <LocateFixed />}</button>}</div>}
      </aside>}
    </div>
    <input ref={fileInputRef} hidden type="file" accept=".png,.jpg,.jpeg,.webp" multiple onChange={(event) => { if (event.target.files?.length) void handleFiles(event.target.files, fileModeRef.current); event.target.value = ''; }} />
    {contextMenu && <div className="context-menu scene-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button onClick={() => void createGroup()}><FolderPlus />新建分组</button><button onClick={() => void createEmpty()}><Plus />新建场景</button>{selected?.groupId && <button onClick={() => moveSelectedToGroup(undefined)}>移出分组</button>}<button onClick={duplicate}><Copy />复制所选场景</button><button className="danger" onClick={() => void removeScenes()}><Trash2 />删除所选场景</button></div>}
  </div>;
}
