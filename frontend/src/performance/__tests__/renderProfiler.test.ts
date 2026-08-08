import { afterEach, describe, expect, it } from 'vitest';
import {
  beginComponentRenderProfile,
  cancelComponentRenderProfile,
  finishComponentRenderProfile,
  recordComponentRenderMeasurement,
  recordComponentRender,
  recordVirtualListMeasurement,
} from '../renderProfiler';

describe('component render profiler', () => {
  afterEach(() => cancelComponentRenderProfile());

  it('aggregates mount and update commits by component surface', () => {
    beginComponentRenderProfile('reload-1');
    recordComponentRenderMeasurement('block-list', 'mount', 12.3456, 18, 100, 120);
    recordComponentRenderMeasurement('block-list', 'update', 4.2, 16, 125, 132);
    recordComponentRenderMeasurement('preview', 'mount', 7, 9, 102, 120);

    expect(finishComponentRenderProfile('reload-1')).toEqual({
      'block-list': {
        commits: 2,
        mounts: 1,
        updates: 1,
        actualDurationMs: 16.546,
        mountDurationMs: 12.346,
        updateDurationMs: 4.2,
        baseDurationMs: 18,
        lastCommitTimeMs: 132,
      },
      preview: {
        commits: 1,
        mounts: 1,
        updates: 0,
        actualDurationMs: 7,
        mountDurationMs: 7,
        updateDurationMs: 0,
        baseDurationMs: 9,
        lastCommitTimeMs: 120,
      },
    });
  });

  it('normalizes invalid durations and keeps a mismatched reload isolated', () => {
    beginComponentRenderProfile('reload-current');
    recordComponentRenderMeasurement('app-shell', 'nested-update', Number.NaN, -5, 10, Number.POSITIVE_INFINITY);
    expect(finishComponentRenderProfile('reload-old')).toEqual({});
    expect(finishComponentRenderProfile('reload-current')['app-shell']).toEqual({
      commits: 1,
      mounts: 0,
      updates: 1,
      actualDurationMs: 0,
      mountDurationMs: 0,
      updateDurationMs: 0,
      baseDurationMs: 0,
      lastCommitTimeMs: 0,
    });
  });

  it('separates initial row measurement from observer remeasurement', () => {
    beginComponentRenderProfile('reload-measurement');
    recordComponentRenderMeasurement('block-list', 'mount', 8, 11, 10, 22);
    recordVirtualListMeasurement({
      source: 'initial',
      durationMs: 1.2345,
      firstMeasurements: 18,
      remeasurements: 0,
      observerCallbacks: 0,
      revisionFlushed: true,
      observedRows: 18,
      viewportMeasured: true,
      viewportUpdated: true,
      viewportRangeFlushed: true,
    });
    recordVirtualListMeasurement({
      source: 'observer',
      durationMs: 0.4567,
      firstMeasurements: 0,
      remeasurements: 18,
      observerCallbacks: 1,
      revisionFlushed: false,
      observedRows: 18,
      viewportMeasured: true,
      viewportUpdated: false,
      viewportRangeFlushed: false,
    });

    expect(finishComponentRenderProfile('reload-measurement')['block-list']).toMatchObject({
      mountDurationMs: 8,
      updateDurationMs: 0,
      firstMeasurementDurationMs: 1.234,
      observerMeasurementDurationMs: 0.457,
      firstMeasurements: 18,
      remeasurements: 18,
      observerCallbacks: 1,
      revisionFlushes: 1,
      peakObservedRows: 18,
      viewportMeasurements: 2,
      viewportUpdates: 1,
      viewportRangeFlushes: 1,
    });
  });

  it('aggregates bounded StoryCard timings by Block type', () => {
    beginComponentRenderProfile('reload-story-cards');
    recordComponentRender('story-card:dialogue', 'mount', 1.25, 1.8, 10, 20);
    recordComponentRender('story-card:dialogue', 'mount', 0.75, 1.1, 11, 20);
    recordComponentRender('story-card:scene', 'update', 0.4, 0.8, 21, 24);
    recordComponentRender('story-card:unknown', 'mount', 99, 99, 10, 20);

    expect(finishComponentRenderProfile('reload-story-cards')['block-list']?.storyCardTypes).toEqual({
      dialogue: {
        commits: 2,
        mounts: 2,
        updates: 0,
        actualDurationMs: 2,
        mountDurationMs: 2,
        updateDurationMs: 0,
        baseDurationMs: 2.9,
        lastCommitTimeMs: 20,
      },
      scene: {
        commits: 1,
        mounts: 0,
        updates: 1,
        actualDurationMs: 0.4,
        mountDurationMs: 0,
        updateDurationMs: 0.4,
        baseDurationMs: 0.8,
        lastCommitTimeMs: 24,
      },
    });
  });

  it('aggregates only known dialogue editor regions', () => {
    beginComponentRenderProfile('reload-dialogue-regions');
    recordComponentRender('dialogue-region:speaker', 'mount', 0.9, 1.2, 10, 20);
    recordComponentRender('dialogue-region:expression', 'mount', 0.4, 0.6, 11, 20);
    recordComponentRender('dialogue-region:body', 'update', 0.25, 0.5, 21, 24);
    recordComponentRender('dialogue-region:unknown', 'mount', 99, 99, 10, 20);

    expect(finishComponentRenderProfile('reload-dialogue-regions')['block-list']?.dialogueRegions).toEqual({
      speaker: {
        commits: 1, mounts: 1, updates: 0, actualDurationMs: 0.9, mountDurationMs: 0.9,
        updateDurationMs: 0, baseDurationMs: 1.2, lastCommitTimeMs: 20,
      },
      expression: {
        commits: 1, mounts: 1, updates: 0, actualDurationMs: 0.4, mountDurationMs: 0.4,
        updateDurationMs: 0, baseDurationMs: 0.6, lastCommitTimeMs: 20,
      },
      body: {
        commits: 1, mounts: 0, updates: 1, actualDurationMs: 0.25, mountDurationMs: 0,
        updateDurationMs: 0.25, baseDurationMs: 0.5, lastCommitTimeMs: 24,
      },
    });
  });
});
