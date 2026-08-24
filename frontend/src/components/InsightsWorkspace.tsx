import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, BookText, ChartColumnBig, CircleDot, GitFork, MessageSquareText, Mic, PackageSearch, Timer } from 'lucide-react';
import type { Character, Project, StoryBlock } from '../types';

interface Props {
  project: Project;
  activate: (fragmentId: string) => void;
}

const READING_CHARS_PER_MINUTE = 300;
const BLOCK_LABELS: Record<string, string> = {
  scene: '场景', sound: '音频', characterShow: '角色登场', characterHide: '角色退场', camera: '镜头',
  narration: '旁白', dialogue: '对白', branch: '选项分支', setVariable: '变量赋值', modifyVariable: '变量增减', condition: '条件判断',
  jump: '跳转', call: '调用', return: '返回',
};

function countWords(text?: string) {
  return (text ?? '').replace(/\s/g, '').length;
}

function formatDuration(totalMinutes: number) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

interface ChapterStat {
  id: string;
  name: string;
  disabled: boolean;
  fragments: number;
  blocks: number;
  words: number;
  dialogueLines: number;
  choices: number;
  minutes: number;
}

interface SpeakerStat {
  key: string;
  name: string;
  color?: string;
  lines: number;
  words: number;
  voiced: number;
}

export function InsightsWorkspace({ project, activate }: Props) {
  const stats = useMemo(() => {
    const fragmentIds = new Set(Object.keys(project.scripts));
    const chapterStats: ChapterStat[] = [];
    const speakers = new Map<string, SpeakerStat>();
    let narrationWords = 0;
    let dialogueWords = 0;
    let dialogueLines = 0;
    let voicedLines = 0;
    let choiceCount = 0;
    let secondsTotal = 0;
    const blockCounts = new Map<string, number>();
    const referencedAssets = new Set<string>();
    const branchIssues: Array<{ fragmentId: string; fragmentName: string; title: string; issue: string; option?: string }> = [];

    const characterByName = new Map<string, Character>();
    for (const character of project.characters) characterByName.set(character.name, character);

    const noteSpeaker = (name: string, words: number, voiced: boolean) => {
      const key = name || '未署名';
      const entry = speakers.get(key) ?? { key, name: key, color: characterByName.get(key)?.color, lines: 0, words: 0, voiced: 0 };
      entry.lines += 1;
      entry.words += words;
      if (voiced) entry.voiced += 1;
      speakers.set(key, entry);
    };

    for (const chapter of project.chapters) {
      const stat: ChapterStat = { id: chapter.id, name: chapter.name, disabled: Boolean(chapter.disabled), fragments: chapter.fragments.length, blocks: 0, words: 0, dialogueLines: 0, choices: 0, minutes: 0 };
      for (const fragment of chapter.fragments) {
        const blocks = project.scripts[fragment.id] ?? [];
        for (const block of blocks) {
          stat.blocks += 1;
          blockCounts.set(block.type, (blockCounts.get(block.type) ?? 0) + 1);
          if (block.duration && Number.isFinite(block.duration)) secondsTotal += block.duration;
          const words = countWords(block.text);
          if (block.type === 'narration') { narrationWords += words; stat.words += words; }
          if (block.type === 'dialogue') {
            dialogueLines += 1;
            stat.dialogueLines += 1;
            dialogueWords += words;
            stat.words += words;
            const voiced = Boolean(block.voice);
            if (voiced) voicedLines += 1;
            noteSpeaker(block.speaker ?? '', words, voiced);
          }
          if (block.type === 'branch') {
            const options = block.options ?? [];
            choiceCount += options.length;
            stat.choices += options.length;
            for (const option of options) {
              if (!option.target || !fragmentIds.has(option.target)) {
                branchIssues.push({ fragmentId: fragment.id, fragmentName: fragment.name, title: block.title ?? '未命名分支', issue: option.target ? `选项目标不存在：${option.target}` : '选项没有设置跳转目标', option: option.text });
              }
            }
            if (!options.length) branchIssues.push({ fragmentId: fragment.id, fragmentName: fragment.name, title: block.title ?? '未命名分支', issue: '分支没有任何选项' });
          }
          if ((block.type === 'jump' || block.type === 'call') && (!block.target || !fragmentIds.has(block.target))) {
            branchIssues.push({ fragmentId: fragment.id, fragmentName: fragment.name, title: BLOCK_LABELS[block.type] ?? block.type, issue: block.target ? `跳转目标不存在：${block.target}` : '没有设置跳转目标' });
          }
          if (block.type === 'condition') {
            for (const target of [block.trueTarget, block.falseTarget]) {
              if (target && !fragmentIds.has(target)) branchIssues.push({ fragmentId: fragment.id, fragmentName: fragment.name, title: '条件判断', issue: `条件目标不存在：${target}` });
            }
          }
          if ('assetId' in block && block.assetId) referencedAssets.add(block.assetId);
          if (block.type === 'scene') {
            for (const layer of block.layers ?? []) if (layer.assetId) referencedAssets.add(layer.assetId);
          }
        }
      }
      stat.minutes = stat.words / READING_CHARS_PER_MINUTE;
      chapterStats.push(stat);
    }

    const speakerStats = [...speakers.values()].sort((a, b) => b.words - a.words);
    const totalWords = narrationWords + dialogueWords;
    const minutes = totalWords / READING_CHARS_PER_MINUTE + secondsTotal / 60;
    return {
      chapterStats,
      speakerStats,
      blockCounts: [...blockCounts.entries()].sort((a, b) => b[1] - a[1]),
      branchIssues,
      totalWords,
      narrationWords,
      dialogueWords,
      dialogueLines,
      voicedLines,
      choiceCount,
      minutes,
      assetUsage: { used: referencedAssets.size, total: project.assets.length },
    };
  }, [project]);

  const maxChapterWords = Math.max(1, ...stats.chapterStats.map((chapter) => chapter.words));
  const maxSpeakerWords = Math.max(1, ...stats.speakerStats.map((speaker) => speaker.words));
  const maxBlockCount = Math.max(1, ...stats.blockCounts.map(([, count]) => count));
  const voiceCoverage = stats.dialogueLines ? Math.round((stats.voicedLines / stats.dialogueLines) * 100) : 0;
  const assetCoverage = stats.assetUsage.total ? Math.round((stats.assetUsage.used / stats.assetUsage.total) * 100) : 0;
  const fragmentName = (id: string) => project.chapters.flatMap((chapter) => chapter.fragments).find((fragment) => fragment.id === id)?.name ?? id;

  return <div className="insights-page">
    <header className="page-header">
      <div>
        <h1>制作洞察</h1>
        <p>基于当前剧本结构与素材引用的量化总览，数据随项目保存实时更新</p>
      </div>
      <div className="page-header-actions">
        <span className="insights-meta">{project.chapters.length} 章 · {project.chapters.reduce((count, chapter) => count + chapter.fragments.length, 0)} 个片段 · {project.assets.length} 项素材</span>
      </div>
    </header>
    <div className="insights-body">
      <section className="insights-kpis">
        <div className="insights-kpi"><span><BookText />总字数</span><strong>{stats.totalWords.toLocaleString()}</strong><small>旁白 {stats.narrationWords.toLocaleString()} · 对白 {stats.dialogueWords.toLocaleString()}</small></div>
        <div className="insights-kpi"><span><MessageSquareText />对白行</span><strong>{stats.dialogueLines.toLocaleString()}</strong><small>{stats.speakerStats.length} 位发言角色</small></div>
        <div className="insights-kpi"><span><GitFork />分支选项</span><strong>{stats.choiceCount.toLocaleString()}</strong><small>{stats.branchIssues.length ? `${stats.branchIssues.length} 处结构告警` : '结构完整'}</small></div>
        <div className="insights-kpi"><span><Timer />预计阅读时长</span><strong>{formatDuration(stats.minutes)}</strong><small>按 {READING_CHARS_PER_MINUTE} 字/分钟估算</small></div>
        <div className="insights-kpi"><span><Mic />语音覆盖</span><strong>{voiceCoverage}%</strong><small>{stats.voicedLines.toLocaleString()} / {stats.dialogueLines.toLocaleString()} 行已配置</small></div>
        <div className="insights-kpi"><span><PackageSearch />素材引用</span><strong>{assetCoverage}%</strong><small>{stats.assetUsage.used} / {stats.assetUsage.total} 项被剧本引用</small></div>
      </section>

      <div className="insights-columns">
        <section className="insights-card">
          <header><ChartColumnBig /><strong>章节构成</strong><small>字数、对白与选项在各章的分布</small></header>
          <table className="insights-table">
            <thead><tr><th>章节</th><th className="num">片段</th><th className="num">Block</th><th className="num">对白</th><th className="num">选项</th><th className="bar-head">字数占比</th></tr></thead>
            <tbody>
              {stats.chapterStats.map((chapter) => <tr key={chapter.id} className={chapter.disabled ? 'muted-row' : ''}>
                <td className="insights-chapter-name" title={chapter.disabled ? '此章已禁用' : undefined}>{chapter.name}{chapter.disabled && <em>已禁用</em>}</td>
                <td className="num">{chapter.fragments}</td>
                <td className="num">{chapter.blocks}</td>
                <td className="num">{chapter.dialogueLines}</td>
                <td className="num">{chapter.choices}</td>
                <td className="bar-cell"><span className="insights-bar"><i style={{ width: `${Math.round((chapter.words / maxChapterWords) * 100)}%` }} /></span><small>{chapter.words.toLocaleString()}</small></td>
              </tr>)}
            </tbody>
          </table>
        </section>

        <section className="insights-card">
          <header><MessageSquareText /><strong>角色戏份</strong><small>按对白字数统计发言比重与语音配置</small></header>
          <ul className="insights-speakers">
            {stats.speakerStats.map((speaker) => <li key={speaker.key}>
              <span className="insights-speaker-dot" style={{ background: speaker.color ?? 'var(--muted-strong)' }} />
              <span className="insights-speaker-name">{speaker.name}</span>
              <span className="insights-bar"><i style={{ width: `${Math.round((speaker.words / maxSpeakerWords) * 100)}%`, background: speaker.color ?? 'var(--accent)' }} /></span>
              <small>{speaker.words.toLocaleString()} 字 · {speaker.lines} 行{stats.dialogueLines ? ` · ${Math.round((speaker.lines / stats.dialogueLines) * 100)}%` : ''}{speaker.voiced ? ` · 语音 ${speaker.voiced}` : ''}</small>
            </li>)}
            {!stats.speakerStats.length && <li className="insights-empty">项目还没有对白，角色统计将在写入第一行对白后出现。</li>}
          </ul>
        </section>

        <section className="insights-card">
          <header><CircleDot /><strong>Block 类型分布</strong><small>当前项目使用的指令构成</small></header>
          <ul className="insights-distribution">
            {stats.blockCounts.map(([type, count]) => <li key={type}>
              <span className="insights-type-name">{BLOCK_LABELS[type] ?? type}</span>
              <span className="insights-bar"><i style={{ width: `${Math.round((count / maxBlockCount) * 100)}%` }} /></span>
              <small>{count}</small>
            </li>)}
          </ul>
        </section>

        <section className="insights-card">
          <header><AlertTriangle /><strong>分支结构检查</strong><small>跳转目标与选项完整性，点击定位到对应片段</small></header>
          {stats.branchIssues.length
            ? <ul className="insights-issues">{stats.branchIssues.map((issue, index) => <li key={index}>
                <button type="button" onClick={() => activate(issue.fragmentId)} title="打开对应片段"><span>{issue.fragmentName} · {issue.title}</span><ArrowRight /></button>
                <small>{issue.issue}{issue.option ? `（选项：${issue.option}）` : ''}</small>
              </li>)}</ul>
            : <p className="insights-empty">所有分支选项、条件与跳转目标均可解析，没有发现悬空引用。</p>}
        </section>
      </div>
    </div>
  </div>;
}
