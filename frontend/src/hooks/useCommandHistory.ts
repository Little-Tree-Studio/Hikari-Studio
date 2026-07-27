import { useCallback, useRef, useState } from 'react';

export interface CommandEntry {
  id: string;
  label: string;
  timestamp: number;
}

interface SnapshotCommand<T> extends CommandEntry {
  before: T;
  after: T;
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

  const commitSaved = useCallback((updater: (current: T) => T, label = '编辑并保存项目') => {
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
    publish(clone(command.before));
    bumpRevision();
    syncCounts();
  }, [bumpRevision, publish, syncCounts]);

  const redo = useCallback(() => {
    const command = redoRef.current.pop();
    if (!command) return;
    undoRef.current.push(command);
    publish(clone(command.after));
    bumpRevision();
    syncCounts();
  }, [bumpRevision, publish, syncCounts]);

  const markSaved = useCallback(() => setSavedRevision(revisionRef.current), []);
  const history = undoRef.current.map(({ id, label, timestamp }) => ({ id, label, timestamp }));

  return {
    value,
    reset,
    commit,
    commitSaved,
    replace,
    undo,
    redo,
    undoCount: counts.undo,
    redoCount: counts.redo,
    history,
    dirty: revision !== savedRevision,
    markSaved,
  };
}
