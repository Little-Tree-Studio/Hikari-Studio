import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { ChapterScheduleMode, Project } from '../types';
import { Select } from './ui/Select';

interface ChapterSchedulingSectionProps {
  project: Project;
  apply: (value: NonNullable<Project['settings']['chapterScheduling']>) => void;
}

export function ChapterSchedulingSection({ project, apply }: ChapterSchedulingSectionProps) {
  const initial = project.settings.chapterScheduling ?? { mode: 'basic' as const };
  const [mode, setMode] = useState<ChapterScheduleMode>(initial.mode);
  const [preprocessingChapterId, setPreprocessingChapterId] = useState(initial.preprocessingChapterId ?? '');
  const reset = () => {
    const value = project.settings.chapterScheduling ?? { mode: 'basic' as const };
    setMode(value.mode);
    setPreprocessingChapterId(value.preprocessingChapterId ?? '');
  };
  return <>
    <div className="chapter-scheduling-body">
      <div className="schedule-mode" role="radiogroup" aria-label="章节调度模式">
        <button className={mode === 'basic' ? 'active' : ''} role="radio" aria-checked={mode === 'basic'} onClick={() => setMode('basic')}><strong>基础调度</strong><span>按章节列表顺序运行，适合线性或轻分支作品</span></button>
        <button className={mode === 'advanced' ? 'active' : ''} role="radio" aria-checked={mode === 'advanced'} onClick={() => setMode('advanced')}><strong>高级调度</strong><span>由跳转、调用与条件 Block 完整控制章节流程</span></button>
      </div>
      <div className="field full"><label htmlFor="preprocessing-chapter">每章开始前执行的公共前处理章节</label><Select id="preprocessing-chapter" value={preprocessingChapterId} onChange={(value) => setPreprocessingChapterId(value)}><option value="">不执行公共前处理</option>{project.chapters.filter((chapter) => !chapter.disabled).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</Select><small>可用于初始化公共变量、界面状态与音频；直接预览单章时也会执行。</small></div>
      <div className="schedule-note"><strong>预览规则</strong><span>编辑器预览从当前章节的第一个 Block 开始。跨章节持续状态请使用完整流程调试。</span></div>
    </div>
    <footer className="settings-page-footer"><button className="button ghost" onClick={reset}><RotateCcw />重置</button><button className="button primary" onClick={() => apply({ mode, preprocessingChapterId: preprocessingChapterId || undefined })}><Check />应用调度</button></footer>
  </>;
}
