import { useCallback, useRef, useState } from 'react';

export interface CommandEntry {
  id: string;
  label: string;
  timestamp: number;
  categories?: CommandCategory[];
}

export interface CommandCategory { id: string; label: string; count: number; items: string[]; undone?: boolean }

export interface CommandSnapshotEntry<T> extends CommandEntry {
  before: T;
  after: T;
  state: 'applied' | 'undone';
}

export interface PersistedCommandHistory<T> {
  version: 1;
  projectId: string;
  undo: PersistedCommand<T>[];
  redo: PersistedCommand<T>[];
}

interface PersistedCommand<T> extends CommandEntry {
  before: T;
  after: T;
  options?: { categories?: CommandCategory[]; persistence?: { strategy: string; payload: unknown } };
  undoneCategoryIds?: string[];
  categoryEffect?: { sourceCommandId: string; categoryId: string };
}

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
  const revisionRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
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

  const reset = useCallback((next: T) => {
    undoRef.current = [];
    redoRef.current = [];
    publish(next);
    revisionRef.current = 0;
    setRevision(0);
    setSavedRevision(0);
    syncCounts();
  }, [publish, syncCounts]);

  const serializeHistory = useCallback((projectId: string): PersistedCommandHistory<T> => {
    const serialize = (command: SnapshotCommand<T>): PersistedCommand<T> => ({
      id: command.id,
      label: command.label,
      timestamp: command.timestamp,
      before: clone(command.before),
      after: clone(command.after),
      options: command.options ? { categories: command.options.categories ? clone(command.options.categories) : undefined, persistence: command.options.persistence ? clone(command.options.persistence) : undefined } : undefined,
      undoneCategoryIds: [...(command.undoneCategoryIds ?? [])],
      categoryEffect: command.categoryEffect ? { ...command.categoryEffect } : undefined,
    });
    return { version: 1, projectId, undo: undoRef.current.map(serialize), redo: redoRef.current.map(serialize) };
  }, []);

  const restoreHistory = useCallback((next: T, state: PersistedCommandHistory<T> | null | undefined, strategies: CommandRestoreStrategies<T>) => {
    if (!state || state.version !== 1 || !Array.isArray(state.undo) || !Array.isArray(state.redo)) {
      reset(next);
      return;
    }
    const restore = (command: PersistedCommand<T>): SnapshotCommand<T> => {
      const persistence = command.options?.persistence;
      const strategy = persistence ? strategies[persistence.strategy] : undefined;
      return {
        ...command,
        before: clone(command.before),
        after: clone(command.after),
        options: command.options ? {
          categories: command.options.categories ? clone(command.options.categories) : undefined,
          persistence: persistence ? clone(persistence) : undefined,
          restoreCategory: strategy && persistence ? (current, before, after, categoryId) => strategy(current, before, after, categoryId, persistence.payload) : undefined,
        } : undefined,
      };
    };
    undoRef.current = state.undo.slice(-limit).map(restore);
    redoRef.current = state.redo.slice(-limit).map(restore);
    const commands = [...undoRef.current, ...redoRef.current];
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
  }, [limit, publish, reset, syncCounts]);

  const commit = useCallback((updater: (current: T) => T, label = '编辑项目') => {
    const before = valueRef.current;
    const after = updater(before);
    if (Object.is(before, after)) return;
    undoRef.current = [...undoRef.current, {
      id: `command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      timestamp: Date.now(),
      before: clone(before),
      after: clone(after),
    }].slice(-limit);
    redoRef.current = [];
    publish(after);
    bumpRevision();
    syncCounts();
  }, [bumpRevision, limit, publish, syncCounts]);

  const commitSaved = useCallback((updater: (current: T) => T, label = '编辑并保存项目', options?: CommandOptions<T>) => {
    const before = valueRef.current;
    const after = updater(before);
    if (Object.is(before, after)) return;
    undoRef.current = [...undoRef.current, {
      id: `command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      timestamp: Date.now(),
      before: clone(before),
      after: clone(after),
      options,
      undoneCategoryIds: [],
    }].slice(-limit);
    redoRef.current = [];
    publish(after);
    bumpRevision(true);
    syncCounts();
  }, [bumpRevision, limit, publish, syncCounts]);

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
  }, [bumpRevision, publish, syncCounts]);

  const redo = useCallback(() => {
    const command = redoRef.current.pop();
    if (!command) return;
    undoRef.current.push(command);
    command.onRedo?.();
    publish(clone(command.after));
    bumpRevision();
    syncCounts();
  }, [bumpRevision, publish, syncCounts]);

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
    undoRef.current = [...undoRef.current, {
      id: `command-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: `撤销 ${source.label} · ${category?.label ?? categoryId}`,
      timestamp: Date.now(), before: clone(before), after: clone(after), onUndo: markActive, onRedo: markUndone, categoryEffect: { sourceCommandId: source.id, categoryId },
    }].slice(-limit);
    redoRef.current = [];
    publish(after);
    bumpRevision();
    syncCounts();
    return true;
  }, [bumpRevision, limit, publish, syncCounts]);
  const snapshotEntry = (state: CommandSnapshotEntry<T>['state']) => ({ id, label, timestamp, before, after, options, undoneCategoryIds }: SnapshotCommand<T>): CommandSnapshotEntry<T> => ({
    id,
    label,
    timestamp,
    before,
    after,
    state,
    categories: options?.categories?.map((category) => ({ ...category, undone: undoneCategoryIds?.includes(category.id) })),
  });
  const history = [
    ...undoRef.current.map(snapshotEntry('applied')),
    ...redoRef.current.map(snapshotEntry('undone')),
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
    undoCount: counts.undo,
    redoCount: counts.redo,
    history,
    historyVersion: revision,
    dirty: revision !== savedRevision,
    markSaved,
  };
}
