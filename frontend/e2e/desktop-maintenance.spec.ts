import { expect, test } from '@playwright/test';

test('unified settings gathers runtime settings and desktop maintenance routes', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto('/?editor=1');

  const settings = page.getByRole('dialog', { name: '设置' });
  await page.locator('.module-actions').getByRole('button', { name: '设置' }).click();
  await expect(settings).toBeVisible();

  await settings.getByRole('button', { name: '运行设置' }).click();
  await expect(settings.getByRole('button', { name: '应用设置' })).toBeVisible();

  await settings.getByRole('button', { name: '维护中心' }).click();
  await expect(settings.getByRole('button', { name: '软件更新' })).toBeVisible();
  await page.getByRole('button', { name: '重载性能' }).click();
  await expect(page.getByText('暂无完整重载报告')).toBeVisible();
  await page.getByRole('button', { name: /崩溃报告/ }).click();
  await expect(page.getByText('报告不会自动上传。')).toBeVisible();

  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(settings).not.toBeVisible();
  expect(nativeDialogs).toEqual([]);
});
