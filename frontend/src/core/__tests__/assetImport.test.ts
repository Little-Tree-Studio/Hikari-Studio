import { describe, expect, it } from 'vitest';
import { applyAssetImport } from '../assetImport';
import type { Asset, Project } from '../../types';

const project = (): Project => ({
  version: 3,
  meta: { id: 'project', name: 'Import test', author: '', resolution: [1280, 720], updatedAt: '' },
  characters: [{ id: 'hero', name: 'Hero', color: '#123456', expressions: ['smile'], portraits: { smile: 'old-smile' } }],
  scenes: [],
  chapters: [{ id: 'start', name: 'Start', fragments: [{ id: 'opening', name: 'Opening' }] }],
  activeFragmentId: 'opening',
  scripts: { opening: [] },
  assets: [],
  variables: {},
  settings: { textSpeed: 35, autoSave: true, skipRead: true },
});

const image = (id: string, name = id): Asset => ({ id, kind: 'image', name, path: `${name}.png` });
const makeId = (() => {
  let index = 0;
  return (prefix: string) => `${prefix}-${++index}`;
})();

describe('asset import binding', () => {
  it('creates characters and binds each image as its default portrait', () => {
    const source = project();
    const result = applyAssetImport(source, [image('a', 'Hero'), image('b', 'Rin')], { imagePurpose: 'characters' }, makeId);

    expect(result.createdCharacters).toBe(2);
    expect(result.project.assets.map((asset) => asset.kind)).toEqual(['character', 'character']);
    expect(result.project.characters.slice(1).map((character) => character.name)).toEqual(['Hero_1', 'Rin']);
    expect(result.project.characters[1].portraits).toEqual({ 默认: 'a' });
    expect(source.characters).toHaveLength(1);
    expect(source.assets).toHaveLength(0);
  });

  it('creates single-layer scenes and classifies mixed audio independently', () => {
    const result = applyAssetImport(project(), [
      image('lake', 'Lake'),
      { id: 'bell', kind: 'audio', name: 'Bell', path: 'bell.wav' },
    ], { imagePurpose: 'scenes', audioCategory: 'sfx' }, makeId);

    expect(result.createdScenes).toBe(1);
    expect(result.project.assets.find((asset) => asset.id === 'lake')?.kind).toBe('scene');
    expect(result.project.assets.find((asset) => asset.id === 'bell')?.audioCategory).toBe('sfx');
    expect(result.project.scenes?.[0].layers[0].assetId).toBe('lake');
  });

  it('adds unique expressions and binds voice files to a character', () => {
    const result = applyAssetImport(project(), [
      image('new-smile', 'smile'),
      { id: 'voice', kind: 'audio', name: 'Line 1', path: 'line-1.ogg' },
    ], {
      imagePurpose: 'expressions',
      characterId: 'hero',
      audioCategory: 'voice',
      voiceCharacterId: 'hero',
    }, makeId);

    expect(result.addedExpressions).toBe(1);
    expect(result.project.characters[0].expressions).toEqual(['smile', 'smile_1']);
    expect(result.project.characters[0].portraits?.smile_1).toBe('new-smile');
    expect(result.project.assets.find((asset) => asset.id === 'voice')).toMatchObject({
      audioCategory: 'voice',
      voiceCharacterId: 'hero',
      asrStatus: 'pending',
    });
  });

  it('requires an explicit purpose for every imported media category', () => {
    expect(() => applyAssetImport(project(), [image('a')], {}, makeId)).toThrow('请选择图片用途');
    expect(() => applyAssetImport(project(), [{ id: 'a', kind: 'audio', name: 'A', path: 'a.ogg' }], {}, makeId)).toThrow('请选择音频用途');
    expect(() => applyAssetImport(project(), [image('a')], { imagePurpose: 'expressions', characterId: 'missing' }, makeId)).toThrow('请选择要添加表情的角色');
  });

  it('keeps explicitly imported general images as library assets', () => {
    const result = applyAssetImport(project(), [image('cg')], { imagePurpose: 'library' }, makeId);
    expect(result.project.assets[0].kind).toBe('image');
    expect(result.createdCharacters + result.createdScenes + result.addedExpressions).toBe(0);
  });
});
