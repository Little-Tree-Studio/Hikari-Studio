export type SnapshotDelta =
  | { type: 'replace'; value: unknown }
  | { type: 'object'; changed: Record<string, SnapshotDelta>; deleted?: string[] }
  | { type: 'array'; length: number; changed: Record<string, SnapshotDelta> };

export interface EncodedSnapshot<T> {
  id: string;
  baseId?: string;
  value?: T;
  delta?: SnapshotDelta;
}

const clone = <T,>(value: T): T => structuredClone(value);
const objectValue = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function createSnapshotDelta(before: unknown, after: unknown): SnapshotDelta | undefined {
  if (Object.is(before, after)) return undefined;
  if (Array.isArray(before) && Array.isArray(after)) {
    const changed: Record<string, SnapshotDelta> = {};
    for (let index = 0; index < after.length; index += 1) {
      const delta = index < before.length ? createSnapshotDelta(before[index], after[index]) : { type: 'replace' as const, value: clone(after[index]) };
      if (delta) changed[String(index)] = delta;
    }
    return before.length === after.length && !Object.keys(changed).length ? undefined : { type: 'array', length: after.length, changed };
  }
  if (objectValue(before) && objectValue(after)) {
    const changed: Record<string, SnapshotDelta> = {};
    const deleted = Object.keys(before).filter((key) => !(key in after));
    for (const [key, value] of Object.entries(after)) {
      const delta = key in before ? createSnapshotDelta(before[key], value) : { type: 'replace' as const, value: clone(value) };
      if (delta) changed[key] = delta;
    }
    return !deleted.length && !Object.keys(changed).length ? undefined : { type: 'object', changed, deleted: deleted.length ? deleted : undefined };
  }
  return { type: 'replace', value: clone(after) };
}

export function applySnapshotDelta<T>(before: T, delta: SnapshotDelta): T {
  if (delta.type === 'replace') return clone(delta.value) as T;
  if (delta.type === 'array') {
    const next = Array.isArray(before) ? clone(before) : [];
    next.length = delta.length;
    for (const [index, change] of Object.entries(delta.changed)) next[Number(index)] = applySnapshotDelta(next[Number(index)], change);
    return next as T;
  }
  const next: Record<string, unknown> = objectValue(before) ? clone(before) : {};
  for (const key of delta.deleted ?? []) delete next[key];
  for (const [key, change] of Object.entries(delta.changed)) next[key] = applySnapshotDelta(next[key], change);
  return next as T;
}

export function encodeSnapshotValues<T>(values: T[]): { snapshots: EncodedSnapshot<T>[]; refs: string[] } {
  const snapshots: EncodedSnapshot<T>[] = [];
  const refs: string[] = [];
  const known = new Map<string, string>();
  let previousId: string | undefined;
  let previousValue: T | undefined;
  for (const value of values) {
    const encoded = JSON.stringify(value);
    const existing = known.get(encoded);
    if (existing) {
      refs.push(existing);
      previousId = existing;
      previousValue = value;
      continue;
    }
    const id = `snapshot-${snapshots.length + 1}`;
    const delta = previousId && previousValue !== undefined ? createSnapshotDelta(previousValue, value) : undefined;
    const deltaSize = delta ? JSON.stringify(delta).length : Number.POSITIVE_INFINITY;
    snapshots.push(delta && deltaSize < encoded.length
      ? { id, baseId: previousId, delta }
      : { id, value: clone(value) });
    known.set(encoded, id);
    refs.push(id);
    previousId = id;
    previousValue = value;
  }
  return { snapshots, refs };
}

export function decodeSnapshotValues<T>(snapshots: EncodedSnapshot<T>[]): Map<string, T> {
  const decoded = new Map<string, T>();
  for (const snapshot of snapshots) {
    if (snapshot.value !== undefined) decoded.set(snapshot.id, clone(snapshot.value));
    else if (snapshot.baseId && snapshot.delta) {
      const base = decoded.get(snapshot.baseId);
      if (base === undefined) throw new Error(`Snapshot base is missing: ${snapshot.baseId}`);
      decoded.set(snapshot.id, applySnapshotDelta(base, snapshot.delta));
    } else throw new Error(`Snapshot payload is invalid: ${snapshot.id}`);
  }
  return decoded;
}
