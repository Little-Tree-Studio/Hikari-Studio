import { describe, expect, it } from 'vitest';
import { analyzeAssetReferences } from '../../core/assetReferences';
import type { BlockType } from '../../types';
import { createLargeProjectBenchmarkFixture, LARGE_PROJECT_PROFILE, largeProjectShape } from '../largeProjectBenchmark';

describe('large project benchmark fixture', () => {
  it('keeps the release benchmark at its exact production scale', () => {
    const project = createLargeProjectBenchmarkFixture();
    expect(largeProjectShape(project)).toEqual(LARGE_PROJECT_PROFILE);
    expect(Object.keys(project.scripts)).toHaveLength(100);
    expect(Object.keys(project.timelines ?? {})).toHaveLength(100);
  });

  it('puts all StoryCard types in the first benchmark viewport sample', () => {
    const project = createLargeProjectBenchmarkFixture();
    const firstTypes = new Set(project.scripts[project.activeFragmentId].slice(0, 13).map((block) => block.type));
    expect(firstTypes).toEqual(new Set<BlockType>([
      'scene', 'sound', 'characterShow', 'camera', 'setVariable', 'dialogue', 'narration',
      'branch', 'condition', 'jump', 'call', 'return', 'characterHide',
    ]));
    expect(project.settings.editorSession?.selectedBlockByFragment?.[project.activeFragmentId]).toBe(5);
    expect(project.scripts[project.activeFragmentId][5].type).toBe('dialogue');
  });

  it('uses valid asset references so missing files do not distort timings', () => {
    const project = createLargeProjectBenchmarkFixture();
    const references = analyzeAssetReferences(project);
    expect(references.missing).toEqual([]);
    expect(references.bundledIds.size).toBeGreaterThan(1_000);
  });
});
