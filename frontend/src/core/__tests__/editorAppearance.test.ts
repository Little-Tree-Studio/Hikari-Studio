import { describe, expect, it } from 'vitest';
import { accentVariables, normalizeEditorAppearance, resolveEditorTheme, resolveReducedMotion } from '../editorAppearance';

describe('editor appearance', () => {
  it('normalizes invalid configuration', () => {
    expect(normalizeEditorAppearance({ themeId: 'missing' as never, accentColor: 'red' })).toEqual({ version: 1, mode: 'system', themeId: 'slide-light', motion: 'system' });
  });
  it('follows system theme only in system mode', () => {
    expect(resolveEditorTheme(normalizeEditorAppearance(null), true)).toBe('graphite');
    expect(resolveEditorTheme(normalizeEditorAppearance({ mode: 'fixed', themeId: 'sakura-studio' }), true)).toBe('sakura-studio');
  });
  it('resolves reduced motion policy', () => {
    expect(resolveReducedMotion(normalizeEditorAppearance({ motion: 'system' }), true)).toBe(true);
    expect(resolveReducedMotion(normalizeEditorAppearance({ motion: 'full' }), true)).toBe(false);
  });
  it('derives semantic accent colors', () => {
    const variables = accentVariables('#187c6b', false) as Record<string, string>;
    expect(variables['--accent']).toBe('#187c6b');
    expect(variables['--accent-soft']).toMatch(/^#[0-9a-f]{6}$/);
  });
});
