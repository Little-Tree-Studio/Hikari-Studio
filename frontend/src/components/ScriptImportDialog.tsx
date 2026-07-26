import { FileText, FileUp, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import type { ScriptImportPreview } from '../types';

interface ScriptImportDialogProps {
  open: boolean;
  busy: boolean;
  preview: ScriptImportPreview | null;
  close: () => void;
  selectFile: () => void;
  apply: (mode: 'append' | 'replace') => void;
}

export function ScriptImportDialog({ open, busy, preview, close, selectFile, apply }: ScriptImportDialogProps) {
  if (!open) return null;
  return <div className="modal-backdrop" onClick={close}><div className="modal wide script-import-modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-header"><FileUp /><strong>导入剧本</strong><button className="icon-button" onClick={close}><X /></button></div>
    {!preview ? <div className="import-picker"><FileText /><strong>TXT、Markdown 或 Hikari JSON</strong><span>文件会先解析为 Block 预览，确认前不会修改项目。</span><button className="button primary" disabled={busy} onClick={selectFile}>{busy ? <LoaderCircle className="spin" /> : <FileUp />}{busy ? '正在解析' : '选择剧本文件'}</button></div> : <>
      <div className="import-summary"><span><strong>{preview.sourceName}</strong><small>{preview.format} · {preview.blocks.length} Blocks</small></span><button className="button ghost" disabled={busy} onClick={selectFile}><FileUp />重新选择</button></div>
      {!!preview.warnings.length && <div className="import-warnings">{preview.warnings.map((warning) => <span key={warning}><TriangleAlert />{warning}</span>)}</div>}
      <div className="import-preview-list">{preview.blocks.map((block, index) => <article key={block.id}><span>{index + 1}</span><strong>{block.type}</strong><p>{block.type === 'dialogue' ? `${block.speaker}：${block.text}` : block.text || block.title || block.target || '控制指令'}</p></article>)}</div>
      <div className="modal-footer"><button className="button ghost" onClick={close}>取消</button><button className="button ghost" disabled={!preview.blocks.length} onClick={() => apply('replace')}>替换当前片段</button><button className="button primary" disabled={!preview.blocks.length} onClick={() => apply('append')}>追加 {preview.blocks.length} 个 Block</button></div>
    </>}
  </div></div>;
}
