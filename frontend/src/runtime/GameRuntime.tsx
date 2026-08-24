import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Eye, RotateCcw, Volume2, X } from 'lucide-react';
import { SaveGameDialog } from '../components/SaveGameDialog';
import { TransitioningBackground } from '../components/ui/TransitioningBackground';
import { assetMatchesTrack } from '../core/audio';
import { gameUiThemeCssVariables, normalizeGameUiTheme } from '../core/gameUiTheme';
import { acknowledgeSaveSlotNotice, captureSaveThumbnail, listSaveSlots, readSaveSlotWithRecovery, readSharedVariables, writeSaveSlot, writeSharedVariables, type SaveSlotRecord } from '../core/saveGames';
import { readLargeValue, readSmallValue, writeLargeValue, writeSmallValue } from '../core/storage';
import { applyLanguage, languageLabel } from '../core/localization';
import { characterWidthCss, dimensionCss } from '../core/stageLayout';
import { evaluateTimelineAtTime, timelineForProject } from '../core/timeline';
import { advanceEngine, chooseBranch, createEngineState, currentBlock, loadSaveGameWithReport, resolveDialogueSpeaker, rollbackEngine } from '../engine-core/runtime';
import { BLOCK_CONFORMANCE_MATRIX_VERSION, observeEngineState } from '../engine-core/blockConformance';
import type { EngineState } from '../engine-core/types';
import type { BlockType, Project } from '../types';

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

// 无立绘角色的默认剪影：以角色主题色渲染的静态人形，避免生硬的占位色块。
const CHARACTER_SILHOUETTE_PATH = 'M100 28C121.5 28 138 44.5 138 66C138 83.5 130.5 97 119 104C117 105 116 107.5 116 110L116 120C116 124 118.5 127 122.5 128.5C149 138 168 152 176.5 176C187 206 192 255 194.5 312C196.5 362 197.5 412 197.5 456C197.5 461.5 193.5 466 188 466L12 466C6.5 466 2.5 461.5 2.5 456C2.5 412 3.5 362 5.5 312C8 255 13 206 23.5 176C32 152 51 138 77.5 128.5C81.5 127 84 124 84 120L84 110C84 107.5 83 105 81 104C69.5 97 62 83.5 62 66C62 44.5 78.5 28 100 28Z';

function CharacterSilhouette({ characterId }: { characterId: string }) {
  const gradientId = `slide-silhouette-${characterId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return (
    <svg className="game-character-silhouette" viewBox="0 0 200 480" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${gradientId}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--character-color) 52%, #fff)' }} />
          <stop offset=".52" style={{ stopColor: 'var(--character-color)' }} />
          <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--character-color) 55%, #000)' }} />
        </linearGradient>
        <radialGradient id={`${gradientId}-aura`} cx=".5" cy=".3" r=".75">
          <stop offset="0" style={{ stopColor: 'var(--character-color)', stopOpacity: .3 }} />
          <stop offset="1" style={{ stopColor: 'transparent' }} />
        </radialGradient>
      </defs>
      <rect width="200" height="480" fill={`url(#${gradientId}-aura)`} />
      <ellipse className="game-character-silhouette-shadow" cx="100" cy="463" rx="82" ry="9" />
      <path className="game-character-silhouette-body" d={CHARACTER_SILHOUETTE_PATH} fill={`url(#${gradientId}-body)`} />
      <path className="game-character-silhouette-rim" d={CHARACTER_SILHOUETTE_PATH} />
    </svg>
  );
}

interface RuntimePreferences {
  masterVolume: number;
  bgmVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  textSpeed: number;
  autoDelay: number;
  skipReadOnly: boolean;
}

export function GameRuntime({ project: baseProject, conformanceCaseId }: { project: Project; conformanceCaseId?: BlockType }) {
  const runtimeLanguages = baseProject.locale?.languages ?? [];
  const [language, setLanguage] = useState(() => {
    const stored = readSmallValue(`slide-runtime-language:${baseProject.meta.id}`);
    return runtimeLanguages.includes(stored ?? '') ? stored! : baseProject.locale?.default ?? runtimeLanguages[0] ?? 'zh-CN';
  });
  const project = useMemo(() => applyLanguage(baseProject, language), [baseProject, language]);
  const updateLanguage = (next: string) => {
    if (!runtimeLanguages.includes(next) || next === language) return;
    setLanguage(next);
    writeSmallValue(`slide-runtime-language:${baseProject.meta.id}`, next);
    setNotice(`Language: ${languageLabel(next)}`);
  };
  const entry = project.chapters.find((chapter) => chapter.entry)?.fragments[0]?.id ?? project.chapters[0]?.fragments[0]?.id ?? project.activeFragmentId;
  const [state, setState] = useState<EngineState>(() => createEngineState(project, entry));
  const [screen, setScreen] = useState<'title' | 'playing'>(conformanceCaseId ? 'playing' : 'title');
  const [hasStarted, setHasStarted] = useState(Boolean(conformanceCaseId));
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<'new-game' | 'return-title' | 'exit' | null>(null);
  const [continueSlot, setContinueSlot] = useState<SaveSlotRecord | null>(null);
  const [continueLoading, setContinueLoading] = useState(true);
  const [autoPlay, setAutoPlay] = useState(project.settings.autoPlay ?? false);
  const [skipMode, setSkipMode] = useState(false);
  const [controlFastForward, setControlFastForward] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<'save' | 'load' | null>(null);
  const [notice, setNotice] = useState('');
  const [timelineTime, setTimelineTime] = useState(0);
  const settingsKey = `slide-runtime-settings:${project.meta.id}`;
  const [preferences, setPreferences] = useState<RuntimePreferences>(() => {
    const defaults: RuntimePreferences = {
      masterVolume: 1,
      bgmVolume: .8,
      sfxVolume: 1,
      voiceVolume: 1,
      textSpeed: project.settings.textSpeed ?? 35,
      autoDelay: project.settings.autoPlayDelay ?? 1.5,
      skipReadOnly: project.settings.skipRead ?? true,
    };
    try {
      const saved = JSON.parse(window.localStorage.getItem(settingsKey) ?? '{}') as Partial<RuntimePreferences>;
      return { ...defaults, ...saved };
    } catch { return defaults; }
  });
  const sessionStartedAt = useRef(Date.now());
  const sharedReady = useRef(false);
  const readHistoryReady = useRef(false);
  const globalReadBlocks = useRef<Record<string, true>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const audioFadeFrames = useRef<Record<string, number>>({});
  const dialogueCopyRef = useRef<HTMLDivElement>(null);
  const dialogueMeasureRef = useRef<HTMLDivElement>(null);
  const timelineFragmentRef = useRef(state.fragmentId);
  const current = currentBlock(project, state);
  const activeTimeline = useMemo(() => timelineForProject(project, state.fragmentId), [project, state.fragmentId]);
  const timelinePreview = useMemo(() => evaluateTimelineAtTime(activeTimeline, timelineTime), [activeTimeline, timelineTime]);
  const fullText = current && 'text' in current ? current.text ?? '' : '';
  const textCharacters = useMemo(() => Array.from(fullText), [fullText]);
  const [visibleCharacters, setVisibleCharacters] = useState(0);
  const textComplete = visibleCharacters >= textCharacters.length;
  const displayedText = textCharacters.slice(0, visibleCharacters).join('');
  const sharedNames = useMemo(() => Object.entries(project.variableDefinitions ?? {}).filter(([, definition]) => definition.persistence === 'shared').map(([name]) => name), [project.variableDefinitions]);
  const assetUri = (assetId?: string) => project.assets.find((asset) => asset.id === assetId)?.uri;
  const background = assetUri(state.stage.backgroundAssetId);
  const camera = { ...state.stage.camera, ...timelinePreview.camera };
  const cameraFilter = camera.filter === 'monochrome' ? 'grayscale(1)' : camera.filter === 'sepia' ? 'sepia(.85)' : camera.filter === 'blur' ? 'blur(3px)' : 'none';
  const titleBackground = assetUri(project.ui?.title?.backgroundAssetId ?? project.scenes?.[0]?.layers.at(-1)?.assetId ?? project.assets.find((asset) => asset.kind === 'scene' || asset.kind === 'image')?.id);
  const titleLogo = assetUri(project.ui?.title?.logoAssetId);
  // Conformance 用例共享 project id，禁用读历史持久化/水合，保证各用例互不污染。
  const readHistoryKey = conformanceCaseId ? null : `slide-read-blocks:${project.meta.id}`;
  const fastForwardActive = skipMode || controlFastForward;
  const runtimeTheme = normalizeGameUiTheme(project.ui?.runtimeTheme);
  const runtimeFontUri = assetUri(runtimeTheme.fontAssetId);

  useEffect(() => {
    if (!conformanceCaseId) return;
    const harness = {
      surface: 'web-runtime' as const,
      caseId: conformanceCaseId,
      matrixVersion: BLOCK_CONFORMANCE_MATRIX_VERSION,
      getObservation: () => observeEngineState(project, state),
      advance: () => setState((value) => advanceEngine(project, value)),
      choose: (target: string) => setState((value) => chooseBranch(project, value, target)),
      reset: () => setState(createEngineState(project)),
    };
    window.__SLIDE_BLOCK_CONFORMANCE__ = harness;
    return () => {
      if (window.__SLIDE_BLOCK_CONFORMANCE__ === harness) delete window.__SLIDE_BLOCK_CONFORMANCE__;
    };
  }, [conformanceCaseId, project, state]);

  useEffect(() => {
    if (screen !== 'playing') return;
    const fragmentChanged = timelineFragmentRef.current !== state.fragmentId;
    timelineFragmentRef.current = state.fragmentId;
    const script = project.scripts[state.fragmentId] ?? [];
    const currentIndex = current ? script.findIndex((block) => block.id === current.id) : state.instructionPointer;
    const linked = activeTimeline.tracks.flatMap((track) => track.clips)
      .filter((clip) => {
        const index = clip.blockId ? script.findIndex((block) => block.id === clip.blockId) : -1;
        return index >= 0 && index <= currentIndex;
      })
      .sort((left, right) => right.start - left.start)[0];
    const target = Math.min(activeTimeline.duration, linked ? linked.start + linked.duration : 0);
    let start = fragmentChanged ? 0 : timelineTime;
    if (target < start || target - start > 12) start = linked?.start ?? 0;
    setTimelineTime(start);
    if (target <= start + .001) return;
    const clock = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(target, start + (now - clock) / 1000);
      setTimelineTime(next);
      if (next < target) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [activeTimeline, current?.id, project.scripts, screen, state.fragmentId, state.instructionPointer]);

  useLayoutEffect(() => {
    const copy = dialogueCopyRef.current;
    const measure = dialogueMeasureRef.current;
    if (!copy || !measure) return;
    const fit = () => {
      let size = runtimeTheme.dialogueFontSize;
      copy.classList.remove('text-overflowing');
      copy.style.setProperty('--dialogue-fit-font-size', `${size}px`);
      while (size > 8 && measure.scrollHeight > copy.clientHeight) {
        size -= 0.5;
        copy.style.setProperty('--dialogue-fit-font-size', `${size}px`);
      }
      copy.classList.toggle('text-overflowing', measure.scrollHeight > copy.clientHeight);
    };
    const frame = window.requestAnimationFrame(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(copy);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [current?.id, fullText, runtimeTheme.dialogueFontSize, runtimeTheme.dialogueHeight, runtimeTheme.fontFamily, runtimeTheme.speakerFontSize, runtimeTheme.speakerStyle, screen, uiHidden]);

  const fadeAudio = (channel: string, audio: HTMLAudioElement, target: number, duration: number, complete?: () => void) => {
    if (audioFadeFrames.current[channel]) window.cancelAnimationFrame(audioFadeFrames.current[channel]);
    const startVolume = audio.volume;
    if (duration <= 0 || Math.abs(startVolume - target) < .005) {
      audio.volume = target;
      complete?.();
      return;
    }
    const startedAt = performance.now();
    const update = (timestamp: number) => {
      const progress = clamp((timestamp - startedAt) / (duration * 1000));
      audio.volume = startVolume + (target - startVolume) * progress;
      if (progress >= 1) {
        delete audioFadeFrames.current[channel];
        complete?.();
      } else audioFadeFrames.current[channel] = window.requestAnimationFrame(update);
    };
    audioFadeFrames.current[channel] = window.requestAnimationFrame(update);
  };

  useEffect(() => {
    if (!readHistoryKey) return;
    let cancelled = false;
    void readLargeValue(readHistoryKey).then((encoded) => {
      if (cancelled) return;
      try {
        const parsed = encoded ? JSON.parse(encoded) as Record<string, true> : {};
        globalReadBlocks.current = parsed;
        setState((value) => ({ ...value, readBlocks: { ...parsed, ...value.readBlocks } }));
      } catch { globalReadBlocks.current = {}; }
      readHistoryReady.current = true;
    });
    return () => { cancelled = true; };
  }, [readHistoryKey]);

  useEffect(() => {
    if (!readHistoryKey || !readHistoryReady.current) return;
    globalReadBlocks.current = { ...globalReadBlocks.current, ...state.readBlocks };
    const timer = window.setTimeout(() => void writeLargeValue(readHistoryKey, JSON.stringify(globalReadBlocks.current)).catch(() => undefined), 250);
    return () => window.clearTimeout(timer);
  }, [readHistoryKey, state.readBlocks]);

  const refreshContinueSlot = async () => {
    setContinueLoading(true);
    try {
      const slots = await listSaveSlots(project);
      const latest = slots
        .filter((slot) => slot.status === 'valid' && slot.save)
        .sort((left, right) => new Date(right.save?.savedAt ?? 0).getTime() - new Date(left.save?.savedAt ?? 0).getTime())[0];
      setContinueSlot(latest ?? null);
    } catch { setContinueSlot(null); }
    finally { setContinueLoading(false); }
  };

  useEffect(() => { void refreshContinueSlot(); }, [project.meta.id]);

  const beginNewGame = () => {
    setState({ ...createEngineState(project, entry), readBlocks: { ...globalReadBlocks.current } });
    sessionStartedAt.current = Date.now();
    setScreen('playing');
    setHasStarted(true);
    setSystemMenuOpen(false);
    setConfirmation(null);
    setAutoPlay(false);
    setSkipMode(false);
  };

  const requestNewGame = () => {
    if (hasStarted) setConfirmation('new-game');
    else beginNewGame();
  };

  const continueGame = async () => {
    if (!continueSlot) return;
    setContinueLoading(true);
    try {
      const stored = await readSaveSlotWithRecovery(project, continueSlot.slotId);
      const loaded = loadSaveGameWithReport(project, stored.save, state.variables);
      setState({ ...loaded.state, readBlocks: { ...globalReadBlocks.current, ...loaded.state.readBlocks } });
      sessionStartedAt.current = Date.now() - (stored.save.playTimeSeconds ?? 0) * 1000;
      setScreen('playing');
      setHasStarted(true);
      setSystemMenuOpen(false);
      const details = [...new Set([
        ...(continueSlot.recovered || stored.recovered ? ['已从备份恢复'] : []),
        ...(continueSlot.migrated || stored.migrated ? ['已迁移旧版存档'] : []),
        ...(continueSlot.warnings ?? []),
        ...stored.warnings,
        ...loaded.warnings,
      ])];
      acknowledgeSaveSlotNotice(project.meta.id, continueSlot.slotId);
      if (details.length) setNotice(details.join('；'));
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); void refreshContinueSlot(); }
    finally { setContinueLoading(false); }
  };

  const advance = () => {
    Object.values(audioRefs.current).forEach((audio) => { if (audio.paused) void audio.play().catch(() => undefined); });
    if (state.finished || current?.type === 'branch') return;
    if (!textComplete) {
      setVisibleCharacters(textCharacters.length);
      return;
    }
    setState((value) => advanceEngine(project, value));
  };

  const openPanel = (panel: 'save' | 'load' | 'history' | 'settings') => {
    setAutoPlay(false);
    setSkipMode(false);
    setBacklogOpen(panel === 'history');
    setSettingsOpen(panel === 'settings');
    setSaveMode(panel === 'save' || panel === 'load' ? panel : null);
    setSystemMenuOpen(false);
  };

  const updatePreference = <K extends keyof RuntimePreferences>(key: K, value: RuntimePreferences[K]) => {
    setPreferences((currentPreferences) => ({ ...currentPreferences, [key]: value }));
  };

  useEffect(() => {
    try { window.localStorage.setItem(settingsKey, JSON.stringify(preferences)); } catch { /* Settings persistence is optional in restricted browsers. */ }
  }, [preferences, settingsKey]);

  useEffect(() => {
    setVisibleCharacters(0);
    if (!textCharacters.length) return;
    const interval = window.setInterval(() => {
      setVisibleCharacters((value) => {
        if (value >= textCharacters.length) {
          window.clearInterval(interval);
          return value;
        }
        return value + 1;
      });
    }, Math.max(10, 1000 / clamp(preferences.textSpeed, 10, 100)));
    return () => window.clearInterval(interval);
  }, [current?.id, fullText, preferences.textSpeed, textCharacters.length]);

  useEffect(() => {
    let cancelled = false;
    void readSharedVariables(project).then((variables) => {
      if (cancelled) return;
      setState((value) => ({ ...value, variables: { ...value.variables, ...variables } }));
      sharedReady.current = true;
    });
    return () => { cancelled = true; };
  }, [project.meta.id]);

  useEffect(() => {
    if (!sharedReady.current || !sharedNames.length) return;
    const timer = window.setTimeout(() => void writeSharedVariables(project, state.variables), 250);
    return () => window.clearTimeout(timer);
  }, [project, sharedNames, state.variables]);

  useEffect(() => {
    if (screen !== 'playing' || !hasStarted || !project.settings.autoSave || state.traceCursor < 0) return;
    const timer = window.setTimeout(() => {
      void captureSaveThumbnail(project, state)
        .then((thumbnail) => writeSaveSlot(project, state, 'auto', thumbnail, Math.floor((Date.now() - sessionStartedAt.current) / 1000)))
        .catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [hasStarted, project, screen, state.traceCursor]);

  useEffect(() => {
    if (!autoPlay || !textComplete || state.finished || current?.type === 'branch') return;
    const readingSeconds = Math.max(preferences.autoDelay, .45 + textCharacters.length * .035);
    const voice = current?.type === 'dialogue' && current.voice ? audioRefs.current.voice : undefined;
    const voiceRemaining = voice && Number.isFinite(voice.duration) && !voice.ended ? Math.max(0, voice.duration - voice.currentTime) + .15 : 0;
    const timer = window.setTimeout(() => setState((value) => advanceEngine(project, value)), Math.max(readingSeconds, voiceRemaining) * 1000);
    return () => window.clearTimeout(timer);
  }, [autoPlay, current, preferences.autoDelay, project, state.finished, textCharacters.length, textComplete]);

  useEffect(() => {
    if (!fastForwardActive) return;
    if (state.finished || current?.type === 'branch') {
      setSkipMode(false);
      setControlFastForward(false);
      return;
    }
    if (preferences.skipReadOnly && current && !state.readBlocks[current.id]) {
      setSkipMode(false);
      setControlFastForward(false);
      if (skipMode) setNotice('遇到未读文本，已停止跳过');
      return;
    }
    if (!textComplete) {
      setVisibleCharacters(textCharacters.length);
      return;
    }
    const timer = window.setTimeout(() => setState((value) => advanceEngine(project, value)), 120);
    return () => window.clearTimeout(timer);
  }, [current, fastForwardActive, preferences.skipReadOnly, project, skipMode, state.finished, state.readBlocks, textCharacters.length, textComplete]);

  useEffect(() => {
    for (const channel of ['bgm', 'sfx', 'voice'] as const) {
      const channelState = state.audio[channel];
      const previous = audioRefs.current[channel];
      if (!channelState.playing || (!channelState.assetId && !channelState.track)) {
        if (previous) fadeAudio(channel, previous, 0, channelState.fadeDuration, () => {
          previous.pause();
          if (audioRefs.current[channel] === previous) delete audioRefs.current[channel];
        });
        continue;
      }
      const asset = project.assets.find((item) => item.id === channelState.assetId || assetMatchesTrack(item, channelState.track));
      if (!asset?.uri) continue;
      const channelVolume = channel === 'bgm' ? preferences.bgmVolume : channel === 'sfx' ? preferences.sfxVolume : preferences.voiceVolume;
      const outputVolume = clamp(channelState.volume * preferences.masterVolume * channelVolume);
      if (previous?.dataset.track === asset.id) {
        if (previous.paused) void previous.play().catch(() => undefined);
        fadeAudio(channel, previous, outputVolume, channelState.fadeDuration);
        continue;
      }
      previous?.pause();
      const audio = new Audio(asset.uri);
      audio.dataset.track = asset.id;
      audio.volume = channelState.fadeDuration > 0 ? 0 : outputVolume;
      audio.loop = channelState.loop;
      audioRefs.current[channel] = audio;
      void audio.play().then(() => fadeAudio(channel, audio, outputVolume, channelState.fadeDuration)).catch(() => setNotice('点击画面后将继续播放音频'));
    }
  }, [preferences.bgmVolume, preferences.masterVolume, preferences.sfxVolume, preferences.voiceVolume, project.assets, state.audio]);

  useEffect(() => {
    for (const channel of ['bgm', 'sfx', 'voice'] as const) {
      const audio = audioRefs.current[channel];
      if (!audio) continue;
      const channelPreference = channel === 'bgm' ? preferences.bgmVolume : channel === 'sfx' ? preferences.sfxVolume : preferences.voiceVolume;
      const automation = timelinePreview.audio[channel]?.volume ?? 1;
      audio.volume = clamp(state.audio[channel].volume * automation * preferences.masterVolume * channelPreference);
    }
  }, [preferences.bgmVolume, preferences.masterVolume, preferences.sfxVolume, preferences.voiceVolume, state.audio, timelinePreview.audio]);

  useEffect(() => () => {
    Object.values(audioFadeFrames.current).forEach((frame) => window.cancelAnimationFrame(frame));
    Object.values(audioRefs.current).forEach((audio) => audio.pause());
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (confirmation) {
        if (event.key === 'Escape') setConfirmation(null);
        return;
      }
      if (saveMode || backlogOpen || settingsOpen) return;
      if (event.key === 'Escape' && screen === 'playing') {
        event.preventDefault();
        setAutoPlay(false);
        setSkipMode(false);
        setSystemMenuOpen((value) => !value);
        return;
      }
      if (screen !== 'playing' || systemMenuOpen) return;
      if (event.key === 'Control' && project.settings.fastForward !== false) {
        setAutoPlay(false);
        setControlFastForward(true);
        return;
      }
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        advance();
      }
    };
    const keyup = (event: KeyboardEvent) => { if (event.key === 'Control') setControlFastForward(false); };
    const blur = () => setControlFastForward(false);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  }, [backlogOpen, confirmation, current?.type, displayedText, project, saveMode, screen, settingsOpen, state.finished, systemMenuOpen, textComplete]);

  const quickSave = async () => {
    try {
      const thumbnail = await captureSaveThumbnail(project, state);
      await writeSaveSlot(project, state, 'quick', thumbnail, Math.floor((Date.now() - sessionStartedAt.current) / 1000));
      setNotice('快速存档已保存');
      setSystemMenuOpen(false);
      void refreshContinueSlot();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };

  const quickLoad = async () => {
    try {
      const stored = await readSaveSlotWithRecovery(project, 'quick');
      const loaded = loadSaveGameWithReport(project, stored.save, state.variables);
      setState({ ...loaded.state, readBlocks: { ...globalReadBlocks.current, ...loaded.state.readBlocks } });
      sessionStartedAt.current = Date.now() - (stored.save.playTimeSeconds ?? 0) * 1000;
      setSystemMenuOpen(false);
      const details = [...(stored.recovered ? ['已从备份恢复'] : []), ...(stored.migrated ? ['已迁移旧版存档'] : []), ...loaded.warnings];
      acknowledgeSaveSlotNotice(project.meta.id, 'quick');
      setNotice(`已读取快速存档${details.length ? ` · ${details.join('；')}` : ''}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };

  const rollback = () => {
    setState((value) => rollbackEngine(value, sharedNames));
    setBacklogOpen(false);
    setAutoPlay(false);
    setSkipMode(false);
    setControlFastForward(false);
  };

  const replayVoice = (voiceAssetId: string) => {
    const uri = assetUri(voiceAssetId);
    if (!uri) { setNotice('语音素材缺失'); return; }
    const previous = audioRefs.current.voice;
    previous?.pause();
    const audio = new Audio(uri);
    audio.dataset.track = voiceAssetId;
    audio.volume = clamp(preferences.masterVolume * preferences.voiceVolume);
    audioRefs.current.voice = audio;
    void audio.play().catch(() => setNotice('无法播放这条历史语音'));
  };

  const confirmAction = () => {
    if (confirmation === 'new-game') beginNewGame();
    if (confirmation === 'return-title') {
      setScreen('title');
      setSystemMenuOpen(false);
      setConfirmation(null);
      setAutoPlay(false);
      setSkipMode(false);
      Object.values(audioRefs.current).forEach((audio) => audio.pause());
    }
    if (confirmation === 'exit') {
      setConfirmation(null);
      window.close();
      window.setTimeout(() => setNotice('Web 版本请关闭当前浏览器标签页'), 150);
    }
  };

  return <main className={`game-runtime ${camera.shake > 0 ? 'camera-shake' : ''} ${camera.filter === 'vignette' ? 'camera-vignette' : ''}`} style={{ ...gameUiThemeCssVariables(runtimeTheme), '--game-aspect': `${project.meta.resolution[0]} / ${project.meta.resolution[1]}` } as CSSProperties} onContextMenu={(event) => { event.preventDefault(); if (screen === 'playing' && !saveMode && !settingsOpen && !backlogOpen && !systemMenuOpen) setUiHidden((value) => !value); }} onWheel={(event) => { if (screen === 'playing' && event.deltaY < 0 && !saveMode && !settingsOpen && !systemMenuOpen) { setAutoPlay(false); setSkipMode(false); setBacklogOpen(true); } }}>
    {runtimeFontUri && <style>{`@font-face{font-family:"Slide Project Font";src:url(${JSON.stringify(runtimeFontUri)})}`}</style>}
    <section className="game-stage" onClick={() => { if (screen === 'playing' && !systemMenuOpen) advance(); }}>
      <div className="game-camera" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom}) rotate(${camera.rotation}deg)`, filter: cameraFilter, transitionDuration: `${camera.duration}s` }}>
        {background && <TransitioningBackground className="game-background" src={background} alt="" transition={state.stage.transition} duration={state.stage.transitionDuration} opacity={timelinePreview.sceneOpacity ?? 1} />}
        {state.stage.sceneLayers.map((layer) => {
          const uri = assetUri(layer.assetId);
          const distance = layer.distance ?? 1;
          const relativeScale = Math.max(.1, 1 + (camera.zoom - 1) * (distance - 1));
          return uri ? <img className="game-scene-layer" key={layer.id} src={uri} alt="" style={{ left: `${layer.x}%`, top: `${layer.y}%`, opacity: layer.opacity * (timelinePreview.sceneOpacity ?? 1), transform: `translate(calc(-50% + ${camera.x * (distance - 1)}px), calc(-50% + ${camera.y * (distance - 1)}px)) scale(${layer.scale * relativeScale})`, mixBlendMode: layer.blendMode, zIndex: layer.layer + 1 }} /> : null;
        })}
        {Object.values(state.stage.characters).sort((left, right) => left.layer - right.layer).map((stageActor) => {
          const actor = { ...stageActor, ...(timelinePreview.characters[stageActor.characterId] ?? {}) };
          const character = project.characters.find((item) => item.id === actor.characterId);
          const uri = assetUri(actor.assetId);
          return <div className={`game-character enter-${actor.animation}`} key={actor.characterId} style={{ left: `${actor.x}%`, bottom: `${100 - actor.y}%`, width: characterWidthCss(actor.width), height: dimensionCss(actor.height), transform: `translateX(-50%) scale(${actor.scale})`, opacity: actor.opacity, zIndex: actor.layer + 20 }}>
            {uri ? <img src={uri} alt={`${character?.name ?? actor.characterId} · ${actor.expression}`} /> : <div className="game-character-placeholder" style={{ '--character-color': character?.color ?? '#5d6f81' } as CSSProperties}><CharacterSilhouette characterId={actor.characterId} />{character?.name && <span className="game-character-placeholder-name">{character.name}</span>}</div>}
            {actor.overlays?.map((overlay) => { const overlayUri = assetUri(overlay.assetId); return overlayUri ? <img className="game-character-overlay" key={overlay.id} src={overlayUri} alt="" style={{ opacity: overlay.opacity, zIndex: overlay.layer, width: overlay.overrideSize ? dimensionCss(overlay.width) : '100%', height: overlay.overrideSize ? dimensionCss(overlay.height) : '100%' }} /> : null; })}
          </div>;
        })}
      </div>
      <div className="game-shade" />
      {current?.type === 'branch' && <section className="game-choices" onClick={(event) => event.stopPropagation()}><strong>{current.title || '请选择'}</strong>{current.options?.map((option, index) => <button key={`${option.target}-${index}`} onClick={() => setState((value) => chooseBranch(project, value, option.target))}><span>{option.text}</span></button>)}</section>}
      {screen === 'playing' && state.finished && <section className={`game-finished ${state.error ? 'error' : ''}`} onClick={(event) => event.stopPropagation()}><small>{state.error ? 'RUNTIME ERROR' : 'FIN'}</small><strong>{state.error ? '游戏运行中断' : '旅程结束'}</strong><span>{state.error || project.meta.name}</span><nav>{state.error && <button onClick={() => setState({ ...createEngineState(project, state.fragmentId), readBlocks: { ...globalReadBlocks.current } })}><span>重试当前章节</span></button>}<button className="primary" onClick={() => { setScreen('title'); setAutoPlay(false); setSkipMode(false); }}><span>返回标题</span></button></nav></section>}
    </section>
    {screen === 'title' && <section className="game-title-screen" onClick={(event) => event.stopPropagation()}>
      {titleBackground && <img className="game-title-background" src={titleBackground} alt="" />}
      <div className="game-title-shade" />
      <div className="game-title-content">
        {titleLogo ? <img className="game-title-logo" src={titleLogo} alt={project.meta.name} /> : <h1>{project.meta.name}</h1>}
        <p>{project.ui?.title?.subtitle || project.meta.author || 'Slide Studio'}</p>
        <nav className="game-title-actions" aria-label="标题菜单">
          <button className="primary" onClick={requestNewGame}><span>开始游戏</span></button>
          <button disabled={!continueSlot || continueLoading} onClick={() => void continueGame()}><span>{continueLoading ? '检查存档…' : '继续游戏'}</span></button>
          <button onClick={() => openPanel('load')}><span>读取存档</span></button>
          <button onClick={() => openPanel('settings')}><span>游戏设置</span></button>
          <button onClick={() => setConfirmation('exit')}><span>退出游戏</span></button>
        </nav>
      </div>
      <small className="game-title-version">{project.meta.author || 'Slide Studio'} · v{project.meta.gameVersion || '1.0.0'}</small>
    </section>}
    {screen === 'playing' && !uiHidden && !state.finished && <section className={`game-dialogue-layer ${current?.type === 'branch' ? 'branch-active' : ''}`} onClick={(event) => event.stopPropagation()}>
      <div ref={dialogueCopyRef} className={`game-dialogue-copy speaker-${runtimeTheme.speakerStyle}`} onClick={advance}>
        {current?.type === 'dialogue' && <strong>{resolveDialogueSpeaker(project, current, state.variables)}</strong>}
        <p>{displayedText}{textComplete
          ? <span className="dialogue-complete-indicator" aria-label="文字播放完成"><ChevronDown /></span>
          : <span className="typewriter-caret" aria-hidden="true" />}</p>
        <div ref={dialogueMeasureRef} className="game-dialogue-measure" aria-hidden="true">{current?.type === 'dialogue' && <strong>{resolveDialogueSpeaker(project, current, state.variables)}</strong>}<p>{fullText}<span className="dialogue-complete-indicator"><ChevronDown /></span></p></div>
      </div>
      <nav className="game-text-controls" aria-label="游戏控制">
        <button className={fastForwardActive ? 'active' : ''} onClick={() => { setAutoPlay(false); setControlFastForward(false); setSkipMode((value) => !value); }}><span>跳过</span></button>
        <button className={autoPlay ? 'active' : ''} onClick={() => { setSkipMode(false); setAutoPlay((value) => !value); }}><span>自动</span></button>
        <button onClick={() => openPanel('save')}><span>存档</span></button>
        <button onClick={() => openPanel('load')}><span>读档</span></button>
        <button onClick={() => openPanel('history')}><span>历史</span></button>
        <button onClick={() => openPanel('settings')}><span>设置</span></button>
        <button onClick={() => setUiHidden(true)} title="隐藏界面"><span>隐藏</span></button>
      </nav>
    </section>}
    {screen === 'playing' && uiHidden && <button className="game-ui-restore" title="显示界面" onClick={() => setUiHidden(false)}><Eye /></button>}
    {screen === 'playing' && systemMenuOpen && <section className="game-system-backdrop" onClick={() => setSystemMenuOpen(false)}><div className="game-system-menu" role="dialog" aria-modal="true" aria-labelledby="system-menu-title" onClick={(event) => event.stopPropagation()}><header><span>PAUSED</span><h2 id="system-menu-title">系统菜单</h2></header><nav><button className="primary" onClick={() => setSystemMenuOpen(false)}><span>继续游戏</span></button><button onClick={() => void quickSave()}><span>快速存档</span></button><button onClick={() => void quickLoad()}><span>快速读档</span></button><button onClick={() => openPanel('load')}><span>读取存档</span></button><button onClick={() => openPanel('settings')}><span>游戏设置</span></button><button onClick={() => setConfirmation('return-title')}><span>返回标题</span></button></nav></div></section>}
    {notice && <button className="game-notice" onClick={() => setNotice('')}>{notice}</button>}
    {backlogOpen && <section className="game-panel game-backlog"><header><strong>文本历史</strong><button className="backlog-rollback" title="回退一步" disabled={!state.rollbackStack.length} onClick={rollback}><RotateCcw /></button><button title="关闭" onClick={() => setBacklogOpen(false)}><X /></button></header><div>{state.backlog.length ? [...state.backlog].reverse().map((entry, index) => <article key={`${entry.blockId}-${index}`}><div><strong>{entry.speaker || '旁白'}</strong>{entry.voiceAssetId && <button title="重播语音" onClick={() => replayVoice(entry.voiceAssetId!)}><Volume2 /></button>}</div><p>{entry.text}</p></article>) : <span>还没有历史记录</span>}</div></section>}
    {settingsOpen && <section className="game-panel game-settings"><header><strong>游戏设置</strong><button title="关闭" onClick={() => setSettingsOpen(false)}><X /></button></header>
      {([['masterVolume', '主音量'], ['bgmVolume', '背景音乐'], ['sfxVolume', '音效'], ['voiceVolume', '语音']] as const).map(([key, label]) => <label key={key}><span>{label}</span><input aria-label={label} type="range" min="0" max="1" step=".01" value={preferences[key]} onChange={(event) => updatePreference(key, Number(event.target.value))} /><strong>{Math.round(preferences[key] * 100)}%</strong></label>)}
      <label><span>文字速度</span><input aria-label="文字速度" type="range" min="10" max="100" step="1" value={preferences.textSpeed} onChange={(event) => updatePreference('textSpeed', Number(event.target.value))} /><strong>{preferences.textSpeed} 字/秒</strong></label>
      <label><span>自动模式速度</span><input aria-label="自动模式速度" type="range" min=".5" max="5" step=".1" value={preferences.autoDelay} onChange={(event) => updatePreference('autoDelay', Number(event.target.value))} /><strong>{preferences.autoDelay.toFixed(1)} 秒</strong></label>
      <label className="game-setting-toggle"><span>仅跳过已读</span><input aria-label="仅跳过已读" type="checkbox" checked={preferences.skipReadOnly} onChange={(event) => updatePreference('skipReadOnly', event.target.checked)} /><strong>{preferences.skipReadOnly ? '开启' : '关闭'}</strong></label>
      {runtimeLanguages.length > 1 && <label className="game-setting-language"><span>游戏语言</span><select aria-label="游戏语言" value={language} onChange={(event) => updateLanguage(event.target.value)}>{runtimeLanguages.map((code) => <option value={code} key={code}>{languageLabel(code)}</option>)}</select></label>}
    </section>}
    {confirmation && <div className="game-confirm-backdrop" role="presentation" onClick={() => setConfirmation(null)}><section className="game-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="game-confirm-title" onClick={(event) => event.stopPropagation()}><span>CONFIRM</span><h2 id="game-confirm-title">{confirmation === 'new-game' ? '开始新游戏？' : confirmation === 'return-title' ? '返回标题画面？' : '退出游戏？'}</h2><p>{confirmation === 'new-game' ? '当前未保存的游戏进度将会丢失。' : confirmation === 'return-title' ? '请确认当前进度已经保存。' : 'Windows 版本将关闭游戏，Web 版本需要关闭标签页。'}</p><footer><button onClick={() => setConfirmation(null)}>取消</button><button className="primary" onClick={confirmAction}>确认</button></footer></section></div>}
    {saveMode && <SaveGameDialog project={project} state={state} mode={saveMode} playTimeSeconds={Math.floor((Date.now() - sessionStartedAt.current) / 1000)} close={() => { setSaveMode(null); void refreshContinueSlot(); }} loadState={(loadedState) => { setState({ ...loadedState, readBlocks: { ...globalReadBlocks.current, ...loadedState.readBlocks } }); setScreen('playing'); }} notify={setNotice} />}
  </main>;
}
