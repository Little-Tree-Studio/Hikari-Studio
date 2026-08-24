import type { AgentOperation, Project, StoryBlock } from '../types';
import type { CommandCategory } from '../hooks/useCommandHistory';

export type AgentPatchCategoryId = 'blocks' | 'characters' | 'scenes' | 'assets' | 'variables' | 'narrative' | 'memory' | 'project';

export interface AgentPatchSemanticRecord {
  categories: CommandCategory[];
  operations: AgentOperation[];
}

const categoryMeta: Record<AgentPatchCategoryId, { label: string }> = {
  blocks: { label: '剧本与 Block' },
  characters: { label: '角色配置' },
  scenes: { label: '场景配置' },
  assets: { label: '素材引用' },
  variables: { label: '变量' },
  narrative: { label: '叙事地图' },
  memory: { label: '制作记忆' },
  project: { label: '项目信息' },
};

function operationCategory(operation: AgentOperation): AgentPatchCategoryId {
  if (operation.type === 'upsert_character') return 'characters';
  if (operation.type === 'upsert_scene') return 'scenes';
  if (operation.type === 'update_asset') return 'assets';
  if (operation.type === 'upsert_variable') return 'variables';
  if (operation.type === 'update_narrative_map') return 'narrative';
  if (operation.type === 'update_project') return 'project';
  if (operation.type === 'update_production_memory') return 'memory';
  return 'blocks';
}

function operationSummaries(operation: AgentOperation): string[] {
  if (operation.type === 'add_blocks') return operation.blocks.map((block) => {
    const content = block.text || block.title || block.speaker || block.type;
    return `${operation.fragmentId} · ${block.type}：${content}`;
  });
  if (operation.type === 'insert_blocks') return operation.blocks.map((block) => `${operation.fragmentId} · 插入 ${block.type}：${block.text || block.title || block.speaker || block.type}`);
  if (operation.type === 'update_blocks') return operation.updates.map((update) => `${operation.fragmentId} · 更新 ${update.blockId}`);
  if (operation.type === 'move_blocks') return operation.blockIds.map((blockId) => `${operation.fragmentId} · 移动 ${blockId}`);
  if (operation.type === 'create_fragment') return [`${operation.name}：创建 Fragment（${operation.blocks.length} 个 Block）`];
  if (operation.type === 'create_chapter') return [`${operation.name}：创建章节${operation.fragmentName ? `（含初始片段「${operation.fragmentName}」）` : ''}`];
  if (operation.type === 'update_branch') return [`${operation.fragmentId}：修改分支“${operation.title}”`];
  if (operation.type === 'upsert_character') return [operation.name];
  if (operation.type === 'upsert_scene') return [`${operation.name}：配置场景（${operation.layers?.length ?? 0} 个图层）`];
  if (operation.type === 'update_asset') return [operation.name ?? operation.assetId];
  if (operation.type === 'upsert_variable') return [operation.displayName ? `${operation.displayName} (${operation.name})` : operation.name];
  if (operation.type === 'update_narrative_map') {
    const parts = [`${operation.positions ? Object.keys(operation.positions).length : 0} 个节点位置`, `${operation.connections?.length ?? 0} 条连线`, operation.viewMode ? `视图模式 ${operation.viewMode}` : ''].filter(Boolean);
    return [`叙事地图：${parts.join(' · ') || '更新布局'}`];
  }
  if (operation.type === 'update_production_memory') return [`世界观与 ${operation.memory.characterRules.length + operation.memory.styleRules.length + operation.memory.facts.length + operation.memory.restrictions.length} 条制作规则`];
  return [[operation.name, operation.author].filter(Boolean).join(' / ') || '项目基本信息'];
}

export function buildAgentPatchSemanticRecord(operations: AgentOperation[]): AgentPatchSemanticRecord {
  const groups = new Map<AgentPatchCategoryId, string[]>();
  for (const operation of operations) {
    const category = operationCategory(operation);
    groups.set(category, [...(groups.get(category) ?? []), ...operationSummaries(operation)]);
  }
  const order: AgentPatchCategoryId[] = ['blocks', 'characters', 'scenes', 'assets', 'variables', 'narrative', 'memory', 'project'];
  return {
    operations: structuredClone(operations),
    categories: order.filter((id) => groups.has(id)).map((id) => ({ id, label: categoryMeta[id].label, count: groups.get(id)!.length, items: groups.get(id)! })),
  };
}

const blockById = (blocks: StoryBlock[], id: string) => blocks.find((block) => block.id === id);

function restoreBlocks(current: Project, before: Project, after: Project, operations: AgentOperation[]): Project {
  const next = structuredClone(current);
  const beforeFragmentIds = new Set(before.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => fragment.id)));
  const afterFragments = after.chapters.flatMap((chapter) => chapter.fragments);
  const createdIds = new Set(afterFragments.filter((fragment) => !beforeFragmentIds.has(fragment.id)).map((fragment) => fragment.id));
  for (const operation of operations) {
    if (operation.type === 'add_blocks' || operation.type === 'insert_blocks') {
      const beforeIds = new Set((before.scripts[operation.fragmentId] ?? []).map((block) => block.id));
      const addedIds = new Set((after.scripts[operation.fragmentId] ?? []).filter((block) => !beforeIds.has(block.id)).map((block) => block.id));
      next.scripts[operation.fragmentId] = (next.scripts[operation.fragmentId] ?? []).filter((block) => !addedIds.has(block.id));
    } else if (operation.type === 'update_branch') {
      const original = blockById(before.scripts[operation.fragmentId] ?? [], operation.blockId);
      if (original) next.scripts[operation.fragmentId] = (next.scripts[operation.fragmentId] ?? []).map((block) => block.id === operation.blockId ? structuredClone(original) : block);
    } else if (operation.type === 'update_blocks') {
      const originals = new Map((before.scripts[operation.fragmentId] ?? []).map((block) => [block.id, block]));
      const ids = new Set(operation.updates.map((update) => update.blockId));
      next.scripts[operation.fragmentId] = (next.scripts[operation.fragmentId] ?? []).map((block) => ids.has(block.id) && originals.has(block.id) ? structuredClone(originals.get(block.id)!) : block);
    } else if (operation.type === 'move_blocks') {
      const current = next.scripts[operation.fragmentId] ?? [];
      const order = new Map((before.scripts[operation.fragmentId] ?? []).map((block, index) => [block.id, index]));
      next.scripts[operation.fragmentId] = [...current].sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
    }
  }
  if (operations.some((operation) => operation.type === 'create_fragment' || operation.type === 'create_chapter')) {
    const beforeChapterIds = new Set(before.chapters.map((chapter) => chapter.id));
    next.chapters = next.chapters.filter((chapter) => beforeChapterIds.has(chapter.id));
    next.chapters = next.chapters.map((chapter) => ({ ...chapter, fragments: chapter.fragments.filter((fragment) => !createdIds.has(fragment.id)) }));
    for (const fragmentId of createdIds) delete next.scripts[fragmentId];
    if (createdIds.has(next.activeFragmentId)) next.activeFragmentId = before.activeFragmentId;
  }
  return next;
}

function restoreScenes(current: Project, before: Project, after: Project): Project {
  const next = structuredClone(current);
  const beforeById = new Map((before.scenes ?? []).map((scene) => [scene.id, scene]));
  const afterById = new Map((after.scenes ?? []).map((scene) => [scene.id, scene]));
  const changedIds = new Set([...afterById.keys()].filter((id) => !beforeById.has(id) || JSON.stringify(beforeById.get(id)) !== JSON.stringify(afterById.get(id))));
  next.scenes = (next.scenes ?? []).filter((scene) => !changedIds.has(scene.id) || beforeById.has(scene.id)).map((scene) => changedIds.has(scene.id) && beforeById.has(scene.id) ? structuredClone(beforeById.get(scene.id)!) : scene);
  return next;
}

function restoreNarrativeMap(current: Project, before: Project, operations: AgentOperation[]): Project {
  const next = structuredClone(current);
  next.settings = { ...next.settings, narrativeMap: structuredClone(before.settings.narrativeMap) };
  for (const operation of operations) {
    if (operation.type !== 'update_narrative_map') continue;
    for (const connection of operation.connections ?? []) {
      const beforeIds = new Set((before.scripts[connection.from] ?? []).map((block) => block.id));
      next.scripts[connection.from] = (next.scripts[connection.from] ?? []).filter((block) => beforeIds.has(block.id) || !(block.type === connection.kind && block.target === connection.to));
    }
  }
  return next;
}

function restoreCharacters(current: Project, before: Project, after: Project): Project {
  const next = structuredClone(current);
  const beforeById = new Map(before.characters.map((character) => [character.id, character]));
  const afterById = new Map(after.characters.map((character) => [character.id, character]));
  const changedIds = new Set([...afterById.keys()].filter((id) => !beforeById.has(id) || JSON.stringify(beforeById.get(id)) !== JSON.stringify(afterById.get(id))));
  next.characters = next.characters.filter((character) => !changedIds.has(character.id) || beforeById.has(character.id)).map((character) => changedIds.has(character.id) && beforeById.has(character.id) ? structuredClone(beforeById.get(character.id)!) : character);
  return next;
}

function restoreAssets(current: Project, before: Project, operations: AgentOperation[]): Project {
  const next = structuredClone(current);
  const beforeById = new Map(before.assets.map((asset) => [asset.id, asset]));
  const ids = new Set(operations.filter((operation) => operation.type === 'update_asset').map((operation) => operation.assetId));
  next.assets = next.assets.map((asset) => ids.has(asset.id) && beforeById.has(asset.id) ? structuredClone(beforeById.get(asset.id)!) : asset);
  return next;
}

function restoreVariables(current: Project, before: Project, operations: AgentOperation[]): Project {
  const next = structuredClone(current);
  for (const operation of operations) {
    if (operation.type !== 'upsert_variable') continue;
    if (Object.hasOwn(before.variables, operation.name)) next.variables[operation.name] = structuredClone(before.variables[operation.name]);
    else delete next.variables[operation.name];
    next.variableDefinitions = { ...(next.variableDefinitions ?? {}) };
    if (Object.hasOwn(before.variableDefinitions ?? {}, operation.name)) next.variableDefinitions[operation.name] = structuredClone(before.variableDefinitions![operation.name]);
    else delete next.variableDefinitions[operation.name];
  }
  return next;
}

function restoreProjectMeta(current: Project, before: Project, operations: AgentOperation[]): Project {
  const next = structuredClone(current);
  for (const operation of operations) {
    if (operation.type !== 'update_project') continue;
    if (operation.name !== undefined) next.meta.name = before.meta.name;
    if (operation.author !== undefined) next.meta.author = before.meta.author;
  }
  return next;
}

export function restoreAgentPatchCategory(current: Project, before: Project, after: Project, categoryId: string, record: AgentPatchSemanticRecord): Project {
  const operations = record.operations.filter((operation) => operationCategory(operation) === categoryId);
  if (categoryId === 'blocks') return restoreBlocks(current, before, after, operations);
  if (categoryId === 'characters') return restoreCharacters(current, before, after);
  if (categoryId === 'scenes') return restoreScenes(current, before, after);
  if (categoryId === 'assets') return restoreAssets(current, before, operations);
  if (categoryId === 'variables') return restoreVariables(current, before, operations);
  if (categoryId === 'narrative') return restoreNarrativeMap(current, before, operations);
  if (categoryId === 'memory') return { ...structuredClone(current), productionMemory: structuredClone(before.productionMemory) };
  if (categoryId === 'project') return restoreProjectMeta(current, before, operations);
  return current;
}
