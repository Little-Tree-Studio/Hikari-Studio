import type { CharacterDimension } from '../types';

export function dimensionCss(dimension: CharacterDimension | undefined): string | undefined {
  return dimension?.value === undefined ? undefined : `${dimension.value}${dimension.unit}`;
}

export function characterWidthCss(dimension: CharacterDimension | undefined): string {
  return dimensionCss(dimension) ?? '28%';
}
