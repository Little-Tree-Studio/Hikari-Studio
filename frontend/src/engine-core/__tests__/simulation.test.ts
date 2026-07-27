import { describe, expect, it } from 'vitest';
import { simulateProjectBranches } from '../simulation';
import { testProject } from './fixtures';

describe('full branch simulation', () => {
  it('covers every branch option and follows calls and returns', () => {
    const project = testProject({
      start: [{ id: 'branch', type: 'branch', options: [{ text: 'A', target: 'route-a' }, { text: 'B', target: 'end' }] }],
      'route-a': [{ id: 'call', type: 'call', target: 'called' }, { id: 'after-call', type: 'narration', text: 'after' }],
      called: [{ id: 'line-called', type: 'narration', text: 'called' }, { id: 'return', type: 'return' }],
      end: [{ id: 'line-end', type: 'narration', text: 'end' }],
    });
    const result = simulateProjectBranches(project);
    expect(result.pathCount).toBe(2);
    expect(result.coverage.branchOptions).toMatchObject({ visited: 2, total: 2, percent: 100 });
    expect(result.summary.error).toBe(0);
    expect(result.paths.some((path) => path.visitedFragments.includes('called'))).toBe(true);
    expect(result.paths.some((path) => path.visitedFragments.includes('end'))).toBe(true);
  });

  it('generates condition boundary scenarios', () => {
    const project = testProject({
      start: [{ id: 'condition', type: 'condition', variable: 'score', operator: 'gte', compareValue: 5, trueTarget: 'high', falseTarget: 'low' }],
      high: [{ id: 'high-line', type: 'narration', text: 'high' }],
      low: [{ id: 'low-line', type: 'narration', text: 'low' }],
    }, { score: 0 });
    const result = simulateProjectBranches(project);
    expect(result.scenarioCount).toBeGreaterThanOrEqual(3);
    expect(result.paths.flatMap((path) => path.visitedFragments)).toEqual(expect.arrayContaining(['high', 'low']));
  });

  it('reports loops and path limits without claiming success', () => {
    const project = testProject({ start: [{ id: 'loop-line', type: 'narration', text: 'again' }, { id: 'loop-jump', type: 'jump', target: 'start' }] });
    const result = simulateProjectBranches(project, { maxStepsPerPath: 20 });
    expect(result.summary.loop + result.summary.error + result.summary.truncated).toBeGreaterThan(0);
    expect(result.summary.completed).toBe(0);
  });

  it('marks a branch explosion as truncated', () => {
    const project = testProject({
      start: [{ id: 'many', type: 'branch', options: Array.from({ length: 8 }, (_, index) => ({ text: String(index), target: 'end' })) }],
      end: [{ id: 'end', type: 'narration', text: 'end' }],
    });
    const result = simulateProjectBranches(project, { maxPaths: 3 });
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe('path-limit');
    expect(result.pathCount).toBe(3);
  });
});
