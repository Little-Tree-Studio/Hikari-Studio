import { BookOpenCheck, Link2, Pin, Plus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProductionMemory, ProductionMemoryEntry, ProductionMemorySection, Project } from '../types';

const sections: Array<{ id: ProductionMemorySection; label: string }> = [
  { id: 'characterRules', label: '角色规则' }, { id: 'styleRules', label: '文风规则' },
  { id: 'facts', label: '剧情事实' }, { id: 'restrictions', label: '禁用设定' },
];
export const emptyProductionMemory = (): ProductionMemory => ({ version: 1, world: '', characterRules: [], styleRules: [], facts: [], restrictions: [], updatedAt: '' });
const id = () => `memory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

interface Props { project: Project; selectedBlockIndexes: number[]; close: () => void; save: (memory: ProductionMemory) => void; locate: (fragmentId: string, blockId?: string) => void }

export function ProductionMemoryDialog({ project, selectedBlockIndexes, close, save, locate }: Props) {
  const [draft, setDraft] = useState<ProductionMemory>(() => structuredClone(project.productionMemory ?? emptyProductionMemory()));
  const [section, setSection] = useState<ProductionMemorySection>('characterRules');
  const [query, setQuery] = useState('');
  const entries = useMemo(() => draft[section].filter((entry) => `${entry.title} ${entry.content}`.toLowerCase().includes(query.trim().toLowerCase())), [draft, query, section]);
  const updateEntry = (entryId: string, value: Partial<ProductionMemoryEntry>) => setDraft((current) => ({ ...current, [section]: current[section].map((entry) => entry.id === entryId ? { ...entry, ...value, updatedAt: new Date().toISOString() } : entry) }));
  const addEntry = () => setDraft((current) => ({ ...current, [section]: [...current[section], { id: id(), title: '新规则', content: '', pinned: false, references: [], updatedAt: new Date().toISOString() }] }));
  const addCurrentReference = (entry: ProductionMemoryEntry) => {
    const block = project.scripts[project.activeFragmentId]?.[selectedBlockIndexes[0]];
    if (entry.references.some((reference) => reference.fragmentId === project.activeFragmentId && reference.blockId === block?.id)) return;
    updateEntry(entry.id, { references: [...entry.references, { fragmentId: project.activeFragmentId, blockId: block?.id, note: '当前编辑位置' }] });
  };
  return <div className="modal-backdrop production-memory-backdrop"><div className="modal production-memory-dialog">
    <header className="modal-header"><BookOpenCheck /><div><strong>制作记忆</strong><small>世界观、角色规则、文风和剧情事实只用于 Studio 与 Agent</small></div><button className="icon-button" title="关闭" onClick={close}><X /></button></header>
    <div className="production-memory-layout"><aside>{sections.map((item) => <button className={section === item.id ? 'active' : ''} key={item.id} onClick={() => setSection(item.id)}>{item.label}<em>{draft[item.id].length}</em></button>)}</aside><main>
      <label className="memory-world"><span>世界观总纲</span><textarea value={draft.world} onChange={(event) => setDraft({ ...draft, world: event.target.value })} placeholder="描述故事发生的世界、时代、核心规则与主题边界" /></label>
      <div className="memory-toolbar"><label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${sections.find((item) => item.id === section)?.label}`} /></label><button className="button primary" onClick={addEntry}><Plus />添加条目</button></div>
      <div className="memory-entry-list">{entries.map((entry) => <article key={entry.id} className={entry.pinned ? 'pinned' : ''}><header><input value={entry.title} onChange={(event) => updateEntry(entry.id, { title: event.target.value })} /><button className={`icon-button ${entry.pinned ? 'active' : ''}`} title={entry.pinned ? '取消固定' : '固定事实'} onClick={() => updateEntry(entry.id, { pinned: !entry.pinned })}><Pin /></button><button className="icon-button danger" title="删除条目" onClick={() => setDraft((current) => ({ ...current, [section]: current[section].filter((item) => item.id !== entry.id) }))}><Trash2 /></button></header><textarea value={entry.content} onChange={(event) => updateEntry(entry.id, { content: event.target.value })} placeholder="写下 Agent 必须遵守的具体事实或规则" /><footer><div>{entry.references.map((reference, index) => <button key={`${reference.fragmentId}-${reference.blockId}-${index}`} onClick={() => locate(reference.fragmentId, reference.blockId)}><Link2 />{reference.fragmentId}{reference.blockId ? ` / ${reference.blockId}` : ''}</button>)}{!entry.references.length && <span>暂无引用</span>}</div><button onClick={() => addCurrentReference(entry)}><Plus />关联当前 Block</button></footer></article>)}{!entries.length && <div className="memory-empty">当前分类没有匹配条目</div>}</div>
    </main></div><footer className="modal-footer"><span>{draft.characterRules.length + draft.styleRules.length + draft.facts.length + draft.restrictions.length} 条制作规则</span><button className="button ghost" onClick={close}>取消</button><button className="button primary" onClick={() => save({ ...draft, version: 1, updatedAt: new Date().toISOString() })}>保存制作记忆</button></footer>
  </div></div>;
}
