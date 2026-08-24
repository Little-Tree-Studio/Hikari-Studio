import { Check, Gamepad2, MonitorCog, MoonStar, Palette, Sparkles, SunMedium } from 'lucide-react';
import { EDITOR_THEMES, useEditorAppearance } from '../core/editorAppearance';
import type { EditorAppearance, EditorCornerStyle, EditorThemeId } from '../types';
import { ColorPicker } from './ui/ColorPicker';

interface Props { openGameTheme: () => void }

const CORNER_OPTIONS: ReadonlyArray<{ id: EditorCornerStyle; name: string; hint: string; preview: string }> = [
  { id: 'sharp', name: '方角', hint: '利落直角，贴近传统桌面工具', preview: '0px' },
  { id: 'soft', name: '小圆角', hint: '3–8px，默认平衡观感', preview: '3px' },
  { id: 'rounded', name: '大圆角', hint: '6–18px，更柔和现代', preview: '9px' },
];

export function EditorAppearanceSection({ openGameTheme }: Props) {
  const { appearance, activeTheme, updateAppearance } = useEditorAppearance();
  const apply = (next: Partial<EditorAppearance>) => void updateAppearance({ ...appearance, ...next });
  const selectTheme = (themeId: EditorThemeId) => apply({ mode: 'fixed', themeId, accentColor: undefined });

  return <div className="appearance-body">
    <section className="appearance-section"><header><div><strong>主题</strong><small>当前生效：{EDITOR_THEMES.find((theme) => theme.id === activeTheme)?.name}</small></div><label className="appearance-system-toggle"><input type="checkbox" checked={appearance.mode === 'system'} onChange={(event) => apply({ mode: event.target.checked ? 'system' : 'fixed' })} /><span><SunMedium /><MoonStar /></span>跟随 Windows</label></header>
      <div className="appearance-theme-grid">{EDITOR_THEMES.map((theme) => <button type="button" key={theme.id} className={appearance.themeId === theme.id && appearance.mode === 'fixed' ? 'selected' : ''} onClick={() => selectTheme(theme.id)}><span className="theme-swatch" style={{ '--swatch-bg': theme.preview[0], '--swatch-panel': theme.preview[1], '--swatch-accent': theme.preview[2] } as React.CSSProperties}><i /><i /><i /></span><span><strong>{theme.name}</strong><small>{theme.description}</small></span>{appearance.themeId === theme.id && appearance.mode === 'fixed' && <Check />}</button>)}</div>
    </section>
    <section className="appearance-section appearance-options"><header><div><strong>个性强调色</strong><small>自动派生悬停、选中与焦点颜色</small></div></header><ColorPicker value={appearance.accentColor} fallback={EDITOR_THEMES.find((theme) => theme.id === appearance.themeId)?.preview[2] ?? '#187c6b'} onChange={(hex) => apply({ accentColor: hex })} /></section>
    <section className="appearance-section appearance-options"><header><div><strong>界面圆角</strong><small>统一控制所有工作区、对话框与控件的圆角比例</small></div></header><div className="appearance-corner-grid">{CORNER_OPTIONS.map((option) => <button type="button" key={option.id} className={appearance.cornerStyle === option.id ? 'selected' : ''} onClick={() => apply({ cornerStyle: option.id })}><span className="corner-swatch" style={{ borderRadius: option.preview }}><i style={{ borderRadius: `calc(${option.preview} - 1px)` }} /></span><span><strong>{option.name}</strong><small>{option.hint}</small></span>{appearance.cornerStyle === option.id && <Check />}</button>)}</div></section>
    <section className="appearance-section appearance-options"><header><div><strong>界面动效</strong><small>拖拽、画布缩放和连续输入始终保持即时响应</small></div></header><div className="appearance-segmented">{([['system', MonitorCog, '跟随系统'], ['full', Sparkles, '完整动效'], ['reduced', SunMedium, '减少动效']] as const).map(([value, Icon, label]) => <button type="button" key={value} className={appearance.motion === value ? 'active' : ''} onClick={() => apply({ motion: value })}><Icon />{label}</button>)}</div></section>
    <button className="game-theme-entry" onClick={openGameTheme}><Gamepad2 /><span><strong>游戏 UI 主题</strong><small>配置玩家看到的对白、菜单和存档界面</small></span><span>前往设置页</span></button>
  </div>;
}
