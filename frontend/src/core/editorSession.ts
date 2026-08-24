import type { InspectorDock } from '../types';
import { readSmallValue, writeSmallValue } from './storage';

/**
 * 编辑器会话状态（打开的片段标签、选中块、滚动位置、检查器停靠、脚本视图）。
 * 这些是纯 UI 状态，保存在 localStorage（按项目 id 隔离），不再写入项目文件，
 * 避免污染命令历史、恢复快照与跨设备协作的 diff。
 */

export interface EditorSessionState {
  openFragmentIds: string[];
  selectedBlockByFragment: Record<string, number>;
  scrollTopByFragment: Record<string, number>;
  inspectorDock: InspectorDock;
  scriptView: 'cards' | 'plain' | 'code' | 'json';
}

const storageKey = (projectId: string) => `slide-editor-session-${projectId}`;

export const defaultEditorSession = (activeFragmentId: string): EditorSessionState => ({
  openFragmentIds: [activeFragmentId],
  selectedBlockByFragment: {},
  scrollTopByFragment: {},
  inspectorDock: 'preview',
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
      inspectorDock: parsed.inspectorDock === 'floating' || parsed.inspectorDock === 'editor' ? parsed.inspectorDock : 'preview',
      scriptView: parsed.scriptView === 'plain' || parsed.scriptView === 'code' || parsed.scriptView === 'json' ? parsed.scriptView : 'cards',
    };
  } catch {
    return null;
  }
}

export function saveEditorSession(projectId: string, state: EditorSessionState): void {
  writeSmallValue(storageKey(projectId), JSON.stringify(state));
}
