import { describe, expect, it } from 'vitest';
import type { ConditionBlock, StoryBlock } from '../../types';
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

  it("Ren'Py round-trip 保留增减变量块的运算与数值", () => {
    const variableBlocks: StoryBlock[] = [
      { id: 'm1', type: 'modifyVariable', variable: '好感度', operation: 'add', operand: 2 },
      { id: 'm2', type: 'modifyVariable', variable: '理智', operation: 'subtract', operand: 5 },
      { id: 'm3', type: 'modifyVariable', variable: '倍率', operation: 'multiply', operand: 1.5 },
      { id: 'm4', type: 'modifyVariable', variable: '门票', operation: 'divide', operand: 2 },
    ];
    const parsed = parseRenpyBlocks(serializeRenpy(variableBlocks), variableBlocks);
    expect(parsed.map((block) => [block.type, block.variable])).toEqual([
      ['modifyVariable', '好感度'],
      ['modifyVariable', '理智'],
      ['modifyVariable', '倍率'],
      ['modifyVariable', '门票'],
    ]);
    expect(parsed.map((block) => block.type === 'modifyVariable' ? [block.operation, block.operand] : null)).toEqual([
      ['add', 2],
      ['subtract', 5],
      ['multiply', 1.5],
      ['divide', 2],
    ]);
  });

  it("Ren'Py 设置变量保留标量类型（数字、布尔、字符串）", () => {
    const variableBlocks: StoryBlock[] = [
      { id: 's1', type: 'setVariable', variable: '分数', value: 10 },
      { id: 's2', type: 'setVariable', variable: '已解锁', value: true },
      { id: 's3', type: 'setVariable', variable: '心情', value: '晴天' },
      { id: 's4', type: 'setVariable', variable: '编号', value: '3' },
    ];
    const parsed = parseRenpyBlocks(serializeRenpy(variableBlocks), variableBlocks);
    expect(parsed.map((block) => block.type === 'setVariable' ? block.value : null)).toEqual([10, true, '晴天', '3']);
  });

  it("Ren'Py round-trip 保留条件判断的目标、运算符与比较对象", () => {
    const conditionBlocks: StoryBlock[] = [
      { id: 'c1', type: 'condition', variable: '好感度', operator: 'gte', compareValue: 10, trueTarget: 'good-end', falseTarget: 'bad-end' },
      { id: 'c2', type: 'condition', variable: '心情', operator: 'eq', compareValue: '晴天', trueTarget: 'sunny' },
      { id: 'c3', type: 'condition', variable: '分数', operator: 'lt', compareVariable: '目标分', falseTarget: 'retry' },
    ];
    const text = serializeRenpy(conditionBlocks);
    expect(text.split('\n')).toEqual([
      'if 好感度 >= 10 jump good-end else jump bad-end',
      'if 心情 == "晴天" jump sunny',
      'if 分数 < $目标分 else jump retry',
    ]);
    const parsed = parseRenpyBlocks(text, conditionBlocks);
    expect(parsed[0]).toMatchObject({ type: 'condition', variable: '好感度', operator: 'gte', compareValue: 10, trueTarget: 'good-end', falseTarget: 'bad-end' });
    expect(parsed[1]).toMatchObject({ type: 'condition', variable: '心情', operator: 'eq', compareValue: '晴天', trueTarget: 'sunny' });
    expect(parsed[2]).toMatchObject({ type: 'condition', variable: '分数', operator: 'lt', compareVariable: '目标分', falseTarget: 'retry' });
  });

  it("Ren'Py 解析 if 行时清除不再存在的跳转目标", () => {
    const oldBlocks: StoryBlock[] = [{ id: 'c1', type: 'condition', variable: '好感度', operator: 'gte', compareValue: 10, trueTarget: 'good-end', falseTarget: 'bad-end' }];
    const parsed = parseRenpyBlocks('if 好感度 >= 10', oldBlocks);
    expect((parsed[0] as ConditionBlock).trueTarget).toBeUndefined();
    expect((parsed[0] as ConditionBlock).falseTarget).toBeUndefined();
  });

  it("Ren'Py 在比较变量与常量之间切换时不残留旧比较对象", () => {
    const withVariable: StoryBlock[] = [{ id: 'c1', type: 'condition', variable: '分数', operator: 'lt', compareVariable: '目标分', falseTarget: 'retry' }];
    const toConstant = parseRenpyBlocks('if 分数 < 5', withVariable);
    expect((toConstant[0] as ConditionBlock).compareVariable).toBeUndefined();
    expect((toConstant[0] as ConditionBlock).compareValue).toBe(5);
    const toVariable = parseRenpyBlocks('if 分数 < $目标分', toConstant);
    expect((toVariable[0] as ConditionBlock).compareVariable).toBe('目标分');
    expect((toVariable[0] as ConditionBlock).compareValue).toBeUndefined();
  });

  it('formatRenpyText 规范化增减变量与条件判断行', () => {
    const messy = '$  好感度   +=   2\nif   好感度   ==  10     jump   good-end    else   jump  bad-end\nif  分数  <=  $目标分';
    expect(formatRenpyText(messy).split('\n')).toEqual([
      '$ 好感度 += 2',
      'if 好感度 == 10 jump good-end else jump bad-end',
      'if 分数 <= $目标分',
    ]);
  });
});
