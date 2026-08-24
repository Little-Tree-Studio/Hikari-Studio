import { Profiler, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlignLeft, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AudioLines, Bell, BookOpen, Braces, BugPlay,
  CheckCircle2, ChevronDown, ChevronsUpDown, CircleAlert, CirclePlay, Clapperboard, Code2, Copy, CornerDownRight,
  FilePlus2, FileText, FileUp, Flag, FolderOpen, FolderPlus,
  GitBranch, GitFork, GripVertical, HardDrive, History, Image, Languages, LocateFixed, Maximize2,
  LogOut, Menu, MessageSquareText, Minus, Music2, NotebookPen, PackageCheck, Palette, Plus,
  Pin, Redo2, Rocket, Save, Search, Settings2, ShieldCheck,
  Sparkles, Trash2, Undo2, UserPlus, UserRound, Users, X, PanelBottom, PanelRight, PictureInPicture2, LoaderCircle,
} from 'lucide-react';
import {
  buildWeb, buildWindows, callWindow, createProject, exportRenpy, getAppInfo, getRecoverySnapshotStatus, importAssets, loadProjectWithPerformance, preflightBuild, reportProjectReloadPerformance,
  applyAiPatch, loadCommandHistory, loadCommandHistoryStats, loadRecoverySnapshot, openProject, openProjectPath, openRecentProject, previewClipboardScript, previewScriptImport, readClipboardText, replaceAssetFile, saveCommandHistory, saveProject, saveProjectAs, writeClipboardText,
} from './api';
import { Preview } from './components/Preview';
import { AiAgentPanel } from './components/AiAgentPanel';
import { NotificationCenter } from './components/NotificationCenter';
import { RuntimeSettingsDialog } from './components/RuntimeSettingsDialog';
import { GameUiThemeDialog } from './components/GameUiThemeDialog';
import { EditorAppearanceDialog } from './components/EditorAppearanceDialog';
import { ChapterSchedulingDialog } from './components/ChapterSchedulingDialog';
import { SearchPalette, type SearchLocation } from './components/SearchPalette';
import { ScriptImportDialog, loadScriptImportRules } from './components/ScriptImportDialog';
import { NarrativeMap } from './components/NarrativeMap';
import { CharacterManager } from './components/CharacterManager';
import { SceneManager } from './components/SceneManager';
import { AudioManager } from './components/AudioManager';
import { AssetManager } from './components/AssetManager';
import { TextWorkbench } from './components/TextWorkbench';
import { Checkbox } from './components/ui/Checkbox';
import { Select } from './components/ui/Select';
import { Slider } from './components/ui/Slider';
import { EditorAssetImportDialog, type EditorImportAction } from './components/EditorAssetImportDialog';
import { StageTimelineWorkspace } from './components/StageTimelineWorkspace';
import { ProjectLaunchScreen } from './components/ProjectLaunchScreen';
import { DesktopMaintenanceDialog } from './components/DesktopMaintenanceDialog';
import { BuildPublishDialog } from './components/BuildPublishDialog';
import { BuildProgressDialog } from './components/BuildProgressDialog';
import { DialogueStoryCard } from './components/story/DialogueStoryCard';
import { EditorTabBar } from './components/EditorTabBar';
import { applyAssetImport, describeAssetImport } from './core/assetImport';
import { audioCategoryOf, matchingVoice } from './core/audio';
import { log } from './core/logger';
import { buildAgentPatchSemanticRecord, restoreAgentPatchCategory, type AgentPatchSemanticRecord } from './core/agentPatchHistory';
import { diffProjects, type ProjectDiff } from './core/projectDiff';
import { readSmallValue, removeSmallValue, writeSmallValue } from './core/storage';
import { defaultEditorSession, loadEditorSession, saveEditorSession, type EditorSessionState } from './core/editorSession';
import { projectScenes, sceneBlockSnapshot } from './core/scenes';
import { useEditorAppearance } from './core/editorAppearance';
import { defaultLanguage, projectLanguages } from './core/localization';
import { remapTimeline } from './core/timeline';
import { buildKindLabel, completeBuildProgress, createBuildProgressTask, failBuildProgress, updateBuildProgress, type BuildProgressTask } from './core/buildProgress';
import { createBlock } from './engine-core/blocks';
import { diagnosticSummary } from './engine-core/diagnostics';
import { useCommandHistory, type CommandRestoreStrategies, type CommandSnapshotEntry, type PersistedCommandHistory } from './hooks/useCommandHistory';
import { useFixedVirtualList, useMeasuredVirtualList } from './hooks/useVirtualList';
import { beginComponentRenderProfile, cancelComponentRenderProfile, finishComponentRenderProfile, recordComponentRender } from './performance/renderProfiler';
import type { AgentOperation, AppNotification, Asset, AudioCategory, BlockType, BrowserMode, BuildPreflightReport, BuildTarget, CommandHistoryStorageStats, ConditionOperator, InspectorDock, Project, ProjectCreationOptions, ProjectLoadPerformance, ProjectReloadFrontendPerformance, ProjectReloadPerformance, RecoverySnapshot, RecoverySnapshotStatus, ScriptImportPreview, ScriptImportRules, StoryBlock, StoryBlockPatch } from './types';

const SaveAs = Copy;

const commandRestoreStrategies: CommandRestoreStrategies<Project> = {
  'agent-patch': (current, before, after, categoryId, payload) => restoreAgentPatchCategory(current, before, after, categoryId, payload as AgentPatchSemanticRecord),
};

type Page = 'script' | 'stage' | 'texts' | 'assets' | 'audio' | 'map' | 'characters' | 'scenes' | 'history' | 'ai';
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

type ProjectRestorePerformance = Pick<ProjectReloadFrontendPerformance, 'commandHistoryLoadMs' | 'recoverySnapshotLoadMs' | 'historyStatsLoadMs' | 'historyRestoreMs' | 'stateDispatchMs'> & { stateDispatchStartedAt: number };
type PendingProjectReload = { projectId: string; load: ProjectLoadPerformance; restore?: ProjectRestorePerformance; finalizing?: boolean };
type PendingBlockReveal = { fragmentId: string; blockId: string };

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
      { id: 'b4', type: 'dialogue', speaker: '林澄', text: '你果然还是来了。', expression: '浅笑' },
      { id: 'b5', type: 'dialogue', speaker: '苏芮', text: '因为有人在信里说，错过今天就再也见不到这片星海了。', expression: '平静' },
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
  const treeScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!chapterMenu) return; const close = () => setChapterMenu(null); window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close); }, [chapterMenu]);
  const projectScale = useMemo(() => Object.values(project.scripts).reduce((scale, blocks) => {
    scale.blocks += blocks.length;
    for (const block of blocks) scale.words += block.text?.length ?? 0;
    return scale;
  }, { words: 0, blocks: 0 }), [project.scripts]);
  const rows = useMemo(() => project.chapters.flatMap((chapter, chapterIndex) => {
    const chapterRow = [{ kind: 'chapter' as const, key: `chapter:${chapter.id}`, chapter, chapterIndex }];
    if (collapsed.has(chapter.id)) return chapterRow;
    return [...chapterRow, ...chapter.fragments.map((fragment, fragmentIndex) => ({ kind: 'fragment' as const, key: `fragment:${fragment.id}`, chapter, chapterIndex, fragment, fragmentIndex }))];
  }), [project.chapters, collapsed]);
  const activeRowIndex = useMemo(() => {
    const fragmentIndex = rows.findIndex((row) => row.kind === 'fragment' && row.fragment.id === project.activeFragmentId);
    if (fragmentIndex >= 0) return fragmentIndex;
    return rows.findIndex((row) => row.kind === 'chapter' && row.chapter.fragments.some((fragment) => fragment.id === project.activeFragmentId));
  }, [rows, project.activeFragmentId]);
  const treeVirtual = useFixedVirtualList(treeScrollRef, rows.length, 35, activeRowIndex >= 0 ? [activeRowIndex] : [], 8);
  useEffect(() => { if (activeRowIndex >= 0) treeVirtual.scrollToIndex(activeRowIndex); }, [activeRowIndex, rows.length]);
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
      <div className="tree-virtual-scroll" ref={treeScrollRef} onScroll={treeVirtual.onScroll} role="tree" aria-label="章节与片段">
        <div className="tree-virtual-canvas" style={{ height: treeVirtual.totalSize }}>
          {treeVirtual.indexes.map((index) => {
            const row = rows[index];
            if (row.kind === 'chapter') return <div className="tree-virtual-row" style={{ transform: `translateY(${index * 35}px)` }} key={row.key}><div className={`chapter-row ${row.chapter.disabled ? 'disabled' : ''} ${collapsed.has(row.chapter.id) ? 'collapsed' : ''} ${row.chapter.fragments.some((fragment) => fragment.id === project.activeFragmentId) ? 'active' : ''}`} role="treeitem" tabIndex={0} aria-expanded={!collapsed.has(row.chapter.id)} onContextMenu={(event) => { event.preventDefault(); setChapterMenu({ chapterId: row.chapter.id, x: event.clientX, y: event.clientY }); }} onClick={() => toggleChapter(row.chapter.id)} onKeyDown={(event) => toggleWithKeyboard(event, row.chapter.id)}><ChevronDown className="chapter-chevron" />{row.chapter.entry ? <CirclePlay /> : <BookOpen />}<span>{row.chapter.name}</span>{row.chapter.disabled && <em>已禁用</em>}<span className="count">{row.chapter.fragments.length}</span><button className="tree-action" title="新建片段" onClick={(event) => { event.stopPropagation(); addFragment(row.chapter.id); }}><Plus /></button></div></div>;
            return <div className="tree-virtual-row" style={{ transform: `translateY(${index * 35}px)` }} key={row.key}><div role="treeitem" aria-level={2} className={`fragment-row virtual ${row.chapter.disabled ? 'disabled' : ''} ${row.fragment.id === project.activeFragmentId ? 'active' : ''}`} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setChapterMenu({ chapterId: row.chapter.id, fragmentId: row.fragment.id, x: event.clientX, y: event.clientY }); }} onClick={() => activate(row.fragment.id)}><CornerDownRight /><span>{row.fragment.name}</span><em>{project.scripts[row.fragment.id]?.length ?? 0}</em>{!row.chapter.entry && <button className="tree-action" title="删除片段" onClick={(event) => { event.stopPropagation(); removeFragment(row.chapter.id, row.fragment.id); }}><Trash2 /></button>}</div></div>;
          })}
        </div>
      </div>
      {chapterMenu && <div className="context-menu chapter-context-menu" style={{ left: chapterMenu.x, top: chapterMenu.y }} onPointerDown={(event) => event.stopPropagation()}>{!chapterMenu.fragmentId && !project.chapters.find((chapter) => chapter.id === chapterMenu.chapterId)?.entry && <button onClick={() => { toggleChapterDisabled(chapterMenu.chapterId); setChapterMenu(null); }}>{project.chapters.find((chapter) => chapter.id === chapterMenu.chapterId)?.disabled ? '启用此章' : '禁用此章'}</button>}<strong>{chapterMenu.fragmentId ? 'Fragment' : '章节'}</strong><button onClick={() => { structureAction('copy', chapterMenu.chapterId, chapterMenu.fragmentId); setChapterMenu(null); }}>复制</button><button disabled={project.chapters.find((chapter) => chapter.id === chapterMenu.chapterId)?.entry} onClick={() => { structureAction('cut', chapterMenu.chapterId, chapterMenu.fragmentId); setChapterMenu(null); }}>剪切</button><button onClick={() => { structureAction('duplicate', chapterMenu.chapterId, chapterMenu.fragmentId); setChapterMenu(null); }}>创建副本</button><button onClick={() => { structureAction('paste', chapterMenu.chapterId, chapterMenu.fragmentId); setChapterMenu(null); }}>粘贴</button><button onClick={() => setChapterMenu(null)}>取消</button></div>}
    </div>
    <div className="sidebar-footer"><div><span>项目规模</span><strong>{projectScale.words} 字</strong></div><div className="progress"><span style={{ width: `${Math.min(100, projectScale.words / 50)}%` }} /></div><small>{projectScale.blocks} Blocks · {project.assets.length} 素材</small></div>
  </aside>;
}

interface StoryCardProps {
  index: number;
  project: Project;
  block: StoryBlock;
  selected: boolean;
  asset?: Asset;
  voiceAsset?: Asset;
  onSelect: (index: number, event?: Pick<ReactMouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onChange: (index: number, patch: StoryBlockPatch) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  dragging: boolean;
  listDragging: boolean;
  onPointerDown: (index: number, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => boolean;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

const StoryCard = memo(function StoryCard({ index, project, block, selected, asset, voiceAsset, onSelect, onContextMenu, onChange, onMove, onDuplicate, onDelete, dragging, listDragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: StoryCardProps) {
  const meta = blockMeta[block.type];
  const Icon = meta.icon;
  const characters = project.characters;
  const hasSceneBackground = block.type === 'scene' && Boolean(asset?.uri);
  const cardDragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressCardClickRef = useRef(false);
  const selectedOnPointerDownRef = useRef(false);
  const isCardInteractionTarget = (target: HTMLElement) => Boolean(target.closest('button,input,textarea,select,a,[contenteditable="true"],[role="button"],[role="listbox"],[role="option"]'));
  const beginCardDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || !event.isPrimary || isCardInteractionTarget(target)) return;
    cardDragOriginRef.current = { x: event.clientX, y: event.clientY };
    suppressCardClickRef.current = false;
    onPointerDown(index, event);
  };
  const moveCardDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = cardDragOriginRef.current;
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= 4) suppressCardClickRef.current = true;
    onPointerMove(event);
  };
  const finishCardDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    cardDragOriginRef.current = null;
    const dragged = onPointerUp(event);
    suppressCardClickRef.current = dragged;
    if (!dragged) {
      selectedOnPointerDownRef.current = true;
      onSelect(index, event);
    }
  };
  const cancelCardDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    cardDragOriginRef.current = null;
    suppressCardClickRef.current = false;
    selectedOnPointerDownRef.current = false;
    onPointerCancel(event);
  };
  return <div className={`story-block ${dragging ? 'dragging' : ''} ${listDragging ? 'list-dragging' : ''}`}>
    <button className="block-handle" title="拖动 Block" aria-label={`拖动 ${meta.name}`} onPointerDown={(event) => onPointerDown(index, event)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}><GripVertical /></button>
    <div className={`block-card ${block.type} ${hasSceneBackground ? 'has-scene-background' : ''} ${selected ? 'selected' : ''}`} tabIndex={-1} title="拖动卡片可调整 Block 位置" onPointerDown={beginCardDrag} onPointerMove={moveCardDrag} onPointerUp={finishCardDrag} onPointerCancel={cancelCardDrag} onClick={(event) => { const selectedOnPointerDown = selectedOnPointerDownRef.current; selectedOnPointerDownRef.current = false; if (suppressCardClickRef.current) { suppressCardClickRef.current = false; event.preventDefault(); event.stopPropagation(); return; } if (!selectedOnPointerDown) onSelect(index, event); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!selected) onSelect(index); onContextMenu(event); }}>
      {block.type === 'scene' && asset?.uri && <img className="scene-card-background" src={asset.uri} alt="" draggable={false} />}
      <div className="block-meta"><Icon /><span>{meta.name}</span><span className="duration">{block.duration ? `${block.duration}s` : '--'}</span>{selected && <div className="block-commands"><button title="上移" onClick={(e) => { e.stopPropagation(); onMove(index, -1); }}><ArrowUp /></button><button title="下移" onClick={(e) => { e.stopPropagation(); onMove(index, 1); }}><ArrowDown /></button><button title="复制" onClick={(e) => { e.stopPropagation(); onDuplicate(index); }}><Copy /></button><button title="删除" onClick={(e) => { e.stopPropagation(); onDelete(index); }}><Trash2 /></button></div>}</div>
      {block.type === 'scene' && <div className="scene-summary scene-summary-background"><div><strong>{block.title ?? asset?.name ?? '未选择场景'}</strong><small>{block.transition ?? 'dissolve'} · {block.duration ?? 1} 秒</small></div></div>}
      {block.type === 'sound' && <div className="scene-summary"><div className="scene-thumb asset-audio"><AudioLines /></div><div><strong>{block.title}</strong><small>{block.loop ? '循环播放' : '单次播放'} · 音量 {Math.round((block.volume ?? 1) * 100)}%</small></div></div>}
      {block.type === 'characterShow' && <div className="control-summary"><UserRound /><strong>{block.characterId ?? '未选择角色'}</strong><span>{block.expression ?? '默认'} · {block.position ?? 'center'}</span></div>}
      {block.type === 'characterHide' && <div className="control-summary"><UserRound /><strong>{block.characterId ?? '未选择角色'}</strong><span>{block.animation ?? 'fade'}</span></div>}
      {block.type === 'camera' && <div className="control-summary"><LocateFixed /><strong>缩放 {Math.round((block.zoom ?? 1) * 100)}%</strong><span>偏移 {block.cameraX ?? 0}, {block.cameraY ?? 0} · {block.filter ?? 'none'}</span></div>}
      {block.type === 'narration' && (selected ? <div className="block-text" contentEditable suppressContentEditableWarning onBlur={(e) => { const text = e.currentTarget.textContent ?? ''; if (text !== (block.text ?? '')) onChange(index, { text }); }}>{block.text}</div> : <div className="block-text">{block.text}</div>)}
      {block.type === 'dialogue' && <DialogueStoryCard index={index} block={block} characters={characters} selected={selected} voiceAsset={voiceAsset} onChange={onChange} />}
      {block.type === 'branch' && <><div className="block-text"><strong>{block.title}</strong></div><div className="branch-options">{block.options?.map((option) => <div className="branch-option" key={option.text}><span>{option.text}</span><span>{option.target} →</span></div>)}</div></>}
      {block.type === 'setVariable' && <div className="control-summary"><Braces /><strong>{block.variable}</strong><span>= {String(block.value ?? '')}</span></div>}
      {block.type === 'condition' && <div className="control-summary"><GitBranch /><strong>{block.variable}</strong><span>{block.operator ?? 'eq'} {String(block.compareValue ?? '')}</span><em>{block.trueTarget ?? '继续'} / {block.falseTarget ?? '继续'}</em></div>}
      {(block.type === 'jump' || block.type === 'call') && <div className="control-summary"><Flag /><strong>{block.target ?? '未设置目标'}</strong></div>}
      {block.type === 'return' && <div className="control-summary"><CornerDownRight /><strong>返回上一个调用位置</strong></div>}
    </div>
  </div>;
}, (previous, next) => previous.index === next.index
  && previous.project.characters === next.project.characters
  && previous.block === next.block
  && previous.selected === next.selected
  && previous.asset === next.asset
  && previous.voiceAsset === next.voiceAsset
  && previous.dragging === next.dragging
  && previous.listDragging === next.listDragging);

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
    {block.type === 'dialogue' && <><div className="field"><label>说话角色</label><Select value={block.speaker ?? ''} onChange={(value) => { const character = project.characters.find((item) => item.name === value); update({ speaker: value, expression: character?.expressions[0] ?? '默认', displayNameSchemeId: undefined, voice: undefined }); }}>{project.characters.map((character) => <option key={character.id} value={character.name}>{character.name}</option>)}</Select></div><div className="field"><label>玩家显示名</label><Select value={block.displayNameSchemeId ?? ''} onChange={(value) => update({ displayNameSchemeId: value || undefined })}><option value="">角色主名称（{selectedCharacter?.name ?? '未选择'}）</option>{selectedCharacter?.displayNameSchemes?.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}</Select></div><div className="field"><label>差分表情</label><Select value={block.expression ?? selectedCharacter?.expressions[0] ?? ''} onChange={(value) => update({ expression: value })}>{selectedCharacter?.expressions.map((expression) => <option key={expression} value={expression}>{expression}{selectedCharacter.portraits?.[expression] ? '' : '（未配置图片）'}</option>)}</Select></div><div className="field"><label>语音文件</label><Select value={block.voice ?? ''} onChange={(value) => update({ voice: value || undefined })}><option value="">无语音</option>{voiceAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.asrText ? ` · ${asset.asrText.slice(0, 18)}` : ''}</option>)}</Select></div><button className="button ghost full" type="button" onClick={autoMatchVoice}><Sparkles />按识别文本自动匹配</button></>}
    {(block.type === 'dialogue' || block.type === 'narration') && <div className="field full"><label>文本内容</label><textarea value={block.text ?? ''} onChange={(e) => update({ text: e.target.value })} /></div>}
    {block.type === 'scene' && <><div className="field full"><label>场景配置</label><Select value={block.sceneId ?? sceneDefinitions.find((scene) => scene.layers.at(-1)?.assetId === block.assetId)?.id ?? ''} onChange={(value) => { const scene = sceneDefinitions.find((item) => item.id === value); if (scene) update(sceneBlockSnapshot(scene)); }}><option value="">未选择</option>{sceneDefinitions.map((scene) => <option key={scene.id} value={scene.id}>{scene.name} · {scene.layers.length}L</option>)}</Select></div><div className="field"><label>过渡</label><Select value={block.transition ?? 'dissolve'} onChange={(value) => update({ transition: value })}><option value="dissolve">交叉淡化</option><option value="fade">黑场</option><option value="none">硬切</option></Select></div><div className="field"><label>时长</label><input type="number" min="0" step=".1" value={block.duration ?? 1} onChange={(e) => update({ duration: Number(e.target.value) })} /></div><div className="scene-layer-list"><label>场景图层快照</label>{(block.layers ?? []).map((layer, index) => <div className="scene-layer-row" key={layer.id}><input aria-label={`场景层 ${index + 1} 名称`} value={layer.name} readOnly /><Select aria-label={`场景层 ${index + 1} 素材`} value={layer.assetId ?? ''} disabled><option value="">选择素材</option>{project.assets.filter((asset) => asset.kind === 'scene' || asset.kind === 'image').map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</Select><input aria-label={`场景层 ${index + 1} 透明度`} title="透明度" type="number" value={layer.opacity} readOnly /><input aria-label={`场景层 ${index + 1} 距离`} title="距离" type="number" value={layer.distance ?? 1} readOnly /></div>)}<small className="control-help">图层、距离和偏移请在场景管理中编辑，所有引用会自动同步。</small></div></>}
    {block.type === 'sound' && <><div className="field"><label>通道</label><Select value={block.channel ?? 'bgm'} onChange={(value) => update({ channel: value as 'bgm' | 'sfx' | 'voice', assetId: undefined, title: undefined })}><option value="bgm">BGM</option><option value="sfx">音效</option><option value="voice">语音</option></Select></div><div className="field"><label>动作</label><Select value={block.action ?? 'play'} onChange={(value) => update({ action: value as 'play' | 'stop' })}><option value="play">播放</option><option value="stop">停止</option></Select></div>{(block.action ?? 'play') === 'play' && <div className="field full"><label>音频资源</label><Select value={block.assetId ?? ''} onChange={(value) => { const asset = project.assets.find((item) => item.id === value); update({ assetId: asset?.id, title: asset?.name }); }}><option value="">选择音频</option>{soundAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.duration ? `${asset.duration.toFixed(1)}s` : '未知时长'}</option>)}</Select></div>}<div className="field full"><label>音量 {Math.round((block.volume ?? 1) * 100)}%</label><Slider ariaLabel="音量" min={0} max={1} step={0.01} value={block.volume ?? 1} onChange={(value) => update({ volume: value })} /></div><div className="field"><label>淡入淡出（秒）</label><input type="number" min="0" step=".1" value={block.fadeDuration ?? 0} onChange={(e) => update({ fadeDuration: Number(e.target.value) })} /></div><label className="checkbox-field"><Checkbox checked={block.loop ?? false} onChange={(checked) => update({ loop: checked })} />循环播放</label></>}
    {block.type === 'characterShow' && <><div className="field"><label>角色</label><Select value={block.characterId ?? ''} onChange={(value) => { const character = project.characters.find((item) => item.id === value); const expression = character?.expressions[0] ?? '默认'; update({ characterId: value, expression, assetId: character?.portraits?.[expression] }); }}>{project.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</Select></div><div className="field"><label>表情差分</label><Select value={block.expression ?? ''} onChange={(value) => update({ expression: value, assetId: selectedCharacter?.portraits?.[value] })}>{selectedCharacter?.expressions.map((expression) => <option key={expression} value={expression}>{expression}</option>)}</Select></div><div className="field full"><label>立绘素材</label><Select value={block.assetId ?? selectedCharacter?.portraits?.[block.expression ?? '默认'] ?? ''} onChange={(value) => update({ assetId: value || undefined })}><option value="">使用角色表情配置</option>{project.assets.filter((asset) => asset.kind === 'character' || asset.kind === 'image').map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</Select></div><div className="field"><label>站位</label><Select value={block.position ?? 'center'} onChange={(value) => { const position = value as StoryBlockPatch['position']; update({ position, ...(position === 'custom' ? { x: block.x ?? 50, y: block.y ?? 100 } : { x: undefined, y: undefined }) }); }}><option value="farLeft">最左</option><option value="left">左</option><option value="center">中央</option><option value="right">右</option><option value="farRight">最右</option><option value="custom">自定义</option></Select></div>{block.position === 'custom' && <><div className="field"><label>水平位置 X · %</label><input type="number" min="0" max="100" step="1" value={block.x ?? 50} onChange={(e) => update({ x: Math.max(0, Math.min(100, Number(e.target.value))) })} /></div><div className="field"><label>垂直位置 Y · %</label><input type="number" min="0" max="100" step="1" value={block.y ?? 100} onChange={(e) => update({ y: Math.max(0, Math.min(100, Number(e.target.value))) })} /></div></>}<div className="field"><label>入场动画</label><Select value={block.animation ?? 'fade'} onChange={(value) => update({ animation: value as StoryBlockPatch['animation'] })}><option value="none">无</option><option value="fade">淡入</option><option value="slideLeft">从左滑入</option><option value="slideRight">从右滑入</option><option value="zoom">缩放</option></Select></div><div className="field"><label>缩放</label><input type="number" min=".1" max="3" step=".1" value={block.scale ?? 1} onChange={(e) => update({ scale: Number(e.target.value) })} /></div><div className="field"><label>图层</label><input type="number" value={block.layer ?? 0} onChange={(e) => update({ layer: Number(e.target.value) })} /></div></>}
    {block.type === 'characterHide' && <><div className="field"><label>角色</label><Select value={block.characterId ?? ''} onChange={(value) => update({ characterId: value })}>{project.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</Select></div><div className="field"><label>退场动画</label><Select value={block.animation ?? 'fade'} onChange={(value) => update({ animation: value as StoryBlockPatch['animation'] })}><option value="none">无</option><option value="fade">淡出</option><option value="slideLeft">向左滑出</option><option value="slideRight">向右滑出</option><option value="zoom">缩放</option></Select></div></>}
    {block.type === 'camera' && <><div className="field"><label>水平偏移</label><input type="number" value={block.cameraX ?? 0} onChange={(e) => update({ cameraX: Number(e.target.value) })} /></div><div className="field"><label>垂直偏移</label><input type="number" value={block.cameraY ?? 0} onChange={(e) => update({ cameraY: Number(e.target.value) })} /></div><div className="field"><label>缩放</label><input type="number" min=".1" max="5" step=".1" value={block.zoom ?? 1} onChange={(e) => update({ zoom: Number(e.target.value) })} /></div><div className="field"><label>震动强度</label><input type="number" min="0" max="100" value={block.shake ?? 0} onChange={(e) => update({ shake: Number(e.target.value) })} /></div><div className="field full"><label>滤镜</label><Select value={block.filter ?? 'none'} onChange={(value) => update({ filter: value as StoryBlockPatch['filter'] })}><option value="none">无</option><option value="monochrome">黑白</option><option value="sepia">怀旧</option><option value="blur">模糊</option><option value="vignette">暗角</option></Select></div></>}
    {block.type === 'branch' && <><div className="field full"><label>问题</label><input value={block.title ?? ''} onChange={(e) => update({ title: e.target.value })} /></div>{block.options?.map((option, index) => <div className="branch-edit full" key={index}><input value={option.text} onChange={(e) => update({ options: block.options?.map((item, i) => i === index ? { ...item, text: e.target.value } : item) })} /><Select value={option.target} onChange={(value) => update({ options: block.options?.map((item, i) => i === index ? { ...item, target: value } : item) })}>{fragmentOptions.map((fragment) => <option key={fragment.id} value={fragment.id}>{fragment.name}</option>)}</Select><button className="icon-button" onClick={() => update({ options: block.options?.filter((_, i) => i !== index) })}><Trash2 /></button></div>)}<button className="button full" onClick={() => update({ options: [...(block.options ?? []), { text: '新选项', target: project.activeFragmentId }] })}><Plus />添加选项</button></>}
    {block.type === 'setVariable' && <><div className="field"><label>变量名</label><input value={block.variable ?? ''} onChange={(e) => update({ variable: e.target.value })} /></div><div className="field"><label>设置为</label><input value={String(block.value ?? '')} onChange={(e) => update({ value: e.target.value })} /></div></>}
    {block.type === 'condition' && <><div className="field"><label>变量名</label><input value={block.variable ?? ''} onChange={(e) => update({ variable: e.target.value })} /></div><div className="field"><label>比较方式</label><Select value={block.operator ?? 'eq'} onChange={(value) => update({ operator: value as ConditionOperator })}><option value="eq">等于</option><option value="neq">不等于</option><option value="gt">大于</option><option value="gte">大于等于</option><option value="lt">小于</option><option value="lte">小于等于</option></Select></div><div className="field full"><label>比较值</label><input value={String(block.compareValue ?? '')} onChange={(e) => update({ compareValue: e.target.value })} /></div><div className="field"><label>条件成立</label><Select value={block.trueTarget ?? ''} onChange={(value) => update({ trueTarget: value || undefined })}><option value="">继续执行</option>{fragmentOptions.map((fragment) => <option key={fragment.id} value={fragment.id}>{fragment.name}</option>)}</Select></div><div className="field"><label>条件不成立</label><Select value={block.falseTarget ?? ''} onChange={(value) => update({ falseTarget: value || undefined })}><option value="">继续执行</option>{fragmentOptions.map((fragment) => <option key={fragment.id} value={fragment.id}>{fragment.name}</option>)}</Select></div></>}
    {(block.type === 'jump' || block.type === 'call') && <div className="field full"><label>目标片段</label><Select value={block.target ?? ''} onChange={(value) => update({ target: value })}>{fragmentOptions.map((fragment) => <option key={fragment.id} value={fragment.id}>{fragment.name}</option>)}</Select></div>}
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
  openBlocks: (insertIndex?: number) => void;
  openImport: () => void;
  requestConfirm: RequestConfirm;
  openFragmentIds: string[];
  activateFragment: (id: string, blockIndex?: number) => void;
  closeFragment: (id: string) => void;
  closeOtherFragments: () => void;
  closeAllFragments: () => void;
  reorderFragmentTabs: (fromId: string, toId: string) => void;
  inspectorDock: InspectorDock;
  setInspectorDock: (dock: InspectorDock) => void;
  initialScrollTop: number;
  saveScrollTop: (value: number) => void;
  debugRunning: boolean;
  notify: (message: string, tone?: 'error' | 'success') => void;
  pendingBlockReveal: PendingBlockReveal | null;
  completeBlockReveal: (blockId: string) => void;
  previewLanguage?: string;
  onPreviewLanguageChange?: (language: string) => void;
}

function estimatedCardBlockHeight(block: StoryBlock): number {
  if (block.type === 'branch') return 132 + (block.options?.length ?? 0) * 31;
  if (block.type === 'dialogue') return 158;
  if (block.type === 'scene' || block.type === 'sound') return 145;
  if (block.type === 'narration') return 132;
  return 122;
}

function estimatedPlainBlockHeight(block: StoryBlock): number {
  return block.type === 'branch' ? 42 + (block.options?.length ?? 0) * 20 : 42;
}

function MeasuredVirtualRow({ itemKey, index, top, measure, className, children }: { itemKey: string; index: number; top: number; measure: (key: string, element: HTMLElement | null) => () => void; className: string; children: ReactNode }) {
  const cleanupRef = useRef<() => void>(() => undefined);
  const setRowRef = useCallback((element: HTMLDivElement | null) => {
    cleanupRef.current();
    cleanupRef.current = element ? measure(itemKey, element) : () => undefined;
  }, [itemKey, measure]);
  return <div ref={setRowRef} data-virtual-index={index} className={className} style={{ transform: `translateY(${top}px)` }}>{children}</div>;
}

function ScriptPage({ project, commit, selected, setSelected, view, setView, openBlocks, openImport, requestConfirm, openFragmentIds, activateFragment, closeFragment, closeOtherFragments, closeAllFragments, reorderFragmentTabs, inspectorDock, setInspectorDock, initialScrollTop, saveScrollTop, debugRunning, notify, pendingBlockReveal, completeBlockReveal, previewLanguage, onPreviewLanguageChange }: ScriptPageProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverEdge, setDragOverEdge] = useState<'before' | 'after'>('before');
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(() => new Set([selected]));
  const selectionAnchorRef = useRef(selected);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [composerText, setComposerText] = useState('');
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerMenuPos, setComposerMenuPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  const openComposerMenu = useCallback(() => {
    const host = composerRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const margin = 6;
    const safeTop = 60;
    const safeBottom = 8;
    const spaceAbove = rect.top - safeTop - margin;
    const spaceBelow = window.innerHeight - rect.bottom - safeBottom - margin;
    const openAbove = spaceAbove >= 260 || spaceAbove >= spaceBelow;
    const maxHeight = Math.max(160, Math.min(openAbove ? spaceAbove : spaceBelow, 520));
    const width = Math.min(460, Math.max(320, rect.width - 96));
    const left = Math.max(8, Math.min(rect.left + 88, window.innerWidth - width - 8));
    setComposerMenuPos(openAbove
      ? { left, bottom: window.innerHeight - rect.top + margin, width, maxHeight }
      : { left, top: rect.bottom + margin, width, maxHeight });
    setComposerMenuOpen(true);
  }, []);
  useEffect(() => {
    if (!composerMenuOpen) return;
    const close = () => setComposerMenuOpen(false);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const onPointerDown = (event: PointerEvent) => { const target = event.target as HTMLElement | null; if (!target?.closest('.composer-menu, .quick-composer')) close(); };
    const onScroll = (event: Event) => { const target = event.target as Element | null; if (target?.closest('.composer-menu')) return; close(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('pointerdown', onPointerDown, true); window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll, true); };
  }, [composerMenuOpen]);
  const [dialogueCharacterId, setDialogueCharacterId] = useState<string | null>(null);
  const [dialogueSchemeId, setDialogueSchemeId] = useState<string>('');
  const [droppedAssets, setDroppedAssets] = useState<Asset[]>([]);
  const [assetDropActive, setAssetDropActive] = useState(false);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  const dragSourceRef = useRef<number | null>(null);
  const dragTargetSlotRef = useRef<number | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const dragMovedRef = useRef(false);
  const dragOverIndexRef = useRef<number | null>(null);
  const dragOverEdgeRef = useRef<'before' | 'after'>('before');
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const dragGhostRef = useRef<HTMLElement | null>(null);
  const dragSourceCardRef = useRef<HTMLElement | null>(null);
  const dragGhostOffsetRef = useRef({ x: 0, y: 0 });
  const blocksAreaRef = useRef<HTMLDivElement>(null);
  const plainAreaRef = useRef<HTMLDivElement>(null);
  const selectionScrollReadyRef = useRef(false);
  const selectionScrollFragmentRef = useRef(project.activeFragmentId);
  const skipSelectionScrollRef = useRef(false);
  const scrollSaveTimer = useRef(0);
  const blocks = project.scripts[project.activeFragmentId] ?? [];
  const selectedBlock = blocks[selected];
  const activeDialogueCharacter = project.characters.find((character) => character.id === dialogueCharacterId);
  const blockKeys = useMemo(() => blocks.map((block) => block.id), [blocks]);
  const assetLookups = useMemo(() => {
    const byId = new Map<string, Asset>();
    const byReference = new Map<string, Asset>();
    for (const asset of project.assets) {
      byId.set(asset.id, asset);
      byReference.set(asset.id, asset);
      byReference.set(asset.name, asset);
      byReference.set(asset.path?.split(/[\\/]/).at(-1) ?? asset.path, asset);
    }
    return { byId, byReference };
  }, [project.assets]);
  const estimateCardSize = useCallback((index: number) => estimatedCardBlockHeight(blocks[index]), [blocks]);
  const estimatePlainSize = useCallback((index: number) => estimatedPlainBlockHeight(blocks[index]), [blocks]);
  const pinnedVirtualIndexes = [selected, draggedIndex ?? -1, dragOverIndex ?? -1];
  const cardVirtual = useMeasuredVirtualList(blocksAreaRef, blockKeys, estimateCardSize, pinnedVirtualIndexes, 1, initialScrollTop);
  const plainVirtual = useMeasuredVirtualList(plainAreaRef, blockKeys, estimatePlainSize, [selected], 2, initialScrollTop);
  useEffect(() => {
    if (!selectionScrollReadyRef.current || selectionScrollFragmentRef.current !== project.activeFragmentId) {
      selectionScrollReadyRef.current = true;
      selectionScrollFragmentRef.current = project.activeFragmentId;
      return;
    }
    if (skipSelectionScrollRef.current) {
      skipSelectionScrollRef.current = false;
      return;
    }
    if (selected < 0 || selected >= blocks.length) return;
    if (view === 'cards') cardVirtual.scrollToIndex(selected);
    else if (view === 'plain') plainVirtual.scrollToIndex(selected);
  }, [selected, blocks.length, view, project.activeFragmentId]);
  useEffect(() => {
    if (!pendingBlockReveal || pendingBlockReveal.fragmentId !== project.activeFragmentId || view !== 'cards') return;
    const index = blocks.findIndex((block) => block.id === pendingBlockReveal.blockId);
    if (index < 0) return;
    const blockId = pendingBlockReveal.blockId;
    setHighlightedBlockId(blockId);
    cardVirtual.scrollToIndex(index, 'center');
    let focusFrame = 0;
    const mountFrame = window.requestAnimationFrame(() => {
      cardVirtual.scrollToIndex(index, 'center');
      focusFrame = window.requestAnimationFrame(() => {
        const row = blocksAreaRef.current?.querySelector<HTMLElement>(`[data-block-index="${index}"]`);
        const cardField = row?.querySelector<HTMLElement>('.block-card input:not([disabled]):not([readonly]), .block-card textarea:not([disabled]):not([readonly]), .block-card select:not([disabled]), .block-card [contenteditable="true"], .block-card .dialogue-picker-trigger');
        const inspectorField = document.querySelector<HTMLElement>('.editor-layout .inspector-body input:not([disabled]):not([readonly]), .editor-layout .inspector-body textarea:not([disabled]):not([readonly]), .editor-layout .inspector-body select:not([disabled])');
        const target = cardField ?? inspectorField ?? row?.querySelector<HTMLElement>('.block-card');
        target?.focus({ preventScroll: true });
        if (target instanceof HTMLTextAreaElement) target.select();
        else if (target instanceof HTMLInputElement && ['text', 'search', 'url', 'email', 'tel', 'password'].includes(target.type)) target.select();
        else if (target?.isContentEditable) {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(target);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });
    });
    const highlightTimer = window.setTimeout(() => {
      setHighlightedBlockId((current) => current === blockId ? null : current);
      completeBlockReveal(blockId);
    }, 1100);
    return () => {
      window.cancelAnimationFrame(mountFrame);
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(highlightTimer);
    };
  }, [pendingBlockReveal, project.activeFragmentId, view, cardVirtual.scrollToIndex, completeBlockReveal]);
  useEffect(() => {
    cardVirtual.setScrollOffset(initialScrollTop);
    plainVirtual.setScrollOffset(initialScrollTop);
  }, [project.activeFragmentId]);
  useEffect(() => {
    const nextIndex = blocks.length ? Math.min(selected, blocks.length - 1) : -1;
    setSelectedIndexes((current) => {
      if (nextIndex < 0) return current.size ? new Set() : current;
      return current.size === 1 && current.has(nextIndex) ? current : new Set([nextIndex]);
    });
    selectionAnchorRef.current = selected;
    setContextMenu(null);
    setDialogueCharacterId(null);
    setDialogueSchemeId('');
  }, [project.activeFragmentId]);
  useEffect(() => { if (blocks.length && selected >= blocks.length) { const index = blocks.length - 1; setSelected(index); setSelectedIndexes(new Set([index])); selectionAnchorRef.current = index; } else if (!blocks.length && selectedIndexes.size) setSelectedIndexes(new Set()); }, [blocks.length, selected]);
  useEffect(() => { if (selected >= 0 && selected < blocks.length && !selectedIndexes.has(selected)) { setSelectedIndexes(new Set([selected])); selectionAnchorRef.current = selected; } }, [selected]);
  useEffect(() => { const close = () => setContextMenu(null); window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close); }, []);
  const updateBlock = (index: number, patch: StoryBlockPatch) => commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: current.scripts[current.activeFragmentId].map((item, i) => i === index ? { ...item, ...patch } as StoryBlock : item) } }));
  const selectBlock = (index: number, event?: Pick<ReactMouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => {
    const rangeAnchor = selectionAnchorRef.current;
    if (!event?.shiftKey) selectionAnchorRef.current = index;
    if (event) skipSelectionScrollRef.current = true;
    setSelected(index);
    setSelectedIndexes((current) => {
      if (event?.shiftKey) {
        const next = new Set<number>();
        for (let value = Math.min(rangeAnchor, index); value <= Math.max(rangeAnchor, index); value += 1) next.add(value);
        return next;
      }
      if (event?.ctrlKey || event?.metaKey) {
        const next = new Set(current);
        if (next.has(index) && next.size > 1) next.delete(index); else next.add(index);
        return next;
      }
      return new Set([index]);
    });
  };
  const openBlockContextMenu = useCallback((event: ReactMouseEvent) => {
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);
  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction; if (target < 0 || target >= blocks.length) return;
    commit((current) => { const next = [...current.scripts[current.activeFragmentId]]; [next[index], next[target]] = [next[target], next[index]]; return { ...current, scripts: { ...current.scripts, [current.activeFragmentId]: next } }; }); setSelected(target);
  };
  const reorderBlock = (from: number, targetSlot: number) => {
    if (from < 0 || from >= blocks.length || targetSlot < 0 || targetSlot > blocks.length) return;
    const insertion = targetSlot > from ? targetSlot - 1 : targetSlot;
    if (from === insertion) {
      setSelected(from);
      setSelectedIndexes(new Set([from]));
      selectionAnchorRef.current = from;
      return;
    }
    commit((current) => {
      const next = [...current.scripts[current.activeFragmentId]];
      const [moved] = next.splice(from, 1);
      next.splice(insertion, 0, moved);
      return { ...current, scripts: { ...current.scripts, [current.activeFragmentId]: next } };
    }, '拖动 Block 排序');
    setSelected(insertion);
    setSelectedIndexes(new Set([insertion]));
    selectionAnchorRef.current = insertion;
  };
  const beginPointerDrag = (index: number, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const sourceCard = event.currentTarget.closest('.story-block')?.querySelector<HTMLElement>('.block-card');
    dragSourceCardRef.current = sourceCard ?? null;
    if (sourceCard) {
      const bounds = sourceCard.getBoundingClientRect();
      dragGhostOffsetRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    }
    dragSourceRef.current = index;
    dragTargetSlotRef.current = index;
    dragOriginRef.current = { x: event.clientX, y: event.clientY };
    dragPointerRef.current = { x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
    dragOverIndexRef.current = index;
    dragOverEdgeRef.current = 'before';
  };

  const activatePointerDrag = () => {
    const index = dragSourceRef.current;
    const sourceCard = dragSourceCardRef.current;
    if (index === null || !sourceCard || dragGhostRef.current) return;
    const bounds = sourceCard.getBoundingClientRect();
    const ghost = sourceCard.cloneNode(true) as HTMLElement;
    ghost.classList.remove('selected');
    ghost.classList.add('block-drag-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.removeAttribute('title');
    ghost.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    ghost.querySelectorAll('[contenteditable]').forEach((element) => element.removeAttribute('contenteditable'));
    ghost.style.width = `${bounds.width}px`;
    ghost.style.height = `${bounds.height}px`;
    ghost.style.transform = `translate3d(${Math.round(bounds.left)}px,${Math.round(bounds.top)}px,0)`;
    document.body.appendChild(ghost);
    dragGhostRef.current = ghost;
    document.documentElement.classList.add('block-drag-active');
    setDraggedIndex(index);
    setDragOverIndex(index);
    setDragOverEdge('before');
  };

  const clearDragPresentation = () => {
    if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    dragPointerRef.current = null;
    dragGhostRef.current?.remove();
    dragGhostRef.current = null;
    document.documentElement.classList.remove('block-drag-active');
  };

  const flushPointerDrag = () => {
    dragFrameRef.current = null;
    const pointer = dragPointerRef.current;
    const area = blocksAreaRef.current;
    if (!pointer || !area || dragSourceRef.current === null) return;
    const ghost = dragGhostRef.current;
    if (ghost) {
      const offset = dragGhostOffsetRef.current;
      ghost.style.transform = `translate3d(${Math.round(pointer.x - offset.x)}px,${Math.round(pointer.y - offset.y)}px,0)`;
    }
    const bounds = area.getBoundingClientRect();
    const autoScrollEdge = Math.min(72, bounds.height * 0.16);
    let scrollDelta = 0;
    if (pointer.y < bounds.top + autoScrollEdge) scrollDelta = -Math.max(8, (bounds.top + autoScrollEdge - pointer.y) * 0.32);
    else if (pointer.y > bounds.bottom - autoScrollEdge) scrollDelta = Math.max(8, (pointer.y - (bounds.bottom - autoScrollEdge)) * 0.32);
    if (scrollDelta) area.scrollTop = Math.max(0, area.scrollTop + scrollDelta);
    const index = cardVirtual.indexAtClientY(pointer.y, 18);
    if (index >= 0 && index < blocks.length) {
      const rowTop = bounds.top + 18 + cardVirtual.layout.offsets[index] - area.scrollTop;
      const dropEdge = pointer.y >= rowTop + cardVirtual.layout.sizes[index] / 2 ? 'after' : 'before';
      dragTargetSlotRef.current = index + (dropEdge === 'after' ? 1 : 0);
      if (dragOverIndexRef.current !== index) {
        dragOverIndexRef.current = index;
        setDragOverIndex(index);
      }
      if (dragOverEdgeRef.current !== dropEdge) {
        dragOverEdgeRef.current = dropEdge;
        setDragOverEdge(dropEdge);
      }
    }
    if (scrollDelta && dragSourceRef.current !== null) dragFrameRef.current = requestAnimationFrame(flushPointerDrag);
  };

  const updatePointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragSourceRef.current === null) return;
    event.preventDefault();
    const origin = dragOriginRef.current;
    if (!dragMovedRef.current && origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= 8) {
      dragMovedRef.current = true;
      activatePointerDrag();
    }
    if (!dragMovedRef.current) return;
    dragPointerRef.current = { x: event.clientX, y: event.clientY };
    if (dragFrameRef.current === null) dragFrameRef.current = requestAnimationFrame(flushPointerDrag);
  };

  const resetPointerDrag = () => {
    dragSourceRef.current = null;
    dragSourceCardRef.current = null;
    dragTargetSlotRef.current = null;
    dragOriginRef.current = null;
    dragMovedRef.current = false;
    dragOverIndexRef.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);
    clearDragPresentation();
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragFrameRef.current !== null) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      flushPointerDrag();
    }
    const from = dragSourceRef.current;
    const targetSlot = dragTargetSlotRef.current;
    const moved = dragMovedRef.current;
    resetPointerDrag();
    if (moved && from !== null && targetSlot !== null) reorderBlock(from, targetSlot);
    return moved;
  };

  const cancelPointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    resetPointerDrag();
  };

  useEffect(() => () => clearDragPresentation(), [project.activeFragmentId]);
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
    const payload = `SLIDE_BLOCKS_V1\n${JSON.stringify(indexes.map((index) => blocks[index]))}`;
    writeSmallValue('slide-block-clipboard', payload);
    await writeClipboardText(payload);
    if (cut) await deleteSelected(); else setContextMenu(null);
  };
  const pasteBlocks = async () => {
    try {
      const preview = await previewClipboardScript(readSmallValue('slide-block-clipboard') ?? '', project.characters, loadScriptImportRules());
      if (!preview.blocks.length) { notify(preview.warnings[0] ?? '剪贴板中没有可粘贴文本', 'error'); return; }
      const copies = preview.blocks.map((block) => ({ ...clone(block), id: makeId('block') } as StoryBlock));
      const insertion = selectedIndexes.size ? Math.max(...selectedIndexes) + 1 : blocks.length;
      commit((current) => { const next = [...current.scripts[current.activeFragmentId]]; next.splice(insertion, 0, ...copies); return { ...current, scripts: { ...current.scripts, [current.activeFragmentId]: next } }; }, `从${preview.sourceName}粘贴 ${copies.length} 个 Block`);
      setSelectedIndexes(new Set(copies.map((_, offset) => insertion + offset))); setSelected(insertion); setContextMenu(null);
      notify(`Python 已解析并粘贴 ${copies.length} 个 ${preview.format} Block`);
    } catch (error) { notify(String(error), 'error'); }
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
    setComposerText(''); setSelected(nextIndex); setSelectedIndexes(new Set([nextIndex])); selectionAnchorRef.current = nextIndex;
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
    let message = `已导入 ${droppedAssets.length} 个素材`;
    try {
      commit((current) => {
        const result = applyAssetImport(current, droppedAssets, action, makeId);
        message = describeAssetImport(result);
        return result.project;
      }, `从剧本编辑器导入并绑定 ${droppedAssets.length} 个素材`);
      setDroppedAssets([]);
      notify(`${message}，未插入剧情 Block`);
    } catch (error) { notify(String(error), 'error'); }
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
  const fragmentNames = useMemo(() => new Map(project.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => [fragment.id, fragment.name] as const))), [project.chapters]);
  const activeName = fragmentNames.get(project.activeFragmentId) ?? '片段';
  const code = useMemo(() => blocks.map((block) => block.type === 'dialogue' ? `${block.speaker} ${JSON.stringify(block.text)}` : block.type === 'narration' ? JSON.stringify(block.text) : block.type === 'scene' ? `scene ${block.title} with ${block.transition}` : block.type === 'sound' ? `play music ${JSON.stringify(block.title)}` : `menu ${JSON.stringify(block.title)}:`).join('\n'), [blocks]);
  const references = useMemo(() => Object.entries(project.scripts).flatMap(([fragmentId, script]) => script.flatMap((block, blockIndex) => {
    const matches: { fragmentId: string; blockIndex: number; kind: string; label: string }[] = [];
    if (block.type === 'branch' && block.options?.some((option) => option.target === project.activeFragmentId)) matches.push({ fragmentId, blockIndex, kind: '选项', label: block.title ?? '分支' });
    if (block.type === 'condition' && (block.trueTarget === project.activeFragmentId || block.falseTarget === project.activeFragmentId)) matches.push({ fragmentId, blockIndex, kind: '条件', label: block.variable ?? '条件判断' });
    if ((block.type === 'call' || block.type === 'jump') && block.target === project.activeFragmentId) matches.push({ fragmentId, blockIndex, kind: block.type === 'call' ? '调用' : '跳转', label: blockMeta[block.type].name });
    return matches;
  })), [project.scripts, project.activeFragmentId]);
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
  const inspector = <><Profiler id="inspector" onRender={recordComponentRender}><Inspector project={project} block={selectedBlock} update={(patch) => updateBlock(selected, patch)} dock={inspectorDock} setDock={setInspectorDock} notify={notify} /></Profiler>{droppedAssets.length > 0 && <EditorAssetImportDialog assets={droppedAssets} characters={project.characters} sourceLabel="剧本编辑器" close={() => setDroppedAssets([])} apply={applyDroppedAssets} />}</>;
  return <div className={`editor-layout inspector-${inspectorDock}`} data-selected-block-index={selected}><section className="editor-pane"><EditorTabBar openFragmentIds={openFragmentIds} activeFragmentId={project.activeFragmentId} fragmentNames={fragmentNames} activateFragment={activateFragment} closeFragment={closeFragment} closeOtherFragments={closeOtherFragments} closeAllFragments={closeAllFragments} reorderFragmentTabs={reorderFragmentTabs} /><div className="editor-toolbar"><div className="editor-title"><strong>{activeName}</strong><small>{blocks.length} Blocks</small></div><button className="button ghost" onClick={openImport}><FileUp /> 导入剧本</button><div className="view-switch">{([['cards', '卡片'], ['plain', '纯文本'], ['code', "Ren'Py"], ['json', 'JSON']] as [View, string][]).map(([key, name]) => <button key={key} className={`view-button ${view === key ? 'active' : ''}`} onClick={() => setView(key)}>{name}</button>)}</div></div>
    {references.length > 0 && <div className="fragment-references"><strong>此片段被 {references.length} 处引用</strong><div>{references.map((reference) => <button key={`${reference.fragmentId}-${reference.blockIndex}-${reference.kind}`} onClick={() => { activateFragment(reference.fragmentId); setSelected(reference.blockIndex); }}>{reference.kind} · {fragmentNames.get(reference.fragmentId) ?? reference.fragmentId}<span>前往</span></button>)}</div></div>}
    {view === 'cards' && <Profiler id="block-list" onRender={recordComponentRender}><div className="blocks-area" ref={blocksAreaRef} tabIndex={0} onScroll={(event) => { cardVirtual.onScroll(event); window.clearTimeout(scrollSaveTimer.current); const value = event.currentTarget.scrollTop; scrollSaveTimer.current = window.setTimeout(() => saveScrollTop(value), 350); }}><div className="virtual-list-canvas" style={{ height: cardVirtual.layout.totalSize }}>{cardVirtual.indexes.map((index) => { const block = blocks[index]; const showDropMarker = dragOverIndex === index && draggedIndex !== null && (draggedIndex !== index || dragOverEdge === 'after'); return <MeasuredVirtualRow itemKey={block.id} index={index} top={cardVirtual.layout.offsets[index]} measure={cardVirtual.measure} className={`virtual-block-row block-drop-target ${highlightedBlockId === block.id ? 'block-just-inserted' : ''} ${showDropMarker ? `drag-over-${dragOverEdge}` : ''}`} key={block.id}><div data-block-index={index} data-block-id={block.id}><Profiler id={`story-card:${block.type}`} onRender={recordComponentRender}><StoryCard index={index} project={project} block={block} selected={selectedIndexes.has(index)} asset={block.assetId ? assetLookups.byId.get(block.assetId) : undefined} voiceAsset={block.voice ? assetLookups.byReference.get(block.voice) : undefined} onSelect={selectBlock} onContextMenu={openBlockContextMenu} onChange={updateBlock} onMove={moveBlock} onDuplicate={duplicateBlock} onDelete={deleteBlock} dragging={draggedIndex === index} listDragging={draggedIndex !== null} onPointerDown={beginPointerDrag} onPointerMove={updatePointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={cancelPointerDrag} /></Profiler><div className="insert-row"><button className="insert-button" title="插入 Block" onClick={() => openBlocks(index + 1)}><Plus /></button></div></div></MeasuredVirtualRow>; })}</div><div className={`quick-composer ${activeDialogueCharacter ? 'dialogue-mode' : ''}`} ref={composerRef}><div className="composer-prefix">{activeDialogueCharacter ? activeDialogueCharacter.name : <AlignLeft />}</div><textarea aria-label={activeDialogueCharacter ? `${activeDialogueCharacter.name} 连续对话` : '输入旁白'} value={composerText} placeholder={activeDialogueCharacter ? `${activeDialogueCharacter.name} 的对白` : '输入旁白'} onChange={(event) => setComposerText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); openComposerMenu(); } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitComposer(); } }} />{dialogueCharacterId && <button className="icon-button" title="退出连续对话" onClick={() => { setDialogueCharacterId(null); setDialogueSchemeId(''); }}><X /></button>}{composerMenuOpen && <div className="composer-menu" role="menu" style={composerMenuPos ?? undefined}><strong>插入 Block</strong><div className="composer-menu-grid">{(['scene', 'sound', 'characterShow', 'camera', 'branch', 'condition'] as BlockType[]).map((type) => { const MetaIcon = blockMeta[type].icon; return <button key={type} onClick={() => insertComposerBlock(type)}><MetaIcon />{blockMeta[type].name}</button>; })}</div><strong>连续对话角色</strong><div className="composer-characters">{project.characters.map((character) => <button key={character.id} onClick={() => { setDialogueCharacterId(character.id); setDialogueSchemeId(''); }}>{character.name}</button>)}</div>{activeDialogueCharacter && <><strong>显示名方案</strong><div className="composer-characters"><button className={!dialogueSchemeId ? 'active' : ''} onClick={() => { setDialogueSchemeId(''); setComposerMenuOpen(false); }}>主名称</button>{activeDialogueCharacter.displayNameSchemes?.map((scheme) => <button className={dialogueSchemeId === scheme.id ? 'active' : ''} key={scheme.id} onClick={() => { setDialogueSchemeId(scheme.id); setComposerMenuOpen(false); }}>{scheme.name}</button>)}</div></>}<footer className="composer-menu-footer"><small>Esc 关闭</small><button onClick={() => setComposerMenuOpen(false)}>关闭</button></footer></div>}</div></div></Profiler>}
    {view === 'plain' && <Profiler id="block-list" onRender={recordComponentRender}><div className="plain-script-editor" ref={plainAreaRef} onScroll={(event) => { plainVirtual.onScroll(event); window.clearTimeout(scrollSaveTimer.current); const value = event.currentTarget.scrollTop; scrollSaveTimer.current = window.setTimeout(() => saveScrollTop(value), 350); }}><div className="virtual-list-canvas" style={{ height: plainVirtual.layout.totalSize }}>{plainVirtual.indexes.map((index) => { const block = blocks[index]; const previous = blocks[index - 1]; const grouped = block.type === 'dialogue' && previous?.type === 'dialogue' && previous.speaker === block.speaker; return <MeasuredVirtualRow itemKey={block.id} index={index} top={plainVirtual.layout.offsets[index]} measure={plainVirtual.measure} className="virtual-plain-row" key={block.id}><div data-block-index={index} className={`plain-block-row ${selectedIndexes.has(index) ? 'selected' : ''} ${grouped ? 'grouped' : ''}`} onClick={(event) => selectBlock(index, event)} onContextMenu={(event) => { event.preventDefault(); if (!selectedIndexes.has(index)) selectBlock(index); setContextMenu({ x: event.clientX, y: event.clientY }); }}><span className="plain-block-kind">{block.type === 'dialogue' ? grouped ? '' : block.speaker : blockMeta[block.type].name}</span><div>{(block.type === 'dialogue' || block.type === 'narration') ? <><textarea defaultValue={block.text ?? ''} onBlur={(event) => updateBlock(index, { text: event.target.value })} /><small>{block.type === 'dialogue' ? block.expression : ''}</small></> : block.type === 'branch' ? <><strong>分支 · {block.options?.length ?? 0} 个选项</strong>{block.options?.map((option) => <small className="plain-branch-option" key={option.text}>├ {option.text} → {fragmentNames.get(option.target) ?? option.target}</small>)}</> : <span className="plain-instruction">{block.title ?? block.text ?? (block.type === 'condition' ? `${block.variable} ${block.operator} ${String(block.compareValue ?? '')}` : block.type === 'setVariable' ? `${block.variable} = ${String(block.value ?? '')}` : block.target ? `→ ${fragmentNames.get(block.target) ?? block.target}` : blockMeta[block.type].description)}</span>}</div></div></MeasuredVirtualRow>; })}</div></div></Profiler>}
    {view === 'code' && <pre className="code-editor">{code || '# empty fragment'}</pre>}{view === 'json' && <pre className="json-editor">{JSON.stringify(blocks, null, 2)}</pre>}
    {contextMenu && <div className="context-menu block-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}><strong>已选择 {selectedIndexes.size} 个 Block</strong><button onClick={() => void writeBlockClipboard(false)}>复制</button><button onClick={() => void writeBlockClipboard(true)}>剪切</button><button onClick={duplicateSelected}>创建副本</button><button onClick={() => void pasteBlocks()}>粘贴到下方</button><button className="danger" onClick={() => void deleteSelected()}>删除</button></div>}
    {inspectorDock === 'editor' && inspector}
  </section><section className="preview-inspector"><Profiler id="preview" onRender={recordComponentRender}><Preview project={project} editorIndex={selected} debugMode={debugRunning} language={previewLanguage} onLanguageChange={onPreviewLanguageChange} onEditorLocationChange={activateFragment} onStageCharacterMove={moveStageCharacter} /></Profiler>{inspectorDock === 'preview' && inspector}</section>{inspectorDock === 'floating' && <div className="floating-inspector">{inspector}</div>}</div>;
}

function PageHeader({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{sub}</p></div><div className="page-header-actions">{children}</div></div>;
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
  recoveryLoading: boolean;
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

function HistoryPage({ project, entries, recovery, recoveryLoading, storage, undoCount, redoCount, undo, redo, undoCategory, restoreCommand, restoreRecovery, refreshRecovery, renameCommand, toggleCommandPinned, refreshStorage, clearOrdinaryHistory }: HistoryPageProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [recoveryExpanded, setRecoveryExpanded] = useState(false);
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const recoveryDiff = recovery ? diffProjects(recovery.project, project) : null;
  if (recoveryLoading) return <div className="dashboard-page history-page"><PageHeader title="编辑历史" sub="保留最近 50 个普通 Command；固定快照额外保护，所有恢复操作仍可撤销"><button className="button ghost" disabled={!undoCount} onClick={undo}><Undo2 />撤销</button><button className="button ghost" disabled={!redoCount} onClick={redo}><Redo2 />重做</button></PageHeader><div className="content-pad"><section className="recovery-card recovery-loading"><div className="recovery-summary"><div className="recovery-icon"><LoaderCircle className="spin" /></div><div><strong>正在读取恢复快照</strong><small>仅在打开历史面板时按需载入，不会拖慢编辑器启动。</small></div></div></section></div></div>;
  return <div className="dashboard-page history-page"><PageHeader title="编辑历史" sub="保留最近 50 个普通 Command；固定快照额外保护，所有恢复操作仍可撤销"><button className="button ghost" disabled={!undoCount} onClick={undo}><Undo2 />撤销</button><button className="button ghost" disabled={!redoCount} onClick={redo}><Redo2 />重做</button></PageHeader><div className="content-pad"><section className={`recovery-card ${recovery?.recoveredDuringLoad ? 'recovered' : ''}`}><div className="recovery-summary"><div className="recovery-icon"><HardDrive /></div><div><strong>{recovery?.recoveredDuringLoad ? '本次启动已执行崩溃恢复' : '崩溃恢复快照'}</strong><small>{recovery ? `${new Date(recovery.updatedAt).toLocaleString()} · ${recoveryDiff?.total ?? 0} 项与当前项目不同` : '当前项目还没有可用的恢复快照'}</small></div><div className="recovery-actions"><button className="button ghost" onClick={refreshRecovery}>刷新</button><button className="button ghost" disabled={!recovery} onClick={() => setRecoveryExpanded((value) => !value)}>{recoveryExpanded ? '收起比较' : '比较快照'}<ChevronDown className={recoveryExpanded ? 'expanded' : ''} /></button><button className="button primary" disabled={!recovery || !recoveryDiff?.total} onClick={restoreRecovery}><Undo2 />恢复此快照</button></div></div>{recovery && recoveryExpanded && <div className="snapshot-detail"><div className="snapshot-stats"><SnapshotStats label="恢复快照" project={recovery.project} /><ArrowRight /><SnapshotStats label="当前项目" project={project} /></div><SnapshotDiff diff={recoveryDiff!} /></div>}</section><section className="history-storage-card"><header><div><PackageCheck /><span><strong>历史存储与清理</strong><small>增量快照 v{storage?.version ?? 2} · .slide/history/commands.json</small></span></div><div><button className="button ghost" onClick={refreshStorage}>刷新统计</button><button className="button danger" disabled={!entries.some((entry) => !entry.pinned)} onClick={clearOrdinaryHistory}><Trash2 />清理普通历史</button></div></header><div className="history-storage-stats"><div><span>磁盘占用</span><strong>{formatBytes(storage?.bytes ?? 0)}</strong></div><div><span>完整快照估算</span><strong>{formatBytes(storage?.uncompressedBytes ?? 0)}</strong></div><div><span>节省空间</span><strong>{Math.round((storage?.compressionRate ?? 0) * 100)}%</strong></div><div><span>历史记录</span><strong>{storage?.commandCount ?? entries.length}</strong><small>{storage?.pinnedCount ?? entries.filter((entry) => entry.pinned).length} 个固定</small></div></div><div className="compression-meter"><span style={{ width: `${Math.round((storage?.compressionRate ?? 0) * 100)}%` }} /><small>已压缩 {formatBytes(Math.max(0, (storage?.uncompressedBytes ?? 0) - (storage?.bytes ?? 0)))}</small></div></section><div className="history-list">{[...entries].reverse().map((entry) => {
    const isExpanded = expanded.has(entry.id);
    const diff = isExpanded ? diffProjects(entry.before, entry.after) : null;
    return <section className={`history-entry ${entry.categories?.length ? 'semantic' : ''} ${entry.state} ${entry.pinned ? 'pinned' : ''}`} key={entry.id}><button type="button" className="history-item" onClick={() => toggle(entry.id)}><div className="history-icon">{entry.label.startsWith('AI Agent') ? <Sparkles /> : <History />}</div><div><strong>{entry.name ?? entry.label}</strong><small>{entry.name ? `${entry.label} · ` : ''}{entry.state === 'undone' ? '当前位于重做栈 · ' : entry.state === 'archived' ? '固定归档 · ' : ''}{entry.categories?.length ? `${entry.categories.length} 类语义修改` : '完整项目快照'} · 点击比较</small></div><div className="history-badges">{entry.pinned && <span className="history-pin"><Pin />固定</span>}<span className={`history-state ${entry.state}`}>{entry.state === 'applied' ? '已应用' : entry.state === 'undone' ? '已撤销' : '已归档'}</span></div><time>{new Date(entry.timestamp).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><ChevronDown className={isExpanded ? 'expanded' : ''} /></button>{isExpanded && <div className="command-snapshot-detail"><div className="snapshot-toolbar"><div className="snapshot-stats"><SnapshotStats label="修改前" project={entry.before} /><ArrowRight /><SnapshotStats label="修改后" project={entry.after} /></div><div className="snapshot-actions"><button className="button ghost" onClick={() => renameCommand(entry)}><FileText />{entry.name ? '修改名称' : '命名快照'}</button><button className={`button ghost ${entry.pinned ? 'active' : ''}`} onClick={() => toggleCommandPinned(entry)}><Pin />{entry.pinned ? '取消固定' : '固定保护'}</button><button className="button ghost" onClick={() => restoreCommand(entry, 'before')}><Undo2 />恢复修改前</button><button className="button ghost" onClick={() => restoreCommand(entry, 'after')}><Redo2 />恢复修改后</button></div></div><SnapshotDiff diff={diff!} />{entry.categories?.length && <div className="history-category-list">{entry.categories.map((category) => <article className={category.undone ? 'undone' : ''} key={category.id}><header><div><strong>{category.label}</strong><span>{category.count} 项</span></div><button className="button ghost" disabled={entry.state !== 'applied' || category.undone} onClick={() => undoCategory(entry.id, category.id)}>{category.undone ? <CheckCircle2 /> : <Undo2 />}{category.undone ? '已撤销' : '恢复此类别到修改前'}</button></header><ul>{category.items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></article>)}</div>}</div>}</section>;
  })}{!entries.length && <div className="empty-state large"><History /><strong>还没有编辑记录</strong><span>修改项目后会在这里出现，关闭软件也不会清空</span></div>}<div className="history-item static"><div className="history-icon"><Save /></div><div><strong>自动保存与历史持久化</strong><small>项目写入 v3 目录，Command 快照写入 .slide/history</small></div><time>450 ms</time></div></div></div></div>;
}

interface ModalLayerProps {
  modal: Modal;
  project: Project;
  close: () => void;
  addBlock: (type: BlockType) => void;
  runBuild: (kind: BuildTarget | 'renpy', report?: BuildPreflightReport, outputRoot?: string, browserMode?: BrowserMode) => void;
  locate: (fragmentId: string, blockIndex?: number) => void;
  buildOutputRoot: string;
  updateBuildOutputRoot: (path: string) => void;
  browserMode: BrowserMode;
  updateBrowserMode: (mode: BrowserMode) => void;
}

function ModalLayer({ modal, project, close, addBlock, runBuild, locate, buildOutputRoot, updateBuildOutputRoot, browserMode, updateBrowserMode }: ModalLayerProps) {
  if (!modal) return null;
  if (modal === 'search') return null;
  if (modal === 'publish') return <BuildPublishDialog project={project} close={close} runBuild={runBuild} locate={locate} outputRoot={buildOutputRoot} updateOutputRoot={updateBuildOutputRoot} browserMode={browserMode} updateBrowserMode={updateBrowserMode} />;
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
  const [blockInsertIndex, setBlockInsertIndex] = useState<number | null>(null);
  const [pendingBlockReveal, setPendingBlockReveal] = useState<PendingBlockReveal | null>(null);
  const completeBlockReveal = useCallback((blockId: string) => setPendingBlockReveal((current) => current?.blockId === blockId ? null : current), []);
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
  const sessionRef = useRef<EditorSessionState>(defaultEditorSession(fallbackProject.activeFragmentId));
  const [creatorName, setCreatorName] = useState(() => readSmallValue('slide-creator-name') ?? '');
  const [saveState, setSaveState] = useState('正在载入');
  const [startupReady, setStartupReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [gameThemeOpen, setGameThemeOpen] = useState(false);
  const [chapterSettingsOpen, setChapterSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [scriptImportOpen, setScriptImportOpen] = useState(false);
  const [scriptImportBusy, setScriptImportBusy] = useState(false);
  const [scriptImportPreview, setScriptImportPreview] = useState<ScriptImportPreview | null>(null);
  const [recoverySnapshot, setRecoverySnapshot] = useState<RecoverySnapshot | null>(null);
  const [recoverySnapshotStatus, setRecoverySnapshotStatus] = useState<RecoverySnapshotStatus | null>(null);
  const [recoverySnapshotState, setRecoverySnapshotState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [historyStorage, setHistoryStorage] = useState<CommandHistoryStorageStats | null>(null);
  const [buildProgress, setBuildProgress] = useState<BuildProgressTask | null>(null);
  const [buildOutputRoot, setBuildOutputRoot] = useState(() => readSmallValue('slide-build-output-root') ?? '');
  const [browserMode, setBrowserMode] = useState<BrowserMode>(() => readSmallValue('slide-browser-mode') === 'system' ? 'system' : 'cefsharp');
  const [previewLanguageChoice, setPreviewLanguageChoice] = useState(() => readSmallValue('slide-preview-language') ?? '');
  const previewLanguage = projectLanguages(project).includes(previewLanguageChoice) ? previewLanguageChoice : defaultLanguage(project);
  const changePreviewLanguage = (language: string) => {
    setPreviewLanguageChoice(language);
    writeSmallValue('slide-preview-language', language);
  };
  const hydrated = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<Promise<unknown> | null>(null);
  const projectSwitchingRef = useRef(false);
  const historyReadyRef = useRef(false);
  const historySaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingProjectReloadRef = useRef<PendingProjectReload | null>(null);
  const buildInProgressRef = useRef(false);
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
    // 会话状态不再写入项目文件：优先取 localStorage，其次读取旧版本项目中的遗留字段（一次性迁移），
    // 并从内存项目中剥离，避免继续进入命令历史与保存载荷。
    const legacySession = next.settings.editorSession;
    const storedSession = loadEditorSession(next.meta.id);
    const session: EditorSessionState = storedSession ?? (legacySession ? {
      openFragmentIds: legacySession.openFragmentIds,
      selectedBlockByFragment: legacySession.selectedBlockByFragment ?? {},
      scrollTopByFragment: legacySession.scrollTopByFragment ?? {},
      inspectorDock: legacySession.inspectorDock ?? 'preview',
      scriptView: legacySession.scriptView ?? 'cards',
    } : defaultEditorSession(next.activeFragmentId));
    if (legacySession) next = { ...next, settings: { ...next.settings, editorSession: undefined } };
    if (!storedSession) saveEditorSession(next.meta.id, session);
    sessionRef.current = session;
    const fragmentIds = new Set(next.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => fragment.id)));
    const savedTabs = session.openFragmentIds.filter((id) => fragmentIds.has(id));
    if (persistedHistory?.projectId === next.meta.id) restoreHistory(next, persistedHistory, commandRestoreStrategies);
    else resetHistory(next);
    setSelected(session.selectedBlockByFragment[next.activeFragmentId] ?? 0);
    setOpenFragmentIds(savedTabs.length ? savedTabs : [next.activeFragmentId]);
    setInspectorDock(session.inspectorDock);
    setView(session.scriptView);
  };
  const updateBuildOutputRoot = (path: string) => {
    setBuildOutputRoot(path);
    if (path.trim()) writeSmallValue('slide-build-output-root', path);
    else removeSmallValue('slide-build-output-root');
  };
  const updateBrowserMode = (mode: BrowserMode) => {
    setBrowserMode(mode);
    writeSmallValue('slide-browser-mode', mode);
  };

  const persistCommandHistory = () => {
    if (!historyReadyRef.current) return Promise.resolve();
    const snapshot = serializeHistory(project.meta.id);
    const request = historySaveQueueRef.current.catch(() => undefined).then(() => saveCommandHistory(snapshot)).then((result) => { setHistoryStorage(result); return result; });
    historySaveQueueRef.current = request;
    return request;
  };

  const restoreProjectAndHistory = async (next: Project): Promise<ProjectRestorePerformance> => {
    const restoreStarted = performance.now();
    historyReadyRef.current = false;
    setRecoverySnapshot(null);
    setRecoverySnapshotStatus(null);
    setRecoverySnapshotState('idle');
    setHistoryStorage(null);
    let persistedHistory: PersistedCommandHistory<Project> | null = null;
    let phaseStarted = performance.now();
    try { persistedHistory = await loadCommandHistory(); }
    catch (error) { log('error', 'history', 'Command 历史损坏或无法读取，项目将不带历史打开', error); }
    const commandHistoryLoadMs = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    try { setRecoverySnapshotStatus(await getRecoverySnapshotStatus()); }
    catch (error) { log('error', 'history', '崩溃恢复快照状态无法读取', error); }
    const recoverySnapshotLoadMs = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    try { setHistoryStorage(await loadCommandHistoryStats()); }
    catch (error) { log('error', 'history', '历史存储统计无法读取', error); }
    const historyStatsLoadMs = performance.now() - phaseStarted;
    const stateDispatchStartedAt = performance.now();
    resetProject(next, persistedHistory);
    const stateDispatchMs = performance.now() - stateDispatchStartedAt;
    historyReadyRef.current = true;
    return {
      commandHistoryLoadMs,
      recoverySnapshotLoadMs,
      historyStatsLoadMs,
      historyRestoreMs: stateDispatchStartedAt - restoreStarted,
      stateDispatchMs,
      stateDispatchStartedAt,
    };
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
    void Promise.all([loadProjectWithPerformance(fallbackProject), getAppInfo()]).then(async ([loadedResult, appInfo]) => {
      const loaded = loadedResult.project;
      if (loadedResult.performance) {
        beginComponentRenderProfile(loadedResult.performance.reloadId);
        pendingProjectReloadRef.current = { projectId: loaded.meta.id, load: loadedResult.performance };
      }
      const restore = await restoreProjectAndHistory(loaded);
      if (pendingProjectReloadRef.current?.projectId === loaded.meta.id) pendingProjectReloadRef.current.restore = restore;
      hydrated.current = true;
      setStartupReady(true);
      setSaveState('已保存');
      if (appInfo.startupProjectRequested) setProjectClosed(false);
    }).catch((error) => {
      hydrated.current = false;
      historyReadyRef.current = false;
      setStartupReady(true);
      setSaveState('加载失败');
      cancelComponentRenderProfile();
      log('error', 'project', '项目加载失败；为保护磁盘项目，编辑与自动保存保持停用', error);
      show(`项目加载失败：${String(error)}`, 'error');
    });
  }, []);
  useLayoutEffect(() => {
    const pending = pendingProjectReloadRef.current;
    if (!pending || pending.finalizing || !pending.restore || !startupReady || pending.projectId !== project.meta.id) return;
    pending.finalizing = true;
    const reloadId = pending.load.reloadId;
    const commitAt = performance.now();
    performance.mark(`slide.reload.${reloadId}.react-committed`);
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const stablePaintAt = performance.now();
        performance.mark(`slide.reload.${reloadId}.stable-paint`);
        try { performance.measure(`slide.reload.${reloadId}.total`, `slide.reload.${reloadId}.frontend-start`, `slide.reload.${reloadId}.stable-paint`); }
        catch { /* Marks can be unavailable after a browser performance buffer reset. */ }
        const frontend: ProjectReloadFrontendPerformance = {
          apiWaitMs: pending.load.apiWaitMs,
          bridgeRoundTripMs: pending.load.bridgeRoundTripMs,
          webViewTransferEstimateMs: pending.load.webViewTransferEstimateMs,
          payloadDecodeMs: pending.load.payloadDecodeMs,
          jsonParseMs: pending.load.jsonParseMs,
          frontendSessionLoadMs: pending.load.frontendSessionLoadMs,
          commandHistoryLoadMs: pending.restore!.commandHistoryLoadMs,
          recoverySnapshotLoadMs: pending.restore!.recoverySnapshotLoadMs,
          historyStatsLoadMs: pending.restore!.historyStatsLoadMs,
          historyRestoreMs: pending.restore!.historyRestoreMs,
          stateDispatchMs: pending.restore!.stateDispatchMs,
          reactCommitMs: commitAt - pending.restore!.stateDispatchStartedAt,
          stablePaintMs: stablePaintAt - commitAt,
          totalReloadMs: stablePaintAt - pending.load.startedAt,
          bootToStablePaintMs: stablePaintAt - (window.__SLIDE_BOOT_STARTED_AT__ ?? pending.load.startedAt),
          componentRenders: finishComponentRenderProfile(reloadId),
        };
        const localReport: ProjectReloadPerformance = {
          version: 1,
          complete: true,
          recordedAt: new Date().toISOString(),
          surface: projectClosed ? 'project-launcher' : 'editor',
          backend: pending.load.backend,
          frontend,
        };
        window.__SLIDE_LAST_PROJECT_RELOAD__ = localReport;
        pendingProjectReloadRef.current = null;
        log('info', 'performance', '桌面项目完整重载性能', localReport);
        void reportProjectReloadPerformance(reloadId, localReport.surface ?? 'editor', frontend)
          .then((reported) => { if (reported) window.__SLIDE_LAST_PROJECT_RELOAD__ = reported; })
          .catch((error) => log('warn', 'performance', '无法写入桌面重载性能日志', error));
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (pendingProjectReloadRef.current === pending) pending.finalizing = false;
    };
  }, [project, projectClosed, startupReady]);
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
    window.addEventListener('slide-open-project-request', handler);
    return () => window.removeEventListener('slide-open-project-request', handler);
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
  useEffect(() => { const handler = (event: KeyboardEvent) => { const target = event.target as HTMLElement | null; const editingText = target?.matches('input,textarea,[contenteditable="true"]'); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setModal('search'); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editingText) { event.preventDefault(); event.shiftKey ? redo() : undo(); } else if (event.key === 'Escape') { setModal(null); setBlockInsertIndex(null); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [redo, undo]);
  useEffect(() => { if (!appDialog) return; const handler = (event: KeyboardEvent) => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopImmediatePropagation(); closeAppDialog(appDialog.kind === 'text' ? null : false); }; window.addEventListener('keydown', handler, true); return () => window.removeEventListener('keydown', handler, true); }, [appDialog]);
  useEffect(() => {
    if (!hydrated.current) return;
    sessionRef.current = { ...sessionRef.current, openFragmentIds, inspectorDock, scriptView: view };
    saveEditorSession(project.meta.id, sessionRef.current);
  }, [openFragmentIds, inspectorDock, view]);
  useEffect(() => {
    if (!hydrated.current) return;
    sessionRef.current = { ...sessionRef.current, selectedBlockByFragment: { ...sessionRef.current.selectedBlockByFragment, [project.activeFragmentId]: selected } };
    saveEditorSession(project.meta.id, sessionRef.current);
  }, [selected, project.activeFragmentId]);

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
      const encoded = `SLIDE_STRUCTURE_V1\n${JSON.stringify(value)}`;
      writeSmallValue('slide-structure-clipboard', encoded);
      await writeClipboardText(encoded);
    };
    const readPayload = async () => {
      const encoded = await readClipboardText(readSmallValue('slide-structure-clipboard') ?? '');
      if (!encoded.startsWith('SLIDE_STRUCTURE_V1\n')) return null;
      try { return JSON.parse(encoded.slice('SLIDE_STRUCTURE_V1\n'.length)) as typeof payload; } catch { return null; }
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
  const addBlock = (type: BlockType) => {
    const block = createBlock(type, project);
    const blocks = project.scripts[project.activeFragmentId] ?? [];
    const insertIndex = blockInsertIndex === null
      ? blocks.length
      : Math.max(0, Math.min(blockInsertIndex, blocks.length));
    commit((current) => {
      const nextBlocks = [...(current.scripts[current.activeFragmentId] ?? [])];
      nextBlocks.splice(Math.min(insertIndex, nextBlocks.length), 0, block);
      return { ...current, scripts: { ...current.scripts, [current.activeFragmentId]: nextBlocks } };
    }, `${blockInsertIndex === null ? '添加' : '插入'}${blockMeta[type].name}`);
    setSelected(insertIndex);
    setPendingBlockReveal({ fragmentId: project.activeFragmentId, blockId: block.id });
    setModal(null);
    setBlockInsertIndex(null);
  };
  const selectScriptImport = async (rules: ScriptImportRules) => {
    setScriptImportBusy(true);
    try { const preview = await previewScriptImport(project.characters, rules); if (preview) setScriptImportPreview(preview); }
    catch (error) { show(String(error), 'error'); }
    finally { setScriptImportBusy(false); }
  };
  const pasteScriptImport = async (rules: ScriptImportRules) => {
    setScriptImportBusy(true);
    try { setScriptImportPreview(await previewClipboardScript('', project.characters, rules)); }
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
  const loginCreator = async () => { const name = await requestText({ title: creatorName ? '账号设置' : '创作者账号', message: '输入创作者显示名。', initialValue: creatorName, placeholder: '创作者名称', confirmText: creatorName ? '保存' : '登录' }); if (!name) return; writeSmallValue('slide-creator-name', name); setCreatorName(name); setAccountMenuOpen(false); };
  const logoutCreator = () => { removeSmallValue('slide-creator-name'); setCreatorName(''); setAccountMenuOpen(false); };
  const runBuild = async (kind: BuildTarget | 'renpy', _displayedReport?: BuildPreflightReport, requestedOutputRoot?: string, requestedBrowserMode?: BrowserMode) => {
    if (buildInProgressRef.current) { show('已有构建任务正在运行', 'error'); return; }
    buildInProgressRef.current = true;
    const task = createBuildProgressTask(kind, project.meta.name);
    const updateTask = (step: Parameters<typeof updateBuildProgress>[1], fraction = 0, detail?: string) => setBuildProgress((current) => current?.id === task.id ? updateBuildProgress(current, step, fraction, detail) : current);
    setBuildProgress(task);
    setModal(null);
    try {
      const outputRoot = requestedOutputRoot?.trim() || buildOutputRoot.trim() || undefined;
      let checked: BuildPreflightReport | undefined;
      if (kind === 'web' || kind === 'windows') {
        setSaveState('构建检查中');
        checked = await preflightBuild(project, kind, { onProgress: (progress) => updateTask('preflight', progress.percent / 100, `已遍历 ${progress.completedPaths} 条路径 · ${progress.stepsExecuted.toLocaleString()} OP`) });
        if (checked.blocked) {
          setSaveState('构建已阻止');
          throw new Error(`构建被阻止：请先修复 ${checked.errors} 个错误`);
        }
      } else {
        updateTask('preflight', .45, '正在检查诊断错误与 Ren\'Py 兼容范围');
        const diagnostics = diagnosticSummary(project);
        if (diagnostics.errors) throw new Error(`导出被阻止：请先修复 ${diagnostics.errors} 个错误`);
      }
      updateTask('save', .1, '正在保存项目与最新编辑内容');
      await saveProject(project);
      markSaved();
      updateTask('generate', .05);
      setSaveState('构建中');
       const result = kind === 'web' ? await buildWeb(project, checked, outputRoot) : kind === 'windows' ? await buildWindows(project, checked, outputRoot, requestedBrowserMode ?? browserMode) : await exportRenpy(project, outputRoot);
      if (!result.path) throw new Error('构建完成，但桌面端没有返回产物路径');
      updateTask('verify', .55, `已确认输出：${result.path}`);
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      setBuildProgress((current) => current?.id === task.id ? completeBuildProgress(current, result.path) : current);
      setSaveState('已保存');
      show(`${buildKindLabel(kind)}已生成：${result.path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBuildProgress((current) => current?.id === task.id ? failBuildProgress(current, message) : current);
      setSaveState('构建失败');
      show(message, 'error');
    } finally {
      buildInProgressRef.current = false;
    }
  };
  const activate = (id: string, blockIndex?: number) => { setOpenFragmentIds((items) => items.includes(id) ? items : [...items, id]); replace((current) => ({ ...current, activeFragmentId: id })); setSelected(blockIndex ?? sessionRef.current.selectedBlockByFragment[id] ?? 0); navigatePage('script'); };
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
  const closeOtherFragments = () => { if (!openFragmentIds.includes(project.activeFragmentId)) return; setOpenFragmentIds([project.activeFragmentId]); };
  const closeAllFragments = () => { const firstFragment = project.chapters.flatMap((chapter) => chapter.fragments)[0]?.id; if (!firstFragment) return; setOpenFragmentIds([firstFragment]); if (project.activeFragmentId !== firstFragment) replace((current) => ({ ...current, activeFragmentId: firstFragment })); };
  const saveFragmentScrollTop = (value: number) => {
    sessionRef.current = { ...sessionRef.current, openFragmentIds, scrollTopByFragment: { ...sessionRef.current.scrollTopByFragment, [project.activeFragmentId]: value }, inspectorDock, scriptView: view };
    saveEditorSession(project.meta.id, sessionRef.current);
  };
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

  const refreshRecoverySnapshot = async (notify = true) => {
    setRecoverySnapshotState('loading');
    try {
      const snapshot = await loadRecoverySnapshot();
      setRecoverySnapshot(snapshot);
      setRecoverySnapshotStatus(snapshot ? { exists: true, updatedAt: snapshot.updatedAt, bytes: recoverySnapshotStatus?.bytes ?? 0, recoveredDuringLoad: snapshot.recoveredDuringLoad } : { exists: false, updatedAt: null, bytes: 0, recoveredDuringLoad: false });
      setRecoverySnapshotState('loaded');
      if (notify) show('崩溃恢复快照已刷新');
    }
    catch (error) {
      setRecoverySnapshotState('error');
      log('error', 'history', '崩溃恢复快照刷新失败', error);
      show(`崩溃恢复快照读取失败：${String(error)}`, 'error');
    }
  };
  useEffect(() => {
    if (page !== 'history' || recoverySnapshotState !== 'idle' || recoverySnapshotStatus === null) return;
    if (!recoverySnapshotStatus.exists) {
      setRecoverySnapshotState('loaded');
      return;
    }
    void refreshRecoverySnapshot(false);
  }, [page, project.meta.id, recoverySnapshotState, recoverySnapshotStatus]);
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
    script: <Profiler id="script-page" onRender={recordComponentRender}><ScriptPage project={project} commit={commit} selected={selected} setSelected={setSelected} view={view} setView={setView} openBlocks={(insertIndex) => { setBlockInsertIndex(insertIndex ?? null); setModal('blocks'); }} openImport={() => setScriptImportOpen(true)} requestConfirm={requestConfirm} openFragmentIds={openFragmentIds} activateFragment={activate} closeFragment={closeFragment} closeOtherFragments={closeOtherFragments} closeAllFragments={closeAllFragments} reorderFragmentTabs={reorderFragmentTabs} inspectorDock={inspectorDock} setInspectorDock={setInspectorDock} initialScrollTop={sessionRef.current.scrollTopByFragment[project.activeFragmentId] ?? 0} saveScrollTop={saveFragmentScrollTop} debugRunning={debugRunning} notify={show} pendingBlockReveal={pendingBlockReveal} completeBlockReveal={completeBlockReveal} previewLanguage={previewLanguage} onPreviewLanguageChange={changePreviewLanguage} /></Profiler>,
    stage: <StageTimelineWorkspace project={project} selectedBlock={selected} commit={commit} locateBlock={(index) => setSelected(index)} notify={show} />,
    texts: <TextWorkbench project={project} commit={commit} notify={show} requestText={requestText} requestConfirm={requestConfirm} activate={activate} previewLanguage={previewLanguage} setPreviewLanguage={changePreviewLanguage} />,
    assets: <AssetManager project={project} commit={commit} notify={show} requestConfirm={requestConfirm} activate={activate} />,
    audio: <AudioManager project={project} category={audioCategory} setCategory={setAudioCategory} commit={commit} notify={show} requestConfirm={requestConfirm} activate={activate} />,
    map: <NarrativeMap project={project} activate={activate} commit={commit} notify={show} requestText={requestText} />,
    characters: <CharacterManager project={project} commit={commit} notify={show} requestText={requestText} requestConfirm={requestConfirm} />,
    scenes: <SceneManager project={project} commit={commit} notify={show} requestText={requestText} requestConfirm={requestConfirm} activate={activate} />,
    history: <HistoryPage project={project} entries={commandEntries} recovery={recoverySnapshot} recoveryLoading={recoverySnapshotState === 'loading'} storage={historyStorage} undoCount={undoCount} redoCount={redoCount} undo={undo} redo={redo} undoCategory={undoCategory} restoreCommand={(entry, target) => void restoreCommandSnapshot(entry, target)} restoreRecovery={() => void restoreCrashSnapshot()} refreshRecovery={() => void refreshRecoverySnapshot()} renameCommand={(entry) => void nameCommandSnapshot(entry)} toggleCommandPinned={(entry) => { if (toggleCommandPinned(entry.id)) show(entry.pinned ? '快照已取消固定' : '快照已固定保护'); }} refreshStorage={() => void refreshHistoryStorage()} clearOrdinaryHistory={() => void clearOrdinaryHistory()} />,
    ai: <AiAgentPanel project={project} selectedBlockIndexes={[selected]} updateProject={commit} locateEditor={activate} applyPlan={applyAgentPlan} requestBuild={(target) => void runBuild(target)} notify={show} navigateTarget={(target) => { if (target.kind === 'fragment' && target.id) activate(target.id); else if (target.kind === 'chapter' && target.id) { const fragment = project.chapters.find((chapter) => chapter.id === target.id)?.fragments[0]; if (fragment) activate(fragment.id); } else if (target.kind === 'character') navigatePage('characters'); else if (target.kind === 'asset') navigatePage('assets'); else if (target.kind === 'variable') navigatePage('map'); else if (target.kind === 'memory') navigatePage('ai'); else show('该差异项没有可打开的编辑位置'); }} />,
  };
  const openAssetSection = (section: string, target: Page = 'assets') => { setAssetSection(section); navigatePage(target); setAssetMenuOpen(false); };
  const openAudioSection = (category: AudioCategory) => { setAudioCategory(category); navigatePage('audio'); setAssetMenuOpen(false); };

   if (projectClosed) return <Profiler id="app-shell" onRender={recordComponentRender}><ProjectLaunchScreen key={createWizardRequested ? 'create' : 'home'} startInWizard={createWizardRequested} ready={startupReady} onOpen={() => doOpen(true)} onOpenRecent={doOpenRecent} onCreate={doCreateProject} onCreated={() => { setCreateWizardRequested(false); setProjectClosed(false); }} /></Profiler>;

  return <Profiler id="app-shell" onRender={recordComponentRender}><div className={`app-shell desktop-app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><header className="topbar"><div className="brand-lockup"><div className="brand-mark">S</div><div><strong>Slide Studio</strong><span>{projectClosed ? '未打开项目' : project.meta.name}</span></div></div><div className="navigation-controls"><button className="icon-button" disabled={!backPages.length} title="后退" onClick={navigateBack}><ArrowLeft /></button><button className="icon-button" disabled={!forwardPages.length} title="前进" onClick={navigateForward}><ArrowRight /></button></div><div className="top-project-menu"><button className="project-menu-trigger" aria-expanded={projectMenuOpen} onClick={() => setProjectMenuOpen((value) => !value)}><Menu /><span>{project.meta.name}</span><ChevronDown /></button>{projectMenuOpen && <div className="top-dropdown project-actions-menu"><button onClick={() => { setProjectMenuOpen(false); void doOpen(); }}><FolderOpen />打开项目</button><button onClick={() => { setProjectMenuOpen(false); void renameProject(); }}><FileText />重命名</button><button onClick={() => { setProjectMenuOpen(false); void doSaveAs(); }}><SaveAs />另存为</button><button onClick={() => { setProjectMenuOpen(false); navigatePage('history'); }}><History />项目历史</button><button onClick={() => void closeProject()}><X />关闭项目</button><button onClick={() => void exitApplication()}><LogOut />退出应用</button></div>}</div><button className="search-trigger" onClick={() => setModal('search')}><Search /><span>搜索台词、指令和资源...</span><kbd>Ctrl K</kbd></button><div className="top-actions"><div className="save-state"><span />{saveState}</div><button className="icon-button notification-trigger" title="通知" onClick={() => setNotificationsOpen((value) => !value)}><Bell />{notifications.some((item) => !item.read) && <span />}</button><div className="account-entry"><button className="avatar-button" title="创作者账号" onClick={() => setAccountMenuOpen((value) => !value)}>{creatorName ? creatorName.slice(0, 1).toUpperCase() : <UserRound />}</button>{accountMenuOpen && <div className="top-dropdown account-menu">{creatorName ? <><strong>{creatorName}</strong><button onClick={() => void loginCreator()}><Settings2 />账号设置</button><button onClick={logoutCreator}><LogOut />退出账号</button></> : <button onClick={() => void loginCreator()}><UserRound />登录创作者账号</button>}</div>}</div></div></header>
    <nav className="module-nav"><div className="module-links"><button className={`module-link ${page === 'script' ? 'active' : ''}`} onClick={() => navigatePage('script')}><NotebookPen />{debugRunning ? '调试' : '剧本'}</button><button className={`module-link ${page === 'stage' ? 'active' : ''}`} onClick={() => navigatePage('stage')}><Clapperboard />演出</button><button className={`module-link ${page === 'texts' ? 'active' : ''}`} onClick={() => navigatePage('texts')}><Languages />文本&语言</button><div className="asset-nav-menu"><button className={`module-link ${page === 'assets' || page === 'characters' || page === 'scenes' || page === 'audio' ? 'active' : ''}`} aria-expanded={assetMenuOpen} onClick={() => setAssetMenuOpen((value) => !value)}><FolderOpen />资产<ChevronDown /></button>{assetMenuOpen && <div className="top-dropdown asset-submenu"><button onClick={() => openAssetSection('全部')}><PackageCheck />资源总览</button><button onClick={() => openAssetSection('全部', 'characters')}><Users />角色</button><button onClick={() => openAssetSection('全部', 'scenes')}><Image />场景</button><button onClick={() => openAudioSection('bgm')}><Music2 />BGM</button><button onClick={() => openAudioSection('sfx')}><AudioLines />SE</button><button onClick={() => openAudioSection('voice')}><MessageSquareText />语音</button></div>}</div><button className={`module-link ${page === 'map' ? 'active' : ''}`} onClick={() => navigatePage('map')}><GitBranch />叙事地图</button><button className={`module-link ${themeOpen ? 'active' : ''}`} onClick={() => setThemeOpen(true)}><Palette />个性化</button><button className={`module-link ${page === 'ai' ? 'active' : ''}`} onClick={() => navigatePage('ai')}><Sparkles />AI Agent</button></div><div className="module-actions"><button className={`button ghost ${debugRunning ? 'active' : ''}`} onClick={() => { setDebugRunning((value) => !value); navigatePage('script'); setSelected(0); show(debugRunning ? '已退出调试运行' : '已进入调试运行'); }}><BugPlay />{debugRunning ? '停止调试' : '调试运行'}</button><button className="button primary" onClick={() => setModal('publish')}><Rocket />发布游戏</button><button className="icon-button" title="运行设置" aria-label="运行设置" onClick={() => setSettingsOpen(true)}><Settings2 /></button><button className="icon-button" title="应用维护" aria-label="应用维护" onClick={() => setMaintenanceOpen(true)}><ShieldCheck /></button></div></nav>
    <main className={`workspace ${page === 'map' || page === 'stage' || page === 'texts' || page === 'characters' || page === 'scenes' || page === 'audio' ? 'map-workspace' : ''}`}>{!projectClosed && !['map', 'stage', 'texts', 'characters', 'scenes', 'audio'].includes(page) && !sidebarCollapsed && <Profiler id="chapter-tree" onRender={recordComponentRender}><Sidebar project={project} activate={activate} addChapter={addChapter} addFragment={addFragment} removeFragment={removeFragment} openSettings={() => setChapterSettingsOpen(true)} toggleChapterDisabled={toggleChapterDisabled} collapseSidebar={() => setSidebarCollapsed(true)} structureAction={(action, chapterId, fragmentId) => void structureAction(action, chapterId, fragmentId)} /></Profiler>}{!projectClosed && !['map', 'stage', 'texts', 'characters', 'scenes', 'audio'].includes(page) && sidebarCollapsed && <button className="sidebar-expand" title="展开章节列表" onClick={() => setSidebarCollapsed(false)}><ArrowRight /></button>}<section className="page-content"><AnimatePresence mode="wait" initial={false}><motion.div className="page-transition" key={projectClosed ? 'closed' : page} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -7 }} transition={{ duration: reducedMotion ? .08 : .22, ease: [.2, .8, .2, 1] }}>{projectClosed ? <div className="closed-project"><FolderOpen /><strong>没有打开的项目</strong><span>新建项目或打开本地 Slide v3 项目继续创作。</span><div><button className="button primary" onClick={() => void doNew()}><FilePlus2 />新建项目</button><button className="button ghost" onClick={() => void doOpen()}><FolderOpen />打开项目</button></div></div> : pages[page]}</motion.div></AnimatePresence></section></main>
     <ModalLayer modal={modal} project={project} close={() => { setModal(null); setBlockInsertIndex(null); }} addBlock={addBlock} runBuild={(kind, report, outputRoot, selectedBrowserMode) => void runBuild(kind, report, outputRoot, selectedBrowserMode)} locate={activate} buildOutputRoot={buildOutputRoot} updateBuildOutputRoot={updateBuildOutputRoot} browserMode={browserMode} updateBrowserMode={updateBrowserMode} />
    {buildProgress && <BuildProgressDialog task={buildProgress} close={() => { if (buildProgress.status !== 'running') setBuildProgress(null); }} />}
    {modal === 'search' && <SearchPalette project={project} close={() => setModal(null)} locate={locateSearchResult} replaceText={replaceProjectText} />}
    <RuntimeSettingsDialog open={settingsOpen} project={project} close={() => setSettingsOpen(false)} apply={(settings, resolution) => { commit((current) => ({ ...current, settings, meta: { ...current.meta, resolution } }), '更新运行设置'); setSettingsOpen(false); show('运行设置已更新'); }} />
    <DesktopMaintenanceDialog open={maintenanceOpen} close={() => setMaintenanceOpen(false)} notify={show} requestConfirm={requestConfirm} />
    <EditorAppearanceDialog open={themeOpen} close={() => setThemeOpen(false)} openGameTheme={() => setGameThemeOpen(true)} />
    <GameUiThemeDialog open={gameThemeOpen} project={project} close={() => setGameThemeOpen(false)} relinkAsset={async (assetId) => { const replacement = await replaceAssetFile(assetId); if (!replacement) return; commit((current) => { const existing = current.assets.find((asset) => asset.id === assetId); const next = { ...existing, ...replacement, id: assetId, forceBundle: existing?.forceBundle } as Asset; return { ...current, assets: existing ? current.assets.map((asset) => asset.id === assetId ? next : asset) : [...current.assets, next] }; }, `重新定位游戏 UI 素材 ${assetId}`); show('游戏 UI 素材已恢复'); }} apply={(ui, gameVersion) => { commit((current) => ({ ...current, ui, meta: { ...current.meta, gameVersion } }), '更新游戏 UI 主题'); setGameThemeOpen(false); show('游戏 UI 主题已应用'); }} />
    <ChapterSchedulingDialog open={chapterSettingsOpen} project={project} close={() => setChapterSettingsOpen(false)} apply={(chapterScheduling) => { commit((current) => ({ ...current, settings: { ...current.settings, chapterScheduling } }), '更新章节调度'); setChapterSettingsOpen(false); show('章节运行设置已更新'); }} />
    <NotificationCenter open={notificationsOpen} items={notifications} close={() => setNotificationsOpen(false)} markAllRead={() => setNotifications((items) => items.map((item) => ({ ...item, read: true })))} clear={() => setNotifications([])} />
    <ScriptImportDialog open={scriptImportOpen} busy={scriptImportBusy} preview={scriptImportPreview} characters={project.characters} updatePreview={setScriptImportPreview} close={() => { setScriptImportOpen(false); setScriptImportPreview(null); }} selectFile={(rules) => void selectScriptImport(rules)} pasteText={(rules) => void pasteScriptImport(rules)} apply={applyScriptImport} />
    <FrontendDialog dialog={appDialog} updateValue={(value) => setAppDialog((current) => current ? { ...current, value } : current)} close={closeAppDialog} />
    <AnimatePresence>{toast && <motion.div className={`toast show ${toast.tone === 'error' ? 'error' : ''}`} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: .98 }} transition={{ duration: reducedMotion ? .08 : .2 }}>{toast.tone === 'error' ? <CircleAlert /> : <CheckCircle2 />}<span>{toast.text}</span></motion.div>}</AnimatePresence>
  </div></Profiler>;
}
