import { expect, test } from '@playwright/test';

test('纯文本 / RenPy / JSON 编辑器可按 Enter 换行', async ({ page }) => {
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');

  // 纯文本
  await page.locator('.view-button', { hasText: '纯文本' }).click();
  const plain = page.locator('.plain-text-editor');
  await expect(plain).toBeVisible();
  await plain.click();
  await plain.press('End');
  await plain.press('Enter');
  expect(await plain.inputValue()).toContain('\n');

  // Ren'Py
  await page.locator('.view-button', { hasText: "Ren'Py" }).click();
  const code = page.locator('.code-editor');
  await expect(code).toBeVisible();
  await code.click();
  await code.press('End');
  await code.press('Enter');
  expect(await code.inputValue()).toContain('\n');

  // JSON
  await page.locator('.view-button', { hasText: 'JSON' }).click();
  const json = page.locator('.json-editor');
  await expect(json).toBeVisible();
  await json.click();
  await json.press('End');
  await json.press('Enter');
  expect(await json.inputValue()).toContain('\n');
});
