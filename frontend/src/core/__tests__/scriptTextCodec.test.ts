import { describe, expect, it } from 'vitest';
import type { StoryBlock } from '../../types';
import { formatJsonBlocksText, formatRenpyText, parsePlainBlocks, parseRenpyBlocks, serializePlain, serializeRenpy } from '../scriptTextCodec';

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

  it('formatRenpyText 规范化指令行空白并保留对白内容', () => {
    const messy = '  scene   晨雾湖畔  \n\tjump    opening\nplay   bgm    "lake.ogg"\n$  好感度   =   3\n林澄    "你 来了。"\n  " 风吹过湖面。 "\n# characterShow';
    const formatted = formatRenpyText(messy);
    expect(formatted.split('\n')).toEqual([
      'scene 晨雾湖畔',
      'jump opening',
      'play bgm "lake.ogg"',
      '$ 好感度 = 3',
      '林澄 "你 来了。"',
      '" 风吹过湖面。 "',
      '# characterShow',
    ]);
  });

  it('formatRenpyText 不删除无法识别的行', () => {
    const text = 'pause 1\n  完全未知的指令 abc\nreturn';
    const formatted = formatRenpyText(text);
    expect(formatted.split('\n')).toHaveLength(3);
    expect(formatted).toContain('完全未知的指令 abc');
    expect(formatted).toContain('pause 1');
  });

  it('formatJsonBlocksText 输出 2 空格缩进并对非法 JSON 抛错', () => {
    const compact = JSON.stringify(blocks);
    const formatted = formatJsonBlocksText(compact);
    expect(formatted).toContain('\n  {\n    "id": "b1"');
    expect(JSON.parse(formatted)).toHaveLength(5);
    expect(() => formatJsonBlocksText('{ "blocks": ')).toThrow();
    expect(() => formatJsonBlocksText('{"a":1}')).toThrow('JSON 必须是 Block 数组或包含 blocks 数组的对象');
  });
});
