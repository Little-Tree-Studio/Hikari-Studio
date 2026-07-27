import type { Project } from '../types';

export interface ProjectDiffCategory {
  id: string;
  label: string;
  added: number;
  removed: number;
  changed: number;
  items: string[];
}

export interface ProjectDiff {
  categories: ProjectDiffCategory[];
  total: number;
}

interface NamedValue { label: string; value: unknown }

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function compareMaps(id: string, label: string, before: Map<string, NamedValue>, after: Map<string, NamedValue>): ProjectDiffCategory | null {
  let added = 0;
  let removed = 0;
  let changed = 0;
  const items: string[] = [];
  for (const [key, item] of after) {
    const previous = before.get(key);
    if (!previous) {
      added += 1;
      items.push(`新增：${item.label}`);
    } else if (!same(previous.value, item.value)) {
      changed += 1;
      items.push(`修改：${item.label}`);
    }
  }
  for (const [key, item] of before) {
    if (!after.has(key)) {
      removed += 1;
      items.push(`删除：${item.label}`);
    }
  }
  return added || removed || changed ? { id, label, added, removed, changed, items } : null;
}

function entityMap<T extends { id: string; name?: string }>(items: T[], fallback: string): Map<string, NamedValue> {
  return new Map(items.map((item) => [item.id, { label: item.name || `${fallback} ${item.id}`, value: item }]));
}

function blockMap(project: Project): Map<string, NamedValue> {
  const names = new Map(project.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => [fragment.id, fragment.name] as const)));
  return new Map(Object.entries(project.scripts).flatMap(([fragmentId, blocks]) => blocks.map((block, index) => [block.id || `${fragmentId}:${index}`, {
    label: `${names.get(fragmentId) ?? fragmentId} · ${block.type}`,
    value: { fragmentId, block },
  }] as const)));
}

function variableMap(project: Project): Map<string, NamedValue> {
  const names = new Set([...Object.keys(project.variables), ...Object.keys(project.variableDefinitions ?? {})]);
  return new Map([...names].map((name) => [name, {
    label: project.variableDefinitions?.[name]?.displayName ? `${project.variableDefinitions[name].displayName} (${name})` : name,
    value: { defaultValue: project.variables[name], definition: project.variableDefinitions?.[name] },
  }]));
}

function structureMap(project: Project): Map<string, NamedValue> {
  const entries: Array<[string, NamedValue]> = [];
  for (const chapter of project.chapters) {
    const { fragments, ...chapterValue } = chapter;
    entries.push([`chapter:${chapter.id}`, { label: `章节 · ${chapter.name}`, value: chapterValue }]);
    for (const fragment of chapter.fragments) entries.push([`fragment:${fragment.id}`, { label: `片段 · ${fragment.name}`, value: { ...fragment, chapterId: chapter.id } }]);
  }
  return new Map(entries);
}

function projectSettings(project: Project) {
  const { updatedAt, ...meta } = project.meta;
  return { meta, settings: project.settings, locale: project.locale, ui: project.ui, activeFragmentId: project.activeFragmentId };
}

export function diffProjects(before: Project, after: Project): ProjectDiff {
  const categories = [
    compareMaps('blocks', '剧本 Block', blockMap(before), blockMap(after)),
    compareMaps('characters', '角色配置', entityMap(before.characters, '角色'), entityMap(after.characters, '角色')),
    compareMaps('scenes', '场景配置', entityMap(before.scenes ?? [], '场景'), entityMap(after.scenes ?? [], '场景')),
    compareMaps('assets', '素材引用', entityMap(before.assets, '素材'), entityMap(after.assets, '素材')),
    compareMaps('variables', '变量', variableMap(before), variableMap(after)),
    compareMaps('structure', '章节结构', structureMap(before), structureMap(after)),
    compareMaps('project', '项目与设置', new Map([['project', { label: '项目配置', value: projectSettings(before) }]]), new Map([['project', { label: '项目配置', value: projectSettings(after) }]])),
  ].filter((item): item is ProjectDiffCategory => item !== null);
  return { categories, total: categories.reduce((sum, item) => sum + item.added + item.removed + item.changed, 0) };
}
