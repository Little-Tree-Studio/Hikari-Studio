import { useEffect, useState } from 'react';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { readLargeValue } from '../core/storage';
import type { Project } from '../types';
import { Preview } from './Preview';

export function StandalonePreviewApp() {
  const [project, setProject] = useState<Project | null>();
  useEffect(() => {
    void readLargeValue('hikari-preview-project')
      .then((encoded) => setProject(encoded ? JSON.parse(encoded) as Project : null))
      .catch(() => setProject(null));
  }, []);
  if (project === undefined) return <div className="preview-load-error"><LoaderCircle className="spinning" /><strong>正在载入预览</strong><span>正在读取本地项目数据…</span></div>;
  if (!project) return <div className="preview-load-error"><TriangleAlert /><strong>无法载入预览</strong><span>请从 Hikari Studio 编辑器重新打开独立预览。</span></div>;
  const parameters = new URLSearchParams(window.location.search);
  const fragmentId = parameters.get('fragment');
  const previewProject = fragmentId && project.scripts[fragmentId] ? { ...project, activeFragmentId: fragmentId } : project;
  const index = Math.max(0, Number(parameters.get('index') ?? 0));
  return <main className="standalone-preview-app"><Preview project={previewProject} editorIndex={index} standalone /></main>;
}
