import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopApi, Project } from '../../types';

const fallback = {
  meta: { id: 'demo', name: '浏览器缓存项目' },
} as unknown as Project;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('desktop project session', () => {
  it('keeps waiting after an early pywebviewready event and saves with the loaded session', async () => {
    const diskProject = { meta: { id: 'demo', name: '磁盘项目' } } as unknown as Project;
    const saveProject = vi.fn().mockResolvedValue({ ok: true, path: 'C:/project/project.hikari.json', bytes: 10 });
    const api = {
      load_project_session: vi.fn().mockResolvedValue({
        project: diskProject,
        projectPath: 'C:/project/project.hikari.json',
        sessionToken: 'session-token',
      }),
      save_project: saveProject,
    } as unknown as DesktopApi;
    const host = Object.assign(new EventTarget(), {
      __HIKARI_DESKTOP__: true,
      pywebview: { api: {} as DesktopApi },
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal('window', host);
    const { loadProject, saveProject: save } = await import('../../api');

    const loading = loadProject(fallback);
    host.dispatchEvent(new Event('pywebviewready'));
    setTimeout(() => {
      host.pywebview.api = api;
    }, 10);

    await expect(loading).resolves.toBe(diskProject);
    await save(diskProject);
    expect(saveProject).toHaveBeenCalledWith(
      diskProject,
      'demo',
      'C:/project/project.hikari.json',
      'session-token',
    );
  });
});
