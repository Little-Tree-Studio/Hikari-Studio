import { expect, test, type Page } from '@playwright/test';
import { BLOCK_CONFORMANCE_MATRIX, BLOCK_CONFORMANCE_MATRIX_VERSION, type BlockConformanceAction, type BlockConformanceObservation } from '../src/engine-core/blockConformance';

async function waitForHarness(page: Page, caseId: string, surface: 'editor-preview' | 'web-runtime') {
  await page.waitForFunction(([expectedCase, expectedSurface]) => {
    const harness = window.__SLIDE_BLOCK_CONFORMANCE__;
    return harness?.caseId === expectedCase && harness.surface === expectedSurface;
  }, [caseId, surface]);
}

async function observe(page: Page): Promise<BlockConformanceObservation> {
  return page.evaluate(() => window.__SLIDE_BLOCK_CONFORMANCE__!.getObservation());
}

async function applyAction(page: Page, action: BlockConformanceAction) {
  const before = JSON.stringify(await observe(page));
  await page.evaluate((nextAction) => {
    const harness = window.__SLIDE_BLOCK_CONFORMANCE__!;
    if (nextAction.type === 'choose') harness.choose(nextAction.target);
    else harness.advance();
  }, action);
  await page.waitForFunction((previous) => JSON.stringify(window.__SLIDE_BLOCK_CONFORMANCE__?.getObservation()) !== previous, before);
}

async function runSurface(page: Page, url: string, caseId: string, surface: 'editor-preview' | 'web-runtime', actions: BlockConformanceAction[]) {
  await page.goto(url);
  await waitForHarness(page, caseId, surface);
  const observations = [await observe(page)];
  for (const action of actions) {
    await applyAction(page, action);
    observations.push(await observe(page));
  }
  return observations;
}

test('editor Preview and exported Web runtime execute the 14 Block matrix identically', async ({ page }) => {
  for (const testCase of BLOCK_CONFORMANCE_MATRIX) {
    const editor = await runSurface(page, `/?block-conformance=${testCase.id}`, testCase.id, 'editor-preview', testCase.actions);
    const runtime = await runSurface(page, `/runtime/?block-conformance=${testCase.id}`, testCase.id, 'web-runtime', testCase.actions);
    expect(runtime, `${testCase.id} diverged between Preview and Web runtime`).toEqual(editor);
    await expect(page.locator('.game-runtime')).toHaveAttribute('style', /--game-aspect/);
  }
});

test('conformance harness renders the main visible Block effects', async ({ page }) => {
  await page.goto('/?block-conformance=scene');
  await waitForHarness(page, 'scene', 'editor-preview');
  await expect(page.locator('.stage-bg')).toHaveAttribute('src', /^data:image/);
  await expect(page.locator('.stage-scene-layer')).toHaveCount(1);

  await page.goto('/runtime/?block-conformance=characterShow');
  await waitForHarness(page, 'characterShow', 'web-runtime');
  await expect(page.locator('.game-character')).toHaveCount(1);
  await expect(page.locator('.game-character img')).toHaveAttribute('alt', /Hero.*smile/);

  await page.goto('/?block-conformance=camera');
  await expect(page.locator('.camera-layer')).toHaveAttribute('style', /scale\(1\.25\).*rotate\(3deg\)/);

  await page.goto('/runtime/?block-conformance=dialogue');
  await waitForHarness(page, 'dialogue', 'web-runtime');
  await expect(page.locator('.game-dialogue-copy > strong')).toHaveText('Hero');

  await page.goto('/?block-conformance=branch');
  await expect(page.locator('.preview-choices button')).toHaveText('Continue');
  expect((await page.evaluate(() => window.__SLIDE_BLOCK_CONFORMANCE__?.matrixVersion))).toBe(BLOCK_CONFORMANCE_MATRIX_VERSION);
});
