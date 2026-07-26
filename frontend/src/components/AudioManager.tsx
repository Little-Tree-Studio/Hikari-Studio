import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import {
  AudioLines, CheckCircle2, CircleAlert, Clock3, FileAudio, FolderOpen, Gauge,
  LoaderCircle, MessageSquareText, Music2, Pause, Play, RefreshCw, Search,
  Sparkles, Trash2, Upload, UserRound, Users, X,
} from 'lucide-react';
import { getAsrStatus, importAssets, loadAsrModel, transcribeAudio } from '../api';
import { analyzeAssetReferences } from '../core/assetReferences';
import { audioCategoryOf } from '../core/audio';
import type { AsrServiceStatus, Asset, AudioCategory, Project } from '../types';

type Commit = (updater: (project: Project) => Project, label?: string) => void;
type Notify = (message: string, tone?: 'error' | 'success') => void;

interface AudioManagerProps {
  project: Project;
  category: AudioCategory;
  setCategory: (category: AudioCategory) => void;
  commit: Commit;
  notify: Notify;
  requestConfirm: (options: { title: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
  activate: (fragmentId: string, blockIndex?: number) => void;
}

const categoryMeta: Record<AudioCategory, { label: string; icon: typeof Music2; detail: string }> = {
  bgm: { label: 'BGM', icon: Music2, detail: '背景音乐与循环曲目' },
  sfx: { label: '音效', icon: AudioLines, detail: '环境声与一次性音效' },
  voice: { label: '语音', icon: MessageSquareText, detail: '角色配音与识别文本' },
};

const formatBytes = (bytes = 0) => bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const formatDuration = (seconds?: number) => seconds === undefined ? '--:--' : `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const clone = <T,>(value: T): T => structuredClone(value);

export function AudioManager({ project, category, setCategory, commit, notify, requestConfirm, activate }: AudioManagerProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectedRef = useRef(selected);
  const [voiceCharacterId, setVoiceCharacterId] = useState(project.characters[0]?.id ?? 'unassigned');
  const [playingId, setPlayingId] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [concurrency, setConcurrency] = useState(1);
  const [asr, setAsr] = useState<AsrServiceStatus>({ available: false, loaded: false, loading: false, model: 'small', message: '正在检查模型' });
  const audioRef = useRef<HTMLAudioElement>(null);
  const references = useMemo(() => analyzeAssetReferences(project), [project]);
  const audioAssets = project.assets.filter((asset) => asset.kind === 'audio');
  const filtered = audioAssets.filter((asset) => audioCategoryOf(asset) === category
    && (category !== 'voice' || (voiceCharacterId === 'unassigned' ? !asset.voiceCharacterId : asset.voiceCharacterId === voiceCharacterId))
    && `${asset.name} ${asset.path} ${asset.asrText ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  useEffect(() => { void getAsrStatus().then(setAsr); }, []);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { setSelected(new Set()); selectedRef.current = new Set(); setPlayingId(undefined); setProgress(0); }, [category, voiceCharacterId]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!playingId) { audio.pause(); audio.removeAttribute('src'); return; }
    const asset = project.assets.find((item) => item.id === playingId);
    if (!asset?.uri) return;
    audio.src = asset.uri;
    void audio.play().catch(() => notify('无法播放该音频，请检查文件格式或路径', 'error'));
  }, [playingId]);

  const updateAsset = (assetId: string, patch: Partial<Asset>, label: string) => commit((current) => ({
    ...current,
    assets: current.assets.map((asset) => asset.id === assetId ? { ...asset, ...patch } : asset),
  }), label);

  const doImport = async (paths?: string[]) => {
    try {
      setBusy(true);
      const imported = await importAssets(paths, category);
      if (!imported.length) return;
      const voiceOwner = category === 'voice' && voiceCharacterId !== 'unassigned' ? voiceCharacterId : undefined;
      const assets = imported.map((asset) => ({ ...asset, audioCategory: category, voiceCharacterId: voiceOwner }));
      commit((current) => ({ ...current, assets: [...current.assets, ...assets] }), `导入 ${assets.length} 个${categoryMeta[category].label}文件`);
      notify(`已导入 ${assets.length} 个音频文件`);
    } catch (error) { notify(String(error), 'error'); } finally { setBusy(false); }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault(); setDropActive(false);
    const paths = Array.from(event.dataTransfer.files).map((file) => (file as File & { path?: string }).path).filter((path): path is string => Boolean(path));
    if (!paths.length) { notify('请在桌面版中拖入本地音频文件', 'error'); return; }
    void doImport(paths);
  };

  const toggleSelection = (event: MouseEvent, assetId: string) => setSelected((current) => {
    const next = new Set(event.ctrlKey || event.metaKey ? current : []);
    if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
    return next;
  });

  const removeAssets = async (ids: Set<string>) => {
    if (!ids.size) return;
    const used = audioAssets.filter((asset) => ids.has(asset.id) && references.references[asset.id]?.length);
    const message = used.length
      ? `其中 ${used.length} 个文件正在被剧本引用。删除资源记录会产生缺失引用，是否继续？`
      : `从项目中移除选中的 ${ids.size} 个音频文件？`;
    if (!await requestConfirm({ title: '删除音频', message, confirmText: '删除', danger: true })) return;
    commit((current) => ({ ...current, assets: current.assets.filter((asset) => !ids.has(asset.id)) }), `删除 ${ids.size} 个音频文件`);
    setSelected(new Set()); setPlayingId(undefined); notify('音频已从项目中移除');
  };
  const removeSelected = () => removeAssets(selectedRef.current);

  const loadModel = async () => {
    try {
      setBusy(true); setAsr((current) => ({ ...current, loading: true, message: '正在加载模型' }));
      const result = await loadAsrModel();
      if (!result.ok) throw new Error(result.error?.message ?? '模型加载失败');
      if (result.data) setAsr(result.data);
      notify('语音识别模型已就绪');
    } catch (error) { setAsr(await getAsrStatus()); notify(String(error), 'error'); } finally { setBusy(false); }
  };

  const recognize = async (force: boolean) => {
    const targets = audioAssets.filter((asset) => audioCategoryOf(asset) === 'voice'
      && (voiceCharacterId === 'unassigned' ? !asset.voiceCharacterId : asset.voiceCharacterId === voiceCharacterId)
      && (force || asset.asrStatus !== 'success'));
    if (!targets.length) { notify(force ? '当前分组没有语音文件' : '当前分组没有待识别文件', 'error'); return; }
    try {
      setBusy(true);
      const ids = new Set(targets.map((asset) => asset.id));
      commit((current) => ({ ...current, assets: current.assets.map((asset) => ids.has(asset.id) ? { ...asset, asrStatus: 'processing', asrError: undefined } : asset) }), '开始语音识别');
      const result = await transcribeAudio(targets, concurrency, force);
      if (!result.ok) throw new Error(result.error?.message ?? '识别失败');
      const byId = new Map(result.data?.map((item) => [item.assetId, item]));
      commit((current) => ({ ...current, assets: current.assets.map((asset) => {
        const item = byId.get(asset.id); if (!item) return asset;
        return { ...asset, asrStatus: item.status, asrText: item.text ?? asset.asrText, duration: item.duration ?? asset.duration, asrError: item.error };
      }) }), `识别 ${targets.length} 个语音文件`);
      notify(`语音识别完成，共处理 ${targets.length} 个文件`);
    } catch (error) {
      commit((current) => ({ ...current, assets: current.assets.map((asset) => targets.some((item) => item.id === asset.id) && asset.asrStatus === 'processing' ? { ...asset, asrStatus: 'failed', asrError: String(error) } : asset) }), '记录语音识别失败');
      notify(String(error), 'error');
    } finally { setBusy(false); }
  };

  const selectedAsset = filtered.find((asset) => selected.has(asset.id)) ?? filtered[0];
  const currentMeta = categoryMeta[category];
  return <div className={`audio-manager ${dropActive ? 'drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDropActive(true); }} onDragLeave={() => setDropActive(false)} onDrop={handleDrop}>
    <audio ref={audioRef} onTimeUpdate={(event) => setProgress(event.currentTarget.duration ? event.currentTarget.currentTime / event.currentTarget.duration : 0)} onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (playingId && Number.isFinite(duration)) updateAsset(playingId, { duration }, '更新音频时长'); }} onEnded={() => setPlayingId(undefined)} />
    <header className="audio-manager-header"><div><h1>音频管理</h1><p>导入、试听和追踪 BGM、音效与角色语音</p></div><button className="button primary" disabled={busy} onClick={() => void doImport()}><Upload />导入音频</button></header>
    <div className="audio-category-tabs">{(Object.entries(categoryMeta) as [AudioCategory, typeof categoryMeta.bgm][]).map(([id, meta]) => { const Icon = meta.icon; const count = audioAssets.filter((asset) => audioCategoryOf(asset) === id).length; return <button key={id} className={category === id ? 'active' : ''} onClick={() => setCategory(id)}><Icon /><span><strong>{meta.label}</strong><small>{meta.detail}</small></span><em>{count}</em></button>; })}</div>
    <div className={`audio-workspace ${category === 'voice' ? 'voice-mode' : ''}`}>
      {category === 'voice' && <aside className="voice-role-panel"><header><Users /><strong>角色分组</strong></header><button className={voiceCharacterId === 'unassigned' ? 'active' : ''} onClick={() => setVoiceCharacterId('unassigned')}><span className="voice-avatar"><FolderOpen /></span><span><strong>未分配</strong><small>{audioAssets.filter((asset) => audioCategoryOf(asset) === 'voice' && !asset.voiceCharacterId).length} 条语音</small></span></button>{project.characters.map((character) => <button key={character.id} className={voiceCharacterId === character.id ? 'active' : ''} onClick={() => setVoiceCharacterId(character.id)}><span className="voice-avatar" style={{ background: character.color }}>{character.portraits?.[character.expressions[0]] ? <img src={project.assets.find((asset) => asset.id === character.portraits?.[character.expressions[0]])?.uri} /> : character.name.slice(0, 1)}</span><span><strong>{character.name}</strong><small>{audioAssets.filter((asset) => asset.voiceCharacterId === character.id).length} 条语音</small></span></button>)}</aside>}
      <section className="audio-list-panel">
        <div className="audio-list-toolbar"><div className="asset-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${currentMeta.label}...`} />{query && <button onClick={() => setQuery('')}><X /></button>}</div><span>{filtered.length} 个文件</span>{selected.size > 0 && <><em>已选 {selected.size}</em><button className="icon-button" title="删除选中音频" onClick={() => void removeSelected()}><Trash2 /></button></>}</div>
        {category === 'voice' && <div className="asr-toolbar"><span className={`asr-state ${asr.loaded ? 'ready' : asr.available ? '' : 'missing'}`}>{asr.loaded ? <CheckCircle2 /> : asr.loading ? <LoaderCircle className="spinning" /> : <CircleAlert />}<strong>{asr.message}</strong></span><label><Gauge />并发<select value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option value={value} key={value}>{value}×</option>)}</select></label>{!asr.loaded && <button className="button ghost" disabled={busy || !asr.available} onClick={() => void loadModel()}><Sparkles />加载模型</button>}<button className="button ghost" disabled={busy || !asr.loaded} onClick={() => void recognize(false)}><RefreshCw />识别待处理</button><button className="button ghost" disabled={busy || !asr.loaded} onClick={() => void recognize(true)}>强制重识别</button></div>}
        <div className="audio-table"><header><span>文件</span><span>时长</span><span>大小</span>{category === 'voice' && <span>识别文本</span>}<span>引用</span><span /></header><div className="audio-table-body">{filtered.map((asset) => { const refs = references.references[asset.id] ?? []; const active = selected.has(asset.id); return <article key={asset.id} className={active ? 'selected' : ''} onClick={(event) => toggleSelection(event, asset.id)}><span className="audio-file-cell"><button className="audio-play" title={playingId === asset.id ? '暂停' : '播放'} onClick={(event) => { event.stopPropagation(); setPlayingId((current) => current === asset.id ? undefined : asset.id); }}>{playingId === asset.id ? <Pause /> : <Play />}</button><span><strong>{asset.name}</strong><small>{asset.path}</small>{playingId === asset.id && <i><b style={{ width: `${progress * 100}%` }} /></i>}</span></span><span><Clock3 />{formatDuration(asset.duration)}</span><span>{formatBytes(asset.size)}</span>{category === 'voice' && <span className="asr-text"><textarea aria-label={`${asset.name} 识别文本`} value={asset.asrText ?? ''} placeholder={asset.asrStatus === 'processing' ? '正在识别...' : '尚未识别'} onClick={(event) => event.stopPropagation()} onChange={(event) => updateAsset(asset.id, { asrText: event.target.value, asrStatus: event.target.value ? 'success' : 'pending' }, '编辑识别文本')} />{asset.asrStatus === 'failed' && <small title={asset.asrError}>识别失败</small>}</span>}<span className="audio-reference-cell">{refs.length ? <button onClick={(event) => { event.stopPropagation(); const ref = refs[0]; if (ref.fragmentId) activate(ref.fragmentId, ref.blockIndex); }}><strong>{refs.length}</strong><small>{refs[0].sourceName}</small></button> : <em>未使用</em>}</span><button className="icon-button" title="移除音频" onClick={(event) => { event.stopPropagation(); setSelected(new Set([asset.id])); setTimeout(() => void removeSelected(), 0); }}><Trash2 /></button></article>; })}{!filtered.length && <div className="audio-empty"><FileAudio /><strong>这里还没有{currentMeta.label}</strong><span>点击“导入音频”，或将 MP3、OGG、WAV 文件拖到此处</span></div>}</div></div>
      </section>
      <aside className="audio-detail-panel"><header><FileAudio /><strong>音频属性</strong></header>{selectedAsset ? <div><label>显示名称<input value={selectedAsset.name} onChange={(event) => updateAsset(selectedAsset.id, { name: event.target.value }, '重命名音频')} /></label><label>分类<select value={audioCategoryOf(selectedAsset)} onChange={(event) => updateAsset(selectedAsset.id, { audioCategory: event.target.value as AudioCategory }, '修改音频分类')}><option value="bgm">BGM</option><option value="sfx">音效</option><option value="voice">语音</option></select></label>{audioCategoryOf(selectedAsset) === 'voice' && <label>所属角色<select value={selectedAsset.voiceCharacterId ?? ''} onChange={(event) => updateAsset(selectedAsset.id, { voiceCharacterId: event.target.value || undefined }, '修改语音角色')}><option value="">未分配</option>{project.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>}<dl><div><dt>文件</dt><dd>{selectedAsset.path}</dd></div><div><dt>时长</dt><dd>{formatDuration(selectedAsset.duration)}</dd></div><div><dt>大小</dt><dd>{formatBytes(selectedAsset.size)}</dd></div><div><dt>引用</dt><dd>{references.references[selectedAsset.id]?.length ?? 0} 处</dd></div></dl><label className="audio-force-bundle"><input type="checkbox" checked={selectedAsset.forceBundle ?? false} onChange={(event) => updateAsset(selectedAsset.id, { forceBundle: event.target.checked }, '修改强制打包设置')} />强制打包</label><section><strong>引用位置</strong>{(references.references[selectedAsset.id] ?? []).map((ref, index) => <button key={`${ref.sourceId}-${index}`} onClick={() => ref.fragmentId && activate(ref.fragmentId, ref.blockIndex)}><span>{ref.sourceName}</span><small>{ref.detail}</small></button>)}{!references.references[selectedAsset.id]?.length && <p>当前没有剧本或角色引用此文件。</p>}</section></div> : <div className="audio-detail-empty"><UserRound /><span>选择一个音频查看属性</span></div>}</aside>
    </div>
  </div>;
}
