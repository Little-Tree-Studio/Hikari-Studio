import { describe, expect, it } from 'vitest';
import type { AgentOperation } from '../../types';
import { testProject } from '../../engine-core/__tests__/fixtures';
import { buildAgentPatchSemanticRecord, restoreAgentPatchCategory } from '../agentPatchHistory';

const beforeProject = () => testProject(
  { opening: [{ id: 'intro', type: 'narration', text: '旧文本' }, { id: 'choice', type: 'branch', title: '旧选择', options: [{ text: '继续', target: 'opening' }] }] },
  { affection: 0 },
  {
    characters: [{ id: 'hero', name: '林澄', color: '#111111', expressions: ['默认'], portraits: {} }],
    assets: [{ id: 'lake', kind: 'scene', name: '湖畔', path: 'lake.png' }],
    variableDefinitions: { affection: { type: 'number', scope: 'project', persistence: 'slot' } },
  },
);

const operations: AgentOperation[] = [
  { type: 'add_blocks', fragmentId: 'opening', blocks: [{ type: 'narration', text: '新增文本' }] },
  { type: 'update_branch', fragmentId: 'opening', blockId: 'choice', title: '新选择', options: [{ text: '留下', target: 'opening' }] },
  { type: 'upsert_character', characterId: 'hero', name: '林澄', color: '#abcdef' },
  { type: 'update_asset', assetId: 'lake', name: '夜色湖畔', forceBundle: true },
  { type: 'upsert_variable', name: 'affection', defaultValue: 10, valueType: 'number', displayName: '好感度', persistence: 'shared' },
  { type: 'update_project', name: 'Agent 项目' },
];

function afterProject() {
  const project = beforeProject();
  project.meta.name = 'Agent 项目';
  project.scripts.opening.push({ id: 'agent-block', type: 'narration', text: '新增文本' });
  project.scripts.opening[1] = { id: 'choice', type: 'branch', title: '新选择', options: [{ text: '留下', target: 'opening' }] };
  project.characters[0].color = '#abcdef';
  project.assets[0] = { ...project.assets[0], name: '夜色湖畔', forceBundle: true };
  project.variables.affection = 10;
  project.variableDefinitions!.affection = { type: 'number', scope: 'project', persistence: 'shared', displayName: '好感度' };
  return project;
}

describe('Agent Patch semantic history', () => {
  it('groups operations into readable semantic categories', () => {
    const record = buildAgentPatchSemanticRecord(operations);
    expect(record.categories.map((category) => category.id)).toEqual(['blocks', 'characters', 'assets', 'variables', 'project']);
    expect(record.categories[0].count).toBe(2);
    expect(record.categories[0].items).toContain('opening · narration：新增文本');
    expect(record.categories[3].items).toContain('好感度 (affection)');
  });

  it('restores one category without reverting other Agent changes', () => {
    const before = beforeProject();
    const after = afterProject();
    const record = buildAgentPatchSemanticRecord(operations);
    const charactersUndone = restoreAgentPatchCategory(after, before, after, 'characters', record);
    expect(charactersUndone.characters[0].color).toBe('#111111');
    expect(charactersUndone.assets[0].name).toBe('夜色湖畔');
    expect(charactersUndone.variables.affection).toBe(10);
    expect(charactersUndone.scripts.opening.some((block) => block.id === 'agent-block')).toBe(true);

    const variablesUndone = restoreAgentPatchCategory(after, before, after, 'variables', record);
    expect(variablesUndone.variables.affection).toBe(0);
    expect(variablesUndone.variableDefinitions!.affection.persistence).toBe('slot');
    expect(variablesUndone.characters[0].color).toBe('#abcdef');
  });

  it('removes Agent blocks and restores branches without replacing unrelated project data', () => {
    const before = beforeProject();
    const after = afterProject();
    const current = structuredClone(after);
    current.assets[0].name = '用户之后修改的素材名';
    const restored = restoreAgentPatchCategory(current, before, after, 'blocks', buildAgentPatchSemanticRecord(operations));
    expect(restored.scripts.opening.some((block) => block.id === 'agent-block')).toBe(false);
    expect(restored.scripts.opening.find((block) => block.id === 'choice')?.title).toBe('旧选择');
    expect(restored.assets[0].name).toBe('用户之后修改的素材名');
  });
});
