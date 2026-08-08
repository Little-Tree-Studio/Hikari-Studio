import { describe, expect, it } from 'vitest';
import { characterWidthCss, dimensionCss } from '../stageLayout';

describe('stage character dimensions', () => {
  it('uses a visible default width when no portrait width is configured', () => {
    expect(characterWidthCss(undefined)).toBe('28%');
    expect(characterWidthCss({ unit: '%', value: undefined })).toBe('28%');
  });

  it('preserves explicit pixel and percentage dimensions', () => {
    expect(characterWidthCss({ unit: '%', value: 36 })).toBe('36%');
    expect(characterWidthCss({ unit: 'px', value: 420 })).toBe('420px');
    expect(dimensionCss({ unit: 'px', value: 680 })).toBe('680px');
  });
});
