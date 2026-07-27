import { describe, expect, it } from 'vitest';
import { testProject } from '../../engine-core/__tests__/fixtures';
import { diffProjects } from '../projectDiff';

describe('project snapshot diff', () => {
  it('groups additions, removals and changes into semantic categories', () => {
    const before = testProject({ opening: [{ id: 'old', type: 'narration', text: '旧文本' }] }, { affection: 0 }, {
      characters: [{ id: 'hero', name: '林澄', color: '#111111', expressions: ['默认'], portraits: {} }],
      assets: [{ id: 'lake', kind: 'scene', name: '湖畔', path: 'lake.png' }],
      variableDefinitions: { affection: { type: 'number', scope: 'project', persistence: 'slot', displayName: '好感度' } },
    });
    const after = structuredClone(before);
    after.scripts.opening = [{ id: 'old', type: 'narration', text: '新文本' }, { id: 'new', type: 'dialogue', speaker: '林澄', text: '你好' }];
    after.characters[0].color = '#abcdef';
    after.assets = [];
    after.variables.affection = 10;

    const diff = diffProjects(before, after);
    expect(diff.total).toBe(5);
    expect(diff.categories.find((item) => item.id === 'blocks')).toMatchObject({ added: 1, changed: 1 });
    expect(diff.categories.find((item) => item.id === 'characters')?.changed).toBe(1);
    expect(diff.categories.find((item) => item.id === 'assets')?.removed).toBe(1);
    expect(diff.categories.find((item) => item.id === 'variables')?.changed).toBe(1);
  });

  it('returns an empty comparison for identical snapshots', () => {
    const project = testProject({ opening: [] });
    const savedLater = structuredClone(project);
    savedLater.meta.updatedAt = '2026-07-27T12:00:00Z';
    expect(diffProjects(project, savedLater)).toEqual({ categories: [], total: 0 });
  });
});
