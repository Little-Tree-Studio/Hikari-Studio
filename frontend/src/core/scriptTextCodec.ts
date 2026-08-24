import type { StoryBlock } from '../types';

const quote = (value: unknown) => JSON.stringify(String(value ?? ''));

export function serializeRenpy(blocks: StoryBlock[]): string {
  return blocks.map((block) => {
    switch (block.type) {
      case 'dialogue': return `${block.speaker ?? 'narrator'} ${quote(block.text)}`;
      case 'narration': return `            ${quote(block.text)}`;
      case 'scene': return `scene ${block.title ?? ''}`.trim();
      case 'sound': return `${block.action === 'stop' ? 'stop' : 'play'} ${block.channel ?? 'sfx'} ${quote(block.title ?? '')}`;
      case 'jump': return `jump ${block.target ?? ''}`.trim();
      case 'call': return `call ${block.target ?? ''}`.trim();
      case 'return': return 'return';
      case 'branch': return `menu ${quote(block.title ?? '选择')}:\n${(block.options ?? []).map((option) => `    ${quote(option.text)}:\n        jump ${option.target}`).join('\n')}`;
      case 'setVariable': return `$ ${block.variable ?? ''} = ${typeof block.value === 'string' ? quote(block.value) : String(block.value ?? '')}`.trim();
      default: return `# ${block.type} ${block.title ?? block.text ?? ''}`.trim();
    }
  }).join('\n');
}

export function serializePlain(blocks: StoryBlock[]): string {
  return blocks.map((block) => block.type === 'dialogue' ? `${block.speaker ?? ''}：${block.text ?? ''}` : block.text ?? block.title ?? '').join('\n');
}

export function parseJsonBlocks(text: string): StoryBlock[] {
  const payload = JSON.parse(text) as unknown;
  const source = Array.isArray(payload) ? payload : (payload && typeof payload === 'object' && 'blocks' in payload && Array.isArray(payload.blocks) ? payload.blocks : null);
  if (!source) throw new Error('JSON 必须是 Block 数组或包含 blocks 数组的对象');
  return source.map((item, index) => {
    if (!item || typeof item !== 'object' || !('type' in item)) throw new Error(`JSON 第 ${index + 1} 项缺少 type`);
    return { ...(item as StoryBlock), id: (item as StoryBlock).id || `block-${Date.now().toString(36)}-${index}` };
  });
}

export function parsePlainBlocks(text: string, oldBlocks: StoryBlock[]): StoryBlock[] {
  const oldByIndex = oldBlocks;
  return text.split(/\r?\n/).map((line, index) => {
    const match = /^([^：:]{1,60})[：:]\s*(.*)$/.exec(line.trim());
    const old = oldByIndex[index];
    return match ? { id: old?.id ?? `block-${Date.now().toString(36)}-${index}`, type: 'dialogue' as const, speaker: match[1].trim(), text: match[2] } : { id: old?.id ?? `block-${Date.now().toString(36)}-${index}`, type: 'narration' as const, text: line };
  });
}

export function parseRenpyBlocks(text: string, oldBlocks: StoryBlock[]): StoryBlock[] {
  const result: StoryBlock[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      result.push({ id: oldBlocks[result.length]?.id ?? `block-${Date.now().toString(36)}-${result.length}`, type: 'narration', text: '' });
      continue;
    }
    if (line.startsWith('#')) continue;
    const dialogue = /^([A-Za-z_][\w]*)\s+(["'])(.*)\2$/.exec(line);
    if (dialogue) result.push({ id: oldBlocks[result.length]?.id ?? `block-${Date.now().toString(36)}-${result.length}`, type: 'dialogue', speaker: dialogue[1], text: dialogue[3] });
    else if (/^["'].*["']$/.test(line)) result.push({ id: oldBlocks[result.length]?.id ?? `block-${Date.now().toString(36)}-${result.length}`, type: 'narration', text: line.slice(1, -1) });
    else if (/^jump\s+/.test(line)) result.push({ id: oldBlocks[result.length]?.id ?? `block-${Date.now().toString(36)}-${result.length}`, type: 'jump', target: line.replace(/^jump\s+/, '') });
    else if (/^call\s+/.test(line)) result.push({ id: oldBlocks[result.length]?.id ?? `block-${Date.now().toString(36)}-${result.length}`, type: 'call', target: line.replace(/^call\s+/, '') });
    else if (line === 'return') result.push({ id: oldBlocks[result.length]?.id ?? `block-${Date.now().toString(36)}-${result.length}`, type: 'return' });
    else if (/^scene\s+/.test(line)) result.push({ id: oldBlocks[result.length]?.id ?? `block-${Date.now().toString(36)}-${result.length}`, type: 'scene', title: line.replace(/^scene\s+/, '') });
  }
  return result;
}
