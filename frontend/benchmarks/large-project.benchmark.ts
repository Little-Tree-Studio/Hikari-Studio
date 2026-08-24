import { expect, test } from 'vitest';
import { LARGE_PROJECT_PROFILE, runLargeProjectBenchmark } from '../src/performance/largeProjectBenchmark';

test('10k Block / 5k asset / 1k timeline project stays within performance budgets', async () => {
  const report = await runLargeProjectBenchmark();
  console.table(report.measurements.map((measurement) => ({
    operation: measurement.name,
    milliseconds: measurement.durationMs,
    heapDeltaMiB: measurement.heapDeltaBytes === undefined ? 'n/a' : (measurement.heapDeltaBytes / 1024 / 1024).toFixed(2),
    retainedHeapDeltaMiB: measurement.retainedHeapDeltaBytes === undefined ? 'n/a' : (measurement.retainedHeapDeltaBytes / 1024 / 1024).toFixed(2),
  })));
  console.log(`SLIDE_LARGE_PROJECT_BENCHMARK=${JSON.stringify(report)}`);
  console.log(`Preview seek cache retained MiB: ${report.previewSeekCacheRetainedBytes === undefined ? 'n/a' : (report.previewSeekCacheRetainedBytes / 1024 / 1024).toFixed(2)}`);

  expect(report.shape).toEqual(LARGE_PROJECT_PROFILE);
  expect(report.timelineEvaluations).toBe(1_000);
  expect(report.previewSeeks).toBe(100);
  expect(report.cachedPreviewSeeks).toBe(100);
  expect(report.seekCacheStats.exactHits).toBe(100);
  expect(report.violations).toEqual([]);
}, 60_000);
