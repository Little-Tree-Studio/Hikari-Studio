import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArchiveRestore,
  ChevronDown,
  ExternalLink,
  History,
  Layers3,
  LocateFixed,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Zap,
  X,
} from "lucide-react";
import {
  advanceEngine,
  chooseBranch,
  createEngineState,
  currentBlock,
  EngineSeekCache,
  EngineTraceRestoreCache,
  resolveDialogueSpeaker,
  rollbackEngine,
  seekEngine,
} from "../engine-core/runtime";
import type { EngineState } from "../engine-core/types";
import { BLOCK_CONFORMANCE_MATRIX_VERSION, observeEngineState } from "../engine-core/blockConformance";
import type { TimelinePreviewValues } from "../core/timeline";
import { characterWidthCss, dimensionCss } from "../core/stageLayout";
import type { BlockType, Project } from "../types";
import { writeLargeValue } from "../core/storage";
import { reportPreviewSeekPerformance } from "../api";
import { PreviewSeekProfiler } from "../performance/previewSeekProfiler";
import {
  captureSaveThumbnail,
  readSharedVariables,
  writeSaveSlot,
  writeSharedVariables,
} from "../core/saveGames";
import { RuntimeDebugger, type RuntimeConsoleEntry } from "./RuntimeDebugger";
import { SaveGameDialog } from "./SaveGameDialog";

interface PreviewProps {
  project: Project;
  editorIndex: number;
  standalone?: boolean;
  debugMode?: boolean;
  onEditorLocationChange?: (fragmentId: string, blockIndex: number) => void;
  onStageCharacterMove?: (characterId: string, x: number, y: number) => void;
  timelinePreview?: TimelinePreviewValues;
  conformanceCaseId?: BlockType;
}

type StageGuide = {
  axis: "x" | "y";
  value: number;
  label: string;
};

const SAFE_AREA_INSET = 7;
const SNAP_THRESHOLD = 2.2;
const X_SNAP_POINTS = [
  { value: SAFE_AREA_INSET, label: "安全区左" },
  { value: 25, label: "1/4" },
  { value: 50, label: "水平中心" },
  { value: 75, label: "3/4" },
  { value: 100 - SAFE_AREA_INSET, label: "安全区右" },
];
const Y_SNAP_POINTS = [
  { value: SAFE_AREA_INSET, label: "安全区上" },
  { value: 50, label: "垂直中心" },
  { value: 100 - SAFE_AREA_INSET, label: "安全区下" },
];

export function Preview({
  project,
  editorIndex,
  standalone = false,
  debugMode = false,
  onEditorLocationChange,
  onStageCharacterMove,
  timelinePreview,
  conformanceCaseId,
}: PreviewProps) {
  const previewSeekCacheRef = useRef<EngineSeekCache | null>(null);
  const traceRestoreCacheRef = useRef<EngineTraceRestoreCache | null>(null);
  const previewSeekProfilerRef = useRef<PreviewSeekProfiler | null>(null);
  const previewSeekReportTimerRef = useRef<number | undefined>(undefined);
  const opSeekFrameRef = useRef<number | undefined>(undefined);
  const pendingOpIndexRef = useRef<number | undefined>(undefined);
  previewSeekCacheRef.current ??= new EngineSeekCache();
  traceRestoreCacheRef.current ??= new EngineTraceRestoreCache();
  previewSeekProfilerRef.current ??= new PreviewSeekProfiler();
  const [state, setState] = useState<EngineState>(() =>
    seekEngine(project, project.activeFragmentId, editorIndex, previewSeekCacheRef.current!),
  );
  const [playing, setPlaying] = useState(false);
  const [resolution, setResolution] = useState(
    `${project.meta.resolution[0]}x${project.meta.resolution[1]}`,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [constrainToSafeArea, setConstrainToSafeArea] = useState(true);
  const [snapCharacters, setSnapCharacters] = useState(true);
  const [stageGuides, setStageGuides] = useState<StageGuide[]>([]);
  const [selectedStageCharacterId, setSelectedStageCharacterId] = useState<string>();
  const [failedStageAssetIds, setFailedStageAssetIds] = useState<Set<string>>(() => new Set());
  const [autoDelay, setAutoDelay] = useState(
    project.settings.autoPlayDelay ?? 1.5,
  );
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [saveDialogMode, setSaveDialogMode] = useState<"save" | "load" | null>(null);
  const [runtimeNotice, setRuntimeNotice] = useState("");
  const [consoleEntries, setConsoleEntries] = useState<RuntimeConsoleEntry[]>([]);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const logSequenceRef = useRef(0);
  const sessionStartedAtRef = useRef(Date.now());
  const sharedReadyRef = useRef(false);
  const characterDragRef = useRef<{ characterId: string; pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [draggingCharacterId, setDraggingCharacterId] = useState<string>();
  const runtimeLocationRef = useRef<{
    fragmentId: string;
    blockIndex: number;
  } | null>(null);
  const externalSyncStateRef = useRef<EngineState | null>(null);
  const pendingEditorSyncRef = useRef(false);
  const editorLocationRef = useRef({ fragmentId: project.activeFragmentId, blockIndex: editorIndex });
  const onEditorLocationChangeRef = useRef(onEditorLocationChange);
  editorLocationRef.current = { fragmentId: project.activeFragmentId, blockIndex: editorIndex };
  onEditorLocationChangeRef.current = onEditorLocationChange;
  const fragmentMetadata = useMemo(() => new Map(
    project.chapters.flatMap((chapter) =>
      chapter.fragments.map((fragment) => [fragment.id, { chapterName: chapter.name, fragmentName: fragment.name }] as const),
    ),
  ), [project.chapters]);
  const opEntries = useMemo(() => state.executionTrace.map((entry) => ({
    ...entry,
    blockIndex: entry.instructionPointer,
    block: project.scripts[entry.fragmentId]?.[entry.instructionPointer],
    chapterName: fragmentMetadata.get(entry.fragmentId)?.chapterName ?? entry.fragmentId,
    fragmentName: fragmentMetadata.get(entry.fragmentId)?.fragmentName ?? entry.fragmentId,
  })), [fragmentMetadata, project.scripts, state.executionTrace]);
  const currentOpIndex = Math.max(0, state.traceCursor);
  const sharedVariableNames = useMemo(() => Object.entries(project.variableDefinitions ?? {})
    .filter(([, definition]) => definition.persistence === "shared")
    .map(([name]) => name), [project.variableDefinitions]);
  const assetIndexes = useMemo(() => ({
    byId: new Map(project.assets.map((asset) => [asset.id, asset] as const)),
    byName: new Map(project.assets.map((asset) => [asset.name, asset] as const)),
  }), [project.assets]);
  const charactersById = useMemo(
    () => new Map(project.characters.map((character) => [character.id, character] as const)),
    [project.characters],
  );
  const current = currentBlock(project, state);
  const orderedStageCharacters = Object.values(state.stage.characters).map((character) => ({ ...character, ...(timelinePreview?.characters[character.characterId] ?? {}) })).sort(
    (left, right) => left.layer - right.layer,
  );
  const stageCharacterIds = orderedStageCharacters
    .map((character) => character.characterId)
    .join("|");
  const background = assetIndexes.byId.get(state.stage.backgroundAssetId ?? '')?.uri ?? "./assets/lake.jpg";

  useEffect(() => {
    if (!conformanceCaseId) return;
    const harness = {
      surface: 'editor-preview' as const,
      caseId: conformanceCaseId,
      matrixVersion: BLOCK_CONFORMANCE_MATRIX_VERSION,
      getObservation: () => observeEngineState(project, state),
      advance: () => setState((value) => advanceEngine(project, value)),
      choose: (target: string) => setState((value) => chooseBranch(project, value, target)),
      reset: () => setState(createEngineState(project)),
    };
    window.__HIKARI_BLOCK_CONFORMANCE__ = harness;
    return () => {
      if (window.__HIKARI_BLOCK_CONFORMANCE__ === harness) delete window.__HIKARI_BLOCK_CONFORMANCE__;
    };
  }, [conformanceCaseId, project, state]);

  useEffect(() => {
    setFailedStageAssetIds(new Set());
  }, [project.assets]);

  useEffect(() => {
    if (!orderedStageCharacters.length) {
      setSelectedStageCharacterId(undefined);
      return;
    }
    if (!orderedStageCharacters.some((character) => character.characterId === selectedStageCharacterId)) {
      setSelectedStageCharacterId(orderedStageCharacters.at(-1)?.characterId);
    }
  }, [stageCharacterIds, selectedStageCharacterId]);

  useEffect(() => {
    const runtimeLocation = runtimeLocationRef.current;
    if (
      runtimeLocation?.fragmentId === project.activeFragmentId &&
      runtimeLocation.blockIndex === editorIndex
    ) {
      runtimeLocationRef.current = null;
      return;
    }
    if (runtimeLocation) runtimeLocationRef.current = null;
    pendingEditorSyncRef.current = true;
    setState((currentState) => {
      const nextState = seekEngine(project, project.activeFragmentId, editorIndex, previewSeekCacheRef.current!);
      for (const name of sharedVariableNames) if (name in currentState.variables) nextState.variables[name] = currentState.variables[name];
      externalSyncStateRef.current = nextState;
      pendingEditorSyncRef.current = false;
      return nextState;
    });
    setPlaying(false);
  }, [
    project.activeFragmentId,
    editorIndex,
    project.scripts,
    project.characters,
    project.assets,
    project.scenes,
    project.variables,
  ]);

  useEffect(() => {
    let cancelled = false;
    sharedReadyRef.current = false;
    void readSharedVariables(project).then((shared) => {
      if (cancelled) return;
      setState((currentState) => ({ ...currentState, variables: { ...currentState.variables, ...shared } }));
      sharedReadyRef.current = true;
    });
    return () => { cancelled = true; };
  }, [project.meta.id]);

  useEffect(() => {
    if (!sharedReadyRef.current || !sharedVariableNames.length) return;
    const timer = window.setTimeout(() => void writeSharedVariables(project, state.variables), 250);
    return () => window.clearTimeout(timer);
  }, [project.meta.id, project.variableDefinitions, state.variables]);

  useEffect(() => {
    if (!project.settings.autoSave || (!debugMode && !standalone) || state.traceCursor < 0) return;
    const timer = window.setTimeout(() => {
      void captureSaveThumbnail(project, state)
        .then((thumbnail) => writeSaveSlot(project, state, "auto", thumbnail, Math.floor((Date.now() - sessionStartedAtRef.current) / 1000)))
        .then(() => setRuntimeNotice("自动存档已更新"))
        .catch((error) => setRuntimeNotice(error instanceof Error ? error.message : String(error)));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [debugMode, project.meta.id, project.settings.autoSave, standalone, state.traceCursor]);

  useEffect(() => {
    const notifyEditor = onEditorLocationChangeRef.current;
    if (!notifyEditor) return;
    if (pendingEditorSyncRef.current) return;
    const externalSyncState = externalSyncStateRef.current;
    if (externalSyncState) {
      if (externalSyncState === state) externalSyncStateRef.current = null;
      return;
    }
    const traceLocation = state.executionTrace[state.traceCursor];
    const fragmentId = traceLocation?.fragmentId ?? state.fragmentId;
    const blockIndex = traceLocation?.instructionPointer ?? state.instructionPointer;
    const editorLocation = editorLocationRef.current;
    if (fragmentId === editorLocation.fragmentId && blockIndex === editorLocation.blockIndex) return;
    runtimeLocationRef.current = {
      fragmentId,
      blockIndex,
    };
    notifyEditor(fragmentId, blockIndex);
  }, [state.executionTrace, state.fragmentId, state.instructionPointer, state.traceCursor]);

  useEffect(() => {
    if (!debugMode) return;
    const block = currentBlock(project, state);
    const message = state.error
      ? state.error
      : `${state.fragmentId} · OP ${state.instructionPointer + 1} · ${block?.type ?? "结束"}`;
    const level: "info" | "error" = state.error ? "error" : "info";
    setConsoleEntries((entries) =>
      entries.at(-1)?.message === message
        ? entries
        : [
            ...entries,
            { id: `${Date.now()}-${++logSequenceRef.current}`, level, message },
          ].slice(-120),
    );
  }, [debugMode, state.fragmentId, state.instructionPointer, state.error]);

  useEffect(() => {
    if (!debugMode) return;
    const record = (message: string) =>
      setConsoleEntries((entries) =>
        [
          ...entries,
          {
            id: `${Date.now()}-${++logSequenceRef.current}`,
            level: "error" as const,
            message,
          },
        ].slice(-120),
      );
    const handleError = (event: ErrorEvent) =>
      record(`脚本错误：${event.message}`);
    const handleRejection = (event: PromiseRejectionEvent) =>
      record(`未处理 Promise：${String(event.reason)}`);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [debugMode]);

  useEffect(() => {
    if (!playing || state.finished || current?.type === "branch") return;
    const timer = window.setTimeout(
      () => setState((value) => advanceEngine(project, value)),
      autoDelay * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [current?.id, playing, project, state.finished]);

  useEffect(() => {
    if (state.finished) setPlaying(false);
  }, [state.finished]);

  useEffect(() => {
    for (const channel of ["bgm", "sfx", "voice"] as const) {
      const channelState = state.audio[channel];
      const previous = audioRefs.current[channel];
      if (!channelState.playing || !channelState.track) {
        if (previous) {
          previous.pause();
          delete audioRefs.current[channel];
        }
        continue;
      }
      const asset = assetIndexes.byId.get(channelState.assetId ?? '')
        ?? assetIndexes.byId.get(channelState.track)
        ?? assetIndexes.byName.get(channelState.track)
        ?? project.assets.find((item) => item.path.endsWith(channelState.track ?? ""));
      if (!asset?.uri || previous?.dataset.track === channelState.track) {
        if (previous) previous.volume = channelState.volume;
        continue;
      }
      previous?.pause();
      const audio = new Audio(asset.uri);
      audio.dataset.track = channelState.track;
      audio.volume = Math.max(0, Math.min(1, channelState.volume));
      audio.loop = channelState.loop;
      audioRefs.current[channel] = audio;
      void audio
        .play()
        .catch(() =>
          setRuntimeNotice(`${channel.toUpperCase()} 等待用户交互后播放`),
        );
    }
    return () => undefined;
  }, [assetIndexes, project.assets, state.audio]);

  useEffect(() => {
    for (const channel of ["bgm", "sfx", "voice"] as const) {
      const volume = timelinePreview?.audio[channel]?.volume;
      const audio = audioRefs.current[channel];
      if (audio && volume !== undefined) audio.volume = Math.max(0, Math.min(1, volume));
    }
  }, [timelinePreview?.audio]);

  useEffect(
    () => () => {
      for (const audio of Object.values(audioRefs.current)) audio.pause();
      window.clearTimeout(previewSeekReportTimerRef.current);
      if (opSeekFrameRef.current !== undefined) window.cancelAnimationFrame(opSeekFrameRef.current);
    },
    [],
  );

  const reset = (full = false) => {
    const entry = full
      ? (project.chapters.find((chapter) => chapter.entry)?.fragments[0]?.id ??
        project.chapters[0]?.fragments[0]?.id)
      : project.activeFragmentId;
    if (!entry) return;
    setState((currentState) => {
      const nextState = createEngineState(project, entry);
      for (const name of sharedVariableNames) if (name in currentState.variables) nextState.variables[name] = currentState.variables[name];
      return nextState;
    });
    setRuntimeNotice(full ? "从游戏入口运行完整流程" : "已重载当前 Fragment");
  };
  const seekOp = (opIndex: number) => {
    const entry = opEntries[opIndex];
    if (!entry) return;
    previewSeekProfilerRef.current!.recordInput(opSeekFrameRef.current !== undefined);
    pendingOpIndexRef.current = opIndex;
    if (opSeekFrameRef.current !== undefined) return;
    opSeekFrameRef.current = window.requestAnimationFrame(() => {
      opSeekFrameRef.current = undefined;
      const targetIndex = pendingOpIndexRef.current;
      pendingOpIndexRef.current = undefined;
      if (targetIndex === undefined) return;
      setState((currentState) => {
        const startedAt = performance.now();
        const restored = traceRestoreCacheRef.current!.restore(currentState, targetIndex, sharedVariableNames);
        previewSeekProfilerRef.current!.record(performance.now() - startedAt);
        return restored;
      });
      window.clearTimeout(previewSeekReportTimerRef.current);
      previewSeekReportTimerRef.current = window.setTimeout(() => {
        const report = previewSeekProfilerRef.current!.snapshot(
          previewSeekCacheRef.current!.stats(),
          traceRestoreCacheRef.current!.stats(),
        );
        window.__HIKARI_PREVIEW_SEEK_PERFORMANCE__ = report;
        void reportPreviewSeekPerformance(report).catch((error) => {
          console.warn('Preview seek performance report failed', error);
        });
      }, 2_000);
      setRuntimeNotice(`已定位 op ${targetIndex + 1}`);
    });
  };
  const updateRuntimeVariable = (name: string, raw: string) =>
    setState((currentState) => {
      const previous = currentState.variables[name];
      const value =
        typeof previous === "boolean"
          ? raw === "true"
          : typeof previous === "number"
            ? Number(raw) || 0
            : raw;
      return {
        ...currentState,
        variables: { ...currentState.variables, [name]: value },
      };
    });
  const openStandalone = async () => {
    const previewWindow = window.open(
      "about:blank",
      "hikari-game-preview",
      "popup,width=1280,height=760",
    );
    if (!previewWindow) {
      setRuntimeNotice("独立预览窗口被系统拦截");
      return;
    }
    try {
      setRuntimeNotice("正在准备独立预览…");
      await writeLargeValue("hikari-preview-project", JSON.stringify(project));
      const url = new URL(window.location.href);
      url.search = `?preview=1&fragment=${encodeURIComponent(state.fragmentId)}&index=${state.instructionPointer}`;
      previewWindow.location.replace(url.toString());
      setRuntimeNotice("独立预览已打开");
    } catch (error) {
      previewWindow.close();
      setRuntimeNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const quickSave = async () => {
    try {
      const thumbnail = await captureSaveThumbnail(project, state);
      await writeSaveSlot(project, state, "quick", thumbnail, Math.floor((Date.now() - sessionStartedAtRef.current) / 1000));
      setRuntimeNotice("快速存档已保存");
    } catch (error) {
      setRuntimeNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const camera = { ...state.stage.camera, ...(timelinePreview?.camera ?? {}) };
  const displaySpeaker = resolveDialogueSpeaker(
    project,
    current,
    state.variables,
  );
  const cameraFilter =
    camera.filter === "monochrome"
      ? "grayscale(1)"
      : camera.filter === "sepia"
        ? "sepia(.85)"
        : camera.filter === "blur"
          ? "blur(3px)"
      : "none";

  const characterPointerPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = event.currentTarget.closest<HTMLElement>(".stage");
    if (!stage) return null;
    const bounds = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  };
  const snapCoordinate = (
    value: number,
    points: { value: number; label: string }[],
    axis: StageGuide["axis"],
  ) => {
    if (!snapCharacters) return { value, guide: undefined };
    const nearest = points.reduce((best, point) =>
      Math.abs(point.value - value) < Math.abs(best.value - value) ? point : best,
    );
    return Math.abs(nearest.value - value) <= SNAP_THRESHOLD
      ? { value: nearest.value, guide: { axis, value: nearest.value, label: nearest.label } satisfies StageGuide }
      : { value, guide: undefined };
  };
  const beginCharacterDrag = (stageCharacterId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onStageCharacterMove) return;
    const point = characterPointerPosition(event);
    if (!point) return;
    const actor = state.stage.characters[stageCharacterId];
    if (!actor) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedStageCharacterId(stageCharacterId);
    setStageGuides([]);
    event.currentTarget.setPointerCapture(event.pointerId);
    characterDragRef.current = { characterId: stageCharacterId, pointerId: event.pointerId, x: actor.x, y: actor.y, offsetX: actor.x - point.x, offsetY: actor.y - point.y };
    setDraggingCharacterId(stageCharacterId);
  };
  const moveCharacterDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = characterDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = characterPointerPosition(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    const minimum = constrainToSafeArea ? SAFE_AREA_INSET : 0;
    const maximum = constrainToSafeArea ? 100 - SAFE_AREA_INSET : 100;
    const rawX = Math.max(minimum, Math.min(maximum, point.x + drag.offsetX));
    const rawY = Math.max(minimum, Math.min(maximum, point.y + drag.offsetY));
    const snappedX = snapCoordinate(rawX, X_SNAP_POINTS, "x");
    const snappedY = snapCoordinate(rawY, Y_SNAP_POINTS, "y");
    drag.x = snappedX.value;
    drag.y = snappedY.value;
    setStageGuides(
      [snappedX.guide, snappedY.guide].filter(
        (guide): guide is StageGuide => Boolean(guide),
      ),
    );
    setState((value) => {
      const actor = value.stage.characters[drag.characterId];
      if (!actor) return value;
      return { ...value, stage: { ...value.stage, characters: { ...value.stage.characters, [drag.characterId]: { ...actor, position: "custom", x: drag.x, y: drag.y } } } };
    });
  };
  const finishCharacterDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = characterDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    characterDragRef.current = null;
    setDraggingCharacterId(undefined);
    setStageGuides([]);
    onStageCharacterMove?.(drag.characterId, Number(drag.x.toFixed(2)), Number(drag.y.toFixed(2)));
  };

  return (
    <aside
      className={`preview-pane ${standalone ? "standalone-preview" : ""} ${debugMode ? "debug-preview" : ""}`}
    >
      <div className="preview-toolbar">
        <strong>
          {debugMode ? "游戏调试" : standalone ? project.meta.name : "游戏预览"}
        </strong>
        <select
          className="select-compact"
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
        >
          <option value="1280x720">1280 × 720</option>
          <option value="1920x1080">1920 × 1080</option>
        </select>
        <button
          className="icon-button small"
          title="回到当前 Block"
          onClick={() =>
            setState(seekEngine(project, project.activeFragmentId, editorIndex, previewSeekCacheRef.current!))
          }
        >
          <LocateFixed />
        </button>
        <button
          className="icon-button small"
          title="重载当前 Fragment"
          onClick={() => reset(false)}
        >
          <RefreshCw />
        </button>
        {debugMode && (
          <button
            className="icon-button small"
            title="运行完整流程"
            onClick={() => reset(true)}
          >
            <Layers3 />
          </button>
        )}
        <button
          className="icon-button small"
          title="流程回滚"
          disabled={!state.rollbackStack.length}
          onClick={() => setState((value) => rollbackEngine(value, sharedVariableNames))}
        >
          <RotateCcw />
        </button>
        <button
          className="icon-button small"
          title="快速存档"
          onClick={() => void quickSave()}
        >
          <Zap />
        </button>
        <button
          className="icon-button small"
          title="保存游戏"
          onClick={() => setSaveDialogMode("save")}
        >
          <Save />
        </button>
        <button
          className="icon-button small"
          title="读取游戏"
          onClick={() => setSaveDialogMode("load")}
        >
          <ArchiveRestore />
        </button>
        <button
          className="icon-button small"
          title="文本历史"
          onClick={() => setBacklogOpen((value) => !value)}
        >
          <History />
        </button>
        {!standalone && (
          <button
            className="icon-button small"
            title="独立窗口"
            onClick={() => void openStandalone()}
          >
            <ExternalLink />
          </button>
        )}
      </div>
      <div className="stage-wrap">
        <div
          className={`stage ${showSafeArea || draggingCharacterId ? "show-safe-area" : ""} ${camera.shake > 0 ? "camera-shake" : ""} ${camera.filter === "vignette" ? "camera-vignette" : ""}`}
          data-resolution={resolution}
          onClick={() =>
            current?.type !== "branch" &&
            setState((value) => advanceEngine(project, value))
          }
        >
          <div
            className="camera-layer"
            style={{
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom}) rotate(${camera.rotation}deg)`,
              filter: cameraFilter,
              transitionDuration: `${camera.duration}s`,
            }}
          >
            <img className="stage-bg" src={background} alt="游戏场景" style={{ opacity: timelinePreview?.sceneOpacity ?? 1 }} />
            {state.stage.sceneLayers.map((layer) => {
              const asset = assetIndexes.byId.get(layer.assetId ?? '');
              const distance = layer.distance ?? 1;
              const relativeScale = Math.max(
                0.1,
                1 + (camera.zoom - 1) * (distance - 1),
              );
              return asset?.uri ? (
                <img
                  className="stage-scene-layer"
                  key={layer.id}
                  src={asset.uri}
                  alt={layer.name}
                  style={{
                    left: `${layer.x}%`,
                    top: `${layer.y}%`,
                    opacity: layer.opacity * (timelinePreview?.sceneOpacity ?? 1),
                    transform: `translate(calc(-50% + ${camera.x * (distance - 1)}px), calc(-50% + ${camera.y * (distance - 1)}px)) scale(${layer.scale * relativeScale})`,
                    mixBlendMode: layer.blendMode,
                    zIndex: layer.layer + 1,
                  }}
                />
              ) : null;
            })}
            {orderedStageCharacters.map((stageCharacter) => {
                const character = charactersById.get(stageCharacter.characterId);
                const asset = assetIndexes.byId.get(stageCharacter.assetId ?? '');
                return (
                  <div
                    className={`stage-character enter-${stageCharacter.animation} ${onStageCharacterMove ? "draggable" : ""} ${selectedStageCharacterId === stageCharacter.characterId ? "selected" : ""} ${draggingCharacterId === stageCharacter.characterId ? "dragging" : ""}`}
                    key={stageCharacter.characterId}
                    title={onStageCharacterMove ? "拖动立绘调整位置" : undefined}
                    onClick={(event) => { if (onStageCharacterMove) event.stopPropagation(); }}
                    onPointerDown={(event) => beginCharacterDrag(stageCharacter.characterId, event)}
                    onPointerMove={moveCharacterDrag}
                    onPointerUp={finishCharacterDrag}
                    onPointerCancel={finishCharacterDrag}
                    style={{
                      left: `${stageCharacter.x}%`,
                      bottom: `${100 - stageCharacter.y}%`,
                      width: characterWidthCss(stageCharacter.width),
                      height: dimensionCss(stageCharacter.height),
                      transform: `translateX(-50%) scale(${stageCharacter.scale})`,
                      opacity: stageCharacter.opacity,
                      zIndex: selectedStageCharacterId === stageCharacter.characterId
                        ? 1000
                        : stageCharacter.layer + 20,
                    }}
                  >
                    {asset?.uri && !failedStageAssetIds.has(asset.id) ? (
                      <img
                        src={asset.uri}
                        alt={`${character?.name ?? stageCharacter.characterId} · ${stageCharacter.expression}`}
                        onError={() => setFailedStageAssetIds((current) => {
                          const next = new Set(current);
                          next.add(asset.id);
                          return next;
                        })}
                      />
                    ) : (
                      <div
                        className="character-placeholder"
                        style={
                          {
                            "--character-color": character?.color ?? "#42636a",
                          } as CSSProperties
                        }
                      >
                        <span>{character?.name?.slice(0, 1) ?? "?"}</span>
                      </div>
                    )}
                    {stageCharacter.overlays?.map((overlay) => {
                      const overlayAsset = assetIndexes.byId.get(overlay.assetId ?? '');
                      return overlayAsset?.uri ? (
                        <img
                          className="character-overlay"
                          src={overlayAsset.uri}
                          alt={overlay.name}
                          key={overlay.id}
                          style={{
                            opacity: overlay.opacity,
                            zIndex: overlay.layer,
                            width: overlay.overrideSize
                              ? dimensionCss(overlay.width)
                              : "100%",
                            height: overlay.overrideSize
                              ? dimensionCss(overlay.height)
                              : "100%",
                          }}
                        />
                      ) : null;
                    })}
                  </div>
                );
              })}
          </div>
          <div className="stage-shade" />
          <div className="preview-safe-area" />
          {stageGuides.length > 0 && (
            <div className="stage-alignment-guides" aria-hidden="true">
              {stageGuides.map((guide) => (
                <div
                  className={`stage-alignment-guide ${guide.axis === "x" ? "vertical" : "horizontal"}`}
                  key={`${guide.axis}-${guide.value}`}
                  style={guide.axis === "x" ? { left: `${guide.value}%` } : { top: `${guide.value}%` }}
                >
                  <span>{guide.label}</span>
                </div>
              ))}
            </div>
          )}
          {onStageCharacterMove && orderedStageCharacters.length > 1 && (
            <div className="stage-character-selector" role="toolbar" aria-label="舞台角色选择">
              <span>选择立绘</span>
              {orderedStageCharacters
                .slice()
                .reverse()
                .map((stageCharacter) => {
                  const character = charactersById.get(stageCharacter.characterId);
                  return (
                    <button
                      type="button"
                      className={selectedStageCharacterId === stageCharacter.characterId ? "active" : ""}
                      key={stageCharacter.characterId}
                      title={`${character?.name ?? stageCharacter.characterId} · 图层 ${stageCharacter.layer}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedStageCharacterId(stageCharacter.characterId);
                      }}
                    >
                      <span>{character?.name ?? stageCharacter.characterId}</span>
                      <small>L{stageCharacter.layer}</small>
                    </button>
                  );
                })}
            </div>
          )}
          <div className={`stage-ui ${current?.type === "branch" ? "has-choices" : ""}`}>
            <div className="stage-speaker">
              {state.error
                ? "运行时错误"
                : current?.type === "dialogue"
                  ? displaySpeaker
                  : current?.type === "branch"
                    ? current.title
                    : ""}
            </div>
            <div className="stage-dialogue">
              {state.error ??
                current?.text ??
                (current?.type === "branch"
                  ? ""
                  : state.finished
                    ? "片段播放结束"
                    : "点击画面继续")}
            </div>
            {current?.type === "branch" ? (
              <div className="preview-choices">
                {current.options?.map((option) => (
                  <button
                    key={option.text}
                    onClick={(event) => {
                      event.stopPropagation();
                      setState((value) =>
                        chooseBranch(project, value, option.target),
                      );
                    }}
                  >
                    {option.text}
                  </button>
                ))}
              </div>
            ) : (
              <div className="stage-next">
                <ChevronDown />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="timeline op-timeline">
        <button
          onClick={() => setPlaying(!playing)}
          title={playing ? "暂停" : "自动播放"}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <input
          aria-label="OP 时间轴"
          className="range"
          type="range"
          min="0"
          max={Math.max(0, opEntries.length - 1)}
          value={Math.min(currentOpIndex, Math.max(0, opEntries.length - 1))}
          disabled={!opEntries.length}
          onInput={(event) => seekOp(Number(event.currentTarget.value))}
        />
        <button
          title="预览设置与调试"
          className={settingsOpen ? "active" : ""}
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <SlidersHorizontal />
        </button>
        <div className="timecode">
          <span>
            {opEntries.length
              ? `${runtimeNotice ? `${runtimeNotice} · ` : ""}op ${Math.min(currentOpIndex + 1, opEntries.length)} / ${opEntries.length}`
              : runtimeNotice || "暂无执行轨迹"}
          </span>
          <span>
            {opEntries[currentOpIndex]?.chapterName} /{" "}
            {opEntries[currentOpIndex]?.fragmentName}
          </span>
        </div>
      </div>
      {settingsOpen && (
        <div className="preview-settings">
          <label>
            <span>自动播放间隔 {autoDelay.toFixed(1)} 秒</span>
            <input
              type="range"
              min=".5"
              max="5"
              step=".1"
              value={autoDelay}
              onChange={(event) => setAutoDelay(Number(event.target.value))}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={showSafeArea}
              onChange={(event) => setShowSafeArea(event.target.checked)}
            />
            显示安全区域
          </label>
          {onStageCharacterMove && (
            <>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={constrainToSafeArea}
                  onChange={(event) => setConstrainToSafeArea(event.target.checked)}
                />
                拖拽限制在安全区域
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={snapCharacters}
                  onChange={(event) => {
                    setSnapCharacters(event.target.checked);
                    setStageGuides([]);
                  }}
                />
                启用中心与边缘吸附
              </label>
            </>
          )}
        </div>
      )}
      {debugMode && (
        <RuntimeDebugger
          project={project}
          state={state}
          consoleEntries={consoleEntries}
          updateVariable={updateRuntimeVariable}
          clearConsole={() => setConsoleEntries([])}
          locate={(fragmentId, blockIndex) => {
            setState(seekEngine(project, fragmentId, blockIndex, previewSeekCacheRef.current!));
            setRuntimeNotice(`已定位 ${fragmentId} · Block ${blockIndex + 1}`);
          }}
        />
      )}
      {saveDialogMode && (
        <SaveGameDialog
          project={project}
          state={state}
          mode={saveDialogMode}
          playTimeSeconds={Math.floor((Date.now() - sessionStartedAtRef.current) / 1000)}
          close={() => setSaveDialogMode(null)}
          loadState={setState}
          notify={setRuntimeNotice}
        />
      )}
      {backlogOpen && (
        <div className="backlog-panel">
          <header>
            <strong>文本历史</strong>
            <button title="关闭历史" onClick={() => setBacklogOpen(false)}>
              <X />
            </button>
          </header>
          <div>
            {[...state.backlog].reverse().map((entry) => (
              <article key={`${entry.blockId}-${entry.timestamp}`}>
                <strong>{entry.speaker || "旁白"}</strong>
                <p>{entry.text}</p>
              </article>
            ))}
            {!state.backlog.length && (
              <span className="backlog-empty">还没有已播放文本</span>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
