import { useEffect, useRef, useState } from 'react';
import { FilePlus2, FolderOpen, LoaderCircle, Pin, PinOff, RefreshCw } from 'lucide-react';
import { listRecentProjects, setProjectPinned } from '../api';
import type { Project, RecentProject } from '../types';

interface ProjectSwitcherProps {
  project: Project;
  onNew: () => void;
  onOpen: () => void;
  onSelect: (path: string) => Promise<void>;
  notify: (message: string, tone?: 'error' | 'success') => void;
}

export function ProjectSwitcher({ project, onNew, onOpen, onSelect, notify }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const root = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try { setRecent(await listRecentProjects()); }
    catch (error) { notify(String(error), 'error'); }
  };

  useEffect(() => {
    if (open) void refresh();
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const select = async (path: string) => {
    setBusy(true);
    try { await onSelect(path); setOpen(false); }
    finally { setBusy(false); }
  };

  const pin = async (item: RecentProject) => {
    try { setRecent(await setProjectPinned(item.path, !item.pinned)); }
    catch (error) { notify(String(error), 'error'); }
  };

  return <div className="project-switcher" ref={root}>
    <button className="project-select" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className="project-cover">{project.meta.name.slice(0, 1)}</span>
      <span><strong>{project.meta.name}</strong><small>{project.chapters.length} 章 · {Object.values(project.scripts).flat().length} Blocks</small></span>
      {busy ? <LoaderCircle className="spin" /> : <RefreshCw />}
    </button>
    {open && <div className="project-menu">
      <div className="project-menu-actions">
        <button onClick={() => { setOpen(false); onNew(); }}><FilePlus2 />新建项目</button>
        <button onClick={() => { setOpen(false); onOpen(); }}><FolderOpen />打开项目</button>
      </div>
      <div className="project-menu-title"><span>最近项目</span><button title="刷新" onClick={() => void refresh()}><RefreshCw /></button></div>
      <div className="recent-projects">
        {!recent.length && <div className="project-menu-empty">还没有最近项目</div>}
        {recent.map((item) => <div className={`recent-project ${item.exists ? '' : 'missing'}`} key={item.path}>
          <button className="recent-project-main" disabled={!item.exists || busy} onClick={() => void select(item.path)}>
            <strong>{item.name}</strong><small>{item.exists ? item.path : `文件不存在 · ${item.path}`}</small>
          </button>
          <button className="recent-pin" title={item.pinned ? '取消固定' : '固定项目'} onClick={() => void pin(item)}>{item.pinned ? <PinOff /> : <Pin />}</button>
        </div>)}
      </div>
    </div>}
  </div>;
}
