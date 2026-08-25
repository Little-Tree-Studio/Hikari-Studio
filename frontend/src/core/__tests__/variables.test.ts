import { describe, expect, it } from 'vitest';
import type { Project } from '../../types';
import { collectVariableReferences, defaultVariableDefinition, inferVariableType, renameVariableInProject } from '../variables';

const project: Project = {
  version: 3,
  meta: { id: 'vars', name: 'Vars', author: '', resolution: [1280, 720], updatedAt: '' },
  characters: [{ id: 'hero', name: '好感度', color: '#d65b4a', expressions: ['默认'] }],
  chapters: [{ id: 'chapter', name: 'Chapter', entry: true, fragments: [{ id: 'start', name: 'Start' }, { id: 'ending', name: 'Ending' }] }],
  activeFragmentId: 'start',
  scripts: {
    start: [
      { id: 'set', type: 'setVariable', variable: '好感度', value: 1 },
      { id: 'modify', type: 'modifyVariable', variable: '好感度', operation: 'add', operand: 2 },
      { id: 'condition', type: 'condition', variable: '理智', compareVariable: '好感度', operator: 'lt', trueTarget: 'ending' },
      { id: 'line', type: 'dialogue', speaker: 'hero', text: '你的好感度是 ${好感度} 分' },
    ],
    ending: [],
  },
  assets: [],
  variables: { 好感度: 0, 理智: 10 },
  settings: { textSpeed: 35, autoSave: true, skipRead: true },
};

describe('variables domain', () => {
  it('推断变量类型并生成默认定义', () => {
    expect(inferVariableType(true)).toBe('boolean');
    expect(inferVariableType(1.5)).toBe('number');
    expect(inferVariableType('好感度')).toBe('string');
    expect(defaultVariableDefinition(3)).toEqual({ type: 'number', scope: 'project', persistence: 'slot' });
  });

  it('收集变量的写入、读取与比较引用', () => {
    const references = collectVariableReferences(project);
    expect(references['好感度'].map((ref) => ref.id)).toEqual(['set:variable', 'modify:variable', 'condition:compare-variable', 'line:binding:好感度', 'character:hero']);
    expect(references['好感度'].map((ref) => ref.kind)).toEqual(['write', 'write', 'read', 'binding', 'binding']);
    expect(references['理智'].map((ref) => ref.kind)).toEqual(['read']);
    expect(references['理智'][0]).toMatchObject({ fragmentId: 'start', blockIndex: 2 });
  });

  it('重命名变量会迁移 Block 字段、比较变量、文本绑定与角色名', () => {
    const renamed = renameVariableInProject(project, '好感度', '亲密度');
    expect(renamed.variables).toEqual({ 亲密度: 0, 理智: 10 });
    expect(renamed.scripts.start[0]).toMatchObject({ variable: '亲密度' });
    expect(renamed.scripts.start[1]).toMatchObject({ variable: '亲密度' });
    expect(renamed.scripts.start[2]).toMatchObject({ compareVariable: '亲密度' });
    expect(renamed.scripts.start[3]).toMatchObject({ text: '你的好感度是 ${亲密度} 分' });
    expect(renamed.characters[0].name).toBe('亲密度');
  });
});
