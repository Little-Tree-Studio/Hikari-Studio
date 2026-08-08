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

  it('profiles Python serialization, WebView transfer, and frontend JSON parsing in one reload', async () => {
    const diskProject = { meta: { id: 'profiled', name: '大型磁盘项目' } } as unknown as Project;
    const profile = {
      version: 1 as const,
      reloadId: 'server-will-use-client-id',
      recordedAt: '2026-08-02T00:00:00Z',
      projectLoadMs: 120,
      pythonSerializationMs: 30,
      pythonCompressionMs: 5,
      pythonTotalMs: 150,
      payloadBytes: 4096,
      transportBytes: 1024,
      counts: { chapters: 1, fragments: 1, blocks: 10_000, assets: 5_000, timelineClips: 1_000 },
    };
    const profiledLoad = vi.fn(async (reloadId: string) => ({
      projectJson: JSON.stringify(diskProject),
      projectPath: 'C:/project/project.hikari.json',
      sessionToken: 'profiled-session',
      backend: { ...profile, reloadId },
    }));
    const save = vi.fn().mockResolvedValue({ ok: true, path: 'C:/project/project.hikari.json', bytes: 100 });
    const api = {
      load_project_session: vi.fn(),
      load_project_session_profiled: profiledLoad,
      save_project: save,
    } as unknown as DesktopApi;
    const host = Object.assign(new EventTarget(), {
      __HIKARI_DESKTOP__: true,
      pywebview: { api },
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal('window', host);
    const { loadProjectWithPerformance, saveProject } = await import('../../api');

    const result = await loadProjectWithPerformance(fallback);

    expect(result.project).toEqual(diskProject);
    expect(result.performance?.backend.payloadBytes).toBe(4096);
    expect(result.performance?.bridgeRoundTripMs).toBeGreaterThanOrEqual(0);
    expect(result.performance?.jsonParseMs).toBeGreaterThanOrEqual(0);
    expect(profiledLoad).toHaveBeenCalledOnce();
    await saveProject(diskProject);
    expect(save).toHaveBeenCalledWith(diskProject, 'profiled', 'C:/project/project.hikari.json', 'profiled-session');
  });

  it('decodes gzip project payloads before parsing the desktop project', async () => {
    const api = {
      load_project_session: vi.fn(),
      load_project_session_profiled: vi.fn(async (reloadId: string) => ({
        encoding: 'gzip-base64' as const,
        projectPayload: 'H4sIAAAAAAAE/6tWyk0tSVSyqlbKTFGyUkrOzy0oSi0uTk1R0lHKS8xNBYo97et+vmfly4U7n89ep1RbCwBgiMt7MgAAAA==',
        projectPath: 'C:/project/project.hikari.json',
        sessionToken: 'compressed-session',
        backend: {
          version: 1 as const,
          reloadId,
          recordedAt: '2026-08-02T00:00:00Z',
          projectLoadMs: 1,
          pythonSerializationMs: 1,
          pythonCompressionMs: 1,
          pythonTotalMs: 3,
          payloadBytes: 50,
          transportBytes: 96,
          counts: { chapters: 0, fragments: 0, blocks: 0, assets: 0, timelineClips: 0 },
        },
      })),
    } as unknown as DesktopApi;
    const host = Object.assign(new EventTarget(), {
      __HIKARI_DESKTOP__: true,
      pywebview: { api },
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal('window', host);
    const { loadProjectWithPerformance } = await import('../../api');

    const result = await loadProjectWithPerformance(fallback);

    expect(result.project.meta).toEqual({ id: 'compressed', name: '压缩项目' });
    expect(result.performance?.payloadDecodeMs).toBeGreaterThanOrEqual(0);
    expect(api.load_project_session_profiled).toHaveBeenCalledWith(expect.any(String), true);
  });
});
