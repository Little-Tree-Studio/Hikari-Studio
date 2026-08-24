import { describe, expect, it } from 'vitest';
import type { StoryBlock } from '../../types';
import { parsePlainBlocks, parseRenpyBlocks, serializePlain, serializeRenpy } from '../scriptTextCodec';

const blocks: StoryBlock[] = [
  { id: 'b1', type: 'scene', title: '晨雾湖畔', assetId: 'lake', transition: 'dissolve', duration: 1.2, layers: [{ id: 'l1', name: '背景', opacity: 1, blendMode: 'normal', x: 0, y: 0, scale: 1, layer: 0 }] },
  { id: 'b2', type: 'dialogue', speaker: '林澄', text: '你来了。', expression: '微笑', voice: 'v1', displayNameSchemeId: 'd1' },
  { id: 'b3', type: 'narration', text: '风吹过湖面。' },
  { id: 'b4', type: 'branch', title: '如何回应？', options: [{ text: '相信她', target: 'opening' }, { text: '离开', target: 'old-school' }] },
  { id: 'b5', type: 'setVariable', variable: '好感度', value: 3 },
];

describe('scriptTextCodec', () => {
  it('纯文本 round-trip 保留对白的表情、语音与显示名方案', () => {
    const text = serializePlain(blocks);
    const parsed = parsePlainBlocks(text, blocks);
    const dialogue = parsed[1];
    expect(dialogue.type).toBe('dialogue');
    expect(dialogue.expression).toBe('微笑');
    expect(dialogue.voice).toBe('v1');
    expect(dialogue.displayNameSchemeId).toBe('d1');
    expect(dialogue.id).toBe('b2');
  });

  it('纯文本 round-trip 保留非文本 Block（场景、分支、变量）', () => {
    const text = serializePlain(blocks);
    const parsed = parsePlainBlocks(text, blocks);
    expect(parsed[0].type).toBe('scene');
    expect((parsed[0] as { layers?: unknown[] }).layers).toHaveLength(1);
    expect(parsed[3].type).toBe('branch');
    expect((parsed[3] as { options?: unknown[] }).options).toHaveLength(2);
    expect(parsed[4].type).toBe('setVariable');
  });

  it("Ren'Py round-trip 保留对白的表情、语音与中文角色名", () => {
    const text = serializeRenpy(blocks);
    const parsed = parseRenpyBlocks(text, blocks);
    const dialogue = parsed[1];
    expect(dialogue.type).toBe('dialogue');
    expect(dialogue.speaker).toBe('林澄');
    expect(dialogue.expression).toBe('微笑');
    expect(dialogue.voice).toBe('v1');
  });

  it("Ren'Py round-trip 保留分支选项与场景图层", () => {
    const text = serializeRenpy(blocks);
    const parsed = parseRenpyBlocks(text, blocks);
    expect(parsed[0].type).toBe('scene');
    expect((parsed[0] as { layers?: unknown[] }).layers).toHaveLength(1);
    expect(parsed[3].type).toBe('branch');
    expect((parsed[3] as { options?: unknown[] }).options).toHaveLength(2);
    expect(parsed[4].type).toBe('setVariable');
  });
});
