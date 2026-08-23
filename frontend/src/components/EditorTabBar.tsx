import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, X } from 'lucide-react';

interface EditorTabBarProps {
  openFragmentIds: string[];
  activeFragmentId: string;
  fragmentNames: Map<string, string>;
  activateFragment: (id: string) => void;
  closeFragment: (id: string) => void;
  closeOtherFragments: () => void;
  closeAllFragments: () => void;
  reorderFragmentTabs: (fromId: string, toId: string) => void;
}

const MENU_WIDTH = 224;

export function EditorTabBar({ openFragmentIds, activeFragmentId, fragmentNames, activateFragment, closeFragment, closeOtherFragments, closeAllFragments, reorderFragmentTabs }: EditorTabBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [menuPoint, setMenuPoint] = useState<{ left: number; top: number } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const label = useCallback((fragmentId: string) => fragmentNames.get(fragmentId) ?? fragmentId, [fragmentNames]);

  const updateEdges = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const overflow = track.scrollWidth - track.clientWidth;
    setEdges({ left: track.scrollLeft > 4, right: overflow > 4 && track.scrollLeft < overflow - 4 });
  }, []);

  useLayoutEffect(() => { updateEdges(); }, [openFragmentIds, activeFragmentId, updateEdges]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (event: WheelEvent) => {
      if (track.scrollWidth <= track.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      track.scrollLeft += event.deltaY;
    };
    track.addEventListener('wheel', onWheel, { passive: false });
    return () => track.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(track);
    return () => observer.disconnect();
  }, [updateEdges]);

  useEffect(() => {
    const track = trackRef.current;
    const active = track?.querySelector<HTMLElement>('.doc-tab.active');
    if (!track || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    const viewLeft = track.scrollLeft;
    const viewRight = viewLeft + track.clientWidth;
    if (left - 8 < viewLeft) track.scrollTo({ left: Math.max(0, left - 8), behavior: 'smooth' });
    else if (right + 8 > viewRight) track.scrollTo({ left: right + 8 - track.clientWidth, behavior: 'smooth' });
  }, [activeFragmentId, openFragmentIds]);

  useEffect(() => {
    if (!menuPoint) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || moreRef.current?.contains(target)) return;
      setMenuPoint(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuPoint(null); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('pointerdown', onPointerDown, true); window.removeEventListener('keydown', onKeyDown); };
  }, [menuPoint]);

  const toggleMenu = () => {
    if (menuPoint) { setMenuPoint(null); return; }
    const rect = moreRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPoint({ left: Math.max(8, rect.right - MENU_WIDTH), top: Math.min(rect.bottom + 5, window.innerHeight - 260) });
  };

  return <div className={`tabs-row${edges.left ? ' edge-left' : ''}${edges.right ? ' edge-right' : ''}`}>
    <div className="tabs-track" ref={trackRef} onScroll={updateEdges}>
      {openFragmentIds.map((fragmentId) => <button className={`doc-tab${fragmentId === activeFragmentId ? ' active' : ''}${dropTargetId === fragmentId ? ' drop-before' : ''}`} draggable key={fragmentId} title={label(fragmentId)} onClick={() => activateFragment(fragmentId)} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); closeFragment(fragmentId); } }} onDragStart={(event) => event.dataTransfer.setData('text/hikari-fragment', fragmentId)} onDragOver={(event) => { event.preventDefault(); setDropTargetId((current) => (current === fragmentId ? current : fragmentId)); }} onDragLeave={() => setDropTargetId((current) => (current === fragmentId ? null : current))} onDrop={(event) => { event.preventDefault(); setDropTargetId(null); const fromId = event.dataTransfer.getData('text/hikari-fragment'); if (fromId) reorderFragmentTabs(fromId, fragmentId); }}><FileText className="tab-icon" /><span className="tab-label">{label(fragmentId)}</span><span className="tab-close" role="button" aria-label={`关闭 ${label(fragmentId)}`} title="关闭" onClick={(event) => { event.stopPropagation(); closeFragment(fragmentId); }}><X /></span></button>)}
    </div>
    <button ref={moreRef} type="button" className={`tabs-more${menuPoint ? ' open' : ''}`} title="已打开的片段" aria-haspopup="menu" aria-expanded={Boolean(menuPoint)} onClick={toggleMenu}><ChevronDown /></button>
    <span className="tabs-edge left" aria-hidden="true" />
    <span className="tabs-edge right" aria-hidden="true" />
    {menuPoint && <div className="context-menu tabs-menu" ref={menuRef} role="menu" style={menuPoint}>
      <strong>已打开 {openFragmentIds.length} 个片段</strong>
      {openFragmentIds.map((fragmentId) => <button key={fragmentId} type="button" role="menuitem" className={`tabs-menu-row${fragmentId === activeFragmentId ? ' active' : ''}`} onClick={() => { activateFragment(fragmentId); setMenuPoint(null); }}><FileText /><span>{label(fragmentId)}</span><span className="tabs-menu-close" role="button" aria-label={`关闭 ${label(fragmentId)}`} title="关闭" onClick={(event) => { event.stopPropagation(); closeFragment(fragmentId); }}><X /></span></button>)}
      <footer>
        <button type="button" onClick={() => { closeOtherFragments(); setMenuPoint(null); }}>关闭其他</button>
        <button type="button" onClick={() => { closeAllFragments(); setMenuPoint(null); }}>关闭全部</button>
      </footer>
    </div>}
  </div>;
}
