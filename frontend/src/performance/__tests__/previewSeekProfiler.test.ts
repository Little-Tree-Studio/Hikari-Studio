import { describe, expect, it } from 'vitest';
import { PreviewSeekProfiler } from '../previewSeekProfiler';

describe('PreviewSeekProfiler', () => {
  it('keeps a bounded duration sample and reports stable heap plus eviction rates', () => {
    const profiler = new PreviewSeekProfiler();
    for (let index = 0; index < 600; index += 1) {
      profiler.recordInput(index % 3 === 0);
      profiler.record(index / 10, 1_000 + index);
    }

    const report = profiler.snapshot(
      { exactHits: 40, checkpointHits: 10, misses: 50, invalidations: 0, evictions: 20, weakReclaims: 2, cachedFragments: 4, cachedResults: 30, cachedStrongResults: 20, cachedWeakResults: 10, cachedCheckpoints: 40 },
      { exactHits: 300, misses: 300, invalidations: 1, evictions: 72, cachedResults: 128 },
      1_800,
    );

    expect(report.sampleCount).toBe(600);
    expect(report.sampledDurations).toBe(512);
    expect(report.inputCount).toBe(600);
    expect(report.coalescedInputs).toBe(200);
    expect(report.restoreDurationMs.average).toBeCloseTo(29.95);
    expect(report.restoreDurationMs.p95).toBeGreaterThan(55);
    expect(report.heap).toEqual({
      startBytes: 1_000,
      peakBytes: 1_800,
      stableBytes: 1_800,
      peakDeltaBytes: 800,
      stableDeltaBytes: 800,
    });
    expect(report.engineSeekCache.evictionRate).toBe(0.2);
    expect(report.traceRestoreCache.evictionRate).toBe(0.12);
  });
});
