import { describe, expect, it } from 'vitest';
import { applySnapshotDelta, createSnapshotDelta, decodeSnapshotValues, encodeSnapshotValues } from '../historyCodec';

describe('Command history snapshot codec', () => {
  it('round-trips nested object, array and deletion changes', () => {
    const before = { scripts: { opening: [{ id: 'a', text: '旧文本' }] }, variables: { affection: 0, obsolete: true } };
    const after = { scripts: { opening: [{ id: 'a', text: '新文本' }, { id: 'b', text: '新增' }] }, variables: { affection: 10 } };
    const delta = createSnapshotDelta(before, after);
    expect(delta).toBeDefined();
    expect(applySnapshotDelta(before, delta!)).toEqual(after);
  });

  it('deduplicates snapshots and reconstructs incremental references', () => {
    const values = Array.from({ length: 18 }, (_, index) => ({
      meta: { id: 'project', name: '大型项目' },
      scripts: { opening: Array.from({ length: 80 }, (__, block) => ({ id: `block-${block}`, text: block === 10 ? `版本 ${index}` : '固定长文本'.repeat(8) })) },
    }));
    values.push(structuredClone(values[5]));
    const encoded = encodeSnapshotValues(values);
    const decoded = decodeSnapshotValues(encoded.snapshots);
    expect(encoded.refs.at(-1)).toBe(encoded.refs[5]);
    expect(encoded.refs.map((ref) => decoded.get(ref))).toEqual(values);
    expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(values).length * 0.2);
  });
});
