import type { BlockType, Project, StoryBlock } from '../types';
import type { BlockDefinition, BlockIssue, BlockSchemaField } from './types';

const id = () => `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const fragmentIds = (project: Project) => new Set(project.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => fragment.id)));

function define(type: BlockType, label: string, schema: Record<string, BlockSchemaField>, create: (project: Project) => StoryBlock, diagnose: (block: StoryBlock, project: Project) => BlockIssue[] = () => []): BlockDefinition {
  return { type, version: 1, label, schema, create, diagnose, migrate: (block) => ({ ...block, id: String(block.id || id()), type, version: 1 } as StoryBlock) };
}

const targetIssues = (block: StoryBlock, project: Project): BlockIssue[] => {
  const targets = block.type === 'branch' ? (block.options ?? []).map((option) => option.target) : block.type === 'condition' ? [block.trueTarget, block.falseTarget].filter(Boolean) as string[] : block.type === 'jump' || block.type === 'call' ? [block.target].filter(Boolean) as string[] : [];
  return targets.filter((target) => !fragmentIds(project).has(target)).map((target) => ({ severity: 'error', code: 'INVALID_TARGET', message: `目标片段不存在：${target}` }));
};

export const blockRegistry: Record<BlockType, BlockDefinition> = {
  narration: define('narration', '旁白', { text: { type: 'string', required: true } }, () => ({ id: id(), type: 'narration', version: 1, text: '在这里输入旁白...' }), (block) => block.type === 'narration' && !block.text?.trim() ? [{ severity: 'warning', code: 'EMPTY_TEXT', message: '旁白内容为空' }] : []),
  dialogue: define('dialogue', '角色对白', { speaker: { type: 'string', required: true }, text: { type: 'string', required: true }, expression: { type: 'string' } }, (project) => ({ id: id(), type: 'dialogue', version: 1, speaker: project.characters[0]?.name ?? '角色', text: '在这里输入对白...', expression: '默认' }), (block, project) => block.type === 'dialogue' && !project.characters.some((character) => character.name === block.speaker) ? [{ severity: 'warning', code: 'UNKNOWN_SPEAKER', message: `对白角色未登记：${block.speaker || '未设置'}` }] : []),
  scene: define('scene', '场景', { assetId: { type: 'string', required: true }, transition: { type: 'enum', values: ['none', 'fade', 'dissolve'] }, duration: { type: 'number' } }, (project) => { const scene = project.assets.find((asset) => asset.kind === 'scene'); return { id: id(), type: 'scene', version: 1, title: scene?.name ?? '选择场景', assetId: scene?.id, transition: 'dissolve', duration: 1 }; }, (block, project) => block.type === 'scene' && block.assetId && !project.assets.some((asset) => asset.id === block.assetId) ? [{ severity: 'error', code: 'MISSING_ASSET', message: `场景素材不存在：${block.assetId}` }] : []),
  sound: define('sound', '播放音频', { channel: { type: 'enum', values: ['bgm', 'sfx', 'voice'] }, action: { type: 'enum', values: ['play', 'stop'] }, title: { type: 'string' }, volume: { type: 'number' }, loop: { type: 'boolean' }, fadeDuration: { type: 'number' } }, () => ({ id: id(), type: 'sound', version: 1, title: '选择音频', channel: 'bgm', action: 'play', volume: 1, loop: false, fadeDuration: 0 })),
  characterShow: define('characterShow', '显示角色', { characterId: { type: 'string', required: true }, expression: { type: 'string' }, position: { type: 'enum', values: ['farLeft', 'left', 'center', 'right', 'farRight', 'custom'] }, layer: { type: 'number' } }, (project) => ({ id: id(), type: 'characterShow', version: 1, characterId: project.characters[0]?.id, expression: project.characters[0]?.expressions[0] ?? '默认', position: 'center', scale: 1, opacity: 1, layer: 0, animation: 'fade', duration: .3 }), (block, project) => block.type === 'characterShow' && !project.characters.some((character) => character.id === block.characterId) ? [{ severity: 'error', code: 'INVALID_CHARACTER', message: `角色不存在：${block.characterId || '未设置'}` }] : []),
  characterHide: define('characterHide', '隐藏角色', { characterId: { type: 'string', required: true }, animation: { type: 'enum', values: ['none', 'fade', 'slideLeft', 'slideRight', 'zoom'] } }, (project) => ({ id: id(), type: 'characterHide', version: 1, characterId: project.characters[0]?.id, animation: 'fade', duration: .3 }), (block, project) => block.type === 'characterHide' && !project.characters.some((character) => character.id === block.characterId) ? [{ severity: 'error', code: 'INVALID_CHARACTER', message: `角色不存在：${block.characterId || '未设置'}` }] : []),
  camera: define('camera', '镜头', { cameraX: { type: 'number' }, cameraY: { type: 'number' }, zoom: { type: 'number' }, shake: { type: 'number' }, filter: { type: 'enum', values: ['none', 'monochrome', 'sepia', 'blur', 'vignette'] } }, () => ({ id: id(), type: 'camera', version: 1, cameraX: 0, cameraY: 0, zoom: 1, rotation: 0, shake: 0, filter: 'none', duration: .4 })),
  branch: define('branch', '选项分支', { title: { type: 'string' }, options: { type: 'array', required: true } }, (project) => ({ id: id(), type: 'branch', version: 1, title: '新的选择', options: [{ text: '选项一', target: project.activeFragmentId }] }), targetIssues),
  setVariable: define('setVariable', '设置变量', { variable: { type: 'string', required: true }, value: { type: 'string' } }, (project) => ({ id: id(), type: 'setVariable', version: 1, variable: Object.keys(project.variables)[0] ?? '新变量', value: 0 })),
  modifyVariable: define('modifyVariable', '增减变量', { variable: { type: 'string', required: true }, operation: { type: 'enum', values: ['add', 'subtract', 'multiply', 'divide'] }, operand: { type: 'number', required: true } }, (project) => ({ id: id(), type: 'modifyVariable', version: 1, variable: Object.keys(project.variables)[0] ?? '新变量', operation: 'add', operand: 1 }), (block) => block.type === 'modifyVariable' && !Number.isFinite(block.operand) ? [{ severity: 'error', code: 'INVALID_OPERAND', message: '增减数值无效' }] : []),
  condition: define('condition', '条件判断', { variable: { type: 'string', required: true }, operator: { type: 'enum', values: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] }, compareValue: { type: 'string' }, compareVariable: { type: 'string' } }, (project) => ({ id: id(), type: 'condition', version: 1, variable: Object.keys(project.variables)[0] ?? '新变量', operator: 'eq', compareValue: 0, trueTarget: project.activeFragmentId }), targetIssues),
  jump: define('jump', '跳转片段', { target: { type: 'string', required: true } }, (project) => ({ id: id(), type: 'jump', version: 1, target: project.activeFragmentId }), targetIssues),
  call: define('call', '调用片段', { target: { type: 'string', required: true } }, (project) => ({ id: id(), type: 'call', version: 1, target: project.activeFragmentId }), targetIssues),
  return: define('return', '返回', {}, () => ({ id: id(), type: 'return', version: 1 })),
};

export function createBlock(type: BlockType, project: Project): StoryBlock {
  return blockRegistry[type].create(project);
}
