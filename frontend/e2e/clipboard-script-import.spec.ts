import { expect, test } from '@playwright/test';

test('clipboard text is parsed by the Python bridge before becoming Blocks', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.addInitScript(() => {
    localStorage.setItem('hikari-project', JSON.stringify({
      version: 3,
      meta: { id: 'clipboard-e2e', name: '剪贴板测试', author: '', resolution: [1280, 720], updatedAt: '' },
      characters: [{ id: 'lin', name: '林澄', color: '#397d70', expressions: ['默认', '微笑'], portraits: {}, displayNameSchemes: [{ id: 'shop', name: '店长', kind: 'fixed', value: '店长' }] }],
      chapters: [{ id: 'start', name: '开始', entry: true, fragments: [{ id: 'opening', name: '片头' }] }],
      activeFragmentId: 'opening',
      scripts: { opening: [{ id: 'opening-1', type: 'narration', text: '原有内容' }] },
      assets: [],
      variables: {},
      settings: { textSpeed: 35, autoSave: true, skipRead: true },
    }));
  });
  await page.goto('/?editor=1');
  await page.evaluate(() => {
    const calls: Array<{ characters: unknown[]; rules: Record<string, unknown> }> = [];
    (window as Window & { __HIKARI_CLIPBOARD_CALLS__?: typeof calls }).__HIKARI_CLIPBOARD_CALLS__ = calls;
    const api = {
      load_project_session: async () => ({}),
      preview_clipboard_script: async (_fallback: string, characters: unknown[], rules: Record<string, unknown>) => {
        calls.push({ characters, rules });
        const blockId = `python-${calls.length}`;
        return {
          sourceName: '系统剪贴板',
          format: 'TXT',
          warnings: [],
          rules,
          blocks: [{ id: blockId, type: 'dialogue', speaker: '林澄', expression: '微笑', text: '由 Python 解析。' }],
          matches: [{ blockId, line: 1, rawSpeaker: '店长', rawExpression: '微笑', characterId: 'lin', characterName: '林澄', characterStatus: 'alias', expression: '微笑', expressionStatus: 'exact', expressionSyntax: 'brackets' }],
        };
      },
      save_project: async () => ({ ok: true }),
    } as unknown as NonNullable<Window['pywebview']>['api'];
    window.pywebview = { api };
  });

  await page.getByRole('button', { name: '导入剧本' }).click();
  const importer = page.locator('.script-import-modal');
  const rules = importer.getByRole('region', { name: '文本解析规则' });
  await rules.locator('label').filter({ hasText: '表情标记' }).locator('select').selectOption('brackets');
  await importer.getByRole('button', { name: '粘贴文本' }).click();
  await expect(importer.getByText('系统剪贴板', { exact: true })).toBeVisible();
  await expect(importer.getByLabel('第 1 行角色')).toHaveValue('lin');
  await expect(importer.getByLabel('第 1 行正文')).toHaveValue('由 Python 解析。');
  await expect(importer.getByText('显示名匹配 · 店长 → 林澄', { exact: true })).toBeVisible();
  await expect(importer.getByText('表情精确匹配 · 微笑', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const calls = (window as Window & { __HIKARI_CLIPBOARD_CALLS__?: Array<{ characters: Array<{ name?: string }>; rules: Record<string, unknown> }> }).__HIKARI_CLIPBOARD_CALLS__;
    return { character: calls?.[0]?.characters[0]?.name, syntax: calls?.[0]?.rules.expressionSyntax };
  })).toEqual({ character: '林澄', syntax: 'brackets' });
  await importer.getByRole('button', { name: /追加 1 个 Block/ }).click();
  await expect(page.locator('.block-text').getByText('由 Python 解析。', { exact: true })).toBeVisible();

  await page.locator('.blocks-area').focus();
  await page.keyboard.press('Control+V');
  await expect.poll(() => page.evaluate(() => (window as Window & { __HIKARI_CLIPBOARD_CALLS__?: unknown[] }).__HIKARI_CLIPBOARD_CALLS__?.length)).toBe(2);
  expect(nativeDialogs).toEqual([]);
});

test('import preview supports row correction and grouped character and expression mapping', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hikari-project', JSON.stringify({
      version: 3,
      meta: { id: 'import-resolver-e2e', name: '映射测试', author: '', resolution: [1280, 720], updatedAt: '' },
      characters: [{ id: 'lin', name: '林澄', color: '#397d70', expressions: ['默认', '微笑'], portraits: {} }],
      chapters: [{ id: 'start', name: '开始', entry: true, fragments: [{ id: 'opening', name: '片头' }] }],
      activeFragmentId: 'opening',
      scripts: { opening: [{ id: 'opening-1', type: 'narration', text: '原有内容' }] },
      assets: [],
      variables: {},
      settings: { textSpeed: 35, autoSave: true, skipRead: true },
    }));
  });
  await page.goto('/?editor=1');
  await page.evaluate(() => {
    const api = {
      load_project_session: async () => ({}),
      preview_clipboard_script: async () => ({
        sourceName: '系统剪贴板',
        format: 'TXT',
        warnings: [
          '第 1 行角色“小林”未匹配，保留原名称',
          '第 2 行角色“小林”未匹配，保留原名称',
          '第 3 行角色“记者”未匹配，保留原名称',
        ],
        blocks: [
          { id: 'unknown-1', type: 'dialogue', speaker: '小林', expression: '默认', text: '第一句。' },
          { id: 'unknown-2', type: 'dialogue', speaker: '小林', expression: '默认', text: '第二句。' },
          { id: 'unknown-3', type: 'dialogue', speaker: '记者', expression: '默认', text: '第三句。' },
        ],
        matches: [
          { blockId: 'unknown-1', line: 1, rawSpeaker: '小林', rawExpression: '开心', characterStatus: 'unmatched', expression: '默认', expressionStatus: 'unverified', expressionSyntax: 'brackets' },
          { blockId: 'unknown-2', line: 2, rawSpeaker: '小林', rawExpression: '开心', characterStatus: 'unmatched', expression: '默认', expressionStatus: 'unverified', expressionSyntax: 'brackets' },
          { blockId: 'unknown-3', line: 3, rawSpeaker: '记者', rawExpression: '开心', characterStatus: 'unmatched', expression: '默认', expressionStatus: 'unverified', expressionSyntax: 'brackets' },
        ],
      }),
      save_project: async () => ({ ok: true }),
    } as unknown as NonNullable<Window['pywebview']>['api'];
    window.pywebview = { api };
  });

  await page.getByRole('button', { name: '导入剧本' }).click();
  const importer = page.locator('.script-import-modal');
  await importer.getByRole('button', { name: '粘贴文本' }).click();
  await expect(importer.getByRole('region', { name: '批量映射' })).toBeVisible();
  await expect(importer.getByLabel('批量映射角色 小林')).toBeVisible();
  await importer.getByLabel('批量映射角色 小林').selectOption('lin');
  await importer.getByLabel('第 3 行角色').selectOption('lin');
  await expect(importer.getByText('角色人工修正')).toHaveCount(3);

  await importer.getByLabel('批量映射表情 林澄 开心').selectOption('微笑');
  await expect(importer.getByText('表情人工修正 · 微笑')).toHaveCount(3);
  await importer.getByLabel('第 3 行正文').fill('人工修正后的第三句。');

  await expect(page.locator('.block-text').getByText('原有内容', { exact: true })).toBeVisible();
  await expect(page.locator('.block-text').getByText('第一句。', { exact: true })).toHaveCount(0);
  await importer.getByRole('button', { name: /追加 3 个 Block/ }).click();
  await expect(page.locator('.block-text').getByText('第一句。', { exact: true })).toBeVisible();
  await expect(page.locator('.block-text').getByText('人工修正后的第三句。', { exact: true })).toBeVisible();
});
