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

  const reset = useCallback((next: T) => {
    undoRef.current = [];
    redoRef.current = [];
    publish(next);
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
    setRevision((current) => current + 1);
    syncCounts();
  }, [limit, publish, syncCounts]);

  const replace = useCallback((updater: (current: T) => T) => {
    publish(updater(valueRef.current));
    setRevision((current) => current + 1);
  }, [publish]);

  const undo = useCallback(() => {
    const command = undoRef.current.pop();
    if (!command) return;
    redoRef.current.push(command);
    publish(clone(command.before));
    setRevision((current) => current + 1);
    syncCounts();
  }, [publish, syncCounts]);

  const redo = useCallback(() => {
    const command = redoRef.current.pop();
    if (!command) return;
    undoRef.current.push(command);
    publish(clone(command.after));
    setRevision((current) => current + 1);
    syncCounts();
  }, [publish, syncCounts]);

  const markSaved = useCallback(() => setSavedRevision(revision), [revision]);
  const history = undoRef.current.map(({ id, label, timestamp }) => ({ id, label, timestamp }));

  return {
    value,
    reset,
    commit,
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
