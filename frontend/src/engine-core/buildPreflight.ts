import { analyzeAssetReferences } from '../core/assetReferences';
import type { BuildPreflightCategory, BuildPreflightIssue, BuildPreflightReport, BuildTarget, Project, TimelineTrackKind } from '../types';
import { diagnoseProject } from './diagnostics';
import { branchSimulationRunner } from './simulationRunner';
import type { BranchSimulationProgress, BranchSimulationResult, ProjectDiagnostic } from './types';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'ogg', 'wav']);
const FONT_EXTENSIONS = new Set(['woff', 'woff2', 'ttf', 'otf']);
const TIMELINE_PROPERTIES: Record<TimelineTrackKind, Set<string>> = {
  scene: new Set(['opacity']),
  character: new Set(['x', 'y', 'scale', 'opacity']),
  camera: new Set(['x', 'y', 'cameraX', 'cameraY', 'zoom', 'rotation', 'shake']),
  audio: new Set(['volume']),
};

interface RunBuildPreflightOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BranchSimulationProgress) => void;
  bypassCache?: boolean;
}

function categoryForDiagnostic(item: ProjectDiagnostic): BuildPreflightCategory {
  if (item.code.includes('ASSET') || item.code.includes('PORTRAIT')) return 'assets';
  if (item.code.includes('UNREACHABLE') || item.code.includes('UNREFERENCED')) return 'reachability';
  return 'flow';
}

function issueFromDiagnostic(item: ProjectDiagnostic): BuildPreflightIssue {
  return { ...item, blocking: item.severity === 'error', category: categoryForDiagnostic(item), source: 'engine' };
}

function extension(path: string) {
  const clean = path.split(/[?#]/, 1)[0];
  const value = clean.includes('.') ? clean.split('.').at(-1)?.toLowerCase() : '';
  return value ?? '';
}

function platformIssues(project: Project): BuildPreflightIssue[] {
  const issues: BuildPreflightIssue[] = [];
  const references = analyzeAssetReferences(project);
  for (const asset of project.assets.filter((item) => references.bundledIds.has(item.id))) {
    const ext = extension(asset.path || asset.uri || '');
    const kind = asset.kind.toLowerCase();
    if (kind === 'video') {
      issues.push({ severity: 'warning', blocking: false, category: 'compatibility', code: 'VIDEO_RUNTIME_LIMITED', message: `视频素材“${asset.name}”尚未接入正式播放器，将只随包复制`, relatedId: asset.id, source: 'engine' });
      continue;
    }
    const supported = asset.audioCategory || kind === 'audio'
      ? AUDIO_EXTENSIONS
      : kind === 'font'
        ? FONT_EXTENSIONS
        : ['scene', 'image', 'character'].includes(kind)
          ? IMAGE_EXTENSIONS
          : undefined;
    if (supported && ext && !supported.has(ext)) issues.push({ severity: 'warning', blocking: false, category: 'compatibility', code: 'UNTESTED_ASSET_FORMAT', message: `素材“${asset.name}”使用未验证格式 .${ext}`, relatedId: asset.id, source: 'engine' });
  }
  for (const [fragmentId, timeline] of Object.entries(project.timelines ?? {})) for (const track of timeline.tracks) for (const clip of track.clips) for (const keyframe of clip.keyframes) {
    if (!TIMELINE_PROPERTIES[track.kind].has(keyframe.property)) issues.push({ severity: 'warning', blocking: false, category: 'compatibility', code: 'UNSUPPORTED_TIMELINE_PROPERTY', message: `时间轴属性“${keyframe.property}”不会进入 ${track.kind} 运行时插值`, fragmentId, blockId: clip.blockId, relatedId: keyframe.id, source: 'engine' });
  }
  return issues;
}

function simulationIssues(result: BranchSimulationResult): BuildPreflightIssue[] {
  const issues: BuildPreflightIssue[] = [];
  for (const path of result.paths) {
    const location = path.location ?? { fragmentId: result.entryFragmentId };
    if (path.status === 'loop' || (path.status === 'error' && /无限循环|超过\s*\d+\s*步/.test(path.message))) {
      issues.push({ severity: 'error', blocking: true, category: 'flow', code: 'DETERMINISTIC_LOOP', message: `确定性死循环：${path.message}`, ...location, source: 'simulation' });
    } else if (path.status === 'error') {
      issues.push({ severity: 'error', blocking: true, category: 'flow', code: 'SIMULATION_RUNTIME_ERROR', message: path.message, ...location, source: 'simulation' });
    }
  }
  for (const fragmentId of result.coverage.fragments.unreachable) issues.push({ severity: 'warning', blocking: false, category: 'reachability', code: 'UNREACHABLE_FRAGMENT', message: `全分支模拟未到达片段：${fragmentId}`, fragmentId, source: 'simulation' });
  if (result.truncated || result.summary.truncated) issues.push({ severity: 'warning', blocking: false, category: 'flow', code: 'SIMULATION_INCOMPLETE', message: '状态空间达到检查上限，报告不能证明所有路径均安全', source: 'simulation' });
  return issues;
}

function deduplicate(issues: BuildPreflightIssue[]) {
  const seen = new Set<string>();
  return issues.filter((item) => {
    const location = item.blockId ?? `${item.fragmentId ?? ''}:${item.blockIndex ?? ''}`;
    const related = item.relatedId ?? '';
    const normalizedCode = item.code === 'SIMULATION_RUNTIME_ERROR' && /无效/.test(item.message) ? 'INVALID_TARGET' : item.code;
    const key = normalizedCode === 'MISSING_ASSET' ? `${normalizedCode}|${location}` : `${normalizedCode}|${location}|${related}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createBuildPreflightReport(project: Project, target: BuildTarget, simulation?: BranchSimulationResult): BuildPreflightReport {
  const base = diagnoseProject(project)
    .filter((item) => !simulation || item.code !== 'UNREACHABLE_FRAGMENT')
    .map(issueFromDiagnostic);
  const issues = deduplicate([...base, ...platformIssues(project), ...(simulation ? simulationIssues(simulation) : [])]);
  const references = analyzeAssetReferences(project);
  const errors = issues.filter((item) => item.severity === 'error').length;
  const warnings = issues.filter((item) => item.severity === 'warning').length;
  return {
    version: 1,
    target,
    projectId: project.meta.id,
    generatedAt: new Date().toISOString(),
    blocked: issues.some((item) => item.blocking),
    errors,
    warnings,
    issues,
    stats: {
      assets: project.assets.length,
      bundledAssets: references.bundledIds.size,
      fragments: project.chapters.flatMap((chapter) => chapter.fragments).length,
      blocks: Object.values(project.scripts).flat().length,
      unreachableFragments: simulation?.coverage.fragments.unreachable.length ?? issues.filter((item) => item.code === 'UNREACHABLE_FRAGMENT').length,
      simulatedPaths: simulation?.pathCount ?? 0,
    },
    simulation: {
      completed: Boolean(simulation),
      truncated: simulation?.truncated ?? false,
      loops: simulation ? simulation.summary.loop + simulation.paths.filter((path) => path.status === 'error' && /无限循环|超过\s*\d+\s*步/.test(path.message)).length : 0,
      runtimeErrors: simulation?.summary.error ?? 0,
      coveragePercent: simulation?.coverage.fragments.percent ?? 0,
    },
  };
}

export async function runBuildPreflight(project: Project, target: BuildTarget, options: RunBuildPreflightOptions = {}) {
  const execution = await branchSimulationRunner.run(project, { maxPaths: 500, maxStepsPerPath: 10_000, maxVariableScenarios: 64 }, options);
  return createBuildPreflightReport(project, target, execution.result);
}
