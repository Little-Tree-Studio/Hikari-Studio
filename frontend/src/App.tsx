import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlignLeft, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AudioLines, Bell, BookOpen, Box, Braces, BugPlay,
  CheckCircle2, ChevronDown, ChevronsUpDown, CirclePlay, Clapperboard, Code2, Copy, CornerDownRight,
  ExternalLink, FileCode2, FilePlus2, FileText, FileUp, Flag, FolderOpen, FolderPlus,
  GitBranch, GitFork, GripVertical, HardDrive, History, Image, LocateFixed, Maximize2,
  LogOut, Menu, MessageSquareText, Minus, Music2, NotebookPen, PackageCheck, Palette, Plus,
  Pin, Redo2, Rocket, Save, Search, Settings2, Square,
  Sparkles, Trash2, Undo2, UserPlus, UserRound, Users, X, PanelBottom, PanelRight, PictureInPicture2,
} from 'lucide-react';
import {
  buildWeb, buildWindows, callWindow, createProject, exportRenpy, importAssets, loadProject,
  applyAiPatch, loadCommandHistory, loadCommandHistoryStats, loadRecoverySnapshot, openProject, openProjectPath, openRecentProject, previewScriptImport, replaceAssetFile, saveCommandHistory, saveProject, saveProjectAs,
} from './api';
import { Preview } from './components/Preview';
import { AiAgentPanel } from './components/AiAgentPanel';
import { NotificationCenter } from './components/NotificationCenter';
import { RuntimeSettingsDialog } from './components/RuntimeSettingsDialog';
import { GameUiThemeDialog } from './components/GameUiThemeDialog';
import { EditorAppearanceDialog } from './components/EditorAppearanceDialog';
import { ChapterSchedulingDialog } from './components/ChapterSchedulingDialog';
import { SearchPalette, type SearchLocation } from './components/SearchPalette';
import { ScriptImportDialog } from './components/ScriptImportDialog';
import { NarrativeMap } from './components/NarrativeMap';
import { CharacterManager } from './components/CharacterManager';
import { SceneManager } from './components/SceneManager';
import { AudioManager } from './components/AudioManager';
import { AssetManager } from './components/AssetManager';
import { EditorAssetImportDialog, type EditorImportAction } from './components/EditorAssetImportDialog';
import { StageTimelineWorkspace } from './components/StageTimelineWorkspace';
import { ProjectLaunchScreen } from './components/ProjectLaunchScreen';
import { analyzeAssetReferences } from './core/assetReferences';
import { audioCategoryOf, matchingVoice } from './core/audio';
import { log } from './core/logger';
import { buildAgentPatchSemanticRecord, restoreAgentPatchCategory, type AgentPatchSemanticRecord } from './core/agentPatchHistory';
import { diffProjects, type ProjectDiff } from './core/projectDiff';
import { readSmallValue, removeSmallValue, writeSmallValue } from './core/storage';
import { projectScenes, sceneBlockSnapshot } from './core/scenes';
import { useEditorAppearance } from './core/editorAppearance';
import { remapTimeline } from './core/timeline';
import { createBlock } from './engine-core/blocks';
import { diagnosticSummary } from './engine-core/diagnostics';
import { useCommandHistory, type CommandRestoreStrategies, type CommandSnapshotEntry, type PersistedCommandHistory } from './hooks/useCommandHistory';
import type { AgentOperation, AppNotification, Asset, AudioCategory, BlockType, CommandHistoryStorageStats, ConditionOperator, InspectorDock, Project, ProjectCreationOptions, RecoverySnapshot, ScriptImportPreview, StoryBlock, StoryBlockPatch } from './types';

const SaveAs = Copy;

const commandRestoreStrategies: CommandRestoreStrategies<Project> = {
  'agent-patch': (current, before, after, categoryId, payload) => restoreAgentPatchCategory(current, before, after, categoryId, payload as AgentPatchSemanticRecord),
};

type Page = 'script' | 'stage' | 'assets' | 'audio' | 'map' | 'characters' | 'scenes' | 'history' | 'ai';
type View = 'cards' | 'plain' | 'code' | 'json';
type Modal = 'search' | 'publish' | 'blocks' | null;
type Toast = { text: string; tone?: 'error' | 'success' } | null;
type TextDialogOptions = { title: string; message?: string; placeholder?: string; initialValue?: string; confirmText?: string };
type ConfirmDialogOptions = { title: string; message: string; confirmText?: string; danger?: boolean };
type RequestText = (options: TextDialogOptions) => Promise<string | null>;
type RequestConfirm = (options: ConfirmDialogOptions) => Promise<boolean>;
type AppDialogRequest = {
  kind: 'text' | 'confirm';
  title: string;
  message?: string;
  placeholder?: string;
  value: string;
  confirmText: string;
  danger?: boolean;
  resolve: (value: string | boolean | null) => void;
};

const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clone = <T,>(value: T): T => structuredClone(value);
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function FrontendDialog({ dialog, updateValue, close }: { dialog: AppDialogRequest | null; updateValue: (value: string) => void; close: (value: string | boolean | null) => void }) {
  if (!dialog) return null;
  const cancel = () => close(dialog.kind === 'text' ? null : false);
  const submit = () => {
    if (dialog.kind === 'confirm') close(true);
    else if (dialog.value.trim()) close(dialog.value.trim());
  };
  return <div className="modal-backdrop app-dialog-backdrop" role="presentation" onClick={cancel} onKeyDown={(event) => { if (event.key === 'Escape') cancel(); }}><form className="modal app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); submit(); }}><div className="modal-header"><strong id="app-dialog-title">{dialog.title}</strong><button className="icon-button" type="button" title="关闭" onClick={cancel}><X /></button></div><div className="modal-body">{dialog.message && <p className="app-dialog-message">{dialog.message}</p>}{dialog.kind === 'text' && <input className="app-dialog-input" autoFocus value={dialog.value} placeholder={dialog.placeholder} onChange={(event) => updateValue(event.target.value)} />}</div><div className="modal-footer"><button className="button ghost" type="button" onClick={cancel}>取消</button><button className={`button ${dialog.danger ? 'danger' : 'primary'}`} type="submit" disabled={dialog.kind === 'text' && !dialog.value.trim()}>{dialog.confirmText}</button></div></form></div>;
}

const fallbackProject: Project = {
  version: 3,
  meta: { id: 'demo', name: '星海回声', author: '', resolution: [1280, 720], updatedAt: new Date().toISOString() },
  characters: [
    { id: 'lin', name: '林澄', color: '#e66b4f', expressions: ['默认', '浅笑', '惊讶'] },
    { id: 'su', name: '苏芮', color: '#825eb5', expressions: ['默认', '平静', '犹豫'] },
  ],
  chapters: [
    { id: 'start', name: '开始', entry: true, fragments: [{ id: 'opening', name: '片头' }] },
    { id: 'c1', name: '第一章 · 雾中的来信', fragments: [{ id: 'lake-meeting', name: '湖畔相遇' }, { id: 'old-school', name: '旧校舍' }] },
  ],
  activeFragmentId: 'lake-meeting',
  scripts: {
    opening: [{ id: 'op1', type: 'narration', text: '星海回声' }],
    'lake-meeting': [
      { id: 'b1', type: 'scene', title: '晨雾湖畔', assetId: 'lake', transition: 'dissolve', duration: 1.2 },
      { id: 'b2', type: 'sound', title: 'summer_memory.mp3', volume: .68, loop: true },
      { id: 'b3', type: 'narration', text: '薄雾沿着湖面缓慢散开，夏日的第一束阳光落在旧码头上。' },
      { id: 'b4', type: 'dialogue', speaker: '林澄', text: '你果然还是来了。', expression: '浅笑', voice: 'lc_001.ogg' },
      { id: 'b5', type: 'dialogue', speaker: '苏芮', text: '因为有人在信里说，错过今天就再也见不到这片星海了。', expression: '平静', voice: 'sr_014.ogg' },
      { id: 'b6', type: 'branch', title: '如何回应？', options: [{ text: '相信她', target: 'opening' }, { text: '转移话题', target: 'old-school' }] },
    ],
    'old-school': [{ id: 'school1', type: 'narration', text: '尘埃在走廊的光束中缓缓飘落。' }],
  },
  assets: [
    { id: 'lake', kind: 'scene', name: '晨雾湖畔', path: 'builtin/lake.jpg', uri: './assets/lake.jpg' },
    { id: 'mountain', kind: 'scene', name: '远山晴空', path: 'builtin/mountain.jpg', uri: './assets/mountain.jpg' },
  ],
  variables: { 好感度: 0 },
  settings: { textSpeed: 35, autoSave: true, skipRead: true },
};

const blockMeta = {
  scene: { name: '场景', icon: Image, description: '切换背景与过渡' },
  sound: { name: '播放音频', icon: Music2, description: 'BGM、语音或音效' },
  characterShow: { name: '显示角色', icon: UserRound, description: '设置角色表情、站位和入场' },
  characterHide: { name: '隐藏角色', icon: UserRound, description: '角色退场并移出舞台' },
  camera: { name: '镜头', icon: LocateFixed, description: '移动、缩放、震动和滤镜' },
  narration: { name: '旁白', icon: AlignLeft, description: '叙述和内心独白' },
  dialogue: { name: '角色对白', icon: MessageSquareText, description: '角色、表情与语音' },
  branch: { name: '选项分支', icon: GitFork, description: '玩家选择与跳转' },
  setVariable: { name: '设置变量', icon: Braces, description: '修改剧情变量' },
  condition: { name: '条件判断', icon: GitBranch, description: '按变量决定流程' },
  jump: { name: '跳转片段', icon: Flag, description: '切换到目标片段' },
  call: { name: '调用片段', icon: Code2, description: '执行子片段后返回' },
  return: { name: '返回', icon: CornerDownRight, description: '返回调用位置' },
} satisfies Record<BlockType, { name: string; icon: typeof Image; description: string }>;

function useToast() {
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef(0);
  const show = (text: string, tone: 'error' | 'success' = 'success') => {
    window.clearTimeout(timer.current);
    setToast({ text, tone });
    timer.current = window.setTimeout(() => setToast(null), 3200);
  };
  return { toast, show };
}

function WindowChrome({ onClose }: { onClose: () => void }) {
  return <div className="window-controls">
    <button title="最小化" onClick={() => void callWindow('minimize_window')}><Minus /></button>
    <button title="最大化" onClick={() => void callWindow('toggle_maximize')}><Square /></button>
    <button className="window-close" title="关闭" onClick={onClose}><X /></button>
  </div>;
}

interface SidebarProps {
  project: Project;
  activate: (id: string) => void;
  addChapter: () => void;
  addFragment: (chapterId: string) => void;
  removeFragment: (chapterId: string, fragmentId: string) => void;
  openSettings: () => void;
  toggleChapterDisabled: (chapterId: string) => void;
  collapseSidebar: () => void;
  structureAction: (action: 'copy' | 'cut' | 'duplicate' | 'paste', chapterId: string, fragmentId?: string) => void;
}

function Sidebar({ project, activate, addChapter, addFragment, removeFragment, openSettings, toggleChapterDisabled, collapseSidebar, structureAction }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [chapterMenu, setChapterMenu] = useState<{ chapterId: string; fragmentId?: string; x: number; y: number } | null>(null);
  useEffect(() => { if (!chapterMenu) return; const close = () => setChapterMenu(null); window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close); }, [chapterMenu]);
  const wordCount = Object.values(project.scripts).flat().reduce((total, block) => total + (block.text?.length ?? 0), 0);
  const toggleChapter = (chapterId: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(chapterId)) next.delete(chapterId); else next.add(chapterId);
    return next;
  });
  const toggleWithKeyboard = (event: ReactKeyboardEvent, chapterId: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleChapter(chapterId);
  };
  return <aside className="project-sidebar">
    <div className="sidebar-title"><button className="icon-button small" title="收起章节列表" onClick={collapseSidebar}><ArrowLeft /></button><span>剧本结构</span><button className="icon-button small" title="新建章节" onClick={addChapter}><Plus /></button></div>
    <div className="tree-section"><div className="tree-heading"><span>章节</span><button className="icon-button tiny" title="运行设置" onClick={openSettings}><Settings2 /></button></div>
      {project.chapters.map((chapter) => <div className={`chapter ${chapter.disabled ? 'disabled' : ''}`} key={chapter.id}>
        <div className={`chapter-row ${collapsed.has(chapter.id) ? 'collapsed' : ''} ${chapter.fragments.some((f) => f.id === project.activeFragmentId) ? 'active' : ''}`} role="button" tabIndex={0} aria-expanded={!collapsed.has(chapter.id)} onContextMenu={(event) => { event.preventDefault(); setChapterMenu({ chapterId: chapter.id, x: event.clientX, y: event.clientY }); }} onClick={() => toggleChapter(chapter.id)} onKeyDown={(event) => toggleWithKeyboard(event, chapter.id)}><ChevronDown className="chapter-chevron" />{chapter.entry ? <CirclePlay /> : <BookOpen />}<span>{chapter.name}</span>{chapter.disabled && <em>已禁用</em>}<span className="count">{chapter.fragments.length}</span><button className="tree-action" title="新建片段" onClick={(event) => { event.stopPropagation(); addFragment(chapter.id); }}><Plus /></button></div>
        <div className={`fragment-list ${collapsed.has(chapter.id) ? 'collapsed' : ''}`}>{chapter.fragments.map((fragment) => <div key={fragment.id} className={`fragment-row ${fragment.id === project.activeFragmentId ? 'active' : ''}`} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setChapterMenu({ chapterId: chapter.id, fragmentId: fragment.id, x: event.clientX, y: event.clientY }); }} onClick={() => activate(fragment.id)}><CornerDownRight /><span>{fragment.name}</span><em>{project.scripts[fragment.id]?.length ?? 0}</em>{!chapter.entry && <button className="tree-action" title="删除片段" onClick={(event) => { event.stopPropagation(); removeFragment(chapter.id, fragment.id); }}><Trash2 /></button>}</div>)}</div>
      </div>)}
      {chapterMenu && <div className="context-menu chapter-context-menu" style={{ left: chapterMenu.x, top: chapterMenu.y }} onPointerDown={(event) => event.stopPropagation()}>{!chapterMenu.fragmentId && !project.chapters.find((chapter) => chapter.id === chapterMenu.chapterId)?.entry && <button onClick={() => { toggleChapterDisabled(chapterMenu.chapterId); setChapterMenu(null); }}>{project.chapters.find((chapter) => chapter.id === chapterMenu.chapterId)?.disabled ? '启用此章' : '禁用此章'}</button>}<strong>{chapterMenu.fragmentId ? 'Fragment' : '章节'}</strong><button onClick={() => { structureAction('copy', chapterMenu.chapterId, chapterMenu.fragmentId); setChapterMenu(null); }}>复制</button><button disabled={project.chapters.find((chapter) => chapter.id === chapterMenu.chapterId)?.entry} onClick={() => { structureAction('cut', chapterMenu.chapterId, chapterMenu.fragmentId); setChapterMenu(null); }}>剪切</button><button onClick={() => { structureAction('duplicate', chapterMenu.chapterId, chapterMenu.fragmentId); setChapterMenu(null); }}>创建副本</button><button onClick={() => { structureAction('paste', chapterMenu.chapterId, chapterMenu.fragmentId); setChapterMenu(null); }}>粘贴</button><button onClick={() => setChapterMenu(null)}>取消</button></div>}
    </div>
    <div className="sidebar-footer"><div><span>项目规模</span><strong>{wordCount} 字</strong></div><div className="progress"><span style={{ width: `${Math.min(100, wordCount / 50)}%` }} /></div><small>{Object.values(project.scripts).flat().length} Blocks · {project.assets.length} 素材</small></div>
  </aside>;
}

interface StoryCardProps {
  project: Project;
  block: StoryBlock;
  selected: boolean;
  asset?: Asset;
  onSelect: (event: ReactMouseEvent) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onChange: (patch: StoryBlockPatch) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

function StoryCard({ project, block, selected, asset, onSelect, onContextMenu, onChange, onMove, onDuplicate, onDelete, dragging, onPointerDown, onPointerMove, onPointerUp }: StoryCardProps) {
  const meta = blockMeta[block.type];
  const Icon = meta.icon;
  const dialogueCharacter = block.type === 'dialogue' ? project.characters.find((character) => character.name === block.speaker) : undefined;
  const dialogueVoice = block.type === 'dialogue' && block.voice ? project.assets.find((item) => item.id === block.voice || item.name === block.voice || item.path.endsWith(block.voice ?? '')) : undefined;
  return <motion.div layout={!dragging} transition={{ layout: { type: 'spring', stiffness: 520, damping: 42 } }} className={`story-block ${dragging ? 'dragging' : ''}`}>
    <button className="block-handle" title="拖动 Block" aria-label={`拖动 ${meta.name}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}><GripVertical /></button>
    <div className={`block-card ${block.type} ${selected ? 'selected' : ''}`} onClick={onSelect} onContextMenu={onContextMenu}>
      <div className="block-meta"><Icon /><span>{meta.name}</span><span className="duration">{block.duration ? `${block.duration}s` : '--'}</span><div className="block-commands"><button title="上移" onClick={(e) => { e.stopPropagation(); onMove(-1); }}><ArrowUp /></button><button title="下移" onClick={(e) => { e.stopPropagation(); onMove(1); }}><ArrowDown /></button><button title="复制" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}><Copy /></button><button title="删除" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 /></button></div></div>
      {block.type === 'scene' && <div className="scene-summary"><img className="scene-thumb" src={asset?.uri ?? './assets/lake.jpg'} alt="场景" /><div><strong>{block.title}</strong><small>{block.transition ?? 'dissolve'} · {block.duration ?? 1} 秒</small></div></div>}
      {block.type === 'sound' && <div className="scene-summary"><div className="scene-thumb asset-audio"><AudioLines /></div><div><strong>{block.title}</strong><small>{block.loop ? '循环播放' : '单次播放'} · 音量 {Math.round((block.volume ?? 1) * 100)}%</small></div></div>}
      {block.type === 'characterShow' && <div className="control-summary"><UserRound /><strong>{block.characterId ?? '未选择角色'}</strong><span>{block.expression ?? '默认'} · {block.position ?? 'center'}</span></div>}
      {block.type === 'characterHide' && <div className="control-summary"><UserRound /><strong>{block.characterId ?? '未选择角色'}</strong><span>{block.animation ?? 'fade'}</span></div>}
      {block.type === 'camera' && <div className="control-summary"><LocateFixed /><strong>缩放 {Math.round((block.zoom ?? 1) * 100)}%</strong><span>偏移 {block.cameraX ?? 0}, {block.cameraY ?? 0} · {block.filter ?? 'none'}</span></div>}
      {block.type === 'narration' && <div className="block-text" contentEditable suppressContentEditableWarning onBlur={(e) => onChange({ text: e.currentTarget.textContent ?? '' })}>{block.text}</div>}
      {block.type === 'dialogue' && <div className="dialogue-line"><div className="dialogue-identity"><select aria-label="对白角色" value={block.speaker ?? ''} onClick={(event) => event.stopPropagation()} onChange={(event) => { const character = project.characters.find((item) => item.name === event.target.value); onChange({ speaker: event.target.value, expression: character?.expressions[0] ?? '默认', displayNameSchemeId: undefined }); }}>{project.characters.map((character) => <option key={character.id} value={character.name}>{character.name}</option>)}</select><select aria-label="玩家显示名" value={block.displayNameSchemeId ?? ''} onClick={(event) => event.stopPropagation()} onChange={(event) => onChange({ displayNameSchemeId: event.target.value || undefined })}><option value="">主名称</option>{dialogueCharacter?.displayNameSchemes?.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}</select><select aria-label="对白表情" value={block.expression ?? dialogueCharacter?.expressions[0] ?? ''} onClick={(event) => event.stopPropagation()} onChange={(event) => onChange({ expression: event.target.value })}>{dialogueCharacter?.expressions.map((expression) => <option key={expression} value={expression}>{expression}</option>)}</select></div><div><div className="block-text" contentEditable suppressContentEditableWarning onBlur={(e) => onChange({ text: e.currentTarget.textContent ?? '' })}>{block.text}</div><div className="block-tags">{block.voice && <span className="tag">语音 · {dialogueVoice?.name ?? block.voice}</span>}</div></div></div>}
      {block.type === 'branch' && <><div className="block-text"><strong>{block.title}</strong></div><div className="branch-options">{block.options?.map((option) => <div className="branch-option" key={option.text}><span>{option.text}</span><span>{option.target} →</span></div>)}</div></>}
      {block.type === 'setVariable' && <div className="control-summary"><Braces /><strong>{block.variable}</strong><span>= {String(block.value ?? '')}</span></div>}
      {block.type === 'condition' && <div className="control-summary"><GitBranch /><strong>{block.variable}</strong><span>{block.operator ?? 'eq'} {String(block.compareValue ?? '')}</span><em>{block.trueTarget ?? '继续'} / {block.falseTarget ?? '继续'}</em></div>}
      {(block.type === 'jump' || block.type === 'call') && <div className="control-summary"><Flag /><strong>{block.target ?? '未设置目标'}</strong></div>}
      {block.type === 'return' && <div className="control-summary"><CornerDownRight /><strong>返回上一个调用位置</strong></div>}
    </div>
  </motion.div>;
}

function Inspector({ project, block, update, dock, setDock, notify }: { project: Project; block?: StoryBlock; update: (patch: StoryBlockPatch) => void; dock: InspectorDock; setDock: (dock: InspectorDock) => void; notify: (message: string, tone?: 'error' | 'success') => void }) {
  const header = <div className="inspector-header"><strong>属性检查器</strong>{block && <span>{blockMeta[block.type].name}</span>}<div className="inspector-dock-controls" role="group" aria-label="属性检查器停靠位置"><button className={dock === 'preview' ? 'active' : ''} title="停靠在预览下方" onClick={() => setDock('preview')}><PanelRight /></button><button className={dock === 'editor' ? 'active' : ''} title="停靠在编辑器下方" onClick={() => setDock('editor')}><PanelBottom /></button><button className={dock === 'floating' ? 'active' : ''} title="浮动面板" onClick={() => setDock('floating')}><PictureInPicture2 /></button></div></div>;
  if (!block) return <section className="inspector">{header}<div className="empty-state"><Settings2 /><strong>选择一个 Block</strong><span>在这里编辑详细参数</span></div></section>;
  const fragmentOptions = project.chapters.flatMap((chapter) => chapter.fragments);
  const sceneDefinitions = projectScenes(project);
  const selectedCharacter = block.type === 'characterShow'
    ? project.characters.find((character) => character.id === block.characterId)
    : block.type === 'dialogue'
      ? project.characters.find((character) => character.name === block.speaker || character.id === block.speaker)
      : undefined;
  const voiceAssets = project.assets.filter((asset) => asset.kind === 'audio' && audioCategoryOf(asset) === 'voice' && (!selectedCharacter || asset.voiceCharacterId === selectedCharacter.id));
  const soundAssets = block.type === 'sound' ? project.assets.filter((asset) => asset.kind === 'audio' && audioCategoryOf(asset) === (block.channel ?? 'bgm')) : [];
  const autoMatchVoice = () => {
    if (block.type !== 'dialogue') return;
    const match = matchingVoice(project, block.text ?? '', selectedCharacter?.id);
    if (!match.asset || match.score < .35) { notify('没有找到足够相似的已识别语音', 'error'); return; }
    update({ voice: match.asset.id });
    notify(`已匹配“${match.asset.name}”，相似度 ${Math.round(match.score * 100)}%`);
  };
  return <section className="inspector">{header}<div className="inspector-body">
    {block.type === 'dialogue' && <><div className="field"><label>说话角色</label><select value={block.speaker ?? ''} onChange={(e) => { const character = project.characters.find((item) => item.name === e.target.value); update({ speaker: e.target.value, expression: character?.expressions[0] ?? '默认', displayNameSchemeId: undefined, voice: undefined }); }}>{project.characters.map((character) => <option key={character.id} value={character.name}>{character.name}</option>)}</select></div><div className="field"><label>玩家显示名</label><select value={block.displayNameSchemeId ?? ''} onChange={(e) => update({ displayNameSchemeId: e.target.value || undefined })}><option value="">角色主名称（{selectedCharacter?.name ?? '未选择'}）</option>{selectedCharacter?.displayNameSchemes?.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}</select></div><div className="field"><label>差分表情</label><select value={block.expression ?? selectedCharacter?.expressions[0] ?? ''} onChange={(e) => update({ expression: e.target.value })}>{selectedCharacter?.expressions.map((expression) => <option key={expression} value={expression}>{expression}{selectedCharacter.portraits?.[expression] ? '' : '（未配置图片）'}</option>)}</select></div><div className="field"><label>语音文件</label><select value={block.voice ?? ''} onChange={(e) => update({ voice: e.target.value || undefined })}><option value="">无语音</option>{voiceAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.asrText ? ` · ${asset.asrText.slice(0, 18)}` : ''}</option>)}</select></div><button className="button ghost full" type="button" onClick={autoMatchVoice}><Sparkles />按识别文本自动匹配</button></>}
    {(block.type === 'dialogue' || block.type === 'narration') && <div className="field full"><label>文本内容</label><textarea value={block.text ?? ''} onChange={(e) => update({ text: e.target.value })} /></div>}
    {block.type === 'scene' && <><div className="field full"><label>场景配置</label><select value={block.sceneId ?? sceneDefinitions.find((scene) => scene.layers.at(-1)?.assetId === block.assetId)?.id ?? ''} onChange={(e) => { const scene = sceneDefinitions.find((item) => item.id === e.target.value); if (scene) update(sceneBlockSnapshot(scene)); }}><option value="">未选择</option>{sceneDefinitions.map((scene) => <option key={scene.id} value={scene.id}>{scene.name} · {scene.layers.length}L</option>)}</select></div><div className="field"><label>过渡</label><select value={block.transition ?? 'dissolve'} onChange={(e) => update({ transition: e.target.value })}><option value="dissolve">交叉淡化</option><option value="fade">黑场</option><option value="none">硬切</option></select></div><div className="field"><label>时长</label><input type="number" min="0" step=".1" value={block.duration ?? 1} onChange={(e) => update({ duration: Number(e.target.value) })} /></div><div className="scene-layer-list"><label>场景图层快照</label>{(block.layers ?? []).map((layer, index) => <div className="scene-layer-row" key={layer.id}><input aria-label={`场景层 ${index + 1} 名称`} value={layer.name} readOnly /><select aria-label={`场景层 ${index + 1} 素材`} value={layer.assetId ?? ''} disabled><option value="">选择素材</option>{project.assets.filter((asset) => asset.kind === 'scene' || asset.kind === 'image').map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><input aria-label={`场景层 ${index + 1} 透明度`} title="透明度" type="number" value={layer.opacity} readOnly /><input aria-label={`场景层 ${index + 1} 距离`} title="距离" type="number" value={layer.distance ?? 1} readOnly /></div>)}<small className="control-help">图层、距离和偏移请在场景管理中编辑，所有引用会自动同步。</small></div></>}
    {block.type === 'sound' && <><div className="field"><label>通道</label><select value={block.channel ?? 'bgm'} onChange={(e) => update({ channel: e.target.value as 'bgm' | 'sfx' | 'voice', assetId: undefined, title: undefined })}><option value="bgm">BGM</option><option value="sfx">音效</option><option value="voice">语音</option></select></div><div className="field"><label>动作</label><select value={block.action ?? 'play'} onChange={(e) => update({ action: e.target.value as 'play' | 'stop' })}><option value="play">播放</option><option value="stop">停止</option></select></div>{(block.action ?? 'play') === 'play' && <div className="field full"><label>音频资源</label><select value={block.assetId ?? ''} onChange={(e) => { const asset = project.assets.find((item) => item.id === e.target.value); update({ assetId: asset?.id, title: asset?.name }); }}><option value="">选择音频</option>{soundAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.duration ? `${asset.duration.toFixed(1)}s` : '未知时长'}</option>)}</select></div>}<div className="field full"><label>音量 {Math.round((block.volume ?? 1) * 100)}%</label><input type="range" min="0" max="1" step=".01" value={block.volume ?? 1} onChange={(e) => update({ volume: Number(e.target.value) })} /></div><div className="field"><label>淡入淡出（秒）</label><input type="number" min="0" step=".1" value={block.fadeDuration ?? 0} onChange={(e) => update({ fadeDuration: Number(e.target.value) })} /></div><label className="checkbox-field"><input type="checkbox" checked={block.loop ?? false} onChange={(e) => update({ loop: e.target.checked })} />循环播放</label></>}
    {block.type === 'characterShow' && <><div className="field"><label>角色</label><select value={block.characterId ?? ''} onChange={(e) => { const character = project.characters.find((item) => item.id === e.target.value); const expression = character?.expressions[0] ?? '默认'; update({ characterId: e.target.value, expression, assetId: character?.portraits?.[expression] }); }}>{project.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></div><div className="field"><label>表情差分</label><select value={block.expression ?? ''} onChange={(e) => update({ expression: e.target.value, assetId: selectedCharacter?.portraits?.[e.target.value] })}>{selectedCharacter?.expressions.map((expression) => <option key={expression} value={expression}>{expression}</option>)}</select></div><div className="field full"><label>立绘素材</label><select value={block.assetId ?? selectedCharacter?.portraits?.[block.expression ?? '默认'] ?? ''} onChange={(e) => update({ assetId: e.target.value || undefined })}><option value="">使用角色表情配置</option>{project.assets.filter((asset) => asset.kind === 'character' || asset.kind === 'image').map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></div><div className="field"><label>站位</label><select value={block.position ?? 'center'} onChange={(e) => { const position = e.target.value as StoryBlockPatch['position']; update({ position, ...(position === 'custom' ? { x: block.x ?? 50, y: block.y ?? 100 } : { x: undefined, y: undefined }) }); }}><option value="farLeft">最左</option><option value="left">左</option><option value="center">中央</option><option value="right">右</option><option value="farRight">最右</option><option value="custom">自定义</option></select></div>{block.position === 'custom' && <><div className="field"><label>水平位置 X · %</label><input type="number" min="0" max="100" step="1" value={block.x ?? 50} onChange={(e) => update({ x: Math.max(0, Math.min(100, Number(e.target.value))) })} /></div><div className="field"><label>垂直位置 Y · %</label><input type="number" min="0" max="100" step="1" value={block.y ?? 100} onChange={(e) => update({ y: Math.max(0, Math.min(100, Number(e.target.value))) })} /></div></>}<div className="field"><label>入场动画</label><select value={block.animation ?? 'fade'} onChange={(e) => update({ animation: e.target.value as StoryBlockPatch['animation'] })}><option value="none">无</option><option value="fade">淡入</option><option value="slideLeft">从左滑入</option><option value="slideRight">从右滑入</option><option value="zoom">缩放</option></select></div><div className="field"><label>缩放</label><input type="number" min=".1" max="3" step=".1" value={block.scale ?? 1} onChange={(e) => update({ scale: Number(e.target.value) })} /></div><div className="field"><label>图层</label><input type="number" value={block.layer ?? 0} onChange={(e) => update({ layer: Number(e.target.value) })} /></div></>}
    {block.type === 'characterHide' && <><div className="field"><label>角色</label><select value={block.characterId ?? ''} onChange={(e) => update({ characterId: e.target.value })}>{project.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></div><div className="field"><label>退场动画</label><select value={block.animation ?? 'fade'} onChange={(e) => update({ animation: e.target.value as StoryBlockPatch['animation'] })}><option value="none">无</option><option value="fade">淡出</option><option value="slideLeft">向左滑出</option><option value="slideRight">向右滑出</option><option value="zoom">缩放</option></select></div></>}
    {block.type === 'camera' && <><div className="field"><label>水平偏移</label><input type="number" value={block.cameraX ?? 0} onChange={(e) => update({ cameraX: Number(e.target.value) })} /></div><div className="field"><label>垂直偏移</label><input type="number" value={block.cameraY ?? 0} onChange={(e) => update({ cameraY: Number(e.target.value) })} /></div><div className="field"><label>缩放</label><input type="number" min=".1" max="5" step=".1" value={block.zoom ?? 1} onChange={(e) => update({ zoom: Number(e.target.value) })} /></div><div className="field"><label>震动强度</label><input type="number" min="0" max="100" value={block.shake ?? 0} onChange={(e) => update({ shake: Number(e.target.value) })} /></div><div className="field full"><label>滤镜</label><select value={block.filter ?? 'none'} onChange={(e) => update({ filter: e.target.value as StoryBlockPatch['filter'] })}><option value="none">无</option><option value="monochrome">黑白</option><option value="sepia">怀旧</option><option value="blur">模糊</option><option value="vignette">暗角</option></select></div></>}
    {block.type === 'branch' && <><div className="field full"><label>问题</label><input value={block.title ?? ''} onChange={(e) => update({ title: e.target.value })} /></div>{block.options?.map((option, index) => <div className="branch-edit full" key={index}><input value={option.text} onChange={(e) => update({ options: block.options?.map((item, i) => i === index ? { ...item, text: e.target.value } : item) })} /><select value={option.target} onChange={(e) => update({ options: block.options?.map((item, i) => i === index ? { ...item, target: e.target.value } : item) })}>{fragmentOptions.map((fragment) => <option key={fragment.id} value={fragment.id}>{fragment.name}</option>)}</select><button className="icon-button" onClick={() => update({ options: block.options?.filter((_, i) => i !== index) })}><Trash2 /></button></div>)}<button className="button full" onClick={() => update({ options: [...(block.options ?? []), { text: '新选项', target: project.activeFragmentId }] })}><Plus />添加选项</button></>}
    {block.type === 'setVariable' && <><div className="field"><label>变量名</label><input value={block.variable ?? ''} onChange={(e) => update({ variable: e.target.value })} /></div><div className="field"><label>设置为</label><input value={String(block.value ?? '')} onChange={(e) => update({ value: e.target.value })} /></div></>}
    {block.type === 'condition' && <><div className="field"><label>变量名</label><input value={block.variable ?? ''} onChange={(e) => update({ variable: e.target.value })} /></div><div className="field"><label>比较方式</label><select value={block.operator ?? 'eq'} onChange={(e) => update({ operator: e.target.value as ConditionOperator })}><option value="eq">等于</option><option value="neq">不等于</option><option value="gt">大于</option><option value="gte">大于等于</option><option value="lt">小于</option><option value="lte">小于等于</option></select></div><div className="field full"><label>比较值</label><input value={String(block.compareValue ?? '')} onChange={(e) => update({ compareValue: e.target.value })} /></div><div className="field"><label>条件成立</label><select value={block.trueTarget ?? ''} onChange={(e) => update({ trueTarget: e.target.value || undefined })}><option value="">继续执行</option>{fragmentOptions.map((fragment) => <option key={fragment.id} value={fragment.id}>{fragment.name}</option>)}</select></div><div className="field"><label>条件不成立</label><select value={block.falseTarget ?? ''} onChange={(e) => update({ falseTarget: e.target.value || undefined })}><option value="">继续执行</option>{fragmentOptions.map((fragment) => <option key={fragment.id} value={fragment.id}>{fragment.name}</option>)}</select></div></>}
    {(block.type === 'jump' || block.type === 'call') && <div className="field full"><label>目标片段</label><select value={block.target ?? ''} onChange={(e) => update({ target: e.target.value })}>{fragmentOptions.map((fragment) => <option key={fragment.id} value={fragment.id}>{fragment.name}</option>)}</select></div>}
    {block.type === 'return' && <div className="control-help full">运行到这里时返回最近一次“调用片段”的下一条指令。</div>}
  </div></section>;
}

interface ScriptPageProps {
  project: Project;
  commit: (updater: (project: Project) => Project, label?: string) => void;
  selected: number;
  setSelected: (index: number) => void;
  view: View;
  setView: (view: View) => void;
  openBlocks: () => void;
  openImport: () => void;
  requestConfirm: RequestConfirm;
  openFragmentIds: string[];
  activateFragment: (id: string, blockIndex?: number) => void;
  closeFragment: (id: string) => void;
  reorderFragmentTabs: (fromId: string, toId: string) => void;
  inspectorDock: InspectorDock;
  setInspectorDock: (dock: InspectorDock) => void;
  initialScrollTop: number;
  saveScrollTop: (value: number) => void;
  debugRunning: boolean;
  notify: (message: string, tone?: 'error' | 'success') => void;
}

function ScriptPage({ project, commit, selected, setSelected, view, setView, openBlocks, openImport, requestConfirm, openFragmentIds, activateFragment, closeFragment, reorderFragmentTabs, inspectorDock, setInspectorDock, initialScrollTop, saveScrollTop, debugRunning, notify }: ScriptPageProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(() => new Set([selected]));
  const [selectionAnchor, setSelectionAnchor] = useState(selected);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [composerText, setComposerText] = useState('');
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [dialogueCharacterId, setDialogueCharacterId] = useState<string | null>(null);
  const [dialogueSchemeId, setDialogueSchemeId] = useState<string>('');
  const [droppedAssets, setDroppedAssets] = useState<Asset[]>([]);
  const [assetDropActive, setAssetDropActive] = useState(false);
  const dragSourceRef = useRef<number | null>(null);
  const dragTargetRef = useRef<number | null>(null);
  const blocksAreaRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimer = useRef(0);
  const blocks = project.scripts[project.activeFragmentId] ?? [];
  const selectedBlock = blocks[selected];
  const activeDialogueCharacter = project.characters.find((character) => character.id === dialogueCharacterId);
  useEffect(() => { blocksAreaRef.current?.querySelector<HTMLElement>(`[data-block-index="${selected}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [selected, blocks.length]);
  useEffect(() => { if (blocksAreaRef.current) blocksAreaRef.current.scrollTop = initialScrollTop; }, [project.activeFragmentId]);
  useEffect(() => { setSelectedIndexes(new Set(blocks.length ? [Math.min(selected, blocks.length - 1)] : [])); setSelectionAnchor(selected); setContextMenu(null); setDialogueCharacterId(null); setDialogueSchemeId(''); }, [project.activeFragmentId]);
  useEffect(() => { if (blocks.length && selected >= blocks.length) { const index = blocks.length - 1; setSelected(index); setSelectedIndexes(new Set([index])); setSelectionAnchor(index); } else if (!blocks.length && selectedIndexes.size) setSelectedIndexes(new Set()); }, [blocks.length, selected]);
  useEffect(() => { if (selected >= 0 && selected < blocks.length && !selectedIndexes.has(selected)) { setSelectedIndexes(new Set([selected])); setSelectionAnchor(selected); } }, [selected]);
  useEffect(() => { const close = () => setContextMenu(null); window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close); }, []);
  const updateBlock = (index: number, patch: StoryBlockPatch) => commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: current.scripts[current.activeFragmentId].map((item, i) => i === index ? { ...item, ...patch } as StoryBlock : item) } }));
  const selectBlock = (index: number, event?: Pick<ReactMouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => {
    setSelected(index);
    setSelectedIndexes((current) => {
      if (event?.shiftKey) {
        const next = new Set<number>();
        for (let value = Math.min(selectionAnchor, index); value <= Math.max(selectionAnchor, index); value += 1) next.add(value);
        return next;
      }
      if (event?.ctrlKey || event?.metaKey) {
        const next = new Set(current);
        if (next.has(index) && next.size > 1) next.delete(index); else next.add(index);
        setSelectionAnchor(index);
        return next;
      }
      setSelectionAnchor(index);
      return new Set([index]);
    });
  };
  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction; if (target < 0 || target >= blocks.length) return;
    commit((current) => { const next = [...current.scripts[current.activeFragmentId]]; [next[index], next[target]] = [next[target], next[index]]; return { ...current, scripts: { ...current.scripts, [current.activeFragmentId]: next } }; }); setSelected(target);
  };
  const reorderBlock = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return;
    commit((current) => {
      const next = [...current.scripts[current.activeFragmentId]];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...current, scripts: { ...current.scripts, [current.activeFragmentId]: next } };
    }, '拖动 Block 排序');
    setSelected(to);
    setSelectedIndexes(new Set([to]));
    setSelectionAnchor(to);
  };
  const beginPointerDrag = (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragSourceRef.current = index;
    dragTargetRef.current = index;
    setDraggedIndex(index);
    setDragOverIndex(index);
    selectBlock(index);
  };
  const updatePointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragSourceRef.current === null) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-block-index]');
    if (!target) return;
    const index = Number(target.dataset.blockIndex);
    if (!Number.isInteger(index)) return;
    dragTargetRef.current = index;
    setDragOverIndex(index);
  };
  const finishPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const from = dragSourceRef.current;
    const to = dragTargetRef.current;
    dragSourceRef.current = null;
    dragTargetRef.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);
    if (from !== null && to !== null) reorderBlock(from, to);
  };
  const orderedSelection = () => [...selectedIndexes].filter((index) => index >= 0 && index < blocks.length).sort((left, right) => left - right);
  const deleteSelected = async () => {
    const indexes = orderedSelection();
    if (!indexes.length || !await requestConfirm({ title: `删除 ${indexes.length} 个 Block`, message: '删除后可以通过撤销恢复。', confirmText: '删除', danger: true })) return;
    const removing = new Set(indexes);
    commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: current.scripts[current.activeFragmentId].filter((_, index) => !removing.has(index)) } }), `删除 ${indexes.length} 个 Block`);
    const nextIndex = Math.max(0, Math.min(indexes[0], blocks.length - indexes.length - 1));
    setSelected(nextIndex); setSelectedIndexes(new Set(blocks.length > indexes.length ? [nextIndex] : [])); setContextMenu(null);
  };
  const deleteBlock = async (index: number) => {
    if (selectedIndexes.has(index)) { await deleteSelected(); return; }
    if (!await requestConfirm({ title: '删除 Block', message: '删除后可以通过撤销恢复。', confirmText: '删除', danger: true })) return;
    commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: current.scripts[current.activeFragmentId].filter((_, itemIndex) => itemIndex !== index) } }), '删除 Block');
    const nextIndex = Math.max(0, Math.min(index, blocks.length - 2)); setSelected(nextIndex); setSelectedIndexes(new Set(blocks.length > 1 ? [nextIndex] : []));
  };
  const duplicateBlock = (index: number) => { commit((current) => { const next = [...current.scripts[current.activeFragmentId]]; next.splice(index + 1, 0, { ...clone(next[index]), id: makeId('block') }); return { ...current, scripts: { ...current.scripts, [current.activeFragmentId]: next } }; }); setSelected(index + 1); };
  const duplicateSelected = () => {
    const indexes = orderedSelection(); if (!indexes.length) return;
    const copies = indexes.map((index) => ({ ...clone(blocks[index]), id: makeId('block') } as StoryBlock));
    const insertion = indexes.at(-1)! + 1;
    commit((current) => { const next = [...current.scripts[current.activeFragmentId]]; next.splice(insertion, 0, ...copies); return { ...current, scripts: { ...current.scripts, [current.activeFragmentId]: next } }; }, `创建 ${copies.length} 个 Block 副本`);
    const nextIndexes = new Set(copies.map((_, offset) => insertion + offset)); setSelectedIndexes(nextIndexes); setSelected(insertion); setContextMenu(null);
  };
  const writeBlockClipboard = async (cut = false) => {
    const indexes = orderedSelection(); if (!indexes.length) return;
    const payload = `HIKARI_BLOCKS_V1\n${JSON.stringify(indexes.map((index) => blocks[index]))}`;
    writeSmallValue('hikari-block-clipboard', payload);
    try { await navigator.clipboard.writeText(payload); } catch { /* local fallback remains available */ }
    if (cut) await deleteSelected(); else setContextMenu(null);
  };
  const pasteBlocks = async () => {
    let payload = readSmallValue('hikari-block-clipboard') ?? '';
    try { payload = await navigator.clipboard.readText() || payload; } catch { /* use local fallback */ }
    if (!payload.startsWith('HIKARI_BLOCKS_V1\n')) return;
    try {
      const parsed = JSON.parse(payload.slice('HIKARI_BLOCKS_V1\n'.length)) as StoryBlock[];
      if (!Array.isArray(parsed) || !parsed.length) return;
      const copies = parsed.map((block) => ({ ...clone(block), id: makeId('block') } as StoryBlock));
      const insertion = selectedIndexes.size ? Math.max(...selectedIndexes) + 1 : blocks.length;
      commit((current) => { const next = [...current.scripts[current.activeFragmentId]]; next.splice(insertion, 0, ...copies); return { ...current, scripts: { ...current.scripts, [current.activeFragmentId]: next } }; }, `粘贴 ${copies.length} 个 Block`);
      setSelectedIndexes(new Set(copies.map((_, offset) => insertion + offset))); setSelected(insertion); setContextMenu(null);
    } catch { return; }
  };
  useEffect(() => {
    const handleClipboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input,textarea,select,[contenteditable="true"]')) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'c') { event.preventDefault(); void writeBlockClipboard(false); }
      if (event.key.toLowerCase() === 'x') { event.preventDefault(); void writeBlockClipboard(true); }
      if (event.key.toLowerCase() === 'v') { event.preventDefault(); void pasteBlocks(); }
    };
    window.addEventListener('keydown', handleClipboard); return () => window.removeEventListener('keydown', handleClipboard);
  }, [blocks, selectedIndexes]);
  const submitComposer = () => {
    const text = composerText.trim();
    if (!text) { if (dialogueCharacterId) setDialogueCharacterId(null); setComposerMenuOpen(false); return; }
    const block: StoryBlock = activeDialogueCharacter
      ? { id: makeId('block'), type: 'dialogue', speaker: activeDialogueCharacter.name, expression: activeDialogueCharacter.expressions[0] ?? '默认', displayNameSchemeId: dialogueSchemeId || undefined, text }
      : { id: makeId('block'), type: 'narration', text };
    const nextIndex = blocks.length;
    commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: [...current.scripts[current.activeFragmentId], block] } }), activeDialogueCharacter ? `添加 ${activeDialogueCharacter.name} 对白` : '添加旁白');
    setComposerText(''); setSelected(nextIndex); setSelectedIndexes(new Set([nextIndex])); setSelectionAnchor(nextIndex);
  };
  const insertComposerBlock = (type: BlockType) => {
    const block = createBlock(type, project); const nextIndex = blocks.length;
    commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: [...current.scripts[current.activeFragmentId], block] } }), `添加${blockMeta[type].name}`);
    setSelected(nextIndex); setSelectedIndexes(new Set([nextIndex])); setComposerMenuOpen(false);
  };
  const importDroppedAssets = async (files: FileList) => {
    setAssetDropActive(false);
    const paths = Array.from(files).map((file) => (file as File & { path?: string }).path).filter((path): path is string => Boolean(path));
    if (!paths.length) { notify('请在桌面版中拖入本地素材文件', 'error'); return; }
    try { const imported = await importAssets(paths); if (imported.length) setDroppedAssets(imported); }
    catch (error) { notify(String(error), 'error'); }
  };
  const applyDroppedAssets = (action: EditorImportAction) => {
    const imported = droppedAssets.map((asset) => asset.kind === 'audio' && action.kind === 'assetsOnly' ? { ...asset, audioCategory: action.audioCategory ?? 'bgm', asrStatus: action.audioCategory === 'voice' ? 'pending' as const : asset.asrStatus } : asset);
    commit((current) => {
      const next = clone(current);
      next.assets.push(...imported);
      const images = imported.filter((asset) => ['image', 'scene', 'character'].includes(asset.kind));
      if (action.kind === 'scenes') next.scenes = [...(next.scenes ?? []), ...images.map((asset) => ({ id: makeId('scene'), name: asset.name, layers: [{ id: makeId('layer'), name: '背景', assetId: asset.id, opacity: 1, blendMode: 'normal' as const, offsetX: 0, offsetY: 0, scale: 1, distance: 1 }] }))];
      else if (action.kind === 'characters') next.characters.push(...images.map((asset) => ({ id: makeId('character'), name: asset.name, color: '#397d70', expressions: ['默认'], portraits: { 默认: asset.id }, defaultScale: 1, defaultPosition: 'center' as const })));
      else if (action.kind === 'expressions') {
        const character = next.characters.find((item) => item.id === action.characterId);
        if (character) for (const asset of images) {
          let name = asset.name || '表情'; let suffix = 1;
          while (character.expressions.includes(name)) name = `${asset.name}_${suffix++}`;
          character.expressions.push(name);
          character.portraits = { ...(character.portraits ?? {}), [name]: asset.id };
        }
      }
      return next;
    }, action.kind === 'assetsOnly' ? `从剧本编辑器导入 ${imported.length} 个素材` : `导入素材并创建${action.kind === 'scenes' ? '场景' : action.kind === 'characters' ? '角色' : '表情'}`);
    setDroppedAssets([]); notify(`已导入 ${imported.length} 个素材，未插入剧情 Block`);
  };
  useEffect(() => {
    const area = blocksAreaRef.current;
    if (!area || view !== 'cards') return;
    const enter = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); setAssetDropActive(true); } };
    const over = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    const leave = (event: DragEvent) => { if (!area.contains(event.relatedTarget as Node | null)) setAssetDropActive(false); };
    const drop = (event: DragEvent) => { if (!event.dataTransfer?.files.length) return; event.preventDefault(); event.stopPropagation(); void importDroppedAssets(event.dataTransfer.files); };
    area.addEventListener('dragenter', enter); area.addEventListener('dragover', over); area.addEventListener('dragleave', leave); area.addEventListener('drop', drop);
    return () => { area.removeEventListener('dragenter', enter); area.removeEventListener('dragover', over); area.removeEventListener('dragleave', leave); area.removeEventListener('drop', drop); };
  }, [view, project.activeFragmentId]);
  useEffect(() => { blocksAreaRef.current?.classList.toggle('asset-drop-active', assetDropActive); }, [assetDropActive]);
  const activeName = project.chapters.flatMap((chapter) => chapter.fragments).find((fragment) => fragment.id === project.activeFragmentId)?.name ?? '片段';
  const fragmentNames = new Map(project.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => [fragment.id, fragment.name] as const)));
  const code = blocks.map((block) => block.type === 'dialogue' ? `${block.speaker} ${JSON.stringify(block.text)}` : block.type === 'narration' ? JSON.stringify(block.text) : block.type === 'scene' ? `scene ${block.title} with ${block.transition}` : block.type === 'sound' ? `play music ${JSON.stringify(block.title)}` : `menu ${JSON.stringify(block.title)}:`).join('\n');
  const references = Object.entries(project.scripts).flatMap(([fragmentId, script]) => script.flatMap((block, blockIndex) => {
    const matches: { fragmentId: string; blockIndex: number; kind: string; label: string }[] = [];
    if (block.type === 'branch' && block.options?.some((option) => option.target === project.activeFragmentId)) matches.push({ fragmentId, blockIndex, kind: '选项', label: block.title ?? '分支' });
    if (block.type === 'condition' && (block.trueTarget === project.activeFragmentId || block.falseTarget === project.activeFragmentId)) matches.push({ fragmentId, blockIndex, kind: '条件', label: block.variable ?? '条件判断' });
    if ((block.type === 'call' || block.type === 'jump') && block.target === project.activeFragmentId) matches.push({ fragmentId, blockIndex, kind: block.type === 'call' ? '调用' : '跳转', label: blockMeta[block.type].name });
    return matches;
  }));
  const moveStageCharacter = (characterId: string, x: number, y: number) => {
    let sourceIndex = -1;
    for (let index = Math.min(selected, blocks.length - 1); index >= 0; index -= 1) {
      const block = blocks[index];
      if (block.type === 'characterShow' && block.characterId === characterId) { sourceIndex = index; break; }
    }
    if (sourceIndex >= 0) {
      commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: current.scripts[current.activeFragmentId].map((block, index) => index === sourceIndex ? { ...block, position: 'custom', x, y } as StoryBlock : block) } }), '拖动角色立绘位置');
      setSelected(sourceIndex);
      setSelectedIndexes(new Set([sourceIndex]));
      notify(`角色位置已更新为 ${x.toFixed(0)}%, ${y.toFixed(0)}%`);
      return;
    }
    const character = project.characters.find((item) => item.id === characterId);
    if (!character) return;
    const currentBlock = blocks[selected];
    const expression = currentBlock?.type === 'dialogue' && (currentBlock.speaker === character.name || currentBlock.speaker === character.id)
      ? currentBlock.expression ?? character.expressions[0] ?? '默认'
      : character.expressions[0] ?? '默认';
    const showBlock: StoryBlock = { id: makeId('block'), type: 'characterShow', characterId, expression, assetId: character.portraits?.[expression], position: 'custom', x, y, scale: character.defaultScale ?? 1, opacity: 1, layer: character.defaultLayer ?? 0, animation: 'none', duration: 0 };
    const insertion = Math.max(0, selected);
    commit((current) => { const script = [...current.scripts[current.activeFragmentId]]; script.splice(insertion, 0, showBlock); return { ...current, scripts: { ...current.scripts, [current.activeFragmentId]: script } }; }, '创建可定位的角色立绘');
    setSelected(insertion);
    setSelectedIndexes(new Set([insertion]));
    notify('已创建“显示角色”Block并保存自定义位置');
  };
  const inspector = <><Inspector project={project} block={selectedBlock} update={(patch) => updateBlock(selected, patch)} dock={inspectorDock} setDock={setInspectorDock} notify={notify} />{droppedAssets.length > 0 && <EditorAssetImportDialog assets={droppedAssets} characters={project.characters} close={() => setDroppedAssets([])} apply={applyDroppedAssets} />}</>;
  return <div className={`editor-layout inspector-${inspectorDock}`}><section className="editor-pane"><div className="tabs-row">{openFragmentIds.map((fragmentId) => <button className={`doc-tab ${fragmentId === project.activeFragmentId ? 'active' : ''}`} draggable key={fragmentId} onDragStart={(event) => event.dataTransfer.setData('text/hikari-fragment', fragmentId)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const fromId = event.dataTransfer.getData('text/hikari-fragment'); if (fromId) reorderFragmentTabs(fromId, fragmentId); }} onClick={() => activateFragment(fragmentId)}><FileText /><span>{fragmentNames.get(fragmentId) ?? fragmentId}</span><span className="tab-close" role="button" aria-label={`关闭 ${fragmentNames.get(fragmentId) ?? fragmentId}`} onClick={(event) => { event.stopPropagation(); closeFragment(fragmentId); }}><X /></span></button>)}</div><div className="editor-toolbar"><div className="editor-title"><strong>{activeName}</strong><small>{blocks.length} Blocks</small></div><button className="button ghost" onClick={openImport}><FileUp /> 导入剧本</button><div className="view-switch">{([['cards', '卡片'], ['plain', '纯文本'], ['code', "Ren'Py"], ['json', 'JSON']] as [View, string][]).map(([key, name]) => <button key={key} className={`view-button ${view === key ? 'active' : ''}`} onClick={() => setView(key)}>{name}</button>)}</div></div>
    {references.length > 0 && <div className="fragment-references"><strong>此片段被 {references.length} 处引用</strong><div>{references.map((reference) => <button key={`${reference.fragmentId}-${reference.blockIndex}-${reference.kind}`} onClick={() => { activateFragment(reference.fragmentId); setSelected(reference.blockIndex); }}>{reference.kind} · {fragmentNames.get(reference.fragmentId) ?? reference.fragmentId}<span>前往</span></button>)}</div></div>}
    {view === 'cards' && <div className="blocks-area" ref={blocksAreaRef} tabIndex={0} onScroll={(event) => { window.clearTimeout(scrollSaveTimer.current); const value = event.currentTarget.scrollTop; scrollSaveTimer.current = window.setTimeout(() => saveScrollTop(value), 350); }} onWheel={(event) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.scrollTop += event.deltaY; }}>{blocks.map((block, index) => <div key={block.id} data-block-index={index} className={`block-drop-target ${dragOverIndex === index && draggedIndex !== index ? 'drag-over' : ''}`}><StoryCard project={project} block={block} selected={selectedIndexes.has(index)} asset={project.assets.find((asset) => asset.id === block.assetId)} onSelect={(event) => selectBlock(index, event)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!selectedIndexes.has(index)) selectBlock(index); setContextMenu({ x: event.clientX, y: event.clientY }); }} onChange={(patch) => updateBlock(index, patch)} onMove={(direction) => moveBlock(index, direction)} onDuplicate={() => duplicateBlock(index)} onDelete={() => void deleteBlock(index)} dragging={draggedIndex === index} onPointerDown={(event) => beginPointerDrag(index, event)} onPointerMove={updatePointerDrag} onPointerUp={finishPointerDrag} /><div className="insert-row"><button className="insert-button" title="插入 Block" onClick={openBlocks}><Plus /></button></div></div>)}<div className={`quick-composer ${activeDialogueCharacter ? 'dialogue-mode' : ''}`}><div className="composer-prefix">{activeDialogueCharacter ? activeDialogueCharacter.name : <AlignLeft />}</div><textarea aria-label={activeDialogueCharacter ? `${activeDialogueCharacter.name} 连续对话` : '输入旁白'} value={composerText} placeholder={activeDialogueCharacter ? `${activeDialogueCharacter.name} 的对白` : '输入旁白'} onChange={(event) => setComposerText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); setComposerMenuOpen(true); } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitComposer(); } }} />{dialogueCharacterId && <button className="icon-button" title="退出连续对话" onClick={() => { setDialogueCharacterId(null); setDialogueSchemeId(''); }}><X /></button>}{composerMenuOpen && <div className="composer-menu"><strong>插入 Block</strong><div className="composer-menu-grid">{(['scene', 'sound', 'characterShow', 'camera', 'branch', 'condition'] as BlockType[]).map((type) => { const MetaIcon = blockMeta[type].icon; return <button key={type} onClick={() => insertComposerBlock(type)}><MetaIcon />{blockMeta[type].name}</button>; })}</div><strong>连续对话角色</strong><div className="composer-characters">{project.characters.map((character) => <button key={character.id} onClick={() => { setDialogueCharacterId(character.id); setDialogueSchemeId(''); }}>{character.name}</button>)}</div>{activeDialogueCharacter && <><strong>显示名方案</strong><div className="composer-characters"><button className={!dialogueSchemeId ? 'active' : ''} onClick={() => { setDialogueSchemeId(''); setComposerMenuOpen(false); }}>主名称</button>{activeDialogueCharacter.displayNameSchemes?.map((scheme) => <button className={dialogueSchemeId === scheme.id ? 'active' : ''} key={scheme.id} onClick={() => { setDialogueSchemeId(scheme.id); setComposerMenuOpen(false); }}>{scheme.name}</button>)}</div></>}<button className="composer-menu-close" onClick={() => setComposerMenuOpen(false)}>关闭</button></div>}</div></div>}
    {view === 'plain' && <div className="plain-script-editor">{blocks.map((block, index) => { const previous = blocks[index - 1]; const grouped = block.type === 'dialogue' && previous?.type === 'dialogue' && previous.speaker === block.speaker; return <div className={`plain-block-row ${selectedIndexes.has(index) ? 'selected' : ''} ${grouped ? 'grouped' : ''}`} key={block.id} onClick={(event) => selectBlock(index, event)} onContextMenu={(event) => { event.preventDefault(); if (!selectedIndexes.has(index)) selectBlock(index); setContextMenu({ x: event.clientX, y: event.clientY }); }}><span className="plain-block-kind">{block.type === 'dialogue' ? grouped ? '' : block.speaker : blockMeta[block.type].name}</span><div>{(block.type === 'dialogue' || block.type === 'narration') ? <><textarea defaultValue={block.text ?? ''} onBlur={(event) => updateBlock(index, { text: event.target.value })} /><small>{block.type === 'dialogue' ? block.expression : ''}</small></> : block.type === 'branch' ? <><strong>分支 · {block.options?.length ?? 0} 个选项</strong>{block.options?.map((option) => <small className="plain-branch-option" key={option.text}>├ {option.text} → {fragmentNames.get(option.target) ?? option.target}</small>)}</> : <span className="plain-instruction">{block.title ?? block.text ?? (block.type === 'condition' ? `${block.variable} ${block.operator} ${String(block.compareValue ?? '')}` : block.type === 'setVariable' ? `${block.variable} = ${String(block.value ?? '')}` : block.target ? `→ ${fragmentNames.get(block.target) ?? block.target}` : blockMeta[block.type].description)}</span>}</div></div>; })}</div>}
    {view === 'code' && <pre className="code-editor">{code || '# empty fragment'}</pre>}{view === 'json' && <pre className="json-editor">{JSON.stringify(blocks, null, 2)}</pre>}
    {contextMenu && <div className="context-menu block-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}><strong>已选择 {selectedIndexes.size} 个 Block</strong><button onClick={() => void writeBlockClipboard(false)}>复制</button><button onClick={() => void writeBlockClipboard(true)}>剪切</button><button onClick={duplicateSelected}>创建副本</button><button onClick={() => void pasteBlocks()}>粘贴到下方</button><button className="danger" onClick={() => void deleteSelected()}>删除</button></div>}
    {inspectorDock === 'editor' && inspector}
  </section><section className="preview-inspector"><Preview project={project} editorIndex={selected} debugMode={debugRunning} onEditorLocationChange={activateFragment} onStageCharacterMove={moveStageCharacter} />{inspectorDock === 'preview' && inspector}</section>{inspectorDock === 'floating' && <div className="floating-inspector">{inspector}</div>}</div>;
}

function PageHeader({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{sub}</p></div><div className="page-header-actions">{children}</div></div>;
}

function AssetsPage({ project, importing, commit, notify, requestConfirm, section }: { project: Project; importing: () => void; commit: (updater: (project: Project) => Project, label?: string) => void; notify: (message: string, tone?: 'error' | 'success') => void; requestConfirm: RequestConfirm; section: string }) {
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  useEffect(() => setFilter(section), [section]);
  const kinds: Record<string, string> = { 场景: 'scene', 音频: 'audio', 视频: 'video' };
  const report = analyzeAssetReferences(project);
  const filterAssets = filter === '全部' ? project.assets : filter === '未使用' ? project.assets.filter((asset) => !report.references[asset.id]?.length) : filter === '强制打包' ? project.assets.filter((asset) => asset.forceBundle) : ['BGM', 'SE', '语音'].includes(filter) ? project.assets.filter((asset) => asset.kind === 'audio') : project.assets.filter((asset) => asset.kind === kinds[filter]);
  const shown = filterAssets.filter((asset) => asset.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const size = project.assets.reduce((total, asset) => total + (asset.size ?? 0), 0);
  const selectedAsset = project.assets.find((asset) => asset.id === selectedAssetId);
  const remove = async (asset: Asset) => { const count = report.references[asset.id]?.length ?? 0; if (count) { notify(`${asset.name} 仍被 ${count} 处内容引用，无法删除`, 'error'); return; } if (!await requestConfirm({ title: '删除素材', message: `从项目中删除素材“${asset.name}”？`, confirmText: '删除', danger: true })) return; commit((current) => ({ ...current, assets: current.assets.filter((item) => item.id !== asset.id) }), `删除素材 ${asset.name}`); };
  const play = (asset: Asset) => { if (!asset.uri) { notify('素材没有可试听的本地地址', 'error'); return; } const audio = new Audio(asset.uri); void audio.play().catch((error) => notify(String(error), 'error')); };
  return <div className="dashboard-page"><PageHeader title="素材引用与打包" sub="追踪角色、场景和剧本引用；构建时仅收集已引用或强制打包的素材"><button className="button primary" onClick={importing}><FileUp />导入素材</button></PageHeader><div className="content-pad"><div className="stats-row"><div className="stat"><span>全部素材</span><strong>{project.assets.length}</strong><small>{(size / 1024 / 1024).toFixed(1)} MB 已登记</small></div><div className="stat"><span>预计打包</span><strong>{report.bundledIds.size}</strong><small>{(report.bundledSize / 1024 / 1024).toFixed(1)} MB</small></div><div className="stat"><span>缺失引用</span><strong>{report.missing.length}</strong><small>构建前必须处理</small></div><div className="stat"><span>未使用</span><strong>{project.assets.filter((asset) => !report.references[asset.id]?.length).length}</strong><small>不会默认打包</small></div></div>{report.missing.length > 0 && <div className="asset-missing-banner">检测到 {report.missing.length} 个缺失素材引用：{report.missing.slice(0, 3).map((item) => `${item.sourceName} · ${item.detail}`).join('、')}</div>}{selectedAsset && <section className="asset-reference-panel"><header><strong>{selectedAsset.name} · 引用位置</strong><small>{report.references[selectedAsset.id]?.length ?? 0} 处引用 · {selectedAsset.forceBundle ? '强制打包' : report.bundledIds.has(selectedAsset.id) ? '随引用打包' : '不会打包'}</small><button className="icon-button" title="关闭引用详情" onClick={() => setSelectedAssetId(null)}><X /></button></header><div className="asset-reference-list">{(report.references[selectedAsset.id] ?? []).map((reference) => <button key={`${reference.sourceId}-${reference.detail}`} onClick={() => notify(`${reference.sourceName} · ${reference.detail}`)}><strong>{reference.sourceName}</strong><span>{reference.detail}</span><small>{reference.sourceType === 'character' ? '角色' : `Block ${(reference.blockIndex ?? 0) + 1}`}</small></button>)}{!report.references[selectedAsset.id]?.length && <span>当前没有直接引用；开启强制打包后仍会进入构建产物。</span>}</div></section>}<div className="filterbar"><div className="asset-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材" /></div>{['全部', '场景', '音频', '视频', '未使用', '强制打包'].map((item) => <button className={`button ${filter === item ? 'primary' : 'ghost'}`} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div><div className="asset-grid">{shown.map((asset) => { const count = report.references[asset.id]?.length ?? 0; return <article className={`asset-card ${selectedAssetId === asset.id ? 'selected' : ''}`} key={asset.id} onClick={() => setSelectedAssetId(asset.id)}><div className="asset-preview">{asset.kind === 'scene' || asset.kind === 'image' || asset.kind === 'character' ? <img src={asset.uri} alt={asset.name} /> : <button className="asset-audio" title="试听" onClick={(event) => { event.stopPropagation(); play(asset); }}><AudioLines /></button>}<span className="asset-kind">{asset.kind}</span>{!count && <span className="asset-unused">未使用</span>}</div><div className="asset-info"><input className="inline-name" defaultValue={asset.name} onClick={(event) => event.stopPropagation()} onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== asset.name) commit((current) => ({ ...current, assets: current.assets.map((item) => item.id === asset.id ? { ...item, name } : item) }), `重命名素材 ${asset.name}`); }} /><small>{count} 处引用 · {asset.size ? `${(asset.size / 1024).toFixed(0)} KB` : '内置素材'}</small><label className="asset-bundle-toggle" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={asset.forceBundle ?? false} onChange={(event) => commit((current) => ({ ...current, assets: current.assets.map((item) => item.id === asset.id ? { ...item, forceBundle: event.target.checked } : item) }), `${event.target.checked ? '强制打包' : '取消强制打包'} ${asset.name}`)} />强制打包</label><button className="asset-delete" title="删除素材" onClick={(event) => { event.stopPropagation(); void remove(asset); }}><Trash2 /></button></div></article>; })}</div>{!shown.length && <div className="empty-state large"><Image /><strong>没有匹配的素材</strong><span>调整搜索条件或导入新素材</span></div>}</div></div>;
}

type MapEdge = { id: string; source: string; target: string; label: string; kind: 'branch' | 'condition' | 'jump' | 'call'; blockId: string; slot?: 'true' | 'false'; optionIndex?: number };

function MapPage({ project, activate, commit, notify, requestText }: { project: Project; activate: (id: string) => void; commit: (updater: (project: Project) => Project, label?: string) => void; notify: (message: string, tone?: 'error' | 'success') => void; requestText: RequestText }) {
  const fragments = project.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => ({ ...fragment, chapter: chapter.name })));
  const defaultPositions = Object.fromEntries(fragments.map((fragment, index) => [fragment.id, { x: 90 + (index % 4) * 270, y: 90 + Math.floor(index / 4) * 190 }]));
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => ({ ...defaultPositions, ...(project.settings.narrativeMap?.positions ?? {}) }));
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [wireDraft, setWireDraft] = useState<{ source: string; x: number; y: number } | null>(null);
  const [wireTargetId, setWireTargetId] = useState<string | null>(null);
  const positionsRef = useRef(positions);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const nodeDragRef = useRef<{ pointerId: number; fragmentId: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const wireRef = useRef<{ pointerId: number; source: string } | null>(null);

  useEffect(() => { setPositions((current) => { const next = Object.fromEntries(fragments.map((fragment, index) => [fragment.id, current[fragment.id] ?? project.settings.narrativeMap?.positions?.[fragment.id] ?? { x: 90 + (index % 4) * 270, y: 90 + Math.floor(index / 4) * 190 }])); positionsRef.current = next; return next; }); }, [project.chapters]);

  const allEdges: MapEdge[] = [];
  for (const [source, blocks] of Object.entries(project.scripts)) for (const block of blocks) {
    if (block.type === 'branch') (block.options ?? []).forEach((option, optionIndex) => allEdges.push({ id: `${block.id}-option-${optionIndex}`, source, target: option.target, label: option.text, kind: 'branch', blockId: block.id, optionIndex }));
    else if (block.type === 'condition') { allEdges.push({ id: `${block.id}-true`, source, target: block.trueTarget ?? '', label: '成立', kind: 'condition', blockId: block.id, slot: 'true' }); allEdges.push({ id: `${block.id}-false`, source, target: block.falseTarget ?? '', label: '否则', kind: 'condition', blockId: block.id, slot: 'false' }); }
    else if (block.type === 'jump' || block.type === 'call') allEdges.push({ id: block.id, source, target: block.target ?? '', label: block.type === 'call' ? '调用' : '跳转', kind: block.type, blockId: block.id });
  }
  const edges = allEdges.filter((edge) => Boolean(edge.target && positions[edge.source] && positions[edge.target]));

  const toCanvasPoint = (clientX: number, clientY: number) => { const rect = canvasRef.current?.getBoundingClientRect(); return { x: ((clientX - (rect?.left ?? 0)) - viewport.x) / viewport.scale, y: ((clientY - (rect?.top ?? 0)) - viewport.y) / viewport.scale }; };
  const edgePath = (sourceId: string, targetX: number, targetY: number) => { const source = positions[sourceId]; const x1 = source.x + 210; const y1 = source.y + 54; const bend = Math.max(65, Math.abs(targetX - x1) * .45); return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`; };
  const findWireTarget = (clientX: number, clientY: number) => {
    let closestId: string | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const port of document.querySelectorAll<HTMLElement>('.node-port.in[data-fragment-id]')) {
      const rect = port.getBoundingClientRect();
      const distance = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
      const id = port.dataset.fragmentId;
      if (id && distance <= 34 && distance < closestDistance) { closestId = id; closestDistance = distance; }
    }
    return closestId;
  };
  const persistPositions = (next: Record<string, { x: number; y: number }>, label = '移动叙事地图节点') => commit((current) => ({ ...current, settings: { ...current.settings, narrativeMap: { positions: next } } }), label);
  const zoom = (delta: number) => setViewport((current) => ({ ...current, scale: Math.max(.4, Math.min(2, Number((current.scale + delta).toFixed(2)))) }));

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => { if ((event.target as HTMLElement).closest('.node,.map-path')) return; event.currentTarget.setPointerCapture(event.pointerId); panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: viewport.x, originY: viewport.y }; setSelectedEdgeId(null); };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => { const pan = panRef.current; if (!pan || pan.pointerId !== event.pointerId) return; setViewport((current) => ({ ...current, x: pan.originX + event.clientX - pan.startX, y: pan.originY + event.clientY - pan.startY })); };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); panRef.current = null; };

  const beginNodeDrag = (fragmentId: string, event: ReactPointerEvent<HTMLDivElement>) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); const position = positions[fragmentId]; nodeDragRef.current = { pointerId: event.pointerId, fragmentId, startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y }; };
  const moveNode = (event: ReactPointerEvent<HTMLDivElement>) => { event.stopPropagation(); const drag = nodeDragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; setPositions((current) => { const next = { ...current, [drag.fragmentId]: { x: Math.max(20, Math.round(drag.originX + (event.clientX - drag.startX) / viewport.scale)), y: Math.max(20, Math.round(drag.originY + (event.clientY - drag.startY) / viewport.scale)) } }; positionsRef.current = next; return next; }); };
  const endNodeDrag = (event: ReactPointerEvent<HTMLDivElement>) => { event.stopPropagation(); const drag = nodeDragRef.current; if (!drag) return; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); nodeDragRef.current = null; persistPositions(positionsRef.current); };

  const connectFragments = (source: string, target: string) => {
    if (source === target) { notify('不能把节点输出连接到自身', 'error'); return; }
    commit((current) => {
      const blocks = [...(current.scripts[source] ?? [])];
      const terminal = blocks.at(-1);
      if (terminal?.type === 'branch') blocks[blocks.length - 1] = { ...terminal, options: [...(terminal.options ?? []), { text: `前往 ${target}`, target }] };
      else if (terminal?.type === 'condition' && !terminal.trueTarget) blocks[blocks.length - 1] = { ...terminal, trueTarget: target };
      else if (terminal?.type === 'condition' && !terminal.falseTarget) blocks[blocks.length - 1] = { ...terminal, falseTarget: target };
      else if (terminal?.type === 'jump') blocks[blocks.length - 1] = { ...terminal, target };
      else blocks.push({ id: makeId('block'), type: 'jump', version: 1, target });
      return { ...current, scripts: { ...current.scripts, [source]: blocks } };
    }, `连接叙事节点 ${source} → ${target}`);
    notify(`已连接 ${source} → ${target}`);
  };
  const beginWire = (source: string, event: ReactPointerEvent<HTMLButtonElement>) => { event.stopPropagation(); wireRef.current = { pointerId: event.pointerId, source }; const point = toCanvasPoint(event.clientX, event.clientY); setWireTargetId(null); setWireDraft({ source, ...point }); };

  useEffect(() => {
    const moveWire = (event: PointerEvent) => {
      const wire = wireRef.current;
      if (!wire || wire.pointerId !== event.pointerId) return;
      const point = toCanvasPoint(event.clientX, event.clientY);
      setWireTargetId(findWireTarget(event.clientX, event.clientY));
      setWireDraft({ source: wire.source, ...point });
    };
    const endWire = (event: PointerEvent) => {
      const wire = wireRef.current;
      if (!wire || wire.pointerId !== event.pointerId) return;
      const target = findWireTarget(event.clientX, event.clientY);
      wireRef.current = null;
      setWireDraft(null);
      setWireTargetId(null);
      if (target) connectFragments(wire.source, target);
    };
    window.addEventListener('pointermove', moveWire);
    window.addEventListener('pointerup', endWire);
    window.addEventListener('pointercancel', endWire);
    return () => { window.removeEventListener('pointermove', moveWire); window.removeEventListener('pointerup', endWire); window.removeEventListener('pointercancel', endWire); };
  });

  const detachEdge = () => { const edge = edges.find((item) => item.id === selectedEdgeId); if (!edge) return; commit((current) => ({ ...current, scripts: { ...current.scripts, [edge.source]: current.scripts[edge.source].flatMap((block) => { if (block.id !== edge.blockId) return [block]; if (block.type === 'branch') return [{ ...block, options: block.options?.filter((_, index) => index !== edge.optionIndex) }]; if (block.type === 'condition') return [{ ...block, [edge.slot === 'true' ? 'trueTarget' : 'falseTarget']: undefined }]; return []; }) } }), `拆除连线 ${edge.source} → ${edge.target}`); setSelectedEdgeId(null); notify('连线已拆除'); };
  const addNode = async () => { const name = await requestText({ title: '添加叙事模块', message: '新模块会添加到当前章节，并放置在画布中心。', placeholder: `新片段 ${fragments.length + 1}`, confirmText: '添加模块' }); if (!name) return; const id = makeId('fragment'); const activeChapter = project.chapters.find((chapter) => chapter.fragments.some((fragment) => fragment.id === project.activeFragmentId)) ?? project.chapters[0]; const center = toCanvasPoint((canvasRef.current?.getBoundingClientRect().left ?? 0) + (canvasRef.current?.clientWidth ?? 800) / 2, (canvasRef.current?.getBoundingClientRect().top ?? 0) + (canvasRef.current?.clientHeight ?? 600) / 2); const nextPositions = { ...positions, [id]: { x: Math.round(center.x - 105), y: Math.round(center.y - 54) } }; setPositions(nextPositions); commit((current) => ({ ...current, chapters: current.chapters.map((chapter) => chapter.id === activeChapter.id ? { ...chapter, fragments: [...chapter.fragments, { id, name }] } : chapter), scripts: { ...current.scripts, [id]: [] }, settings: { ...current.settings, narrativeMap: { positions: nextPositions } } }), `新增叙事节点 ${name}`); notify(`已新增片段模块“${name}”`); };
  const locateActive = () => { const position = positions[project.activeFragmentId]; if (position) setViewport((current) => ({ ...current, x: -position.x * current.scale + 300, y: -position.y * current.scale + 180 })); };

  useEffect(() => { const remove = (event: KeyboardEvent) => { if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) detachEdge(); }; window.addEventListener('keydown', remove); return () => window.removeEventListener('keydown', remove); }, [selectedEdgeId, edges]);

  return <div className="dashboard-page map-page"><PageHeader title="叙事蓝图" sub={`${fragments.length} 个模块 · ${edges.length} 条连接 · 拖动端口创建流程`}><button className="button primary" onClick={addNode}><Plus />添加模块</button><button className="button danger" disabled={!selectedEdgeId} onClick={detachEdge}><Trash2 />拆除连线</button><div className="map-zoom"><button className="icon-button" title="缩小" onClick={() => zoom(-.1)}><Minus /></button><span>{Math.round(viewport.scale * 100)}%</span><button className="icon-button" title="放大" onClick={() => zoom(.1)}><Plus /></button></div><button className="button ghost" onClick={locateActive}><LocateFixed />当前节点</button><button className="button ghost" onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}><Maximize2 />复位画布</button></PageHeader><div className="map-canvas blueprint-canvas" ref={canvasRef} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}><div className="map-viewport" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}><div className="map-inner blueprint-inner"><svg className="map-lines" width="2400" height="1400"><defs><marker id="map-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" /></marker></defs>{edges.map((edge) => { const target = positions[edge.target]; const path = edgePath(edge.source, target.x, target.y + 54); return <g key={edge.id} className={selectedEdgeId === edge.id ? 'selected' : ''} onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); }}><path className="map-path-hit" d={path} /><path className={`map-path ${edge.kind}`} d={path} markerEnd="url(#map-arrow)" /><text x={(positions[edge.source].x + 210 + target.x) / 2} y={(positions[edge.source].y + target.y) / 2 + 42}>{edge.label}</text></g>; })}{wireDraft && <path className="map-path draft" d={edgePath(wireDraft.source, wireDraft.x, wireDraft.y)} />}</svg>{fragments.map((fragment) => { const outgoing = edges.filter((edge) => edge.source === fragment.id).length; const incoming = edges.filter((edge) => edge.target === fragment.id).length; return <article className={`node blueprint-node ${fragment.id === project.activeFragmentId ? 'active' : ''}`} style={{ left: positions[fragment.id].x, top: positions[fragment.id].y }} key={fragment.id} onDoubleClick={() => activate(fragment.id)}><button className={`node-port in ${wireTargetId === fragment.id ? 'snap-target' : ''}`} data-fragment-id={fragment.id} title={`连接到 ${fragment.name}`} aria-label={`连接到 ${fragment.name}`} /><div className="node-header" onPointerDown={(event) => beginNodeDrag(fragment.id, event)} onPointerMove={moveNode} onPointerUp={endNodeDrag} onPointerCancel={endNodeDrag}><GripVertical /><GitBranch /><span>{fragment.name}</span></div><div className="node-body"><span>{fragment.chapter}</span><strong>{project.scripts[fragment.id]?.length ?? 0} Blocks</strong><small>{incoming} 输入 · {outgoing} 输出</small></div><button className="node-port out" title={`从 ${fragment.name} 创建连线`} aria-label={`从 ${fragment.name} 创建连线`} onPointerDown={(event) => beginWire(fragment.id, event)} /></article>; })}</div></div></div></div>;
}

function CharactersPage({ project, commit, notify, requestText, requestConfirm }: { project: Project; commit: (updater: (project: Project) => Project, label?: string) => void; notify: (message: string, tone?: 'error' | 'success') => void; requestText: RequestText; requestConfirm: RequestConfirm }) {
  const add = async () => { const name = await requestText({ title: '新增角色', message: '输入角色在剧本和游戏中显示的名称。', placeholder: '角色名称', confirmText: '创建角色' }); if (!name) return; commit((current) => ({ ...current, characters: [...current.characters, { id: makeId('character'), name, color: '#3478c5', expressions: ['默认'], portraits: {} }] })); };
  const references = (name: string) => Object.values(project.scripts).flat().filter((block) => block.speaker === name).length;
  const remove = async (id: string, name: string) => { const count = references(name); if (count) { notify(`${name} 仍被 ${count} 条对白引用，无法删除`, 'error'); return; } if (await requestConfirm({ title: '删除角色', message: `删除角色“${name}”？`, confirmText: '删除', danger: true })) commit((current) => ({ ...current, characters: current.characters.filter((item) => item.id !== id) }), `删除角色 ${name}`); };
  const importPortrait = async (characterId: string, characterName: string, expression: string) => {
    try {
      const imported = await importAssets();
      if (!imported.length) return;
      const portraits = imported.map((asset) => ({ ...asset, kind: 'character' }));
      commit((current) => ({ ...current, assets: [...current.assets, ...portraits], characters: current.characters.map((item) => item.id === characterId ? { ...item, portraits: { ...(item.portraits ?? {}), [expression]: portraits[0].id } } : item) }), `导入 ${characterName} · ${expression} 立绘`);
      notify(`已为“${characterName} · ${expression}”配置 ${portraits[0].name}`);
    } catch (error) { notify(String(error), 'error'); }
  };
  const imageAssets = project.assets.filter((asset) => ['character', 'image', 'scene'].includes(asset.kind));
  return <div className="dashboard-page"><PageHeader title="角色与立绘" sub="每个表情使用一张独立图片；对白会自动加载并切换对应立绘"><button className="button primary" onClick={add}><UserPlus />新建角色</button></PageHeader><div className="content-pad"><div className="character-grid">{project.characters.map((character) => {
    const portraitId = character.portraits?.[character.expressions[0]];
    const portraitAsset = project.assets.find((asset) => asset.id === portraitId);
    const assignedIds = character.expressions.map((expression) => character.portraits?.[expression]).filter(Boolean);
    const incomplete = assignedIds.length !== character.expressions.length || new Set(assignedIds).size !== assignedIds.length;
    return <article className={`character-card ${incomplete ? 'incomplete' : ''}`} key={character.id}><div className="character-portrait">{portraitAsset?.uri ? <img src={portraitAsset.uri} alt={`${character.name} · ${character.expressions[0]}`} /> : <div className="mini-person" style={{ background: character.color }} />}</div><div className="character-fields"><div className="field"><label>显示名 · {references(character.name)} 处引用</label><input defaultValue={character.name} onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== character.name) commit((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, name } : item), scripts: Object.fromEntries(Object.entries(current.scripts).map(([fragmentId, blocks]) => [fragmentId, blocks.map((block) => block.speaker === character.name ? { ...block, speaker: name } : block)])) }), `重命名角色 ${character.name}`); }} /></div><div className="field"><label>角色颜色</label><input type="color" value={character.color} onChange={(event) => commit((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, color: event.target.value } : item) }), `修改角色颜色 ${character.name}`)} /></div><div className="field full"><label>表情列表（用逗号分隔）</label><input defaultValue={character.expressions.join(', ')} onBlur={(event) => { const expressions = [...new Set(event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))]; if (expressions.length) commit((current) => ({ ...current, characters: current.characters.map((item) => { if (item.id !== character.id) return item; const portraits = Object.fromEntries(Object.entries(item.portraits ?? {}).filter(([expression]) => expressions.includes(expression))); return { ...item, expressions, portraits }; }) }), `更新角色表情 ${character.name}`); }} /></div><div className="expression-assets"><div className="expression-assets-heading"><label>表情差分素材</label>{incomplete && <small>仍有表情未配置独立图片</small>}</div>{character.expressions.map((expression) => {
      const selectedId = character.portraits?.[expression] ?? '';
      const expressionAsset = project.assets.find((asset) => asset.id === selectedId);
      return <div className={`expression-asset-row ${selectedId ? '' : 'missing'}`} key={expression}><div className="expression-thumb">{expressionAsset?.uri ? <img src={expressionAsset.uri} alt={`${character.name} · ${expression}`} /> : <Image />}</div><span>{expression}</span><select aria-label={`${character.name} ${expression} 立绘`} value={selectedId} onChange={(event) => commit((current) => ({ ...current, characters: current.characters.map((item) => { if (item.id !== character.id) return item; const portraits = { ...(item.portraits ?? {}) }; if (event.target.value) portraits[expression] = event.target.value; else delete portraits[expression]; return { ...item, portraits }; }) }), `设置 ${character.name} · ${expression} 立绘`)}><option value="">未配置</option>{imageAssets.map((asset) => <option disabled={asset.id !== selectedId && assignedIds.includes(asset.id)} key={asset.id} value={asset.id}>{asset.name}</option>)}</select><button className="icon-button" title={`导入 ${character.name} · ${expression} 立绘`} onClick={() => void importPortrait(character.id, character.name, expression)}><FileUp /></button></div>;
    })}</div></div><button className="icon-button character-delete" title="删除角色" onClick={() => void remove(character.id, character.name)}><Trash2 /></button></article>;
  })}</div></div></div>;
}

function SnapshotDiff({ diff }: { diff: ProjectDiff }) {
  if (!diff.total) return <div className="snapshot-identical"><CheckCircle2 /><span>两个快照内容一致</span></div>;
  return <div className="snapshot-diff-grid">{diff.categories.map((category) => <article key={category.id}><header><strong>{category.label}</strong><div>{category.added > 0 && <span className="added">+{category.added}</span>}{category.removed > 0 && <span className="removed">-{category.removed}</span>}{category.changed > 0 && <span className="changed">~{category.changed}</span>}</div></header><ul>{category.items.slice(0, 8).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}{category.items.length > 8 && <li>另有 {category.items.length - 8} 项变化</li>}</ul></article>)}</div>;
}

function SnapshotStats({ label, project }: { label: string; project: Project }) {
  return <div className="snapshot-stat"><strong>{label}</strong><span>{project.chapters.length} 章</span><span>{Object.values(project.scripts).flat().length} Blocks</span><span>{project.characters.length} 角色</span><span>{project.assets.length} 素材</span></div>;
}

interface HistoryPageProps {
  project: Project;
  entries: CommandSnapshotEntry<Project>[];
  recovery: RecoverySnapshot | null;
  storage: CommandHistoryStorageStats | null;
  undoCount: number;
  redoCount: number;
  undo: () => void;
  redo: () => void;
  undoCategory: (commandId: string, categoryId: string) => boolean;
  restoreCommand: (entry: CommandSnapshotEntry<Project>, target: 'before' | 'after') => void;
  restoreRecovery: () => void;
  refreshRecovery: () => void;
  renameCommand: (entry: CommandSnapshotEntry<Project>) => void;
  toggleCommandPinned: (entry: CommandSnapshotEntry<Project>) => void;
  refreshStorage: () => void;
  clearOrdinaryHistory: () => void;
}

function HistoryPage({ project, entries, recovery, storage, undoCount, redoCount, undo, redo, undoCategory, restoreCommand, restoreRecovery, refreshRecovery, renameCommand, toggleCommandPinned, refreshStorage, clearOrdinaryHistory }: HistoryPageProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [recoveryExpanded, setRecoveryExpanded] = useState(false);
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const recoveryDiff = recovery ? diffProjects(recovery.project, project) : null;
  return <div className="dashboard-page history-page"><PageHeader title="编辑历史" sub="保留最近 50 个普通 Command；固定快照额外保护，所有恢复操作仍可撤销"><button className="button ghost" disabled={!undoCount} onClick={undo}><Undo2 />撤销</button><button className="button ghost" disabled={!redoCount} onClick={redo}><Redo2 />重做</button></PageHeader><div className="content-pad"><section className={`recovery-card ${recovery?.recoveredDuringLoad ? 'recovered' : ''}`}><div className="recovery-summary"><div className="recovery-icon"><HardDrive /></div><div><strong>{recovery?.recoveredDuringLoad ? '本次启动已执行崩溃恢复' : '崩溃恢复快照'}</strong><small>{recovery ? `${new Date(recovery.updatedAt).toLocaleString()} · ${recoveryDiff?.total ?? 0} 项与当前项目不同` : '当前项目还没有可用的恢复快照'}</small></div><div className="recovery-actions"><button className="button ghost" onClick={refreshRecovery}>刷新</button><button className="button ghost" disabled={!recovery} onClick={() => setRecoveryExpanded((value) => !value)}>{recoveryExpanded ? '收起比较' : '比较快照'}<ChevronDown className={recoveryExpanded ? 'expanded' : ''} /></button><button className="button primary" disabled={!recovery || !recoveryDiff?.total} onClick={restoreRecovery}><Undo2 />恢复此快照</button></div></div>{recovery && recoveryExpanded && <div className="snapshot-detail"><div className="snapshot-stats"><SnapshotStats label="恢复快照" project={recovery.project} /><ArrowRight /><SnapshotStats label="当前项目" project={project} /></div><SnapshotDiff diff={recoveryDiff!} /></div>}</section><section className="history-storage-card"><header><div><PackageCheck /><span><strong>历史存储与清理</strong><small>增量快照 v{storage?.version ?? 2} · .hikari/history/commands.json</small></span></div><div><button className="button ghost" onClick={refreshStorage}>刷新统计</button><button className="button danger" disabled={!entries.some((entry) => !entry.pinned)} onClick={clearOrdinaryHistory}><Trash2 />清理普通历史</button></div></header><div className="history-storage-stats"><div><span>磁盘占用</span><strong>{formatBytes(storage?.bytes ?? 0)}</strong></div><div><span>完整快照估算</span><strong>{formatBytes(storage?.uncompressedBytes ?? 0)}</strong></div><div><span>节省空间</span><strong>{Math.round((storage?.compressionRate ?? 0) * 100)}%</strong></div><div><span>历史记录</span><strong>{storage?.commandCount ?? entries.length}</strong><small>{storage?.pinnedCount ?? entries.filter((entry) => entry.pinned).length} 个固定</small></div></div><div className="compression-meter"><span style={{ width: `${Math.round((storage?.compressionRate ?? 0) * 100)}%` }} /><small>已压缩 {formatBytes(Math.max(0, (storage?.uncompressedBytes ?? 0) - (storage?.bytes ?? 0)))}</small></div></section><div className="history-list">{[...entries].reverse().map((entry) => {
    const isExpanded = expanded.has(entry.id);
    const diff = isExpanded ? diffProjects(entry.before, entry.after) : null;
    return <section className={`history-entry ${entry.categories?.length ? 'semantic' : ''} ${entry.state} ${entry.pinned ? 'pinned' : ''}`} key={entry.id}><button type="button" className="history-item" onClick={() => toggle(entry.id)}><div className="history-icon">{entry.label.startsWith('AI Agent') ? <Sparkles /> : <History />}</div><div><strong>{entry.name ?? entry.label}</strong><small>{entry.name ? `${entry.label} · ` : ''}{entry.state === 'undone' ? '当前位于重做栈 · ' : entry.state === 'archived' ? '固定归档 · ' : ''}{entry.categories?.length ? `${entry.categories.length} 类语义修改` : '完整项目快照'} · 点击比较</small></div><div className="history-badges">{entry.pinned && <span className="history-pin"><Pin />固定</span>}<span className={`history-state ${entry.state}`}>{entry.state === 'applied' ? '已应用' : entry.state === 'undone' ? '已撤销' : '已归档'}</span></div><time>{new Date(entry.timestamp).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><ChevronDown className={isExpanded ? 'expanded' : ''} /></button>{isExpanded && <div className="command-snapshot-detail"><div className="snapshot-toolbar"><div className="snapshot-stats"><SnapshotStats label="修改前" project={entry.before} /><ArrowRight /><SnapshotStats label="修改后" project={entry.after} /></div><div className="snapshot-actions"><button className="button ghost" onClick={() => renameCommand(entry)}><FileText />{entry.name ? '修改名称' : '命名快照'}</button><button className={`button ghost ${entry.pinned ? 'active' : ''}`} onClick={() => toggleCommandPinned(entry)}><Pin />{entry.pinned ? '取消固定' : '固定保护'}</button><button className="button ghost" onClick={() => restoreCommand(entry, 'before')}><Undo2 />恢复修改前</button><button className="button ghost" onClick={() => restoreCommand(entry, 'after')}><Redo2 />恢复修改后</button></div></div><SnapshotDiff diff={diff!} />{entry.categories?.length && <div className="history-category-list">{entry.categories.map((category) => <article className={category.undone ? 'undone' : ''} key={category.id}><header><div><strong>{category.label}</strong><span>{category.count} 项</span></div><button className="button ghost" disabled={entry.state !== 'applied' || category.undone} onClick={() => undoCategory(entry.id, category.id)}>{category.undone ? <CheckCircle2 /> : <Undo2 />}{category.undone ? '已撤销' : '恢复此类别到修改前'}</button></header><ul>{category.items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></article>)}</div>}</div>}</section>;
  })}{!entries.length && <div className="empty-state large"><History /><strong>还没有编辑记录</strong><span>修改项目后会在这里出现，关闭软件也不会清空</span></div>}<div className="history-item static"><div className="history-icon"><Save /></div><div><strong>自动保存与历史持久化</strong><small>项目写入 v3 目录，Command 快照写入 .hikari/history</small></div><time>450 ms</time></div></div></div></div>;
}

interface ModalLayerProps {
  modal: Modal;
  project: Project;
  close: () => void;
  addBlock: (type: BlockType) => void;
  runBuild: (kind: 'web' | 'windows' | 'renpy') => void;
}

function ModalLayer({ modal, project, close, addBlock, runBuild }: ModalLayerProps) {
  if (!modal) return null;
  if (modal === 'search') return null;
  if (modal === 'publish') { const diagnostics = diagnosticSummary(project); return <div className="modal-backdrop" onClick={close}><div className="modal wide" onClick={(e) => e.stopPropagation()}><div className="modal-header"><strong>构建与导出</strong><button className="icon-button" onClick={close}><X /></button></div><div className="modal-body"><div className="publish-options"><button className="publish-card selected" disabled={diagnostics.errors > 0} onClick={() => runBuild('web')}><ExternalLink /><strong>Web 游戏</strong><small>生成可独立运行的 HTML5 游戏</small></button><button className="publish-card" disabled={diagnostics.errors > 0} onClick={() => runBuild('windows')}><Box /><strong>Windows</strong><small>生成自带 .NET 8 的 WebView2 游戏包</small></button><button className="publish-card" disabled={diagnostics.errors > 0} onClick={() => runBuild('renpy')}><FileCode2 /><strong>Ren'Py</strong><small>生成可继续开发的 script.rpy</small></button></div><div className="check-list"><div className="check-row"><CheckCircle2 />{project.assets.length} 个素材已登记</div><div className="check-row"><CheckCircle2 />{Object.values(project.scripts).flat().length} 个 Block 已扫描</div><div className={`check-row ${diagnostics.errors ? 'check-error' : ''}`}>{diagnostics.errors ? <BugPlay /> : <CheckCircle2 />}{diagnostics.errors} 个错误 · {diagnostics.warnings} 个警告</div></div>{diagnostics.items.length > 0 && <div className="diagnostic-list">{diagnostics.items.slice(0, 12).map((item, index) => <article className={item.severity} key={`${item.code}-${item.blockId ?? item.fragmentId}-${index}`}><strong>{item.code}</strong><span>{item.message}</span><small>{item.fragmentId ?? '项目级'}</small></article>)}</div>}</div></div></div>; }
  return <div className="modal-backdrop" onClick={close}><div className="modal wide" onClick={(e) => e.stopPropagation()}><div className="modal-header"><strong>添加 Block</strong><button className="icon-button" onClick={close}><X /></button></div><div className="modal-body"><div className="block-palette">{(Object.entries(blockMeta) as [BlockType, typeof blockMeta.scene][]).map(([type, meta]) => { const Icon = meta.icon; return <button className="palette-item" key={type} onClick={() => addBlock(type)}><Icon /><strong>{meta.name}</strong><small>{meta.description}</small></button>; })}</div></div></div></div>;
}

export default function App() {
  const { reducedMotion } = useEditorAppearance();
  const history = useCommandHistory(fallbackProject);
  const project = history.value;
  const [page, setPage] = useState<Page>('script');
  const [backPages, setBackPages] = useState<Page[]>([]);
  const [forwardPages, setForwardPages] = useState<Page[]>([]);
  const [view, setView] = useState<View>(() => fallbackProject.settings.editorSession?.scriptView ?? 'cards');
  const [selected, setSelected] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [appDialog, setAppDialog] = useState<AppDialogRequest | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [assetSection, setAssetSection] = useState('全部');
  const [audioCategory, setAudioCategory] = useState<AudioCategory>('bgm');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [projectClosed, setProjectClosed] = useState(() => !new URLSearchParams(window.location.search).has('editor'));
  const [createWizardRequested, setCreateWizardRequested] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [debugRunning, setDebugRunning] = useState(false);
  const [openFragmentIds, setOpenFragmentIds] = useState<string[]>(() => [fallbackProject.activeFragmentId]);
  const [inspectorDock, setInspectorDock] = useState<InspectorDock>(() => fallbackProject.settings.editorSession?.inspectorDock ?? 'preview');
  const [creatorName, setCreatorName] = useState(() => readSmallValue('hikari-creator-name') ?? '');
  const [saveState, setSaveState] = useState('正在载入');
  const [startupReady, setStartupReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [gameThemeOpen, setGameThemeOpen] = useState(false);
  const [chapterSettingsOpen, setChapterSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [scriptImportOpen, setScriptImportOpen] = useState(false);
  const [scriptImportBusy, setScriptImportBusy] = useState(false);
  const [scriptImportPreview, setScriptImportPreview] = useState<ScriptImportPreview | null>(null);
  const [recoverySnapshot, setRecoverySnapshot] = useState<RecoverySnapshot | null>(null);
  const [historyStorage, setHistoryStorage] = useState<CommandHistoryStorageStats | null>(null);
  const hydrated = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<Promise<unknown> | null>(null);
  const projectSwitchingRef = useRef(false);
  const historyReadyRef = useRef(false);
  const historySaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const { toast, show: showToast } = useToast();
  const show = (text: string, tone: 'error' | 'success' = 'success') => {
    showToast(text, tone);
    setNotifications((items) => [{ id: makeId('notice'), title: tone === 'error' ? '操作失败' : '任务完成', detail: text, tone, createdAt: Date.now(), read: false }, ...items].slice(0, 80));
  };
  const requestText: RequestText = (options) => new Promise((resolve) => setAppDialog({ kind: 'text', title: options.title, message: options.message, placeholder: options.placeholder, value: options.initialValue ?? '', confirmText: options.confirmText ?? '确认', resolve: (value) => resolve(typeof value === 'string' ? value : null) }));
  const requestConfirm: RequestConfirm = (options) => new Promise((resolve) => setAppDialog({ kind: 'confirm', title: options.title, message: options.message, value: '', confirmText: options.confirmText ?? '确认', danger: options.danger, resolve: (value) => resolve(value === true) }));
  const closeAppDialog = (value: string | boolean | null) => { const current = appDialog; if (!current) return; setAppDialog(null); current.resolve(value); };
  const navigatePage = (next: Page) => { if (next === page) return; setBackPages((items) => [...items, page].slice(-40)); setForwardPages([]); setPage(next); };
  const navigateBack = () => { const previous = backPages.at(-1); if (!previous) return; setBackPages((items) => items.slice(0, -1)); setForwardPages((items) => [page, ...items].slice(0, 40)); setPage(previous); };
  const navigateForward = () => { const next = forwardPages[0]; if (!next) return; setForwardPages((items) => items.slice(1)); setBackPages((items) => [...items, page].slice(-40)); setPage(next); };
  const { commit, commitSaved, replace, reset: resetHistory, restoreHistory, serializeHistory, undo, redo, undoCategory, renameCommand, toggleCommandPinned, clearUnpinnedHistory, undoCount, redoCount, history: commandEntries, historyVersion, dirty, markSaved } = history;
  const resetProject = (next: Project, persistedHistory?: PersistedCommandHistory<Project> | null) => {
    const fragmentIds = new Set(next.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => fragment.id)));
    const savedTabs = next.settings.editorSession?.openFragmentIds.filter((id) => fragmentIds.has(id)) ?? [];
    if (persistedHistory?.projectId === next.meta.id) restoreHistory(next, persistedHistory, commandRestoreStrategies);
    else resetHistory(next);
    setSelected(next.settings.editorSession?.selectedBlockByFragment?.[next.activeFragmentId] ?? 0);
    setOpenFragmentIds(savedTabs.length ? savedTabs : [next.activeFragmentId]);
    setInspectorDock(next.settings.editorSession?.inspectorDock ?? 'preview');
    setView(next.settings.editorSession?.scriptView ?? 'cards');
  };

  const persistCommandHistory = () => {
    if (!historyReadyRef.current) return Promise.resolve();
    const snapshot = serializeHistory(project.meta.id);
    const request = historySaveQueueRef.current.catch(() => undefined).then(() => saveCommandHistory(snapshot)).then((result) => { setHistoryStorage(result); return result; });
    historySaveQueueRef.current = request;
    return request;
  };

  const restoreProjectAndHistory = async (next: Project) => {
    historyReadyRef.current = false;
    setRecoverySnapshot(null);
    setHistoryStorage(null);
    let persistedHistory: PersistedCommandHistory<Project> | null = null;
    try { persistedHistory = await loadCommandHistory(); }
    catch (error) { log('error', 'history', 'Command 历史损坏或无法读取，项目将不带历史打开', error); }
    try { setRecoverySnapshot(await loadRecoverySnapshot()); }
    catch (error) { log('error', 'history', '崩溃恢复快照无法读取', error); }
    try { setHistoryStorage(await loadCommandHistoryStats()); }
    catch (error) { log('error', 'history', '历史存储统计无法读取', error); }
    resetProject(next, persistedHistory);
    historyReadyRef.current = true;
  };

  const flushCommandHistory = async () => {
    if (historyReadyRef.current) await persistCommandHistory();
    await historySaveQueueRef.current;
  };

  const prepareProjectSwitch = async () => {
    projectSwitchingRef.current = true;
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    await pendingSaveRef.current;
    if (dirty) {
      await saveProject(project);
      markSaved();
    }
    await flushCommandHistory();
  };

  useEffect(() => {
    void loadProject(fallbackProject).then(async (loaded) => {
      await restoreProjectAndHistory(loaded);
      hydrated.current = true;
      setStartupReady(true);
      setSaveState('已保存');
    }).catch((error) => {
      hydrated.current = false;
      historyReadyRef.current = false;
      setStartupReady(true);
      setSaveState('加载失败');
      log('error', 'project', '项目加载失败；为保护磁盘项目，编辑与自动保存保持停用', error);
      show(`项目加载失败：${String(error)}`, 'error');
    });
  }, []);
  useEffect(() => {
    const handler = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (!path) return;
      void (async () => {
        try {
          await prepareProjectSwitch();
          await restoreProjectAndHistory(await openProjectPath(path));
          setProjectClosed(false);
          show('已从 Windows 打开项目');
        } catch (error) {
          show(String(error), 'error');
        } finally {
          projectSwitchingRef.current = false;
        }
      })();
    };
    window.addEventListener('hikari-open-project-request', handler);
    return () => window.removeEventListener('hikari-open-project-request', handler);
  }, [project, dirty, historyVersion]);
  useEffect(() => { if (!historyReadyRef.current) return; void persistCommandHistory().catch((error) => log('error', 'history', 'Command 历史持久化失败', error)); }, [historyVersion]);
  useEffect(() => {
    if (!hydrated.current || projectSwitchingRef.current || !project.settings.autoSave || !dirty) return;
    setSaveState('保存中');
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      const request = saveProject(project).then(() => {
        markSaved();
        setSaveState('已保存');
        setNotifications((items) => [{ id: makeId('notice'), title: '自动保存', detail: `${project.meta.name} 已写入本地项目`, tone: 'success' as const, createdAt: Date.now(), read: false }, ...items].slice(0, 80));
      }).catch((error) => {
        log('error', 'project', '项目自动保存失败', error);
        setSaveState('保存失败');
        show(String(error), 'error');
      }).finally(() => {
        if (pendingSaveRef.current === request) pendingSaveRef.current = null;
      });
      pendingSaveRef.current = request;
    }, 450);
    return () => {
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    };
  }, [dirty, markSaved, project]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { const target = event.target as HTMLElement | null; const editingText = target?.matches('input,textarea,[contenteditable="true"]'); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setModal('search'); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editingText) { event.preventDefault(); event.shiftKey ? redo() : undo(); } else if (event.key === 'Escape') setModal(null); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [redo, undo]);
  useEffect(() => { if (!appDialog) return; const handler = (event: KeyboardEvent) => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopImmediatePropagation(); closeAppDialog(appDialog.kind === 'text' ? null : false); }; window.addEventListener('keydown', handler, true); return () => window.removeEventListener('keydown', handler, true); }, [appDialog]);
  useEffect(() => { if (!hydrated.current) return; replace((current) => ({ ...current, settings: { ...current.settings, editorSession: { ...current.settings.editorSession, openFragmentIds, selectedBlockByFragment: current.settings.editorSession?.selectedBlockByFragment ?? {}, scrollTopByFragment: current.settings.editorSession?.scrollTopByFragment ?? {}, inspectorDock, scriptView: view } } })); }, [openFragmentIds, inspectorDock, view]);
  useEffect(() => { if (!hydrated.current) return; replace((current) => ({ ...current, settings: { ...current.settings, editorSession: { ...current.settings.editorSession, openFragmentIds, selectedBlockByFragment: { ...(current.settings.editorSession?.selectedBlockByFragment ?? {}), [current.activeFragmentId]: selected }, scrollTopByFragment: current.settings.editorSession?.scrollTopByFragment ?? {}, inspectorDock, scriptView: view } } })); }, [selected, project.activeFragmentId]);

  const addChapter = async () => { const name = await requestText({ title: '新建章节', message: '章节会创建一个名为“主线”的初始片段。', placeholder: '章节名称', confirmText: '创建章节' }); if (!name) return; const fragmentId = makeId('fragment'); commit((current) => ({ ...current, activeFragmentId: fragmentId, chapters: [...current.chapters, { id: makeId('chapter'), name, fragments: [{ id: fragmentId, name: '主线' }] }], scripts: { ...current.scripts, [fragmentId]: [] } })); setSelected(0); };
  const addFragment = async (chapterId: string) => { const name = await requestText({ title: '新建片段', message: '新片段会添加到所选章节。', placeholder: '片段名称', confirmText: '创建片段' }); if (!name) return; const id = makeId('fragment'); commit((current) => ({ ...current, activeFragmentId: id, chapters: current.chapters.map((chapter) => chapter.id === chapterId ? { ...chapter, fragments: [...chapter.fragments, { id, name }] } : chapter), scripts: { ...current.scripts, [id]: [] } })); setSelected(0); };
  const removeFragment = async (chapterId: string, fragmentId: string) => {
    const referenced = Object.values(project.scripts).flat().some((block) => block.type === 'branch' ? block.options?.some((option) => option.target === fragmentId) : block.type === 'condition' ? block.trueTarget === fragmentId || block.falseTarget === fragmentId : (block.type === 'jump' || block.type === 'call') ? block.target === fragmentId : false);
    if (referenced) { show('该片段仍被分支、条件、跳转或调用引用，请先解除引用', 'error'); return; }
    if (!await requestConfirm({ title: '删除片段', message: '删除片段会同时删除其中的全部 Block，是否继续？', confirmText: '删除片段', danger: true })) return;
    commit((current) => { const chapters = current.chapters.map((chapter) => chapter.id === chapterId ? { ...chapter, fragments: chapter.fragments.filter((fragment) => fragment.id !== fragmentId) } : chapter); const scripts = { ...current.scripts }; delete scripts[fragmentId]; const timelines = { ...(current.timelines ?? {}) }; delete timelines[fragmentId]; const first = chapters.flatMap((chapter) => chapter.fragments)[0].id; return { ...current, chapters, scripts, timelines, activeFragmentId: current.activeFragmentId === fragmentId ? first : current.activeFragmentId }; }); setSelected(0);
  };
  const structureAction = async (action: 'copy' | 'cut' | 'duplicate' | 'paste', chapterId: string, fragmentId?: string) => {
    const chapter = project.chapters.find((item) => item.id === chapterId); if (!chapter) return;
    const payload = fragmentId
      ? { kind: 'fragment', sourceId: fragmentId, fragment: clone(chapter.fragments.find((item) => item.id === fragmentId)), blocks: clone(project.scripts[fragmentId] ?? []), timeline: clone(project.timelines?.[fragmentId]) }
      : { kind: 'chapter', chapter: clone(chapter), scripts: Object.fromEntries(chapter.fragments.map((fragment) => [fragment.id, clone(project.scripts[fragment.id] ?? [])])), timelines: Object.fromEntries(chapter.fragments.flatMap((fragment) => project.timelines?.[fragment.id] ? [[fragment.id, clone(project.timelines[fragment.id])]] : [])) };
    const writePayload = async (value: unknown) => {
      const encoded = `HIKARI_STRUCTURE_V1\n${JSON.stringify(value)}`;
      writeSmallValue('hikari-structure-clipboard', encoded);
      try { await navigator.clipboard.writeText(encoded); } catch { /* local fallback remains available */ }
    };
    const readPayload = async () => {
      let encoded = readSmallValue('hikari-structure-clipboard') ?? '';
      try { encoded = await navigator.clipboard.readText() || encoded; } catch { /* use local fallback */ }
      if (!encoded.startsWith('HIKARI_STRUCTURE_V1\n')) return null;
      try { return JSON.parse(encoded.slice('HIKARI_STRUCTURE_V1\n'.length)) as typeof payload; } catch { return null; }
    };
    const referenced = (targetIds: Set<string>) => Object.values(project.scripts).flat().some((block) => block.type === 'branch' ? block.options?.some((option) => targetIds.has(option.target)) : block.type === 'condition' ? Boolean(block.trueTarget && targetIds.has(block.trueTarget)) || Boolean(block.falseTarget && targetIds.has(block.falseTarget)) : (block.type === 'jump' || block.type === 'call') ? Boolean(block.target && targetIds.has(block.target)) : false);
    const pastePayload = (source: any) => {
      if (!source || !['fragment', 'chapter'].includes(source.kind)) return;
      const uniqueName = (name: string, names: string[]) => { if (!names.includes(name)) return name; let suffix = 1; while (names.includes(`${name}_${suffix}`)) suffix += 1; return `${name}_${suffix}`; };
      if (source.kind === 'fragment' && source.fragment && Array.isArray(source.blocks)) {
        const id = makeId('fragment');
        const name = uniqueName(String(source.fragment.name || '片段'), chapter.fragments.map((item) => item.name));
        const blockIds = new Map<string, string>();
        const remap = (block: StoryBlock): StoryBlock => { const nextId = makeId('block'); blockIds.set(block.id, nextId); const next = { ...clone(block), id: nextId } as StoryBlock; if (next.type === 'branch') next.options = next.options?.map((option) => ({ ...option, target: option.target === source.sourceId ? id : option.target })); if (next.type === 'condition') { if (next.trueTarget === source.sourceId) next.trueTarget = id; if (next.falseTarget === source.sourceId) next.falseTarget = id; } if ((next.type === 'jump' || next.type === 'call') && next.target === source.sourceId) next.target = id; return next; };
        const blocks = source.blocks.map(remap);
        const timeline = source.timeline ? remapTimeline(source.timeline, id, blockIds, makeId) : undefined;
        commit((current) => ({ ...current, activeFragmentId: id, chapters: current.chapters.map((item) => item.id === chapterId ? { ...item, fragments: [...item.fragments, { id, name }] } : item), scripts: { ...current.scripts, [id]: blocks }, timelines: timeline ? { ...(current.timelines ?? {}), [id]: timeline } : current.timelines }), `粘贴片段 ${name}`);
        setOpenFragmentIds((items) => [...items, id]); setSelected(0); show(`已粘贴片段“${name}”`); return;
      }
      if (source.kind === 'chapter' && source.chapter && source.scripts) {
        const newChapterId = makeId('chapter');
        const idMap = new Map<string, string>(source.chapter.fragments.map((fragment: { id: string }) => [fragment.id, makeId('fragment')]));
        const fragments = source.chapter.fragments.map((fragment: { id: string; name: string }) => ({ id: idMap.get(fragment.id)!, name: fragment.name }));
        const name = uniqueName(String(source.chapter.name || '章节'), project.chapters.map((item) => item.name));
        const scripts: Record<string, StoryBlock[]> = {};
        const timelines: NonNullable<Project['timelines']> = {};
        for (const fragment of source.chapter.fragments as { id: string }[]) {
          const targetFragmentId = idMap.get(fragment.id)!;
          const blockIds = new Map<string, string>();
          scripts[targetFragmentId] = (source.scripts[fragment.id] ?? []).map((raw: StoryBlock) => { const nextId = makeId('block'); blockIds.set(raw.id, nextId); const next = { ...clone(raw), id: nextId } as StoryBlock; const mapTarget = (target?: string) => target ? idMap.get(target) ?? target : target; if (next.type === 'branch') next.options = next.options?.map((option) => ({ ...option, target: mapTarget(option.target)! })); if (next.type === 'condition') { next.trueTarget = mapTarget(next.trueTarget); next.falseTarget = mapTarget(next.falseTarget); } if (next.type === 'jump' || next.type === 'call') next.target = mapTarget(next.target); return next; });
          if (source.timelines?.[fragment.id]) timelines[targetFragmentId] = remapTimeline(source.timelines[fragment.id], targetFragmentId, blockIds, makeId);
        }
        const firstId = fragments[0]?.id;
        commit((current) => { const index = current.chapters.findIndex((item) => item.id === chapterId); const chapters = [...current.chapters]; chapters.splice(index + 1, 0, { id: newChapterId, name, fragments }); return { ...current, chapters, scripts: { ...current.scripts, ...scripts }, timelines: { ...(current.timelines ?? {}), ...timelines }, activeFragmentId: firstId ?? current.activeFragmentId }; }, `粘贴章节 ${name}`);
        if (firstId) { setOpenFragmentIds((items) => [...items, firstId]); setSelected(0); } show(`已粘贴章节“${name}”`);
      }
    };
    if (action === 'paste') { pastePayload(await readPayload()); return; }
    if (action === 'duplicate') { pastePayload(payload); return; }
    await writePayload(payload); show(`已复制${fragmentId ? '片段' : '章节'}到剪贴板`);
    if (action !== 'cut') return;
    if (chapter.entry) { show('起始章节及其片段不能剪切', 'error'); return; }
    const targetIds = new Set(fragmentId ? [fragmentId] : chapter.fragments.map((item) => item.id));
    if (referenced(targetIds)) { show('内容仍被剧情流程引用，请先解除引用', 'error'); return; }
    if (fragmentId) { await removeFragment(chapterId, fragmentId); return; }
    if (!await requestConfirm({ title: '剪切章节', message: `从项目中移除“${chapter.name}”？内容已复制到剪贴板。`, confirmText: '剪切', danger: true })) return;
    commit((current) => { const scripts = { ...current.scripts }; const timelines = { ...(current.timelines ?? {}) }; for (const fragment of chapter.fragments) { delete scripts[fragment.id]; delete timelines[fragment.id]; } const chapters = current.chapters.filter((item) => item.id !== chapterId); const activeFragmentId = chapter.fragments.some((item) => item.id === current.activeFragmentId) ? chapters[0].fragments[0].id : current.activeFragmentId; return { ...current, chapters, scripts, timelines, activeFragmentId }; }, `剪切章节 ${chapter.name}`);
  };
  const toggleChapterDisabled = (chapterId: string) => commit((current) => ({ ...current, chapters: current.chapters.map((chapter) => chapter.id === chapterId && !chapter.entry ? { ...chapter, disabled: !chapter.disabled } : chapter) }), '切换章节启用状态');
  const addBlock = (type: BlockType) => { const block = createBlock(type, project); const nextIndex = (project.scripts[project.activeFragmentId] ?? []).length; commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: [...(current.scripts[current.activeFragmentId] ?? []), block] } }), `添加${blockMeta[type].name}`); setSelected(nextIndex); setModal(null); };
  const doImport = async () => { try { const imported = await importAssets(); if (!imported.length) return; commit((current) => ({ ...current, assets: [...current.assets, ...imported] })); show(`已导入 ${imported.length} 个素材`); } catch (error) { show(String(error), 'error'); } };
  const selectScriptImport = async () => {
    setScriptImportBusy(true);
    try { const preview = await previewScriptImport(); if (preview) setScriptImportPreview(preview); }
    catch (error) { show(String(error), 'error'); }
    finally { setScriptImportBusy(false); }
  };
  const applyScriptImport = (mode: 'append' | 'replace') => {
    if (!scriptImportPreview) return;
    const blocks = clone(scriptImportPreview.blocks);
    commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: mode === 'append' ? [...(current.scripts[current.activeFragmentId] ?? []), ...blocks] : blocks } }), `${mode === 'append' ? '追加' : '替换'}导入剧本 ${scriptImportPreview.sourceName}`);
    setSelected(mode === 'append' ? Math.max(0, (project.scripts[project.activeFragmentId]?.length ?? 0)) : 0);
    setScriptImportOpen(false);
    setScriptImportPreview(null);
    show(`已从 ${scriptImportPreview.sourceName} 导入 ${blocks.length} 个 Block`);
  };
  const doNew = async () => { setCreateWizardRequested(true); setProjectClosed(true); };
  const doCreateProject = async (options: ProjectCreationOptions) => {
    try {
      await prepareProjectSwitch();
      const created = await createProject(options);
      await restoreProjectAndHistory(created);
      show('新项目已创建');
      return created;
    } finally { projectSwitchingRef.current = false; }
  };
  const doOpen = async (rethrow = false) => { try { await prepareProjectSwitch(); const opened = await openProject(); if (opened) { await restoreProjectAndHistory(opened); setProjectClosed(false); show('项目已打开'); } } catch (error) { show(String(error), 'error'); if (rethrow) throw error; } finally { projectSwitchingRef.current = false; } };
  const doOpenRecent = async (path: string) => { try { await prepareProjectSwitch(); await restoreProjectAndHistory(await openRecentProject(path)); setProjectClosed(false); show('最近项目已打开'); } catch (error) { show(String(error), 'error'); throw error; } finally { projectSwitchingRef.current = false; } };
  const renameProject = async () => { const name = await requestText({ title: '重命名项目', initialValue: project.meta.name, confirmText: '重命名' }); if (!name || name === project.meta.name) return; commit((current) => ({ ...current, meta: { ...current.meta, name } }), `重命名项目为 ${name}`); show('项目已重命名'); };
  const doSaveAs = async () => { try { const result = await saveProjectAs(project); if (result) show(`项目副本已保存：${result.path}`); } catch (error) { show(String(error), 'error'); } };
  const closeProject = async () => { if (!await requestConfirm({ title: '关闭项目', message: `关闭“${project.meta.name}”？未保存修改会先由自动保存处理。`, confirmText: '关闭项目' })) return; await flushCommandHistory(); setCreateWizardRequested(false); setProjectClosed(true); setProjectMenuOpen(false); };
  const exitApplication = async () => {
    try { await flushCommandHistory(); }
    catch (error) { log('error', 'history', '退出前保存 Command 历史失败', error); }
    await callWindow('close_window');
  };
  const loginCreator = async () => { const name = await requestText({ title: creatorName ? '账号设置' : '创作者账号', message: '输入创作者显示名。', initialValue: creatorName, placeholder: '创作者名称', confirmText: creatorName ? '保存' : '登录' }); if (!name) return; writeSmallValue('hikari-creator-name', name); setCreatorName(name); setAccountMenuOpen(false); };
  const logoutCreator = () => { removeSmallValue('hikari-creator-name'); setCreatorName(''); setAccountMenuOpen(false); };
  const runBuild = async (kind: 'web' | 'windows' | 'renpy') => { try { const diagnostics = diagnosticSummary(project); if (diagnostics.errors) { show(`构建被阻止：请先修复 ${diagnostics.errors} 个错误`, 'error'); return; } setModal(null); setSaveState('构建中'); const result = kind === 'web' ? await buildWeb(project) : kind === 'windows' ? await buildWindows(project) : await exportRenpy(project); setSaveState('已保存'); show(`${kind === 'web' ? 'Web 游戏' : kind === 'windows' ? 'Windows 游戏' : "Ren'Py 脚本"}已生成：${result.path}`); } catch (error) { setSaveState('构建失败'); show(String(error), 'error'); } };
  const activate = (id: string, blockIndex?: number) => { setOpenFragmentIds((items) => items.includes(id) ? items : [...items, id]); replace((current) => ({ ...current, activeFragmentId: id })); setSelected(blockIndex ?? project.settings.editorSession?.selectedBlockByFragment?.[id] ?? 0); navigatePage('script'); };
  const closeFragment = (id: string) => {
    const index = openFragmentIds.indexOf(id);
    if (index < 0) return;
    const next = openFragmentIds.filter((item) => item !== id);
    const firstFragment = project.chapters.flatMap((chapter) => chapter.fragments)[0]?.id;
    const fallback = next[Math.min(index, next.length - 1)] ?? firstFragment;
    setOpenFragmentIds(next.length ? next : firstFragment ? [firstFragment] : []);
    if (id === project.activeFragmentId && fallback) replace((current) => ({ ...current, activeFragmentId: fallback }));
  };
  const reorderFragmentTabs = (fromId: string, toId: string) => setOpenFragmentIds((items) => { const from = items.indexOf(fromId); const to = items.indexOf(toId); if (from < 0 || to < 0 || from === to) return items; const next = [...items]; next.splice(to, 0, next.splice(from, 1)[0]); return next; });
  const saveFragmentScrollTop = (value: number) => replace((current) => ({ ...current, settings: { ...current.settings, editorSession: { ...current.settings.editorSession, openFragmentIds, selectedBlockByFragment: current.settings.editorSession?.selectedBlockByFragment ?? {}, scrollTopByFragment: { ...(current.settings.editorSession?.scrollTopByFragment ?? {}), [current.activeFragmentId]: value }, inspectorDock, scriptView: view } } }));
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w' && page === 'script') { event.preventDefault(); closeFragment(project.activeFragmentId); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [page, project.activeFragmentId, openFragmentIds]);
  const locateSearchResult = (location: SearchLocation) => {
    if (location.page) { navigatePage(location.page); return; }
    if (location.fragmentId) {
      replace((current) => ({ ...current, activeFragmentId: location.fragmentId! }));
      setSelected(location.blockIndex ?? 0);
      navigatePage('script');
    }
  };
  const replaceProjectText = (query: string, replacement: string) => {
    let count = 0;
    const replaceValue = (value?: string) => {
      if (!value) return value;
      const parts = value.split(query);
      count += parts.length - 1;
      return parts.join(replacement);
    };
    const next = clone(project);
    for (const chapter of next.chapters) {
      chapter.name = replaceValue(chapter.name) ?? chapter.name;
      for (const fragment of chapter.fragments) fragment.name = replaceValue(fragment.name) ?? fragment.name;
    }
    for (const blocks of Object.values(next.scripts)) for (const block of blocks) {
      block.text = replaceValue(block.text);
      block.title = replaceValue(block.title);
      block.speaker = replaceValue(block.speaker);
    }
    for (const character of next.characters) character.name = replaceValue(character.name) ?? character.name;
    for (const asset of next.assets) asset.name = replaceValue(asset.name) ?? asset.name;
    if (count) { commit(() => next, `全局替换“${query}”为“${replacement}”`); show(`已替换 ${count} 处文本`); }
    return count;
  };
  const applyAgentPlan = async (taskId: string, operationIndexes: number[], operations: AgentOperation[]) => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    await pendingSaveRef.current;
    if (dirty) {
      setSaveState('保存中');
      await saveProject(project);
      markSaved();
    }
    const result = await applyAiPatch(taskId, operationIndexes, project);
    if (result.ok && result.project) {
      const semantic = buildAgentPatchSemanticRecord(operations);
      commitSaved(() => result.project!, `AI Agent：${result.summary ?? '应用 Patch'}`, { categories: semantic.categories, restoreCategory: (current, before, after, categoryId) => restoreAgentPatchCategory(current, before, after, categoryId, semantic), persistence: { strategy: 'agent-patch', payload: semantic } });
      await persistCommandHistory();
      setSaveState('已保存');
    }
    return result;
  };

  const refreshRecoverySnapshot = async () => {
    try { setRecoverySnapshot(await loadRecoverySnapshot()); show('崩溃恢复快照已刷新'); }
    catch (error) { log('error', 'history', '崩溃恢复快照刷新失败', error); show(String(error), 'error'); }
  };
  const restoreCommandSnapshot = async (entry: CommandSnapshotEntry<Project>, target: 'before' | 'after') => {
    const side = target === 'before' ? '修改前' : '修改后';
    if (!await requestConfirm({ title: `恢复到${side}`, message: `将整个项目恢复到“${entry.label}”的${side}状态。当前状态会先记录为新的 Command，因此仍可撤销。`, confirmText: `恢复${side}`, danger: target === 'before' })) return;
    commit(() => clone(entry[target]), `快照恢复：${entry.label} · ${side}`);
    show(`已恢复到“${entry.label}”的${side}状态`);
  };
  const restoreCrashSnapshot = async () => {
    if (!recoverySnapshot) return;
    if (!await requestConfirm({ title: '恢复崩溃快照', message: `将项目恢复到 ${new Date(recoverySnapshot.updatedAt).toLocaleString()} 的最后安全状态。当前状态会保留在 Command 历史中。`, confirmText: '恢复快照', danger: true })) return;
    commit(() => clone(recoverySnapshot.project), '恢复崩溃快照');
    show('崩溃恢复快照已应用，可通过撤销返回');
  };
  const nameCommandSnapshot = async (entry: CommandSnapshotEntry<Project>) => {
    const name = await requestText({ title: '命名历史快照', message: '名称只用于 Studio 历史面板，不会写入游戏内容。', initialValue: entry.name ?? entry.label, placeholder: '快照名称', confirmText: '保存名称' });
    if (name === null || !renameCommand(entry.id, name)) return;
    show(name.trim() ? '快照名称已保存' : '快照名称已清除');
  };
  const refreshHistoryStorage = async () => {
    try { setHistoryStorage(await loadCommandHistoryStats()); show('历史存储统计已刷新'); }
    catch (error) { log('error', 'history', '历史存储统计刷新失败', error); show(String(error), 'error'); }
  };
  const clearOrdinaryHistory = async () => {
    const ordinaryCount = commandEntries.filter((entry) => !entry.pinned).length;
    if (!ordinaryCount || !await requestConfirm({ title: '清理普通历史', message: `将删除 ${ordinaryCount} 条普通 Command 历史并清空撤销/重做栈。固定快照会转入受保护归档，项目内容不会改变。`, confirmText: '清理普通历史', danger: true })) return;
    const removed = clearUnpinnedHistory();
    await persistCommandHistory();
    show(`已清理 ${removed} 条普通历史，固定快照已保留`);
  };

  const activeName = project.chapters.flatMap((chapter) => chapter.fragments).find((fragment) => fragment.id === project.activeFragmentId)?.name ?? '片段';
  const pages: Record<Page, ReactNode> = {
    script: <ScriptPage project={project} commit={commit} selected={selected} setSelected={setSelected} view={view} setView={setView} openBlocks={() => setModal('blocks')} openImport={() => setScriptImportOpen(true)} requestConfirm={requestConfirm} openFragmentIds={openFragmentIds} activateFragment={activate} closeFragment={closeFragment} reorderFragmentTabs={reorderFragmentTabs} inspectorDock={inspectorDock} setInspectorDock={setInspectorDock} initialScrollTop={project.settings.editorSession?.scrollTopByFragment?.[project.activeFragmentId] ?? 0} saveScrollTop={saveFragmentScrollTop} debugRunning={debugRunning} notify={show} />,
    stage: <StageTimelineWorkspace project={project} selectedBlock={selected} commit={commit} locateBlock={(index) => setSelected(index)} notify={show} />,
    assets: <AssetManager project={project} commit={commit} notify={show} requestConfirm={requestConfirm} activate={activate} />,
    audio: <AudioManager project={project} category={audioCategory} setCategory={setAudioCategory} commit={commit} notify={show} requestConfirm={requestConfirm} activate={activate} />,
    map: <NarrativeMap project={project} activate={activate} commit={commit} notify={show} requestText={requestText} />,
    characters: <CharacterManager project={project} commit={commit} notify={show} requestText={requestText} requestConfirm={requestConfirm} />,
    scenes: <SceneManager project={project} commit={commit} notify={show} requestText={requestText} requestConfirm={requestConfirm} activate={activate} />,
    history: <HistoryPage project={project} entries={commandEntries} recovery={recoverySnapshot} storage={historyStorage} undoCount={undoCount} redoCount={redoCount} undo={undo} redo={redo} undoCategory={undoCategory} restoreCommand={(entry, target) => void restoreCommandSnapshot(entry, target)} restoreRecovery={() => void restoreCrashSnapshot()} refreshRecovery={() => void refreshRecoverySnapshot()} renameCommand={(entry) => void nameCommandSnapshot(entry)} toggleCommandPinned={(entry) => { if (toggleCommandPinned(entry.id)) show(entry.pinned ? '快照已取消固定' : '快照已固定保护'); }} refreshStorage={() => void refreshHistoryStorage()} clearOrdinaryHistory={() => void clearOrdinaryHistory()} />,
    ai: <AiAgentPanel project={project} selectedBlockIndexes={[selected]} updateProject={commit} locateEditor={activate} applyPlan={applyAgentPlan} requestBuild={(target) => void runBuild(target)} notify={show} navigateTarget={(target) => { if (target.kind === 'fragment' && target.id) activate(target.id); else if (target.kind === 'chapter' && target.id) { const fragment = project.chapters.find((chapter) => chapter.id === target.id)?.fragments[0]; if (fragment) activate(fragment.id); } else if (target.kind === 'character') navigatePage('characters'); else if (target.kind === 'asset') navigatePage('assets'); else if (target.kind === 'variable') navigatePage('map'); else if (target.kind === 'memory') navigatePage('ai'); else show('该差异项没有可打开的编辑位置'); }} />,
  };
  const openAssetSection = (section: string, target: Page = 'assets') => { setAssetSection(section); navigatePage(target); setAssetMenuOpen(false); };
  const openAudioSection = (category: AudioCategory) => { setAudioCategory(category); navigatePage('audio'); setAssetMenuOpen(false); };

  if (projectClosed) return <ProjectLaunchScreen key={createWizardRequested ? 'create' : 'home'} startInWizard={createWizardRequested} ready={startupReady} onOpen={() => doOpen(true)} onOpenRecent={doOpenRecent} onCreate={doCreateProject} onCreated={() => { setCreateWizardRequested(false); setProjectClosed(false); }} onExit={() => void exitApplication()} />;

  return <div className={`app-shell desktop-app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><header className="topbar titlebar-drag pywebview-drag-region"><div className="brand-lockup"><div className="brand-mark">H</div><div><strong>Hikari Studio</strong><span>{projectClosed ? '未打开项目' : project.meta.name}</span></div></div><div className="navigation-controls titlebar-no-drag"><button className="icon-button" disabled={!backPages.length} title="后退" onClick={navigateBack}><ArrowLeft /></button><button className="icon-button" disabled={!forwardPages.length} title="前进" onClick={navigateForward}><ArrowRight /></button></div><div className="top-project-menu titlebar-no-drag"><button className="project-menu-trigger" aria-expanded={projectMenuOpen} onClick={() => setProjectMenuOpen((value) => !value)}><Menu /><span>{project.meta.name}</span><ChevronDown /></button>{projectMenuOpen && <div className="top-dropdown project-actions-menu"><button onClick={() => { setProjectMenuOpen(false); void doOpen(); }}><FolderOpen />打开项目</button><button onClick={() => { setProjectMenuOpen(false); void renameProject(); }}><FileText />重命名</button><button onClick={() => { setProjectMenuOpen(false); void doSaveAs(); }}><SaveAs />另存为</button><button onClick={() => { setProjectMenuOpen(false); navigatePage('history'); }}><History />项目历史</button><button onClick={() => void closeProject()}><X />关闭项目</button><button onClick={() => void exitApplication()}><LogOut />退出应用</button></div>}</div><button className="search-trigger titlebar-no-drag" onClick={() => setModal('search')}><Search /><span>搜索台词、指令和资源...</span><kbd>Ctrl K</kbd></button><div className="top-actions titlebar-no-drag"><div className="save-state"><span />{saveState}</div><button className="icon-button notification-trigger" title="通知" onClick={() => setNotificationsOpen((value) => !value)}><Bell />{notifications.some((item) => !item.read) && <span />}</button><div className="account-entry"><button className="avatar-button" title="创作者账号" onClick={() => setAccountMenuOpen((value) => !value)}>{creatorName ? creatorName.slice(0, 1).toUpperCase() : <UserRound />}</button>{accountMenuOpen && <div className="top-dropdown account-menu">{creatorName ? <><strong>{creatorName}</strong><button onClick={() => void loginCreator()}><Settings2 />账号设置</button><button onClick={logoutCreator}><LogOut />退出账号</button></> : <button onClick={() => void loginCreator()}><UserRound />登录创作者账号</button>}</div>}</div><WindowChrome onClose={() => void exitApplication()} /></div></header>
    <nav className="module-nav"><div className="module-links"><button className={`module-link ${page === 'script' ? 'active' : ''}`} onClick={() => navigatePage('script')}><NotebookPen />{debugRunning ? '调试' : '剧本'}</button><button className={`module-link ${page === 'stage' ? 'active' : ''}`} onClick={() => navigatePage('stage')}><Clapperboard />演出</button><div className="asset-nav-menu"><button className={`module-link ${page === 'assets' || page === 'characters' || page === 'scenes' || page === 'audio' ? 'active' : ''}`} aria-expanded={assetMenuOpen} onClick={() => setAssetMenuOpen((value) => !value)}><FolderOpen />资产<ChevronDown /></button>{assetMenuOpen && <div className="top-dropdown asset-submenu"><button onClick={() => openAssetSection('全部')}><PackageCheck />资源总览</button><button onClick={() => openAssetSection('全部', 'characters')}><Users />角色</button><button onClick={() => openAssetSection('全部', 'scenes')}><Image />场景</button><button onClick={() => openAudioSection('bgm')}><Music2 />BGM</button><button onClick={() => openAudioSection('sfx')}><AudioLines />SE</button><button onClick={() => openAudioSection('voice')}><MessageSquareText />语音</button></div>}</div><button className={`module-link ${page === 'map' ? 'active' : ''}`} onClick={() => navigatePage('map')}><GitBranch />叙事地图</button><button className={`module-link ${themeOpen ? 'active' : ''}`} onClick={() => setThemeOpen(true)}><Palette />个性化</button><button className={`module-link ${page === 'ai' ? 'active' : ''}`} onClick={() => navigatePage('ai')}><Sparkles />AI Agent</button></div><div className="module-actions"><button className={`button ghost ${debugRunning ? 'active' : ''}`} onClick={() => { setDebugRunning((value) => !value); navigatePage('script'); setSelected(0); show(debugRunning ? '已退出调试运行' : '已进入调试运行'); }}><BugPlay />{debugRunning ? '停止调试' : '调试运行'}</button><button className="button primary" onClick={() => setModal('publish')}><Rocket />发布游戏</button><button className="icon-button" title="设置" onClick={() => setSettingsOpen(true)}><Settings2 /></button></div></nav>
    <main className={`workspace ${page === 'map' || page === 'stage' || page === 'characters' || page === 'scenes' || page === 'audio' ? 'map-workspace' : ''}`}>{!projectClosed && !['map', 'stage', 'characters', 'scenes', 'audio'].includes(page) && !sidebarCollapsed && <Sidebar project={project} activate={activate} addChapter={addChapter} addFragment={addFragment} removeFragment={removeFragment} openSettings={() => setChapterSettingsOpen(true)} toggleChapterDisabled={toggleChapterDisabled} collapseSidebar={() => setSidebarCollapsed(true)} structureAction={(action, chapterId, fragmentId) => void structureAction(action, chapterId, fragmentId)} />}{!projectClosed && !['map', 'stage', 'characters', 'scenes', 'audio'].includes(page) && sidebarCollapsed && <button className="sidebar-expand" title="展开章节列表" onClick={() => setSidebarCollapsed(false)}><ArrowRight /></button>}<section className="page-content"><AnimatePresence mode="wait" initial={false}><motion.div className="page-transition" key={projectClosed ? 'closed' : page} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -7 }} transition={{ duration: reducedMotion ? .08 : .22, ease: [.2, .8, .2, 1] }}>{projectClosed ? <div className="closed-project"><FolderOpen /><strong>没有打开的项目</strong><span>新建项目或打开本地 Hikari v3 项目继续创作。</span><div><button className="button primary" onClick={() => void doNew()}><FilePlus2 />新建项目</button><button className="button ghost" onClick={() => void doOpen()}><FolderOpen />打开项目</button></div></div> : pages[page]}</motion.div></AnimatePresence></section></main>
    <ModalLayer modal={modal} project={project} close={() => setModal(null)} addBlock={addBlock} runBuild={(kind) => void runBuild(kind)} />
    {modal === 'search' && <SearchPalette project={project} close={() => setModal(null)} locate={locateSearchResult} replaceText={replaceProjectText} />}
    <RuntimeSettingsDialog open={settingsOpen} project={project} close={() => setSettingsOpen(false)} apply={(settings, resolution) => { commit((current) => ({ ...current, settings, meta: { ...current.meta, resolution } }), '更新运行设置'); setSettingsOpen(false); show('运行设置已更新'); }} />
    <EditorAppearanceDialog open={themeOpen} close={() => setThemeOpen(false)} openGameTheme={() => setGameThemeOpen(true)} />
    <GameUiThemeDialog open={gameThemeOpen} project={project} close={() => setGameThemeOpen(false)} relinkAsset={async (assetId) => { const replacement = await replaceAssetFile(assetId); if (!replacement) return; commit((current) => { const existing = current.assets.find((asset) => asset.id === assetId); const next = { ...existing, ...replacement, id: assetId, forceBundle: existing?.forceBundle } as Asset; return { ...current, assets: existing ? current.assets.map((asset) => asset.id === assetId ? next : asset) : [...current.assets, next] }; }, `重新定位游戏 UI 素材 ${assetId}`); show('游戏 UI 素材已恢复'); }} apply={(ui, gameVersion) => { commit((current) => ({ ...current, ui, meta: { ...current.meta, gameVersion } }), '更新游戏 UI 主题'); setGameThemeOpen(false); show('游戏 UI 主题已应用'); }} />
    <ChapterSchedulingDialog open={chapterSettingsOpen} project={project} close={() => setChapterSettingsOpen(false)} apply={(chapterScheduling) => { commit((current) => ({ ...current, settings: { ...current.settings, chapterScheduling } }), '更新章节调度'); setChapterSettingsOpen(false); show('章节运行设置已更新'); }} />
    <NotificationCenter open={notificationsOpen} items={notifications} close={() => setNotificationsOpen(false)} markAllRead={() => setNotifications((items) => items.map((item) => ({ ...item, read: true })))} clear={() => setNotifications([])} />
    <ScriptImportDialog open={scriptImportOpen} busy={scriptImportBusy} preview={scriptImportPreview} close={() => { setScriptImportOpen(false); setScriptImportPreview(null); }} selectFile={() => void selectScriptImport()} apply={applyScriptImport} />
    <FrontendDialog dialog={appDialog} updateValue={(value) => setAppDialog((current) => current ? { ...current, value } : current)} close={closeAppDialog} />
    <AnimatePresence>{toast && <motion.div className={`toast show ${toast.tone === 'error' ? 'error' : ''}`} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: .98 }} transition={{ duration: reducedMotion ? .08 : .2 }}><CheckCircle2 /><span>{toast.text}</span></motion.div>}</AnimatePresence>
  </div>;
}
