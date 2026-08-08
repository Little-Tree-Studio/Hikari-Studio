import { expect, test, type Page } from '@playwright/test';
import { encodeSaveData } from '../src/core/saveGames';
import { getBlockConformanceCase } from '../src/engine-core/blockConformance';
import { createEngineState, createSaveGame } from '../src/engine-core/runtime';
import type { SaveGame } from '../src/engine-core/types';

const project = getBlockConformanceCase('narration')!.project;
const primaryKey = (slotId: string) => `hikari-save:${project.meta.id}:${slotId}`;

async function seedRuntimeStorage(page: Page, values: Record<string, string>) {
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
  }, values);
}

async function openLoadDialog(page: Page) {
  await page.goto('/runtime/?block-conformance=narration');
  await page.getByRole('button', { name: '读档', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '读取游戏' })).toBeVisible();
}

test('automatic save falls back to its verified backup and explains the recovery', async ({ page }) => {
  const backup = createSaveGame(project, createEngineState(project), 'auto', '自动存档', {
    slotId: 'auto',
    playTimeSeconds: 42,
    chapterName: 'Chapter',
    fragmentName: 'start',
  });
  await seedRuntimeStorage(page, {
    [primaryKey('auto')]: '{interrupted-auto-save',
    [`${primaryKey('auto')}:backup`]: encodeSaveData(backup),
  });

  await openLoadDialog(page);
  const autoSlot = page.locator('.save-slot-card').filter({ hasText: '自动存档' });
  await expect(autoSlot).toContainText('已恢复备份');
  await autoSlot.click();
  await page.getByRole('button', { name: '读取存档', exact: true }).click();
  await expect(page.locator('.game-notice')).toContainText('已从备份恢复');
});

test('legacy saves show migration status and preserve it in the load notice', async ({ page }) => {
  const current = createSaveGame(project, createEngineState(project), 'manual', '存档 01', { slotId: 'manual-1' });
  const legacyState = structuredClone(current.state) as Partial<SaveGame['state']>;
  delete legacyState.executionTrace;
  delete legacyState.traceCursor;
  const legacy = { ...current, engineVersion: 2, state: legacyState as SaveGame['state'] };
  await seedRuntimeStorage(page, { [primaryKey('manual-1')]: encodeSaveData(legacy) });

  await openLoadDialog(page);
  const manualSlot = page.locator('.save-slot-card').filter({ hasText: '存档 01' });
  await expect(manualSlot).toContainText('已迁移');
  await manualSlot.click();
  await page.getByRole('button', { name: '读取存档', exact: true }).click();
  await expect(page.locator('.game-notice')).toContainText('已迁移旧版存档');
});

test('foreign project saves are clearly identified and cannot be loaded', async ({ page }) => {
  const foreign = createSaveGame(project, createEngineState(project), 'quick', '快速存档', { slotId: 'quick' });
  await seedRuntimeStorage(page, {
    [primaryKey('quick')]: encodeSaveData({ ...foreign, projectId: 'another-project' }),
  });

  await openLoadDialog(page);
  const quickSlot = page.locator('.save-slot-card').filter({ hasText: '快速存档' });
  await expect(quickSlot).toContainText('其他项目的存档');
  await expect(quickSlot).toContainText('已阻止读取');
  await quickSlot.click();
  await expect(page.getByRole('button', { name: '读取存档', exact: true })).toBeDisabled();
});
