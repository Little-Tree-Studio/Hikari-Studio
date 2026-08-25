import type { InspectorDock } from '../types';
import { readSmallValue, writeSmallValue } from './storage';

/**
 * 编辑器会话状态（打开的片段标签、选中块、滚动位置、检查器/变量面板停靠、脚本视图）。
 * 这些是纯 UI 状态，保存在 localStorage（按项目 id 隔离），不再写入项目文件，
 * 避免污染命令历史、恢复快照与跨设备协作的 diff。
 */

export interface EditorSessionState {
  openFragmentIds: string[];
  selectedBlockByFragment: Record<string, number>;
  scrollTopByFragment: Record<string, number>;
  inspectorDock: InspectorDock;
  variablesDock: InspectorDock;
  inspectorCollapsed: boolean;
  variablesCollapsed: boolean;
  /** 右侧检查器与变量面板上下堆叠时，检查器占容器高度的比例（0.2 - 0.8）。 */
  panelSplit: number;
  scriptView: 'cards' | 'plain' | 'code' | 'json';
}

const storageKey = (projectId: string) => `slide-editor-session-${projectId}`;

const parseDock = (value: unknown, fallback: InspectorDock): InspectorDock => value === 'floating' || value === 'editor' || value === 'preview' ? value : fallback;

export const defaultEditorSession = (activeFragmentId: string): EditorSessionState => ({
  openFragmentIds: [activeFragmentId],
  selectedBlockByFragment: {},
  scrollTopByFragment: {},
  inspectorDock: 'preview',
  variablesDock: 'preview',
  inspectorCollapsed: false,
  variablesCollapsed: false,
  panelSplit: .6,
  scriptView: 'cards',
});

export function loadEditorSession(projectId: string): EditorSessionState | null {
  const raw = readSmallValue(storageKey(projectId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EditorSessionState> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      openFragmentIds: Array.isArray(parsed.openFragmentIds) ? parsed.openFragmentIds.filter((item) => typeof item === 'string') : [],
      selectedBlockByFragment: parsed.selectedBlockByFragment && typeof parsed.selectedBlockByFragment === 'object' ? parsed.selectedBlockByFragment : {},
      scrollTopByFragment: parsed.scrollTopByFragment && typeof parsed.scrollTopByFragment === 'object' ? parsed.scrollTopByFragment : {},
      inspectorDock: parseDock(parsed.inspectorDock, 'preview'),
      variablesDock: parseDock(parsed.variablesDock, 'preview'),
      inspectorCollapsed: Boolean(parsed.inspectorCollapsed),
      variablesCollapsed: Boolean(parsed.variablesCollapsed),
      panelSplit: typeof parsed.panelSplit === 'number' && Number.isFinite(parsed.panelSplit) ? Math.min(.8, Math.max(.2, parsed.panelSplit)) : .6,
      scriptView: parsed.scriptView === 'plain' || parsed.scriptView === 'code' || parsed.scriptView === 'json' ? parsed.scriptView : 'cards',
    };
  } catch {
    return null;
  }
}

export function saveEditorSession(projectId: string, state: EditorSessionState): void {
  writeSmallValue(storageKey(projectId), JSON.stringify(state));
}
