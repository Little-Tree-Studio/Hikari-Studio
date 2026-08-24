import type { Project, StoryBlock } from '../types';
import { analyzeAssetReferences } from '../core/assetReferences';
import { blockRegistry } from './blocks';
import type { ProjectDiagnostic } from './types';

const valueType = (value: unknown) => value === null ? 'null' : typeof value;

function targetsOf(block: StoryBlock): string[] {
  if (block.type === 'branch') return (block.options ?? []).map((option) => option.target).filter(Boolean);
  if (block.type === 'condition') return [block.trueTarget, block.falseTarget].filter(Boolean) as string[];
  if (block.type === 'jump' || block.type === 'call') return block.target ? [block.target] : [];
  return [];
}

export function diagnoseProject(project: Project): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  const fragmentIds = new Set(project.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => fragment.id)));
  const referenced = new Map<string, Set<string>>();
  const assignedTypes = new Map<string, Set<string>>();

  for (const character of project.characters) {
    const usedPortraits = new Map<string, string>();
    for (const expression of character.expressions) {
      const assetId = character.portraits?.[expression];
      if (!assetId) diagnostics.push({ severity: 'error', code: 'MISSING_CHARACTER_PORTRAIT', message: `角色“${character.name}”的“${expression}”表情未配置独立立绘`, relatedId: character.id });
      else if (usedPortraits.has(assetId)) diagnostics.push({ severity: 'error', code: 'DUPLICATE_CHARACTER_PORTRAIT', message: `角色“${character.name}”的“${expression}”与“${usedPortraits.get(assetId)}”使用了同一张立绘`, relatedId: character.id });
      else usedPortraits.set(assetId, expression);
    }
  }

  for (const [fragmentId, blocks] of Object.entries(project.scripts)) {
    referenced.set(fragmentId, new Set());
    blocks.forEach((block, blockIndex) => {
      if (!blockRegistry[block.type]) {
        diagnostics.push({ severity: 'error', code: 'UNKNOWN_BLOCK', message: `不支持的 Block 类型：${String((block as StoryBlock).type)}`, fragmentId, blockId: block.id, blockIndex });
        return;
      }
      for (const issue of blockRegistry[block.type].diagnose(block, project)) diagnostics.push({ ...issue, fragmentId, blockId: block.id, blockIndex });
      for (const target of targetsOf(block)) referenced.get(fragmentId)?.add(target);
      if (block.type === 'branch' && !(block.options?.length)) diagnostics.push({ severity: 'error', code: 'EMPTY_BRANCH', message: '选项分支没有任何选项', fragmentId, blockId: block.id, blockIndex });
      if (block.type === 'setVariable' && block.variable) {
        if (!assignedTypes.has(block.variable)) assignedTypes.set(block.variable, new Set([valueType(project.variables[block.variable])]));
        assignedTypes.get(block.variable)?.add(valueType(block.value));
      }
      if (block.type === 'modifyVariable' && block.variable) {
        if (!(block.variable in project.variables)) diagnostics.push({ severity: 'warning', code: 'UNDECLARED_VARIABLE', message: `增减变量读取了未声明变量：${block.variable}`, fragmentId, blockId: block.id, blockIndex });
        if (!assignedTypes.has(block.variable)) assignedTypes.set(block.variable, new Set([valueType(project.variables[block.variable])]));
        assignedTypes.get(block.variable)?.add('number');
      }
      if (block.type === 'condition') {
        if (block.variable && !(block.variable in project.variables)) diagnostics.push({ severity: 'warning', code: 'UNDECLARED_VARIABLE', message: `条件使用了未声明变量：${block.variable}`, fragmentId, blockId: block.id, blockIndex });
        if (block.compareVariable && !(block.compareVariable in project.variables)) diagnostics.push({ severity: 'warning', code: 'UNDECLARED_VARIABLE', message: `条件比较引用了未声明变量：${block.compareVariable}`, fragmentId, blockId: block.id, blockIndex });
        if (block.compareVariable ? block.variable === block.compareVariable : block.compareValue === undefined || block.compareValue === '') diagnostics.push({ severity: 'warning', code: 'CONDITION_MISSING_COMPARE', message: '条件缺少比较值：请填写比较值或选择比较变量', fragmentId, blockId: block.id, blockIndex });
        if (!block.trueTarget && !block.falseTarget) diagnostics.push({ severity: 'warning', code: 'CONDITION_NO_BRANCH', message: '条件判断没有配置任何跳转目标，将始终继续执行', fragmentId, blockId: block.id, blockIndex });
      }
      if (block.type === 'return' && !Object.values(project.scripts).flat().some((candidate) => candidate.type === 'call' && candidate.target === fragmentId)) diagnostics.push({ severity: 'warning', code: 'ORPHAN_RETURN', message: '此返回指令所在片段没有被任何调用指令引用', fragmentId, blockId: block.id, blockIndex });
    });
  }

  for (const [name, types] of assignedTypes) if (types.size > 1) diagnostics.push({ severity: 'warning', code: 'VARIABLE_TYPE_CONFLICT', message: `变量“${name}”被赋予多种类型：${[...types].join('、')}`, relatedId: name });

  const entry = project.chapters.find((chapter) => chapter.entry)?.fragments[0]?.id ?? project.chapters[0]?.fragments[0]?.id;
  const reachable = new Set<string>();
  const queue = entry ? [entry] : [];
  while (queue.length) {
    const fragmentId = queue.shift()!;
    if (reachable.has(fragmentId)) continue;
    reachable.add(fragmentId);
    for (const target of referenced.get(fragmentId) ?? []) if (fragmentIds.has(target) && !reachable.has(target)) queue.push(target);
    const blocks = project.scripts[fragmentId] ?? [];
    const endsFlow = blocks.some((block) => block.type === 'jump' || block.type === 'branch' || block.type === 'condition');
    if (!endsFlow) {
      const flat = project.chapters.flatMap((chapter) => chapter.fragments);
      const index = flat.findIndex((fragment) => fragment.id === fragmentId);
      if (index >= 0 && flat[index + 1]) queue.push(flat[index + 1].id);
    }
  }
  for (const fragmentId of fragmentIds) if (!reachable.has(fragmentId)) diagnostics.push({ severity: 'warning', code: 'UNREACHABLE_FRAGMENT', message: `片段不可达：${fragmentId}`, fragmentId });

  for (const [fragmentId, targets] of referenced) {
    const blocks = project.scripts[fragmentId] ?? [];
    const hasVisibleContent = blocks.some((block) => block.type === 'dialogue' || block.type === 'narration' || block.type === 'branch');
    if (!hasVisibleContent && targets.has(fragmentId) && targets.size === 1) diagnostics.push({ severity: 'error', code: 'SELF_LOOP', message: '片段只有指向自身的控制流，运行时会进入死循环', fragmentId });
  }
  for (const missing of analyzeAssetReferences(project).missing) diagnostics.push({ severity: 'error', code: 'MISSING_ASSET', message: `缺失素材 ${missing.assetId}：${missing.sourceName} · ${missing.detail}`, fragmentId: missing.fragmentId, blockIndex: missing.blockIndex, relatedId: missing.assetId });
  return diagnostics;
}

export function diagnosticSummary(project: Project) {
  const items = diagnoseProject(project);
  return { items, errors: items.filter((item) => item.severity === 'error').length, warnings: items.filter((item) => item.severity === 'warning').length };
}
