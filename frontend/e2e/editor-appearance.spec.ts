import { expect, test } from '@playwright/test';

test('editor appearance switches themes and keeps game theme separate', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto('/?editor=1');

  await page.getByRole('button', { name: '个性化' }).click();
  await expect(page.getByRole('dialog', { name: '编辑器外观' })).toBeVisible();
  await page.getByRole('button', { name: /Graphite/ }).click();
  await page.getByRole('button', { name: '完整动效' }).click();
  await page.getByRole('button', { name: '应用外观' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-editor-theme', 'graphite');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');

  await page.getByRole('button', { name: '个性化' }).click();
  await page.getByRole('button', { name: '减少动效' }).click();
  await page.getByRole('button', { name: '应用外观' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');

  await page.getByRole('button', { name: '个性化' }).click();
  await page.getByRole('button', { name: /大圆角/ }).click();
  await page.getByRole('button', { name: '应用外观' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-corner-style', 'rounded');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-corner-style', 'rounded');

  await page.getByRole('button', { name: '个性化' }).click();
  await page.getByRole('button', { name: '游戏 UI 主题 配置玩家看到的对白、菜单和存档界面 打开编辑器' }).click();
  await expect(page.getByRole('dialog', { name: '游戏 UI 主题' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});

test('legacy desktop echo cannot revert a freshly applied appearance', async ({ page }) => {
  const project = {
    version: 3,
    meta: { id: 'appearance-legacy-e2e', name: '外观回归测试', author: '', resolution: [1280, 720], updatedAt: '' },
    characters: [],
    chapters: [{ id: 'start', name: '开始', entry: true, fragments: [{ id: 'opening', name: '片头' }] }],
    activeFragmentId: 'opening',
    scripts: { opening: [{ id: 'opening-1', type: 'narration', text: '外观回归。' }] },
    assets: [],
    variables: {},
    settings: { textSpeed: 35, autoSave: true, skipRead: true },
  };
  await page.addInitScript((desktopProject) => {
    window.__SLIDE_DESKTOP__ = true;
    const legacy = { version: 1, mode: 'system', themeId: 'slide-light', motion: 'system', cornerStyle: 'soft' };
    const api = {
      // A legacy desktop build accepts the call but silently normalizes the
      // corner style (and any unknown field) away in its echo.
      get_editor_appearance: async () => ({ ...legacy }),
      save_editor_appearance: async (appearance: Record<string, unknown>) => ({
        ...legacy,
        mode: appearance.mode === 'fixed' ? 'fixed' : 'system',
        themeId: typeof appearance.themeId === 'string' ? appearance.themeId : legacy.themeId,
        motion: typeof appearance.motion === 'string' ? appearance.motion : legacy.motion,
      }),
      get_app_info: async () => ({ name: 'Slide Studio', version: '0.4.0-beta.1', channel: 'beta', platform: 'Windows', projectPath: 'C:\\Projects\\AppearanceE2E\\project.slide.json', dataPath: '', buildPath: 'C:\\Builds', startupProjectRequested: false }),
      load_project_session: async () => ({ project: desktopProject, projectPath: 'C:\\Projects\\AppearanceE2E\\project.slide.json', sessionToken: 'e2e-session' }),
      get_recovery_snapshot_status: async () => ({ available: false, recoveredDuringLoad: false }),
      load_command_history: async () => null,
      load_command_history_stats: async () => null,
      read_runtime_value: async () => null,
      write_runtime_value: async () => true,
      delete_runtime_value: async () => true,
      save_project: async () => ({ ok: true, path: 'C:\\Projects\\AppearanceE2E\\project.slide.json', bytes: 1 }),
      save_command_history: async () => ({ ok: true, path: 'C:\\Projects\\AppearanceE2E\\.slide\\history\\commands.json' }),
    } as unknown as NonNullable<Window['pywebview']>['api'];
    window.pywebview = { api };
  }, project);
  await page.goto('/?editor=1');

  await page.getByRole('button', { name: '个性化' }).click();
  await page.getByRole('button', { name: /Graphite/ }).click();
  await page.getByRole('button', { name: /大圆角/ }).click();
  await page.getByRole('button', { name: '应用外观' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-editor-theme', 'graphite');
  await expect(page.locator('html')).toHaveAttribute('data-corner-style', 'rounded');

  await page.getByRole('button', { name: '个性化' }).click();
  const dialog = page.getByRole('dialog', { name: '编辑器外观' });
  await expect(dialog.getByRole('button', { name: /大圆角/ })).toHaveClass(/selected/);
  await expect(dialog.getByRole('button', { name: /Graphite/ })).toHaveClass(/selected/);
  await dialog.getByRole('button', { name: '取消' }).click();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-editor-theme', 'graphite');
  await expect(page.locator('html')).toHaveAttribute('data-corner-style', 'rounded');
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 960 }, { width: 1920, height: 1080 }]) {
  test(`editor shell fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?editor=1');
    await expect(page.locator('.app-shell')).toBeVisible();
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(overflow.width).toBeLessThanOrEqual(overflow.viewport + 1);
    const boxes = await page.locator('.topbar, .module-nav, .workspace').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }));
    expect(boxes.every((box) => box.left >= -1 && box.right <= viewport.width + 1 && box.top >= -1 && box.bottom <= viewport.height + 1)).toBe(true);
  });
}
