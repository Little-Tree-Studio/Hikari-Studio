import { expect, test } from '@playwright/test';

test('generic image import requires a purpose and creates the selected entity', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.addInitScript(() => {
    localStorage.setItem('hikari-project', JSON.stringify({
      version: 3,
      meta: { id: 'asset-import-e2e', name: '素材用途测试', author: '', resolution: [1280, 720], updatedAt: '' },
      characters: [],
      scenes: [],
      chapters: [{ id: 'start', name: '开始', entry: true, fragments: [{ id: 'opening', name: '片头' }] }],
      activeFragmentId: 'opening',
      scripts: { opening: [] },
      assets: [],
      variables: {},
      settings: { textSpeed: 35, autoSave: true, skipRead: true },
    }));
  });
  await page.goto('/?editor=1');
  await page.getByRole('button', { name: /资产/ }).click();
  await page.getByRole('button', { name: '资源总览' }).click();
  await page.evaluate(() => {
    const api = {
      load_project_session: async () => ({}),
      import_assets: async () => [{
        id: 'lake-background',
        kind: 'image',
        name: '湖畔夜景',
        path: 'assets/images/lake-background.png',
        uri: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        size: 43,
      }],
      inspect_assets: async () => [{ assetId: 'lake-background', exists: true, size: 43, location: 'project' }],
      save_project: async () => ({ ok: true }),
    } as unknown as NonNullable<Window['pywebview']>['api'];
    window.pywebview = { api };
  });

  await page.getByRole('button', { name: '导入素材' }).click();
  const purposeDialog = page.getByRole('dialog', { name: '选择文件用途' });
  await expect(purposeDialog).toBeVisible();
  await expect(purposeDialog.getByRole('button', { name: '确认导入' })).toBeDisabled();
  await purposeDialog.getByText('场景背景', { exact: true }).click();
  await expect(purposeDialog.getByRole('button', { name: '确认导入' })).toBeEnabled();
  await purposeDialog.getByRole('button', { name: '确认导入' }).click();
  await expect(purposeDialog).toBeHidden();

  await page.getByRole('button', { name: /资产/ }).click();
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await expect(page.locator('.scene-list-item').filter({ hasText: '湖畔夜景' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});
