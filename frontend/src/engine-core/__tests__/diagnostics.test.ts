import { describe, expect, it } from 'vitest';
import { diagnoseProject, diagnosticSummary } from '../diagnostics';
import { testProject } from './fixtures';

const codes = (project: ReturnType<typeof testProject>) => diagnoseProject(project).map((item) => item.code);

describe('project diagnostics', () => {
  it('reports invalid targets, empty branches, and undeclared variables', () => {
    const project = testProject({
      start: [
        { id: 'empty', type: 'branch', title: 'Empty', options: [] },
        { id: 'invalid', type: 'jump', target: 'missing' },
        { id: 'condition', type: 'condition', variable: 'unknown', operator: 'eq', compareValue: true, trueTarget: 'missing' },
      ],
    });

    expect(codes(project)).toEqual(expect.arrayContaining(['EMPTY_BRANCH', 'INVALID_TARGET', 'UNDECLARED_VARIABLE']));
  });

  it('reports type conflicts, orphan returns, self loops, and unreachable fragments', () => {
    const project = testProject({
      start: [{ id: 'jump-end', type: 'jump', target: 'end' }],
      unreachable: [{ id: 'set-wrong-type', type: 'setVariable', variable: 'score', value: 'high' }],
      end: [{ id: 'end-line', type: 'narration', text: 'end' }],
      loop: [{ id: 'self-loop', type: 'jump', target: 'loop' }],
      orphan: [{ id: 'orphan-return', type: 'return' }],
    }, { score: 0 });

    const result = codes(project);
    expect(result).toEqual(expect.arrayContaining(['VARIABLE_TYPE_CONFLICT', 'ORPHAN_RETURN', 'SELF_LOOP', 'UNREACHABLE_FRAGMENT']));
  });

  it('reports character portrait and asset health problems', () => {
    const project = testProject({
      start: [{ id: 'scene', type: 'scene', assetId: 'missing-scene', title: 'Missing' }],
    }, {}, {
      characters: [{
        id: 'hero', name: 'Hero', color: '#16706a', expressions: ['default', 'happy', 'sad'],
        portraits: { default: 'hero-default', happy: 'hero-default' },
      }],
      assets: [{ id: 'hero-default', kind: 'character', name: 'Hero', path: 'hero.png' }],
    });

    const result = codes(project);
    expect(result).toEqual(expect.arrayContaining(['DUPLICATE_CHARACTER_PORTRAIT', 'MISSING_CHARACTER_PORTRAIT', 'MISSING_ASSET']));
    expect(diagnosticSummary(project).errors).toBeGreaterThanOrEqual(3);
  });
});
