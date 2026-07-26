import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Gamepad2, LoaderCircle, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { captureSaveThumbnail, deleteSaveSlot, listSaveSlots, readSaveSlot, writeSaveSlot, type SaveSlotRecord } from '../core/saveGames';
import { loadSaveGame } from '../engine-core/runtime';
import type { EngineState } from '../engine-core/types';
import type { Project } from '../types';

interface SaveGameDialogProps {
  project: Project;
  state: EngineState;
  mode: 'save' | 'load';
  playTimeSeconds: number;
  close: () => void;
  loadState: (state: EngineState) => void;
  notify: (message: string) => void;
}

const formatDuration = (seconds = 0) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours} 小时 ` : ''}${minutes} 分钟`;
};

const formatDate = (value?: string) => value ? new Date(value).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

export function SaveGameDialog({ project, state, mode, playTimeSeconds, close, loadState, notify }: SaveGameDialogProps) {
  const [slots, setSlots] = useState<SaveSlotRecord[]>([]);
  const [selectedId, setSelectedId] = useState(mode === 'save' ? 'manual-1' : 'quick');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<'overwrite' | 'delete' | null>(null);
  const [closing, setClosing] = useState(false);
  const selected = slots.find((slot) => slot.slotId === selectedId);
  const utilitySlots = slots.filter((slot) => slot.slotType !== 'manual');
  const manualSlots = slots.filter((slot) => slot.slotType === 'manual');
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(close, 180);
  };

  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await listSaveSlots(project);
      setSlots(next);
      if (mode === 'load' && !next.some((slot) => slot.slotId === selectedId && slot.status === 'valid')) {
        setSelectedId(next.find((slot) => slot.status === 'valid')?.slotId ?? 'quick');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => setConfirmation(null), [selectedId]);

  const save = async () => {
    if (!selected) return;
    if (selected.status === 'valid' && confirmation !== 'overwrite') {
      setConfirmation('overwrite');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const thumbnail = await captureSaveThumbnail(project, state);
      await writeSaveSlot(project, state, selected.slotId, thumbnail, playTimeSeconds);
      notify(`已保存到${selected.label}`);
      requestClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const load = async () => {
    if (!selected || selected.status !== 'valid') return;
    setBusy(true);
    setError('');
    try {
      const saveGame = await readSaveSlot(project, selected.slotId);
      loadState(loadSaveGame(project, saveGame, state.variables));
      notify(`已读取${selected.label}`);
      requestClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
      await refresh();
    }
  };

  const remove = async () => {
    if (!selected || selected.status === 'empty') return;
    if (confirmation !== 'delete') {
      setConfirmation('delete');
      return;
    }
    setBusy(true);
    try {
      await deleteSaveSlot(project.meta.id, selected.slotId);
      setConfirmation(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const slotCard = (slot: SaveSlotRecord) => (
    <button
      type="button"
      className={`save-slot-card ${selectedId === slot.slotId ? 'selected' : ''} ${slot.status}`}
      key={slot.slotId}
      onClick={() => setSelectedId(slot.slotId)}
    >
      <span className="save-slot-thumbnail">
        {slot.save?.thumbnail ? <img src={slot.save.thumbnail} alt={slot.label} /> : slot.status === 'corrupt' ? <AlertTriangle /> : <Gamepad2 />}
        {slot.recovered && <em><RotateCcw />已恢复备份</em>}
      </span>
      <span className="save-slot-copy">
        <strong>{slot.label}</strong>
        {slot.status === 'valid' && slot.save ? <>
          <span>{slot.save.chapterName ?? '未命名章节'} · {slot.save.fragmentName ?? slot.save.state.fragmentId}</span>
          <small><Clock3 />{formatDate(slot.save.savedAt)} · {formatDuration(slot.save.playTimeSeconds)}</small>
        </> : slot.status === 'corrupt' ? <><span>存档无法读取</span><small>{slot.error}</small></> : <><span>空槽位</span><small>选择后创建新存档</small></>}
      </span>
    </button>
  );

  const actionLabel = useMemo(() => {
    if (mode === 'load') return '读取存档';
    if (confirmation === 'overwrite') return '确认覆盖';
    return selected?.status === 'valid' ? '覆盖存档' : '保存到此槽位';
  }, [confirmation, mode, selected?.status]);

  return <div className={`modal-backdrop save-game-backdrop ${closing ? 'closing' : ''}`} role="presentation" onClick={requestClose}>
    <section className="modal save-game-dialog" role="dialog" aria-modal="true" aria-labelledby="save-game-title" onClick={(event) => event.stopPropagation()}>
      <header className="modal-header">
        <div><strong id="save-game-title">{mode === 'save' ? '保存游戏' : '读取游戏'}</strong><small>{project.meta.name} · 最多 8 个手动存档</small></div>
        <button className="icon-button" title="关闭" onClick={requestClose}><X /></button>
      </header>
      <div className="save-game-body">
        {busy && !slots.length ? <div className="save-game-loading"><LoaderCircle className="spin" />正在读取存档</div> : <>
          <section className="save-slot-utility"><h2>快捷槽位</h2><div>{utilitySlots.map(slotCard)}</div></section>
          <section className="save-slot-manual"><h2>手动存档</h2><div>{manualSlots.map(slotCard)}</div></section>
        </>}
      </div>
      {error && <div className="save-game-error"><AlertTriangle />{error}</div>}
      {confirmation && <div className={`save-game-confirm ${confirmation}`}>
        <AlertTriangle />
        <span>{confirmation === 'overwrite' ? `再次点击“确认覆盖”，${selected?.label}的旧内容会保留为恢复备份。` : `再次点击“确认删除”，将删除${selected?.label}及其恢复备份。`}</span>
        <button onClick={() => setConfirmation(null)}>取消</button>
      </div>}
      <footer className="modal-footer save-game-footer">
        <button className="button ghost danger-text" disabled={!selected || selected.status === 'empty' || busy} onClick={() => void remove()}><Trash2 />{confirmation === 'delete' ? '确认删除' : '删除'}</button>
        <span />
        <button className="button ghost" onClick={requestClose}>取消</button>
        <button className="button primary" disabled={busy || !selected || (mode === 'load' && selected.status !== 'valid')} onClick={() => void (mode === 'save' ? save() : load())}>
          {busy ? <LoaderCircle className="spin" /> : <Save />}{actionLabel}
        </button>
      </footer>
    </section>
  </div>;
}
