import { useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronUp, ExternalLink, PanelBottom, PanelRight, Pencil, PictureInPicture2,
  Pin, PinOff, Plus, Search, Trash2, Variable as VariableIcon,
} from 'lucide-react';
import { Select } from './ui/Select';
import { collectVariableReferences, defaultVariableDefinition, renameVariableInProject } from '../core/variables';
import type { InspectorDock, Project, VariableDefinition, VariablePersistence, VariableScope, VariableType } from '../types';

interface VariablesPanelProps {
  project: Project;
  commit: (updater: (project: Project) => Project, label?: string) => void;
  notify: (message: string, tone?: 'error' | 'success') => void;
  requestText: (options: { title: string; message?: string; placeholder?: string; initialValue?: string; confirmText?: string }) => Promise<string | null>;
  activateFragment: (fragmentId: string, blockIndex?: number) => void;
  dock: InspectorDock;
  setDock: (dock: InspectorDock) => void;
  collapsed?: boolean;
  setCollapsed?: (collapsed: boolean) => void;
  standalone?: boolean;
  alwaysOnTop?: boolean;
  toggleAlwaysOnTop?: () => void;
  openStandalone?: () => void;
}

/**
 * 剧本编辑器的变量面板：变量在此“局外”定义，Block（设置 / 增减 / 条件）只引用变量名。
 * 与叙事地图的变量标签页共享领域逻辑，支持同样的新增、重命名迁移与删除保护。
 */
export function VariablesPanel({ project, commit, notify, requestText, activateFragment, dock, setDock, collapsed = false, setCollapsed, standalone = false, alwaysOnTop = false, toggleAlwaysOnTop, openStandalone }: VariablesPanelProps) {
  const [query, setQuery] = useState('');
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const references = useMemo(() => collectVariableReferences(project), [project]);
  const definitionFor = (name: string) => project.variableDefinitions?.[name] ?? defaultVariableDefinition(project.variables[name]);

  const addVariable = async () => {
    const name = await requestText({ title: '新增变量', message: '变量在 Block 之外统一定义，设置变量、增减变量和条件判断 Block 会引用这里的变量名。', placeholder: '例如：好感度', confirmText: '创建变量' });
    if (!name) return;
    if (name in project.variables) return notify('变量名已经存在', 'error');
    commit((current) => ({ ...current, variables: { ...current.variables, [name]: 0 }, variableDefinitions: { ...current.variableDefinitions, [name]: defaultVariableDefinition(0) } }), `新增变量 ${name}`);
    setExpandedName(name);
  };

  const renameVariable = async (oldName: string) => {
    const definition = definitionFor(oldName);
    if (definition.scope === 'system') return notify('系统变量只读，不能重命名', 'error');
    const newName = await requestText({ title: '重命名变量名', message: `将扫描并迁移“${oldName}”的已知引用。动态拼接的扩展代码字符串需要迁移后手动检查。`, initialValue: oldName, confirmText: '迁移并重命名' });
    if (!newName || newName === oldName) return;
    if (/\s/.test(newName)) return notify('变量名不能包含空格', 'error');
    if (newName in project.variables) return notify('目标变量名已经存在', 'error');
    const referenceCount = references[oldName]?.length ?? 0;
    commit((current) => renameVariableInProject(current, oldName, newName), `重命名变量 ${oldName} → ${newName}`);
    setExpandedName(newName);
    notify(`变量已重命名并迁移 ${referenceCount} 处已知引用；请检查自定义扩展代码`);
  };

  const patchDefinition = (name: string, patch: Partial<VariableDefinition>) => commit((current) => ({ ...current, variableDefinitions: { ...current.variableDefinitions, [name]: { ...(current.variableDefinitions?.[name] ?? defaultVariableDefinition(current.variables[name])), ...patch } } }), `更新变量 ${name}`);

  const updateDefault = (name: string, value: string, type: VariableType) => {
    const parsed = type === 'boolean' ? value === 'true' : type === 'number' ? Number(value) || 0 : value;
    commit((current) => ({ ...current, variables: { ...current.variables, [name]: parsed } }), `修改变量默认值 ${name}`);
  };

  const removeVariable = (name: string) => {
    if (references[name]?.length) return notify(`${name} 仍被 ${references[name].length} 个 Block 引用`, 'error');
    commit((current) => {
      const variables = { ...current.variables };
      const variableDefinitions = { ...current.variableDefinitions };
      delete variables[name];
      delete variableDefinitions[name];
      return { ...current, variables, variableDefinitions };
    }, `删除变量 ${name}`);
    if (expandedName === name) setExpandedName(null);
  };

  const header = <div className="inspector-header"><VariableIcon /><strong>变量</strong><span>{Object.keys(project.variables).length} 个</span><div className="inspector-dock-controls" role="group" aria-label="变量面板停靠位置"><button className={dock === 'preview' ? 'active' : ''} title="停靠在预览下方" onClick={() => setDock('preview')}><PanelRight /></button><button className={dock === 'editor' ? 'active' : ''} title="停靠在编辑器下方" onClick={() => setDock('editor')}><PanelBottom /></button><button className={dock === 'floating' ? 'active' : ''} title="浮动面板" onClick={() => setDock('floating')}><PictureInPicture2 /></button>{standalone ? <button className={alwaysOnTop ? 'active' : ''} title={alwaysOnTop ? '取消置顶' : '置顶独立窗口'} onClick={toggleAlwaysOnTop}>{alwaysOnTop ? <PinOff /> : <Pin />}</button> : <button title="打开独立窗口" onClick={openStandalone}><ExternalLink /></button>}{setCollapsed && !standalone && <button className={collapsed ? 'active' : ''} title={collapsed ? '展开面板' : '收起面板'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronUp /> : <ChevronDown />}</button>}</div></div>;

  if (collapsed) return <section className="inspector variables-panel collapsed">{header}</section>;

  return <section className="inspector variables-panel">{header}<div className="inspector-body variables-body">
    <div className="variables-toolbar full"><div className="asset-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索变量" /></div><button className="icon-button" title="新增变量" onClick={() => void addVariable()}><Plus /></button></div>
    <div className="variable-table full">{Object.entries(project.variables).filter(([name]) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(([name, value]) => {
      const definition = definitionFor(name);
      const refs = references[name] ?? [];
      const readOnly = definition.scope === 'system';
      const expanded = expandedName === name;
      return <article className={`${expanded ? 'active' : ''} ${readOnly ? 'system-variable' : ''}`} key={name}><button className="variable-summary" onClick={() => setExpandedName(expanded ? null : name)}><ChevronRight /><span><strong>{definition.displayName || name}</strong><small>{name} · {refs.length} 处引用</small></span><em>{readOnly ? '系统' : definition.type === 'boolean' ? '布尔' : definition.type === 'number' ? '数值' : '文本'}</em></button>{expanded && <div className="variable-editor"><div className="variable-key-row"><label>变量名<code>{name}</code></label><button className="button ghost" disabled={readOnly} onClick={() => void renameVariable(name)}><Pencil />重命名变量名</button></div><label>显示名<input disabled={readOnly} defaultValue={definition.displayName ?? ''} onBlur={(event) => patchDefinition(name, { displayName: event.target.value.trim() })} /></label><label>用途说明<textarea disabled={readOnly} defaultValue={definition.description ?? ''} onBlur={(event) => patchDefinition(name, { description: event.target.value.trim() })} /></label><div className="variable-editor-row"><label>类型<Select disabled={readOnly} value={definition.type} onChange={(value) => patchDefinition(name, { type: value as VariableType })}><option value="boolean">布尔</option><option value="number">数值</option><option value="string">文本</option></Select></label><label>默认值{definition.type === 'boolean' ? <Select disabled={readOnly} value={String(value)} onChange={(next) => updateDefault(name, next, definition.type)}><option value="false">false</option><option value="true">true</option></Select> : <input disabled={readOnly} defaultValue={String(value)} onBlur={(event) => updateDefault(name, event.target.value, definition.type)} />}</label></div><div className="variable-editor-row"><label>作用域<Select disabled={readOnly} value={definition.scope} onChange={(value) => patchDefinition(name, { scope: value as VariableScope })}><option value="project">项目变量</option><option value="system">系统变量</option></Select></label><label>持久化<Select disabled={readOnly} value={definition.persistence} onChange={(value) => patchDefinition(name, { persistence: value as VariablePersistence })}><option value="slot">存档绑定</option><option value="shared">全局共享</option></Select></label></div><div className="variable-references"><strong>引用位置</strong>{refs.map((ref) => <button key={ref.id} disabled={!ref.fragmentId} onClick={() => ref.fragmentId && activateFragment(ref.fragmentId, ref.blockIndex)}><span>{ref.label}</span>{ref.fragmentId && <ExternalLink />}</button>)}{!refs.length && <small>尚未被 Block 使用</small>}</div><button className="button danger" disabled={Boolean(refs.length) || readOnly} onClick={() => removeVariable(name)}><Trash2 />删除变量</button>{readOnly && <small className="system-variable-note">系统变量由引擎注入，只能查看。</small>}</div>}</article>;
    })}{!Object.keys(project.variables).length && <div className="variables-empty">还没有变量。点击右上角 + 创建，供设置变量、增减变量与条件判断 Block 引用。</div>}</div>
  </div></section>;
}
