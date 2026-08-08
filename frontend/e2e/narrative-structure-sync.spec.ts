import { expect, test } from '@playwright/test';

test('narrative map and script tree share one live chapter and Fragment structure', async ({ page }) => {
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');
  await page.getByRole('button', { name: '叙事地图' }).click();

  await expect(page.locator('.narrative-tabs button.active')).toHaveText('剧本结构');
  await expect(page.locator('[data-chapter-id="c1"] [data-fragment-id="lake-meeting"]')).toContainText('湖畔相遇');

  await page.getByRole('button', { name: '在 第一章 · 雾中的来信 新建片段' }).click();
  await page.locator('.app-dialog-input').fill('地图同步片段');
  await page.getByRole('button', { name: '创建片段' }).click();

  const mapFragment = page.locator('.narrative-structure-list [data-fragment-id]').filter({ hasText: '地图同步片段' });
  await expect(mapFragment).toBeVisible();
  await expect(page.locator('.narrative-node.kind-fragment').filter({ hasText: '地图同步片段' })).toBeVisible();

  await mapFragment.getByRole('button', { name: '重命名片段 地图同步片段' }).click();
  await page.locator('.app-dialog-input').fill('地图同步片段 · 已重命名');
  await page.getByRole('button', { name: '保存名称' }).click();
  await expect(mapFragment).toContainText('地图同步片段 · 已重命名');
  await expect(page.locator('.narrative-node.kind-fragment').filter({ hasText: '地图同步片段 · 已重命名' })).toBeVisible();

  await mapFragment.getByRole('button', { name: '打开片段 地图同步片段 · 已重命名' }).click();
  await expect(page.locator('.fragment-row.active')).toContainText('地图同步片段 · 已重命名');
  await expect(page.locator('.editor-title')).toContainText('地图同步片段 · 已重命名');

  const chapterRow = page.locator('.chapter-row').filter({ hasText: '第一章 · 雾中的来信' });
  await chapterRow.getByTitle('新建片段').click();
  await page.locator('.app-dialog-input').fill('剧本树同步片段');
  await page.getByRole('button', { name: '创建片段' }).click();
  await page.getByRole('button', { name: '叙事地图' }).click();

  await expect(page.locator('.narrative-structure-list [data-fragment-id]').filter({ hasText: '剧本树同步片段' })).toBeVisible();
  await expect(page.locator('.narrative-node.kind-fragment').filter({ hasText: '剧本树同步片段' })).toBeVisible();
});
