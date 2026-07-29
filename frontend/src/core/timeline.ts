import type { Project, StageTimeline, StoryBlock, TimelineClip, TimelineKeyframe, TimelineTrack, TimelineTrackKind } from '../types';

const TRACKS: Array<{ id: string; name: string; kind: TimelineTrackKind }> = [
  { id: 'track-scene', name: '场景', kind: 'scene' },
  { id: 'track-character', name: '角色', kind: 'character' },
  { id: 'track-camera', name: '镜头', kind: 'camera' },
  { id: 'track-audio', name: '音频', kind: 'audio' },
];

export const timelineTrackForBlock = (block: StoryBlock): TimelineTrackKind | null => {
  if (block.type === 'scene') return 'scene';
  if (block.type === 'characterShow' || block.type === 'characterHide' || block.type === 'dialogue') return 'character';
  if (block.type === 'camera') return 'camera';
  if (block.type === 'sound') return 'audio';
  return null;
};

const blockDuration = (block: StoryBlock) => {
  if ('duration' in block && typeof block.duration === 'number' && block.duration > 0) return block.duration;
  if (block.type === 'sound') return block.channel === 'bgm' || block.loop ? 4 : 1.2;
  if (block.type === 'dialogue' || block.type === 'narration') return 1.8;
  return 1;
};

const blockName = (block: StoryBlock) => {
  if (block.type === 'scene') return block.title || '场景';
  if (block.type === 'sound') return block.title || '音频';
  if (block.type === 'characterShow') return `显示角色${block.expression ? ` · ${block.expression}` : ''}`;
  if (block.type === 'characterHide') return '隐藏角色';
  if (block.type === 'dialogue') return `${block.speaker || '角色'} · ${(block.text || '').slice(0, 18)}`;
  if (block.type === 'camera') return '镜头运动';
  return block.type;
};

export function deriveTimeline(project: Project, fragmentId: string): StageTimeline {
  const tracks: TimelineTrack[] = TRACKS.map((track) => ({ ...track, clips: [] }));
  let cursor = 0;
  for (const block of project.scripts[fragmentId] ?? []) {
    const kind = timelineTrackForBlock(block);
    const duration = blockDuration(block);
    if (kind) {
      const clip: TimelineClip = {
        id: `clip-${block.id}`,
        name: blockName(block),
        start: cursor,
        duration,
        blockId: block.id,
        assetId: 'assetId' in block ? block.assetId : undefined,
        characterId: 'characterId' in block ? block.characterId : undefined,
        audioChannel: block.type === 'sound' ? block.channel : undefined,
        sourceOffset: 0,
        keyframes: [],
      };
      tracks.find((track) => track.kind === kind)!.clips.push(clip);
    }
    cursor += duration;
  }
  return { version: 1, fragmentId, duration: Math.max(8, Math.ceil(cursor + 1)), fps: 30, tracks };
}

export function timelineForProject(project: Project, fragmentId: string): StageTimeline {
  return project.timelines?.[fragmentId] ?? deriveTimeline(project, fragmentId);
}

export function snapTimelineTime(time: number, timeline: StageTimeline, excludeClipId?: string | ReadonlySet<string>): number {
  const clamped = Math.max(0, time);
  const frame = 1 / Math.max(1, timeline.fps);
  const excluded = typeof excludeClipId === 'string' ? new Set([excludeClipId]) : excludeClipId;
  const candidates = timeline.tracks.flatMap((track) => track.clips)
    .filter((clip) => !excluded?.has(clip.id))
    .flatMap((clip) => [clip.start, clip.start + clip.duration]);
  const nearby = candidates.find((value) => Math.abs(value - clamped) <= .12);
  return Number((nearby ?? Math.round(clamped / frame) * frame).toFixed(3));
}

export function updateTimelineClip(timeline: StageTimeline, clipId: string, patch: Partial<TimelineClip>, targetTrackId?: string): StageTimeline {
  let moving: TimelineClip | undefined;
  const tracks = timeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.filter((clip) => {
      if (clip.id !== clipId) return true;
      moving = { ...clip, ...patch };
      return !targetTrackId || targetTrackId === track.id;
    }).map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip),
  }));
  if (moving && targetTrackId) {
    const target = tracks.find((track) => track.id === targetTrackId);
    if (target && !target.clips.some((clip) => clip.id === clipId)) target.clips.push(moving);
  }
  const duration = Math.max(timeline.duration, 8, ...tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration + 1)));
  return { ...timeline, duration: Math.ceil(duration), tracks };
}

export function moveTimelineClips(timeline: StageTimeline, clipIds: ReadonlySet<string>, deltaTime: number, trackDelta = 0): StageTimeline {
  const source = new Map(timeline.tracks.flatMap((track, trackIndex) => track.clips.map((clip) => [clip.id, { clip, trackIndex }] as const)));
  const minimumStart = Math.min(...[...clipIds].map((id) => source.get(id)?.clip.start ?? Number.POSITIVE_INFINITY));
  const safeDelta = Number.isFinite(minimumStart) ? Math.max(deltaTime, -minimumStart) : 0;
  const tracks: TimelineTrack[] = timeline.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => !clipIds.has(clip.id)) }));
  for (const id of clipIds) {
    const item = source.get(id);
    if (!item) continue;
    const targetIndex = Math.max(0, Math.min(tracks.length - 1, item.trackIndex + trackDelta));
    const target = tracks[targetIndex].locked ? tracks[item.trackIndex] : tracks[targetIndex];
    target.clips.push({ ...item.clip, start: Number(Math.max(0, item.clip.start + safeDelta).toFixed(3)) });
  }
  const duration = Math.max(timeline.duration, 8, ...tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration + 1)));
  return { ...timeline, duration: Math.ceil(duration), tracks };
}

export function trimTimelineClip(timeline: StageTimeline, clipId: string, edge: 'start' | 'end', time: number): StageTimeline {
  const found = findTimelineClip(timeline, clipId);
  if (!found) return timeline;
  const frame = 1 / Math.max(1, timeline.fps);
  const minimumDuration = Math.max(.1, frame);
  if (edge === 'start') {
    const end = found.clip.start + found.clip.duration;
    const start = Math.max(0, Math.min(end - minimumDuration, time));
    const offset = start - found.clip.start;
    return updateTimelineClip(timeline, clipId, {
      start: Number(start.toFixed(3)),
      duration: Number((end - start).toFixed(3)),
      keyframes: found.clip.keyframes.map((keyframe) => ({ ...keyframe, time: Number(Math.max(0, keyframe.time - offset).toFixed(3)) })),
      sourceOffset: Number(((found.clip.sourceOffset ?? 0) + offset).toFixed(3)),
    });
  }
  const duration = Math.max(minimumDuration, time - found.clip.start);
  return updateTimelineClip(timeline, clipId, {
    duration: Number(duration.toFixed(3)),
    keyframes: found.clip.keyframes.map((keyframe) => ({ ...keyframe, time: Number(Math.min(duration, keyframe.time).toFixed(3)) })),
  });
}

export function updateTimelineKeyframe(timeline: StageTimeline, clipId: string, keyframeId: string, patch: Partial<TimelineKeyframe>): StageTimeline {
  const found = findTimelineClip(timeline, clipId);
  if (!found) return timeline;
  const keyframes = found.clip.keyframes.map((keyframe) => keyframe.id === keyframeId ? {
    ...keyframe,
    ...patch,
    time: Math.max(0, Math.min(found.clip.duration, patch.time ?? keyframe.time)),
  } : keyframe);
  return updateTimelineClip(timeline, clipId, { keyframes });
}

export const easingBezier = (easing: TimelineKeyframe['easing'], custom?: TimelineKeyframe['bezier']): [number, number, number, number] => {
  if (easing === 'linear') return [0, 0, 1, 1];
  if (easing === 'easeIn') return [.42, 0, 1, 1];
  if (easing === 'easeOut') return [0, 0, .58, 1];
  if (easing === 'easeInOut') return [.42, 0, .58, 1];
  return custom ?? [.25, .1, .25, 1];
};

const cubic = (time: number, first: number, second: number) => {
  const inverse = 1 - time;
  return 3 * inverse * inverse * time * first + 3 * inverse * time * time * second + time * time * time;
};

export function cubicBezierProgress(progress: number, bezier: [number, number, number, number]): number {
  const target = Math.max(0, Math.min(1, progress));
  if (target === 0 || target === 1) return target;
  let low = 0; let high = 1; let parameter = target;
  for (let index = 0; index < 14; index += 1) {
    parameter = (low + high) / 2;
    if (cubic(parameter, bezier[0], bezier[2]) < target) low = parameter; else high = parameter;
  }
  return cubic(parameter, bezier[1], bezier[3]);
}

const valueAtTime = (keyframes: TimelineKeyframe[], time: number): string | number | boolean | undefined => {
  const sorted = [...keyframes].sort((left, right) => left.time - right.time);
  if (!sorted.length) return undefined;
  const rightIndex = sorted.findIndex((keyframe) => keyframe.time >= time);
  if (rightIndex <= 0) return sorted[Math.max(0, rightIndex)].value;
  if (rightIndex < 0) return sorted.at(-1)?.value;
  const left = sorted[rightIndex - 1]; const right = sorted[rightIndex];
  if (typeof left.value !== 'number' || typeof right.value !== 'number' || right.time <= left.time) return time < right.time ? left.value : right.value;
  const progress = (time - left.time) / (right.time - left.time);
  const eased = cubicBezierProgress(progress, easingBezier(right.easing, right.bezier));
  return left.value + (right.value - left.value) * eased;
};

export interface TimelinePreviewValues {
  sceneOpacity?: number;
  camera: Partial<{ x: number; y: number; zoom: number; rotation: number; shake: number }>;
  characters: Record<string, Partial<{ x: number; y: number; scale: number; opacity: number }>>;
  audio: Partial<Record<'bgm' | 'sfx' | 'voice', { volume: number }>>;
}

export function evaluateTimelineAtTime(timeline: StageTimeline, time: number): TimelinePreviewValues {
  const result: TimelinePreviewValues = { camera: {}, characters: {}, audio: {} };
  const active = timeline.tracks.flatMap((track) => track.muted ? [] : track.clips.map((clip) => ({ track, clip }))).filter(({ clip }) => clip.start <= time).sort((left, right) => left.clip.start - right.clip.start);
  for (const { track, clip } of active) {
    const localTime = Math.max(0, Math.min(clip.duration, time - clip.start));
    const properties = new Map<string, TimelineKeyframe[]>();
    for (const keyframe of clip.keyframes) properties.set(keyframe.property, [...(properties.get(keyframe.property) ?? []), keyframe]);
    for (const [property, keyframes] of properties) {
      const value = valueAtTime(keyframes, localTime);
      if (typeof value !== 'number') continue;
      if (track.kind === 'scene' && property === 'opacity') result.sceneOpacity = value;
      else if (track.kind === 'camera') {
        const cameraProperty = property === 'cameraX' ? 'x' : property === 'cameraY' ? 'y' : property;
        if (['x', 'y', 'zoom', 'rotation', 'shake'].includes(cameraProperty)) result.camera[cameraProperty as keyof TimelinePreviewValues['camera']] = value;
      } else if (track.kind === 'character' && clip.characterId && ['x', 'y', 'scale', 'opacity'].includes(property)) {
        result.characters[clip.characterId] = { ...(result.characters[clip.characterId] ?? {}), [property]: value };
      } else if (track.kind === 'audio' && property === 'volume') result.audio[clip.audioChannel ?? 'bgm'] = { volume: value };
    }
  }
  return result;
}

export function rippleMoveTimelineClips(timeline: StageTimeline, clipIds: ReadonlySet<string>, deltaTime: number, trackDelta = 0): StageTimeline {
  const selectedByTrack = new Map<string, TimelineClip[]>();
  for (const track of timeline.tracks) selectedByTrack.set(track.id, track.clips.filter((clip) => clipIds.has(clip.id)));
  const moved = moveTimelineClips(timeline, clipIds, deltaTime, trackDelta);
  const sourceStarts = new Map([...selectedByTrack].flatMap(([trackId, clips]) => clips.length ? [[trackId, Math.min(...clips.map((clip) => clip.start))] as const] : []));
  const actualDelta = (() => {
    const original = timeline.tracks.flatMap((track) => track.clips).find((clip) => clipIds.has(clip.id));
    const current = moved.tracks.flatMap((track) => track.clips).find((clip) => clip.id === original?.id);
    return original && current ? current.start - original.start : 0;
  })();
  if (!actualDelta) return moved;
  const tracks = moved.tracks.map((track) => {
    const threshold = sourceStarts.get(track.id);
    if (threshold === undefined) return track;
    return { ...track, clips: track.clips.map((clip) => !clipIds.has(clip.id) && clip.start >= threshold ? { ...clip, start: Number(Math.max(0, clip.start + actualDelta).toFixed(3)) } : clip) };
  });
  const duration = Math.max(8, ...tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration + 1)));
  return { ...moved, duration: Math.ceil(duration), tracks };
}

export function rippleTrimTimelineClip(timeline: StageTimeline, clipId: string, edge: 'start' | 'end', time: number): StageTimeline {
  const source = findTimelineClip(timeline, clipId);
  if (!source) return timeline;
  const trimmed = trimTimelineClip(timeline, clipId, edge, time);
  if (edge === 'start') return trimmed;
  const current = findTimelineClip(trimmed, clipId)!;
  const delta = current.clip.duration - source.clip.duration;
  if (!delta) return trimmed;
  return { ...trimmed, tracks: trimmed.tracks.map((track) => track.id !== source.track.id ? track : { ...track, clips: track.clips.map((clip) => clip.id !== clipId && clip.start >= source.clip.start + source.clip.duration ? { ...clip, start: Number(Math.max(0, clip.start + delta).toFixed(3)) } : clip) }) };
}

export function blockIndexAtTime(project: Project, timeline: StageTimeline, time: number): number {
  const clips = timeline.tracks.flatMap((track) => track.clips)
    .filter((clip) => clip.blockId && clip.start <= time + .001)
    .sort((left, right) => right.start - left.start);
  const blockId = clips[0]?.blockId;
  return Math.max(0, (project.scripts[timeline.fragmentId] ?? []).findIndex((block) => block.id === blockId));
}

export function findTimelineClip(timeline: StageTimeline, clipId: string) {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function remapTimeline(
  timeline: StageTimeline,
  fragmentId: string,
  blockIds: ReadonlyMap<string, string>,
  makeId: (prefix: 'clip' | 'keyframe') => string = (prefix) => `${prefix}-${crypto.randomUUID()}`,
): StageTimeline {
  return {
    ...timeline,
    fragmentId,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({
        ...clip,
        id: makeId('clip'),
        blockId: clip.blockId ? blockIds.get(clip.blockId) : undefined,
        keyframes: clip.keyframes.map((keyframe) => ({ ...keyframe, id: makeId('keyframe') })),
      })),
    })),
  };
}
