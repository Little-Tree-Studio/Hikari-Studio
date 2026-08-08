import { describe, expect, it } from 'vitest';
import {
  createMeasuredVirtualLayout,
  fixedVirtualRange,
  measuredVirtualRange,
  scrollOffsetForIndex,
  virtualIndexAtOffset,
  virtualIndexes,
} from '../virtualization';

describe('list virtualization', () => {
  it('computes a fixed row range with bounded overscan', () => {
    expect(fixedVirtualRange(100, 35, 350, 140, 2)).toEqual({ start: 8, end: 16 });
    expect(fixedVirtualRange(0, 35, 0, 500)).toEqual({ start: 0, end: 0 });
  });

  it('recalculates measured offsets while retaining sizes by stable key', () => {
    const measured = new Map([['b', 80]]);
    const first = createMeasuredVirtualLayout(['a', 'b', 'c'], measured, () => 50);
    expect(first.offsets).toEqual([0, 50, 130, 180]);

    const reordered = createMeasuredVirtualLayout(['c', 'b', 'd'], measured, () => 50);
    expect(reordered.offsets).toEqual([0, 50, 130, 180]);
    expect(reordered.indexByKey.get('b')).toBe(1);
    expect(reordered.indexByKey.has('a')).toBe(false);
  });

  it('finds dynamic rows and scrolls selected rows into the viewport', () => {
    const layout = createMeasuredVirtualLayout(['a', 'b', 'c', 'd'], new Map([['b', 100], ['c', 25]]), () => 50);
    expect(virtualIndexAtOffset(layout, 49)).toBe(0);
    expect(virtualIndexAtOffset(layout, 50)).toBe(1);
    expect(virtualIndexAtOffset(layout, 151)).toBe(2);
    expect(scrollOffsetForIndex(layout, 3, 100, 0)).toBe(125);
    expect(scrollOffsetForIndex(layout, 1, 100, 60)).toBe(50);
  });

  it('keeps selected and dragged rows mounted outside the visible range', () => {
    const layout = createMeasuredVirtualLayout(Array.from({ length: 100 }, (_, index) => `block-${index}`), new Map(), () => 40);
    const range = measuredVirtualRange(layout, 800, 200, 80);
    const indexes = virtualIndexes(range, [2, 90], 100);
    expect(indexes).toContain(2);
    expect(indexes).toContain(90);
    expect(indexes).toContain(20);
    expect(indexes.length).toBeLessThan(20);
  });
});
