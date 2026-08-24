import { describe, expect, it } from 'vitest';
import { chooseBranch, compareValues, createEngineState, currentBlock } from '../runtime';
import { testProject } from './fixtures';

describe('engine control flow', () => {
  it.each([
    [3, 'eq', 3, true],
    [3, 'eq', '3', true],
    [3, 'neq', '3', false],
    ['3', 'neq', 4, true],
    [4, 'gt', 3, true],
    ['4', 'gt', 3, true],
    [3, 'gte', 3, true],
    [2, 'lt', 3, true],
    [3, 'lte', 3, true],
    [3, 'gt', 4, false],
    ['abc', 'lt', 'bcd', true],
    ['abc', 'gt', 'aaa', true],
    [true, 'neq', 'true', true],
    [true, 'eq', true, true],
  ] as const)('compares %s %s %s', (left, operator, right, expected) => {
    expect(compareValues(left, operator, right)).toBe(expected);
  });

  it('routes conditions through true and false targets', () => {
    const project = testProject({
      start: [{ id: 'condition', type: 'condition', variable: 'score', operator: 'gte', compareValue: 5, trueTarget: 'passed', falseTarget: 'failed' }],
      passed: [{ id: 'passed-line', type: 'narration', text: 'passed' }],
      failed: [{ id: 'failed-line', type: 'narration', text: 'failed' }],
    }, { score: 5 });
    const failedProject = { ...project, variables: { score: 4 } };
    const passed = createEngineState(project);
    const failed = createEngineState(failedProject);

    expect(currentBlock(project, passed)?.id).toBe('passed-line');
    expect(currentBlock(failedProject, failed)?.id).toBe('failed-line');
    expect(passed.executionTrace.map((entry) => entry.blockId)).toEqual(['condition', 'passed-line']);
  });

  it('calls a fragment, returns, and preserves side effects', () => {
    const project = testProject({
      start: [
        { id: 'call-sub', type: 'call', target: 'sub' },
        { id: 'after-call', type: 'narration', text: 'after' },
      ],
      sub: [
        { id: 'set-flag', type: 'setVariable', variable: 'visited', value: true },
        { id: 'return-sub', type: 'return' },
      ],
    }, { visited: false });

    const state = createEngineState(project);
    expect(currentBlock(project, state)?.id).toBe('after-call');
    expect(state.variables.visited).toBe(true);
    expect(state.callStack).toEqual([]);
    expect(state.executionTrace.map((entry) => entry.blockId)).toEqual(['call-sub', 'set-flag', 'return-sub', 'after-call']);
  });

  it('reports an invalid branch without changing project data', () => {
    const project = testProject({
      start: [{ id: 'choice', type: 'branch', title: 'Choose', options: [{ text: 'Broken', target: 'missing' }] }],
    });
    const before = structuredClone(project);
    const state = chooseBranch(project, createEngineState(project), 'missing');

    expect(state.finished).toBe(true);
    expect(state.error).toContain('无效的分支目标');
    expect(project).toEqual(before);
  });

  it('applies modifyVariable operations on the current value', () => {
    const project = testProject({
      start: [
        { id: 'inc', type: 'modifyVariable', variable: 'affection', operation: 'add', operand: 2 },
        { id: 'dec', type: 'modifyVariable', variable: 'affection', operation: 'subtract', operand: 1 },
        { id: 'mul', type: 'modifyVariable', variable: 'affection', operation: 'multiply', operand: 3 },
        { id: 'div', type: 'modifyVariable', variable: 'affection', operation: 'divide', operand: 4 },
        { id: 'line', type: 'narration', text: 'after' },
      ],
    }, { affection: 5 });

    const state = createEngineState(project);
    expect(state.variables.affection).toBe(((5 + 2 - 1) * 3) / 4);
    expect(currentBlock(project, state)?.id).toBe('line');
  });

  it('keeps the value untouched when dividing by zero or reading a non-number', () => {
    const project = testProject({
      start: [
        { id: 'zero', type: 'modifyVariable', variable: 'score', operation: 'divide', operand: 0 },
        { id: 'text', type: 'modifyVariable', variable: 'mood', operation: 'add', operand: 1 },
        { id: 'line', type: 'narration', text: 'after' },
      ],
    }, { score: 3, mood: '晴天' });

    const state = createEngineState(project);
    expect(state.variables.score).toBe(3);
    expect(state.variables.mood).toBe(1);
  });

  it('compares a condition against another variable', () => {
    const project = testProject({
      start: [{ id: 'condition', type: 'condition', variable: 'score', compareVariable: 'threshold', operator: 'gte', trueTarget: 'passed', falseTarget: 'failed' }],
      passed: [{ id: 'passed-line', type: 'narration', text: 'passed' }],
      failed: [{ id: 'failed-line', type: 'narration', text: 'failed' }],
    }, { score: 7, threshold: 5 });

    const passed = createEngineState(project);
    expect(currentBlock(project, passed)?.id).toBe('passed-line');

    const failedProject = { ...project, variables: { score: 4, threshold: 5 } };
    const failed = createEngineState(failedProject);
    expect(currentBlock(failedProject, failed)?.id).toBe('failed-line');
  });

  it('stops deterministic infinite loops with a runtime error', () => {
    const project = testProject({ start: [{ id: 'loop', type: 'jump', target: 'start' }] });
    const state = createEngineState(project);

    expect(state.finished).toBe(true);
    expect(state.error).toContain('可能存在无限循环');
    expect(state.stepsExecuted).toBe(1000);
  });
});
