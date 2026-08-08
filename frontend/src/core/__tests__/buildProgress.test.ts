import { describe, expect, it } from 'vitest';
import { completeBuildProgress, createBuildProgressTask, failBuildProgress, updateBuildProgress } from '../buildProgress';

describe('build progress task', () => {
  it('advances steps monotonically and completes all operations', () => {
    const task = createBuildProgressTask('windows', '星海回声', 1000);
    const checked = updateBuildProgress(task, 'preflight', 0.6, '已模拟 12 条路径');
    const saving = updateBuildProgress(checked, 'save', 0.2);
    const generating = updateBuildProgress(saving, 'generate', 0.1);
    const completed = completeBuildProgress(generating, 'C:/Builds/game.exe', 2400);

    expect(checked.progress).toBe(15);
    expect(checked.steps[0].detail).toBe('已模拟 12 条路径');
    expect(saving.progress).toBeGreaterThan(checked.progress);
    expect(generating.steps.map((step) => step.status)).toEqual(['completed', 'completed', 'active', 'pending']);
    expect(completed.progress).toBe(100);
    expect(completed.steps.every((step) => step.status === 'completed')).toBe(true);
    expect(completed.outputPath).toBe('C:/Builds/game.exe');
  });

  it('marks the active operation as failed without completing pending work', () => {
    const task = updateBuildProgress(createBuildProgressTask('web', '测试项目', 1000), 'generate', 0.25);
    const failed = failBuildProgress(task, '素材复制失败', 1800);

    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('素材复制失败');
    expect(failed.steps.map((step) => step.status)).toEqual(['completed', 'completed', 'failed', 'pending']);
  });
});
