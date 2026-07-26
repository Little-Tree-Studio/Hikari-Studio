import { useMemo, useState } from 'react';
import { AudioLines, FileImage, FolderInput, Image, MessageSquareText, Music2, UserPlus, X } from 'lucide-react';
import type { Asset, AudioCategory, Character } from '../types';

export type EditorImportAction =
  | { kind: 'assetsOnly'; audioCategory?: AudioCategory }
  | { kind: 'scenes' }
  | { kind: 'characters' }
  | { kind: 'expressions'; characterId: string };

interface EditorAssetImportDialogProps {
  assets: Asset[];
  characters: Character[];
  close: () => void;
  apply: (action: EditorImportAction) => void;
}

export function EditorAssetImportDialog({ assets, characters, close, apply }: EditorAssetImportDialogProps) {
  const images = useMemo(() => assets.filter((asset) => ['image', 'scene', 'character'].includes(asset.kind)), [assets]);
  const audio = useMemo(() => assets.filter((asset) => asset.kind === 'audio'), [assets]);
  const other = assets.length - images.length - audio.length;
  const [action, setAction] = useState<'assetsOnly' | 'scenes' | 'characters' | 'expressions'>(images.length ? 'assetsOnly' : 'assetsOnly');
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? '');
  const [audioCategory, setAudioCategory] = useState<AudioCategory>('bgm');
  const submit = () => {
    if (action === 'expressions') { if (!characterId) return; apply({ kind: 'expressions', characterId }); }
    else if (action === 'scenes') apply({ kind: 'scenes' });
    else if (action === 'characters') apply({ kind: 'characters' });
    else apply({ kind: 'assetsOnly', audioCategory: audio.length ? audioCategory : undefined });
  };
  return <div className="modal-backdrop editor-asset-import-backdrop" onClick={close}><div className="modal editor-asset-import-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-import-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><strong id="editor-import-title">导入到剧本项目</strong><small>{assets.length} 个文件已复制到项目资源目录</small></div><button className="icon-button" title="关闭" onClick={close}><X /></button></div><div className="modal-body"><div className="editor-import-summary">{images.length > 0 && <span><FileImage />{images.length} 张图片</span>}{audio.length > 0 && <span><AudioLines />{audio.length} 个音频</span>}{other > 0 && <span><FolderInput />{other} 个其它文件</span>}</div><p>选择是否同时创建可复用实体。此操作不会向当前 Fragment 插入剧情 Block。</p><div className="editor-import-actions"><label className={action === 'assetsOnly' ? 'active' : ''}><input type="radio" name="asset-action" checked={action === 'assetsOnly'} onChange={() => setAction('assetsOnly')} /><FolderInput /><span><strong>仅导入素材</strong><small>登记文件，稍后从属性检查器选择</small></span></label>{images.length > 0 && <><label className={action === 'scenes' ? 'active' : ''}><input type="radio" name="asset-action" checked={action === 'scenes'} onChange={() => setAction('scenes')} /><Image /><span><strong>为每张图片创建场景</strong><small>生成单层场景配置</small></span></label><label className={action === 'characters' ? 'active' : ''}><input type="radio" name="asset-action" checked={action === 'characters'} onChange={() => setAction('characters')} /><UserPlus /><span><strong>为每张图片创建角色</strong><small>图片作为默认立绘</small></span></label><label className={action === 'expressions' ? 'active' : ''}><input type="radio" name="asset-action" checked={action === 'expressions'} onChange={() => setAction('expressions')} /><MessageSquareText /><span><strong>添加为角色表情</strong><small>文件名作为表情名称</small></span></label></>}</div>{action === 'expressions' && <label className="editor-import-select">目标角色<select value={characterId} onChange={(event) => setCharacterId(event.target.value)}>{characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>}{action === 'assetsOnly' && audio.length > 0 && <div className="editor-audio-category"><strong>音频分类</strong>{([['bgm', 'BGM', Music2], ['sfx', '音效', AudioLines], ['voice', '语音', MessageSquareText]] as const).map(([id, label, Icon]) => <button className={audioCategory === id ? 'active' : ''} key={id} onClick={() => setAudioCategory(id)}><Icon />{label}</button>)}</div>}</div><div className="modal-footer"><button className="button ghost" onClick={close}>取消</button><button className="button primary" disabled={action === 'expressions' && !characterId} onClick={submit}>确认导入</button></div></div></div>;
}
