import type { ConditionOperator, StoryBlock, VariableOperation } from '../types';

const quote = (value: unknown) => JSON.stringify(String(value ?? ''));
const makeId = (index: number) => `block-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`;

export const CONDITION_OPERATOR_SYMBOLS: Record<ConditionOperator, string> = { eq: '==', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
export const CONDITION_SYMBOL_OPERATORS: Record<string, ConditionOperator> = Object.fromEntries(Object.entries(CONDITION_OPERATOR_SYMBOLS).map(([operator, symbol]) => [symbol, operator as ConditionOperator]));
export const VARIABLE_OPERATION_SYMBOLS: Record<VariableOperation, string> = { add: '+=', subtract: '-=', multiply: '*=', divide: '/=' };
export const VARIABLE_SYMBOL_OPERATIONS: Record<string, VariableOperation> = Object.fromEntries(Object.entries(VARIABLE_OPERATION_SYMBOLS).map(([operation, symbol]) => [symbol, operation as VariableOperation]));

/** 文本视图中标量的显示形式：布尔与数字原样，字符串加引号。 */
export function formatRenpyScalar(value: string | number | boolean | undefined): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value ?? '');
}

/** 解析文本视图中的标量字面量：引号字符串、布尔、数字，其余按原始字符串处理。 */
export function parseRenpyScalar(token: string): string | number | boolean {
  if (/^".*"$/.test(token)) { try { return JSON.parse(token) as string; } catch { return token.slice(1, -1); } }
  if (/^'.*'$/.test(token)) return token.slice(1, -1);
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token.trim() !== '' && Number.isFinite(Number(token))) return Number(token);
  return token;
}

export interface RenpySetLine { variable: string; operation?: VariableOperation; rawValue: string; value?: string | number | boolean }

const SET_LINE = /^\$\s*([^\s=]+)\s*([+\-*/]?=)\s*(.+)$/;
const CONDITION_LINE = /^if\s+([^\s=!<>"']+)\s*(==|!=|>=|<=|>|<)\s*(\$[^\s]+|"[^"]*"|'[^']*'|[^\s]+)\s*(?:jump\s+(\S+))?\s*(?:else\s+(?:jump\s+)?(\S+))?$/;

/** 解析 `$ 变量 = 值` / `$ 变量 += 值` 行；parseValue 为 true 时把字面量转成布尔/数字。 */
export function parseRenpySetLine(line: string, parseValue = false): RenpySetLine | null {
  const match = SET_LINE.exec(line);
  if (!match) return null;
  const result: RenpySetLine = { variable: match[1], rawValue: match[3].trim() };
  if (match[2] === '=') return parseValue ? { ...result, value: parseRenpyScalar(result.rawValue) } : result;
  const operation = VARIABLE_SYMBOL_OPERATIONS[match[2]];
  return operation ? { ...result, operation } : null;
}

export interface RenpyConditionLine { variable: string; operator: ConditionOperator; compareVariable?: string; compareValue?: string | number | boolean; trueTarget?: string; falseTarget?: string }

/** 解析 `if 变量 >= 值 jump 片段 else jump 片段` 行；`$前缀` 表示与另一个变量比较。 */
export function parseRenpyConditionLine(line: string): RenpyConditionLine | null {
  const match = CONDITION_LINE.exec(line);
  if (!match) return null;
  const operator = CONDITION_SYMBOL_OPERATORS[match[2]] ?? 'eq';
  const valueToken = match[3];
  const result: RenpyConditionLine = { variable: match[1], operator };
  if (valueToken.startsWith('$')) result.compareVariable = valueToken.slice(1);
  else result.compareValue = parseRenpyScalar(valueToken);
  if (match[4]) result.trueTarget = match[4];
  if (match[5]) result.falseTarget = match[5];
  return result;
}

/**
 * 合并旧 Block 的字段，仅用新解析出的字段覆盖可编辑部分。
 * 这样文本视图（纯文本 / Ren'Py）无法表达的信息（表情、语音、分支选项、
 * 场景图层等）不会被丢弃，round-trip 不再损坏数据。
 */
const mergeBlock = (old: StoryBlock | undefined, index: number, patch: Partial<StoryBlock>): StoryBlock => {
  const base: Record<string, unknown> = old ? { ...old } : {};
  return { ...base, id: old?.id ?? makeId(index), ...patch } as StoryBlock;
};

export function serializeRenpy(blocks: StoryBlock[]): string {
  // 每个 Block 恰好输出一行，保证行索引与 Block 索引对齐，
  // 避免 branch 展开成多行后解析错位、丢失块。
  return blocks.map((block) => {
    switch (block.type) {
      case 'dialogue': return `${block.speaker ?? 'narrator'} ${quote(block.text)}`;
      case 'narration': return `    ${quote(block.text)}`;
      case 'scene': return `scene ${block.title ?? ''}`.trim();
      case 'sound': return `${block.action === 'stop' ? 'stop' : 'play'} ${block.channel ?? 'sfx'} ${quote(block.title ?? '')}`;
      case 'jump': return `jump ${block.target ?? ''}`.trim();
      case 'call': return `call ${block.target ?? ''}`.trim();
      case 'return': return 'return';
      case 'branch': return `menu ${quote(block.title ?? '选择')}`;
      case 'setVariable': return `$ ${block.variable ?? ''} = ${formatRenpyScalar(block.value)}`.trim();
      case 'modifyVariable': return `$ ${block.variable ?? ''} ${VARIABLE_OPERATION_SYMBOLS[block.operation ?? 'add']} ${Number.isFinite(block.operand) ? block.operand : 1}`.trim();
      case 'condition': {
        const value = block.compareVariable ? `$${block.compareVariable}` : formatRenpyScalar(block.compareValue);
        const parts = [`if ${block.variable ?? ''} ${CONDITION_OPERATOR_SYMBOLS[block.operator ?? 'eq']} ${value}`];
        if (block.trueTarget) parts.push(`jump ${block.trueTarget}`);
        if (block.falseTarget) parts.push(`else jump ${block.falseTarget}`);
        return parts.join(' ');
      }
      default: return `# ${block.type}`;
    }
  }).join('\n');
}

export function serializePlain(blocks: StoryBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'dialogue') return `${block.speaker ?? ''}：${block.text ?? ''}`;
    if (block.type === 'narration') return block.text ?? '';
    // 纯文本视图无法表达的非文本 Block 用注释占位，解析时原样保留。
    return `# ${block.type}`;
  }).join('\n');
}

export function parseJsonBlocks(text: string): StoryBlock[] {
  const payload = JSON.parse(text) as unknown;
  const source = Array.isArray(payload) ? payload : (payload && typeof payload === 'object' && 'blocks' in payload && Array.isArray(payload.blocks) ? payload.blocks : null);
  if (!source) throw new Error('JSON 必须是 Block 数组或包含 blocks 数组的对象');
  return source.map((item, index) => {
    if (!item || typeof item !== 'object' || !('type' in item)) throw new Error(`JSON 第 ${index + 1} 项缺少 type`);
    return { ...(item as StoryBlock), id: (item as StoryBlock).id || makeId(index) };
  });
}

/** JSON 视图的一键整理：校验结构后按 2 空格缩进重新输出。 */
export function formatJsonBlocksText(text: string): string {
  return JSON.stringify(parseJsonBlocks(text), null, 2);
}

/**
 * Ren'Py 视图的一键整理：规范化已知指令行的空白与引号，
 * 无法识别的行仅去除首尾空白，绝不删除任何内容。
 */
export function formatRenpyText(text: string): string {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return trimmed;
    for (const keyword of ['jump', 'call', 'scene', 'menu']) {
      if (trimmed === keyword) return trimmed;
      if (trimmed.startsWith(`${keyword} `)) return `${keyword} ${trimmed.slice(keyword.length).trim()}`;
    }
    const sound = /^(play|stop)\s+(\S+)\s*(.*)$/.exec(trimmed);
    if (sound) return `${sound[1]} ${sound[2]} ${sound[3]}`.trimEnd();
    if (trimmed === 'return') return 'return';
    const set = parseRenpySetLine(trimmed);
    if (set) {
      const symbol = set.operation ? VARIABLE_OPERATION_SYMBOLS[set.operation] : '=';
      return `$ ${set.variable} ${symbol} ${set.rawValue}`.trimEnd();
    }
    if (trimmed.startsWith('$')) return `$ ${trimmed.slice(1).trim()}`;
    const condition = parseRenpyConditionLine(trimmed);
    if (condition) {
      const value = condition.compareVariable ? `$${condition.compareVariable}` : formatRenpyScalar(condition.compareValue);
      const parts = [`if ${condition.variable} ${CONDITION_OPERATOR_SYMBOLS[condition.operator]} ${value}`];
      if (condition.trueTarget) parts.push(`jump ${condition.trueTarget}`);
      if (condition.falseTarget) parts.push(`else jump ${condition.falseTarget}`);
      return parts.join(' ');
    }
    const dialogue = /^([^\s"']+)\s+(["'])(.*)\2\s*$/.exec(trimmed);
    if (dialogue) return `${dialogue[1]} ${dialogue[2]}${dialogue[3]}${dialogue[2]}`;
    return trimmed;
  }).join('\n');
}

export function parsePlainBlocks(text: string, oldBlocks: StoryBlock[]): StoryBlock[] {
  return text.split(/\r?\n/).map((line, index) => {
    const old = oldBlocks[index];
    const trimmed = line.trim();
    // 注释行是非文本 Block 的占位，保留旧 Block（不把它降级成旁白）。
    if (trimmed.startsWith('#')) {
      return old ?? mergeBlock(undefined, index, { type: 'narration', text: '' });
    }
    const match = /^([^：:]{1,60})[：:]\s*(.*)$/.exec(trimmed);
    if (match) return mergeBlock(old, index, { type: 'dialogue', speaker: match[1].trim(), text: match[2] });
    return mergeBlock(old, index, { type: 'narration', text: line });
  });
}

export function parseRenpyBlocks(text: string, oldBlocks: StoryBlock[]): StoryBlock[] {
  const result: StoryBlock[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const old = oldBlocks[index];

    // 注释行（非文本 Block 的占位）：原样保留旧 Block，避免丢失。
    if (line.startsWith('#')) {
      if (old) result.push(old);
      continue;
    }
    if (!line) {
      result.push(mergeBlock(old, index, { type: 'narration', text: '' }));
      continue;
    }

    // 先识别 Ren'Py 关键字行，避免带引号的 menu 等被对白规则误匹配。
    if (/^jump\s+/.test(line)) {
      result.push(mergeBlock(old, index, { type: 'jump', target: line.replace(/^jump\s+/, '') }));
      continue;
    }
    if (/^call\s+/.test(line)) {
      result.push(mergeBlock(old, index, { type: 'call', target: line.replace(/^call\s+/, '') }));
      continue;
    }
    if (line === 'return') {
      result.push(mergeBlock(old, index, { type: 'return' }));
      continue;
    }
    if (/^scene\s+/.test(line)) {
      result.push(mergeBlock(old, index, { type: 'scene', title: line.replace(/^scene\s+/, '') }));
      continue;
    }
    const sound = /^(play|stop)\s+(bgm|sfx|voice)\s+(.*)$/.exec(line);
    if (sound) {
      result.push(mergeBlock(old, index, { type: 'sound', action: sound[1] === 'stop' ? 'stop' : 'play', channel: sound[2] as 'bgm' | 'sfx' | 'voice', title: sound[3].replace(/^["']|["']$/g, '') }));
      continue;
    }
    if (/^menu\s+/.test(line)) {
      result.push(mergeBlock(old, index, { type: 'branch', title: line.replace(/^menu\s+/, '').replace(/^["']|["']$/g, '') }));
      continue;
    }
    const condition = parseRenpyConditionLine(line);
    if (condition) {
      result.push(mergeBlock(old, index, {
        type: 'condition',
        variable: condition.variable,
        operator: condition.operator,
        // 显式清空另一侧，避免旧 Block 的比较对象残留影响运行时语义。
        ...(condition.compareVariable
          ? { compareVariable: condition.compareVariable, compareValue: undefined }
          : { compareValue: condition.compareValue ?? '', compareVariable: undefined }),
        ...(condition.trueTarget ? { trueTarget: condition.trueTarget } : { trueTarget: undefined }),
        ...(condition.falseTarget ? { falseTarget: condition.falseTarget } : { falseTarget: undefined }),
      }));
      continue;
    }
    const set = parseRenpySetLine(line, true);
    if (set) {
      result.push(mergeBlock(old, index, set.operation
        ? { type: 'modifyVariable', variable: set.variable, operation: set.operation, operand: Number(set.rawValue) }
        : { type: 'setVariable', variable: set.variable, value: set.value ?? set.rawValue }));
      continue;
    }
    // 对白：speaker "text"（speaker 支持中文等非空白、非引号字符）。
    const dialogue = /^([^\s"']+)\s+(["'])(.*)\2$/.exec(line);
    if (dialogue) {
      result.push(mergeBlock(old, index, { type: 'dialogue', speaker: dialogue[1], text: dialogue[3] }));
      continue;
    }
    // 旁白：独立引号文本。
    if (/^["'].*["']$/.test(line)) {
      result.push(mergeBlock(old, index, { type: 'narration', text: line.slice(1, -1) }));
      continue;
    }
    // 无法识别的行：保留旧 Block，绝不丢弃已有数据。
    if (old) result.push(old);
  }
  return result;
}
