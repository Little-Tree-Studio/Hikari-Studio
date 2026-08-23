import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, FilePlus2, FolderOpen, Gamepad2, LayoutTemplate, LoaderCircle, Monitor, Pin, PinOff, RefreshCw } from 'lucide-react';
import { listRecentProjects, selectProjectLocation, setProjectCreationWindowMode, setProjectPinned } from '../api';
import { Select } from './ui/Select';
import type { Project, ProjectCreationOptions, RecentProject } from '../types';

type Props = {
  startInWizard?: boolean;
  onOpen: () => Promise<void>;
  onOpenRecent: (path: string) => Promise<void>;
  onCreate: (options: ProjectCreationOptions) => Promise<Project>;
  onCreated: () => void;
  ready?: boolean;
};

const RESOLUTIONS = ['3840x2160', '2560x1440', '1920x1080', '1600x900', '1366x768', '1280x720', '1920x1200', '1280x800', '1024x768', 'custom'] as const;
const STEPS = [
  ['选择模板', '选择项目的初始内容'],
  ['项目信息', '命名并设置保存位置'],
  ['画布配置', '设置画面与项目信息'],
  ['预览确认', '检查配置并创建项目'],
] as const;

const folderNameFor = (name: string) => name.trim().replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '') || 'new-project';
const joinPath = (parent: string, child: string) => parent ? `${parent.replace(/[\\/]+$/, '')}\\${child}` : '';
const displayValue = (value?: string) => value?.trim() || '未填写';

export function ProjectLaunchScreen({ startInWizard = false, onOpen, onOpenRecent, onCreate, onCreated, ready = true }: Props) {
  const [view, setView] = useState<'home' | 'wizard'>(startInWizard ? 'wizard' : 'home');
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [recentBusy, setRecentBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    try { setRecent(await listRecentProjects()); }
    catch (reason) { setError(String(reason)); }
  };
  useEffect(() => { void refresh(); }, []);
  const openRecent = async (path: string) => {
    setRecentBusy(true); setError('');
    try { await onOpenRecent(path); }
    catch (reason) { setError(String(reason)); }
    finally { setRecentBusy(false); }
  };
  const pin = async (item: RecentProject) => {
    try { setRecent(await setProjectPinned(item.path, !item.pinned)); }
    catch (reason) { setError(String(reason)); }
  };
  if (view === 'wizard') return <ProjectCreationWizard onBack={() => setView('home')} onCreate={onCreate} onCreated={onCreated} />;
  return <main className="project-launch-screen">
    <section className="launch-home">
      <header className="launch-brand"><div className="launch-logo"><img src="./assets/logo1.png" alt="" /></div><h1>Hikari Studio</h1><p>让灵感变成可以游玩的故事</p></header>
      <div className="launch-primary-actions">
        <button className="launch-create" disabled={!ready} onClick={() => setView('wizard')}>{ready ? <FilePlus2 /> : <LoaderCircle className="spin" />}<span>{ready ? '创建新项目' : '正在准备项目服务'}</span></button>
        <button className="launch-open" disabled={!ready} onClick={() => void onOpen()}><FolderOpen /><span>打开本地项目</span></button>
      </div>
      <section className="launch-recent">
        <header><div><Clock3 /><strong>最近项目</strong></div><button title="刷新最近项目" onClick={() => void refresh()}><RefreshCw /></button></header>
        <div className="launch-recent-list">
          {!recent.length && <div className="launch-empty"><FolderOpen /><strong>还没有最近项目</strong><span>创建项目后，它会出现在这里。</span></div>}
          {recent.map((item) => <article className={`${item.exists ? '' : 'missing'} ${item.pinned ? 'pinned' : ''}`} key={item.path}>
            <button className="launch-recent-main" disabled={!item.exists || recentBusy} onClick={() => void openRecent(item.path)}><span className="recent-project-icon">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{item.exists ? item.path : `项目已移动或删除 · ${item.path}`}</small></span><time>{new Date(item.updatedAt).toLocaleDateString()}</time><ArrowRight /></button>
            <button className="launch-pin" title={item.pinned ? '取消固定' : '固定项目'} onClick={() => void pin(item)}>{item.pinned ? <PinOff /> : <Pin />}</button>
          </article>)}
        </div>
      </section>
      {error && <div className="launch-error">{error}</div>}
      <footer>Hikari Studio · v0.4.0 Beta</footer>
    </section>
  </main>;
}

function ProjectCreationWizard({ onBack, onCreate, onCreated }: { onBack: () => void; onCreate: (options: ProjectCreationOptions) => Promise<Project>; onCreated: () => void }) {
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<'blank' | 'sample'>('blank');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [resolutionChoice, setResolutionChoice] = useState<(typeof RESOLUTIONS)[number]>('1920x1080');
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [windowTitle, setWindowTitle] = useState('');
  const [backgroundColor, setBackgroundColor] = useState('#101718');
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('准备项目目录');
  const [error, setError] = useState('');
  useEffect(() => {
    void setProjectCreationWindowMode(true);
    return () => { void setProjectCreationWindowMode(false); };
  }, []);
  const folderName = folderNameFor(name);
  const projectDirectory = joinPath(location, folderName);
  const resolution = useMemo<[number, number]>(() => resolutionChoice === 'custom' ? [customWidth, customHeight] : resolutionChoice.split('x').map(Number) as [number, number], [customHeight, customWidth, resolutionChoice]);
  const valid = step !== 1 || Boolean(name.trim());
  const chooseLocation = async () => { const selected = await selectProjectLocation(); if (selected) setLocation(selected); };
  const create = async () => {
    setCreating(true); setError(''); setProgress(8); setProgressLabel('准备项目目录');
    const phases = [[28, '创建项目结构'], [52, '写入模板内容'], [76, '配置画布与界面'], [90, '建立恢复与历史目录']] as const;
    let phase = 0;
    const timer = window.setInterval(() => { if (phase < phases.length) { setProgress(phases[phase][0]); setProgressLabel(phases[phase][1]); phase += 1; } }, 260);
    try {
      await onCreate({ template, name: name.trim(), projectDirectory: projectDirectory || undefined, author: author.trim(), description: description.trim(), resolution, windowTitle: windowTitle.trim() || name.trim(), backgroundColor });
      window.clearInterval(timer); setProgress(100); setProgressLabel('项目创建完成');
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      onCreated();
    } catch (reason) {
      window.clearInterval(timer); setCreating(false); setError(String(reason));
    }
  };
  return <main className="project-launch-screen creation-mode">
    <aside className="creation-sidebar">
      <button className="creation-back" onClick={onBack}><ArrowLeft />返回启动页</button>
      <div className="creation-brand"><div className="launch-logo small"><img src="./assets/logo1.png" alt="" /></div><span><strong>创建新项目</strong><small>Hikari Studio</small></span></div>
      <ol>{STEPS.map(([title, detail], index) => <li className={`${step === index ? 'active' : ''} ${step > index ? 'complete' : ''}`} key={title}><span>{step > index ? <Check /> : index + 1}</span><div><strong>{title}</strong><small>{detail}</small></div></li>)}</ol>
    </aside>
    <section className="creation-content">
      <header><small>步骤 {step + 1} / {STEPS.length}</small><h1>{STEPS[step][0]}</h1><p>{STEPS[step][1]}</p></header>
      <div className="creation-stage">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div className="creation-step" key={step} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: .2 }}>
            {step === 0 && <div className="template-grid">
              <button className={template === 'blank' ? 'selected' : ''} onClick={() => setTemplate('blank')}><div className="template-visual blank"><LayoutTemplate /></div><span><strong>空白模板</strong><small>从固定入口章节和空白主线开始，完全自由搭建。</small></span><i>{template === 'blank' && <Check />}</i></button>
              <button className={template === 'sample' ? 'selected' : ''} onClick={() => setTemplate('sample')}><div className="template-visual sample"><img src="./assets/lake.jpg" alt="示范项目画面" /><Gamepad2 /></div><span><strong>示范模板</strong><small>包含角色、场景、对白、分支与基础演出，可直接试玩。</small></span><i>{template === 'sample' && <Check />}</i></button>
            </div>}
            {step === 1 && <div className="creation-form narrow"><label><span>游戏名称 <b>*</b></span><input autoFocus value={name} maxLength={80} placeholder="例如：星海回声" onChange={(event) => { setName(event.target.value); if (!windowTitle) setWindowTitle(event.target.value); }} /><small>项目文件夹名称默认为：{folderName}</small></label><label><span>项目位置</span><div className="path-input"><input value={location} placeholder="使用默认项目目录" onChange={(event) => setLocation(event.target.value)} /><button title="选择项目位置" onClick={() => void chooseLocation()}><FolderOpen /></button></div><small>完整路径：{projectDirectory || `默认项目目录\\${folderName}`}</small></label></div>}
            {step === 2 && <div className="creation-form"><label><span>画布分辨率</span><Select value={resolutionChoice} onChange={(value) => setResolutionChoice(value as typeof resolutionChoice)}>{RESOLUTIONS.map((value) => <option value={value} key={value}>{value === 'custom' ? '自定义' : value}</option>)}</Select></label>{resolutionChoice === 'custom' && <div className="resolution-custom"><label><span>宽度</span><input type="number" min="640" max="7680" value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} /></label><span>×</span><label><span>高度</span><input type="number" min="360" max="4320" value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} /></label></div>}<label><span>作者名称 <em>可选</em></span><input value={author} maxLength={80} placeholder="创作者或团队名称" onChange={(event) => setAuthor(event.target.value)} /></label><label><span>项目描述 <em>可选</em></span><textarea value={description} maxLength={500} rows={4} placeholder="一段简单的游戏介绍" onChange={(event) => setDescription(event.target.value)} /></label><button className={`advanced-toggle ${advanced ? 'open' : ''}`} onClick={() => setAdvanced((value) => !value)}><span>高级设置</span><ChevronDown /></button>{advanced && <div className="advanced-fields"><label><span>窗口标题</span><input value={windowTitle} placeholder={name || '默认使用项目名称'} onChange={(event) => setWindowTitle(event.target.value)} /></label><label><span>背景色</span><div className="color-field"><input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} /><input value={backgroundColor} pattern="#[0-9a-fA-F]{6}" onChange={(event) => setBackgroundColor(event.target.value)} /></div></label></div>}</div>}
            {step === 3 && <div className="creation-review"><div className="project-preview" style={{ '--project-bg': backgroundColor } as React.CSSProperties}><div className="preview-stage"><span>{windowTitle || name || '未填写'}</span><small>{description || '项目描述未填写'}</small></div><div><Monitor /><strong>{resolution[0]} × {resolution[1]}</strong><span>{template === 'blank' ? '空白模板' : '示范模板'}</span></div></div><dl><div><dt>游戏名称</dt><dd>{displayValue(name)}</dd></div><div><dt>项目路径</dt><dd>{projectDirectory || `默认项目目录\\${folderName}`}</dd></div><div><dt>画布分辨率</dt><dd>{resolution[0]} × {resolution[1]}</dd></div><div><dt>作者名称</dt><dd>{displayValue(author)}</dd></div><div><dt>项目描述</dt><dd>{displayValue(description)}</dd></div><div><dt>窗口标题</dt><dd>{displayValue(windowTitle || name)}</dd></div><div><dt>背景色</dt><dd><i style={{ background: backgroundColor }} />{backgroundColor}</dd></div></dl></div>}
          </motion.div>
        </AnimatePresence>
        {error && <div className="creation-error">{error}</div>}
      </div>
      <footer><div><button className="button ghost" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft />上一步</button><span />{step < 3 ? <button className="button primary" disabled={!valid} onClick={() => setStep((value) => value + 1)}>下一步<ArrowRight /></button> : <button className="button primary create-final" disabled={!name.trim()} onClick={() => void create()}><FilePlus2 />创建项目</button>}</div></footer>
    </section>
    {creating && <div className="creation-progress-backdrop"><motion.section initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}><div className="progress-icon">{progress < 100 ? <LoaderCircle /> : <Check />}</div><strong>{progress < 100 ? '正在创建项目' : '项目已就绪'}</strong><span>{progressLabel}</span><div className="creation-progress"><i style={{ width: `${progress}%` }} /></div><code>{progress}%</code></motion.section></div>}
  </main>;
}
