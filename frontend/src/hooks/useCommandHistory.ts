import { useCallback, useRef, useState } from 'react';
import { decodeSnapshotValues, encodeSnapshotValues, type EncodedSnapshot } from '../core/historyCodec';

export interface CommandEntry {
  id: string;
  label: string;
  timestamp: number;
  name?: string;
  pinned?: boolean;
  categories?: CommandCategory[];
}

export interface CommandCategory { id: string; label: string; count: number; items: string[]; undone?: boolean }

export interface CommandSnapshotEntry<T> extends CommandEntry {
  before: T;
  after: T;
  state: 'applied' | 'undone' | 'archived';
}

interface PersistedCommandHistoryV1<T> {
  version: 1;
  projectId: string;
  undo: PersistedCommandV1<T>[];
  redo: PersistedCommandV1<T>[];
}

interface PersistedCommandV1<T> extends CommandEntry {
  before: T;
  after: T;
  options?: { categories?: CommandCategory[]; persistence?: { strategy: string; payload: unknown } };
  undoneCategoryIds?: string[];
  categoryEffect?: { sourceCommandId: string; categoryId: string };
}

interface PersistedCommandV2 extends CommandEntry {
  beforeRef: string;
  afterRef: string;
  options?: { categories?: CommandCategory[]; persistence?: { strategy: string; payload: unknown } };
  undoneCategoryIds?: string[];
  categoryEffect?: { sourceCommandId: string; categoryId: string };
}

interface PersistedCommandHistoryV2<T> {
  version: 2;
  projectId: string;
  snapshots: EncodedSnapshot<T>[];
  storage?: { uncompressedBytes: number };
  undo: PersistedCommandV2[];
  redo: PersistedCommandV2[];
  archive?: PersistedCommandV2[];
}

export type PersistedCommandHistory<T> = PersistedCommandHistoryV1<T> | PersistedCommandHistoryV2<T>;

export type CommandRestoreStrategies<T> = Record<string, (current: T, before: T, after: T, categoryId: string, payload: unknown) => T>;

interface CommandOptions<T> {
  categories?: CommandCategory[];
  restoreCategory?: (current: T, before: T, after: T, categoryId: string) => T;
  persistence?: { strategy: string; payload: unknown };
}

interface SnapshotCommand<T> extends CommandEntry {
  before: T;
  after: T;
  options?: CommandOptions<T>;
  undoneCategoryIds?: string[];
  onUndo?: () => void;
  onRedo?: () => void;
  categoryEffect?: { sourceCommandId: string; categoryId: string };
}

const clone = <T,>(value: T): T => structuredClone(value);

export function useCommandHistory<T>(initial: T, limit = 50) {
  const [value, setValue] = useState(initial);
  const valueRef = useRef(value);
  const undoRef = useRef<SnapshotCommand<T>[]>([]);
  const redoRef = useRef<SnapshotCommand<T>[]>([]);
  const archiveRef = useRef<SnapshotCommand<T>[]>([]);
  const revisionRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });

  const publish = useCallback((next: T) => {
    valueRef.current = next;
    setValue(next);
  }, []);

  const syncCounts = useCallback(() => {
    setCounts({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, []);

  const bumpRevision = useCallback((saved = false) => {
    const next = revisionRef.current + 1;
    revisionRef.current = next;
    setRevision(next);
    if (saved) setSavedRevision(next);
  }, []);

  const touchHistory = useCallback(() => setHistoryVersion((value) => value + 1), []);
  const trimHistory = useCallback((commands: SnapshotCommand<T>[]) => {
    if (commands.length <= limit) return commands;
    const keep = new Set(commands.filter((command) => command.pinned).map((command) => command.id));
    for (let index = commands.length - 1; index >= 0 && keep.size < limit; index -= 1) keep.add(commands[index].id);
    return commands.filter((command) => keep.has(command.id));
  }, [limit]);
  const archivePinnedRedo = useCallback(() => {
    archiveRef.current = trimHistory([...archiveRef.current, ...redoRef.current.filter((command) => command.pinned)]);
  }, [trimHistory]);

  const reset = useCallback((next: T) => {
    undoRef.current = [];
    redoRef.current = [];
    archiveRef.current = [];
    publish(next);
    revisionRef.current = 0;
    setRevision(0);
    setSavedRevision(0);
    syncCounts();
    touchHistory();
  }, [publish, syncCounts, touchHistory]);

  const serializeHistory = useCallback((projectId: string): PersistedCommandHistory<T> => {
    const commands = [...undoRef.current, ...redoRef.current, ...archiveRef.current];
    const encoded = encodeSnapshotValues(commands.flatMap((command) => [command.before, command.after]));
    const textEncoder = new TextEncoder();
    const uncompressedBytes = commands.reduce((total, command) => total
      + textEncoder.encode(JSON.stringify(command.before)).byteLength
      + textEncoder.encode(JSON.stringify(command.after)).byteLength, 0);
    let refIndex = 0;
    const serialize = (command: SnapshotCommand<T>): PersistedCommandV2 => ({
      id: command.id,
      label: command.label,
      timestamp: command.timestamp,
      name: command.name,
      pinned: command.pinned,
      beforeRef: encoded.refs[refIndex++],
      afterRef: encoded.refs[refIndex++],
      options: command.options ? { categories: command.options.categories ? clone(command.options.categories) : undefined, persistence: command.options.persistence ? clone(command.options.persistence) : undefined } : undefined,
      undoneCategoryIds: [...(command.undoneCategoryIds ?? [])],
      categoryEffect: command.categoryEffect ? { ...command.categoryEffect } : undefined,
    });
    return { version: 2, projectId, snapshots: encoded.snapshots, storage: { uncompressedBytes }, undo: undoRef.current.map(serialize), redo: redoRef.current.map(serialize), archive: archiveRef.current.map(serialize) };
  }, []);

  const restoreHistory = useCallback((next: T, state: PersistedCommandHistory<T> | null | undefined, strategies: CommandRestoreStrategies<T>) => {
    if (!state || ![1, 2].includes(state.version) || !Array.isArray(state.undo) || !Array.isArray(state.redo)) {
      reset(next);
      return;
    }
    const restore = (command: PersistedCommandV1<T> | PersistedCommandV2, before: T, after: T): SnapshotCommand<T> => {
      const persistence = command.options?.persistence;
      const strategy = persistence ? strategies[persistence.strategy] : undefined;
      return {
        id: command.id,
        label: command.label,
        timestamp: command.timestamp,
        name: command.name,
        pinned: command.pinned,
        before: clone(before),
        after: clone(after),
        undoneCategoryIds: [...(command.undoneCategoryIds ?? [])],
        categoryEffect: command.categoryEffect ? { ...command.categoryEffect } : undefined,
        options: command.options ? {
          categories: command.options.categories ? clone(command.options.categories) : undefined,
          persistence: persistence ? clone(persistence) : undefined,
          restoreCategory: strategy && persistence ? (current, before, after, categoryId) => strategy(current, before, after, categoryId, persistence.payload) : undefined,
        } : undefined,
      };
    };
    try {
      if (state.version === 1) {
        undoRef.current = trimHistory(state.undo.map((command) => restore(command, command.before, command.after)));
        redoRef.current = trimHistory(state.redo.map((command) => restore(command, command.before, command.after)));
        archiveRef.current = [];
      } else {
        const snapshots = decodeSnapshotValues(state.snapshots);
        const restoreV2 = (command: PersistedCommandV2) => {
          const before = snapshots.get(command.beforeRef);
          const after = snapshots.get(command.afterRef);
          if (before === undefined || after === undefined) throw new Error(`Command snapshot reference is missing: ${command.id}`);
          return restore(command, before, after);
        };
        undoRef.current = trimHistory(state.undo.map(restoreV2));
        redoRef.current = trimHistory(state.redo.map(restoreV2));
        archiveRef.current = trimHistory((state.archive ?? []).map(restoreV2));
      }
    } catch {
      reset(next);
      return;
    }
    const commands = [...undoRef.current, ...redoRef.current, ...archiveRef.current];
    for (const command of commands) {
      const effect = command.categoryEffect;
      if (!effect) continue;
      const source = commands.find((candidate) => candidate.id === effect.sourceCommandId);
      if (!source) continue;
      command.onUndo = () => { source.undoneCategoryIds = (source.undoneCategoryIds ?? []).filter((id) => id !== effect.categoryId); };
      command.onRedo = () => { source.undoneCategoryIds = [...new Set([...(source.undoneCategoryIds ?? []), effect.categoryId])]; };
    }
    publish(next);
    revisionRef.current = 0;
    setRevision(0);
    setSavedRevision(0);
    syncCounts();
    touchHistory();
  }, [publish, reset, syncCounts, touchHistory, trimHistory]);

  const commit = useCallback((updater: (current: T) => T, label = '编辑项目') => {
    const before = valueRef.current;
    const after = updater(before);
    if (Object.is(before, after)) return;
    undoRef.current = trimHistory([...undoRef.current, {
      id: `command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      timestamp: Date.now(),
      before: clone(before),
      after: clone(after),
    }]);
    archivePinnedRedo();
    redoRef.current = [];
    publish(after);
    bumpRevision();
    syncCounts();
    touchHistory();
  }, [archivePinnedRedo, bumpRevision, publish, syncCounts, touchHistory, trimHistory]);

  const commitSaved = useCallback((updater: (current: T) => T, label = '编辑并保存项目', options?: CommandOptions<T>) => {
    const before = valueRef.current;
    const after = updater(before);
    if (Object.is(before, after)) return;
    undoRef.current = trimHistory([...undoRef.current, {
      id: `command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      timestamp: Date.now(),
      before: clone(before),
      after: clone(after),
      options,
      undoneCategoryIds: [],
    }]);
    archivePinnedRedo();
    redoRef.current = [];
    publish(after);
    bumpRevision(true);
    syncCounts();
    touchHistory();
  }, [archivePinnedRedo, bumpRevision, publish, syncCounts, touchHistory, trimHistory]);

  const replace = useCallback((updater: (current: T) => T) => {
    publish(updater(valueRef.current));
    bumpRevision();
  }, [bumpRevision, publish]);

  const undo = useCallback(() => {
    const command = undoRef.current.pop();
    if (!command) return;
    redoRef.current.push(command);
    command.onUndo?.();
    publish(clone(command.before));
    bumpRevision();
    syncCounts();
    touchHistory();
  }, [bumpRevision, publish, syncCounts, touchHistory]);

  const redo = useCallback(() => {
    const command = redoRef.current.pop();
    if (!command) return;
    undoRef.current.push(command);
    command.onRedo?.();
    publish(clone(command.after));
    bumpRevision();
    syncCounts();
    touchHistory();
  }, [bumpRevision, publish, syncCounts, touchHistory]);

  const markSaved = useCallback(() => setSavedRevision(revisionRef.current), []);
  const undoCategory = useCallback((commandId: string, categoryId: string) => {
    const source = undoRef.current.find((command) => command.id === commandId);
    if (!source?.options?.restoreCategory || source.undoneCategoryIds?.includes(categoryId)) return false;
    const before = valueRef.current;
    const after = source.options.restoreCategory(before, source.before, source.after, categoryId);
    if (Object.is(before, after)) return false;
    const markUndone = () => { source.undoneCategoryIds = [...new Set([...(source.undoneCategoryIds ?? []), categoryId])]; };
    const markActive = () => { source.undoneCategoryIds = (source.undoneCategoryIds ?? []).filter((id) => id !== categoryId); };
    markUndone();
    const category = source.options.categories?.find((item) => item.id === categoryId);
    undoRef.current = trimHistory([...undoRef.current, {
      id: `command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: `撤销 ${source.label} · ${category?.label ?? categoryId}`,
      timestamp: Date.now(), before: clone(before), after: clone(after), onUndo: markActive, onRedo: markUndone, categoryEffect: { sourceCommandId: source.id, categoryId },
    }]);
    archivePinnedRedo();
    redoRef.current = [];
    publish(after);
    bumpRevision();
    syncCounts();
    touchHistory();
    return true;
  }, [archivePinnedRedo, bumpRevision, publish, syncCounts, touchHistory, trimHistory]);

  const renameCommand = useCallback((commandId: string, name: string) => {
    const command = [...undoRef.current, ...redoRef.current, ...archiveRef.current].find((item) => item.id === commandId);
    if (!command) return false;
    command.name = name.trim().slice(0, 120) || undefined;
    touchHistory();
    return true;
  }, [touchHistory]);

  const toggleCommandPinned = useCallback((commandId: string) => {
    const command = [...undoRef.current, ...redoRef.current, ...archiveRef.current].find((item) => item.id === commandId);
    if (!command) return false;
    command.pinned = !command.pinned;
    undoRef.current = trimHistory(undoRef.current);
    redoRef.current = trimHistory(redoRef.current);
    archiveRef.current = trimHistory(archiveRef.current);
    syncCounts();
    touchHistory();
    return true;
  }, [syncCounts, touchHistory, trimHistory]);

  const clearUnpinnedHistory = useCallback(() => {
    const commands = [...undoRef.current, ...redoRef.current, ...archiveRef.current];
    const pinned = commands.filter((command) => command.pinned);
    const removed = commands.length - pinned.length;
    if (!removed) return 0;
    undoRef.current = [];
    redoRef.current = [];
    archiveRef.current = trimHistory(pinned);
    syncCounts();
    touchHistory();
    return removed;
  }, [syncCounts, touchHistory, trimHistory]);

  const snapshotEntry = (state: CommandSnapshotEntry<T>['state']) => ({ id, label, timestamp, name, pinned, before, after, options, undoneCategoryIds }: SnapshotCommand<T>): CommandSnapshotEntry<T> => ({
    id,
    label,
    timestamp,
    name,
    pinned,
    before,
    after,
    state,
    categories: options?.categories?.map((category) => ({ ...category, undone: undoneCategoryIds?.includes(category.id) })),
  });
  const history = [
    ...undoRef.current.map(snapshotEntry('applied')),
    ...redoRef.current.map(snapshotEntry('undone')),
    ...archiveRef.current.map(snapshotEntry('archived')),
  ].sort((left, right) => left.timestamp - right.timestamp);

  return {
    value,
    reset,
    restoreHistory,
    serializeHistory,
    commit,
    commitSaved,
    replace,
    undo,
    redo,
    undoCategory,
    renameCommand,
    toggleCommandPinned,
    clearUnpinnedHistory,
    undoCount: counts.undo,
    redoCount: counts.redo,
    history,
    historyVersion,
    dirty: revision !== savedRevision,
    markSaved,
  };
}
