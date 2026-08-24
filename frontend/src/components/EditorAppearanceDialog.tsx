import { Check, Gamepad2, MonitorCog, MoonStar, Palette, Sparkles, SunMedium, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EDITOR_THEMES, useEditorAppearance } from '../core/editorAppearance';
import type { EditorAppearance, EditorCornerStyle, EditorThemeId } from '../types';
import { AnimatedModal } from './ui/AnimatedModal';

interface Props { open: boolean; close: () => void; openGameTheme: () => void }

const CORNER_OPTIONS: ReadonlyArray<{ id: EditorCornerStyle; name: string; hint: string; preview: string }> = [
  { id: 'sharp', name: '方角', hint: '利落直角，贴近传统桌面工具', preview: '0px' },
  { id: 'soft', name: '小圆角', hint: '3–8px，默认平衡观感', preview: '3px' },
  { id: 'rounded', name: '大圆角', hint: '6–18px，更柔和现代', preview: '9px' },
];

export function EditorAppearanceDialog({ open, close, openGameTheme }: Props) {
  const { appearance, activeTheme, updateAppearance } = useEditorAppearance();
  const [draft, setDraft] = useState<EditorAppearance>(appearance);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { if (open) setDraft(appearance); }, [appearance, open]);

  const selectTheme = (themeId: EditorThemeId) => setDraft({ ...draft, mode: 'fixed', themeId, accentColor: undefined });
  const apply = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateAppearance(draft);
      close();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '外观设置保存失败');
    } finally { setSaving(false); }
  };

  return <AnimatedModal open={open} close={close} className="appearance-dialog" labelledBy="appearance-title">
    <header className="modal-header appearance-header"><div className="modal-heading-icon"><Palette /></div><div><strong id="appearance-title">编辑器外观</strong><small>主题和动效仅保存在此设备，不会写入游戏项目</small></div><button className="icon-button" title="关闭" onClick={close}><X /></button></header>
    <div className="appearance-body">
      <section className="appearance-section"><header><div><strong>主题</strong><small>当前生效：{EDITOR_THEMES.find((theme) => theme.id === activeTheme)?.name}</small></div><label className="appearance-system-toggle"><input type="checkbox" checked={draft.mode === 'system'} onChange={(event) => setDraft({ ...draft, mode: event.target.checked ? 'system' : 'fixed' })} /><span><SunMedium /><MoonStar /></span>跟随 Windows</label></header>
        <div className="appearance-theme-grid">{EDITOR_THEMES.map((theme) => <button type="button" key={theme.id} className={draft.themeId === theme.id && draft.mode === 'fixed' ? 'selected' : ''} onClick={() => selectTheme(theme.id)}><span className="theme-swatch" style={{ '--swatch-bg': theme.preview[0], '--swatch-panel': theme.preview[1], '--swatch-accent': theme.preview[2] } as React.CSSProperties}><i /><i /><i /></span><span><strong>{theme.name}</strong><small>{theme.description}</small></span>{draft.themeId === theme.id && draft.mode === 'fixed' && <Check />}</button>)}</div>
      </section>
      <section className="appearance-section appearance-options"><header><div><strong>个性强调色</strong><small>自动派生悬停、选中与焦点颜色</small></div></header><label className="appearance-color"><input type="color" value={draft.accentColor ?? EDITOR_THEMES.find((theme) => theme.id === draft.themeId)?.preview[2]} onChange={(event) => setDraft({ ...draft, accentColor: event.target.value })} /><span>{draft.accentColor?.toUpperCase() ?? '使用主题默认色'}</span><button type="button" onClick={() => setDraft({ ...draft, accentColor: undefined })}>恢复默认</button></label></section>
      <section className="appearance-section appearance-options"><header><div><strong>界面圆角</strong><small>统一控制所有工作区、对话框与控件的圆角比例</small></div></header><div className="appearance-corner-grid">{CORNER_OPTIONS.map((option) => <button type="button" key={option.id} className={draft.cornerStyle === option.id ? 'selected' : ''} onClick={() => setDraft({ ...draft, cornerStyle: option.id })}><span className="corner-swatch" style={{ borderRadius: option.preview }}><i style={{ borderRadius: `calc(${option.preview} - 1px)` }} /></span><span><strong>{option.name}</strong><small>{option.hint}</small></span>{draft.cornerStyle === option.id && <Check />}</button>)}</div></section>
      <section className="appearance-section appearance-options"><header><div><strong>界面动效</strong><small>拖拽、画布缩放和连续输入始终保持即时响应</small></div></header><div className="appearance-segmented">{([['system', MonitorCog, '跟随系统'], ['full', Sparkles, '完整动效'], ['reduced', SunMedium, '减少动效']] as const).map(([value, Icon, label]) => <button type="button" key={value} className={draft.motion === value ? 'active' : ''} onClick={() => setDraft({ ...draft, motion: value })}><Icon />{label}</button>)}</div></section>
      <button className="game-theme-entry" onClick={() => { close(); openGameTheme(); }}><Gamepad2 /><span><strong>游戏 UI 主题</strong><small>配置玩家看到的对白、菜单和存档界面</small></span><span>打开编辑器</span></button>
    </div>
    <footer className="modal-footer"><span className="appearance-footnote">{saveError ?? '主题切换无需重启 Slide Studio'}</span><button className="button ghost" onClick={close}>取消</button><button className="button primary" disabled={saving} onClick={() => void apply()}><Check />{saving ? '保存中...' : '应用外观'}</button></footer>
  </AnimatedModal>;
}
