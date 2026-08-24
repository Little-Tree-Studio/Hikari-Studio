import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, bracketMatching, foldGutter, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { lintGutter, linter, type Diagnostic } from '@codemirror/lint';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { tags } from '@lezer/highlight';
import { AlignLeft, CircleAlert, WrapText } from 'lucide-react';
import { parseRenpyConditionLine, parseRenpySetLine } from '../core/scriptTextCodec';

export type ScriptCodeLanguage = 'json' | 'renpy';

export interface ScriptCodeEditorProps {
  language: ScriptCodeLanguage;
  value: string;
  onChange: (text: string) => void;
  /** 一键整理：返回整理后的文本，失败时抛出带中文说明的 Error */
  onFormat: (text: string) => string;
  characters?: string[];
  fragments?: { id: string; name: string }[];
  variables?: string[];
  ariaLabel: string;
}

const RENPY_KEYWORDS = ['scene', 'play', 'stop', 'menu', 'jump', 'call', 'return', 'label', 'pause', 'with', 'if', 'elif', 'else', 'define', 'default', 'show', 'hide', 'voice'];
const RENPY_CHANNELS = ['bgm', 'sfx', 'voice', 'sound', 'music', 'audio'];

const renpyLanguage = StreamLanguage.define({
  name: 'renpy',
  startState: () => ({}),
  token(stream) {
    if (stream.sol()) {
      if (stream.eat('#')) { stream.skipToEnd(); return 'comment'; }
      stream.eatSpace();
      if (stream.eol()) return null;
      if (stream.eat('$')) return 'keyword';
      if (stream.match(/^(scene|play|stop|menu|jump|call|return|label|pause|with|if|elif|else|show|hide|voice|define|default)\b/)) return 'keyword';
      if (stream.match(/^[^\s"']+/)) {
        return /^\s+["']/.test(stream.string.slice(stream.pos)) ? 'typeName' : 'variableName';
      }
    }
    if (stream.eatSpace()) return null;
    if (stream.eat('#')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^(==|!=|>=|<=|[+\-*/%]=|=|>|<)/)) return 'operator';
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string';
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number';
    const word = stream.match(/^[A-Za-z_一-鿿][\w一-鿿]*/);
    if (word && typeof word !== 'boolean') {
      const text = word[0];
      if (RENPY_KEYWORDS.includes(text)) return 'keyword';
      if (RENPY_CHANNELS.includes(text)) return 'atom';
      if (/^(true|false|none|null)$/i.test(text)) return 'atom';
      return 'variableName';
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
});

interface RenpyCompletionData {
  characters: string[];
  fragments: { id: string; name: string }[];
  variables: string[];
}

function renpyCompletionSource(data: RenpyCompletionData) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const beforeCursor = line.text.slice(0, context.pos - line.from);
    const word = context.matchBefore(/[\w一-鿿$-]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    if (/^(?:jump|call)\s+[\w-]*$/.test(beforeCursor)) {
      return {
        from: word.from,
        options: data.fragments.map((fragment) => ({ label: fragment.id, type: 'constant', detail: `片段 · ${fragment.name}` })),
        validFor: /^[\w-]*$/,
      };
    }
    if (/^(?:play|stop)\s+\w*$/.test(beforeCursor)) {
      return {
        from: word.from,
        options: ['bgm', 'sfx', 'voice'].map((channel) => ({ label: channel, type: 'keyword', detail: '声道' })),
        validFor: /^\w*$/,
      };
    }
    if (/^\$\s*[\w一-鿿]*$/.test(beforeCursor)) {
      return {
        from: word.from,
        options: data.variables.map((variable) => ({ label: variable, type: 'variable', detail: '变量' })),
        validFor: /^[\w一-鿿]*$/,
      };
    }
    if (/^if\s+[\w一-鿿]*$/.test(beforeCursor)) {
      return {
        from: word.from,
        options: data.variables.map((variable) => ({ label: variable, type: 'variable', detail: '变量' })),
        validFor: /^[\w一-鿿]*$/,
      };
    }
    if (/^if\s+[\w一-鿿]+\s+(?:==|!=|>=|<=|>|<)\s*\$?[\w一-鿿]*$/.test(beforeCursor)) {
      const options: Completion[] = [
        { label: 'true', type: 'atom', detail: '布尔值' },
        { label: 'false', type: 'atom', detail: '布尔值' },
        ...data.variables.map((variable) => ({ label: `$${variable}`, type: 'variable', detail: '比较变量' })),
      ];
      return { from: word.from, options, validFor: /^\$?[\w一-鿿]*$/ };
    }
    if (/^if\s+.*\belse\s+(?:jump\s+)?[\w-]*$/.test(beforeCursor)) {
      return {
        from: word.from,
        options: data.fragments.map((fragment) => ({ label: fragment.id, type: 'constant', detail: `片段 · ${fragment.name}` })),
        validFor: /^[\w-]*$/,
      };
    }
    if (/^if\s+.*\bjump\s+[\w-]*$/.test(beforeCursor)) {
      return {
        from: word.from,
        options: data.fragments.map((fragment) => ({ label: fragment.id, type: 'constant', detail: `片段 · ${fragment.name}` })),
        validFor: /^[\w-]*$/,
      };
    }
    if (/^\s*[\w一-鿿$]*$/.test(beforeCursor)) {
      const options: Completion[] = [
        snippetCompletion('scene ${}', { label: 'scene', type: 'keyword', detail: '切换场景' }),
        snippetCompletion('menu "${}"', { label: 'menu', type: 'keyword', detail: '分支菜单' }),
        snippetCompletion('jump ${}', { label: 'jump', type: 'keyword', detail: '跳转到片段' }),
        snippetCompletion('call ${}', { label: 'call', type: 'keyword', detail: '调用片段' }),
        snippetCompletion('play ${}', { label: 'play', type: 'keyword', detail: '播放音频' }),
        snippetCompletion('stop ${}', { label: 'stop', type: 'keyword', detail: '停止音频' }),
        { label: 'return', type: 'keyword', detail: '返回调用处' },
        snippetCompletion('$ ${} = ${}', { label: '$', type: 'keyword', detail: '设置变量' }),
        snippetCompletion('$ ${} += ${}', { label: '$ 增减', type: 'keyword', detail: '变量加减乘除' }),
        snippetCompletion('if ${} >= ${} jump ${} else jump ${}', { label: 'if', type: 'keyword', detail: '条件判断分支' }),
        snippetCompletion('"${}"', { label: '"旁白"', type: 'text', detail: '旁白文本' }),
        ...data.characters.map((name) => snippetCompletion(`${name} "\${}"`, { label: name, type: 'class', detail: '角色对白' })),
      ];
      return { from: word.from, options, validFor: /^[\w一-鿿$]*$/ };
    }
    return null;
  };
}

/** Ren'Py 视图的静态检查：未声明变量（读取）与不存在的跳转目标。 */
function renpyLinterSource(data: () => RenpyCompletionData) {
  return (view: EditorView): Diagnostic[] => {
    const { variables, fragments } = data();
    const declared = new Set(variables);
    const fragmentIds = new Set(fragments.map((fragment) => fragment.id));
    const diagnostics: Diagnostic[] = [];
    const jumpTargetIssue = (target: string, line: { from: number; to: number }) => {
      if (!fragmentIds.has(target)) diagnostics.push({ from: line.from, to: line.to, severity: 'error', message: `目标片段不存在：${target}` });
    };
    for (let index = 1; index <= view.state.doc.lines; index += 1) {
      const line = view.state.doc.line(index);
      const text = line.text.trim();
      if (!text || text.startsWith('#')) continue;
      const flow = /^(?:jump|call)\s+(\S+)/.exec(text);
      if (flow) { jumpTargetIssue(flow[1], line); continue; }
      const set = parseRenpySetLine(text);
      if (set) {
        if (!declared.has(set.variable)) diagnostics.push({ from: line.from, to: line.to, severity: 'warning', message: `变量“${set.variable}”未在叙事地图的变量面板中声明` });
        continue;
      }
      const condition = parseRenpyConditionLine(text);
      if (condition) {
        if (!declared.has(condition.variable)) diagnostics.push({ from: line.from, to: line.to, severity: 'warning', message: `条件使用了未声明变量：${condition.variable}` });
        if (condition.compareVariable && !declared.has(condition.compareVariable)) diagnostics.push({ from: line.from, to: line.to, severity: 'warning', message: `条件比较引用了未声明变量：${condition.compareVariable}` });
        if (condition.trueTarget) jumpTargetIssue(condition.trueTarget, line);
        if (condition.falseTarget) jumpTargetIssue(condition.falseTarget, line);
        if (!condition.trueTarget && !condition.falseTarget) diagnostics.push({ from: line.from, to: line.to, severity: 'warning', message: '条件没有配置跳转目标，将始终继续执行下一行' });
      }
    }
    return diagnostics;
  };
}

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#20272c', color: '#dbe3e7', fontSize: '13px' },
  '.cm-content': { padding: '16px 0 22px', fontFamily: '"Cascadia Code", Consolas, monospace', lineHeight: '1.8', caretColor: '#7dc6b8' },
  '.cm-gutters': { backgroundColor: '#1b2226', color: '#56636b', border: 'none', borderRight: '1px solid #2b343a', fontFamily: '"Cascadia Code", Consolas, monospace' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '34px' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.045)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,.05)', color: '#9fb4bd' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: '#7dc6b8' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(125,198,184,.22) !important' },
  '.cm-selectionMatch': { backgroundColor: 'rgba(230,183,119,.18)' },
  '.cm-searchMatch': { backgroundColor: 'rgba(230,183,119,.28)', outline: '1px solid rgba(230,183,119,.4)' },
  '.cm-searchMatch-selected': { backgroundColor: 'rgba(230,183,119,.5)' },
  '.cm-panels': { backgroundColor: '#1b2226', color: '#dbe3e7', borderBottom: '1px solid #2b343a' },
  '.cm-panels input, .cm-panels button': { backgroundColor: '#242d33', color: '#dbe3e7', border: '1px solid #35424a', borderRadius: '4px' },
  '.cm-panels button:hover': { backgroundColor: '#2a353c' },
  '.cm-panel.cm-search [name="close"]': { color: '#8fa3ad' },
  '.cm-tooltip': { backgroundColor: '#242d33', border: '1px solid #35424a', color: '#dbe3e7' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#35424a' },
  '.cm-tooltip .cm-tooltip-arrow:after': { borderTopColor: '#242d33' },
  '.cm-tooltip-autocomplete ul li': { padding: '2px 8px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'rgba(125,198,184,.22)', color: '#fff' },
  '.cm-completionDetail': { color: '#76858e', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-completionMatchedText': { color: '#7dc6b8', textDecoration: 'none', fontWeight: '700' },
  '.cm-lintRange-error': { textDecoration: 'underline wavy #e06c75', textUnderlineOffset: '3px' },
  '.cm-gutter-lint .cm-gutterElement': { padding: '0 3px' },
  '.cm-foldGutter span': { color: '#56636b', cursor: 'pointer' },
  '.cm-foldGutter span:hover': { color: '#9fb4bd' },
  '.cm-foldPlaceholder': { backgroundColor: 'rgba(125,198,184,.12)', border: '1px solid rgba(125,198,184,.3)', color: '#7dc6b8', borderRadius: '3px', padding: '0 5px', margin: '0 2px' },
}, { dark: true });

const editorHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#7dc6b8', fontWeight: '600' },
  { tag: tags.string, color: '#e6b777' },
  { tag: tags.comment, color: '#76858e', fontStyle: 'italic' },
  { tag: tags.number, color: '#d19ad9' },
  { tag: tags.bool, color: '#d19ad9' },
  { tag: tags.null, color: '#d19ad9' },
  { tag: tags.atom, color: '#8ec9f0' },
  { tag: tags.typeName, color: '#f2a29b' },
  { tag: tags.propertyName, color: '#8ec9f0' },
  { tag: tags.variableName, color: '#dbe3e7' },
  { tag: tags.operator, color: '#9fb4bd' },
  { tag: tags.punctuation, color: '#8b99a2' },
]);

function buildExtensions(language: ScriptCodeLanguage, completionData: () => RenpyCompletionData, wrap: Compartment, onDocChange: (text: string) => void): Extension[] {
  const base: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    editorTheme,
    syntaxHighlighting(editorHighlight, { fallback: true }),
    wrap.of(EditorView.lineWrapping),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => { if (update.docChanged) onDocChange(update.state.doc.toString()); }),
    EditorView.contentAttributes.of({ 'aria-label': language === 'json' ? 'JSON 编辑器' : "Ren'Py 编辑器" }),
  ];
  if (language === 'json') {
    return [json(), linter(jsonParseLinter()), lintGutter(), foldGutter(), indentUnit.of('  '), EditorState.tabSize.of(2), autocompletion({ activateOnTyping: true, maxRenderedOptions: 60 }), ...base];
  }
  return [renpyLanguage, linter(renpyLinterSource(completionData)), lintGutter(), autocompletion({ override: [renpyCompletionSource(completionData())], activateOnTyping: true, maxRenderedOptions: 60 }), ...base];
}

export const ScriptCodeEditor = memo(function ScriptCodeEditor({ language, value, onChange, onFormat, characters = [], fragments = [], variables = [] }: ScriptCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onFormatRef = useRef(onFormat);
  const completionRef = useRef<RenpyCompletionData>({ characters, fragments, variables });
  const wrapCompartment = useRef(new Compartment());
  const [wrapped, setWrapped] = useState(true);
  const [formatError, setFormatError] = useState<string | null>(null);
  onChangeRef.current = onChange;
  onFormatRef.current = onFormat;
  completionRef.current = { characters, fragments, variables };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: buildExtensions(language, () => completionRef.current, wrapCompartment.current, (text) => onChangeRef.current(text)),
      }),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value }, selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) } });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapCompartment.current.reconfigure(wrapped ? EditorView.lineWrapping : []) });
  }, [wrapped]);

  useEffect(() => {
    if (!formatError) return;
    const timer = window.setTimeout(() => setFormatError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [formatError]);

  const stats = useMemo(() => ({ lines: value ? value.split('\n').length : 0, chars: value.length }), [value]);

  const runFormat = () => {
    const view = viewRef.current;
    if (!view) return;
    try {
      const text = view.state.doc.toString();
      const formatted = onFormatRef.current(text);
      if (formatted !== text) {
        const anchor = Math.min(view.state.selection.main.anchor, formatted.length);
        view.dispatch({ changes: { from: 0, to: text.length, insert: formatted }, selection: { anchor } });
      }
      setFormatError(null);
    } catch (error) {
      setFormatError(error instanceof Error ? error.message : String(error));
    }
  };

  return <div className="script-code-editor">
    <div className="code-editor-toolbar">
      <button type="button" title="按语法规则整理缩进与空白" onClick={runFormat}><AlignLeft />整理代码</button>
      <button type="button" className={wrapped ? 'active' : ''} title="切换自动换行" onClick={() => setWrapped((current) => !current)}><WrapText />自动换行</button>
      {formatError && <span className="code-editor-error"><CircleAlert />{formatError}</span>}
      <span className="code-editor-hint">Ctrl+F 搜索 · Ctrl+Space 补全 · Tab 缩进</span>
      <span className="code-editor-stats">{stats.lines} 行 · {stats.chars} 字符</span>
    </div>
    <div className="code-editor-host" ref={hostRef} />
  </div>;
});
