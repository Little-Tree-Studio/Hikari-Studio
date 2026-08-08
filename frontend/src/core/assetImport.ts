import type { Asset, AudioCategory, Project } from '../types';

export type ImageImportPurpose = 'library' | 'characters' | 'expressions' | 'scenes';

export interface EditorImportAction {
  imagePurpose?: ImageImportPurpose;
  characterId?: string;
  audioCategory?: AudioCategory;
  voiceCharacterId?: string;
}

export interface AssetImportResult {
  project: Project;
  importedAssets: Asset[];
  createdCharacters: number;
  createdScenes: number;
  addedExpressions: number;
}

export const isImportedImage = (asset: Asset) => ['image', 'scene', 'character'].includes(asset.kind);

const uniqueName = (requested: string, used: Set<string>) => {
  const base = requested.trim() || '未命名';
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
};

const defaultMakeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export function applyAssetImport(
  project: Project,
  assets: Asset[],
  action: EditorImportAction,
  makeId: (prefix: string) => string = defaultMakeId,
): AssetImportResult {
  const images = assets.filter(isImportedImage);
  const audio = assets.filter((asset) => asset.kind === 'audio');
  if (images.length && !action.imagePurpose) throw new Error('请选择图片用途');
  if (audio.length && !action.audioCategory) throw new Error('请选择音频用途');
  if (images.length && action.imagePurpose === 'expressions' && !project.characters.some((item) => item.id === action.characterId)) {
    throw new Error('请选择要添加表情的角色');
  }

  const imageKind = action.imagePurpose === 'characters' || action.imagePurpose === 'expressions'
    ? 'character'
    : action.imagePurpose === 'scenes' ? 'scene' : 'image';
  const importedAssets = assets.map((asset): Asset => {
    if (isImportedImage(asset)) return { ...asset, kind: imageKind };
    if (asset.kind !== 'audio') return asset;
    const voice = action.audioCategory === 'voice';
    return {
      ...asset,
      audioCategory: action.audioCategory,
      voiceCharacterId: voice ? action.voiceCharacterId || undefined : undefined,
      asrStatus: voice ? asset.asrStatus ?? 'pending' : asset.asrStatus,
    };
  });
  const normalizedImages = importedAssets.filter(isImportedImage);
  const next: Project = {
    ...project,
    assets: [...project.assets, ...importedAssets],
    characters: project.characters.map((character) => ({
      ...character,
      expressions: [...character.expressions],
      portraits: { ...(character.portraits ?? {}) },
    })),
    scenes: [...(project.scenes ?? [])],
  };

  let createdCharacters = 0;
  let createdScenes = 0;
  let addedExpressions = 0;
  if (action.imagePurpose === 'characters') {
    const usedNames = new Set(next.characters.map((character) => character.name));
    for (const asset of normalizedImages) {
      const name = uniqueName(asset.name, usedNames);
      next.characters.push({
        id: makeId('character'),
        name,
        color: '#397d70',
        expressions: ['默认'],
        portraits: { 默认: asset.id },
        defaultScale: 1,
        defaultPosition: 'center',
      });
      createdCharacters += 1;
    }
  } else if (action.imagePurpose === 'scenes') {
    const usedNames = new Set(next.scenes?.map((scene) => scene.name));
    for (const asset of normalizedImages) {
      next.scenes!.push({
        id: makeId('scene'),
        name: uniqueName(asset.name, usedNames),
        layers: [{
          id: makeId('layer'),
          name: '背景',
          assetId: asset.id,
          opacity: 1,
          blendMode: 'normal',
          offsetX: 0,
          offsetY: 0,
          scale: 1,
          distance: 1,
        }],
      });
      createdScenes += 1;
    }
  } else if (action.imagePurpose === 'expressions') {
    const character = next.characters.find((item) => item.id === action.characterId)!;
    const usedNames = new Set(character.expressions);
    for (const asset of normalizedImages) {
      const name = uniqueName(asset.name.replace(/\.[^.]+$/, '') || '表情', usedNames);
      character.expressions.push(name);
      character.portraits![name] = asset.id;
      addedExpressions += 1;
    }
  }

  return { project: next, importedAssets, createdCharacters, createdScenes, addedExpressions };
}

export function describeAssetImport(result: AssetImportResult): string {
  const details: string[] = [`${result.importedAssets.length} 个素材`];
  if (result.createdCharacters) details.push(`${result.createdCharacters} 个角色`);
  if (result.createdScenes) details.push(`${result.createdScenes} 个场景`);
  if (result.addedExpressions) details.push(`${result.addedExpressions} 个表情`);
  return `已导入 ${details.join('，')}`;
}
