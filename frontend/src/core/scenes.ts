import type { Project, SceneDefinition, SceneLayer } from '../types';

export function projectScenes(project: Project): SceneDefinition[] {
  if (project.scenes?.length) return project.scenes;
  return project.assets
    .filter((asset) => asset.kind === 'scene')
    .map((asset) => ({
      id: `scene-${asset.id}`,
      name: asset.name,
      layers: [{ id: `layer-${asset.id}`, name: '背景', assetId: asset.id, opacity: 1, blendMode: 'normal', offsetX: 0, offsetY: 0, scale: 1, distance: 1 }],
    }));
}

export function sceneBlockSnapshot(scene: SceneDefinition) {
  const bottom = scene.layers.at(-1);
  const overlays: SceneLayer[] = scene.layers.slice(0, -1).map((layer, index) => ({
    id: layer.id,
    name: layer.name,
    assetId: layer.assetId,
    opacity: layer.visible === false ? 0 : layer.opacity,
    blendMode: layer.blendMode,
    x: 50 + layer.offsetX,
    y: 50 + layer.offsetY,
    scale: layer.scale,
    layer: scene.layers.length - index,
    distance: layer.distance,
  }));
  return { sceneId: scene.id, title: scene.name, assetId: bottom?.assetId, layers: overlays };
}

export function synchronizeSceneBlocks(project: Project, scene: SceneDefinition): Project {
  const snapshot = sceneBlockSnapshot(scene);
  return {
    ...project,
    scripts: Object.fromEntries(Object.entries(project.scripts).map(([fragmentId, blocks]) => [fragmentId, blocks.map((block) => block.type === 'scene' && (block.sceneId === scene.id || (!block.sceneId && block.assetId === snapshot.assetId)) ? { ...block, ...snapshot } : block)])),
  };
}
