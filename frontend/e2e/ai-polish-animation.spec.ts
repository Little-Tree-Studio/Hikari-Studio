import { expect, test } from '@playwright/test';

test('AI 优化按钮点击后进入加载状态并显示动画', async ({ page }) => {
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');

  await page.evaluate(() => {
    const api = {
      load_project_session: async () => ({}),
      optimize_block_text: async (text: string) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return `优化后：${text}`;
      },
      save_project: async () => ({ ok: true }),
    } as unknown as NonNullable<Window['pywebview']>['api'];
    window.pywebview = { api };
  });

  const card = page.locator('.block-card.narration').first();
  const button = card.locator('.block-ai-polish');
  await expect(button).toBeVisible();
  await button.click();

  await expect(card).toHaveClass(/ai-polishing/);
  await expect(button.locator('svg')).toHaveClass(/lucide-loader-circle/);
});
