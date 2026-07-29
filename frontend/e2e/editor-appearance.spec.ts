import { expect, test } from '@playwright/test';

test('editor appearance switches themes and keeps game theme separate', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto('/?editor=1');

  await page.getByRole('button', { name: '个性化' }).click();
  await expect(page.getByRole('dialog', { name: '编辑器外观' })).toBeVisible();
  await page.getByRole('button', { name: /Graphite/ }).click();
  await page.getByRole('button', { name: '完整动效' }).click();
  await page.getByRole('button', { name: '应用外观' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-editor-theme', 'graphite');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');

  await page.getByRole('button', { name: '个性化' }).click();
  await page.getByRole('button', { name: '减少动效' }).click();
  await page.getByRole('button', { name: '应用外观' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');

  await page.getByRole('button', { name: '个性化' }).click();
  await page.getByRole('button', { name: '游戏 UI 主题 配置玩家看到的对白、菜单和存档界面 打开编辑器' }).click();
  await expect(page.getByRole('dialog', { name: '游戏 UI 主题' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 960 }, { width: 1920, height: 1080 }]) {
  test(`editor shell fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?editor=1');
    await expect(page.locator('.app-shell')).toBeVisible();
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(overflow.width).toBeLessThanOrEqual(overflow.viewport + 1);
    const boxes = await page.locator('.topbar, .module-nav, .workspace').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }));
    expect(boxes.every((box) => box.left >= -1 && box.right <= viewport.width + 1 && box.top >= -1 && box.bottom <= viewport.height + 1)).toBe(true);
  });
}
