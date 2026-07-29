import { expect, test } from '@playwright/test';

test('stage timeline edits clips, keyframes, and participates in command undo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?editor=1');
  await page.getByRole('button', { name: '演出' }).click();

  const workspace = page.getByTestId('stage-timeline-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.locator('.timeline-track')).toHaveCount(4);
  for (const kind of ['scene', 'character', 'camera', 'audio']) {
    await expect(workspace.locator(`[data-track-kind="${kind}"]`)).toBeVisible();
  }

  const sceneClip = workspace.locator('[data-track-kind="scene"] .timeline-clip').first();
  await sceneClip.click();
  await expect(page.getByText('片段属性')).toBeVisible();
  const keyframesBefore = await workspace.locator('[data-track-kind="scene"] .timeline-keyframe').count();
  await page.getByRole('button', { name: '在播放头添加' }).click();
  await expect(workspace.locator('[data-track-kind="scene"] .timeline-keyframe')).toHaveCount(keyframesBefore + 1);
  await page.locator('.timeline-keyframe-row').first().click();
  await page.getByLabel('关键帧缓动').selectOption('cubicBezier');
  await expect(page.getByLabel('贝塞尔缓动曲线')).toBeVisible();
  await expect(page.locator('.timeline-bezier-editor input')).toHaveCount(4);

  const cameraTrack = workspace.locator('[data-track-kind="camera"]');
  const cameraCountBefore = await cameraTrack.locator('.timeline-clip').count();
  await page.getByRole('button', { name: '添加片段' }).click();
  await page.getByRole('button', { name: '镜头片段' }).click();
  await expect(cameraTrack.locator('.timeline-clip')).toHaveCount(cameraCountBefore + 1);

  const cameraClip = cameraTrack.locator('.timeline-clip').last();
  await cameraClip.click();
  const startInput = page.getByLabel('开始时间');
  const startBefore = Number(await startInput.inputValue());
  const box = await cameraClip.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await startInput.inputValue())).toBeGreaterThan(startBefore);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => Number(await startInput.inputValue())).toBeCloseTo(startBefore, 2);

  const durationInput = page.getByLabel('持续时间');
  const durationBefore = Number(await durationInput.inputValue());
  const trimHandle = cameraClip.locator('.timeline-trim-handle.end');
  const trimBox = await trimHandle.boundingBox();
  expect(trimBox).not.toBeNull();
  await page.mouse.move(trimBox!.x + trimBox!.width / 2, trimBox!.y + trimBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(trimBox!.x + trimBox!.width / 2 + 72, trimBox!.y + trimBox!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await durationInput.inputValue())).toBeGreaterThan(durationBefore);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Number(await durationInput.inputValue())).toBeCloseTo(durationBefore, 2);

  const sceneId = await sceneClip.getAttribute('data-clip-id');
  const cameraId = await cameraClip.getAttribute('data-clip-id');
  await sceneClip.click();
  await cameraClip.click({ modifiers: ['Control'] });
  await expect(workspace.locator('.timeline-clip.selected')).toHaveCount(2);
  const cameraBox = await cameraClip.boundingBox();
  const audioLaneBox = await workspace.locator('[data-track-kind="audio"] .timeline-track-lane').boundingBox();
  expect(cameraBox).not.toBeNull(); expect(audioLaneBox).not.toBeNull();
  await page.mouse.move(cameraBox!.x + cameraBox!.width / 2, cameraBox!.y + cameraBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(cameraBox!.x + cameraBox!.width / 2 + 36, audioLaneBox!.y + audioLaneBox!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(workspace.locator(`[data-track-kind="character"] [data-clip-id="${sceneId}"]`)).toHaveCount(1);
  await expect(workspace.locator(`[data-track-kind="audio"] [data-clip-id="${cameraId}"]`)).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(workspace.locator(`[data-track-kind="scene"] [data-clip-id="${sceneId}"]`)).toHaveCount(1);
  await expect(workspace.locator(`[data-track-kind="camera"] [data-clip-id="${cameraId}"]`)).toHaveCount(1);

  const allClips = workspace.locator('.timeline-clip');
  const clipCountBeforePaste = await allClips.count();
  await page.getByTitle('复制所选片段').click();
  await page.getByTitle('粘贴片段到播放头').click();
  await expect(allClips).toHaveCount(clipCountBeforePaste + 2);
  await page.keyboard.press('Control+z');
  await expect(allClips).toHaveCount(clipCountBeforePaste);

  const rippleButton = page.getByRole('button', { name: '波纹' });
  await rippleButton.click();
  await expect(rippleButton).toHaveClass(/active/);

  const cameraTrackBoxBefore = await cameraTrack.boundingBox();
  const cameraResize = cameraTrack.locator('.timeline-track-resize');
  const resizeBox = await cameraResize.boundingBox();
  expect(cameraTrackBoxBefore).not.toBeNull(); expect(resizeBox).not.toBeNull();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2 + 28, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await cameraTrack.boundingBox())!.height).toBeGreaterThan(cameraTrackBoxBefore!.height);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await cameraTrack.boundingBox())!.height).toBeCloseTo(cameraTrackBoxBefore!.height, 0);

  const cameraLane = cameraTrack.locator('.timeline-track-lane');
  const firstTrackLane = workspace.locator('[data-track-kind="scene"] .timeline-track-lane');
  const cameraLaneBox = await cameraLane.boundingBox();
  const firstLaneBox = await firstTrackLane.boundingBox();
  expect(cameraLaneBox).not.toBeNull(); expect(firstLaneBox).not.toBeNull();
  await page.mouse.move(cameraLaneBox!.x + cameraLaneBox!.width - 24, cameraLaneBox!.y + cameraLaneBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstLaneBox!.x + 2, firstLaneBox!.y + 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => workspace.locator('.timeline-clip.selected').count()).toBeGreaterThan(0);

  await expect(workspace.locator('[data-track-kind="audio"] .timeline-waveform, [data-track-kind="audio"] .timeline-waveform-status')).toHaveCount(1);

  await sceneClip.click();
  await cameraClip.click({ modifiers: ['Control'] });
  await page.getByTitle('创建轨道组').click();
  const group = workspace.locator('.timeline-track-group');
  await expect(group).toHaveCount(1);
  await expect(group).toContainText('2 条轨道');
  await group.getByTitle('折叠轨道组').click();
  await expect(workspace.locator('[data-track-kind="scene"]')).toHaveCount(0);
  await group.getByTitle('展开轨道组').click();
  await expect(workspace.locator('[data-track-kind="scene"]')).toBeVisible();

  await workspace.locator('[data-track-kind="character"] .timeline-track-collapse').click();
  await expect(workspace.locator('[data-track-kind="character"]')).toHaveClass(/collapsed/);
  await workspace.locator('[data-track-kind="character"] .timeline-track-collapse').click();

  await page.getByTitle('添加标记点').click();
  await expect(workspace.locator('.timeline-marker')).toHaveCount(1);
  await page.getByTitle('设置循环起点').click();
  const ruler = workspace.locator('.timeline-ruler');
  const rulerBox = await ruler.boundingBox();
  expect(rulerBox).not.toBeNull();
  await page.mouse.move(rulerBox!.x + 180, rulerBox!.y + 16);
  await page.mouse.down();
  await page.mouse.move(rulerBox!.x + 250, rulerBox!.y + 16, { steps: 5 });
  await page.mouse.up();
  await page.getByTitle('设置循环终点').click();
  await page.getByTitle('循环播放区间').click();
  await expect(workspace.locator('.timeline-loop-region.enabled').first()).toBeVisible();

  const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(overflow.width).toBeLessThanOrEqual(overflow.viewport + 1);
});
