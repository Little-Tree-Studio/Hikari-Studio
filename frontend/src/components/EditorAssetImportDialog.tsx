import { useMemo, useState } from 'react';
import { AudioLines, FileImage, FolderInput, Image, MessageSquareText, Music2, UserPlus, X } from 'lucide-react';
import { isImportedImage, type EditorImportAction, type ImageImportPurpose } from '../core/assetImport';
import { Radio, RadioGroup } from './ui/RadioGroup';
import { Select } from './ui/Select';
import type { Asset, AudioCategory, Character } from '../types';

export type { EditorImportAction } from '../core/assetImport';

interface EditorAssetImportDialogProps {
  assets: Asset[];
  characters: Character[];
  sourceLabel?: string;
  close: () => void;
  apply: (action: EditorImportAction) => void;
}

export function EditorAssetImportDialog({ assets, characters, sourceLabel = '项目', close, apply }: EditorAssetImportDialogProps) {
  const images = useMemo(() => assets.filter(isImportedImage), [assets]);
  const audio = useMemo(() => assets.filter((asset) => asset.kind === 'audio'), [assets]);
  const other = assets.length - images.length - audio.length;
  const [imagePurpose, setImagePurpose] = useState<ImageImportPurpose | ''>('');
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? '');
  const [audioCategory, setAudioCategory] = useState<AudioCategory | ''>('');
  const [voiceCharacterId, setVoiceCharacterId] = useState('');
  const valid = (!images.length || Boolean(imagePurpose))
    && (!audio.length || Boolean(audioCategory))
    && (imagePurpose !== 'expressions' || Boolean(characterId));
  const submit = () => {
    if (!valid) return;
    apply({
      imagePurpose: imagePurpose || undefined,
      characterId: imagePurpose === 'expressions' ? characterId : undefined,
      audioCategory: audioCategory || undefined,
      voiceCharacterId: audioCategory === 'voice' ? voiceCharacterId || undefined : undefined,
    });
  };
  return <div className="modal-backdrop editor-asset-import-backdrop" onClick={close}><div className="modal editor-asset-import-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-import-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><strong id="editor-import-title">选择文件用途</strong><small>{sourceLabel} · {assets.length} 个文件等待绑定</small></div><button className="icon-button" title="关闭" onClick={close}><X /></button></div><div className="modal-body"><div className="editor-import-summary">{images.length > 0 && <span><FileImage />{images.length} 张图片</span>}{audio.length > 0 && <span><AudioLines />{audio.length} 个音频</span>}{other > 0 && <span><FolderInput />{other} 个自动分类文件</span>}</div><p>确认后才会登记素材并创建对应项目内容。混合导入可以分别设置图片和音频用途。</p>{images.length > 0 && <section className="editor-import-group"><header><FileImage /><span><strong>图片用途</strong><small>必须选择，导入后将自动绑定素材类型</small></span></header><RadioGroup className="editor-import-actions" value={imagePurpose} onChange={(value) => setImagePurpose(value as ImageImportPurpose)}><label className={imagePurpose === 'characters' ? 'active' : ''}><Radio value="characters" /><UserPlus /><span><strong>角色立绘</strong><small>每张图片创建一个角色并设为默认表情</small></span></label><label className={imagePurpose === 'expressions' ? 'active' : ''} aria-disabled={!characters.length}><Radio value="expressions" disabled={!characters.length} /><MessageSquareText /><span><strong>角色表情</strong><small>{characters.length ? '添加到指定角色，文件名作为表情名' : '需要先创建至少一个角色'}</small></span></label><label className={imagePurpose === 'scenes' ? 'active' : ''}><Radio value="scenes" /><Image /><span><strong>场景背景</strong><small>每张图片创建一个单层场景</small></span></label><label className={imagePurpose === 'library' ? 'active' : ''}><Radio value="library" /><FolderInput /><span><strong>普通图片 / CG / UI</strong><small>作为通用图片登记，不创建角色或场景</small></span></label></RadioGroup>{imagePurpose === 'expressions' && <label className="editor-import-select">目标角色<Select aria-label="目标角色" value={characterId} onChange={(value) => setCharacterId(value)}>{characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</Select></label>}</section>}{audio.length > 0 && <section className="editor-import-group"><header><AudioLines /><span><strong>音频用途</strong><small>必须选择，声音 Block 将按此分类筛选</small></span></header><div className="editor-audio-category">{([['bgm', 'BGM', Music2], ['sfx', '音效', AudioLines], ['voice', '语音', MessageSquareText]] as const).map(([id, label, Icon]) => <button type="button" className={audioCategory === id ? 'active' : ''} key={id} onClick={() => setAudioCategory(id)}><Icon />{label}</button>)}</div>{audioCategory === 'voice' && <label className="editor-import-select">所属角色（可选）<Select aria-label="语音所属角色" value={voiceCharacterId} onChange={(value) => setVoiceCharacterId(value)}><option value="">暂不分配</option>{characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</Select></label>}</section>}{other > 0 && <div className="editor-import-auto"><FolderInput /><span><strong>其它文件将按扩展名自动分类</strong><small>视频、字体和普通文件不会创建额外实体</small></span></div>}</div><div className="modal-footer"><span className="editor-import-required">{valid ? '用途配置完整' : '请完成所有必选用途'}</span><button className="button ghost" onClick={close}>取消</button><button className="button primary" disabled={!valid} onClick={submit}>确认导入</button></div></div></div>;
}
