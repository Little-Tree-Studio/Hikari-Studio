import { expect, test } from '@playwright/test';

test('build execution opens a unified progress window with operation steps', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    localStorage.setItem('hikari-project', JSON.stringify({
      version: 3,
      meta: { id: 'build-progress-e2e', name: '构建进度测试', author: '', resolution: [1280, 720], updatedAt: '' },
      characters: [],
      chapters: [{ id: 'start', name: '开始', entry: true, fragments: [{ id: 'opening', name: '片头' }] }],
      activeFragmentId: 'opening',
      scripts: { opening: [{ id: 'opening-1', type: 'narration', text: '开始构建。' }] },
      assets: [],
      variables: {},
      settings: { textSpeed: 35, autoSave: true, skipRead: true },
    }));
  });
  await page.goto('/?editor=1');

  await page.getByRole('button', { name: '发布游戏' }).click();
  const publish = page.getByRole('dialog', { name: '构建与发布' });
  await publish.getByRole('button', { name: /Ren'Py 导出/ }).click();

  const progress = page.locator('.build-progress-dialog');
  const steps = progress.locator('.build-progress-steps');
  await expect(progress).toBeVisible();
  await expect(steps.getByText('1. 检查兼容语法', { exact: true })).toBeVisible();
  await expect(steps.getByText('2. 保存项目快照', { exact: true })).toBeVisible();
  await expect(steps.getByText("3. 转换 Ren'Py 脚本", { exact: true })).toBeVisible();
  await expect(steps.getByText('4. 确认输出产物', { exact: true })).toBeVisible();
  await expect(progress.getByText('构建失败', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(progress.getByText('错误信息', { exact: true })).toBeVisible();
  await expect(progress.getByRole('button', { name: '完成' })).toBeVisible();
  const bounds = await progress.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
  expect(nativeDialogs).toEqual([]);
});

test('build output folder can be selected, reused, and restored to default', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?editor=1');
  await page.evaluate(() => {
    const api = {
      load_project_session: async () => ({}),
      select_export_location: async () => 'D:\\Hikari Exports',
    } as unknown as NonNullable<Window['pywebview']>['api'];
    window.pywebview = { api };
  });

  await page.getByRole('button', { name: '发布游戏' }).click();
  let publish = page.getByRole('dialog', { name: '构建与发布' });
  await publish.getByRole('button', { name: '选择文件夹' }).click();
  await expect(publish.getByRole('textbox', { name: '导出路径' })).toHaveValue('D:\\Hikari Exports');
  await page.evaluate(() => { window.pywebview = undefined; });
  await publish.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: '发布游戏' }).click();
  publish = page.getByRole('dialog', { name: '构建与发布' });
  await expect(publish.getByRole('textbox', { name: '导出路径' })).toHaveValue('D:\\Hikari Exports');
  await publish.getByRole('button', { name: '恢复默认导出位置' }).click();
  await expect(publish.getByRole('textbox', { name: '导出路径' })).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('hikari-build-output-root'))).toBeNull();
});

test('completed build exposes trusted open-folder and launch-game actions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const project = {
    version: 3,
    meta: { id: 'completed-build-e2e', name: '完成构建测试', author: '', resolution: [1280, 720], updatedAt: '' },
    characters: [],
    chapters: [{ id: 'start', name: '开始', entry: true, fragments: [{ id: 'opening', name: '片头' }] }],
    activeFragmentId: 'opening',
    scripts: { opening: [{ id: 'opening-1', type: 'narration', text: '构建完成。' }] },
    assets: [],
    variables: {},
    settings: { textSpeed: 35, autoSave: true, skipRead: true },
  };
  await page.addInitScript((desktopProject) => {
    window.__HIKARI_DESKTOP__ = true;
    const actions: string[] = [];
    (window as Window & { __HIKARI_BUILD_ACTIONS__?: string[] }).__HIKARI_BUILD_ACTIONS__ = actions;
    const api = {
      get_editor_appearance: async () => null,
      get_app_info: async () => ({ name: 'Hikari Studio', version: '0.4.0-beta.1', channel: 'beta', platform: 'Windows', projectPath: 'C:\\Projects\\BuildE2E\\project.hikari.json', dataPath: '', buildPath: 'C:\\Builds', startupProjectRequested: false }),
      load_project_session: async () => ({ project: desktopProject, projectPath: 'C:\\Projects\\BuildE2E\\project.hikari.json', sessionToken: 'e2e-session' }),
      get_recovery_snapshot_status: async () => ({ available: false, recoveredDuringLoad: false }),
      load_command_history: async () => null,
      load_command_history_stats: async () => null,
      read_runtime_value: async () => null,
      write_runtime_value: async () => true,
      delete_runtime_value: async () => true,
      save_project: async () => ({ ok: true, path: 'C:\\Projects\\BuildE2E\\project.hikari.json', bytes: 1 }),
      save_command_history: async () => ({ ok: true, path: 'C:\\Projects\\BuildE2E\\.hikari\\history\\commands.json' }),
      preflight_build: async (_project: unknown, _target: unknown, report: unknown) => report,
      build_web: async (_project: unknown, report: unknown) => ({ ok: true, path: 'C:\\Builds\\Completed-Build\\web\\index.html', preflight: report }),
      open_build_output: async (path: string) => { actions.push(`open:${path}`); return { ok: true, path: 'C:\\Builds\\Completed-Build\\web' }; },
      launch_build_output: async (path: string) => { actions.push(`launch:${path}`); return { ok: true, path }; },
    } as unknown as NonNullable<Window['pywebview']>['api'];
    window.pywebview = { api };
  }, project);
  await page.goto('/?editor=1');

  await page.getByRole('button', { name: '发布游戏' }).click();
  const publish = page.getByRole('dialog', { name: '构建与发布' });
  await publish.getByRole('button', { name: '开始构建' }).click();

  const completed = page.getByRole('dialog', { name: '构建完成' });
  await expect(completed).toBeVisible({ timeout: 10_000 });
  await completed.getByRole('button', { name: '打开输出目录' }).click();
  await expect(completed.getByText('已打开输出目录', { exact: true })).toBeVisible();
  await completed.getByRole('button', { name: '立即运行游戏' }).click();
  await expect(completed.getByText('游戏已启动', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __HIKARI_BUILD_ACTIONS__?: string[] }).__HIKARI_BUILD_ACTIONS__)).toEqual([
    'open:C:\\Builds\\Completed-Build\\web\\index.html',
    'launch:C:\\Builds\\Completed-Build\\web\\index.html',
  ]);
});
