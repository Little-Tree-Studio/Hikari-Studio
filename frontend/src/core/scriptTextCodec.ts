import type { StoryBlock } from '../types';

const quote = (value: unknown) => JSON.stringify(String(value ?? ''));
const makeId = (index: number) => `block-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`;

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
      case 'setVariable': return `$ ${block.variable ?? ''} = ${typeof block.value === 'string' ? quote(block.value) : String(block.value ?? '')}`.trim();
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
    if (/^\$\s*/.test(line)) {
      const set = /^\$\s*(\S+)\s*=\s*(.+)$/.exec(line);
      if (set) {
        result.push(mergeBlock(old, index, { type: 'setVariable', variable: set[1], value: set[2].replace(/^["']|["']$/g, '') }));
        continue;
      }
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
