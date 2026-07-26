import type { Project, StoryBlock } from '../../types';

export function testProject(
  scripts: Record<string, StoryBlock[]>,
  variables: Project['variables'] = {},
  options: { activeFragmentId?: string; characters?: Project['characters']; assets?: Project['assets']; variableDefinitions?: Project['variableDefinitions'] } = {},
): Project {
  const fragmentIds = Object.keys(scripts);
  const activeFragmentId = options.activeFragmentId ?? fragmentIds[0] ?? 'start';
  return {
    version: 3,
    meta: { id: 'vitest-project', name: 'Vitest Project', author: '', resolution: [1280, 720], updatedAt: '' },
    characters: options.characters ?? [],
    chapters: [{ id: 'chapter', name: 'Chapter', entry: true, fragments: fragmentIds.map((id) => ({ id, name: id })) }],
    activeFragmentId,
    scripts,
    assets: options.assets ?? [],
    variables,
    variableDefinitions: options.variableDefinitions,
    settings: { textSpeed: 35, autoSave: true, skipRead: true },
  };
}
