import { expect, test } from '@playwright/test';

test('measured Block rows share one ResizeObserver instance', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeResizeObserver = window.ResizeObserver;
    const stats = { nextId: 0, rowObserverIds: [] as number[], containerObserverIds: [] as number[] };
    class TrackingResizeObserver {
      readonly id = ++stats.nextId;
      readonly native: ResizeObserver;

      constructor(callback: ResizeObserverCallback) {
        this.native = new NativeResizeObserver((entries) => callback(entries, this as unknown as ResizeObserver));
      }

      observe(target: Element, options?: ResizeObserverOptions) {
        const targetIds = target.classList.contains('virtual-block-row') || target.classList.contains('virtual-plain-row')
          ? stats.rowObserverIds
          : target.classList.contains('blocks-area') || target.classList.contains('plain-script-editor')
            ? stats.containerObserverIds
            : null;
        if (targetIds && !targetIds.includes(this.id)) targetIds.push(this.id);
        this.native.observe(target, options);
      }

      unobserve(target: Element) { this.native.unobserve(target); }
      disconnect() { this.native.disconnect(); }
    }
    window.ResizeObserver = TrackingResizeObserver as unknown as typeof ResizeObserver;
    (window as unknown as { __SLIDE_RESIZE_OBSERVER_STATS__: typeof stats }).__SLIDE_RESIZE_OBSERVER_STATS__ = stats;
  });
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');
  await expect(page.locator('.virtual-block-row').first()).toBeVisible();

  const stats = await page.evaluate(() => (
    window as unknown as { __SLIDE_RESIZE_OBSERVER_STATS__: { rowObserverIds: number[]; containerObserverIds: number[] } }
  ).__SLIDE_RESIZE_OBSERVER_STATS__);
  expect(stats.rowObserverIds).toHaveLength(1);
  expect(stats.containerObserverIds).toEqual(stats.rowObserverIds);
});

test('StoryCard mounts lightweight summaries and reveals controls on selection', async ({ page }) => {
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');

  const dialogue = page.locator('.block-card.dialogue').first();
  await expect(dialogue).toBeVisible();
  await expect(dialogue.locator('.dialogue-summary')).toBeVisible();
  await expect(dialogue.locator('.block-commands')).toHaveCount(0);
  await dialogue.click();
  await expect(page.locator('.block-drag-ghost')).toHaveCount(0);
  await expect(dialogue.getByLabel('对白角色')).toBeVisible();
  await expect(dialogue.getByLabel('玩家显示名')).toBeVisible();
  await expect(dialogue.getByLabel('对白表情')).toBeVisible();
  await expect(dialogue.getByRole('option')).toHaveCount(0);
  await expect(dialogue.locator('.block-commands button')).toHaveCount(4);

  await dialogue.getByLabel('对白角色').click();
  const speakerOptions = dialogue.getByRole('listbox', { name: '对白角色选项' });
  await expect(speakerOptions).toBeVisible();
  await expect(speakerOptions.getByRole('option')).toHaveCount(2);
  await speakerOptions.getByRole('option', { name: '苏芮' }).click();
  await expect(dialogue.getByLabel('对白角色')).toHaveText('苏芮');
  await expect(dialogue.getByLabel('对白表情')).toHaveText('默认');
  await expect(speakerOptions).toHaveCount(0);

  await dialogue.getByLabel('对白表情').click();
  const expressionOptions = dialogue.getByRole('listbox', { name: '对白表情选项' });
  await expect(expressionOptions.getByRole('option')).toHaveCount(3);
  await expressionOptions.getByRole('option', { name: '犹豫' }).click();
  await expect(dialogue.getByLabel('对白表情')).toHaveText('犹豫');

  await dialogue.getByLabel('玩家显示名').click();
  const displayNameOptions = dialogue.getByRole('listbox', { name: '玩家显示名选项' });
  await expect(displayNameOptions).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(displayNameOptions).toHaveCount(0);
  await expect(dialogue.getByLabel('玩家显示名')).toBeFocused();

  await dialogue.getByLabel('对白角色').click();
  await expect(dialogue.getByRole('listbox', { name: '对白角色选项' })).toBeVisible();
  await dialogue.locator('.block-meta').click();
  await expect(dialogue.getByRole('listbox', { name: '对白角色选项' })).toHaveCount(0);

  const narration = page.locator('.block-card.narration').first();
  await expect(narration.locator('.block-text')).not.toHaveAttribute('contenteditable', 'true');
  await narration.click();
  await expect(narration.locator('.block-text')).toHaveAttribute('contenteditable', 'true');
});

test('clicking a Block selects that exact card even when another virtual row was active', async ({ page }) => {
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');

  await page.locator('[data-block-index="2"] .block-card').click();
  await expect(page.locator('[data-block-index="2"] .block-card')).toHaveClass(/selected/);

  const firstCard = page.locator('[data-block-index="0"] .block-card');
  await firstCard.click();
  await expect(firstCard).toHaveClass(/selected/);
  await expect(page.locator('[data-block-index="2"] .block-card')).not.toHaveClass(/selected/);

  await page.locator('[data-block-index="1"] .block-card').click();
  await expect(page.locator('[data-block-index="1"] .block-card')).toHaveClass(/selected/);
  await expect(page.locator('[data-block-index="0"] .block-card')).not.toHaveClass(/selected/);
});

test('seeking the OP timeline still selects the corresponding Block', async ({ page }) => {
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');

  await page.locator('[data-block-index="2"] .block-card').click();
  await expect(page.locator('[data-block-index="2"] .block-card')).toHaveClass(/selected/);

  const opTimeline = page.getByRole('slider', { name: 'OP 时间轴' });
  await expect(opTimeline).toBeEnabled();
  await opTimeline.click();
  await page.keyboard.press('Home');
  await expect(page.locator('[data-block-index="0"] .block-card')).toHaveClass(/selected/);
  await expect(page.locator('[data-block-index="2"] .block-card')).not.toHaveClass(/selected/);
});

test('a Block card can be dragged by its body to an exact before or after position', async ({ page }) => {
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');

  const source = page.locator('[data-block-index="0"] .block-card');
  const target = page.locator('[data-block-index="2"] .block-card');
  const sourceBounds = await source.boundingBox();
  const targetBounds = await target.boundingBox();
  expect(sourceBounds).not.toBeNull();
  expect(targetBounds).not.toBeNull();
  if (!sourceBounds || !targetBounds) return;

  await page.mouse.move(sourceBounds.x + sourceBounds.width * .72, sourceBounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(targetBounds.x + targetBounds.width * .72, targetBounds.y + targetBounds.height - 6, { steps: 8 });
  const ghost = page.locator('.block-drag-ghost');
  await expect(ghost).toBeVisible();
  await expect(page.locator('[data-block-index="0"] .story-block')).toHaveClass(/dragging/);
  const firstTransform = await ghost.evaluate((element) => (element as HTMLElement).style.transform);
  await page.mouse.move(targetBounds.x + targetBounds.width * .72 - 24, targetBounds.y + targetBounds.height - 8, { steps: 3 });
  await expect.poll(() => ghost.evaluate((element) => (element as HTMLElement).style.transform)).not.toBe(firstTransform);
  await expect(page.locator('.virtual-block-row').filter({ has: page.locator('[data-block-index="2"]') })).toHaveClass(/drag-over-after/);
  await page.mouse.up();

  await expect(ghost).toHaveCount(0);
  await expect(page.locator('[data-block-index="2"] .block-card.scene')).toBeVisible();
  await expect(page.locator('[data-block-index="0"] .block-card.sound')).toBeVisible();
  await page.keyboard.press('Control+Z');
  await expect(page.locator('[data-block-index="0"] .block-card.scene')).toBeVisible();
});

test('the inline plus inserts a Block at its exact card position and remains undoable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');

  const originalThirdText = await page.locator('[data-block-index="2"] .block-card').textContent();
  await page.locator('[data-block-index="1"] .insert-button').click();
  await expect(page.getByText('添加 Block', { exact: true })).toBeVisible();
  await page.locator('.blocks-area').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.locator('.palette-item').filter({ hasText: '旁白' }).click();

  await expect(page.locator('.editor-title small')).toHaveText('7 Blocks');
  await expect(page.locator('[data-block-index="2"] .block-card.narration')).toBeVisible();
  await expect(page.locator('[data-block-index="2"] .block-text[contenteditable="true"]')).toBeFocused();
  await expect(page.locator('[data-block-index="2"]').locator('xpath=..')).toHaveClass(/block-just-inserted/);
  await expect.poll(() => page.evaluate(() => {
    const area = document.querySelector('.blocks-area')?.getBoundingClientRect();
    const row = document.querySelector('[data-block-index="2"]')?.getBoundingClientRect();
    return Boolean(area && row && row.top >= area.top && row.bottom <= area.bottom);
  })).toBe(true);
  await expect(page.locator('[data-block-index="3"] .block-card')).toContainText(originalThirdText?.trim() ?? '');

  await page.locator('[data-block-index="2"] .block-handle').focus();
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.editor-title small')).toHaveText('6 Blocks');
  await expect(page.locator('[data-block-index="2"] .block-card')).toContainText(originalThirdText?.trim() ?? '');

  await page.locator('[data-block-index="0"] .insert-button').click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('添加 Block', { exact: true })).toHaveCount(0);
  await expect(page.locator('.editor-title small')).toHaveText('6 Blocks');
});

test('chapter tree mounts only visible rows and can reach a distant Fragment', async ({ page }) => {
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');
  const fragmentCount = 120;
  await page.evaluate((count) => {
    const fragments = Array.from({ length: count }, (_, index) => ({ id: `virtual-fragment-${index}`, name: `Virtual Fragment ${index}` }));
    const scripts = Object.fromEntries(fragments.map((fragment) => [fragment.id, []]));
    localStorage.setItem('slide-structure-clipboard', `SLIDE_STRUCTURE_V1\n${JSON.stringify({ kind: 'chapter', chapter: { id: 'virtual-chapter', name: 'Virtual Chapter', fragments }, scripts, timelines: {} })}`);
  }, fragmentCount);

  await page.locator('.chapter-row').nth(1).click({ button: 'right' });
  await page.locator('.chapter-context-menu').getByRole('button', { name: '粘贴' }).click();
  await expect(page.locator('.chapter-row').getByText('Virtual Chapter', { exact: true })).toBeVisible();

  const mountedAtTop = await page.locator('.tree-virtual-row').count();
  expect(mountedAtTop).toBeLessThan(fragmentCount / 2);
  await page.locator('.tree-virtual-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByText(`Virtual Fragment ${fragmentCount - 1}`)).toBeVisible();
  expect(await page.locator('.tree-virtual-row').count()).toBeLessThan(fragmentCount / 2);
});

test('card and plain Block views virtualize measured rows across selection boundaries', async ({ page }) => {
  await page.goto('/?editor=1');
  await expect(page.locator('.save-state')).toContainText('已保存');
  const insertedBlocks = 250;
  await page.evaluate((count) => {
    const blocks = Array.from({ length: count }, (_, index) => ({ id: `clipboard-block-${index}`, type: 'narration', text: `Virtualized narration ${index}` }));
    localStorage.setItem('slide-block-clipboard', `SLIDE_BLOCKS_V1\n${JSON.stringify(blocks)}`);
  }, insertedBlocks);
  await page.locator('.blocks-area').focus();
  await page.keyboard.press('Control+V');
  await expect(page.locator('.editor-title small')).toHaveText(`${insertedBlocks + 6} Blocks`);

  expect(await page.locator('.virtual-block-row').count()).toBeLessThan(80);
  await page.locator('.blocks-area').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator(`[data-block-index="${insertedBlocks + 5}"]`)).toBeVisible();
  expect(await page.locator('.virtual-block-row').count()).toBeLessThan(80);

  await page.locator('.blocks-area').evaluate((element) => { element.scrollTop = 0; });
  await expect(page.locator('[data-block-index="0"]')).toBeVisible();
  await page.locator('[data-block-index="0"] .block-card').dispatchEvent('click');
  await expect(page.locator('[data-block-index="0"] .block-card')).toHaveClass(/selected/);
  await page.locator('.blocks-area').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => page.evaluate((index) => {
    const row = document.querySelector(`[data-block-index="${index}"]`)?.getBoundingClientRect();
    const composer = document.querySelector('.quick-composer')?.getBoundingClientRect();
    return row && composer ? Math.round(row.bottom - composer.top) : 9999;
  }, insertedBlocks + 5)).toBeLessThanOrEqual(0);
  await page.locator(`[data-block-index="${insertedBlocks + 5}"] .block-card`).dispatchEvent('click', { shiftKey: true });
  await page.locator('.block-card.selected').first().dispatchEvent('contextmenu');
  await expect(page.locator('.block-context-menu strong')).toHaveText(`已选择 ${insertedBlocks + 6} 个 Block`);

  await page.getByRole('button', { name: '纯文本' }).click();
  await page.locator('.plain-script-editor').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator(`[data-block-index="${insertedBlocks + 5}"]`)).toBeVisible();
  expect(await page.locator('.virtual-plain-row').count()).toBeLessThan(100);
});
