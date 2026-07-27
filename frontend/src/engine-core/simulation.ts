import type { Project, StoryBlock } from '../types';
import { advanceEngine, chooseBranch, createEngineState, currentBlock } from './runtime';
import type { BranchSimulationLocation, BranchSimulationPath, BranchSimulationRequest, BranchSimulationResult, EngineState } from './types';

const DEFAULT_MAX_PATHS = 500;
const DEFAULT_MAX_STEPS = 10_000;
const DEFAULT_MAX_SCENARIOS = 64;
type Scalar = string | number | boolean;

const percent = (visited: number, total: number) => total ? Math.round((visited / total) * 100) : 100;
const valueKey = (value: Scalar) => `${typeof value}:${String(value)}`;
const stateKey = (state: EngineState) => JSON.stringify([
  state.fragmentId,
  state.instructionPointer,
  Object.entries(state.variables).sort(([left], [right]) => left.localeCompare(right)),
  state.callStack,
]);

function candidateValues(project: Project): Map<string, Scalar[]> {
  const candidates = new Map<string, Scalar[]>();
  const add = (name: string | undefined, value: unknown) => {
    if (!name || !['string', 'number', 'boolean'].includes(typeof value)) return;
    const values = candidates.get(name) ?? [];
    if (!values.some((item) => valueKey(item) === valueKey(value as Scalar))) values.push(value as Scalar);
    candidates.set(name, values);
  };
  for (const [name, value] of Object.entries(project.variables)) add(name, value);
  for (const blocks of Object.values(project.scripts)) for (const block of blocks) {
    if (block.type === 'setVariable') add(block.variable, block.value);
    if (block.type === 'condition') {
      add(block.variable, block.compareValue);
      if (typeof block.compareValue === 'number') {
        add(block.variable, block.compareValue - 1);
        add(block.variable, block.compareValue + 1);
      } else if (typeof block.compareValue === 'boolean') add(block.variable, !block.compareValue);
      else if (typeof block.compareValue === 'string') add(block.variable, `${block.compareValue}__other`);
    }
  }
  return candidates;
}

function variableScenarios(project: Project, overrides: Record<string, Scalar>, limit: number) {
  const variables = [...candidateValues(project)].filter(([name, values]) => !(name in overrides) && values.length > 1);
  const scenarios: Record<string, Scalar>[] = [{ ...project.variables, ...overrides }];
  let truncated = false;
  for (const [name, values] of variables) {
    const expanded = scenarios.flatMap((scenario) => values.map((value) => ({ ...scenario, [name]: value })));
    if (expanded.length > limit) truncated = true;
    scenarios.splice(0, scenarios.length, ...expanded.slice(0, limit));
    if (scenarios.length >= limit) break;
  }
  return { scenarios, truncated };
}

function blockLocation(project: Project, state: EngineState, block?: StoryBlock): BranchSimulationLocation {
  return { fragmentId: state.fragmentId, blockId: block?.id, blockIndex: block ? (project.scripts[state.fragmentId] ?? []).findIndex((item) => item.id === block.id) : state.instructionPointer };
}

interface PendingPath {
  state: EngineState;
  initialVariables: Record<string, Scalar>;
  choices: BranchSimulationPath['choices'];
  seen: Set<string>;
  visitedFragments: Set<string>;
  visitedBlocks: Set<string>;
  visitedOptions: Set<string>;
  steps: number;
}

function recordTrace(path: PendingPath) {
  for (const entry of path.state.executionTrace) {
    path.visitedFragments.add(entry.fragmentId);
    path.visitedBlocks.add(entry.blockId);
  }
  path.steps = Math.max(path.steps, path.state.stepsExecuted);
}

function resultPath(index: number, path: PendingPath, status: BranchSimulationPath['status'], message: string, project: Project, block?: StoryBlock): BranchSimulationPath {
  return {
    id: `simulation-path-${index + 1}`,
    status,
    steps: path.steps,
    choices: path.choices,
    initialVariables: path.initialVariables,
    finalVariables: path.state.variables,
    visitedFragments: [...path.visitedFragments],
    message,
    location: blockLocation(project, path.state, block),
  };
}

export function simulateProjectBranches(project: Project, request: BranchSimulationRequest = {}): BranchSimulationResult {
  const maxPaths = Math.max(1, request.maxPaths ?? DEFAULT_MAX_PATHS);
  const maxStepsPerPath = Math.max(1, request.maxStepsPerPath ?? DEFAULT_MAX_STEPS);
  const maxVariableScenarios = Math.max(1, request.maxVariableScenarios ?? DEFAULT_MAX_SCENARIOS);
  const entryFragmentId = request.entryFragmentId
    ?? project.chapters.find((chapter) => chapter.entry)?.fragments[0]?.id
    ?? project.chapters[0]?.fragments[0]?.id
    ?? project.activeFragmentId;
  const generated = variableScenarios(project, request.variableOverrides ?? {}, maxVariableScenarios);
  const queue: PendingPath[] = generated.scenarios.map((variables) => {
    const state = createEngineState({ ...project, variables }, entryFragmentId);
    const path = { state, initialVariables: variables, choices: [], seen: new Set<string>(), visitedFragments: new Set([entryFragmentId]), visitedBlocks: new Set<string>(), visitedOptions: new Set<string>(), steps: state.stepsExecuted };
    recordTrace(path);
    return path;
  });
  const paths: BranchSimulationPath[] = [];
  const allFragments = new Set<string>();
  const allBlocks = new Set<string>();
  const allOptions = new Set<string>();
  const coveredFragments = new Set<string>();
  const coveredBlocks = new Set<string>();
  const coveredOptions = new Set<string>();
  for (const chapter of project.chapters) for (const fragment of chapter.fragments) allFragments.add(fragment.id);
  for (const blocks of Object.values(project.scripts)) for (const block of blocks) {
    allBlocks.add(block.id);
    if (block.type === 'branch') (block.options ?? []).forEach((_, index) => allOptions.add(`${block.id}:${index}`));
  }
  let pathLimitReached = false;
  const finish = (path: PendingPath, status: BranchSimulationPath['status'], message: string, block?: StoryBlock) => {
    path.visitedFragments.forEach((id) => coveredFragments.add(id));
    path.visitedBlocks.forEach((id) => coveredBlocks.add(id));
    path.visitedOptions.forEach((id) => coveredOptions.add(id));
    paths.push(resultPath(paths.length, path, status, message, project, block));
  };

  while (queue.length && paths.length < maxPaths) {
    const path = queue.shift()!;
    recordTrace(path);
    let settled = false;
    while (!settled) {
      const block = currentBlock(project, path.state);
      path.visitedFragments.add(path.state.fragmentId);
      if (block) path.visitedBlocks.add(block.id);
      const key = stateKey(path.state);
      if (path.seen.has(key)) {
        finish(path, 'loop', '检测到重复运行状态，流程可能形成循环', block);
        settled = true;
        continue;
      }
      path.seen.add(key);
      if (path.state.error) {
        finish(path, 'error', path.state.error, block);
        settled = true;
        continue;
      }
      if (path.state.finished) {
        const visible = path.visitedBlocks.size > 0;
        finish(path, visible ? 'completed' : 'dead-end', visible ? '流程正常结束' : '流程未执行任何可见内容', block);
        settled = true;
        continue;
      }
      if (path.steps >= maxStepsPerPath) {
        finish(path, 'truncated', `路径执行超过 ${maxStepsPerPath} 个 OP`, block);
        settled = true;
        continue;
      }
      if (block?.type === 'branch') {
        const options = block.options ?? [];
        if (!options.length) {
          finish(path, 'dead-end', '分支没有可用选项', block);
        } else {
          options.forEach((option, optionIndex) => {
            const state = chooseBranch(project, path.state, option.target);
            const fork = { ...path, state, choices: [...path.choices, { blockId: block.id, text: option.text, target: option.target }], seen: new Set(path.seen), visitedFragments: new Set([...path.visitedFragments, option.target]), visitedBlocks: new Set(path.visitedBlocks), visitedOptions: new Set([...path.visitedOptions, `${block.id}:${optionIndex}`]), steps: Math.max(path.steps + 1, state.stepsExecuted) };
            recordTrace(fork);
            queue.push(fork);
          });
        }
        settled = true;
        continue;
      }
      if (!block) {
        finish(path, 'dead-end', '当前位置没有可执行 Block');
        settled = true;
        continue;
      }
      path.state = advanceEngine(project, path.state);
      path.steps = Math.max(path.steps + 1, path.state.stepsExecuted);
      recordTrace(path);
    }
  }
  if (queue.length) pathLimitReached = true;
  const observedTypes = new Map<string, { types: Set<string>; locations: BranchSimulationLocation[] }>();
  for (const path of paths) for (const [name, value] of Object.entries(path.finalVariables)) {
    const item = observedTypes.get(name) ?? { types: new Set<string>(), locations: [] };
    item.types.add(typeof value);
    if (path.location && !item.locations.some((location) => location.fragmentId === path.location!.fragmentId && location.blockId === path.location!.blockId)) item.locations.push(path.location);
    observedTypes.set(name, item);
  }
  const summary: BranchSimulationResult['summary'] = { completed: 0, 'dead-end': 0, loop: 0, error: 0, truncated: 0 };
  paths.forEach((path) => { summary[path.status] += 1; });
  return {
    entryFragmentId,
    generatedAt: new Date().toISOString(),
    limits: { maxPaths, maxStepsPerPath, maxVariableScenarios },
    truncated: pathLimitReached || generated.truncated,
    truncationReason: pathLimitReached ? 'path-limit' : generated.truncated ? 'variable-scenario-limit' : undefined,
    scenarioCount: generated.scenarios.length,
    pathCount: paths.length,
    coverage: {
      fragments: { visited: coveredFragments.size, total: allFragments.size, percent: percent(coveredFragments.size, allFragments.size), unreachable: [...allFragments].filter((id) => !coveredFragments.has(id)) },
      blocks: { visited: coveredBlocks.size, total: allBlocks.size, percent: percent(coveredBlocks.size, allBlocks.size) },
      branchOptions: { visited: coveredOptions.size, total: allOptions.size, percent: percent(coveredOptions.size, allOptions.size) },
    },
    summary,
    variableConflicts: [...observedTypes].filter(([, item]) => item.types.size > 1).map(([name, item]) => ({ name, observedTypes: [...item.types], locations: item.locations })),
    paths,
  };
}
