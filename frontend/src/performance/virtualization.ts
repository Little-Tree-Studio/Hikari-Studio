export interface VirtualRange {
  start: number;
  end: number;
}

export interface MeasuredVirtualLayout {
  keys: readonly string[];
  offsets: readonly number[];
  sizes: readonly number[];
  totalSize: number;
  indexByKey: ReadonlyMap<string, number>;
}

const boundedCount = (value: number) => Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
const boundedSize = (value: number, fallback = 1) => Number.isFinite(value) && value > 0 ? value : fallback;

export function fixedVirtualRange(
  itemCount: number,
  itemSize: number,
  scrollTop: number,
  viewportSize: number,
  overscanItems = 6,
): VirtualRange {
  const count = boundedCount(itemCount);
  if (!count) return { start: 0, end: 0 };
  const size = boundedSize(itemSize);
  const viewport = Math.max(0, viewportSize);
  const overscan = boundedCount(overscanItems);
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / size) - overscan);
  const visibleEnd = Math.ceil((Math.max(0, scrollTop) + viewport) / size);
  return { start, end: Math.min(count, Math.max(start + 1, visibleEnd + overscan)) };
}

export function createMeasuredVirtualLayout(
  keys: readonly string[],
  measuredSizes: ReadonlyMap<string, number>,
  estimateSize: (index: number, key: string) => number,
): MeasuredVirtualLayout {
  const offsets = new Array<number>(keys.length + 1);
  const sizes = new Array<number>(keys.length);
  const indexByKey = new Map<string, number>();
  offsets[0] = 0;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const size = boundedSize(measuredSizes.get(key) ?? estimateSize(index, key));
    sizes[index] = size;
    offsets[index + 1] = offsets[index] + size;
    indexByKey.set(key, index);
  }
  return { keys, offsets, sizes, totalSize: offsets[keys.length] ?? 0, indexByKey };
}

export function virtualIndexAtOffset(layout: MeasuredVirtualLayout, offset: number): number {
  if (!layout.keys.length) return -1;
  const target = Math.max(0, Math.min(layout.totalSize - 0.001, Number.isFinite(offset) ? offset : 0));
  let low = 0;
  let high = layout.keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (layout.offsets[middle + 1] <= target) low = middle + 1;
    else high = middle;
  }
  return Math.min(layout.keys.length - 1, low);
}

export function measuredVirtualRange(
  layout: MeasuredVirtualLayout,
  scrollTop: number,
  viewportSize: number,
  overscanPx: number,
): VirtualRange {
  if (!layout.keys.length) return { start: 0, end: 0 };
  const startOffset = Math.max(0, scrollTop - Math.max(0, overscanPx));
  const endOffset = Math.min(layout.totalSize, Math.max(0, scrollTop) + Math.max(0, viewportSize) + Math.max(0, overscanPx));
  const start = Math.max(0, virtualIndexAtOffset(layout, startOffset));
  const endIndex = virtualIndexAtOffset(layout, Math.max(startOffset, endOffset - 0.001));
  return { start, end: Math.min(layout.keys.length, Math.max(start + 1, endIndex + 1)) };
}

export function virtualIndexes(range: VirtualRange, pinnedIndexes: readonly number[], itemCount: number): number[] {
  const count = boundedCount(itemCount);
  const indexes = new Set<number>();
  for (let index = Math.max(0, range.start); index < Math.min(count, range.end); index += 1) indexes.add(index);
  for (const index of pinnedIndexes) if (Number.isInteger(index) && index >= 0 && index < count) indexes.add(index);
  return [...indexes].sort((left, right) => left - right);
}

export function scrollOffsetForIndex(
  layout: MeasuredVirtualLayout,
  index: number,
  viewportSize: number,
  currentScrollTop: number,
  align: 'auto' | 'start' | 'center' | 'end' = 'auto',
): number {
  if (!layout.keys.length) return 0;
  const safeIndex = Math.max(0, Math.min(layout.keys.length - 1, Math.floor(index)));
  const itemStart = layout.offsets[safeIndex];
  const itemEnd = layout.offsets[safeIndex + 1];
  const viewport = Math.max(0, viewportSize);
  let target = currentScrollTop;
  if (align === 'start') target = itemStart;
  else if (align === 'center') target = itemStart - (viewport - (itemEnd - itemStart)) / 2;
  else if (align === 'end') target = itemEnd - viewport;
  else if (itemStart < currentScrollTop) target = itemStart;
  else if (itemEnd > currentScrollTop + viewport) target = itemEnd - viewport;
  return Math.max(0, Math.min(Math.max(0, layout.totalSize - viewport), target));
}
