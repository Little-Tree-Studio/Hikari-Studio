import { describe, expect, it } from 'vitest';
import runtimeContract from '../../../public/runtime-contract.json';
import { blockRegistry } from '../blocks';
import {
  BLOCK_CONFORMANCE_MATRIX,
  BLOCK_CONFORMANCE_MATRIX_VERSION,
  BLOCK_CONFORMANCE_TYPES,
  runBlockConformanceCase,
} from '../blockConformance';
import { ENGINE_VERSION } from '../runtime';

describe('14 Block runtime conformance matrix', () => {
  it('has one versioned row for every registered Block type', () => {
    const registered = Object.keys(blockRegistry).sort();
    const declared = [...BLOCK_CONFORMANCE_TYPES].sort();
    const matrix = BLOCK_CONFORMANCE_MATRIX.map((item) => item.id).sort();

    expect(BLOCK_CONFORMANCE_MATRIX_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
    expect(new Set(matrix).size).toBe(14);
    expect(matrix).toEqual(registered);
    expect(declared).toEqual(registered);
    expect(runtimeContract.matrixVersion).toBe(BLOCK_CONFORMANCE_MATRIX_VERSION);
    expect([...runtimeContract.blockTypes].sort()).toEqual(registered);
    expect(runtimeContract.engineVersion).toBe(ENGINE_VERSION);
  });

  it.each(BLOCK_CONFORMANCE_MATRIX)('$id follows its shared engine contract', (testCase) => {
    const result = runBlockConformanceCase(testCase);
    expect(result.observations[0]).toMatchObject(testCase.initialExpected);
    expect(result.observations.at(-1)).toMatchObject(testCase.finalExpected);
    expect(result.observations[0].trace).toContain(
      testCase.project.scripts.start.find((block) => block.type === testCase.id)?.id
        ?? Object.values(testCase.project.scripts).flat().find((block) => block.type === testCase.id)?.id,
    );
    expect(result.observations.at(-1)?.error).toBeNull();
  });
});
