import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  BookOpen, Braces, ChevronRight, CircleDot, CirclePlay, ExternalLink, FileText,
  GitBranch, GitCommitHorizontal, GripVertical, LayoutList, ListTree, LocateFixed,
  Maximize2, Minus, Pencil, Plus, Power, PowerOff, RotateCcw, Search, Trash2, Variable,
} from 'lucide-react';
import { Select } from './ui/Select';
import type { Project, StoryBlock, VariableDefinition, VariablePersistence, VariableScope, VariableType } from '../types';

type Point = { x: number; y: number };
type NodeKind = 'chapter' | 'fragment' | 'branch' | 'condition' | 'write' | 'jump' | 'call';
type NarrativeNode = {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle: string;
  fragmentId?: string;
  blockIndex?: number;
  chapterId?: string;
  disabled?: boolean;
};
type EdgeKind = 'trunk' | 'structure' | 'branch' | 'condition' | 'jump' | 'call' | 'variable';
type NarrativeEdge = {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
  sourceFragment?: string;
  blockId?: string;
  optionIndex?: number;
  slot?: 'true' | 'false';
  variable?: string;
  detachable?: boolean;
};
type Focus = { type: 'structure' | 'variable' | 'branch'; id: string } | null;

type Props = {
  project: Project;
  activate: (fragmentId: string, blockIndex?: number) => void;
  commit: (updater: (project: Project) => Project, label?: string) => void;
  notify: (message: string, tone?: 'error' | 'success') => void;
  requestText: (options: { title: string; message?: string; placeholder?: string; initialValue?: string; confirmText?: string }) => Promise<string | null>;
};

const nodeWidth = 210;
const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const inferType = (value: string | number | boolean): VariableType => typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';
const defaultDefinition = (value: string | number | boolean): VariableDefinition => ({ type: inferType(value), scope: 'project', persistence: 'slot' });
const blockTitle = (block: StoryBlock) => block.type === 'branch' ? block.title || '选项分支' : block.type === 'condition' ? `${block.variable || '变量'} 条件` : block.type === 'setVariable' ? `写入 ${block.variable || '变量'}` : block.type === 'call' ? '调用片段' : '跳转片段';
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasBinding = (value: string, name: string) => value.includes(`\${${name}}`) || value.includes(`{{${name}}}`) || new RegExp(`\\$${escapeRegExp(name)}(?![\\w\u4e00-\u9fff])`).test(value);
const migrateBinding = (value: string, oldName: string, newName: string) => value
  .replaceAll(`\${${oldName}}`, `\${${newName}}`)
  .replaceAll(`{{${oldName}}}`, `{{${newName}}}`)
  .replace(new RegExp(`\\$${escapeRegExp(oldName)}(?![\\w\u4e00-\u9fff])`, 'g'), `$${newName}`);
const migrateBindingsDeep = (value: unknown, oldName: string, newName: string): unknown => {
  if (typeof value === 'string') return migrateBinding(value, oldName, newName);
  if (Array.isArray(value)) return value.map((item) => migrateBindingsDeep(item, oldName, newName));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateBindingsDeep(item, oldName, newName)]));
  return value;
};
const containsBindingDeep = (value: unknown, name: string): boolean => {
  if (typeof value === 'string') return hasBinding(value, name);
  if (Array.isArray(value)) return value.some((item) => containsBindingDeep(item, name));
  if (value && typeof value === 'object') return Object.values(value).some((item) => containsBindingDeep(item, name));
  return false;
};

function buildGraph(project: Project) {
  const nodes: NarrativeNode[] = [];
  const edges: NarrativeEdge[] = [];
  const defaults: Record<string, Point> = {};
  const fragmentIds = new Set(project.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => fragment.id)));
  const chapterGap = 430;

  project.chapters.forEach((chapter, chapterIndex) => {
    const chapterNodeId = `chapter:${chapter.id}`;
    nodes.push({ id: chapterNodeId, kind: 'chapter', title: chapter.name, subtitle: chapter.entry ? '游戏入口' : chapter.disabled ? `已禁用 · ${chapter.fragments.length} 个 Fragment` : `${chapter.fragments.length} 个 Fragment`, chapterId: chapter.id, disabled: chapter.disabled });
    defaults[chapterNodeId] = { x: 90 + chapterIndex * chapterGap, y: 80 };
    const nextChapter = project.chapters[chapterIndex + 1];
    if (nextChapter) edges.push({ id: `trunk:${chapter.id}`, source: chapterNodeId, target: `chapter:${nextChapter.id}`, kind: 'trunk', label: '章节顺序' });

    chapter.fragments.forEach((fragment, fragmentIndex) => {
      const x = 90 + chapterIndex * chapterGap + fragmentIndex * 245;
      const fragmentNodeId = `fragment:${fragment.id}`;
      nodes.push({ id: fragmentNodeId, kind: 'fragment', title: fragment.name, subtitle: chapter.name, fragmentId: fragment.id, chapterId: chapter.id, disabled: chapter.disabled });
      defaults[fragmentNodeId] = { x, y: 265 };
      edges.push({ id: `owns:${chapter.id}:${fragment.id}`, source: chapterNodeId, target: fragmentNodeId, kind: 'structure', label: '包含' });

      let logicIndex = 0;
      (project.scripts[fragment.id] ?? []).forEach((block, blockIndex) => {
        if (!['branch', 'condition', 'setVariable', 'jump', 'call'].includes(block.type)) return;
        const kind: NodeKind = block.type === 'setVariable' ? 'write' : block.type === 'branch' ? 'branch' : block.type === 'condition' ? 'condition' : block.type === 'call' ? 'call' : 'jump';
        const logicId = `logic:${block.id}`;
        nodes.push({ id: logicId, kind, title: blockTitle(block), subtitle: `Block ${blockIndex + 1}`, fragmentId: fragment.id, blockIndex, chapterId: chapter.id });
        defaults[logicId] = { x, y: 445 + logicIndex * 155 };
        edges.push({ id: `structure:${fragment.id}:${block.id}`, source: fragmentNodeId, target: logicId, kind: 'structure' });
        logicIndex += 1;

        if (block.type === 'branch') (block.options ?? []).forEach((option, optionIndex) => {
          if (!fragmentIds.has(option.target)) return;
          edges.push({ id: `${block.id}:option:${optionIndex}`, source: logicId, target: `fragment:${option.target}`, kind: 'branch', label: option.text, sourceFragment: fragment.id, blockId: block.id, optionIndex, detachable: true });
        });
        if (block.type === 'condition') {
          if (block.trueTarget && fragmentIds.has(block.trueTarget)) edges.push({ id: `${block.id}:true`, source: logicId, target: `fragment:${block.trueTarget}`, kind: 'condition', label: '成立', sourceFragment: fragment.id, blockId: block.id, slot: 'true', variable: block.variable, detachable: true });
          if (block.falseTarget && fragmentIds.has(block.falseTarget)) edges.push({ id: `${block.id}:false`, source: logicId, target: `fragment:${block.falseTarget}`, kind: 'condition', label: '否则', sourceFragment: fragment.id, blockId: block.id, slot: 'false', variable: block.variable, detachable: true });
        }
        if ((block.type === 'jump' || block.type === 'call') && block.target && fragmentIds.has(block.target)) edges.push({ id: `${block.id}:target`, source: logicId, target: `fragment:${block.target}`, kind: block.type, label: block.type === 'call' ? '调用并返回' : '跳转', sourceFragment: fragment.id, blockId: block.id, detachable: true });
      });
    });
  });

  const writes = nodes.filter((node) => node.kind === 'write');
  const reads = nodes.filter((node) => node.kind === 'condition');
  writes.forEach((write) => {
    const block = project.scripts[write.fragmentId ?? '']?.[write.blockIndex ?? -1];
    if (!block || block.type !== 'setVariable' || !block.variable) return;
    reads.forEach((read) => {
      const readBlock = project.scripts[read.fragmentId ?? '']?.[read.blockIndex ?? -1];
      if (readBlock?.type === 'condition' && readBlock.variable === block.variable) edges.push({ id: `variable:${write.id}:${read.id}`, source: write.id, target: read.id, kind: 'variable', label: block.variable, variable: block.variable });
    });
  });
  return { nodes, edges, defaults };
}

export function NarrativeMap({ project, activate, commit, notify, requestText }: Props) {
  const graph = useMemo(() => buildGraph(project), [project.chapters, project.scripts]);
  const graphNodeIds = useMemo(() => graph.nodes.map((node) => node.id).join('\u001f'), [graph.nodes]);
  const [positions, setPositions] = useState<Record<string, Point>>(() => ({ ...graph.defaults, ...(project.settings.narrativeMap?.positions ?? {}) }));
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: .85 });
  const [tab, setTab] = useState<'structure' | 'variables' | 'branches'>('structure');
  const [branchView, setBranchView] = useState<'chapter' | 'flat'>('chapter');
  const [focus, setFocus] = useState<Focus>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [variableQuery, setVariableQuery] = useState('');
  const [wireDraft, setWireDraft] = useState<{ source: string; x: number; y: number } | null>(null);
  const [wireTargetId, setWireTargetId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef(positions);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; nodeId: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const wireRef = useRef<{ pointerId: number; source: string } | null>(null);

  useEffect(() => {
    setPositions((current) => {
      const next = Object.fromEntries(graph.nodes.map((node) => [node.id, current[node.id] ?? project.settings.narrativeMap?.positions?.[node.id] ?? graph.defaults[node.id]]));
      positionsRef.current = next;
      return next;
    });
  }, [graphNodeIds, project.meta.id]);

  const variableNodeReferences = useMemo(() => Object.fromEntries(Object.keys(project.variables).map((name) => {
    const refs = graph.nodes.filter((node) => {
      if (node.blockIndex === undefined || !node.fragmentId) return false;
      const block = project.scripts[node.fragmentId]?.[node.blockIndex];
      return (block?.type === 'setVariable' || block?.type === 'condition') && block.variable === name;
    });
    return [name, refs];
  })), [project.variables, project.scripts, graph.nodes]) as Record<string, NarrativeNode[]>;
  const variableReferences = useMemo(() => Object.fromEntries(Object.keys(project.variables).map((name) => {
    const refs: Array<{ id: string; label: string; kind: 'read' | 'write' | 'binding'; fragmentId?: string; blockIndex?: number }> = [];
    Object.entries(project.scripts).forEach(([fragmentId, blocks]) => blocks.forEach((block, blockIndex) => {
      if ((block.type === 'setVariable' || block.type === 'condition') && block.variable === name) refs.push({ id: `${block.id}:variable`, label: `${block.type === 'setVariable' ? '写入' : '读取'} · ${blockTitle(block)}`, kind: block.type === 'setVariable' ? 'write' : 'read', fragmentId, blockIndex });
      const boundFields = [block.text, block.title, block.speaker].filter((value): value is string => typeof value === 'string' && hasBinding(value, name));
      if (boundFields.length) refs.push({ id: `${block.id}:binding`, label: `文本绑定 · Block ${blockIndex + 1}`, kind: 'binding', fragmentId, blockIndex });
    }));
    project.characters.forEach((character) => { if (hasBinding(character.name, name) || character.name === name) refs.push({ id: `character:${character.id}`, label: `角色显示名 · ${character.name}`, kind: 'binding' }); });
    if (containsBindingDeep(project.ui, name)) refs.push({ id: 'ui:bindings', label: '可视化界面绑定', kind: 'binding' });
    if (containsBindingDeep(project.translations, name)) refs.push({ id: 'translations:bindings', label: '本地化文本绑定', kind: 'binding' });
    return [name, refs];
  })), [project.variables, project.scripts, project.characters, project.ui, project.translations]) as Record<string, Array<{ id: string; label: string; kind: 'read' | 'write' | 'binding'; fragmentId?: string; blockIndex?: number }>>;
  const branchBlocks = useMemo(() => project.chapters.map((chapter) => ({ chapterId: chapter.id, chapterName: chapter.name, branches: chapter.fragments.flatMap((fragment) => (project.scripts[fragment.id] ?? []).flatMap((block, blockIndex) => block.type === 'branch' ? [{ id: `logic:${block.id}`, blockId: block.id, title: block.title || '选项分支', fragmentId: fragment.id, fragmentName: fragment.name, blockIndex, options: (block.options ?? []).map((option, index) => ({ id: `${block.id}:option:${index}`, nodeId: `logic:${block.id}`, text: option.text, target: option.target, index })) }] : [])) })).filter((group) => group.branches.length), [project.chapters, project.scripts]);
  const branches = branchBlocks.flatMap((group) => group.branches.flatMap((branch) => branch.options.map((option) => ({ ...option, fragmentId: branch.fragmentId, blockIndex: branch.blockIndex }))));

  const isHighlightedNode = (node: NarrativeNode) => {
    if (!focus) return false;
    if (focus.type === 'structure') return focus.id === node.id;
    if (focus.type === 'branch') return focus.id === node.id || branches.find((branch) => branch.id === focus.id)?.nodeId === node.id || graph.edges.find((edge) => edge.id === focus.id)?.target === node.id;
    return variableNodeReferences[focus.id]?.some((item) => item.id === node.id) ?? false;
  };
  const isHighlightedEdge = (edge: NarrativeEdge) => focus?.type === 'structure' ? edge.source === focus.id || edge.target === focus.id : focus?.type === 'branch' ? edge.id === focus.id || edge.source === focus.id : focus?.type === 'variable' ? edge.variable === focus.id : false;
  const hasFocus = Boolean(focus);
  const definitionFor = (name: string) => project.variableDefinitions?.[name] ?? defaultDefinition(project.variables[name]);
  const persistPositions = (next: Record<string, Point>, label = '移动叙事地图节点') => commit((current) => ({ ...current, settings: { ...current.settings, narrativeMap: { positions: next } } }), label);
  const toCanvasPoint = (clientX: number, clientY: number) => { const rect = canvasRef.current?.getBoundingClientRect(); return { x: ((clientX - (rect?.left ?? 0)) - viewport.x) / viewport.scale, y: ((clientY - (rect?.top ?? 0)) - viewport.y) / viewport.scale }; };
  const edgePath = (edge: NarrativeEdge, targetPoint?: Point) => {
    const source = positions[edge.source]; const target = targetPoint ?? positions[edge.target];
    if (!source || !target) return '';
    const x1 = source.x + nodeWidth; const y1 = source.y + 48; const x2 = target.x; const y2 = target.y + 48;
    if (edge.kind === 'trunk') return `M ${x1} ${y1} L ${x2} ${y2}`;
    const bend = Math.max(60, Math.abs(x2 - x1) * .42);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  };
  const fitView = () => {
    const values = Object.values(positionsRef.current); const canvas = canvasRef.current;
    if (!values.length || !canvas) return;
    const minX = Math.min(...values.map((point) => point.x)); const minY = Math.min(...values.map((point) => point.y));
    const maxX = Math.max(...values.map((point) => point.x + nodeWidth)); const maxY = Math.max(...values.map((point) => point.y + 110));
    const scale = Math.max(.35, Math.min(1.25, Math.min((canvas.clientWidth - 90) / (maxX - minX), (canvas.clientHeight - 90) / (maxY - minY))));
    setViewport({ x: 45 - minX * scale, y: 45 - minY * scale, scale });
  };
  const resetLayout = () => { setPositions(graph.defaults); positionsRef.current = graph.defaults; persistPositions({}, '恢复叙事地图默认布局'); setViewport({ x: 0, y: 0, scale: .85 }); notify('已恢复默认布局'); };
  const locateActive = () => { const point = positions[`fragment:${project.activeFragmentId}`]; if (point) setViewport((current) => ({ ...current, x: 320 - point.x * current.scale, y: 170 - point.y * current.scale })); };
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => { if ((event.target as HTMLElement).closest('.narrative-node,.map-path-hit,.narrative-map-tools')) return; event.currentTarget.setPointerCapture(event.pointerId); panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: viewport.x, originY: viewport.y }; setSelectedEdgeId(null); };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => { const pan = panRef.current; if (!pan || pan.pointerId !== event.pointerId) return; setViewport((current) => ({ ...current, x: pan.originX + event.clientX - pan.startX, y: pan.originY + event.clientY - pan.startY })); };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); panRef.current = null; };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheelZoom = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      setViewport((current) => {
        const nextScale = Math.max(.35, Math.min(2, current.scale * (event.deltaY > 0 ? .9 : 1.1)));
        return {
          x: cx - (cx - current.x) * nextScale / current.scale,
          y: cy - (cy - current.y) * nextScale / current.scale,
          scale: nextScale,
        };
      });
    };
    canvas.addEventListener('wheel', wheelZoom, { passive: false });
    return () => canvas.removeEventListener('wheel', wheelZoom);
  }, []);
  const beginDrag = (nodeId: string, event: ReactPointerEvent<HTMLDivElement>) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); const point = positions[nodeId]; dragRef.current = { pointerId: event.pointerId, nodeId, startX: event.clientX, startY: event.clientY, originX: point.x, originY: point.y }; };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => { const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; event.stopPropagation(); setPositions((current) => { const next = { ...current, [drag.nodeId]: { x: Math.max(20, Math.round(drag.originX + (event.clientX - drag.startX) / viewport.scale)), y: Math.max(20, Math.round(drag.originY + (event.clientY - drag.startY) / viewport.scale)) } }; positionsRef.current = next; return next; }); };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (!dragRef.current) return; event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); dragRef.current = null; persistPositions(positionsRef.current); };
  const findTarget = (clientX: number, clientY: number) => {
    let result: string | null = null; let distance = 35;
    document.querySelectorAll<HTMLElement>('.narrative-port.in[data-fragment-id]').forEach((port) => { const rect = port.getBoundingClientRect(); const next = Math.hypot(clientX - rect.left - rect.width / 2, clientY - rect.top - rect.height / 2); if (next < distance) { result = port.dataset.fragmentId ?? null; distance = next; } });
    return result;
  };
  const connect = (source: string, target: string) => {
    if (source === target) return notify('不能把 Fragment 连接到自身', 'error');
    commit((current) => { const blocks = [...(current.scripts[source] ?? [])]; blocks.push({ id: `block-${Date.now().toString(36)}`, type: 'jump', version: 1, target }); return { ...current, scripts: { ...current.scripts, [source]: blocks } }; }, `连接叙事节点 ${source} → ${target}`);
    notify('已创建跳转关系');
  };
  const beginWire = (source: string, event: ReactPointerEvent<HTMLButtonElement>) => { event.stopPropagation(); wireRef.current = { pointerId: event.pointerId, source }; setWireDraft({ source: `fragment:${source}`, ...toCanvasPoint(event.clientX, event.clientY) }); };
  useEffect(() => {
    const move = (event: PointerEvent) => { const wire = wireRef.current; if (!wire || wire.pointerId !== event.pointerId) return; setWireTargetId(findTarget(event.clientX, event.clientY)); setWireDraft({ source: `fragment:${wire.source}`, ...toCanvasPoint(event.clientX, event.clientY) }); };
    const end = (event: PointerEvent) => { const wire = wireRef.current; if (!wire || wire.pointerId !== event.pointerId) return; const target = findTarget(event.clientX, event.clientY); wireRef.current = null; setWireDraft(null); setWireTargetId(null); if (target) connect(wire.source, target); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  });
  const detachEdge = () => {
    const edge = graph.edges.find((item) => item.id === selectedEdgeId && item.detachable); if (!edge?.sourceFragment || !edge.blockId) return;
    commit((current) => ({ ...current, scripts: { ...current.scripts, [edge.sourceFragment!]: current.scripts[edge.sourceFragment!].flatMap((block) => { if (block.id !== edge.blockId) return [block]; if (block.type === 'branch') return [{ ...block, options: block.options?.filter((_, index) => index !== edge.optionIndex) }]; if (block.type === 'condition') return [{ ...block, [edge.slot === 'true' ? 'trueTarget' : 'falseTarget']: undefined }]; return []; }) } }), '拆除叙事连线');
    setSelectedEdgeId(null); notify('连线已拆除');
  };
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key.toLowerCase() === 'f' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); fitView(); } if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) detachEdge(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); });

  const addVariable = async () => { const name = await requestText({ title: '新增变量', message: '变量名用于条件和设置变量 Block，创建后可继续配置类型与持久化。', placeholder: '例如：好感度', confirmText: '创建变量' }); if (!name) return; if (name in project.variables) return notify('变量名已经存在', 'error'); commit((current) => ({ ...current, variables: { ...current.variables, [name]: 0 }, variableDefinitions: { ...current.variableDefinitions, [name]: defaultDefinition(0) } }), `新增变量 ${name}`); setFocus({ type: 'variable', id: name }); };
  const renameVariable = async (oldName: string) => {
    const definition = definitionFor(oldName);
    if (definition.scope === 'system') return notify('系统变量只读，不能重命名', 'error');
    const newName = await requestText({ title: '重命名变量名', message: `将扫描并迁移“${oldName}”的已知引用。动态拼接的扩展代码字符串需要迁移后手动检查。`, initialValue: oldName, confirmText: '迁移并重命名' });
    if (!newName || newName === oldName) return;
    if (/\s/.test(newName)) return notify('变量名不能包含空格', 'error');
    if (newName in project.variables) return notify('目标变量名已经存在', 'error');
    const referenceCount = variableReferences[oldName]?.length ?? 0;
    commit((current) => {
      const variables = Object.fromEntries(Object.entries(current.variables).map(([name, value]) => [name === oldName ? newName : name, value]));
      const variableDefinitions = Object.fromEntries(Object.entries(current.variableDefinitions ?? {}).map(([name, value]) => [name === oldName ? newName : name, value]));
      const scripts = Object.fromEntries(Object.entries(current.scripts).map(([fragmentId, blocks]) => [fragmentId, blocks.map((block) => {
        const migrated = migrateBindingsDeep(block, oldName, newName) as StoryBlock;
        return (migrated.type === 'setVariable' || migrated.type === 'condition') && migrated.variable === oldName ? { ...migrated, variable: newName } : migrated;
      })]));
      const characters = current.characters.map((character) => ({ ...character, name: character.name === oldName ? newName : migrateBinding(character.name, oldName, newName) }));
      return { ...current, variables, variableDefinitions, scripts, characters, ui: migrateBindingsDeep(current.ui, oldName, newName) as Project['ui'], translations: migrateBindingsDeep(current.translations, oldName, newName) as Project['translations'] };
    }, `重命名变量 ${oldName} → ${newName}`);
    setFocus({ type: 'variable', id: newName });
    notify(`变量已重命名并迁移 ${referenceCount} 处已知引用；请检查自定义扩展代码`);
  };
  const patchDefinition = (name: string, patch: Partial<VariableDefinition>) => commit((current) => ({ ...current, variableDefinitions: { ...current.variableDefinitions, [name]: { ...(current.variableDefinitions?.[name] ?? defaultDefinition(current.variables[name])), ...patch } } }), `更新变量 ${name}`);
  const updateDefault = (name: string, value: string, type: VariableType) => { const parsed = type === 'boolean' ? value === 'true' : type === 'number' ? Number(value) || 0 : value; commit((current) => ({ ...current, variables: { ...current.variables, [name]: parsed } }), `修改变量默认值 ${name}`); };
  const removeVariable = (name: string) => { if (variableReferences[name]?.length) return notify(`${name} 仍被 ${variableReferences[name].length} 个 Block 引用`, 'error'); commit((current) => { const variables = { ...current.variables }; const variableDefinitions = { ...current.variableDefinitions }; delete variables[name]; delete variableDefinitions[name]; return { ...current, variables, variableDefinitions }; }, `删除变量 ${name}`); if (focus?.type === 'variable' && focus.id === name) setFocus(null); };

  const activeChapter = project.chapters.find((chapter) => chapter.fragments.some((fragment) => fragment.id === project.activeFragmentId)) ?? project.chapters[0];
  const focusStructure = (nodeId: string) => {
    setFocus((current) => current?.type === 'structure' && current.id === nodeId ? null : { type: 'structure', id: nodeId });
    const point = positions[nodeId];
    const canvas = canvasRef.current;
    if (point && canvas) setViewport((current) => ({ ...current, x: canvas.clientWidth / 2 - (point.x + nodeWidth / 2) * current.scale, y: canvas.clientHeight / 2 - (point.y + 48) * current.scale }));
  };
  const addChapter = async () => {
    const name = await requestText({ title: '新增章节', message: '新章节会同时出现在剧本树和叙事地图，并创建一个“主线”片段。', placeholder: `新章节 ${project.chapters.length + 1}`, confirmText: '创建章节' });
    if (!name) return;
    const chapterId = makeId('chapter');
    const fragmentId = makeId('fragment');
    commit((current) => ({ ...current, activeFragmentId: fragmentId, chapters: [...current.chapters, { id: chapterId, name, fragments: [{ id: fragmentId, name: '主线' }] }], scripts: { ...current.scripts, [fragmentId]: [] } }), `从叙事地图新增章节 ${name}`);
    setFocus({ type: 'structure', id: `fragment:${fragmentId}` });
    notify(`章节“${name}”已同步到剧本结构`);
  };
  const addFragment = async (chapterId = activeChapter?.id) => {
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) return;
    const name = await requestText({ title: '新增片段', message: `片段会添加到“${chapter.name}”，并立即同步到剧本树。`, placeholder: `新片段 ${chapter.fragments.length + 1}`, confirmText: '创建片段' });
    if (!name) return;
    const fragmentId = makeId('fragment');
    commit((current) => ({ ...current, activeFragmentId: fragmentId, chapters: current.chapters.map((item) => item.id === chapterId ? { ...item, fragments: [...item.fragments, { id: fragmentId, name }] } : item), scripts: { ...current.scripts, [fragmentId]: [] } }), `从叙事地图新增片段 ${name}`);
    setFocus({ type: 'structure', id: `fragment:${fragmentId}` });
    notify(`片段“${name}”已同步到剧本结构`);
  };
  const renameChapter = async (chapterId: string) => {
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) return;
    const name = await requestText({ title: '重命名章节', message: '新名称会同步到剧本树、叙事地图和所有结构引用界面。', initialValue: chapter.name, confirmText: '保存名称' });
    if (!name || name === chapter.name) return;
    commit((current) => ({ ...current, chapters: current.chapters.map((item) => item.id === chapterId ? { ...item, name } : item) }), `从叙事地图重命名章节 ${chapter.name} → ${name}`);
    notify('章节名称已同步');
  };
  const renameFragment = async (chapterId: string, fragmentId: string) => {
    const fragment = project.chapters.find((item) => item.id === chapterId)?.fragments.find((item) => item.id === fragmentId);
    if (!fragment) return;
    const name = await requestText({ title: '重命名片段', message: 'Fragment 标识和跳转引用保持不变，只同步显示名称。', initialValue: fragment.name, confirmText: '保存名称' });
    if (!name || name === fragment.name) return;
    commit((current) => ({ ...current, chapters: current.chapters.map((chapter) => chapter.id === chapterId ? { ...chapter, fragments: chapter.fragments.map((item) => item.id === fragmentId ? { ...item, name } : item) } : chapter) }), `从叙事地图重命名片段 ${fragment.name} → ${name}`);
    notify('片段名称已同步');
  };
  const toggleChapter = (chapterId: string) => commit((current) => ({ ...current, chapters: current.chapters.map((chapter) => chapter.id === chapterId && !chapter.entry ? { ...chapter, disabled: !chapter.disabled } : chapter) }), '从叙事地图切换章节启用状态');
  const structurePanel = <><div className="narrative-structure-summary"><span>{project.chapters.length} 章</span><span>{project.chapters.reduce((total, chapter) => total + chapter.fragments.length, 0)} 个片段</span><button className="icon-button" title="新增章节" aria-label="从叙事地图新增章节" onClick={() => void addChapter()}><Plus /></button></div><div className="narrative-structure-list">{project.chapters.map((chapter) => <section className={chapter.disabled ? 'disabled' : ''} data-chapter-id={chapter.id} key={chapter.id}><header><button className={`narrative-structure-main ${focus?.type === 'structure' && focus.id === `chapter:${chapter.id}` ? 'active' : ''}`} onClick={() => focusStructure(`chapter:${chapter.id}`)}>{chapter.entry ? <CirclePlay /> : <BookOpen />}<span><strong>{chapter.name}</strong><small>{chapter.entry ? '游戏入口' : chapter.disabled ? '调试与构建时跳过' : `${chapter.fragments.length} 个 Fragment`}</small></span></button><div className="narrative-structure-actions"><button title={`在 ${chapter.name} 新建片段`} aria-label={`在 ${chapter.name} 新建片段`} onClick={() => void addFragment(chapter.id)}><Plus /></button><button title={`重命名章节 ${chapter.name}`} aria-label={`重命名章节 ${chapter.name}`} onClick={() => void renameChapter(chapter.id)}><Pencil /></button>{!chapter.entry && <button title={chapter.disabled ? `启用章节 ${chapter.name}` : `禁用章节 ${chapter.name}`} aria-label={chapter.disabled ? `启用章节 ${chapter.name}` : `禁用章节 ${chapter.name}`} onClick={() => toggleChapter(chapter.id)}>{chapter.disabled ? <Power /> : <PowerOff />}</button>}</div></header><div className="narrative-fragment-list">{chapter.fragments.map((fragment) => <div className={fragment.id === project.activeFragmentId ? 'active' : ''} data-fragment-id={fragment.id} key={fragment.id}><button className="narrative-fragment-main" onClick={() => focusStructure(`fragment:${fragment.id}`)}><FileText /><span><strong>{fragment.name}</strong><small>{project.scripts[fragment.id]?.length ?? 0} Blocks</small></span></button><button title={`重命名片段 ${fragment.name}`} aria-label={`重命名片段 ${fragment.name}`} onClick={() => void renameFragment(chapter.id, fragment.id)}><Pencil /></button><button title={`打开片段 ${fragment.name}`} aria-label={`打开片段 ${fragment.name}`} onClick={() => activate(fragment.id)}><ExternalLink /></button></div>)}</div></section>)}</div></>;

  return <div className="dashboard-page narrative-map-page">
    <div className="page-header"><div><h1>叙事地图</h1><p>与剧本结构共享章节、Fragment、Block 和流程引用</p></div><div className="page-header-actions"><button className="button primary" onClick={() => void addFragment()}><Plus />新增片段</button><button className="button ghost" onClick={() => void addChapter()}><BookOpen />新增章节</button><button className="button danger" disabled={!selectedEdgeId} onClick={detachEdge}><Trash2 />拆除连线</button><button className="button ghost" onClick={locateActive}><LocateFixed />当前节点</button><button className="button ghost" onClick={fitView}><Maximize2 />适应视图</button></div></div>
    <div className="narrative-map-layout">
      <aside className={`narrative-data-panel tab-${tab}`}>
        {tab === 'structure' && structurePanel}
        <div className="narrative-tabs"><button className={tab === 'structure' ? 'active' : ''} onClick={() => setTab('structure')}><ListTree />剧本结构</button><button className={tab === 'variables' ? 'active' : ''} onClick={() => setTab('variables')}><Variable />变量</button><button className={tab === 'branches' ? 'active' : ''} onClick={() => setTab('branches')}><GitBranch />分支</button></div>
        {tab === 'variables' ? <><div className="narrative-panel-toolbar"><div className="asset-search"><Search /><input value={variableQuery} onChange={(event) => setVariableQuery(event.target.value)} placeholder="搜索变量" /></div><button className="icon-button" title="新增变量" onClick={() => void addVariable()}><Plus /></button></div><div className="variable-table">{Object.entries(project.variables).filter(([name]) => name.toLocaleLowerCase().includes(variableQuery.toLocaleLowerCase())).map(([name, value]) => { const definition = definitionFor(name); const refs = variableReferences[name] ?? []; const readOnly = definition.scope === 'system'; const expanded = focus?.type === 'variable' && focus.id === name; return <article className={`${expanded ? 'active' : ''} ${readOnly ? 'system-variable' : ''}`} key={name}><button className="variable-summary" onClick={() => setFocus(expanded ? null : { type: 'variable', id: name })}><ChevronRight /><span><strong>{definition.displayName || name}</strong><small>{name} · {refs.length} 处引用</small></span><em>{readOnly ? '系统' : definition.type === 'boolean' ? '布尔' : definition.type === 'number' ? '数值' : '文本'}</em></button>{expanded && <div className="variable-editor"><div className="variable-key-row"><label>变量名<code>{name}</code></label><button className="button ghost" disabled={readOnly} onClick={() => void renameVariable(name)}><Pencil />重命名变量名</button></div><label>显示名<input disabled={readOnly} defaultValue={definition.displayName ?? ''} onBlur={(event) => patchDefinition(name, { displayName: event.target.value.trim() })} /></label><label>用途说明<textarea disabled={readOnly} defaultValue={definition.description ?? ''} onBlur={(event) => patchDefinition(name, { description: event.target.value.trim() })} /></label><div className="variable-editor-row"><label>类型<Select disabled={readOnly} value={definition.type} onChange={(value) => patchDefinition(name, { type: value as VariableType })}><option value="boolean">布尔</option><option value="number">数值</option><option value="string">文本</option></Select></label><label>默认值{definition.type === 'boolean' ? <Select disabled={readOnly} value={String(value)} onChange={(value) => updateDefault(name, value, definition.type)}><option value="false">false</option><option value="true">true</option></Select> : <input disabled={readOnly} defaultValue={String(value)} onBlur={(event) => updateDefault(name, event.target.value, definition.type)} />}</label></div><div className="variable-editor-row"><label>作用域<Select disabled={readOnly} value={definition.scope} onChange={(value) => patchDefinition(name, { scope: value as VariableScope })}><option value="project">项目变量</option><option value="system">系统变量</option></Select></label><label>持久化<Select disabled={readOnly} value={definition.persistence} onChange={(value) => patchDefinition(name, { persistence: value as VariablePersistence })}><option value="slot">存档绑定</option><option value="shared">全局共享</option></Select></label></div><div className="variable-references"><strong>引用位置</strong>{refs.map((ref) => <button key={ref.id} disabled={!ref.fragmentId} onClick={() => ref.fragmentId && activate(ref.fragmentId, ref.blockIndex)}><span>{ref.label}</span>{ref.fragmentId && <ExternalLink />}</button>)}{!refs.length && <small>尚未被 Block 使用</small>}</div><button className="button danger" disabled={Boolean(refs.length) || readOnly} onClick={() => removeVariable(name)}><Trash2 />删除变量</button>{readOnly && <small className="system-variable-note">系统变量由引擎注入，只能查看。</small>}</div>}</article>; })}</div></> : <><div className="branch-view-switch"><button className={branchView === 'chapter' ? 'active' : ''} onClick={() => setBranchView('chapter')}><ListTree />按章节</button><button className={branchView === 'flat' ? 'active' : ''} onClick={() => setBranchView('flat')}><LayoutList />平铺</button></div><div className={`branch-list ${branchView}`}>{branchView === 'chapter' ? branchBlocks.map((group) => <details open key={group.chapterId}><summary>{group.chapterName}<small>{group.branches.length} 个分支</small></summary>{group.branches.map((branch) => <div className="branch-tree-group" key={branch.id}><button className={focus?.type === 'branch' && focus.id === branch.id ? 'active' : ''} onClick={() => setFocus(focus?.type === 'branch' && focus.id === branch.id ? null : { type: 'branch', id: branch.id })}><GitBranch /><span><strong>{branch.title}</strong><small>{branch.fragmentName} · Block {branch.blockIndex + 1}</small></span></button>{branch.options.map((option) => { const active = focus?.type === 'branch' && focus.id === option.id; const target = graph.nodes.find((node) => node.id === `fragment:${option.target}`); return <button className={`branch-tree-option ${active ? 'active' : ''}`} key={option.id} onClick={() => setFocus(active ? null : { type: 'branch', id: option.id })}><em>{String.fromCharCode(65 + option.index)}</em><span><strong>{option.text}</strong><small>前往 {target?.title ?? option.target}</small></span></button>; })}</div>)}</details>) : branchBlocks.flatMap((group) => group.branches).map((branch) => <div className="branch-flat-group" key={branch.id}><button className={focus?.type === 'branch' && focus.id === branch.id ? 'active' : ''} onClick={() => setFocus(focus?.type === 'branch' && focus.id === branch.id ? null : { type: 'branch', id: branch.id })}><GitBranch /><span><strong>{branch.title}</strong><small>{branch.fragmentName} · {branch.options.length} 个选项</small></span></button>{branch.options.map((option) => { const active = focus?.type === 'branch' && focus.id === option.id; return <button className={active ? 'active' : ''} key={option.id} onClick={() => setFocus(active ? null : { type: 'branch', id: option.id })}><em>{String.fromCharCode(65 + option.index)}</em><span>{option.text}</span></button>; })}</div>)}{!branchBlocks.length && <div className="narrative-empty">当前项目没有分支选项</div>}</div></>}
      </aside>
      <section className="narrative-flow-panel">
        <div className="narrative-map-tools"><div className="map-zoom"><button className="icon-button" title="缩小" onClick={() => setViewport((current) => ({ ...current, scale: Math.max(.35, current.scale - .1) }))}><Minus /></button><span>{Math.round(viewport.scale * 100)}%</span><button className="icon-button" title="放大" onClick={() => setViewport((current) => ({ ...current, scale: Math.min(2, current.scale + .1) }))}><Plus /></button></div><button className="button ghost" onClick={() => setLegendOpen((value) => !value)}><CircleDot />图例</button>{legendOpen && <div className="narrative-legend">{[['trunk','章节主干'],['structure','结构 / 归属'],['branch','选项跳转'],['condition','条件跳转'],['call','调用片段'],['variable','变量读写']].map(([kind, label]) => <span key={kind}><i className={kind} />{label}</span>)}</div>}</div>
        <div className="map-canvas blueprint-canvas narrative-canvas" ref={canvasRef} tabIndex={0} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
          <div className="narrative-viewport" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}><div className="narrative-world"><svg className="map-lines" width="4000" height="1800"><defs><marker id="narrative-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" /></marker></defs>{graph.edges.map((edge) => { const path = edgePath(edge); const selected = selectedEdgeId === edge.id; const highlighted = isHighlightedEdge(edge); return <g key={edge.id} className={`${selected ? 'selected' : ''} ${highlighted ? 'causal-highlight' : ''} ${hasFocus && !highlighted ? 'causal-dim' : ''}`} onClick={(event) => { if (!edge.detachable) return; event.stopPropagation(); setSelectedEdgeId(edge.id); }}><path className="map-path-hit" d={path} /><path className={`map-path ${edge.kind}`} d={path} markerEnd="url(#narrative-arrow)" />{edge.label && <text x={(positions[edge.source]?.x + nodeWidth + (positions[edge.target]?.x ?? 0)) / 2} y={(positions[edge.source]?.y + (positions[edge.target]?.y ?? 0)) / 2 + 35}>{edge.label}</text>}</g>; })}{wireDraft && <path className="map-path draft" d={edgePath({ id: 'draft', source: wireDraft.source, target: '', kind: 'jump' }, wireDraft)} />}</svg>{graph.nodes.map((node) => { const point = positions[node.id]; if (!point) return null; const highlighted = isHighlightedNode(node); const isFragment = node.kind === 'fragment'; return <article className={`narrative-node kind-${node.kind} ${node.fragmentId === project.activeFragmentId ? 'active' : ''} ${highlighted ? 'causal-highlight' : ''} ${hasFocus && !highlighted ? 'causal-dim' : ''}`} style={{ left: point.x, top: point.y }} key={node.id}>{isFragment && <button className={`narrative-port in ${wireTargetId === node.fragmentId ? 'snap-target' : ''}`} data-fragment-id={node.fragmentId} aria-label={`连接到 ${node.title}`} />}<div className="node-header" onPointerDown={(event) => beginDrag(node.id, event)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><GripVertical />{node.kind === 'chapter' ? <GitCommitHorizontal /> : node.kind === 'write' ? <Braces /> : <GitBranch />}<span>{node.title}</span>{node.fragmentId && <button title="在剧本中打开" onPointerDown={(event) => event.stopPropagation()} onClick={() => activate(node.fragmentId!, node.blockIndex)}><ExternalLink /></button>}</div><div className="node-body"><span>{node.subtitle}</span><small>{node.kind === 'chapter' ? '章节主干' : node.kind === 'fragment' ? 'Fragment' : node.kind === 'write' ? '变量写入' : node.kind === 'condition' ? '变量读取 / 条件' : '流程控制'}</small></div>{isFragment && <button className="narrative-port out" aria-label={`从 ${node.title} 创建连线`} onPointerDown={(event) => beginWire(node.fragmentId!, event)} />}</article>; })}</div></div>
        </div>
        <div className="narrative-map-status"><span>拖动平移 · 滚轮缩放 · F 适应视图</span><button onClick={resetLayout}><RotateCcw />默认</button></div>
      </section>
    </div>
  </div>;
}
