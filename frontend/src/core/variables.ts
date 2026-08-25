import type { Project, StoryBlock, VariableDefinition, VariableType } from '../types';

/**
 * 变量领域逻辑：类型推断、默认定义、文本绑定识别与迁移、引用收集、重命名迁移。
 * 叙事地图的变量标签页与剧本编辑器的变量面板共享这些纯函数，保证两边语义一致。
 */

export const inferVariableType = (value: string | number | boolean): VariableType => typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';

export const defaultVariableDefinition = (value: string | number | boolean): VariableDefinition => ({ type: inferVariableType(value), scope: 'project', persistence: 'slot' });

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 判断一段文本是否绑定到变量（${名}、{{名}} 或 $名 形式）。 */
export const hasVariableBinding = (value: string, name: string) => value.includes(`\${${name}}`) || value.includes(`{{${name}}}`) || new RegExp(`\\$${escapeRegExp(name)}(?![\\w\u4e00-\u9fff])`).test(value);

export const migrateVariableBinding = (value: string, oldName: string, newName: string) => value
  .replaceAll(`\${${oldName}}`, `\${${newName}}`)
  .replaceAll(`{{${oldName}}}`, `{{${newName}}}`)
  .replace(new RegExp(`\\$${escapeRegExp(oldName)}(?![\\w\u4e00-\u9fff])`, 'g'), `$${newName}`);

export const migrateVariableBindingsDeep = (value: unknown, oldName: string, newName: string): unknown => {
  if (typeof value === 'string') return migrateVariableBinding(value, oldName, newName);
  if (Array.isArray(value)) return value.map((item) => migrateVariableBindingsDeep(item, oldName, newName));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateVariableBindingsDeep(item, oldName, newName)]));
  return value;
};

export const containsVariableBindingDeep = (value: unknown, name: string): boolean => {
  if (typeof value === 'string') return hasVariableBinding(value, name);
  if (Array.isArray(value)) return value.some((item) => containsVariableBindingDeep(item, name));
  if (value && typeof value === 'object') return Object.values(value).some((item) => containsVariableBindingDeep(item, name));
  return false;
};

export interface VariableReference {
  id: string;
  label: string;
  kind: 'read' | 'write' | 'binding';
  fragmentId?: string;
  blockIndex?: number;
}

const blockVariableKind = (block: StoryBlock): 'read' | 'write' | null => block.type === 'condition' ? 'read' : block.type === 'setVariable' || block.type === 'modifyVariable' ? 'write' : null;

const describeBlockVariable = (block: StoryBlock): string => block.type === 'branch' ? block.title || '选项分支' : block.type === 'condition' ? `${block.variable || '变量'} 条件` : block.type === 'setVariable' ? `写入 ${block.variable || '变量'}` : block.type === 'modifyVariable' ? `增减 ${block.variable || '变量'}` : '变量';

/** 收集每个变量的引用（Block 读写 + 文本/角色/界面绑定），用于展示与删除保护。 */
export function collectVariableReferences(project: Project): Record<string, VariableReference[]> {
  const references: Record<string, VariableReference[]> = {};
  const push = (name: string, reference: VariableReference) => {
    (references[name] ??= []).push(reference);
  };
  Object.entries(project.scripts).forEach(([fragmentId, blocks]) => blocks.forEach((block, blockIndex) => {
    const kind = blockVariableKind(block);
    if (kind && block.variable) push(block.variable, { id: `${block.id}:variable`, label: `${kind === 'read' ? '读取' : '写入'} · ${describeBlockVariable(block)}`, kind, fragmentId, blockIndex });
    if (block.type === 'condition' && block.compareVariable) push(block.compareVariable, { id: `${block.id}:compare-variable`, label: `读取 · 比较变量 · Block ${blockIndex + 1}`, kind: 'read', fragmentId, blockIndex });
    Object.keys(project.variables).forEach((name) => {
      if ([block.text, block.title, block.speaker].some((value) => typeof value === 'string' && hasVariableBinding(value, name))) push(name, { id: `${block.id}:binding:${name}`, label: `文本绑定 · Block ${blockIndex + 1}`, kind: 'binding', fragmentId, blockIndex });
    });
  }));
  project.characters.forEach((character) => {
    Object.keys(project.variables).forEach((name) => {
      if (hasVariableBinding(character.name, name) || character.name === name) push(name, { id: `character:${character.id}`, label: `角色显示名 · ${character.name}`, kind: 'binding' });
    });
  });
  Object.keys(project.variables).forEach((name) => {
    if (containsVariableBindingDeep(project.ui, name)) push(name, { id: 'ui:bindings', label: '可视化界面绑定', kind: 'binding' });
    if (containsVariableBindingDeep(project.translations, name)) push(name, { id: 'translations:bindings', label: '本地化文本绑定', kind: 'binding' });
  });
  return references;
}

/** 重命名变量并迁移所有已知引用（Block 字段、文本绑定、角色名、界面与本地化）。 */
export function renameVariableInProject(project: Project, oldName: string, newName: string): Project {
  const variables = Object.fromEntries(Object.entries(project.variables).map(([name, value]) => [name === oldName ? newName : name, value]));
  const variableDefinitions = Object.fromEntries(Object.entries(project.variableDefinitions ?? {}).map(([name, value]) => [name === oldName ? newName : name, value]));
  const scripts = Object.fromEntries(Object.entries(project.scripts).map(([fragmentId, blocks]) => [fragmentId, blocks.map((block) => {
    const migrated = migrateVariableBindingsDeep(block, oldName, newName) as StoryBlock;
    let next = migrated;
    if ((next.type === 'setVariable' || next.type === 'modifyVariable' || next.type === 'condition') && next.variable === oldName) next = { ...next, variable: newName };
    if (next.type === 'condition' && next.compareVariable === oldName) next = { ...next, compareVariable: newName };
    return next;
  })]));
  const characters = project.characters.map((character) => ({ ...character, name: character.name === oldName ? newName : migrateVariableBinding(character.name, oldName, newName) }));
  return { ...project, variables, variableDefinitions, scripts, characters, ui: migrateVariableBindingsDeep(project.ui, oldName, newName) as Project['ui'], translations: migrateVariableBindingsDeep(project.translations, oldName, newName) as Project['translations'] };
}
