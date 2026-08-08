import type { Project } from '../types';
import { projectScenes } from './scenes';

export interface AssetReference {
  assetId: string;
  sourceType: 'script' | 'character' | 'scene' | 'ui';
  sourceId: string;
  sourceName: string;
  detail: string;
  fragmentId?: string;
  blockIndex?: number;
}

export interface MissingAssetReference extends Omit<AssetReference, 'assetId'> {
  assetId: string;
}

export interface AssetReferenceReport {
  references: Record<string, AssetReference[]>;
  missing: MissingAssetReference[];
  bundledIds: Set<string>;
  bundledSize: number;
}

export function analyzeAssetReferences(project: Project): AssetReferenceReport {
  const references: Record<string, AssetReference[]> = {};
  const missing: MissingAssetReference[] = [];
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const assetsByName = new Map(project.assets.flatMap((asset) => [[asset.name, asset], [asset.path.split(/[\\/]/).at(-1) ?? '', asset]]));
  const fragmentNames = new Map(project.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => [fragment.id, `${chapter.name} / ${fragment.name}`])));

  const add = (assetId: string | undefined, reference: Omit<AssetReference, 'assetId'>) => {
    if (!assetId) return;
    const item = { ...reference, assetId };
    if (!assetsById.has(assetId)) { missing.push(item); return; }
    (references[assetId] ??= []).push(item);
  };

  for (const [fragmentId, blocks] of Object.entries(project.scripts)) blocks.forEach((block, blockIndex) => {
    const base = { sourceType: 'script' as const, sourceId: block.id, sourceName: fragmentNames.get(fragmentId) ?? fragmentId, fragmentId, blockIndex };
    add(block.assetId, { ...base, detail: `${block.type} Block` });
    if (block.type === 'scene') for (const layer of block.layers ?? []) add(layer.assetId, { ...base, detail: `场景层：${layer.name}` });
    if (block.type === 'dialogue' && block.voice) {
      const voiceAsset = assetsById.get(block.voice) ?? assetsByName.get(block.voice);
      if (voiceAsset) add(voiceAsset.id, { ...base, detail: `语音：${block.voice}` });
      else missing.push({ ...base, assetId: block.voice, detail: `语音：${block.voice}` });
    }
  });

  for (const character of project.characters) {
    for (const [expression, assetId] of Object.entries(character.portraits ?? {})) {
      add(assetId, { sourceType: 'character', sourceId: character.id, sourceName: character.name, detail: `表情差分：${expression}` });
    }
    for (const overlay of character.overlays ?? []) {
      add(overlay.assetId, { sourceType: 'character', sourceId: character.id, sourceName: character.name, detail: `覆盖图层：${overlay.name}` });
    }
  }

  for (const scene of projectScenes(project)) for (const layer of scene.layers) {
    add(layer.assetId, { sourceType: 'scene', sourceId: scene.id, sourceName: scene.name, detail: `场景图层：${layer.name}` });
  }

  for (const [fragmentId, timeline] of Object.entries(project.timelines ?? {})) for (const track of timeline.tracks) for (const clip of track.clips) {
    add(clip.assetId, {
      sourceType: 'script',
      sourceId: clip.id,
      sourceName: fragmentNames.get(fragmentId) ?? fragmentId,
      fragmentId,
      detail: `时间轴：${track.name} / ${clip.name}`,
    });
  }

  add(project.ui?.title?.backgroundAssetId, { sourceType: 'ui', sourceId: 'ui-title', sourceName: '游戏 UI', detail: '标题背景' });
  add(project.ui?.title?.logoAssetId, { sourceType: 'ui', sourceId: 'ui-title', sourceName: '游戏 UI', detail: '标题 Logo' });
  add(project.ui?.runtimeTheme?.fontAssetId, { sourceType: 'ui', sourceId: 'ui-theme', sourceName: '游戏 UI', detail: '对白字体' });

  const bundledIds = new Set(project.assets.filter((asset) => asset.forceBundle || references[asset.id]?.length).map((asset) => asset.id));
  const bundledSize = project.assets.reduce((total, asset) => total + (bundledIds.has(asset.id) ? asset.size ?? 0 : 0), 0);
  return { references, missing, bundledIds, bundledSize };
}
