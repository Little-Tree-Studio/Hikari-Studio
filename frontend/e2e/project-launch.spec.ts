import { expect, test } from '@playwright/test';

test('startup center opens a complete four-step project wizard', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Hikari Studio' })).toBeVisible();
  await expect(page.getByRole('button', { name: /创建新项目/ })).toBeEnabled();
  await expect(page.getByText('最近项目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /创建新项目/ }).click();

  await expect(page.getByRole('heading', { name: '选择模板' })).toBeVisible();
  await expect(page.getByRole('button', { name: '最大化或还原' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /示范模板/ })).toBeInViewport();
  await expect(page.getByRole('button', { name: '下一步' })).toBeInViewport();
  const templateOverflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, height: document.documentElement.scrollHeight, viewportHeight: document.documentElement.clientHeight }));
  expect(templateOverflow.width).toBeLessThanOrEqual(templateOverflow.viewport + 1);
  expect(templateOverflow.height).toBeLessThanOrEqual(templateOverflow.viewportHeight + 1);
  await page.getByRole('button', { name: /示范模板/ }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  const next = page.getByRole('button', { name: '下一步' });
  await expect(next).toBeDisabled();
  await page.getByPlaceholder('例如：星海回声').fill('玻璃海岸');
  await next.click();

  await page.locator('select').selectOption('custom');
  await page.getByText('宽度').locator('..').getByRole('spinbutton').fill('1600');
  await page.getByText('高度').locator('..').getByRole('spinbutton').fill('900');
  await page.getByPlaceholder('创作者或团队名称').fill('Hikari Team');
  await page.getByPlaceholder('一段简单的游戏介绍').fill('潮声与记忆交错的夏日故事。');
  await page.getByRole('button', { name: '高级设置' }).click();
  await page.getByPlaceholder('玻璃海岸').fill('玻璃海岸 - 开发版');
  await next.click();

  await expect(page.getByRole('heading', { name: '预览确认' })).toBeVisible();
  await expect(page.getByText('1600 × 900')).toHaveCount(2);
  await expect(page.getByText('Hikari Team')).toBeVisible();
  await expect(page.getByText('玻璃海岸 - 开发版')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '创建项目' })).toBeVisible();
  const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, height: document.documentElement.scrollHeight, viewportHeight: document.documentElement.clientHeight }));
  expect(overflow.width).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.height).toBeLessThanOrEqual(overflow.viewportHeight + 1);
});

test('project wizard keeps its navigation visible in the desktop creation window', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await page.getByRole('button', { name: /创建新项目/ }).click();

  await expect(page.getByRole('button', { name: '上一步' })).toBeInViewport();
  await expect(page.getByRole('button', { name: '下一步' })).toBeInViewport();
  const bounds = await page.locator('.creation-content > footer').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(680);
});

test('project wizard keeps its navigation visible at Windows 125 percent scale', async ({ page }) => {
  await page.setViewportSize({ width: 1350, height: 850 });
  await page.goto('/');
  await page.getByRole('button', { name: /创建新项目/ }).click();

  await expect(page.getByRole('button', { name: '下一步' })).toBeInViewport();
  const bounds = await page.locator('.creation-content > footer').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(850);
});
