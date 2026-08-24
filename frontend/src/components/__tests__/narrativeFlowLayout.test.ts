import { describe, expect, it } from 'vitest';
import { buildFlowLayout, buildGraph, flowShapeOf } from '../NarrativeMap';
import type { Project } from '../../types';

const makeProject = (): Project => {
  const block = (id: string, extra: Record<string, unknown>) => ({ id, version: 1, ...extra });
  return {
    meta: { id: 'p1', name: '测试项目', createdAt: '', updatedAt: '', version: 1 },
    chapters: [
      { id: 'c1', name: '第一章', entry: true, fragments: [{ id: 'opening', name: '片头' }, { id: 'lake', name: '湖畔相遇' }, { id: 'ending', name: '尾声' }] },
    ],
    scripts: {
      opening: [],
      lake: [block('b1', { type: 'branch', title: '如何回应？', options: [{ text: '相信她', target: 'ending' }, { text: '转移话题', target: 'opening' }] })],
      ending: [],
    },
    variables: {},
  } as unknown as Project;
};

describe('narrative map flow layout', () => {
  it('spreads branch targets directly below the decision node and centers the parent', () => {
    const graph = buildGraph(makeProject());
    const positions = buildFlowLayout(graph, 'opening');

    const branch = graph.nodes.find((node) => node.kind === 'branch')!;
    const branchPoint = positions[branch.id];
    const targets = graph.edges.filter((edge) => edge.kind === 'branch').map((edge) => ({ id: edge.target, point: positions[edge.target] }));
    const belowTargets = targets.filter((target) => target.id !== 'fragment:opening');

    expect(belowTargets.length).toBeGreaterThan(0);
    for (const target of belowTargets) expect(target.point.y).toBeGreaterThan(branchPoint.y);
    const siblingXs = belowTargets.map((target) => target.point.x).sort((a, b) => a - b);
    for (let index = 1; index < siblingXs.length; index += 1) expect(siblingXs[index] - siblingXs[index - 1]).toBeGreaterThanOrEqual(210);

    const parent = positions['fragment:lake'];
    const parentCenter = parent.x + 95;
    const childCenters = belowTargets.map((target) => target.point.x + 95);
    expect(Math.min(...childCenters)).toBeLessThanOrEqual(parentCenter + 1);
    expect(Math.max(...childCenters)).toBeGreaterThanOrEqual(parentCenter - 1);

    expect(branchPoint.y).toBeGreaterThan(parent.y);
  });

  it('uses standard flowchart shapes and keeps the entry fragment as start', () => {
    const graph = buildGraph(makeProject());
    const entry = graph.nodes.find((node) => node.fragmentId === 'opening')!;
    const branch = graph.nodes.find((node) => node.kind === 'branch')!;
    const ending = graph.nodes.find((node) => node.fragmentId === 'ending')!;
    expect(flowShapeOf(entry, 'opening')).toBe('start');
    expect(flowShapeOf(branch, 'opening')).toBe('decision');
    expect(flowShapeOf(ending, 'opening')).toBe('process');
  });

  it('places every reachable node exactly once without level overlap', () => {
    const graph = buildGraph(makeProject());
    const positions = buildFlowLayout(graph, 'opening');
    for (const node of graph.nodes) {
      if (node.kind === 'chapter') continue;
      expect(positions[node.id], node.id).toBeDefined();
    }
    const byLevel = new Map<number, number[]>();
    Object.entries(positions).forEach(([id, point]) => {
      if (id.startsWith('chapter:')) return;
      const level = Math.round((point.y - 64) / 158);
      byLevel.set(level, [...(byLevel.get(level) ?? []), point.x]);
    });
    byLevel.forEach((xs) => {
      const sorted = [...xs].sort((a, b) => a - b);
      for (let index = 1; index < sorted.length; index += 1) expect(sorted[index] - sorted[index - 1]).toBeGreaterThanOrEqual(150);
    });
  });
});
