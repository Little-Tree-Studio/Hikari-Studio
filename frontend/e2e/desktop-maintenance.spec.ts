import { expect, test } from '@playwright/test';

test('runtime settings and desktop maintenance keep separate application routes', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto('/?editor=1');

  const moduleActions = page.locator('.module-actions');
  await moduleActions.getByRole('button', { name: '运行设置' }).click();
  await expect(page.getByRole('dialog', { name: '运行设置' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();

  await moduleActions.getByRole('button', { name: '应用维护' }).click();
  await expect(page.getByRole('dialog', { name: 'Hikari Studio 维护中心' })).toBeVisible();
  await expect(page.getByRole('button', { name: '软件更新' })).toBeVisible();
  await page.getByRole('button', { name: '重载性能' }).click();
  await expect(page.getByText('暂无完整重载报告')).toBeVisible();
  await page.getByRole('button', { name: /崩溃报告/ }).click();
  await expect(page.getByText('报告不会自动上传。')).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});
