import { useCallback, useRef, useState } from 'react';

export interface CommandEntry {
  id: string;
  label: string;
  timestamp: number;
  categories?: CommandCategory[];
}

export interface CommandCategory { id: string; label: string; count: number; items: string[]; undone?: boolean }

interface CommandOptions<T> {
  categories?: CommandCategory[];
  restoreCategory?: (current: T, before: T, after: T, categoryId: string) => T;
}

interface SnapshotCommand<T> extends CommandEntry {
  before: T;
  after: T;
  options?: CommandOptions<T>;
  undoneCategoryIds?: string[];
  onUndo?: () => void;
  onRedo?: () => void;
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
      timestamp: Date.now(), before: clone(before), after: clone(after), onUndo: markActive, onRedo: markUndone,
    }].slice(-limit);
    redoRef.current = [];
    publish(after);
    bumpRevision();
    syncCounts();
    return true;
  }, [bumpRevision, limit, publish, syncCounts]);
  const history = undoRef.current.map(({ id, label, timestamp, options, undoneCategoryIds }) => ({ id, label, timestamp, categories: options?.categories?.map((category) => ({ ...category, undone: undoneCategoryIds?.includes(category.id) })) }));

  return {
    value,
    reset,
    commit,
    commitSaved,
    replace,
    undo,
    redo,
    undoCategory,
    undoCount: counts.undo,
    redoCount: counts.redo,
    history,
    dirty: revision !== savedRevision,
    markSaved,
  };
}
