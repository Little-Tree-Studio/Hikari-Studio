import { describe, expect, it } from 'vitest';
import { analyzeAssetReferences } from '../../core/assetReferences';
import { createBuildPreflightReport } from '../buildPreflight';
import { simulateProjectBranches } from '../simulation';
import { testProject } from './fixtures';

describe('build preflight', () => {
  it('blocks invalid targets and deterministic multi-fragment loops', () => {
    const invalid = testProject({ start: [{ id: 'bad-jump', type: 'jump', target: 'missing' }] });
    const invalidReport = createBuildPreflightReport(invalid, 'web', simulateProjectBranches(invalid));
    expect(invalidReport.blocked).toBe(true);
    expect(invalidReport.issues.map((item) => item.code)).toContain('INVALID_TARGET');

    const loop = testProject({
      start: [{ id: 'to-loop', type: 'jump', target: 'loop' }],
      loop: [{ id: 'to-start', type: 'jump', target: 'start' }],
    });
    const loopReport = createBuildPreflightReport(loop, 'windows', simulateProjectBranches(loop));
    expect(loopReport.blocked).toBe(true);
    expect(loopReport.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DETERMINISTIC_LOOP', blocking: true, source: 'simulation' })]));
  });

  it('reports unreachable content without blocking a healthy build', () => {
    const project = testProject({
      start: [{ id: 'opening', type: 'narration', text: 'start' }],
      detached: [{ id: 'unused', type: 'narration', text: 'unused' }],
    });
    const report = createBuildPreflightReport(project, 'web', simulateProjectBranches(project));

    expect(report.blocked).toBe(false);
    expect(report.stats.unreachableFragments).toBe(1);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'UNREACHABLE_FRAGMENT', category: 'reachability', severity: 'warning' }));
  });

  it('includes timeline assets in missing-reference checks', () => {
    const project = testProject({ start: [{ id: 'opening', type: 'narration', text: 'start' }] });
    project.timelines = {
      start: {
        version: 1,
        fragmentId: 'start',
        duration: 5,
        fps: 30,
        tracks: [{ id: 'audio', name: 'Audio', kind: 'audio', clips: [{ id: 'clip', name: 'Missing music', start: 0, duration: 2, assetId: 'missing-music', keyframes: [] }] }],
      },
    };

    expect(analyzeAssetReferences(project).missing).toContainEqual(expect.objectContaining({ assetId: 'missing-music', fragmentId: 'start' }));
    expect(createBuildPreflightReport(project, 'web', simulateProjectBranches(project)).issues).toContainEqual(expect.objectContaining({ code: 'MISSING_ASSET', category: 'assets', blocking: true }));
  });

  it('centralizes non-blocking platform compatibility warnings', () => {
    const project = testProject({ start: [
      { id: 'camera', type: 'camera', filter: 'vignette' },
      { id: 'opening', type: 'narration', text: 'start' },
    ] }, {}, { assets: [{ id: 'movie', kind: 'video', name: 'Opening movie', path: 'opening.mp4', forceBundle: true }] });
    project.timelines = {
      start: {
        version: 1,
        fragmentId: 'start',
        duration: 5,
        fps: 30,
        tracks: [{ id: 'camera-track', name: 'Camera', kind: 'camera', clips: [{ id: 'camera-clip', name: 'Camera', start: 0, duration: 2, blockId: 'camera', keyframes: [{ id: 'focus', time: 0, property: 'focusDistance', value: 2, easing: 'linear' }] }] }],
      },
    };

    const report = createBuildPreflightReport(project, 'windows', simulateProjectBranches(project));
    expect(report.blocked).toBe(false);
    expect(report.issues.map((item) => item.code)).toEqual(expect.arrayContaining(['VIDEO_RUNTIME_LIMITED', 'UNSUPPORTED_TIMELINE_PROPERTY']));
    expect(report.issues.filter((item) => item.category === 'compatibility').every((item) => !item.blocking)).toBe(true);
  });
});
