import { describe, expect, it } from 'vitest';
import { blockIndexAtTime, cubicBezierProgress, deriveTimeline, easingBezier, evaluateTimelineAtTime, moveTimelineClips, remapTimeline, rippleMoveTimelineClips, rippleTrimTimelineClip, snapTimelineTime, trimTimelineClip, updateTimelineClip, updateTimelineKeyframe } from '../timeline';
import { testProject } from '../../engine-core/__tests__/fixtures';

const sampleProject = () => testProject({ opening: [
  { id: 'scene', type: 'scene', title: '湖畔', duration: 1 },
  { id: 'actor', type: 'characterShow', characterId: 'lin', duration: 1 },
  { id: 'camera', type: 'camera', zoom: 1.2, duration: 1 },
  { id: 'audio', type: 'sound', title: 'BGM', channel: 'bgm', duration: 2 },
] });

describe('stage timeline', () => {
  it('derives linked clips from engine blocks', () => {
    const project = sampleProject();
    const timeline = deriveTimeline(project, 'opening');
    expect(timeline.tracks.map((track) => track.kind)).toEqual(['scene', 'character', 'camera', 'audio']);
    expect(timeline.tracks.flatMap((track) => track.clips).every((clip) => clip.blockId)).toBe(true);
  });

  it('snaps to nearby clip edges and moves clips between tracks', () => {
    const project = sampleProject();
    const timeline = deriveTimeline(project, 'opening');
    const clip = timeline.tracks.flatMap((track) => track.clips)[0];
    expect(clip).toBeTruthy();
    const snapped = snapTimelineTime(clip.start + clip.duration + .05, timeline, 'other');
    expect(snapped).toBeCloseTo(clip.start + clip.duration);
    const moved = updateTimelineClip(timeline, clip.id, { start: 3 }, 'track-camera');
    expect(moved.tracks.find((track) => track.id === 'track-camera')?.clips.some((item) => item.id === clip.id)).toBe(true);
  });

  it('maps the playhead back to the linked engine block', () => {
    const project = sampleProject();
    const timeline = deriveTimeline(project, 'opening');
    const clip = timeline.tracks.flatMap((track) => track.clips).at(-1)!;
    expect(blockIndexAtTime(project, timeline, clip.start)).toBeGreaterThanOrEqual(0);
  });

  it('remaps copied timelines to new fragments and block identifiers', () => {
    const timeline = deriveTimeline(sampleProject(), 'opening');
    timeline.groups = [{ id: 'visuals', name: '视觉轨道', collapsed: true }];
    timeline.tracks[0].groupId = 'visuals';
    timeline.tracks[0].collapsed = true;
    timeline.markers = [{ id: 'marker-intro', name: '开场', time: .5 }];
    timeline.loopRegion = { start: .25, end: 1.25, enabled: true };
    timeline.tracks[0].clips[0].keyframes.push({ id: 'old-keyframe', time: 0, property: 'opacity', value: 1, easing: 'linear' });
    let sequence = 0;
    const copied = remapTimeline(timeline, 'opening-copy', new Map([
      ['scene', 'scene-copy'], ['actor', 'actor-copy'], ['camera', 'camera-copy'], ['audio', 'audio-copy'],
    ]), (prefix) => `${prefix}-copy-${sequence++}`);
    expect(copied.fragmentId).toBe('opening-copy');
    expect(copied.tracks.flatMap((track) => track.clips).map((clip) => clip.blockId)).toEqual(['scene-copy', 'actor-copy', 'camera-copy', 'audio-copy']);
    expect(copied.tracks.flatMap((track) => track.clips).every((clip) => clip.id.startsWith('clip-copy-'))).toBe(true);
    expect(copied.tracks[0].clips[0].keyframes[0].id).toMatch(/^keyframe-copy-/);
    expect(copied.groups).toEqual(timeline.groups);
    expect(copied.markers).toEqual(timeline.markers);
    expect(copied.loopRegion).toEqual(timeline.loopRegion);
    expect(copied.tracks[0]).toMatchObject({ groupId: 'visuals', collapsed: true });
  });

  it('moves a multi-selection while preserving relative time and track offsets', () => {
    const timeline = deriveTimeline(sampleProject(), 'opening');
    const scene = timeline.tracks[0].clips[0];
    const actor = timeline.tracks[1].clips[0];
    const moved = moveTimelineClips(timeline, new Set([scene.id, actor.id]), 2, 1);
    expect(moved.tracks[1].clips.find((clip) => clip.id === scene.id)?.start).toBe(scene.start + 2);
    expect(moved.tracks[2].clips.find((clip) => clip.id === actor.id)?.start).toBe(actor.start + 2);
  });

  it('trims both clip edges and keeps keyframes inside the clip', () => {
    const timeline = deriveTimeline(sampleProject(), 'opening');
    const clip = timeline.tracks[0].clips[0];
    clip.keyframes.push({ id: 'key', time: .75, property: 'opacity', value: 1, easing: 'easeInOut' });
    const left = trimTimelineClip(timeline, clip.id, 'start', .5);
    const leftClip = left.tracks[0].clips[0];
    expect(leftClip.start).toBe(.5);
    expect(leftClip.duration).toBe(.5);
    expect(leftClip.keyframes[0].time).toBe(.25);
    expect(leftClip.sourceOffset).toBe(.5);
    const right = trimTimelineClip(left, clip.id, 'end', .7);
    expect(right.tracks[0].clips[0].duration).toBe(.2);
    expect(right.tracks[0].clips[0].keyframes[0].time).toBe(.2);
  });

  it('edits keyframes and resolves easing presets to bezier handles', () => {
    const timeline = deriveTimeline(sampleProject(), 'opening');
    const clip = timeline.tracks[0].clips[0];
    clip.keyframes.push({ id: 'key', time: .5, property: 'opacity', value: 1, easing: 'linear' });
    const updated = updateTimelineKeyframe(timeline, clip.id, 'key', { time: 99, value: .4, easing: 'cubicBezier', bezier: [.2, .4, .7, .9] });
    expect(updated.tracks[0].clips[0].keyframes[0]).toMatchObject({ time: clip.duration, value: .4, easing: 'cubicBezier' });
    expect(easingBezier('easeInOut')).toEqual([.42, 0, .58, 1]);
    expect(easingBezier('cubicBezier', [.2, .4, .7, .9])).toEqual([.2, .4, .7, .9]);
  });

  it('interpolates timeline values with cubic bezier easing for live preview', () => {
    const timeline = deriveTimeline(sampleProject(), 'opening');
    const camera = timeline.tracks.find((track) => track.kind === 'camera')!.clips[0];
    camera.keyframes = [
      { id: 'from', time: 0, property: 'zoom', value: 1, easing: 'linear' },
      { id: 'to', time: 1, property: 'zoom', value: 2, easing: 'linear' },
    ];
    expect(cubicBezierProgress(.5, [0, 0, 1, 1])).toBeCloseTo(.5, 3);
    expect(evaluateTimelineAtTime(timeline, camera.start + .5).camera.zoom).toBeCloseTo(1.5, 2);
    expect(evaluateTimelineAtTime(timeline, camera.start + 1).camera.zoom).toBe(2);
  });

  it('ripples following clips after moves and right-edge trims', () => {
    const timeline = deriveTimeline(sampleProject(), 'opening');
    const first = timeline.tracks[0].clips[0];
    const follower = { ...first, id: 'scene-follower', blockId: 'scene-follower', start: first.start + first.duration + 1 };
    timeline.tracks[0].clips.push(follower);
    const moved = rippleMoveTimelineClips(timeline, new Set([first.id]), 1);
    expect(findClip(moved, follower.id).start).toBe(follower.start + 1);
    const trimmed = rippleTrimTimelineClip(timeline, first.id, 'end', first.start + first.duration + .5);
    expect(findClip(trimmed, follower.id).start).toBe(follower.start + .5);
  });

  it('routes audio automation to the real mixer channel', () => {
    const timeline = deriveTimeline(sampleProject(), 'opening');
    const audio = timeline.tracks.find((track) => track.kind === 'audio')!.clips[0];
    audio.keyframes = [{ id: 'volume', time: 0, property: 'volume', value: .35, easing: 'linear' }];
    expect(audio.audioChannel).toBe('bgm');
    expect(evaluateTimelineAtTime(timeline, audio.start).audio.bgm?.volume).toBe(.35);
  });

  it('keeps grouped and collapsed tracks active in runtime evaluation', () => {
    const timeline = deriveTimeline(sampleProject(), 'opening');
    const cameraTrack = timeline.tracks.find((track) => track.kind === 'camera')!;
    cameraTrack.groupId = 'visuals';
    cameraTrack.collapsed = true;
    timeline.groups = [{ id: 'visuals', name: '视觉轨道', collapsed: true }];
    cameraTrack.clips[0].keyframes = [{ id: 'zoom', time: 0, property: 'zoom', value: 1.8, easing: 'linear' }];
    expect(evaluateTimelineAtTime(timeline, cameraTrack.clips[0].start).camera.zoom).toBe(1.8);
  });
});

const findClip = (timeline: ReturnType<typeof deriveTimeline>, id: string) => timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id)!;
