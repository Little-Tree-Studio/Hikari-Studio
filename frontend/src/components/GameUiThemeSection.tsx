import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArchiveRestore, Check, CheckCircle2, EyeOff, History, LoaderCircle, LocateFixed, Menu, MessageSquareText, Play, RotateCcw, Save, Settings2, X, Zap, type LucideIcon } from 'lucide-react';
import { inspectAssets } from '../api';
import { GAME_UI_PRESETS, gameUiThemeCssVariables, normalizeGameUiTheme } from '../core/gameUiTheme';
import { Select } from './ui/Select';
import { Slider } from './ui/Slider';
import type { AssetFileStatus, GameUiTheme, GameUiThemePreset, Project } from '../types';

interface GameUiThemeSectionProps {
  project: Project;
  apply: (ui: NonNullable<Project['ui']>, gameVersion: string) => void;
  relinkAsset: (assetId: string) => Promise<void>;
}

type PreviewMode = 'dialogue' | 'system' | 'save';
const FALLBACK_UI: NonNullable<Project['ui']> = { theme: 'slide-light', dialogueStyle: 'glass' };
const DIALOGUE_CONTROLS: [LucideIcon, string][] = [[Zap, '跳过'], [Play, '自动'], [Save, '存档'], [ArchiveRestore, '读档'], [History, '历史'], [Settings2, '设置'], [EyeOff, '隐藏']];

function RangeField({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void }) {
  return <label className="theme-range-field"><span>{label}<strong>{Number.isInteger(step) ? value : value.toFixed(2)}{unit}</strong></span><Slider ariaLabel={label} min={min} max={max} step={step} value={value} onChange={onChange} /></label>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="theme-color-field"><span>{label}</span><span><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><code>{value.toUpperCase()}</code></span></label>;
}

export function GameUiThemeSection({ project, apply, relinkAsset }: GameUiThemeSectionProps) {
  const [theme, setTheme] = useState<GameUiTheme>(() => normalizeGameUiTheme(project.ui?.runtimeTheme));
  const [title, setTitle] = useState(project.ui?.title ?? {});
  const [gameVersion, setGameVersion] = useState(project.meta.gameVersion ?? '1.0.0');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('dialogue');
  const [assetStatuses, setAssetStatuses] = useState<Record<string, AssetFileStatus>>({});
  const [failedAssetIds, setFailedAssetIds] = useState<Set<string>>(() => new Set());
  const [relinkingId, setRelinkingId] = useState<string>();

  useEffect(() => {
    setTheme(normalizeGameUiTheme(project.ui?.runtimeTheme));
    setTitle(project.ui?.title ?? {});
    setGameVersion(project.meta.gameVersion ?? '1.0.0');
    setPreviewMode('dialogue');
  }, [project]);
  useEffect(() => {
    let cancelled = false;
    void inspectAssets(project.assets).then(async (items) => {
      if (cancelled) return;
      setAssetStatuses(Object.fromEntries(items.map((item) => [item.assetId, item])));
      const failures = new Set<string>();
      await Promise.all(project.assets.filter((asset) => /\.(png|jpe?g|webp)$/i.test(asset.path || asset.name) && asset.uri && items.find((item) => item.assetId === asset.id)?.exists !== false).map((asset) => new Promise<void>((resolve) => {
        const image = new window.Image(); image.onload = () => resolve(); image.onerror = () => { failures.add(asset.id); resolve(); }; image.src = asset.uri!;
      })));
      if (!cancelled) setFailedAssetIds(failures);
    }).catch(() => undefined);
    setFailedAssetIds(new Set());
    return () => { cancelled = true; };
  }, [project.assets.map((asset) => `${asset.id}:${asset.path}:${asset.uri ?? ''}:${asset.size ?? 0}`).join('|')]);

  const imageAssets = useMemo(() => project.assets.filter((asset) => ['scene', 'image', 'character'].includes(asset.kind)), [project.assets]);
  const fontAssets = useMemo(() => project.assets.filter((asset) => asset.kind === 'font'), [project.assets]);
  const backgroundAssetId = title.backgroundAssetId ?? project.scenes?.[0]?.layers.at(-1)?.assetId ?? imageAssets.find((asset) => asset.kind !== 'character')?.id;
  const backgroundUri = project.assets.find((asset) => asset.id === backgroundAssetId)?.uri;
  const character = project.characters[0];
  const portraitAssetId = character?.portraits?.[character.expressions[0]];
  const portraitUri = project.assets.find((asset) => asset.id === portraitAssetId)?.uri;
  const patchTheme = (patch: Partial<GameUiTheme>) => setTheme((current) => normalizeGameUiTheme({ ...current, ...patch }));
  const choosePreset = (preset: GameUiThemePreset) => setTheme(normalizeGameUiTheme(GAME_UI_PRESETS[preset].theme));
  const previewStyle = gameUiThemeCssVariables(theme);
  const imageIssue = (assetId?: string) => {
    if (!assetId) return undefined;
    const asset = project.assets.find((item) => item.id === assetId);
    if (!asset) return '素材引用丢失';
    if (!/\.(png|jpe?g|webp)$/i.test(asset.path || asset.name)) return '格式不兼容';
    if (assetStatuses[assetId]?.exists === false) return '源文件缺失';
    if (!asset.uri) return '无法访问素材';
    if (failedAssetIds.has(assetId)) return '图片损坏或无法解码';
    return undefined;
  };

  const doRelink = async (assetId: string) => {
    setRelinkingId(assetId);
    try { await relinkAsset(assetId); } finally { setRelinkingId(undefined); }
  };
  const AssetHealth = ({ assetId, label }: { assetId?: string; label: string }) => assetId ? <div className={`theme-asset-health ${imageIssue(assetId) ? 'error' : 'ready'}`}>{imageIssue(assetId) ? <AlertTriangle /> : <CheckCircle2 />}<span><strong>{label}</strong><small>{imageIssue(assetId) ?? '素材已就绪'}</small></span><button type="button" title={`重新定位${label}`} disabled={Boolean(relinkingId)} onClick={() => void doRelink(assetId)}>{relinkingId === assetId ? <LoaderCircle className="spinning" /> : <LocateFixed />}</button></div> : null;

  const reset = () => {
    setTheme(normalizeGameUiTheme(project.ui?.runtimeTheme));
    setTitle(project.ui?.title ?? {});
    setGameVersion(project.meta.gameVersion ?? '1.0.0');
  };

  return <div className="game-theme-shell">
    <div className="game-theme-workspace">
      <aside className="game-theme-controls">
        <section><div className="theme-section-heading"><strong>主题预设</strong><button type="button" title="恢复当前预设" onClick={() => choosePreset(theme.preset)}><RotateCcw /></button></div><div className="theme-presets">{(Object.entries(GAME_UI_PRESETS) as [GameUiThemePreset, typeof GAME_UI_PRESETS.modern][]).map(([id, preset]) => <button type="button" className={theme.preset === id ? 'active' : ''} key={id} onClick={() => choosePreset(id)}><span>{preset.name}</span><small>{preset.description}</small></button>)}</div></section>

        <section><div className="theme-section-heading"><strong>对白文字</strong><span>运行时实时生效</span></div><label className="field"><span>字体</span><Select value={theme.fontAssetId ? `asset:${theme.fontAssetId}` : theme.fontFamily} onChange={(value) => { const assetId = value.startsWith('asset:') ? value.slice(6) : undefined; patchTheme({ fontAssetId: assetId, fontFamily: assetId ? '"Slide Project Font", "Microsoft YaHei", sans-serif' : value }); }}><option value={'"Microsoft YaHei", "Noto Sans SC", sans-serif'}>现代黑体</option><option value={'Georgia, "Microsoft YaHei", serif'}>文学衬线</option><option value={'Inter, "Microsoft YaHei", sans-serif'}>极简无衬线</option><option value={'KaiTi, STKaiti, serif'}>楷体</option>{fontAssets.length > 0 && <optgroup label="项目字体">{fontAssets.map((asset) => <option key={asset.id} value={`asset:${asset.id}`}>{asset.name}</option>)}</optgroup>}</Select></label><RangeField label="字号" value={theme.dialogueFontSize} min={12} max={36} unit="px" onChange={(value) => patchTheme({ dialogueFontSize: value })} /><ColorField label="文字颜色" value={theme.dialogueTextColor} onChange={(value) => patchTheme({ dialogueTextColor: value })} /></section>

        <section><div className="theme-section-heading"><strong>对白渐变</strong><span>默认高度为画面 1/6</span></div><ColorField label="渐变底色" value={theme.dialogueGradientColor} onChange={(value) => patchTheme({ dialogueGradientColor: value })} /><RangeField label="区域高度" value={theme.dialogueHeight} min={10} max={35} step={0.5} unit="%" onChange={(value) => patchTheme({ dialogueHeight: value })} /><RangeField label="底部不透明度" value={theme.dialogueBottomOpacity} min={0} max={1} step={0.01} unit="" onChange={(value) => patchTheme({ dialogueBottomOpacity: value })} /><RangeField label="顶部不透明度" value={theme.dialogueTopOpacity} min={0} max={0.7} step={0.01} unit="" onChange={(value) => patchTheme({ dialogueTopOpacity: value })} /></section>

        <section><div className="theme-section-heading"><strong>姓名样式</strong></div><div className="theme-segmented">{([['plain', '纯文字'], ['accent', '强调'], ['plate', '姓名牌']] as const).map(([value, label]) => <button type="button" className={theme.speakerStyle === value ? 'active' : ''} key={value} onClick={() => patchTheme({ speakerStyle: value })}>{label}</button>)}</div><ColorField label="姓名颜色" value={theme.speakerColor} onChange={(value) => patchTheme({ speakerColor: value })} /><RangeField label="姓名字号" value={theme.speakerFontSize} min={10} max={30} unit="px" onChange={(value) => patchTheme({ speakerFontSize: value })} /><label className="field"><span>字重</span><Select value={String(theme.speakerWeight)} onChange={(value) => patchTheme({ speakerWeight: Number(value) })}><option value="400">常规</option><option value="600">半粗</option><option value="700">粗体</option><option value="900">特粗</option></Select></label></section>

        <section><div className="theme-section-heading"><strong>系统菜单与存档</strong></div><ColorField label="交互强调色" value={theme.accentColor} onChange={(value) => patchTheme({ accentColor: value })} /><ColorField label="按钮文字" value={theme.buttonTextColor} onChange={(value) => patchTheme({ buttonTextColor: value })} /><ColorField label="系统面板" value={theme.systemPanelColor} onChange={(value) => patchTheme({ systemPanelColor: value })} /><RangeField label="系统面板不透明度" value={theme.systemPanelOpacity} min={0.5} max={1} step={0.01} unit="" onChange={(value) => patchTheme({ systemPanelOpacity: value })} /><ColorField label="存档面板" value={theme.savePanelColor} onChange={(value) => patchTheme({ savePanelColor: value })} /><ColorField label="存档槽位" value={theme.saveSlotColor} onChange={(value) => patchTheme({ saveSlotColor: value })} /><RangeField label="界面圆角" value={theme.cornerRadius} min={0} max={12} unit="px" onChange={(value) => patchTheme({ cornerRadius: value })} /></section>

        <section><div className="theme-section-heading"><strong>标题画面</strong></div><label className="field"><span>游戏版本</span><input value={gameVersion} onChange={(event) => setGameVersion(event.target.value)} placeholder="1.0.0" /></label><label className="field"><span>标题副标题</span><input value={title.subtitle ?? ''} onChange={(event) => setTitle({ ...title, subtitle: event.target.value })} placeholder={project.meta.author || 'Slide Studio'} /></label><label className="field"><span>标题背景</span><Select value={title.backgroundAssetId ?? ''} onChange={(value) => setTitle({ ...title, backgroundAssetId: value || undefined })}><option value="">自动使用第一个场景</option>{imageAssets.filter((asset) => asset.kind !== 'character').map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</Select></label><AssetHealth assetId={backgroundAssetId} label={title.backgroundAssetId ? '标题背景' : '自动标题背景'} /><label className="field"><span>标题 Logo</span><Select value={title.logoAssetId ?? ''} onChange={(value) => setTitle({ ...title, logoAssetId: value || undefined })}><option value="">使用项目名称文字</option>{imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</Select></label><AssetHealth assetId={title.logoAssetId} label="标题 Logo" /></section>
      </aside>

      <div className="game-theme-preview-area">
        <header><div><strong>实时预览</strong><span>1280 × 720 · 16:9</span></div><div className="theme-preview-tabs">{([['dialogue', MessageSquareText, '对白'], ['system', Menu, '系统菜单'], ['save', Save, '存档']] as const).map(([mode, Icon, label]) => <button type="button" className={previewMode === mode ? 'active' : ''} key={mode} onClick={() => setPreviewMode(mode)}><Icon />{label}</button>)}</div></header>
        <div className="theme-preview-stage" style={previewStyle}>
          {theme.fontAssetId && project.assets.find((asset) => asset.id === theme.fontAssetId)?.uri && <style>{`@font-face{font-family:"Slide Project Font";src:url(${JSON.stringify(project.assets.find((asset) => asset.id === theme.fontAssetId)?.uri)})}`}</style>}
          {backgroundUri && !imageIssue(backgroundAssetId) ? <img className="theme-preview-background" src={backgroundUri} alt="场景预览" onError={() => backgroundAssetId && setFailedAssetIds((current) => new Set(current).add(backgroundAssetId))} /> : <div className="theme-preview-fallback" />}
          {portraitUri ? <img className="theme-preview-character" src={portraitUri} alt={character?.name ?? '角色'} /> : <div className="theme-preview-character-placeholder">{character?.name?.slice(0, 1) ?? '光'}</div>}
          {previewMode === 'dialogue' && <section className="theme-preview-dialogue"><div className={`theme-preview-copy speaker-${theme.speakerStyle}`}><strong>{character?.name ?? '林澄'}</strong><p>星光落进湖面的时候，故事也从这里悄悄开始。</p></div><nav>{DIALOGUE_CONTROLS.map(([Icon, label]) => <button type="button" key={label}><Icon />{label}</button>)}</nav></section>}
          {previewMode === 'system' && <div className="theme-preview-overlay"><section className="theme-preview-system"><header><span>PAUSED</span><h2>系统菜单</h2></header><nav><button className="primary"><Play />继续游戏</button><button><Zap />快速存档</button><button><ArchiveRestore />读取存档</button><button><Settings2 />游戏设置</button></nav></section></div>}
          {previewMode === 'save' && <div className="theme-preview-overlay"><section className="theme-preview-save"><header><div><strong>保存游戏</strong><small>{project.meta.name} · 手动存档</small></div><X /></header><div className="theme-preview-slots">{[1, 2, 3].map((slot) => <article className={slot === 1 ? 'selected' : ''} key={slot}><span>{slot === 1 ? <img src={backgroundUri} alt="" /> : <ArchiveRestore />}</span><div><strong>存档 {slot}</strong><p>{slot === 1 ? '开始 · 主线' : '空槽位'}</p><small>{slot === 1 ? '07/26 14:20 · 12 分钟' : '选择后创建新存档'}</small></div></article>)}</div><footer><button>取消</button><button className="primary"><Save />保存到此槽位</button></footer></section></div>}
        </div>
        <div className="theme-preview-summary"><span><i style={{ background: theme.accentColor }} />强调色 {theme.accentColor.toUpperCase()}</span><span>对白高度 {theme.dialogueHeight.toFixed(1)}%</span><span>{GAME_UI_PRESETS[theme.preset].name}</span></div>
      </div>
    </div>
    <footer className="settings-page-footer game-theme-footer"><button className="button ghost" onClick={reset}><RotateCcw />重置</button><button className="button primary" onClick={() => apply({ ...(project.ui ?? FALLBACK_UI), title, runtimeTheme: normalizeGameUiTheme(theme) }, gameVersion.trim() || '1.0.0')}><Check />应用主题</button></footer>
  </div>;
}
