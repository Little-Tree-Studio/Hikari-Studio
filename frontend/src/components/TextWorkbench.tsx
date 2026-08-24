import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type TextareaHTMLAttributes } from 'react';
import {
  CheckCircle2, ClipboardPaste, CornerDownRight, Copy, Eraser,
  Languages, LocateFixed, MessageSquareText, Plus, Search, Trash2, X,
} from 'lucide-react';
import {
  LANGUAGE_CATALOG, TEXT_SLOT_KIND_LABELS, collectTextSlots, defaultLanguage,
  isValidLanguageCode, languageLabel, languageProgress, projectLanguages, slotVoice,
  type LanguageCode, type TextSlot, type TextSlotKind,
} from '../core/localization';
import { audioCategoryOf } from '../core/audio';
import { useMeasuredVirtualList } from '../hooks/useVirtualList';
import { Select } from './ui/Select';
import type { LocalizedBlockText, Project } from '../types';

type Commit = (updater: (project: Project) => Project, label?: string) => void;
type Notify = (message: string, tone?: 'error' | 'success') => void;

interface TextWorkbenchProps {
  project: Project;
  commit: Commit;
  notify: Notify;
  requestText: (options: { title: string; message?: string; placeholder?: string; initialValue?: string; confirmText?: string }) => Promise<string | null>;
  requestConfirm: (options: { title: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
  activate: (fragmentId: string, blockIndex?: number) => void;
  previewLanguage?: LanguageCode;
  setPreviewLanguage?: (language: LanguageCode) => void;
}

const BASE_COLUMN = '__base__';
const VOICE_INHERIT = 'inherit';
const VOICE_NONE = 'none';

const slotDraftId = (column: string, slot: TextSlot) => `${column}::${slot.key}::${slot.kind}::${slot.optionIndex ?? ''}`;
const slotRowId = (slot: TextSlot) => `${slot.key}::${slot.kind}::${slot.optionIndex ?? ''}`;

const TEXTAREA_MAX_HEIGHT = 240;

function AutoSizeTextarea({ value, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, []);
  useLayoutEffect(() => { resize(); }, [value, resize]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [resize]);
  return <textarea ref={ref} rows={1} value={value} {...rest} />;
}

function MeasuredTextRow({ itemKey, top, measure, className, style, children }: { itemKey: string; top: number; measure: (key: string, element: HTMLElement | null) => () => void; className: string; style?: CSSProperties; children: ReactNode }) {
  const cleanupRef = useRef<() => void>(() => undefined);
  const setRowRef = useCallback((element: HTMLDivElement | null) => {
    cleanupRef.current();
    cleanupRef.current = element ? measure(itemKey, element) : () => undefined;
  }, [itemKey, measure]);
  return <div ref={setRowRef} className={className} style={{ ...style, transform: `translateY(${top}px)` }}>{children}</div>;
}

function pruneEntry(entry: LocalizedBlockText): LocalizedBlockText | undefined {
  const next: LocalizedBlockText = { ...entry };
  if (!next.text?.trim()) delete next.text;
  if (!next.title?.trim()) delete next.title;
  if (!next.speaker?.trim()) delete next.speaker;
  if (Array.isArray(next.options)) {
    const options = next.options.filter((item) => item?.trim());
    if (options.length) next.options = next.options.map((item) => item?.trim() ? item : '');
    else delete next.options;
  }
  if (!next.voice) delete next.voice;
  return Object.keys(next).length ? next : undefined;
}

export function TextWorkbench({ project, commit, notify, requestText, requestConfirm, activate, previewLanguage, setPreviewLanguage }: TextWorkbenchProps) {
  const languages = projectLanguages(project);
  const fallback = defaultLanguage(project);
  const extraLanguages = languages.filter((language) => language !== fallback);
  const [fragmentFilter, setFragmentFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | TextSlotKind>('all');
  const [missingOnly, setMissingOnly] = useState(false);
  const [focusLanguage, setFocusLanguage] = useState<string>('');
  const [query, setQuery] = useState('');
  const [showVoice, setShowVoice] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [batchFill, setBatchFill] = useState<{ language: string; text: string; overwrite: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeFocusLanguage = focusLanguage && extraLanguages.includes(focusLanguage) ? focusLanguage : extraLanguages[0] ?? '';

  const slots = useMemo(() => collectTextSlots(project), [project]);
  const translations = project.translations ?? {};
  const voiceAssets = useMemo(() => project.assets.filter((asset) => asset.kind === 'audio' && audioCategoryOf(asset) === 'voice'), [project.assets]);
  const fragmentOptions = useMemo(() => project.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => ({ id: fragment.id, label: `${chapter.name} / ${fragment.name}` }))), [project.chapters]);

  const localizedValue = (language: string, slot: TextSlot): string => {
    const entry = translations[language]?.[slot.key];
    if (slot.kind === 'dialogue' || slot.kind === 'narration') return entry?.text ?? '';
    if (slot.kind === 'branchTitle') return entry?.title ?? '';
    return entry?.options?.[slot.optionIndex ?? 0] ?? '';
  };

  const visibleSlots = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return slots.filter((slot) => {
      if (fragmentFilter && slot.fragmentId !== fragmentFilter) return false;
      if (kindFilter !== 'all' && slot.kind !== kindFilter) return false;
      if (missingOnly && activeFocusLanguage && localizedValue(activeFocusLanguage, slot).trim() !== '') return false;
      if (!needle) return true;
      const haystack = [slot.baseText, slot.speakerName ?? '', slot.fragmentName, slot.chapterName, ...extraLanguages.map((language) => localizedValue(language, slot))];
      return haystack.join('\n').toLocaleLowerCase().includes(needle);
    });
  }, [slots, fragmentFilter, kindFilter, missingOnly, activeFocusLanguage, query, extraLanguages, translations]);

  const slotKeys = useMemo(() => visibleSlots.map((slot) => slotRowId(slot)), [visibleSlots]);
  const estimateRowHeight = useCallback(() => (showVoice ? 96 : 62), [showVoice]);
  const list = useMeasuredVirtualList(scrollRef, slotKeys, estimateRowHeight);

  const commitBaseText = (slot: TextSlot, value: string) => {
    const clean = value.trim() ? value : '';
    commit((current) => {
      const blocks = (current.scripts[slot.fragmentId] ?? []).map((block) => {
        if (block.id !== slot.blockId) return block;
        if (slot.kind === 'branchTitle') return { ...block, title: clean };
        if (slot.kind === 'branchOption') return { ...block, options: (block.options ?? []).map((option, index) => index === slot.optionIndex ? { ...option, text: clean } : option) };
        return { ...block, text: clean };
      });
      return { ...current, scripts: { ...current.scripts, [slot.fragmentId]: blocks } };
    }, '快速填充默认语言文本');
  };

  const commitTranslationText = (language: string, slot: TextSlot, value: string) => {
    commit((current) => {
      const nextTranslations = { ...(current.translations ?? {}) };
      const table = { ...(nextTranslations[language] ?? {}) };
      const entry: LocalizedBlockText = { ...(table[slot.key] ?? {}) };
      if (slot.kind === 'dialogue' || slot.kind === 'narration') entry.text = value;
      else if (slot.kind === 'branchTitle') entry.title = value;
      else {
        const options = Array.from({ length: (slot.optionIndex ?? 0) + 1 }, (_, index) => entry.options?.[index] ?? '');
        options[slot.optionIndex ?? 0] = value;
        entry.options = options;
      }
      const pruned = pruneEntry(entry);
      if (pruned) table[slot.key] = pruned;
      else delete table[slot.key];
      nextTranslations[language] = table;
      return { ...current, translations: nextTranslations };
    }, `填充 ${languageLabel(language)} 翻译`);
  };

  const commitVoice = (language: string, slot: TextSlot, value: string) => {
    const isBase = language === BASE_COLUMN;
    const resolved = value === VOICE_INHERIT ? undefined : value === VOICE_NONE ? '' : value;
    if (isBase) {
      commit((current) => {
        const blocks = (current.scripts[slot.fragmentId] ?? []).map((block) => block.id !== slot.blockId ? block : { ...block, voice: resolved === undefined ? '' : resolved });
        return { ...current, scripts: { ...current.scripts, [slot.fragmentId]: blocks } };
      }, '设置默认语言语音');
      return;
    }
    commit((current) => {
      const nextTranslations = { ...(current.translations ?? {}) };
      const table = { ...(nextTranslations[language] ?? {}) };
      const entry: LocalizedBlockText = { ...(table[slot.key] ?? {}) };
      if (resolved === undefined) delete entry.voice;
      else entry.voice = resolved;
      const pruned = pruneEntry(entry);
      if (pruned) table[slot.key] = pruned;
      else delete table[slot.key];
      nextTranslations[language] = table;
      return { ...current, translations: nextTranslations };
    }, `设置 ${languageLabel(language)} 语音`);
  };

  const commitDraft = (column: string, slot: TextSlot) => {
    const draftId = slotDraftId(column, slot);
    const draft = drafts[draftId];
    if (draft === undefined) return;
    setDrafts((current) => {
      const next = { ...current };
      delete next[draftId];
      return next;
    });
    if (column === BASE_COLUMN) commitBaseText(slot, draft);
    else commitTranslationText(column, slot, draft);
  };

  const focusCell = (row: number, column: string) => {
    window.setTimeout(() => {
      scrollRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-row="${row}"][data-column="${column}"]`)?.focus();
    }, 40);
  };

  const handleCellKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>, row: number, column: string, slot: TextSlot) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    commitDraft(column, slot);
    if (row + 1 >= visibleSlots.length) return;
    list.scrollToIndex(row + 1, 'auto');
    focusCell(row + 1, column);
  };

  const addLanguage = async (code: string) => {
    const language = code.trim();
    if (!isValidLanguageCode(language)) { notify('语言代码格式无效，请使用如 zh-CN、en-US 的代码', 'error'); return; }
    if (languages.includes(language)) { notify('该语言已在项目中', 'error'); return; }
    commit((current) => ({
      ...current,
      locale: { default: current.locale?.default ?? 'zh-CN', languages: [...projectLanguages(current), language] },
      translations: { ...(current.translations ?? {}), [language]: current.translations?.[language] ?? {} },
    }), `添加语言 ${languageLabel(language)}`);
    setAddMenuOpen(false);
    notify(`已添加语言 ${languageLabel(language)}`);
  };
  const addCustomLanguage = async () => {
    setAddMenuOpen(false);
    const code = await requestText({ title: '添加自定义语言', message: '使用 BCP-47 风格语言代码，例如 zh-TW、en-US、pt-BR。', placeholder: '语言代码', confirmText: '添加' });
    if (code) void addLanguage(code);
  };

  const removeLanguage = async (language: string) => {
    const filled = languageProgress(project, language, slots).filled;
    if (!await requestConfirm({ title: `移除语言 ${languageLabel(language)}`, message: filled ? `将移除该语言及 ${filled} 条已填写的翻译，此操作可通过撤销恢复。` : '该语言还没有填写任何翻译。', confirmText: '移除语言', danger: true })) return;
    commit((current) => {
      const remaining = projectLanguages(current).filter((item) => item !== language);
      const translations = { ...(current.translations ?? {}) };
      delete translations[language];
      return { ...current, locale: { default: (current.locale?.default === language ? remaining[0] : current.locale?.default) ?? remaining[0], languages: remaining }, translations };
    }, `移除语言 ${languageLabel(language)}`);
    notify(`已移除语言 ${languageLabel(language)}`);
  };

  const setDefault = (language: string) => {
    commit((current) => ({ ...current, locale: { default: language, languages: projectLanguages(current) } }), `默认语言切换为 ${languageLabel(language)}`);
    notify(`默认语言已切换为 ${languageLabel(language)}，剧本原文保持不变，各语言翻译仍保留在语言文件中`);
  };

  const fillMissingFromBase = (language: string) => {
    const targets = slots.filter((slot) => slot.baseText.trim() && !localizedValue(language, slot).trim());
    if (!targets.length) { notify('该语言没有待填充的空缺', 'error'); return; }
    commit((current) => {
      const table = { ...(current.translations?.[language] ?? {}) };
      for (const slot of targets) {
        const entry: LocalizedBlockText = { ...(table[slot.key] ?? {}) };
        if (slot.kind === 'dialogue' || slot.kind === 'narration') entry.text = slot.baseText;
        else if (slot.kind === 'branchTitle') entry.title = slot.baseText;
        else {
          const options = Array.from({ length: (slot.optionIndex ?? 0) + 1 }, (_, index) => entry.options?.[index] ?? '');
          options[slot.optionIndex ?? 0] = slot.baseText;
          entry.options = options;
        }
        table[slot.key] = entry;
      }
      return { ...current, translations: { ...(current.translations ?? {}), [language]: table } };
    }, `以默认语言预填 ${languageLabel(language)} ${targets.length} 条`);
    notify(`已将 ${targets.length} 条默认语言文本复制为 ${languageLabel(language)} 草稿`);
  };

  const clearLanguage = async (language: string) => {
    const filled = languageProgress(project, language, slots).filled;
    if (!filled) { notify('该语言没有已填写的翻译', 'error'); return; }
    if (!await requestConfirm({ title: `清空 ${languageLabel(language)} 翻译`, message: `将清空该语言已填写的 ${filled} 条翻译与语音设置，此操作可通过撤销恢复。`, confirmText: '清空翻译', danger: true })) return;
    commit((current) => ({ ...current, translations: { ...(current.translations ?? {}), [language]: {} } }), `清空 ${languageLabel(language)} 翻译`);
    notify(`已清空 ${languageLabel(language)} 翻译`);
  };

  const applyBatchFill = () => {
    if (!batchFill) return;
    const lines = batchFill.text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length);
    if (!lines.length) { notify('请先粘贴要填充的文本，每行一条', 'error'); return; }
    const targets = visibleSlots.filter((slot) => batchFill.overwrite || !localizedValue(batchFill.language, slot).trim()).slice(0, lines.length);
    if (!targets.length) { notify('当前筛选结果没有可填充的行', 'error'); return; }
    const pairs = new Map(targets.map((slot, index) => [slotRowId(slot), lines[index]]));
    if (batchFill.language === BASE_COLUMN) {
      commit((current) => {
        const scripts = { ...current.scripts };
        for (const slot of targets) {
          const value = pairs.get(slotRowId(slot)) ?? '';
          scripts[slot.fragmentId] = (scripts[slot.fragmentId] ?? []).map((block) => {
            if (block.id !== slot.blockId) return block;
            if (slot.kind === 'branchTitle') return { ...block, title: value };
            if (slot.kind === 'branchOption') return { ...block, options: (block.options ?? []).map((option, index) => index === slot.optionIndex ? { ...option, text: value } : option) };
            return { ...block, text: value };
          });
        }
        return { ...current, scripts };
      }, `批量填充默认语言 ${targets.length} 条文本`);
    } else {
      const language = batchFill.language;
      commit((current) => {
        const table = { ...(current.translations?.[language] ?? {}) };
        for (const slot of targets) {
          const value = pairs.get(slotRowId(slot)) ?? '';
          const entry: LocalizedBlockText = { ...(table[slot.key] ?? {}) };
          if (slot.kind === 'dialogue' || slot.kind === 'narration') entry.text = value;
          else if (slot.kind === 'branchTitle') entry.title = value;
          else {
            const options = Array.from({ length: (slot.optionIndex ?? 0) + 1 }, (_, index) => entry.options?.[index] ?? '');
            options[slot.optionIndex ?? 0] = value;
            entry.options = options;
          }
          const pruned = pruneEntry(entry);
          if (pruned) table[slot.key] = pruned; else delete table[slot.key];
        }
        return { ...current, translations: { ...(current.translations ?? {}), [language]: table } };
      }, `批量填充 ${languageLabel(language)} ${targets.length} 条翻译`);
    }
    notify(`已按顺序填充 ${targets.length} 条文本${lines.length > targets.length ? `，${lines.length - targets.length} 行多余内容被忽略` : ''}`);
    setBatchFill(null);
  };

  const availableCatalog = LANGUAGE_CATALOG.filter((item) => !languages.includes(item.code));
  const totalFilled = (language: string) => languageProgress(project, language, slots);
  const gridTemplate = extraLanguages.length
    ? `190px minmax(190px, 1.1fr) repeat(${extraLanguages.length}, minmax(180px, 1fr))`
    : '190px minmax(190px, 1.1fr)';

  const renderCell = (column: string, language: string, slot: TextSlot, row: number) => {
    const draftId = slotDraftId(column, slot);
    const isBase = column === BASE_COLUMN;
    const current = isBase ? slot.baseText : localizedValue(language, slot);
    const value = drafts[draftId] ?? current;
    const missing = !isBase && !value.trim() && Boolean(slot.baseText.trim());
    return <div className={`text-cell ${isBase ? 'base' : 'lang'} ${missing ? 'missing' : ''}`} key={column}>
      <AutoSizeTextarea
        data-row={row}
        data-column={column}
        value={value}
        placeholder={missing ? slot.baseText : '空'}
        onChange={(event) => setDrafts((currentDrafts) => ({ ...currentDrafts, [draftId]: event.target.value }))}
        onBlur={() => commitDraft(column, slot)}
        onKeyDown={(event) => handleCellKeyDown(event, row, column, slot)}
      />
      {showVoice && slot.kind === 'dialogue' && (isBase
        ? <Select className="tiny" value={slot.baseVoice ?? VOICE_NONE} onChange={(value) => commitVoice(BASE_COLUMN, slot, value)}>
          <option value={VOICE_NONE}>无语音</option>
          {voiceAssets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}
        </Select>
        : <Select className="tiny" value={slotVoice(project, language, slot) ?? VOICE_INHERIT} onChange={(value) => commitVoice(language, slot, value)}>
          <option value={VOICE_INHERIT}>语音跟随默认</option>
          <option value={VOICE_NONE}>无语音</option>
          {voiceAssets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}
        </Select>)}
    </div>;
  };

  return <div className="text-workbench">
    <header className="workbench-header">
      <div><h1>文本与语言</h1><p>在一个表格里快速填充全部对白、旁白与选项，并为每种语言维护翻译和配音</p></div>
      <div className="workbench-header-actions">
        {setPreviewLanguage && extraLanguages.length > 0 && <label className="workbench-preview-language">预览语言
          <Select className="compact" value={previewLanguage ?? fallback} onChange={(value) => setPreviewLanguage(value)}>
            {languages.map((language) => <option value={language} key={language}>{languageLabel(language)}</option>)}
          </Select>
        </label>}
        <div className="workbench-lang-add">
          <button className="button primary" onClick={() => setAddMenuOpen((value) => !value)}><Plus />添加语言</button>
          {addMenuOpen && <div className="workbench-lang-menu">
            {availableCatalog.map((item) => <button key={item.code} onClick={() => void addLanguage(item.code)}><span>{item.label}</span><small>{item.code}</small></button>)}
            <button onClick={() => void addCustomLanguage()}><span>自定义代码…</span><small>BCP-47</small></button>
          </div>}
        </div>
      </div>
    </header>

    <section className="language-strip">
      <article className="language-card default">
        <div className="language-card-main"><Languages /><div><strong>{languageLabel(fallback)} <em>默认</em></strong><small>{fallback} · 剧本原文 {slots.length} 条</small></div></div>
        <div className="language-progress full"><span /></div>
      </article>
      {extraLanguages.map((language) => {
        const progress = totalFilled(language);
        return <article className={`language-card ${activeFocusLanguage === language ? 'active' : ''}`} key={language} onClick={() => { setFocusLanguage(language); setMissingOnly(true); }}>
          <div className="language-card-main"><CheckCircle2 className={progress.percent === 100 ? 'done' : ''} /><div><strong>{languageLabel(language)}</strong><small>{language} · {progress.filled}/{progress.total} 条 · {progress.percent}%</small></div></div>
          <div className="language-progress"><span style={{ width: `${progress.percent}%` }} /></div>
          <div className="language-card-actions">
            <button title="设为默认语言" onClick={(event) => { event.stopPropagation(); setDefault(language); }}>设为默认</button>
            <button title="移除语言" onClick={(event) => { event.stopPropagation(); void removeLanguage(language); }}><Trash2 /></button>
          </div>
        </article>;
      })}
    </section>

    <div className="workbench-toolbar">
      <div className="asset-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索原文与译文..." />{query && <button onClick={() => setQuery('')}><X /></button>}</div>
      <Select className="compact" value={fragmentFilter} onChange={setFragmentFilter}>
        <option value="">全部片段</option>
        {fragmentOptions.map((fragment) => <option value={fragment.id} key={fragment.id}>{fragment.label}</option>)}
      </Select>
      <Select className="compact" value={kindFilter} onChange={(value) => setKindFilter(value as 'all' | TextSlotKind)}>
        <option value="all">全部类型</option>
        <option value="dialogue">对白</option>
        <option value="narration">旁白</option>
        <option value="branchTitle">分支标题</option>
        <option value="branchOption">选项</option>
      </Select>
      <button className={`button ghost ${missingOnly ? 'active' : ''}`} disabled={!extraLanguages.length} onClick={() => setMissingOnly((value) => !value)}>仅看缺失{activeFocusLanguage ? ` · ${languageLabel(activeFocusLanguage)}` : ''}</button>
      <button className={`button ghost ${showVoice ? 'active' : ''}`} onClick={() => setShowVoice((value) => !value)}><MessageSquareText />语音列</button>
      <span className="workbench-count">已筛选 {visibleSlots.length} / {slots.length} 条</span>
      <span className="workbench-toolbar-spacer" />
      <button className="button ghost" disabled={!visibleSlots.length} onClick={() => setBatchFill({ language: BASE_COLUMN, text: '', overwrite: false })}><ClipboardPaste />批量填充默认语言</button>
    </div>

    <div className="text-table">
      <header className="text-table-head" style={{ gridTemplateColumns: gridTemplate }}>
        <span>位置</span>
        <span>{languageLabel(fallback)} <em>默认</em></span>
        {extraLanguages.map((language) => {
          const progress = totalFilled(language);
          return <span key={language} className="lang-head">
            <div><strong>{languageLabel(language)}</strong><small>{language} · {progress.percent}%</small></div>
            <nav>
              <button title="以默认语言预填空缺" onClick={() => fillMissingFromBase(language)}><Copy /></button>
              <button title="批量填充该语言" onClick={() => setBatchFill({ language, text: '', overwrite: false })}><ClipboardPaste /></button>
              <button title="清空该语言翻译" onClick={() => void clearLanguage(language)}><Eraser /></button>
            </nav>
          </span>;
        })}
      </header>
      <div className="text-table-body" ref={scrollRef} onScroll={list.onScroll}>
        <div className="text-table-canvas" style={{ height: list.layout.totalSize }}>
          {list.indexes.map((index) => {
            const slot = visibleSlots[index];
            return <MeasuredTextRow itemKey={slotRowId(slot)} top={list.layout.offsets[index]} measure={list.measure} className="text-row" style={{ gridTemplateColumns: gridTemplate }} key={slotRowId(slot)}>
              <button className="text-row-locate" title="在剧本中定位" onClick={() => activate(slot.fragmentId, slot.blockIndex)}>
                <strong>{slot.fragmentName}</strong>
                <small>Block {slot.blockIndex + 1} · {TEXT_SLOT_KIND_LABELS[slot.kind]}{slot.optionIndex !== undefined ? ` ${slot.optionIndex + 1}` : ''}</small>
                {slot.speakerName ? <em><CornerDownRight />{slot.speakerName}</em> : null}
                {!slot.baseText.trim() && <i>原文空缺</i>}
              </button>
              {renderCell(BASE_COLUMN, fallback, slot, index)}
              {extraLanguages.map((language) => renderCell(language, language, slot, index))}
            </MeasuredTextRow>;
          })}
          {!visibleSlots.length && <div className="text-table-empty"><Languages /><strong>没有匹配的文本行</strong><span>调整筛选条件，或先在剧本中添加对白、旁白与选项。</span></div>}
        </div>
      </div>
    </div>

    {batchFill && <div className="modal-backdrop" role="presentation" onClick={() => setBatchFill(null)}>
      <div className="modal text-batch-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header"><strong>批量填充 · {batchFill.language === BASE_COLUMN ? `${languageLabel(fallback)}（默认语言）` : languageLabel(batchFill.language)}</strong><button className="icon-button" onClick={() => setBatchFill(null)}><X /></button></header>
        <div className="modal-body">
          <p className="text-batch-hint">每行一条文本，将按当前筛选顺序（{visibleSlots.length} 行）依次填充；空行会被忽略。{!batchFill.overwrite && ' 已有内容不会被覆盖。'}</p>
          <textarea className="text-batch-input" autoFocus value={batchFill.text} onChange={(event) => setBatchFill((current) => current ? { ...current, text: event.target.value } : current)} placeholder={'第一行填充到第一个文本行\n第二行填充到下一个文本行\n…'} />
          <label className="text-batch-overwrite"><input type="checkbox" checked={batchFill.overwrite} onChange={(event) => setBatchFill((current) => current ? { ...current, overwrite: event.target.checked } : current)} />覆盖已有内容</label>
          <p className="text-batch-preview">{(() => {
            const lines = batchFill.text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length);
            const targets = visibleSlots.filter((slot) => batchFill.overwrite || !localizedValue(batchFill.language, slot).trim());
            const will = Math.min(lines.length, targets.length);
            return lines.length ? `将填充 ${will} 行${lines.length > will ? `，${lines.length - will} 行多余` : will < targets.length ? `，剩余 ${targets.length - will} 行保持原样` : ''}` : '粘贴文本后显示填充预览';
          })()}</p>
        </div>
        <footer className="modal-footer"><button className="button ghost" onClick={() => setBatchFill(null)}>取消</button><button className="button primary" onClick={applyBatchFill}><LocateFixed />按顺序填充</button></footer>
      </div>
    </div>}
  </div>;
}
