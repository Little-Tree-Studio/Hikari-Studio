import type { EngineSeekCacheStats, EngineTraceRestoreCacheStats } from '../engine-core/runtime';

const MAX_DURATION_SAMPLES = 512;
const MAX_DURATION_MS = 60_000;

export interface PreviewSeekPerformanceReport {
  version: 1;
  recordedAt: string;
  sampleCount: number;
  sampledDurations: number;
  inputCount: number;
  coalescedInputs: number;
  restoreDurationMs: {
    total: number;
    average: number;
    p95: number;
    max: number;
  };
  heap?: {
    startBytes: number;
    peakBytes: number;
    stableBytes: number;
    peakDeltaBytes: number;
    stableDeltaBytes: number;
  };
  engineSeekCache: EngineSeekCacheStats & { evictionRate: number };
  traceRestoreCache: EngineTraceRestoreCacheStats & { evictionRate: number };
}

type BrowserPerformanceMemory = Performance & { memory?: { usedJSHeapSize?: number } };

export function usedJsHeapBytes(): number | undefined {
  const value = (performance as BrowserPerformanceMemory).memory?.usedJSHeapSize;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

const boundedDuration = (value: number) => Number(Math.max(0, Math.min(MAX_DURATION_MS, value)).toFixed(3));
const boundedRate = (value: number) => Number(Math.max(0, Math.min(1, value)).toFixed(4));

export class PreviewSeekProfiler {
  private readonly samples = new Float64Array(MAX_DURATION_SAMPLES);
  private sampleCursor = 0;
  private sampleSize = 0;
  private totalSamples = 0;
  private inputCount = 0;
  private coalescedInputs = 0;
  private totalDurationMs = 0;
  private maxDurationMs = 0;
  private heapStart?: number;
  private heapPeak?: number;

  recordInput(coalesced: boolean): void {
    this.inputCount += 1;
    if (coalesced) this.coalescedInputs += 1;
  }

  record(durationMs: number, heapBytes = usedJsHeapBytes()): void {
    const duration = boundedDuration(durationMs);
    this.samples[this.sampleCursor] = duration;
    this.sampleCursor = (this.sampleCursor + 1) % MAX_DURATION_SAMPLES;
    this.sampleSize = Math.min(MAX_DURATION_SAMPLES, this.sampleSize + 1);
    this.totalSamples += 1;
    this.totalDurationMs += duration;
    this.maxDurationMs = Math.max(this.maxDurationMs, duration);
    if (heapBytes !== undefined) {
      this.heapStart ??= heapBytes;
      this.heapPeak = Math.max(this.heapPeak ?? heapBytes, heapBytes);
    }
  }

  snapshot(
    engineSeekCache: EngineSeekCacheStats,
    traceRestoreCache: EngineTraceRestoreCacheStats,
    stableHeapBytes = usedJsHeapBytes(),
  ): PreviewSeekPerformanceReport {
    const durations = Array.from(this.samples.slice(0, this.sampleSize)).sort((left, right) => left - right);
    const p95Index = durations.length ? Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1) : 0;
    const engineLookups = engineSeekCache.exactHits + engineSeekCache.checkpointHits + engineSeekCache.misses;
    const traceLookups = traceRestoreCache.exactHits + traceRestoreCache.misses;
    const report: PreviewSeekPerformanceReport = {
      version: 1,
      recordedAt: new Date().toISOString(),
      sampleCount: this.totalSamples,
      sampledDurations: this.sampleSize,
      inputCount: this.inputCount,
      coalescedInputs: this.coalescedInputs,
      restoreDurationMs: {
        total: boundedDuration(this.totalDurationMs),
        average: boundedDuration(this.totalSamples ? this.totalDurationMs / this.totalSamples : 0),
        p95: boundedDuration(durations[p95Index] ?? 0),
        max: boundedDuration(this.maxDurationMs),
      },
      engineSeekCache: {
        ...engineSeekCache,
        evictionRate: boundedRate(engineLookups ? engineSeekCache.evictions / engineLookups : 0),
      },
      traceRestoreCache: {
        ...traceRestoreCache,
        evictionRate: boundedRate(traceLookups ? traceRestoreCache.evictions / traceLookups : 0),
      },
    };
    if (this.heapStart !== undefined && stableHeapBytes !== undefined) {
      const peakBytes = Math.max(this.heapPeak ?? this.heapStart, stableHeapBytes);
      report.heap = {
        startBytes: this.heapStart,
        peakBytes,
        stableBytes: stableHeapBytes,
        peakDeltaBytes: peakBytes - this.heapStart,
        stableDeltaBytes: stableHeapBytes - this.heapStart,
      };
    }
    return report;
  }
}
