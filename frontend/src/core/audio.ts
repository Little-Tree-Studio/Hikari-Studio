import type { Asset, AudioCategory, Project } from '../types';

export const audioCategoryOf = (asset: Asset): AudioCategory => asset.audioCategory ?? 'bgm';

export function normalizeDialogueText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function textSimilarity(left: string, right: string): number {
  const a = normalizeDialogueText(left);
  const b = normalizeDialogueText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length === 1 || b.length === 1) return a === b ? 1 : 0;
  const pairs = (value: string) => Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
  const remaining = pairs(b);
  let overlap = 0;
  for (const pair of pairs(a)) {
    const index = remaining.indexOf(pair);
    if (index >= 0) { overlap += 1; remaining.splice(index, 1); }
  }
  return (2 * overlap) / (a.length + b.length - 2);
}

export function matchingVoice(project: Project, text: string, characterId?: string): { asset?: Asset; score: number } {
  let best: Asset | undefined;
  let score = 0;
  for (const asset of project.assets) {
    if (asset.kind !== 'audio' || audioCategoryOf(asset) !== 'voice' || !asset.asrText) continue;
    if (characterId && asset.voiceCharacterId !== characterId) continue;
    const current = textSimilarity(text, asset.asrText);
    if (current > score) { best = asset; score = current; }
  }
  return { asset: best, score };
}
