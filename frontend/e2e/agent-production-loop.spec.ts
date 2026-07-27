import { expect, test } from '@playwright/test';

test('production memory, director mode, and branch simulation stay inside the application UI', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto('/');

  await page.getByRole('button', { name: 'AI Agent' }).click();
  await page.getByRole('button', { name: '制作记忆' }).click();
  await expect(page.getByRole('strong').filter({ hasText: '制作记忆' }).last()).toBeVisible();
  await page.getByRole('button', { name: '添加条目' }).click();
  await page.getByPlaceholder('写下 Agent 必须遵守的具体事实或规则').fill('角色不会违背已经确认的剧情事实。');
  await page.getByRole('button', { name: '保存制作记忆' }).click();
  await expect(page.getByText('角色不会违背已经确认的剧情事实。')).toHaveCount(0);

  await page.getByRole('button', { name: '导演模式' }).click();
  await expect(page.getByRole('button', { name: '导演模式' })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: '生成演出方案' })).toBeVisible();

  await page.getByRole('button', { name: '调试运行' }).click();
  await page.getByRole('button', { name: '全分支' }).click();
  await page.getByRole('button', { name: '运行模拟' }).click();
  await expect(page.locator('.branch-simulation-stats')).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});
