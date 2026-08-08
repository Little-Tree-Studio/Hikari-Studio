import { expect, test } from '@playwright/test';

test('build dialog runs unified preflight and blocks invalid projects without native dialogs', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?editor=1');

  await page.getByRole('button', { name: '发布游戏' }).click();
  const dialog = page.getByRole('dialog', { name: '构建与发布' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
  await expect(dialog.getByText(/正在执行全分支模拟|构建已阻止/)).toBeVisible();
  await expect(dialog.getByText('构建已阻止')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('素材', { exact: true })).toBeVisible();
  await expect(dialog.getByText('流程', { exact: true })).toBeVisible();
  await expect(dialog.getByText('可达性', { exact: true })).toBeVisible();
  await expect(dialog.getByText('兼容性', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /开始构建/ })).toBeDisabled();

  await dialog.getByRole('button', { name: /Windows 游戏/ }).click();
  await expect(dialog.getByText('WINDOWS', { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(nativeDialogs).toEqual([]);
});
