import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject, type UIEvent } from 'react';
import {
  createMeasuredVirtualLayout,
  fixedVirtualRange,
  measuredVirtualRange,
  scrollOffsetForIndex,
  virtualIndexAtOffset,
  virtualIndexes,
} from '../performance/virtualization';
import { recordVirtualListMeasurement } from '../performance/renderProfiler';

function useViewportHeight(containerRef: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(600);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setHeight(Math.max(1, element.clientHeight));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  });
  return height;
}

export function useFixedVirtualList(
  containerRef: RefObject<HTMLElement | null>,
  itemCount: number,
  itemSize: number,
  pinnedIndexes: readonly number[] = [],
  overscanItems = 8,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const viewportHeight = useViewportHeight(containerRef);
  const range = fixedVirtualRange(itemCount, itemSize, scrollTop, viewportHeight, overscanItems);
  const pinnedSignature = pinnedIndexes.join(',');
  const indexes = useMemo(
    () => virtualIndexes(range, pinnedIndexes, itemCount),
    [range.start, range.end, pinnedSignature, itemCount],
  );
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => setScrollTop(event.currentTarget.scrollTop), []);
  const scrollToIndex = useCallback((index: number, align: 'auto' | 'start' | 'center' | 'end' = 'auto') => {
    const element = containerRef.current;
    if (!element || itemCount <= 0) return;
    const start = Math.max(0, Math.min(itemCount - 1, index)) * itemSize;
    const end = start + itemSize;
    let target = element.scrollTop;
    if (align === 'start') target = start;
    else if (align === 'center') target = start - (element.clientHeight - itemSize) / 2;
    else if (align === 'end') target = end - element.clientHeight;
    else if (start < element.scrollTop) target = start;
    else if (end > element.scrollTop + element.clientHeight) target = end - element.clientHeight;
    element.scrollTop = Math.max(0, Math.min(itemCount * itemSize - element.clientHeight, target));
    setScrollTop(element.scrollTop);
  }, [containerRef, itemCount, itemSize]);
  return { indexes, totalSize: itemCount * itemSize, viewportHeight, scrollTop, onScroll, scrollToIndex };
}

export function useMeasuredVirtualList(
  containerRef: RefObject<HTMLElement | null>,
  keys: readonly string[],
  estimateSize: (index: number, key: string) => number,
  pinnedIndexes: readonly number[] = [],
  overscanScreens = 1.5,
  initialScrollTop = 0,
) {
  const measuredSizes = useRef(new Map<string, number>());
  const [revision, setRevision] = useState(0);
  const [scrollTop, setScrollTop] = useState(() => Math.max(0, initialScrollTop));
  const viewportHeightRef = useRef(900);
  const viewportHeight = viewportHeightRef.current;
  const layout = useMemo(
    () => createMeasuredVirtualLayout(keys, measuredSizes.current, estimateSize),
    [keys, estimateSize, revision],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const scrollTopRef = useRef(scrollTop);
  scrollTopRef.current = scrollTop;
  const observedRows = useRef(new Map<Element, string>());
  const pendingInitialMeasurements = useRef(new Map<Element, string>());
  const rowObserver = useRef<ResizeObserver | null>(null);
  const observedContainer = useRef<HTMLElement | null>(null);
  const observerLifetime = useRef(0);
  const range = measuredVirtualRange(layout, scrollTop, viewportHeight, viewportHeight * overscanScreens);
  const pinnedSignature = pinnedIndexes.join(',');
  const indexes = useMemo(
    () => virtualIndexes(range, pinnedIndexes, keys.length),
    [range.start, range.end, pinnedSignature, keys.length],
  );

  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    scrollTopRef.current = event.currentTarget.scrollTop;
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const applyMeasurements = useCallback((
    rows: readonly { element: Element; key: string; size?: number }[],
    source: 'initial' | 'observer',
    viewportSize?: number,
    observerCallbacks = 0,
  ) => {
    const startedAt = performance.now();
    const currentLayout = layoutRef.current;
    const firstVisible = virtualIndexAtOffset(currentLayout, scrollTopRef.current);
    let anchorDelta = 0;
    let firstMeasurements = 0;
    let remeasurements = 0;
    let sizesChanged = false;
    for (const row of rows) {
      if (observedRows.current.get(row.element) !== row.key) continue;
      const nextSize = row.size ?? row.element.getBoundingClientRect().height;
      if (!Number.isFinite(nextSize) || nextSize <= 0) continue;
      const previous = measuredSizes.current.get(row.key);
      if (previous === undefined) firstMeasurements += 1;
      else remeasurements += 1;
      if (previous !== undefined && Math.abs(previous - nextSize) < 0.5) continue;
      const index = currentLayout.indexByKey.get(row.key) ?? -1;
      measuredSizes.current.set(row.key, nextSize);
      sizesChanged = true;
      if (previous !== undefined && index >= 0 && index < firstVisible) anchorDelta += nextSize - previous;
    }
    const element = containerRef.current;
    if (anchorDelta !== 0 && element) {
      element.scrollTop += anchorDelta;
      scrollTopRef.current = element.scrollTop;
    }
    const nextViewportHeight = viewportSize && Number.isFinite(viewportSize) ? Math.max(1, viewportSize) : undefined;
    const viewportUpdated = nextViewportHeight !== undefined && Math.abs(viewportHeightRef.current - nextViewportHeight) >= 0.5;
    let viewportRangeFlushed = false;
    if (viewportUpdated && nextViewportHeight !== undefined) {
      const previousHeight = viewportHeightRef.current;
      const previousRange = measuredVirtualRange(currentLayout, scrollTopRef.current, previousHeight, previousHeight * overscanScreens);
      const nextRange = measuredVirtualRange(currentLayout, scrollTopRef.current, nextViewportHeight, nextViewportHeight * overscanScreens);
      viewportRangeFlushed = previousRange.start !== nextRange.start || previousRange.end !== nextRange.end;
      viewportHeightRef.current = nextViewportHeight;
    }
    if (sizesChanged || viewportRangeFlushed) setRevision((current) => current + 1);
    recordVirtualListMeasurement({
      source,
      durationMs: performance.now() - startedAt,
      firstMeasurements,
      remeasurements,
      observerCallbacks,
      revisionFlushed: sizesChanged,
      observedRows: observedRows.current.size,
      viewportMeasured: nextViewportHeight !== undefined,
      viewportUpdated,
      viewportRangeFlushed,
    });
  }, [containerRef, overscanScreens]);

  const ensureObserver = useCallback(() => {
    if (typeof ResizeObserver === 'undefined') return null;
    if (!rowObserver.current) {
      rowObserver.current = new ResizeObserver((entries) => {
        const container = observedContainer.current;
        let viewportSize: number | undefined;
        const rows: { element: Element; key: string; size?: number }[] = [];
        for (const entry of entries) {
          if (entry.target === container) {
            viewportSize = (entry.target as HTMLElement).clientHeight;
            continue;
          }
          const key = observedRows.current.get(entry.target);
          if (!key) continue;
          const borderBoxSize = entry.borderBoxSize as readonly ResizeObserverSize[] | ResizeObserverSize | undefined;
          const borderSize = Array.isArray(borderBoxSize)
            ? borderBoxSize[0]?.blockSize
            : (borderBoxSize as ResizeObserverSize | undefined)?.blockSize;
          rows.push({ element: entry.target, key, size: borderSize });
        }
        applyMeasurements(rows, 'observer', viewportSize, 1);
      });
    }
    return rowObserver.current;
  }, [applyMeasurements]);

  const measure = useCallback((key: string, element: HTMLElement | null) => {
    if (!element) return () => undefined;
    observedRows.current.set(element, key);
    pendingInitialMeasurements.current.set(element, key);
    ensureObserver()?.observe(element);
    return () => {
      pendingInitialMeasurements.current.delete(element);
      if (observedRows.current.get(element) !== key) return;
      observedRows.current.delete(element);
      rowObserver.current?.unobserve(element);
    };
  }, [ensureObserver]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const observer = container || observedRows.current.size ? ensureObserver() : rowObserver.current;
    const containerChanged = observedContainer.current !== container;
    if (observer && containerChanged) {
      if (observedContainer.current) observer.unobserve(observedContainer.current);
      observedContainer.current = container;
      if (container) observer.observe(container);
    }
    const rows = [...pendingInitialMeasurements.current].map(([element, key]) => ({ element, key }));
    pendingInitialMeasurements.current.clear();
    applyMeasurements(rows, 'initial', container && (containerChanged || !observer) ? container.clientHeight : undefined);
  });

  useLayoutEffect(() => {
    const lifetime = ++observerLifetime.current;
    return () => queueMicrotask(() => {
      // React StrictMode immediately remounts effects in development. Delaying
      // disposal keeps the shared observer alive for that replay while still
      // releasing it after a real ScriptPage unmount.
      if (observerLifetime.current !== lifetime) return;
      rowObserver.current?.disconnect();
      rowObserver.current = null;
      observedContainer.current = null;
      observedRows.current.clear();
      pendingInitialMeasurements.current.clear();
    });
  }, []);

  const scrollToIndex = useCallback((index: number, align: 'auto' | 'start' | 'center' | 'end' = 'auto') => {
    const element = containerRef.current;
    if (!element) return;
    const target = scrollOffsetForIndex(layoutRef.current, index, element.clientHeight, element.scrollTop, align);
    element.scrollTop = target;
    scrollTopRef.current = target;
    setScrollTop(target);
  }, [containerRef]);

  const setScrollOffset = useCallback((offset: number) => {
    const element = containerRef.current;
    if (!element) return;
    element.scrollTop = Math.max(0, offset);
    scrollTopRef.current = element.scrollTop;
    setScrollTop(element.scrollTop);
  }, [containerRef]);

  const indexAtClientY = useCallback((clientY: number, contentPaddingTop = 0) => {
    const element = containerRef.current;
    if (!element) return -1;
    const offset = clientY - element.getBoundingClientRect().top + element.scrollTop - contentPaddingTop;
    return virtualIndexAtOffset(layoutRef.current, offset);
  }, [containerRef]);

  return { indexes, layout, viewportHeight, scrollTop, onScroll, measure, scrollToIndex, setScrollOffset, indexAtClientY };
}
