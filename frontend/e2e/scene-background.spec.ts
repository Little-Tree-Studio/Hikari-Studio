import { expect, test } from '@playwright/test';

test('scene Blocks and the scene workspace use the configured scene image as their background', async ({ page }) => {
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');

  const sceneCard = page.locator('.block-card.scene').first();
  await expect(sceneCard).toHaveClass(/has-scene-background/);
  await expect(sceneCard.locator('.scene-card-background')).toHaveAttribute('src', /lake\.jpg/);
  await expect(sceneCard.locator('.scene-summary')).toContainText('晨雾湖畔');

  await page.getByRole('button', { name: /资产/ }).click();
  await page.getByRole('button', { name: '场景', exact: true }).click();
  const workspace = page.locator('.scene-stage-panel');
  await expect(workspace).toHaveClass(/has-scene-background/);
  await expect(workspace.locator('.scene-workspace-background')).toHaveAttribute('src', /lake\.jpg/);
  await expect(workspace.locator('.scene-stage-camera > img')).toHaveAttribute('src', /lake\.jpg/);

  await page.locator('.scene-list-item').filter({ hasText: '远山晴空' }).click();
  await expect(workspace.locator('.scene-workspace-background')).toHaveAttribute('src', /mountain\.jpg/);
  await expect(workspace.locator('.scene-stage-camera > img')).toHaveAttribute('src', /mountain\.jpg/);
});
