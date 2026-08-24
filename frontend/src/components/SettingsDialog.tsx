import { Gamepad2, GitBranch, Palette, Settings2, ShieldCheck, Sparkles, X, type LucideIcon } from 'lucide-react';
import type { Project } from '../types';
import { AiProviderSettingsSection } from './AiProviderSettingsSection';
import { ChapterSchedulingSection } from './ChapterSchedulingSection';
import { DesktopMaintenanceSection } from './DesktopMaintenanceSection';
import { EditorAppearanceSection } from './EditorAppearanceSection';
import { GameUiThemeSection } from './GameUiThemeSection';
import { RuntimeSettingsSection } from './RuntimeSettingsSection';
import { AnimatedModal } from './ui/AnimatedModal';

export type SettingsPage = 'ai' | 'appearance' | 'game-ui' | 'runtime' | 'chapters' | 'maintenance';

interface SettingsPageMeta { id: SettingsPage; name: string; description: string; icon: LucideIcon; group: string }

const SETTINGS_PAGES: ReadonlyArray<SettingsPageMeta> = [
  { id: 'ai', name: 'AI 服务', description: '供应商、API Key 与模型目录', icon: Sparkles, group: 'AI 与账号' },
  { id: 'appearance', name: '个性化', description: '编辑器主题、强调色与动效', icon: Palette, group: '外观' },
  { id: 'game-ui', name: '游戏 UI 主题', description: '玩家看到的对白、菜单与存档界面', icon: Gamepad2, group: '外观' },
  { id: 'runtime', name: '运行设置', description: '分辨率、文本速度与保存策略', icon: Settings2, group: '项目运行' },
  { id: 'chapters', name: '章节调度', description: '章节运行顺序与公共前处理', icon: GitBranch, group: '项目运行' },
  { id: 'maintenance', name: '维护中心', description: '软件更新、性能与崩溃报告', icon: ShieldCheck, group: '应用' },
];

interface SettingsDialogProps {
  open: boolean;
  page: SettingsPage;
  onNavigate: (page: SettingsPage) => void;
  close: () => void;
  project: Project;
  notify: (message: string, tone?: 'error' | 'success') => void;
  requestConfirm: (options: { title: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
  commit: (updater: (project: Project) => Project, label?: string) => void;
  relinkAsset: (assetId: string) => Promise<void>;
  onAiKeyStatusChange: (hasKey: boolean) => void;
}

export function SettingsDialog({ open, page, onNavigate, close, project, notify, requestConfirm, commit, relinkAsset, onAiKeyStatusChange }: SettingsDialogProps) {
  const activePage = SETTINGS_PAGES.find((item) => item.id === page) ?? SETTINGS_PAGES[0];
  const groups = SETTINGS_PAGES.reduce<{ group: string; pages: SettingsPageMeta[] }[]>((result, item) => {
    const existing = result.find((entry) => entry.group === item.group);
    if (existing) existing.pages.push(item);
    else result.push({ group: item.group, pages: [item] });
    return result;
  }, []);
  return <AnimatedModal open={open} close={close} className="settings-hub" labelledBy="settings-hub-title">
    <header className="modal-header settings-hub-header"><div className="modal-heading-icon"><Settings2 /></div><div><strong id="settings-hub-title">设置</strong><small>{activePage.name} · {activePage.description}</small></div><button className="icon-button" title="关闭" onClick={close}><X /></button></header>
    <div className="settings-hub-body">
      <nav className="settings-hub-nav" aria-label="设置分类">{groups.map((entry) => <div className="settings-nav-group" key={entry.group}>
        <span>{entry.group}</span>
        {entry.pages.map((item) => <button type="button" key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => onNavigate(item.id)}><item.icon />{item.name}</button>)}
      </div>)}</nav>
      <div className="settings-page">
        {page === 'ai' && <AiProviderSettingsSection notify={notify} onKeyStatusChange={onAiKeyStatusChange} />}
        {page === 'appearance' && <EditorAppearanceSection openGameTheme={() => onNavigate('game-ui')} />}
        {page === 'game-ui' && <GameUiThemeSection project={project} relinkAsset={relinkAsset} apply={(ui, gameVersion) => { commit((current) => ({ ...current, ui, meta: { ...current.meta, gameVersion } }), '更新游戏 UI 主题'); notify('游戏 UI 主题已应用'); }} />}
        {page === 'runtime' && <RuntimeSettingsSection project={project} apply={(settings, resolution) => { commit((current) => ({ ...current, settings, meta: { ...current.meta, resolution } }), '更新运行设置'); notify('运行设置已更新'); }} />}
        {page === 'chapters' && <ChapterSchedulingSection project={project} apply={(chapterScheduling) => { commit((current) => ({ ...current, settings: { ...current.settings, chapterScheduling } }), '更新章节调度'); notify('章节运行设置已更新'); }} />}
        {page === 'maintenance' && <DesktopMaintenanceSection notify={notify} requestConfirm={requestConfirm} />}
      </div>
    </div>
  </AnimatedModal>;
}
