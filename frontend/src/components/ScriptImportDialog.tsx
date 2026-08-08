import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ClipboardPaste, FileText, FileUp, LoaderCircle, Settings2, Smile, TriangleAlert, UserRound, X } from 'lucide-react';
import type { Character, ScriptImportMatch, ScriptImportPreview, ScriptImportRules, StoryBlock } from '../types';

const RULES_STORAGE_KEY = 'hikari-script-import-rules';
export const DEFAULT_SCRIPT_IMPORT_RULES: ScriptImportRules = {
  dialogueSeparator: 'auto',
  expressionSyntax: 'auto',
  characterMatching: 'smart',
  unknownCharacter: 'keep',
  defaultExpression: '默认',
  mergeNarrationLines: false,
};

export const loadScriptImportRules = (): ScriptImportRules => {
  try {
    const stored = JSON.parse(localStorage.getItem(RULES_STORAGE_KEY) ?? '{}') as Partial<ScriptImportRules>;
    return { ...DEFAULT_SCRIPT_IMPORT_RULES, ...stored };
  } catch { return DEFAULT_SCRIPT_IMPORT_RULES; }
};

interface ScriptImportDialogProps {
  open: boolean;
  busy: boolean;
  preview: ScriptImportPreview | null;
  characters: Character[];
  close: () => void;
  selectFile: (rules: ScriptImportRules) => void;
  pasteText: (rules: ScriptImportRules) => void;
  updatePreview: (preview: ScriptImportPreview) => void;
  apply: (mode: 'append' | 'replace') => void;
}

const characterStatusLabel: Record<ScriptImportMatch['characterStatus'], string> = {
  exact: '角色精确匹配',
  alias: '显示名匹配',
  smart: '角色智能匹配',
  manual: '角色人工修正',
  unmatched: '角色未匹配',
};

const expressionStatusLabel: Record<ScriptImportMatch['expressionStatus'], string> = {
  exact: '表情精确匹配',
  smart: '表情智能匹配',
  manual: '表情人工修正',
  default: '使用默认表情',
  fallback: '表情已回退',
  unverified: '表情未验证',
};

const normalizeName = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s_\-·.]/g, '');
const findExpression = (character: Character, value?: string) => {
  const wanted = value?.trim();
  if (!wanted) return undefined;
  return character.expressions.find((expression) => expression === wanted)
    ?? character.expressions.find((expression) => normalizeName(expression) === normalizeName(wanted));
};
const defaultExpression = (character: Character, preferred: string) => findExpression(character, preferred) ?? character.expressions[0] ?? (preferred || '默认');
const expressionNeedsReview = (match?: ScriptImportMatch) => match?.expressionStatus === 'fallback' || match?.expressionStatus === 'unverified';
const removeLineWarnings = (warnings: string[], line: number, kinds: Array<'角色' | '表情'>) => warnings.filter((warning) => !kinds.some((kind) => warning.startsWith(`第 ${line} 行${kind}`)));

export function ScriptImportDialog({ open, busy, preview, characters, close, selectFile, pasteText, updatePreview, apply }: ScriptImportDialogProps) {
  const [rules, setRules] = useState<ScriptImportRules>(loadScriptImportRules);
  const [rulesOpen, setRulesOpen] = useState(true);
  useEffect(() => {
    try { localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules)); } catch { /* local preference persistence is optional */ }
  }, [rules]);

  const updateRule = <K extends keyof ScriptImportRules>(key: K, value: ScriptImportRules[K]) => setRules((current) => ({ ...current, [key]: value }));
  const matches = preview?.matches ?? [];
  const matchByBlock = useMemo(() => new Map(matches.map((match) => [match.blockId, match])), [matches]);
  const characterById = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);
  const unmatchedGroups = useMemo(() => {
    const groups = new Map<string, ScriptImportMatch[]>();
    for (const match of matches) {
      if (match.characterStatus !== 'unmatched') continue;
      groups.set(match.rawSpeaker, [...(groups.get(match.rawSpeaker) ?? []), match]);
    }
    return [...groups.entries()];
  }, [matches]);
  const expressionGroups = useMemo(() => {
    const groups = new Map<string, ScriptImportMatch[]>();
    for (const match of matches) {
      if (!match.characterId || !expressionNeedsReview(match)) continue;
      const key = `${match.characterId}\u0000${match.rawExpression ?? match.expression}`;
      groups.set(key, [...(groups.get(key) ?? []), match]);
    }
    return [...groups.values()];
  }, [matches]);
  const matchedCharacters = matches.filter((match) => match.characterStatus !== 'unmatched').length;
  const unmatchedCharacters = matches.length - matchedCharacters;
  const fallbackExpressions = matches.filter(expressionNeedsReview).length;

  const writePreview = (blocks: StoryBlock[], nextMatches: ScriptImportMatch[], warnings: string[]) => {
    if (!preview) return;
    updatePreview({ ...preview, blocks, matches: nextMatches, warnings: [...new Set(warnings)] });
  };

  const mapCharacters = (blockIds: string[], characterId: string) => {
    if (!preview) return;
    const character = characterById.get(characterId);
    if (!character) return;
    const ids = new Set(blockIds);
    let warnings = [...preview.warnings];
    const nextMatches = matches.map((match) => {
      if (!ids.has(match.blockId)) return match;
      warnings = removeLineWarnings(warnings, match.line, ['角色', '表情']);
      const resolved = findExpression(character, match.rawExpression);
      const expression = resolved ?? defaultExpression(character, rules.defaultExpression);
      const expressionStatus: ScriptImportMatch['expressionStatus'] = match.rawExpression && !resolved
        ? 'fallback'
        : character.expressions.length ? 'manual' : 'unverified';
      if (expressionNeedsReview({ ...match, expressionStatus })) {
        warnings.push(character.expressions.length
          ? `第 ${match.line} 行表情“${match.rawExpression ?? match.expression}”未匹配目标角色“${character.name}”，请人工选择`
          : `第 ${match.line} 行表情无法验证：角色“${character.name}”尚未配置表情图片`);
      }
      return { ...match, characterId: character.id, characterName: character.name, characterStatus: 'manual' as const, expression, expressionStatus };
    });
    const nextMatchByBlock = new Map(nextMatches.map((match) => [match.blockId, match]));
    const blocks = preview.blocks.map((block) => {
      if (block.type !== 'dialogue' || !ids.has(block.id)) return block;
      const match = nextMatchByBlock.get(block.id);
      return { ...block, speaker: character.name, expression: match?.expression ?? block.expression };
    });
    writePreview(blocks, nextMatches, warnings);
  };

  const mapExpressions = (blockIds: string[], expression: string) => {
    if (!preview) return;
    const ids = new Set(blockIds);
    let warnings = [...preview.warnings];
    const nextMatches = matches.map((match) => {
      if (!ids.has(match.blockId)) return match;
      warnings = removeLineWarnings(warnings, match.line, ['表情']);
      return { ...match, expression, expressionStatus: 'manual' as const };
    });
    const blocks = preview.blocks.map((block) => block.type === 'dialogue' && ids.has(block.id) ? { ...block, expression } : block);
    writePreview(blocks, nextMatches, warnings);
  };

  const updateText = (blockId: string, text: string) => {
    if (!preview) return;
    const blocks = preview.blocks.map((block) => block.id === blockId && (block.type === 'dialogue' || block.type === 'narration') ? { ...block, text } : block);
    writePreview(blocks, matches, preview.warnings);
  };

  const convertToNarration = (blockId: string) => {
    if (!preview) return;
    const match = matchByBlock.get(blockId);
    const blocks = preview.blocks.map((block): StoryBlock => {
      if (block.id !== blockId || block.type !== 'dialogue') return block;
      return { id: block.id, type: 'narration', text: block.speaker ? `${block.speaker}：${block.text ?? ''}` : block.text };
    });
    const nextMatches = matches.filter((item) => item.blockId !== blockId);
    const warnings = match ? removeLineWarnings(preview.warnings, match.line, ['角色', '表情']) : preview.warnings;
    writePreview(blocks, nextMatches, warnings);
  };

  if (!open) return null;

  return <div className="modal-backdrop" onClick={close}><div className="modal wide script-import-modal" role="dialog" aria-modal="true" aria-labelledby="script-import-title" onClick={(event) => event.stopPropagation()}>
    <div className="modal-header"><FileUp /><strong id="script-import-title">导入剧本</strong><button className={`button compact ghost script-rule-toggle ${rulesOpen ? 'active' : ''}`} onClick={() => setRulesOpen((value) => !value)}><Settings2 />解析规则<ChevronDown /></button><button className="icon-button" title="关闭" onClick={close}><X /></button></div>
    {rulesOpen && <section className="script-import-rules" aria-label="文本解析规则">
      <label><span>对话分隔符<small>识别角色与正文</small></span><select value={rules.dialogueSeparator} onChange={(event) => updateRule('dialogueSeparator', event.target.value as ScriptImportRules['dialogueSeparator'])}><option value="auto">自动（冒号或 Tab）</option><option value="colon">仅冒号 ：</option><option value="tab">仅 Tab 制表符</option></select></label>
      <label><span>表情标记<small>位于角色名或正文开头</small></span><select value={rules.expressionSyntax} onChange={(event) => updateRule('expressionSyntax', event.target.value as ScriptImportRules['expressionSyntax'])}><option value="auto">自动识别</option><option value="brackets">方括号 [微笑]</option><option value="parentheses">圆括号（微笑）</option><option value="pipe">竖线 |微笑</option><option value="none">不识别表情</option></select></label>
      <label><span>角色匹配<small>主名称与固定显示名</small></span><select value={rules.characterMatching} onChange={(event) => updateRule('characterMatching', event.target.value as ScriptImportRules['characterMatching'])}><option value="smart">智能匹配</option><option value="exact">仅精确匹配</option></select></label>
      <label><span>未知角色<small>无法匹配项目角色时</small></span><select value={rules.unknownCharacter} onChange={(event) => updateRule('unknownCharacter', event.target.value as ScriptImportRules['unknownCharacter'])}><option value="keep">保留原角色名</option><option value="narration">整行转为旁白</option></select></label>
      <label><span>默认表情<small>没有表情标记时使用</small></span><input value={rules.defaultExpression} maxLength={40} onChange={(event) => updateRule('defaultExpression', event.target.value)} /></label>
      <label className="script-rule-check"><input type="checkbox" checked={rules.mergeNarrationLines} onChange={(event) => updateRule('mergeNarrationLines', event.target.checked)} /><span>合并连续旁白<small>相邻旁白行合并到同一个 Block</small></span></label>
      {preview && <p><TriangleAlert />规则修改后，请点击“重新粘贴”或重新选择文件以刷新预览。</p>}
    </section>}
    {!preview ? <div className="import-picker"><FileText /><strong>TXT、Markdown、Hikari JSON 或剪贴板文本</strong><span>Python 会结合项目角色和上述规则生成 Block，确认前不会修改项目。</span><div className="import-picker-actions"><button className="button primary" disabled={busy} onClick={() => selectFile(rules)}>{busy ? <LoaderCircle className="spin" /> : <FileUp />}{busy ? '正在解析' : '选择剧本文件'}</button><button className="button ghost" disabled={busy} onClick={() => pasteText(rules)}><ClipboardPaste />粘贴文本</button></div></div> : <>
      <div className="import-summary"><span><strong>{preview.sourceName}</strong><small>{preview.format} · {preview.blocks.length} Blocks</small></span>{matches.length > 0 && <div className="script-match-summary"><span className="success"><CheckCircle2 />{matchedCharacters} 个角色已匹配</span>{unmatchedCharacters > 0 && <span className="warning"><TriangleAlert />{unmatchedCharacters} 个未匹配</span>}{fallbackExpressions > 0 && <span className="warning"><Smile />{fallbackExpressions} 个表情需检查</span>}</div>}<button className="button ghost" disabled={busy} onClick={() => pasteText(rules)}><ClipboardPaste />重新粘贴</button><button className="button ghost" disabled={busy} onClick={() => selectFile(rules)}><FileUp />选择文件</button></div>
      {(unmatchedGroups.length > 0 || expressionGroups.length > 0) && <section className="script-import-resolver" aria-label="批量映射">
        <div className="script-resolver-heading"><span><strong>批量解决匹配问题</strong><small>同一来源的修正会应用到所有相关行</small></span><span>{unmatchedCharacters + fallbackExpressions} 项待处理</span></div>
        <div className="script-resolver-grid">
          {unmatchedGroups.map(([rawSpeaker, group]) => <label key={`speaker-${rawSpeaker}`}><span><UserRound /><span><strong>{rawSpeaker}</strong><small>{group.length} 行未知角色</small></span></span><select aria-label={`批量映射角色 ${rawSpeaker}`} defaultValue="" onChange={(event) => event.target.value && mapCharacters(group.map((match) => match.blockId), event.target.value)}><option value="" disabled>映射到项目角色…</option>{characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>)}
          {expressionGroups.map((group) => { const first = group[0]; const character = characterById.get(first.characterId!); if (!character) return null; const source = first.rawExpression ?? first.expression; return <label key={`expression-${first.characterId}-${source}`}><span><Smile /><span><strong>{source}</strong><small>{character.name} · {group.length} 行异常表情</small></span></span><select aria-label={`批量映射表情 ${character.name} ${source}`} defaultValue="" onChange={(event) => event.target.value && mapExpressions(group.map((match) => match.blockId), event.target.value)}><option value="" disabled>替换为真实表情…</option>{character.expressions.map((expression) => <option key={expression} value={expression}>{expression}</option>)}</select></label>; })}
        </div>
      </section>}
      {!!preview.warnings.length && <div className="import-warnings">{preview.warnings.map((warning) => <span key={warning}><TriangleAlert />{warning}</span>)}</div>}
      <div className="import-preview-list">{preview.blocks.map((block, index) => {
        const match = matchByBlock.get(block.id);
        const character = match?.characterId ? characterById.get(match.characterId) : undefined;
        const needsReview = match?.characterStatus === 'unmatched' || expressionNeedsReview(match);
        return <article className={needsReview ? 'needs-review script-row-editor' : 'script-row-editor'} key={block.id}>
          <span>{index + 1}</span><strong>{block.type}</strong><div className="script-row-content">
            {(block.type === 'dialogue' || block.type === 'narration') ? <textarea aria-label={`第 ${index + 1} 行正文`} rows={2} value={block.text ?? ''} onChange={(event) => updateText(block.id, event.target.value)} /> : <p>{block.title || block.target || '控制指令'}</p>}
            {block.type === 'dialogue' && <div className="script-row-controls">
              <label><span>角色</span><select aria-label={`第 ${index + 1} 行角色`} value={match?.characterId ?? ''} onChange={(event) => mapCharacters([block.id], event.target.value)}><option value="" disabled>{block.speaker || '选择角色'}</option>{characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label><span>表情</span><select aria-label={`第 ${index + 1} 行表情`} disabled={!character || character.expressions.length === 0} value={expressionNeedsReview(match) ? '__review__' : block.expression ?? ''} onChange={(event) => mapExpressions([block.id], event.target.value)}>{expressionNeedsReview(match) && <option value="__review__" disabled>请选择真实表情</option>}{character && character.expressions.length > 0 ? character.expressions.map((expression) => <option key={expression} value={expression}>{expression}</option>) : <option value="">{character ? '角色未配置表情' : '先匹配角色'}</option>}</select></label>
              <button className="button compact ghost" onClick={() => convertToNarration(block.id)}>转为旁白</button>
            </div>}
            {match && <div className="script-match-detail"><span className={match.characterStatus === 'unmatched' ? 'warning' : 'success'}><UserRound />{characterStatusLabel[match.characterStatus]}{match.characterName && match.rawSpeaker !== match.characterName ? ` · ${match.rawSpeaker} → ${match.characterName}` : ''}</span><span className={expressionNeedsReview(match) ? 'warning' : ''}><Smile />{expressionStatusLabel[match.expressionStatus]} · {match.expression}</span></div>}
          </div>
        </article>;
      })}</div>
      <div className="modal-footer"><button className="button ghost" onClick={close}>取消</button><button className="button ghost" disabled={!preview.blocks.length} onClick={() => apply('replace')}>替换当前片段</button><button className="button primary" disabled={!preview.blocks.length} onClick={() => apply('append')}>追加 {preview.blocks.length} 个 Block</button></div>
    </>}
  </div></div>;
}
