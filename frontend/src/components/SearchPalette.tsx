import { useMemo, useState } from 'react';
import { Braces, FileText, Image, Replace, Search, UserRound, X } from 'lucide-react';
import type { Project } from '../types';

export interface SearchLocation { fragmentId?: string; blockIndex?: number; page?: 'assets' | 'characters' }
interface SearchResult { id: string; label: string; detail: string; text: string; icon: typeof FileText; location: SearchLocation }
interface SearchPaletteProps {
  project: Project;
  close: () => void;
  locate: (location: SearchLocation) => void;
  replaceText: (query: string, replacement: string) => number;
}

export function SearchPalette({ project, close, locate, replaceText }: SearchPaletteProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const results = useMemo<SearchResult[]>(() => {
    const fragments = project.chapters.flatMap((chapter) => chapter.fragments.map((fragment) => ({ id: `fragment-${fragment.id}`, label: fragment.name, detail: chapter.name, text: `${fragment.name} ${chapter.name}`, icon: FileText, location: { fragmentId: fragment.id } })));
    const blocks = Object.entries(project.scripts).flatMap(([fragmentId, items]) => items.map((block, blockIndex) => ({ id: block.id, label: block.text || block.title || block.type, detail: `${block.type} · ${fragmentId}`, text: [block.text, block.title, block.speaker, block.variable, block.type].join(' '), icon: FileText, location: { fragmentId, blockIndex } })));
    const characters = project.characters.map((character) => ({ id: `character-${character.id}`, label: character.name, detail: `${character.expressions.length} 个表情`, text: `${character.name} ${character.expressions.join(' ')}`, icon: UserRound, location: { page: 'characters' as const } }));
    const assets = project.assets.map((asset) => ({ id: `asset-${asset.id}`, label: asset.name, detail: asset.kind, text: `${asset.name} ${asset.kind} ${asset.path}`, icon: Image, location: { page: 'assets' as const } }));
    const variables = Object.entries(project.variables).map(([name, value]) => ({ id: `variable-${name}`, label: name, detail: `变量 · ${String(value)}`, text: `${name} ${String(value)}`, icon: Braces, location: {} }));
    const needle = query.trim().toLocaleLowerCase();
    return [...fragments, ...blocks, ...characters, ...assets, ...variables].filter((item) => !needle || item.text.toLocaleLowerCase().includes(needle)).slice(0, 60);
  }, [project, query]);

  const applyReplace = () => {
    if (!query.trim() || !replacement || query === replacement) return;
    const count = replaceText(query, replacement);
    if (count) { setQuery(replacement); setReplacement(''); }
  };

  return <div className="modal-backdrop" onClick={close}><div className="modal search-modal advanced-search" onClick={(event) => event.stopPropagation()}>
    <div className="search-input-row"><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索台词、Block、角色、变量、素材或片段..." /><button title="批量替换" className={replaceOpen ? 'active' : ''} onClick={() => setReplaceOpen((value) => !value)}><Replace /></button><button title="关闭" onClick={close}><X /></button></div>
    {replaceOpen && <div className="replace-row"><input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="替换为..." /><button className="button primary" disabled={!query.trim() || !replacement || query === replacement} onClick={applyReplace}>全部替换</button></div>}
    <div className="search-results"><div className="search-group-title">{query ? `${results.length} 个匹配结果` : '全部项目内容'}</div>{results.map(({ id, label, detail, icon: Icon, location }) => <button className="search-result" key={id} onClick={() => { locate(location); close(); }}><Icon /><span>{label}</span><small>{detail}</small></button>)}{!results.length && <div className="search-empty">没有找到匹配内容</div>}</div>
  </div></div>;
}
