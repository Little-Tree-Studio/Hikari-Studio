import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, ChevronDown, ChevronRight, ClipboardPaste, Copy, Film, Flag, FolderTree, Image, Lock, Magnet, Music2, Pause, Play, Plus, Repeat2, RotateCcw, Trash2, Unlock, UserRound, Volume2, VolumeX, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Preview } from './Preview';
import { AudioWaveform } from './AudioWaveform';
import { Select } from './ui/Select';
import { Slider } from './ui/Slider';
import { blockIndexAtTime, easingBezier, evaluateTimelineAtTime, findTimelineClip, moveTimelineClips, rippleMoveTimelineClips, rippleTrimTimelineClip, snapTimelineTime, timelineForProject, trimTimelineClip, updateTimelineClip, updateTimelineKeyframe } from '../core/timeline';
import { readSmallValue, writeSmallValue } from '../core/storage';
import type { Project, StageTimeline, StoryBlock, TimelineClip, TimelineEasing, TimelineKeyframe, TimelineTrackKind } from '../types';

type Props = {
  project: Project;
  selectedBlock: number;
  commit: (updater: (project: Project) => Project, label?: string) => void;
  locateBlock: (index: number) => void;
  notify: (message: string, tone?: 'error' | 'success') => void;
};

type TimelineInteraction = {
  mode: 'move' | 'trim-start' | 'trim-end';
  clipId: string;
  clipIds: Set<string>;
  initial: StageTimeline;
  clientX: number;
  sourceTrackIndex: number;
  moved: boolean;
};
type MarqueeState = { left: number; top: number; width: number; height: number };
type TimelineClipboard = { version: 1; clips: Array<{ trackKind: TimelineTrackKind; clip: TimelineClip; block?: StoryBlock }> };

const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const TRACK_ICON = { scene: Image, character: UserRound, camera: Camera, audio: Music2 };
const TRACK_COLOR = { scene: 'var(--timeline-scene)', character: 'var(--timeline-character)', camera: 'var(--timeline-camera)', audio: 'var(--timeline-audio)' };
const EASING_NAMES: Record<TimelineEasing, string> = { linear: '线性', easeIn: '缓入', easeOut: '缓出', easeInOut: '缓入缓出', cubicBezier: '自定义贝塞尔' };
const PROPERTY_OPTIONS: Record<TimelineTrackKind, Array<[string, string]>> = {
  scene: [['opacity', '透明度']],
  character: [['x', '水平位置'], ['y', '垂直位置'], ['scale', '缩放'], ['opacity', '透明度']],
  camera: [['cameraX', '镜头 X'], ['cameraY', '镜头 Y'], ['zoom', '镜头缩放'], ['rotation', '旋转'], ['shake', '震动']],
  audio: [['volume', '音量']],
};

function blockForTrack(project: Project, kind: TimelineTrackKind): StoryBlock | null {
  if (kind === 'scene') {
    const scene = project.scenes?.[0];
    const layer = scene?.layers.at(-1);
    return { id: makeId('block'), type: 'scene', title: scene?.name ?? '新场景', sceneId: scene?.id, assetId: layer?.assetId, transition: 'dissolve', duration: 1 };
  }
  if (kind === 'character') {
    const character = project.characters[0];
    if (!character) return null;
    const expression = character.expressions[0] ?? '默认';
    return { id: makeId('block'), type: 'characterShow', characterId: character.id, expression, assetId: character.portraits?.[expression], position: 'center', x: 50, y: 100, scale: character.defaultScale ?? 1, opacity: 1, layer: character.defaultLayer ?? 0, animation: 'fade', duration: 1 };
  }
  if (kind === 'camera') return { id: makeId('block'), type: 'camera', cameraX: 0, cameraY: 0, zoom: 1, rotation: 0, shake: 0, filter: 'none', duration: 1 };
  const asset = project.assets.find((item) => item.kind === 'audio');
  return { id: makeId('block'), type: 'sound', title: asset?.name ?? '新音频', assetId: asset?.id, channel: asset?.audioCategory ?? 'bgm', action: 'play', volume: 1, loop: false, fadeDuration: 0, duration: asset?.duration ?? 2 };
}

function BezierEditor({ keyframe, onCommit }: { keyframe: TimelineKeyframe; onCommit: (bezier: [number, number, number, number]) => void }) {
  const [draft, setDraft] = useState(() => easingBezier(keyframe.easing, keyframe.bezier));
  const draftRef = useRef(draft);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragHandle = useRef<0 | 1 | null>(null);
  useEffect(() => { const next = easingBezier(keyframe.easing, keyframe.bezier); setDraft(next); draftRef.current = next; }, [keyframe.easing, keyframe.bezier]);
  const position = (index: 0 | 1, event: ReactPointerEvent<SVGCircleElement>) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height));
    setDraft((current) => { const next: [number, number, number, number] = index === 0 ? [Number(x.toFixed(3)), Number(y.toFixed(3)), current[2], current[3]] : [current[0], current[1], Number(x.toFixed(3)), Number(y.toFixed(3))]; draftRef.current = next; return next; });
  };
  const pointerDown = (index: 0 | 1, event: ReactPointerEvent<SVGCircleElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragHandle.current = index;
    position(index, event);
  };
  const pointerMove = (event: ReactPointerEvent<SVGCircleElement>) => { if (dragHandle.current !== null) position(dragHandle.current, event); };
  const pointerUp = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (dragHandle.current === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragHandle.current = null;
    onCommit(draftRef.current);
  };
  const point = (x: number, y: number) => `${x * 200},${(1 - y) * 112}`;
  return <div className="timeline-bezier-editor">
    <svg ref={svgRef} viewBox="0 0 200 112" aria-label="贝塞尔缓动曲线">
      <path className="bezier-grid" d="M0 28H200M0 56H200M0 84H200M50 0V112M100 0V112M150 0V112" />
      <line className="bezier-handle-line" x1="0" y1="112" x2={draft[0] * 200} y2={(1 - draft[1]) * 112} />
      <line className="bezier-handle-line" x1="200" y1="0" x2={draft[2] * 200} y2={(1 - draft[3]) * 112} />
      <path className="bezier-curve" d={`M0 112 C${point(draft[0], draft[1])} ${point(draft[2], draft[3])} 200 0`} />
      <circle className="bezier-endpoint" cx="0" cy="112" r="3" /><circle className="bezier-endpoint" cx="200" cy="0" r="3" />
      <circle className="bezier-control" cx={draft[0] * 200} cy={(1 - draft[1]) * 112} r="7" onPointerDown={(event) => pointerDown(0, event)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
      <circle className="bezier-control" cx={draft[2] * 200} cy={(1 - draft[3]) * 112} r="7" onPointerDown={(event) => pointerDown(1, event)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
    </svg>
    <div>{draft.map((value, index) => <label key={index}>{['X1', 'Y1', 'X2', 'Y2'][index]}<input type="number" min="0" max="1" step=".01" value={value} onChange={(event) => { const next = [...draft] as [number, number, number, number]; next[index] = Math.max(0, Math.min(1, Number(event.target.value))); setDraft(next); draftRef.current = next; onCommit(next); }} /></label>)}</div>
  </div>;
}

export function StageTimelineWorkspace({ project, selectedBlock, commit, locateBlock, notify }: Props) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sourceTimeline = timelineForProject(project, project.activeFragmentId);
  const [timeline, setTimeline] = useState<StageTimeline>(sourceTimeline);
  const timelineRef = useRef(timeline);
  const [playhead, setPlayhead] = useState(0);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(72);
  const [snapping, setSnapping] = useState(true);
  const [rippleEditing, setRippleEditing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [primaryClipId, setPrimaryClipId] = useState<string>();
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string>();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeState>();
  const interactionRef = useRef<TimelineInteraction | undefined>(undefined);
  const marqueeRef = useRef<{ x: number; y: number; additive: boolean; moved: boolean } | undefined>(undefined);
  const trackResizeRef = useRef<{ trackId: string; y: number; height: number; moved: boolean } | undefined>(undefined);
  const rulerScrubRef = useRef(false);
  const scrubAudioRef = useRef<Record<string, HTMLAudioElement>>({});
  const playStartRef = useRef({ time: 0, clock: 0 });
  const activeFragmentRef = useRef(project.activeFragmentId);

  const persistedTimeline = project.timelines?.[project.activeFragmentId];
  const activeScript = project.scripts[project.activeFragmentId];
  useEffect(() => {
    const next = timelineForProject(project, project.activeFragmentId);
    const fragmentChanged = activeFragmentRef.current !== project.activeFragmentId;
    activeFragmentRef.current = project.activeFragmentId;
    setTimeline(next);
    timelineRef.current = next;
    setSelectedClipIds((current) => new Set([...current].filter((id) => findTimelineClip(next, id))));
    setPrimaryClipId((current) => current && findTimelineClip(next, current) ? current : undefined);
    if (fragmentChanged) { setPlayhead(0); setPlaying(false); setSelectedKeyframeId(undefined); }
  }, [project.activeFragmentId, persistedTimeline, activeScript]);

  useEffect(() => { timelineRef.current = timeline; }, [timeline]);
  useEffect(() => {
    if (!playing) return;
    playStartRef.current = { time: playhead, clock: performance.now() };
    let frame = 0;
    const tick = (clock: number) => {
      const next = playStartRef.current.time + (clock - playStartRef.current.clock) / 1000;
      const loop = timelineRef.current.loopRegion;
      if (loop?.enabled && loop.end > loop.start && next >= loop.end) {
        playStartRef.current = { time: loop.start, clock };
        setPlayhead(loop.start); frame = requestAnimationFrame(tick); return;
      }
      if (next >= timelineRef.current.duration) { setPlayhead(0); setPlaying(false); return; }
      setPlayhead(next); frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => () => { Object.values(scrubAudioRef.current).forEach((audio) => audio.pause()); }, []);
  useEffect(() => { const index = blockIndexAtTime(project, timeline, playhead); if (index !== selectedBlock) locateBlock(index); }, [playhead]);

  const persist = (next: StageTimeline, label: string, durationClipIds: ReadonlySet<string> = new Set()) => {
    setTimeline(next); timelineRef.current = next;
    const durations = new Map(next.tracks.flatMap((track) => track.clips.filter((clip) => durationClipIds.has(clip.id) && clip.blockId).map((clip) => [clip.blockId!, clip.duration] as const)));
    commit((current) => ({
      ...current,
      scripts: durations.size ? { ...current.scripts, [current.activeFragmentId]: current.scripts[current.activeFragmentId].map((block) => durations.has(block.id) && 'duration' in block ? { ...block, duration: durations.get(block.id) } as StoryBlock : block) } : current.scripts,
      timelines: { ...(current.timelines ?? {}), [current.activeFragmentId]: next },
    }), label);
  };

  const orderedClipIds = () => timeline.tracks.flatMap((track) => [...track.clips].sort((left, right) => left.start - right.start).map((clip) => clip.id));
  const selectForPointer = (clipId: string, event: ReactPointerEvent) => {
    let next = new Set(selectedClipIds);
    if (event.shiftKey && primaryClipId) {
      const ordered = orderedClipIds(); const from = ordered.indexOf(primaryClipId); const to = ordered.indexOf(clipId);
      if (from >= 0 && to >= 0) next = new Set(ordered.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else if (event.ctrlKey || event.metaKey) {
      if (next.has(clipId)) {
        next.delete(clipId);
        setSelectedClipIds(next); setPrimaryClipId([...next].at(-1)); setSelectedKeyframeId(undefined);
        return null;
      }
      next.add(clipId);
    } else if (!next.has(clipId)) next = new Set([clipId]);
    setSelectedClipIds(next); setPrimaryClipId(clipId); setSelectedKeyframeId(undefined);
    return next;
  };

  const beginInteraction = (mode: TimelineInteraction['mode'], clip: TimelineClip, trackIndex: number, event: ReactPointerEvent<HTMLElement>) => {
    const track = timeline.tracks[trackIndex];
    if (track.locked) return;
    event.preventDefault(); event.stopPropagation();
    const ids = mode === 'move' ? selectForPointer(clip.id, event) : new Set([clip.id]);
    if (!ids) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode !== 'move') { setSelectedClipIds(ids); setPrimaryClipId(clip.id); }
    interactionRef.current = { mode, clipId: clip.id, clipIds: ids, initial: timeline, clientX: event.clientX, sourceTrackIndex: trackIndex, moved: false };
  };
  const updateInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    const dx = (event.clientX - interaction.clientX) / pixelsPerSecond;
    interaction.moved ||= Math.abs(dx) > .005;
    const source = findTimelineClip(interaction.initial, interaction.clipId);
    if (!source) return;
    let next = interaction.initial;
    if (interaction.mode === 'move') {
      const raw = source.clip.start + dx;
      const snapped = snapping ? snapTimelineTime(raw, interaction.initial, interaction.clipIds) : Math.max(0, raw);
      const lane = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-track-id]');
      const targetIndex = lane ? interaction.initial.tracks.findIndex((track) => track.id === lane.dataset.trackId) : interaction.sourceTrackIndex;
      const trackDelta = targetIndex >= 0 ? targetIndex - interaction.sourceTrackIndex : 0;
      interaction.moved ||= trackDelta !== 0;
      next = rippleEditing ? rippleMoveTimelineClips(interaction.initial, interaction.clipIds, snapped - source.clip.start, trackDelta) : moveTimelineClips(interaction.initial, interaction.clipIds, snapped - source.clip.start, trackDelta);
    } else {
      const edge = interaction.mode === 'trim-start' ? source.clip.start + dx : source.clip.start + source.clip.duration + dx;
      const snapped = snapping ? snapTimelineTime(edge, interaction.initial, interaction.clipId) : edge;
      const edgeKind = interaction.mode === 'trim-start' ? 'start' : 'end';
      next = rippleEditing ? rippleTrimTimelineClip(interaction.initial, interaction.clipId, edgeKind, snapped) : trimTimelineClip(interaction.initial, interaction.clipId, edgeKind, snapped);
    }
    setTimeline(next); timelineRef.current = next;
  };

  const beginMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    marqueeRef.current = { x: event.clientX, y: event.clientY, additive: event.ctrlKey || event.metaKey, moved: false };
    setMarquee({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
  };
  const updateMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = marqueeRef.current;
    if (!origin) return;
    origin.moved ||= Math.abs(event.clientX - origin.x) > 3 || Math.abs(event.clientY - origin.y) > 3;
    setMarquee({ left: Math.min(origin.x, event.clientX), top: Math.min(origin.y, event.clientY), width: Math.abs(event.clientX - origin.x), height: Math.abs(event.clientY - origin.y) });
  };
  const finishMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = marqueeRef.current;
    if (!origin) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    marqueeRef.current = undefined; setMarquee(undefined);
    if (!origin.moved) {
      if (!origin.additive) { setSelectedClipIds(new Set()); setPrimaryClipId(undefined); setSelectedKeyframeId(undefined); }
      const lane = event.currentTarget.getBoundingClientRect(); seek((event.clientX - lane.left) / pixelsPerSecond);
      return;
    }
    const rectangle = { left: Math.min(origin.x, event.clientX), right: Math.max(origin.x, event.clientX), top: Math.min(origin.y, event.clientY), bottom: Math.max(origin.y, event.clientY) };
    const matches = [...(workspaceRef.current?.querySelectorAll<HTMLElement>('.timeline-clip') ?? [])].filter((element) => { const bounds = element.getBoundingClientRect(); return bounds.right >= rectangle.left && bounds.left <= rectangle.right && bounds.bottom >= rectangle.top && bounds.top <= rectangle.bottom; }).map((element) => element.dataset.clipId).filter((id): id is string => Boolean(id));
    const next = new Set(origin.additive ? selectedClipIds : []); matches.forEach((id) => next.add(id));
    setSelectedClipIds(next); setPrimaryClipId(matches.at(-1) ?? [...next].at(-1)); setSelectedKeyframeId(undefined);
  };

  const beginTrackResize = (trackId: string, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    trackResizeRef.current = { trackId, y: event.clientY, height: timeline.tracks.find((track) => track.id === trackId)?.height ?? 54, moved: false };
  };
  const updateTrackResize = (event: ReactPointerEvent<HTMLElement>) => {
    const resize = trackResizeRef.current;
    if (!resize) return;
    const height = Math.max(42, Math.min(140, resize.height + event.clientY - resize.y));
    resize.moved ||= Math.abs(height - resize.height) > 1;
    const next = { ...timelineRef.current, tracks: timelineRef.current.tracks.map((track) => track.id === resize.trackId ? { ...track, height: Math.round(height) } : track) };
    setTimeline(next); timelineRef.current = next;
  };
  const finishTrackResize = (event: ReactPointerEvent<HTMLElement>) => {
    const resize = trackResizeRef.current;
    if (!resize) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    trackResizeRef.current = undefined;
    if (resize.moved) persist(timelineRef.current, '调整时间轴轨道高度');
  };
  const finishInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    interactionRef.current = undefined;
    if (!interaction.moved) return;
    const trimming = interaction.mode !== 'move';
    persist(timelineRef.current, trimming ? `裁剪时间轴片段${interaction.mode === 'trim-start' ? '左侧' : '右侧'}` : interaction.clipIds.size > 1 ? `移动 ${interaction.clipIds.size} 个时间轴片段` : '移动时间轴片段', trimming ? new Set([interaction.clipId]) : new Set());
  };

  const seek = (time: number) => setPlayhead(Math.max(0, Math.min(timeline.duration, snapping ? snapTimelineTime(time, timeline) : time)));
  const auditionAt = (time: number) => {
    const preview = evaluateTimelineAtTime(timelineRef.current, time);
    const activeChannels = new Set<string>();
    const audioTrack = timelineRef.current.tracks.find((track) => track.kind === 'audio' && !track.muted);
    for (const clip of audioTrack?.clips ?? []) {
      if (time < clip.start || time > clip.start + clip.duration) continue;
      const channel = clip.audioChannel ?? 'bgm'; activeChannels.add(channel);
      const asset = project.assets.find((item) => item.id === clip.assetId);
      if (!asset?.uri) continue;
      let audio = scrubAudioRef.current[channel];
      if (!audio || audio.dataset.assetId !== asset.id) { audio?.pause(); audio = new Audio(asset.uri); audio.dataset.assetId = asset.id; scrubAudioRef.current[channel] = audio; }
      const sourceTime = Math.max(0, (clip.sourceOffset ?? 0) + time - clip.start);
      const update = () => { try { audio.currentTime = Math.min(sourceTime, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - .01) : sourceTime); } catch { /* Metadata may not be ready yet. */ } };
      if (audio.readyState >= 1) update(); else audio.onloadedmetadata = update;
      audio.volume = Math.max(0, Math.min(1, preview.audio[channel]?.volume ?? 1));
      void audio.play().catch(() => undefined);
    }
    for (const [channel, audio] of Object.entries(scrubAudioRef.current)) if (!activeChannels.has(channel)) audio.pause();
  };
  const stopAudition = () => Object.values(scrubAudioRef.current).forEach((audio) => audio.pause());
  const beginRulerScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId); rulerScrubRef.current = true; setPlaying(false);
    const bounds = event.currentTarget.getBoundingClientRect(); const time = (event.clientX - bounds.left) / pixelsPerSecond; seek(time); auditionAt(time);
  };
  const updateRulerScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rulerScrubRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect(); const time = Math.max(0, Math.min(timelineRef.current.duration, (event.clientX - bounds.left) / pixelsPerSecond)); seek(time); auditionAt(time);
  };
  const finishRulerScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rulerScrubRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    rulerScrubRef.current = false; stopAudition();
  };
  const addClip = (kind: TimelineTrackKind) => {
    const block = blockForTrack(project, kind);
    if (!block) { notify(kind === 'character' ? '请先创建角色再添加角色片段' : '无法创建时间轴片段', 'error'); return; }
    const target = timeline.tracks.find((track) => track.kind === kind)!;
    const clip: TimelineClip = { id: makeId('clip'), name: kind === 'scene' ? '新场景' : kind === 'character' ? '角色演出' : kind === 'camera' ? '镜头运动' : '音频', start: playhead, duration: Math.max(.25, 'duration' in block ? block.duration ?? 1 : 1), blockId: block.id, assetId: 'assetId' in block ? block.assetId : undefined, characterId: 'characterId' in block ? block.characterId : undefined, audioChannel: block.type === 'sound' ? block.channel : undefined, sourceOffset: 0, keyframes: [] };
    const next = updateTimelineClip({ ...timeline, tracks: timeline.tracks.map((track) => track.id === target.id ? { ...track, clips: [...track.clips, clip] } : track) }, clip.id, {});
    setTimeline(next); timelineRef.current = next;
    commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: [...current.scripts[current.activeFragmentId], block] }, timelines: { ...(current.timelines ?? {}), [current.activeFragmentId]: next } }), `添加${clip.name}时间轴片段`);
    setSelectedClipIds(new Set([clip.id])); setPrimaryClipId(clip.id); setSelectedKeyframeId(undefined); setAddMenuOpen(false); notify(`${clip.name}已添加并链接到 Story Block`);
  };

  const selected = primaryClipId ? findTimelineClip(timeline, primaryClipId) : null;
  const selectedKeyframe = selected?.clip.keyframes.find((keyframe) => keyframe.id === selectedKeyframeId);
  const deleteSelected = () => {
    if (!selectedClipIds.size) return;
    const blockIds = new Set(timeline.tracks.flatMap((track) => track.clips.filter((clip) => selectedClipIds.has(clip.id)).map((clip) => clip.blockId).filter(Boolean)));
    const next = { ...timeline, tracks: timeline.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => !selectedClipIds.has(clip.id)) })) };
    commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: current.scripts[current.activeFragmentId].filter((block) => !blockIds.has(block.id)) }, timelines: { ...(current.timelines ?? {}), [current.activeFragmentId]: next } }), `删除 ${selectedClipIds.size} 个时间轴片段`);
    setTimeline(next); timelineRef.current = next; setSelectedClipIds(new Set()); setPrimaryClipId(undefined); setSelectedKeyframeId(undefined);
  };
  const copySelected = () => {
    if (!selectedClipIds.size) return;
    const script = project.scripts[project.activeFragmentId] ?? [];
    const clips = timeline.tracks.flatMap((track) => track.clips.filter((clip) => selectedClipIds.has(clip.id)).map((clip) => ({ trackKind: track.kind, clip: structuredClone(clip), block: clip.blockId ? structuredClone(script.find((block) => block.id === clip.blockId)) : undefined })));
    const payload: TimelineClipboard = { version: 1, clips };
    writeSmallValue('slide-timeline-clipboard', JSON.stringify(payload));
    notify(`已复制 ${clips.length} 个时间轴片段`);
  };
  const pasteSelected = () => {
    const encoded = readSmallValue('slide-timeline-clipboard');
    if (!encoded) { notify('时间轴剪贴板为空', 'error'); return; }
    let payload: TimelineClipboard;
    try { payload = JSON.parse(encoded) as TimelineClipboard; } catch { notify('时间轴剪贴板内容损坏', 'error'); return; }
    if (payload.version !== 1 || !Array.isArray(payload.clips) || !payload.clips.length) { notify('时间轴剪贴板没有可粘贴片段', 'error'); return; }
    const origin = Math.min(...payload.clips.map((item) => item.clip.start));
    const blocks: StoryBlock[] = [];
    const createdIds = new Set<string>();
    const tracks = timeline.tracks.map((track) => ({ ...track, clips: [...track.clips] }));
    for (const item of payload.clips) {
      const blockId = item.block ? makeId('block') : undefined;
      if (item.block) blocks.push({ ...structuredClone(item.block), id: blockId! });
      const clip: TimelineClip = { ...structuredClone(item.clip), id: makeId('clip'), blockId, start: Number((playhead + item.clip.start - origin).toFixed(3)), keyframes: item.clip.keyframes.map((keyframe) => ({ ...structuredClone(keyframe), id: makeId('keyframe') })) };
      const target = tracks.find((track) => track.kind === item.trackKind && !track.locked) ?? tracks.find((track) => !track.locked);
      if (target) { target.clips.push(clip); createdIds.add(clip.id); }
    }
    if (!createdIds.size) { notify('没有可写入的未锁定轨道', 'error'); return; }
    const duration = Math.max(timeline.duration, 8, ...tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration + 1)));
    const next = { ...timeline, duration: Math.ceil(duration), tracks };
    setTimeline(next); timelineRef.current = next;
    commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: [...current.scripts[current.activeFragmentId], ...blocks] }, timelines: { ...(current.timelines ?? {}), [current.activeFragmentId]: next } }), `粘贴 ${createdIds.size} 个时间轴片段`);
    setSelectedClipIds(createdIds); setPrimaryClipId([...createdIds].at(-1)); setSelectedKeyframeId(undefined); notify(`已粘贴 ${createdIds.size} 个片段到播放头`);
  };
  const createTrackGroup = () => {
    const trackIds = timeline.tracks.filter((track) => track.clips.some((clip) => selectedClipIds.has(clip.id))).map((track) => track.id);
    if (!trackIds.length) { notify('请先选择需要分组的轨道中的片段', 'error'); return; }
    const groupId = makeId('track-group');
    const groups = [...(timeline.groups ?? []), { id: groupId, name: `轨道组 ${(timeline.groups?.length ?? 0) + 1}` }];
    persist({ ...timeline, groups, tracks: timeline.tracks.map((track) => trackIds.includes(track.id) ? { ...track, groupId } : track) }, `创建轨道组（${trackIds.length} 条轨道）`);
  };
  const toggleTrackGroup = (groupId: string) => persist({ ...timeline, groups: (timeline.groups ?? []).map((group) => group.id === groupId ? { ...group, collapsed: !group.collapsed } : group) }, '折叠或展开轨道组');
  const removeTrackGroup = (groupId: string) => persist({ ...timeline, groups: (timeline.groups ?? []).filter((group) => group.id !== groupId), tracks: timeline.tracks.map((track) => track.groupId === groupId ? { ...track, groupId: undefined } : track) }, '解除时间轴轨道组');
  const toggleTrackCollapsed = (trackId: string) => persist({ ...timeline, tracks: timeline.tracks.map((track) => track.id === trackId ? { ...track, collapsed: !track.collapsed } : track) }, '折叠或展开时间轴轨道');
  const addMarker = () => {
    const marker = { id: makeId('marker'), name: `标记 ${(timeline.markers?.length ?? 0) + 1}`, time: Number(playhead.toFixed(3)), color: 'var(--accent)' };
    persist({ ...timeline, markers: [...(timeline.markers ?? []), marker] }, '添加时间轴标记点');
  };
  const removeMarker = (markerId: string) => persist({ ...timeline, markers: (timeline.markers ?? []).filter((marker) => marker.id !== markerId) }, '删除时间轴标记点');
  const setLoopBoundary = (edge: 'start' | 'end') => {
    const current = timeline.loopRegion ?? { start: 0, end: Math.min(timeline.duration, 4), enabled: false };
    const next = edge === 'start' ? { ...current, start: Math.min(playhead, current.end - 1 / timeline.fps) } : { ...current, end: Math.max(playhead, current.start + 1 / timeline.fps) };
    persist({ ...timeline, loopRegion: next }, `设置循环${edge === 'start' ? '起点' : '终点'}`);
  };
  const toggleLoop = () => {
    const current = timeline.loopRegion ?? { start: 0, end: Math.min(timeline.duration, 4), enabled: false };
    persist({ ...timeline, loopRegion: { ...current, enabled: !current.enabled } }, current.enabled ? '关闭循环播放' : '开启循环播放');
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input,textarea,select,[contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedClipIds.size) { event.preventDefault(); copySelected(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelected(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedClipIds.size) { event.preventDefault(); deleteSelected(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playhead, project, selectedClipIds, timeline]);
  const addKeyframe = () => {
    if (!selected) return;
    const property = PROPERTY_OPTIONS[selected.track.kind][0][0];
    const value = property === 'x' || property === 'y' ? 50 : 1;
    const relative = Math.max(0, Math.min(selected.clip.duration, playhead - selected.clip.start));
    const keyframe: TimelineKeyframe = { id: makeId('keyframe'), time: relative, property, value, easing: 'easeInOut' };
    persist(updateTimelineClip(timeline, selected.clip.id, { keyframes: [...selected.clip.keyframes.filter((item) => Math.abs(item.time - relative) > .01 || item.property !== property), keyframe] }), '添加时间轴关键帧');
    setSelectedKeyframeId(keyframe.id);
  };
  const editKeyframe = (patch: Partial<TimelineKeyframe>, label = '编辑时间轴关键帧') => {
    if (!selected || !selectedKeyframe) return;
    persist(updateTimelineKeyframe(timeline, selected.clip.id, selectedKeyframe.id, patch), label);
  };
  const deleteKeyframe = () => {
    if (!selected || !selectedKeyframe) return;
    persist(updateTimelineClip(timeline, selected.clip.id, { keyframes: selected.clip.keyframes.filter((keyframe) => keyframe.id !== selectedKeyframe.id) }), '删除时间轴关键帧');
    setSelectedKeyframeId(undefined);
  };
  const moveStageCharacter = (characterId: string, x: number, y: number) => {
    const characterClip = timeline.tracks.find((track) => track.kind === 'character')?.clips.filter((clip) => clip.characterId === characterId && clip.start <= playhead).sort((left, right) => right.start - left.start)[0];
    if (!characterClip?.blockId) return;
    const relative = Math.max(0, Math.min(characterClip.duration, playhead - characterClip.start));
    const keyframes = characterClip.keyframes.filter((item) => !(Math.abs(item.time - relative) < .01 && (item.property === 'x' || item.property === 'y')));
    keyframes.push({ id: makeId('keyframe'), time: relative, property: 'x', value: x, easing: 'easeInOut' }, { id: makeId('keyframe'), time: relative, property: 'y', value: y, easing: 'easeInOut' });
    const next = updateTimelineClip(timeline, characterClip.id, { keyframes });
    commit((current) => ({ ...current, scripts: { ...current.scripts, [current.activeFragmentId]: current.scripts[current.activeFragmentId].map((block) => block.id === characterClip.blockId ? { ...block, position: 'custom', x, y } as StoryBlock : block) }, timelines: { ...(current.timelines ?? {}), [current.activeFragmentId]: next } }), '在时间轴调整角色位置');
    setTimeline(next); timelineRef.current = next; setSelectedClipIds(new Set([characterClip.id])); setPrimaryClipId(characterClip.id);
  };

  const width = Math.max(900, timeline.duration * pixelsPerSecond);
  const editorIndex = blockIndexAtTime(project, timeline, playhead);
  return <div className="stage-timeline-workspace" data-testid="stage-timeline-workspace" ref={workspaceRef}>
    <header className="stage-timeline-toolbar">
      <div><Film /><strong>演出设计</strong><span>{project.activeFragmentId}</span></div>
      <div className="timeline-transport"><button className="icon-button" title="回到开始" onClick={() => { setPlaying(false); setPlayhead(0); }}><RotateCcw /></button><button className="icon-button primary" title={playing ? '暂停' : '播放'} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}</button><code>{playhead.toFixed(2)}s / {timeline.duration.toFixed(2)}s</code></div>
      <div className="timeline-tools"><button className={`button compact ${rippleEditing ? 'active' : ''}`} title="移动或右裁剪时自动推移后续片段" onClick={() => setRippleEditing((value) => !value)}>波纹</button><button className="icon-button" title="创建轨道组" onClick={createTrackGroup}><FolderTree /></button><button className="icon-button" title="添加标记点" onClick={addMarker}><Flag /></button><button className={`icon-button ${timeline.loopRegion?.enabled ? 'active' : ''}`} title="循环播放区间" onClick={toggleLoop}><Repeat2 /></button><button className="timeline-boundary-button" title="设置循环起点" onClick={() => setLoopBoundary('start')}>[</button><button className="timeline-boundary-button" title="设置循环终点" onClick={() => setLoopBoundary('end')}>]</button><button className="icon-button" title="复制所选片段" disabled={!selectedClipIds.size} onClick={copySelected}><Copy /></button><button className="icon-button" title="粘贴片段到播放头" onClick={pasteSelected}><ClipboardPaste /></button><button className={`icon-button ${snapping ? 'active' : ''}`} title="时间吸附" onClick={() => setSnapping((value) => !value)}><Magnet /></button><button className="icon-button" title="缩小时间轴" onClick={() => setPixelsPerSecond((value) => Math.max(40, value - 16))}><ZoomOut /></button><Slider className="timeline-zoom" ariaLabel="时间轴缩放" min={40} max={160} value={pixelsPerSecond} onChange={(value) => setPixelsPerSecond(value)} /><button className="icon-button" title="放大时间轴" onClick={() => setPixelsPerSecond((value) => Math.min(160, value + 16))}><ZoomIn /></button><div className="timeline-add"><button className="button primary" onClick={() => setAddMenuOpen((value) => !value)}><Plus />添加片段<ChevronDown /></button>{addMenuOpen && <div className="timeline-add-menu">{timeline.tracks.map((track) => { const Icon = TRACK_ICON[track.kind]; return <button key={track.kind} onClick={() => addClip(track.kind)}><Icon />{track.name}片段</button>; })}</div>}</div></div>
    </header>
    <div className="stage-timeline-upper">
      <section className="stage-timeline-preview"><Preview project={project} editorIndex={editorIndex} timelinePreview={evaluateTimelineAtTime(timeline, playhead)} onEditorLocationChange={(_, index) => locateBlock(index)} onStageCharacterMove={moveStageCharacter} /></section>
      <aside className="timeline-clip-inspector">
        <header><div><strong>片段属性</strong>{selectedClipIds.size > 1 && <span>{selectedClipIds.size} 项</span>}</div>{selected && <button className="icon-button danger" title="删除所选片段" onClick={deleteSelected}><Trash2 /></button>}</header>
        {selected ? <div className="timeline-inspector-fields">
          {selectedClipIds.size > 1 && <div className="timeline-multi-hint">正在批量选择。拖动任一所选片段可保持相对位置整体移动。</div>}
          <label>名称<input value={selected.clip.name} onChange={(event) => persist(updateTimelineClip(timeline, selected.clip.id, { name: event.target.value }), '重命名时间轴片段')} /></label>
          <label>开始时间<input aria-label="开始时间" type="number" min="0" step=".1" value={selected.clip.start} onChange={(event) => persist(updateTimelineClip(timeline, selected.clip.id, { start: Math.max(0, Number(event.target.value)) }), '调整片段开始时间')} /></label>
          <label>持续时间<input aria-label="持续时间" type="number" min=".1" step=".1" value={selected.clip.duration} onChange={(event) => persist(updateTimelineClip(timeline, selected.clip.id, { duration: Math.max(.1, Number(event.target.value)) }), '调整片段持续时间', new Set([selected.clip.id]))} /></label>
          <div className="timeline-keyframe-header"><strong>关键帧</strong><button className="button ghost" onClick={addKeyframe}><Plus />在播放头添加</button></div>
          {selected.clip.keyframes.length ? <div className="timeline-keyframe-list">{[...selected.clip.keyframes].sort((a, b) => a.time - b.time).map((keyframe) => <button className={`timeline-keyframe-row ${selectedKeyframeId === keyframe.id ? 'selected' : ''}`} key={keyframe.id} onClick={() => setSelectedKeyframeId(keyframe.id)}><span>{PROPERTY_OPTIONS[selected.track.kind].find(([value]) => value === keyframe.property)?.[1] ?? keyframe.property}</span><code>{keyframe.time.toFixed(2)}s</code><small>{String(keyframe.value)}</small></button>)}</div> : <p className="timeline-empty">尚无关键帧</p>}
          {selectedKeyframe && <section className="timeline-keyframe-inspector">
            <header><strong>关键帧属性</strong><button className="icon-button danger small" title="删除关键帧" onClick={deleteKeyframe}><Trash2 /></button></header>
            <div className="timeline-keyframe-grid"><label>时间<input aria-label="关键帧时间" type="number" min="0" max={selected.clip.duration} step=".01" value={selectedKeyframe.time} onChange={(event) => editKeyframe({ time: Number(event.target.value) })} /></label><label>属性<Select aria-label="关键帧属性" value={selectedKeyframe.property} onChange={(value) => editKeyframe({ property: value })}>{PROPERTY_OPTIONS[selected.track.kind].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></label><label>值<input aria-label="关键帧值" type="number" step=".01" value={Number(selectedKeyframe.value)} onChange={(event) => editKeyframe({ value: Number(event.target.value) })} /></label><label>缓动<Select aria-label="关键帧缓动" value={selectedKeyframe.easing} onChange={(value) => { const easing = value as TimelineEasing; editKeyframe({ easing, bezier: easing === 'cubicBezier' ? easingBezier(easing, selectedKeyframe.bezier) : undefined }, '调整关键帧缓动'); }}>{Object.entries(EASING_NAMES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></label></div>
            <BezierEditor keyframe={selectedKeyframe} onCommit={(bezier) => editKeyframe({ easing: 'cubicBezier', bezier }, '调整贝塞尔缓动曲线')} />
          </section>}
        </div> : <div className="timeline-empty-state"><Film /><span>选择时间轴片段以编辑属性和关键帧</span></div>}
      </aside>
    </div>
    <section className="timeline-editor">
      <div className="timeline-ruler-row"><div className="timeline-corner">轨道</div><div className="timeline-ruler-scroll"><div className="timeline-ruler" style={{ width }} onPointerDown={beginRulerScrub} onPointerMove={updateRulerScrub} onPointerUp={finishRulerScrub} onPointerCancel={finishRulerScrub}>
        {timeline.loopRegion && <i className={`timeline-loop-region ${timeline.loopRegion.enabled ? 'enabled' : ''}`} style={{ left: timeline.loopRegion.start * pixelsPerSecond, width: Math.max(2, (timeline.loopRegion.end - timeline.loopRegion.start) * pixelsPerSecond) }} />}
        {Array.from({ length: Math.ceil(timeline.duration) + 1 }, (_, second) => <span key={second} style={{ left: second * pixelsPerSecond }}>{second}s</span>)}
        {(timeline.markers ?? []).map((marker) => <button className="timeline-marker" key={marker.id} style={{ left: marker.time * pixelsPerSecond, '--marker-color': marker.color ?? 'var(--accent)' } as CSSProperties} title={`${marker.name} · ${marker.time.toFixed(2)}s（双击删除）`} onPointerDown={(event) => event.stopPropagation()} onClick={() => seek(marker.time)} onDoubleClick={() => removeMarker(marker.id)}><Flag /><span>{marker.name}</span></button>)}
        <i className="timeline-playhead" style={{ left: playhead * pixelsPerSecond }} />
      </div></div></div>
      <div className="timeline-track-list">{timeline.tracks.map((track, trackIndex) => {
        const Icon = TRACK_ICON[track.kind];
        const group = (timeline.groups ?? []).find((item) => item.id === track.groupId);
        const firstInGroup = group && timeline.tracks.find((item) => item.groupId === group.id)?.id === track.id;
        return <Fragment key={track.id}>
          {firstInGroup && <div className={`timeline-track-group ${group.collapsed ? 'collapsed' : ''}`}>
            <button className="icon-button small" title={group.collapsed ? '展开轨道组' : '折叠轨道组'} onClick={() => toggleTrackGroup(group.id)}><ChevronRight /></button>
            <FolderTree /><strong>{group.name}</strong><span>{timeline.tracks.filter((item) => item.groupId === group.id).length} 条轨道</span>
            <button className="icon-button small" title="解除轨道组" onClick={() => removeTrackGroup(group.id)}><X /></button>
          </div>}
          {!group?.collapsed && <div className={`timeline-track ${track.collapsed ? 'collapsed' : ''}`} data-track-kind={track.kind} key={track.id} style={{ height: track.collapsed ? 32 : track.height ?? 54 }}>
          <div className="timeline-track-header"><button className="timeline-track-collapse" title={track.collapsed ? `展开${track.name}轨道` : `折叠${track.name}轨道`} onClick={() => toggleTrackCollapsed(track.id)}><ChevronRight /></button><Icon /><strong>{track.name}</strong><span>{track.clips.length}</span><button className="icon-button small" title={track.muted ? '取消静音' : '静音轨道'} onClick={() => persist({ ...timeline, tracks: timeline.tracks.map((item) => item.id === track.id ? { ...item, muted: !item.muted } : item) }, `${track.muted ? '取消静音' : '静音'}${track.name}轨道`)}>{track.muted ? <VolumeX /> : <Volume2 />}</button><button className="icon-button small" title={track.locked ? '解锁轨道' : '锁定轨道'} onClick={() => persist({ ...timeline, tracks: timeline.tracks.map((item) => item.id === track.id ? { ...item, locked: !item.locked } : item) }, `${track.locked ? '解锁' : '锁定'}${track.name}轨道`)}>{track.locked ? <Lock /> : <Unlock />}</button></div>
          <div className={`timeline-track-lane ${track.muted ? 'muted' : ''}`} data-track-id={track.id} style={{ width }} onPointerDown={beginMarquee} onPointerMove={updateMarquee} onPointerUp={finishMarquee} onPointerCancel={finishMarquee}>
            {timeline.loopRegion && <i className={`timeline-loop-region lane ${timeline.loopRegion.enabled ? 'enabled' : ''}`} style={{ left: timeline.loopRegion.start * pixelsPerSecond, width: Math.max(2, (timeline.loopRegion.end - timeline.loopRegion.start) * pixelsPerSecond) }} />}
            {(timeline.markers ?? []).map((marker) => <i className="timeline-marker-line" key={marker.id} style={{ left: marker.time * pixelsPerSecond, '--marker-color': marker.color ?? 'var(--accent)' } as CSSProperties} />)}
            <i className="timeline-playhead lane" style={{ left: playhead * pixelsPerSecond }} />
            {!track.collapsed && track.clips.map((clip) => {
              const asset = track.kind === 'audio' ? project.assets.find((item) => item.id === clip.assetId) : undefined;
              return <button className={`timeline-clip ${selectedClipIds.has(clip.id) ? 'selected' : ''}`} data-clip-id={clip.id} key={clip.id} style={{ left: clip.start * pixelsPerSecond, width: Math.max(28, clip.duration * pixelsPerSecond), '--clip-color': TRACK_COLOR[track.kind], height: Math.max(30, (track.height ?? 54) - 16) } as CSSProperties} title={`${clip.name} · ${clip.start.toFixed(2)}s`} onPointerDown={(event) => beginInteraction('move', clip, trackIndex, event)} onPointerMove={updateInteraction} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} onDoubleClick={() => clip.blockId && locateBlock((project.scripts[project.activeFragmentId] ?? []).findIndex((block) => block.id === clip.blockId))}>
                <i className="timeline-trim-handle start" title="裁剪左侧" onPointerDown={(event) => beginInteraction('trim-start', clip, trackIndex, event)} onPointerMove={updateInteraction} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} />
                {track.kind === 'audio' && <AudioWaveform uri={asset?.uri} offset={clip.sourceOffset} duration={clip.duration} />}
                <span>{clip.name}</span>
                {clip.keyframes.map((keyframe) => <i className={`timeline-keyframe ${selectedKeyframeId === keyframe.id ? 'selected' : ''}`} key={keyframe.id} style={{ left: `${Math.min(100, keyframe.time / clip.duration * 100)}%` }} title={`${keyframe.property} · ${keyframe.time.toFixed(2)}s`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedClipIds(new Set([clip.id])); setPrimaryClipId(clip.id); setSelectedKeyframeId(keyframe.id); }} />)}
                <i className="timeline-trim-handle end" title="裁剪右侧" onPointerDown={(event) => beginInteraction('trim-end', clip, trackIndex, event)} onPointerMove={updateInteraction} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} />
              </button>;
            })}
          </div>
          {!track.collapsed && <i className="timeline-track-resize" title={`调整${track.name}轨道高度`} onPointerDown={(event) => beginTrackResize(track.id, event)} onPointerMove={updateTrackResize} onPointerUp={finishTrackResize} onPointerCancel={finishTrackResize} />}
        </div>}
        </Fragment>;
      })}</div>
    </section>
    {marquee && <div className="timeline-marquee" style={marquee} />}
  </div>;
}
