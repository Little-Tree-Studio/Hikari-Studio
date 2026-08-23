import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Crop, FileImage, FileUp, GripVertical,
  Image, Layers3, LoaderCircle, LocateFixed, Pencil, Plus, Search,
  SlidersHorizontal, Trash2, Upload, UserPlus, Users, X,
} from 'lucide-react';
import { importAssets, inspectAssets, replaceAssetFile } from '../api';
import { Checkbox } from './ui/Checkbox';
import { Radio, RadioGroup } from './ui/RadioGroup';
import { Select } from './ui/Select';
import { Slider } from './ui/Slider';
import type {
  Asset, AssetFileStatus, CharacterDimension, CharacterPosition, DisplayNameScheme,
  DisplayNameSchemeKind, PortraitCrop, Project,
} from '../types';

type Props = {
  project: Project;
  commit: (updater: (project: Project) => Project, label?: string) => void;
  notify: (message: string, tone?: 'error' | 'success') => void;
  requestText: (options: { title: string; message?: string; placeholder?: string; initialValue?: string; confirmText?: string }) => Promise<string | null>;
  requestConfirm: (options: { title: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
};
type ImportedPortrait = { asset: Asset; expression: string };
type BatchDraft = { roleName: string; portraits: ImportedPortrait[]; defaultId: string };
type PortraitHealth = { tone: 'empty' | 'checking' | 'ready' | 'warning' | 'error'; label: string; detail: string; canRelink: boolean };

const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const supportedImage = (name: string) => /\.(png|jpe?g|webp)$/i.test(name);
const parsePortraitName = (name: string) => {
  const base = name.replace(/\.[^.]+$/, '');
  const separator = base.indexOf('_');
  return separator > 0 ? { role: base.slice(0, separator), expression: base.slice(separator + 1) || '默认' } : { role: base, expression: '默认' };
};
const normalizeImported = (assets: Asset[]): BatchDraft | null => {
  const images = assets.filter((asset) => supportedImage(asset.path || asset.name));
  if (!images.length) return null;
  const parsed = images.map((asset) => ({ asset: { ...asset, kind: 'character' }, ...parsePortraitName(asset.path || asset.name) }));
  const portraits = parsed.map(({ asset, expression }) => ({ asset, expression }));
  return { roleName: parsed[0].role || '新角色', portraits, defaultId: portraits.find((item) => item.expression === '默认')?.asset.id ?? portraits[0].asset.id };
};
const fileToAsset = (file: File) => new Promise<Asset>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error(`无法读取 ${file.name}`));
  reader.onload = () => resolve({ id: makeId('asset'), kind: 'character', name: file.name.replace(/\.[^.]+$/, ''), path: file.name, uri: String(reader.result), size: file.size });
  reader.readAsDataURL(file);
});
const dimensionText = (dimension?: CharacterDimension) => dimension?.value === undefined ? '自动' : `${dimension.value}${dimension.unit}`;

export function CharacterManager({ project, commit, notify, requestText, requestConfirm }: Props) {
  const [selectedId, setSelectedId] = useState(project.characters[0]?.id ?? '');
  const [selectedExpression, setSelectedExpression] = useState(project.characters[0]?.expressions[0] ?? '默认');
  const [selectedExpressions, setSelectedExpressions] = useState<Set<string>>(() => new Set([selectedExpression]));
  const [selectionAnchor, setSelectionAnchor] = useState(selectedExpression);
  const [renamingExpression, setRenamingExpression] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [draggedExpression, setDraggedExpression] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [batchDraft, setBatchDraft] = useState<BatchDraft | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [assetStatuses, setAssetStatuses] = useState<Record<string, AssetFileStatus>>({});
  const [scanningAssets, setScanningAssets] = useState(false);
  const [loadedAssetIds, setLoadedAssetIds] = useState<Set<string>>(() => new Set());
  const [failedAssetIds, setFailedAssetIds] = useState<Set<string>>(() => new Set());
  const [relinkingAssetId, setRelinkingAssetId] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const fileModeRef = useRef<'new' | 'expressions'>('new');
  const selected = project.characters.find((character) => character.id === selectedId) ?? project.characters[0];
  const portraitId = selected?.portraits?.[selectedExpression];
  const portraitAsset = project.assets.find((asset) => asset.id === portraitId);
  const currentCrop = selected?.portraitCrops?.[selectedExpression] ?? { x: 0, y: 0, zoom: 1 };
  const imageAssets = project.assets.filter((asset) => ['character', 'image', 'scene'].includes(asset.kind));
  const dialogueReferences = selected ? Object.entries(project.scripts).flatMap(([fragmentId, blocks]) => blocks.flatMap((block, blockIndex) => block.type === 'dialogue' && block.speaker === selected.name && (block.expression ?? '默认') === selectedExpression ? [{ fragmentId, blockIndex }] : [])) : [];
  const allRoleReferences = selected ? Object.values(project.scripts).flat().filter((block) => block.speaker === selected.name || block.characterId === selected.id).length : 0;
  const textVariables = Object.keys(project.variables).filter((name) => project.variableDefinitions?.[name]?.type === 'string' || typeof project.variables[name] === 'string');
  const assetSignature = project.assets.map((asset) => `${asset.id}:${asset.path}:${asset.uri ?? ''}:${asset.size ?? 0}`).join('|');

  useEffect(() => {
    if (!selected) return;
    if (!selected.expressions.includes(selectedExpression)) {
      const next = selected.expressions[0] ?? '默认';
      setSelectedExpression(next); setSelectedExpressions(new Set([next])); setSelectionAnchor(next);
    }
  }, [selected?.id, selected?.expressions.join('|'), selectedExpression]);
  useEffect(() => { if (!selected && project.characters[0]) setSelectedId(project.characters[0].id); }, [selected, project.characters]);
  useEffect(() => {
    let cancelled = false;
    setScanningAssets(true);
    void inspectAssets(project.assets)
      .then(async (statuses) => {
        if (cancelled) return;
        setAssetStatuses(Object.fromEntries(statuses.map((status) => [status.assetId, status])));
        const failures = new Set<string>();
        await Promise.all(project.assets.filter((asset) => supportedImage(asset.path || asset.name) && asset.uri && statuses.find((status) => status.assetId === asset.id)?.exists !== false).map((asset) => new Promise<void>((resolve) => {
          const image = new window.Image();
          image.onload = () => resolve();
          image.onerror = () => { failures.add(asset.id); resolve(); };
          image.src = asset.uri!;
        })));
        if (!cancelled) setFailedAssetIds(failures);
      })
      .catch(() => {
        if (!cancelled) setAssetStatuses({});
      })
      .finally(() => {
        if (!cancelled) setScanningAssets(false);
      });
    setLoadedAssetIds(new Set());
    setFailedAssetIds(new Set());
    return () => { cancelled = true; };
  }, [assetSignature]);
  const shownCharacters = useMemo(() => project.characters.filter((character) => character.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [project.characters, query]);

  const markAssetLoaded = (assetId: string) => {
    setLoadedAssetIds((current) => new Set(current).add(assetId));
    setFailedAssetIds((current) => {
      if (!current.has(assetId)) return current;
      const next = new Set(current); next.delete(assetId); return next;
    });
  };
  const markAssetFailed = (assetId: string) => {
    setFailedAssetIds((current) => new Set(current).add(assetId));
    setLoadedAssetIds((current) => {
      if (!current.has(assetId)) return current;
      const next = new Set(current); next.delete(assetId); return next;
    });
  };
  const portraitHealth: PortraitHealth = (() => {
    if (!portraitId) return { tone: 'empty', label: '未配置立绘', detail: '为当前表情上传图片，或从素材库选择。', canRelink: false };
    if (!portraitAsset) return { tone: 'error', label: '素材引用丢失', detail: `项目仍引用 ${portraitId}，但素材记录已不存在。`, canRelink: true };
    if (!supportedImage(portraitAsset.path || portraitAsset.name)) return { tone: 'error', label: '格式不兼容', detail: '立绘仅支持 PNG、JPG、JPEG 和 WebP。', canRelink: true };
    if (assetStatuses[portraitId]?.exists === false) return { tone: 'error', label: '源文件缺失', detail: portraitAsset.path || '磁盘上找不到对应文件。', canRelink: true };
    if (!portraitAsset.uri) return { tone: 'error', label: '无法访问素材', detail: '素材没有可用的本地地址。', canRelink: true };
    if (failedAssetIds.has(portraitId)) return { tone: 'error', label: '图片损坏或无法解码', detail: '文件存在，但图像解码失败，请更换原文件。', canRelink: true };
    if (loadedAssetIds.has(portraitId)) return { tone: 'ready', label: '立绘已就绪', detail: `${portraitAsset.name} · ${portraitAsset.size ? `${(portraitAsset.size / 1024).toFixed(0)} KB` : '已加载'}`, canRelink: true };
    return { tone: 'checking', label: scanningAssets ? '正在检查素材' : '正在加载立绘', detail: portraitAsset.path, canRelink: true };
  })();

  const patchCharacter = (patch: Record<string, unknown>, label = '更新角色属性') => selected && commit((current) => ({ ...current, characters: current.characters.map((character) => character.id === selected.id ? { ...character, ...patch } : character) }), `${label} ${selected.name}`);
  const openBatchDraft = (assets: Asset[]) => { const draft = normalizeImported(assets); if (!draft) return notify('请选择 PNG、JPG、JPEG 或 WebP 图片', 'error'); setBatchDraft(draft); };
  const addPortraitsToSelected = (assets: Asset[]) => {
    if (!selected) return;
    const imported = assets.map((asset) => ({ asset: { ...asset, kind: 'character' }, expression: parsePortraitName(asset.path || asset.name).expression }));
    if (imported.length === 1) {
      const replacement = imported[0].asset;
      const previousAssetId = selected.portraits?.[selectedExpression];
      commit((current) => ({
        ...current,
        assets: [...current.assets, replacement],
        characters: current.characters.map((character) => character.id === selected.id
          ? { ...character, portraits: { ...(character.portraits ?? {}), [selectedExpression]: replacement.id } }
          : character),
        scripts: Object.fromEntries(Object.entries(current.scripts).map(([fragmentId, blocks]) => [
          fragmentId,
          blocks.map((block) => block.type === 'characterShow'
            && block.characterId === selected.id
            && (block.expression ?? '默认') === selectedExpression
            && (!block.assetId || block.assetId === previousAssetId)
            ? { ...block, assetId: replacement.id }
            : block),
        ])),
      }), `上传 ${selected.name} · ${selectedExpression} 立绘`);
      notify(`已更新 ${selected.name} 的“${selectedExpression}”立绘`, 'success');
      return;
    }
    const addedNames: string[] = [];
    commit((current) => ({ ...current, assets: [...current.assets, ...imported.map((item) => item.asset)], characters: current.characters.map((character) => {
      if (character.id !== selected.id) return character;
      const expressions = [...character.expressions]; const portraits = { ...(character.portraits ?? {}) };
      imported.forEach((item) => { let name = item.expression; let suffix = 1; while (expressions.includes(name)) name = `${item.expression}_${suffix++}`; expressions.push(name); addedNames.push(name); portraits[name] = item.asset.id; });
      return { ...character, expressions, portraits };
    }) }), `导入 ${selected.name} 的 ${imported.length} 张差分立绘`);
    const first = addedNames[0] ?? imported[0].expression; setSelectedExpression(first); setSelectedExpressions(new Set([first])); notify(`已添加 ${imported.length} 张差分立绘`);
  };
  const chooseImages = async (mode: 'new' | 'expressions') => {
    fileModeRef.current = mode;
    if (!window.__HIKARI_DESKTOP__) { fileInputRef.current?.click(); return; }
    try { const assets = await importAssets(); if (mode === 'new') openBatchDraft(assets); else addPortraitsToSelected(assets); } catch (error) { notify(String(error), 'error'); }
  };
  const handleFiles = async (files: FileList | File[], mode: 'new' | 'expressions') => {
    try {
      const assets = await Promise.all(Array.from(files).filter((file) => supportedImage(file.name)).map(fileToAsset));
      if (!assets.length) return notify('拖入的文件中没有支持的立绘图片', 'error');
      if (mode === 'new' || !selected) openBatchDraft(assets); else addPortraitsToSelected(assets);
    } catch (error) { notify(String(error), 'error'); }
  };
  const createEmpty = async () => {
    const name = await requestText({ title: '新建角色', message: '主名称仅用于 Studio 识别角色。', placeholder: '角色名称', confirmText: '创建角色' });
    if (!name) return;
    const id = makeId('character');
    commit((current) => ({ ...current, characters: [...current.characters, { id, name, color: '#3478c5', expressions: ['默认'], portraits: {}, defaultScale: 1, defaultPosition: 'center', defaultLayer: 0, attributes: {}, displayNameSchemes: [], portraitCrops: {}, overlays: [], keepAspectRatio: true }] }), `新建角色 ${name}`);
    setSelectedId(id); setSelectedExpression('默认'); setSelectedExpressions(new Set(['默认']));
  };
  const createBatch = () => {
    if (!batchDraft?.roleName.trim() || !batchDraft.portraits.length) return;
    const id = makeId('character'); const expressions: string[] = []; const portraits: Record<string, string> = {};
    const ordered = [...batchDraft.portraits].sort((left, right) => Number(right.asset.id === batchDraft.defaultId) - Number(left.asset.id === batchDraft.defaultId));
    ordered.forEach((item) => { let expression = item.expression.trim() || '默认'; let suffix = 1; while (expressions.includes(expression)) expression = `${item.expression}_${suffix++}`; expressions.push(expression); portraits[expression] = item.asset.id; });
    commit((current) => ({ ...current, assets: [...current.assets, ...ordered.map((item) => item.asset)], characters: [...current.characters, { id, name: batchDraft.roleName.trim(), color: '#3478c5', expressions, portraits, defaultScale: 1, defaultPosition: 'center', defaultLayer: 0, attributes: {}, displayNameSchemes: [], portraitCrops: {}, overlays: [], keepAspectRatio: true }] }), `批量导入角色 ${batchDraft.roleName}`);
    setSelectedId(id); setSelectedExpression(expressions[0]); setSelectedExpressions(new Set([expressions[0]])); setBatchDraft(null); notify(`角色已创建，包含 ${expressions.length} 个表情`);
  };
  const renameCharacter = (name: string) => {
    if (!selected || !name || name === selected.name) return;
    commit((current) => ({ ...current, characters: current.characters.map((character) => character.id === selected.id ? { ...character, name } : character), scripts: Object.fromEntries(Object.entries(current.scripts).map(([fragmentId, blocks]) => [fragmentId, blocks.map((block) => block.speaker === selected.name ? { ...block, speaker: name } : block)])) }), `重命名角色 ${selected.name} → ${name}`);
  };
  const removeCharacter = async () => {
    if (!selected) return;
    if (allRoleReferences) return notify(`${selected.name} 仍被 ${allRoleReferences} 处剧本引用，无法删除`, 'error');
    if (!await requestConfirm({ title: '删除角色', message: `删除角色“${selected.name}”？立绘素材仍会保留在素材库。`, confirmText: '删除', danger: true })) return;
    commit((current) => ({ ...current, characters: current.characters.filter((character) => character.id !== selected.id) }), `删除角色 ${selected.name}`);
  };

  const selectExpression = (expression: string, event: MouseEvent) => {
    setSelectedExpression(expression);
    setSelectedExpressions((current) => {
      if (event.shiftKey && selected) {
        const start = selected.expressions.indexOf(selectionAnchor); const end = selected.expressions.indexOf(expression);
        return new Set(selected.expressions.slice(Math.min(start, end), Math.max(start, end) + 1));
      }
      if (event.ctrlKey || event.metaKey) { const next = new Set(current); next.has(expression) ? next.delete(expression) : next.add(expression); return next.size ? next : new Set([expression]); }
      return new Set([expression]);
    });
    if (!event.shiftKey) setSelectionAnchor(expression);
  };
  const addExpression = async () => {
    if (!selected) return;
    const name = await requestText({ title: '新增表情', message: '每个表情需要单独配置一张角色图片。', placeholder: '例如：微笑', confirmText: '添加表情' });
    if (!name || selected.expressions.includes(name)) return;
    patchCharacter({ expressions: [...selected.expressions, name] }, '新增角色表情'); setSelectedExpression(name); setSelectedExpressions(new Set([name]));
  };
  const expressionReferenceCount = (expression: string) => selected ? Object.values(project.scripts).flat().filter((block) => (block.type === 'dialogue' && block.speaker === selected.name || block.type === 'characterShow' && block.characterId === selected.id) && (block.expression ?? '默认') === expression).length : 0;
  const removeSelectedExpressions = async () => {
    if (!selected) return;
    const targets = selected.expressions.filter((expression) => selectedExpressions.has(expression));
    if (selected.expressions.length - targets.length < 1) return notify('角色至少需要保留一个表情', 'error');
    const references = targets.reduce((sum, expression) => sum + expressionReferenceCount(expression), 0);
    if (references) return notify(`所选表情仍被 ${references} 处剧本引用，无法删除`, 'error');
    if (!await requestConfirm({ title: `删除 ${targets.length} 个表情`, message: '只删除表情配置，素材文件仍会保留。', confirmText: '删除', danger: true })) return;
    const expressions = selected.expressions.filter((expression) => !selectedExpressions.has(expression));
    const portraits = { ...(selected.portraits ?? {}) }; const portraitCrops = { ...(selected.portraitCrops ?? {}) };
    targets.forEach((expression) => { delete portraits[expression]; delete portraitCrops[expression]; });
    patchCharacter({ expressions, portraits, portraitCrops }, '批量删除角色表情'); setSelectedExpression(expressions[0]); setSelectedExpressions(new Set([expressions[0]]));
  };
  const finishExpressionRename = () => {
    if (!selected || !renamingExpression) return;
    const next = renameDraft.trim(); const old = renamingExpression; setRenamingExpression(null);
    if (!next || next === old || selected.expressions.includes(next)) return;
    commit((current) => ({ ...current, characters: current.characters.map((character) => {
      if (character.id !== selected.id) return character;
      const portraits = { ...(character.portraits ?? {}) }; const crops = { ...(character.portraitCrops ?? {}) };
      if (portraits[old]) { portraits[next] = portraits[old]; delete portraits[old]; }
      if (crops[old]) { crops[next] = crops[old]; delete crops[old]; }
      return { ...character, expressions: character.expressions.map((expression) => expression === old ? next : expression), portraits, portraitCrops: crops };
    }), scripts: Object.fromEntries(Object.entries(current.scripts).map(([fragmentId, blocks]) => [fragmentId, blocks.map((block) => ((block.type === 'dialogue' && block.speaker === selected.name) || (block.type === 'characterShow' && block.characterId === selected.id)) && block.expression === old ? { ...block, expression: next } : block)])) }), `重命名角色表情 ${old} → ${next}`);
    setSelectedExpression(next); setSelectedExpressions(new Set([next]));
  };
  const reorderExpressions = (target: string) => {
    if (!selected || !draggedExpression || target === draggedExpression) return;
    const moving = selectedExpressions.has(draggedExpression)
      ? selected.expressions.filter((expression) => selectedExpressions.has(expression))
      : [draggedExpression];
    if (moving.includes(target)) return setDraggedExpression(null);
    const rest = selected.expressions.filter((expression) => !moving.includes(expression));
    const insertion = Math.max(0, rest.indexOf(target)); rest.splice(insertion, 0, ...moving);
    patchCharacter({ expressions: rest }, '调整表情顺序'); setDraggedExpression(null);
  };
  const setPortrait = (assetId: string) => {
    if (!selected) return;
    const previousAssetId = selected.portraits?.[selectedExpression];
    commit((current) => ({
      ...current,
      characters: current.characters.map((character) => {
        if (character.id !== selected.id) return character;
        const portraits = { ...(character.portraits ?? {}) };
        if (assetId) portraits[selectedExpression] = assetId;
        else delete portraits[selectedExpression];
        return { ...character, portraits };
      }),
      scripts: Object.fromEntries(Object.entries(current.scripts).map(([fragmentId, blocks]) => [
        fragmentId,
        blocks.map((block) => block.type === 'characterShow'
          && block.characterId === selected.id
          && (block.expression ?? '默认') === selectedExpression
          && (!block.assetId || block.assetId === previousAssetId)
          ? { ...block, assetId: assetId || undefined }
          : block),
      ])),
    }), `设置 ${selected.name} · ${selectedExpression} 立绘并同步引用`);
  };
  const relinkPortrait = async () => {
    if (!portraitId) return;
    setRelinkingAssetId(portraitId);
    try {
      const replacement = await replaceAssetFile(portraitId);
      if (!replacement) return;
      if (!supportedImage(replacement.path || replacement.name)) {
        notify('选择的文件不是支持的立绘格式', 'error');
        return;
      }
      commit((current) => {
        const existing = current.assets.find((asset) => asset.id === portraitId);
        const nextAsset = { ...existing, ...replacement, id: portraitId, kind: 'character', forceBundle: existing?.forceBundle } as Asset;
        return {
          ...current,
          assets: existing
            ? current.assets.map((asset) => asset.id === portraitId ? nextAsset : asset)
            : [...current.assets, nextAsset],
        };
      }, `重新定位 ${selected?.name ?? '角色'} · ${selectedExpression} 立绘`);
      notify('立绘素材已恢复，所有引用已刷新', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setRelinkingAssetId(undefined);
    }
  };
  const patchCrop = (patch: Partial<PortraitCrop>) => { if (!selected) return; patchCharacter({ portraitCrops: { ...(selected.portraitCrops ?? {}), [selectedExpression]: { ...currentCrop, ...patch } } }, '调整头像裁剪'); };
  const copyCrop = (source: string) => { if (!selected) return; const crop = selected.portraitCrops?.[source] ?? { x: 0, y: 0, zoom: 1 }; patchCharacter({ portraitCrops: { ...(selected.portraitCrops ?? {}), [selectedExpression]: crop } }, '套用头像裁剪'); };
  const setDimension = (axis: 'width' | 'height', raw: string, unit: 'px' | '%') => {
    if (!selected) return;
    const dimension = raw === '' ? { unit } : { value: Math.max(0, Number(raw)), unit };
    const patch: Record<string, unknown> = { [axis === 'width' ? 'portraitWidth' : 'portraitHeight']: dimension };
    const image = previewImageRef.current;
    if (selected.keepAspectRatio && image?.naturalWidth && image.naturalHeight && raw !== '') {
      const ratio = image.naturalWidth / image.naturalHeight; const value = Number(raw);
      patch[axis === 'width' ? 'portraitHeight' : 'portraitWidth'] = { value: Number((axis === 'width' ? value / ratio : value * ratio).toFixed(1)), unit };
    }
    patchCharacter(patch, '修改立绘尺寸');
  };

  const addScheme = async () => {
    if (!selected) return;
    const name = await requestText({ title: '新增显示名方案', message: '方案只改变玩家看到的名牌和历史记录。', placeholder: '例如：神秘店长', confirmText: '创建方案' });
    if (!name) return;
    const scheme: DisplayNameScheme = { id: makeId('display-name'), name, kind: 'fixed', value: name };
    patchCharacter({ displayNameSchemes: [...(selected.displayNameSchemes ?? []), scheme] }, '新增显示名方案');
  };
  const patchScheme = (id: string, patch: Partial<DisplayNameScheme>) => patchCharacter({ displayNameSchemes: (selected?.displayNameSchemes ?? []).map((scheme) => scheme.id === id ? { ...scheme, ...patch } : scheme) }, '更新显示名方案');
  const schemeReferenceCount = (id: string) => selected ? Object.values(project.scripts).flat().filter((block) => block.type === 'dialogue' && block.speaker === selected.name && block.displayNameSchemeId === id).length : 0;
  const removeScheme = async (scheme: DisplayNameScheme) => {
    const references = schemeReferenceCount(scheme.id);
    if (references) return notify(`显示名方案“${scheme.name}”仍被 ${references} 条对白使用`, 'error');
    if (!await requestConfirm({ title: '删除显示名方案', message: `删除“${scheme.name}”？`, confirmText: '删除', danger: true })) return;
    patchCharacter({ displayNameSchemes: selected?.displayNameSchemes?.filter((item) => item.id !== scheme.id) }, '删除显示名方案');
  };
  const addAttribute = async () => { if (!selected) return; const key = await requestText({ title: '新增角色属性', placeholder: '属性名，例如：头衔', confirmText: '添加属性' }); if (!key || key in (selected.attributes ?? {})) return; patchCharacter({ attributes: { ...(selected.attributes ?? {}), [key]: '' } }, '新增角色属性'); };
  const patchAttribute = (oldKey: string, key: string, value: string) => {
    if (!selected || !key) return;
    const attributes = { ...(selected.attributes ?? {}) }; delete attributes[oldKey]; attributes[key] = value;
    const schemes = (selected.displayNameSchemes ?? []).map((scheme) => scheme.kind === 'attribute' && scheme.value === oldKey ? { ...scheme, value: key } : scheme);
    patchCharacter({ attributes, displayNameSchemes: schemes }, oldKey === key ? '更新角色属性' : `迁移角色属性 ${oldKey} → ${key}`);
  };
  const removeAttribute = (key: string) => {
    const references = selected?.displayNameSchemes?.filter((scheme) => scheme.kind === 'attribute' && scheme.value === key).length ?? 0;
    if (references) return notify(`属性“${key}”仍被 ${references} 个显示名方案使用`, 'error');
    const attributes = { ...(selected?.attributes ?? {}) }; delete attributes[key]; patchCharacter({ attributes }, '删除角色属性');
  };
  const addOverlay = () => patchCharacter({ overlays: [...(selected?.overlays ?? []), { id: makeId('overlay'), name: `覆盖图层 ${(selected?.overlays?.length ?? 0) + 1}`, opacity: 1, layer: (selected?.overlays?.length ?? 0) + 1 }] }, '新增图形覆盖');
  const patchOverlay = (id: string, patch: Record<string, unknown>) => patchCharacter({ overlays: (selected?.overlays ?? []).map((overlay) => overlay.id === id ? { ...overlay, ...patch } : overlay) }, '更新图形覆盖');
  const overlayIssue = (assetId?: string) => {
    if (!assetId) return '未选择素材';
    const asset = project.assets.find((item) => item.id === assetId);
    if (!asset) return '素材引用丢失';
    if (!supportedImage(asset.path || asset.name)) return '格式不兼容';
    if (assetStatuses[assetId]?.exists === false) return '源文件缺失';
    if (!asset.uri) return '无法访问素材';
    if (failedAssetIds.has(assetId)) return '图片损坏或无法解码';
    return undefined;
  };
  const relinkOverlay = async (assetId: string, name: string) => {
    setRelinkingAssetId(assetId);
    try {
      const replacement = await replaceAssetFile(assetId);
      if (!replacement) return;
      if (!supportedImage(replacement.path || replacement.name)) return notify('请选择 PNG、JPG、JPEG 或 WebP 图片', 'error');
      commit((current) => {
        const existing = current.assets.find((asset) => asset.id === assetId);
        const next = { ...existing, ...replacement, id: assetId, kind: 'character', forceBundle: existing?.forceBundle } as Asset;
        return { ...current, assets: existing ? current.assets.map((asset) => asset.id === assetId ? next : asset) : [...current.assets, next] };
      }, `重新定位覆盖图层 ${name}`);
      notify('角色覆盖图层已恢复', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); } finally { setRelinkingAssetId(undefined); }
  };

  return <div className="character-manager">
    <header className="character-manager-header"><div><h1>角色管理</h1><p>主名称、玩家显示名、独立差分立绘、头像裁剪与图层覆盖</p></div><button className="button ghost" onClick={() => void chooseImages('new')}><FileUp />批量导入立绘</button><button className="button primary" onClick={() => void createEmpty()}><UserPlus />新建角色</button></header>
    <div className="character-workspace">
      <aside className={`character-list-panel ${dropActive ? 'drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDropActive(true); }} onDragLeave={() => setDropActive(false)} onDrop={(event) => { event.preventDefault(); setDropActive(false); void handleFiles(event.dataTransfer.files, 'new'); }}>
        <div className="character-list-toolbar"><div className="asset-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色" /></div><button className="icon-button" title="新建角色" onClick={() => void createEmpty()}><Plus /></button></div>
        <div className="character-list">{shownCharacters.map((character) => { const defaultAsset = project.assets.find((asset) => asset.id === character.portraits?.[character.expressions[0]]); return <button className={character.id === selected?.id ? 'active' : ''} key={character.id} onClick={() => { const expression = character.expressions[0] ?? '默认'; setSelectedId(character.id); setSelectedExpression(expression); setSelectedExpressions(new Set([expression])); }}><span className="character-list-thumb">{defaultAsset?.uri ? <img src={defaultAsset.uri} alt={character.name} /> : <Users />}</span><span><strong>{character.name}</strong><small>{character.expressions.length} 个表情 · {character.displayNameSchemes?.length ?? 0} 个显示名</small></span><i style={{ background: character.color }} /><ChevronRight /></button>; })}</div>
        <div className="character-drop-hint"><Upload /><span>拖入多张图片创建角色</span><small>支持角色名_表情名.png</small></div>
      </aside>
      {selected ? <main className="character-expression-panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files, 'expressions'); }}>
        <div className="character-preview-toolbar"><div><strong>{selected.name}</strong><small>{selectedExpression} · {portraitAsset?.name ?? '未配置立绘'}</small></div><span className={`portrait-health-badge ${portraitHealth.tone}`}>{portraitHealth.tone === 'ready' ? <CheckCircle2 /> : portraitHealth.tone === 'checking' ? <LoaderCircle className="spinning" /> : portraitHealth.tone === 'empty' ? <FileImage /> : <AlertTriangle />}{portraitHealth.label}</span>{selectedExpressions.size > 1 && <button className="button danger" onClick={() => void removeSelectedExpressions()}><Trash2 />删除 {selectedExpressions.size} 项</button>}<button className="button ghost" onClick={() => void chooseImages('expressions')}><Upload />上传立绘</button><button className="button primary" onClick={() => void addExpression()}><Plus />新增表情</button></div>
        <div className="character-main-preview">{portraitAsset?.uri && portraitId && !failedAssetIds.has(portraitId) && supportedImage(portraitAsset.path || portraitAsset.name) ? <div className="character-preview-composite"><img ref={previewImageRef} src={portraitAsset.uri} alt={`${selected.name} · ${selectedExpression}`} onLoad={() => markAssetLoaded(portraitId)} onError={() => markAssetFailed(portraitId)} style={{ transform: `scale(${selected.defaultScale ?? 1})`, width: selected.portraitWidth?.value === undefined ? undefined : `${selected.portraitWidth.value}${selected.portraitWidth.unit}`, height: selected.portraitHeight?.value === undefined ? undefined : `${selected.portraitHeight.value}${selected.portraitHeight.unit}` }} />{selected.overlays?.map((overlay) => { const asset = project.assets.find((item) => item.id === overlay.assetId); return asset?.uri ? <img className="manager-character-overlay" key={overlay.id} src={asset.uri} alt={overlay.name} style={{ opacity: overlay.opacity, zIndex: overlay.layer }} /> : null; })}</div> : <div className={`character-preview-empty ${portraitHealth.tone === 'error' ? 'error' : ''}`}>{portraitHealth.tone === 'error' ? <AlertTriangle /> : <Image />}<strong>{portraitHealth.label}</strong><span>{portraitHealth.detail}</span>{portraitHealth.canRelink && <button className="button primary" disabled={relinkingAssetId === portraitId} onClick={() => void relinkPortrait()}>{relinkingAssetId === portraitId ? <LoaderCircle className="spinning" /> : <LocateFixed />}{relinkingAssetId === portraitId ? '正在替换' : '重新定位素材'}</button>}</div>}<span className="character-preview-scale">{dimensionText(selected.portraitWidth)} × {dimensionText(selected.portraitHeight)}</span></div>
        <section className="expression-gallery"><header><strong>差分表情</strong><span>{selectedExpressions.size > 1 ? `已选择 ${selectedExpressions.size} 个` : `${selected.expressions.length} 个`}</span></header><div>{selected.expressions.map((expression) => {
          const expressionAssetId = selected.portraits?.[expression];
          const asset = project.assets.find((item) => item.id === expressionAssetId);
          const crop = selected.portraitCrops?.[expression] ?? { x: 0, y: 0, zoom: 1 };
          const issue = !expressionAssetId
            ? '未配置'
            : !asset
              ? '引用丢失'
              : !supportedImage(asset.path || asset.name)
                ? '格式不兼容'
                : assetStatuses[asset.id]?.exists === false
                  ? '文件缺失'
                  : failedAssetIds.has(asset.id)
                    ? '加载失败'
                    : undefined;
          return <button draggable className={`${selectedExpressions.has(expression) ? 'active' : ''} ${issue ? 'missing' : ''}`} key={expression} onClick={(event) => selectExpression(expression, event)} onDoubleClick={() => { setRenamingExpression(expression); setRenameDraft(expression); }} onDragStart={(event) => { setDraggedExpression(expression); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderExpressions(expression); }}><span>{asset?.uri && !issue ? <img src={asset.uri} alt={expression} onLoad={() => markAssetLoaded(asset.id)} onError={() => markAssetFailed(asset.id)} style={{ transform: `translate(${crop.x}px, ${crop.y}px) scale(${crop.zoom})` }} /> : issue && expressionAssetId ? <AlertTriangle /> : <FileImage />}</span>{renamingExpression === expression ? <input className="expression-inline-name" autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onBlur={finishExpressionRename} onKeyDown={(event) => { if (event.key === 'Enter') finishExpressionRename(); if (event.key === 'Escape') setRenamingExpression(null); }} onClick={(event) => event.stopPropagation()} /> : <strong><GripVertical />{expression}</strong>}<small className={issue && expressionAssetId ? 'error' : ''}>{issue ?? asset?.name}</small></button>;
        })}<button className="expression-add-tile" onClick={() => void addExpression()}><Plus /><strong>新增表情</strong></button></div></section>
      </main> : <main className="character-expression-panel empty"><Users /><strong>还没有角色</strong><button className="button primary" onClick={() => void createEmpty()}>创建第一个角色</button></main>}
      {selected && <aside className="character-property-panel"><div className="property-panel-title"><div><SlidersHorizontal /><strong>角色详情</strong></div><button className="icon-button" title="删除角色" onClick={() => void removeCharacter()}><Trash2 /></button></div><div className="character-property-scroll">
        <section><h2>基本信息</h2><label>角色主名称<input key={selected.id} defaultValue={selected.name} onBlur={(event) => renameCharacter(event.target.value.trim())} /></label><label>主题颜色<div className="color-field"><input type="color" value={selected.color} onChange={(event) => patchCharacter({ color: event.target.value }, '修改主题颜色')} /><code>{selected.color}</code></div></label><label>角色说明<textarea key={`${selected.id}-description`} defaultValue={selected.description ?? ''} onBlur={(event) => patchCharacter({ description: event.target.value }, '更新角色说明')} /></label></section>
        <section><div className="property-section-heading"><h2>显示名方案</h2><button className="icon-button" title="新增显示名方案" onClick={() => void addScheme()}><Plus /></button></div><div className="display-name-schemes">{(selected.displayNameSchemes ?? []).map((scheme) => <article key={scheme.id}><div><input aria-label="方案名称" value={scheme.name} onChange={(event) => patchScheme(scheme.id, { name: event.target.value })} /><button className="icon-button" title="删除显示名方案" disabled={Boolean(schemeReferenceCount(scheme.id))} onClick={() => void removeScheme(scheme)}><Trash2 /></button></div><Select aria-label="显示名来源" value={scheme.kind} onChange={(value) => { const kind = value as DisplayNameSchemeKind; patchScheme(scheme.id, { kind, value: kind === 'fixed' ? scheme.name : '' }); }}><option value="fixed">固定文字</option><option value="variable">剧情变量</option><option value="attribute">角色属性</option></Select>{scheme.kind === 'fixed' ? <input aria-label="固定显示文字" value={scheme.value} placeholder="玩家看到的名字" onChange={(event) => patchScheme(scheme.id, { value: event.target.value })} /> : <Select aria-label={scheme.kind === 'variable' ? '剧情变量' : '角色属性'} value={scheme.value} onChange={(value) => patchScheme(scheme.id, { value })}><option value="">请选择</option>{(scheme.kind === 'variable' ? textVariables : Object.keys(selected.attributes ?? {})).map((name) => <option key={name} value={name}>{name}</option>)}</Select>}<small>{schemeReferenceCount(scheme.id)} 条对白引用{scheme.kind !== 'fixed' && ' · 空值时回退主名称'}</small></article>)}{!selected.displayNameSchemes?.length && <div className="property-empty">暂无方案，对白默认显示角色主名称</div>}</div></section>
        <section><h2>立绘尺寸</h2><label className="checkbox-field"><Checkbox checked={selected.keepAspectRatio ?? true} onChange={(checked) => patchCharacter({ keepAspectRatio: checked }, '设置保持原始比例')} />保持原始比例</label><div className="dimension-grid">{(['width', 'height'] as const).map((axis) => { const value = axis === 'width' ? selected.portraitWidth : selected.portraitHeight; return <label key={axis}>{axis === 'width' ? '宽度' : '高度'}<div><input type="number" min="0" value={value?.value ?? ''} placeholder="自动" onChange={(event) => setDimension(axis, event.target.value, value?.unit ?? 'px')} /><Select value={value?.unit ?? 'px'} onChange={(unit) => setDimension(axis, value?.value === undefined ? '' : String(value.value), unit as 'px' | '%')}><option value="px">px</option><option value="%">%</option></Select></div></label>; })}</div><button className="button ghost full" onClick={() => patchCharacter({ portraitWidth: undefined, portraitHeight: undefined }, '自适应立绘尺寸')}>自适应</button><div className="property-two-column"><label>默认站位<Select value={selected.defaultPosition ?? 'center'} onChange={(value) => patchCharacter({ defaultPosition: value as CharacterPosition }, '修改默认站位')}><option value="farLeft">最左</option><option value="left">左侧</option><option value="center">中央</option><option value="right">右侧</option><option value="farRight">最右</option></Select></label><label>默认层级<input type="number" value={selected.defaultLayer ?? 0} onChange={(event) => patchCharacter({ defaultLayer: Number(event.target.value) }, '修改默认层级')} /></label></div></section>
        <section><h2>当前表情资源</h2><label>立绘素材<Select value={portraitId ?? ''} onChange={(value) => setPortrait(value)}><option value="">未配置</option>{imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</Select></label><div className={`portrait-health-row ${portraitHealth.tone}`}>{portraitHealth.tone === 'ready' ? <CheckCircle2 /> : portraitHealth.tone === 'checking' ? <LoaderCircle className="spinning" /> : portraitHealth.tone === 'empty' ? <FileImage /> : <AlertTriangle />}<span><strong>{portraitHealth.label}</strong><small>{portraitHealth.detail}</small></span>{portraitHealth.canRelink && <button className="icon-button" title="重新定位立绘素材" disabled={relinkingAssetId === portraitId} onClick={() => void relinkPortrait()}><LocateFixed /></button>}</div><div className="resource-reference"><span>{portraitAsset?.path ?? portraitId ?? '没有资源路径'}</span><small>{dialogueReferences.length} 条对白使用此表情</small></div><div className="crop-editor"><div className="property-section-heading"><h2><Crop />缩略图裁剪</h2><Select title="套用其他表情裁剪" value="" onChange={(value) => value && copyCrop(value)}><option value="">套用其他表情</option>{selected.expressions.filter((expression) => expression !== selectedExpression).map((expression) => <option key={expression} value={expression}>{expression}</option>)}</Select></div><label>水平位置<Slider ariaLabel="水平位置" min={-50} max={50} value={currentCrop.x} onChange={(value) => patchCrop({ x: value })} /></label><label>垂直位置<Slider ariaLabel="垂直位置" min={-50} max={50} value={currentCrop.y} onChange={(value) => patchCrop({ y: value })} /></label><label>头像缩放 <span>{Math.round(currentCrop.zoom * 100)}%</span><Slider ariaLabel="头像缩放" min={1} max={3} step={0.05} value={currentCrop.zoom} onChange={(value) => patchCrop({ zoom: value })} /></label></div><button className="button danger full" disabled={selected.expressions.length <= 1 || Boolean(expressionReferenceCount(selectedExpression))} onClick={() => void removeSelectedExpressions()}><Trash2 />删除所选表情</button></section>
        <section><div className="property-section-heading"><h2><Layers3 />图形覆盖</h2><button className="icon-button" title="新增覆盖图层" onClick={addOverlay}><Plus /></button></div><div className="character-overlays">{(selected.overlays ?? []).map((overlay) => { const issue = overlayIssue(overlay.assetId); return <article className={issue && overlay.assetId ? 'asset-error' : ''} key={overlay.id}><div><input aria-label="覆盖图层名称" value={overlay.name} onChange={(event) => patchOverlay(overlay.id, { name: event.target.value })} /><button className="icon-button" title="删除覆盖图层" onClick={() => patchCharacter({ overlays: selected.overlays?.filter((item) => item.id !== overlay.id) }, '删除图形覆盖')}><X /></button></div><Select aria-label="覆盖图层素材" value={overlay.assetId ?? ''} onChange={(value) => patchOverlay(overlay.id, { assetId: value || undefined })}><option value="">选择覆盖素材</option>{imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</Select><div className={`overlay-health ${issue ? 'error' : 'ready'}`}>{issue ? <AlertTriangle /> : <CheckCircle2 />}<span>{issue ?? '素材已就绪'}</span>{overlay.assetId && <button className="icon-button" title="重新定位覆盖图层" disabled={relinkingAssetId === overlay.assetId} onClick={() => void relinkOverlay(overlay.assetId!, overlay.name)}>{relinkingAssetId === overlay.assetId ? <LoaderCircle className="spinning" /> : <LocateFixed />}</button>}</div><div className="property-two-column"><label>透明度<input type="number" min="0" max="1" step=".1" value={overlay.opacity} onChange={(event) => patchOverlay(overlay.id, { opacity: Number(event.target.value) })} /></label><label>层级<input type="number" value={overlay.layer} onChange={(event) => patchOverlay(overlay.id, { layer: Number(event.target.value) })} /></label></div><label className="checkbox-field"><Checkbox checked={overlay.overrideSize ?? false} onChange={(checked) => patchOverlay(overlay.id, { overrideSize: checked })} />覆盖默认尺寸</label>{overlay.overrideSize && <div className="dimension-grid"><label>宽度<input type="number" value={overlay.width?.value ?? ''} onChange={(event) => patchOverlay(overlay.id, { width: { value: event.target.value === '' ? undefined : Number(event.target.value), unit: overlay.width?.unit ?? 'px' } })} /></label><label>高度<input type="number" value={overlay.height?.value ?? ''} onChange={(event) => patchOverlay(overlay.id, { height: { value: event.target.value === '' ? undefined : Number(event.target.value), unit: overlay.height?.unit ?? 'px' } })} /></label></div>}</article>; })}{!selected.overlays?.length && <div className="property-empty">暂无覆盖图层</div>}</div></section>
        <section><div className="property-section-heading"><h2>角色属性覆盖</h2><button className="icon-button" title="新增属性" onClick={() => void addAttribute()}><Plus /></button></div><div className="character-attributes">{Object.entries(selected.attributes ?? {}).map(([key, value]) => <div key={key}><input defaultValue={key} onBlur={(event) => patchAttribute(key, event.target.value.trim(), value)} /><input value={value} onChange={(event) => patchAttribute(key, key, event.target.value)} /><button title="删除属性" onClick={() => removeAttribute(key)}><X /></button></div>)}{!Object.keys(selected.attributes ?? {}).length && <small>暂无属性覆盖。可建立姓名、头衔等属性。</small>}</div></section>
        <section><h2>引用信息</h2><div className="role-reference-summary"><strong>{allRoleReferences}</strong><span>处剧本引用</span></div></section>
      </div></aside>}
    </div>
    <input ref={fileInputRef} hidden type="file" accept=".png,.jpg,.jpeg,.webp" multiple onChange={(event) => { if (event.target.files?.length) void handleFiles(event.target.files, fileModeRef.current); event.target.value = ''; }} />
    {batchDraft && <div className="modal-backdrop character-import-backdrop" role="presentation" onClick={() => setBatchDraft(null)}><section className="modal wide character-import-dialog" role="dialog" aria-modal="true" aria-labelledby="character-import-title" onClick={(event) => event.stopPropagation()}><header className="modal-header"><div><strong id="character-import-title">创建新角色</strong><small>已根据文件名识别角色与差分表情</small></div><button className="icon-button" title="关闭" onClick={() => setBatchDraft(null)}><X /></button></header><div className="modal-body"><label className="batch-role-name">角色名<input value={batchDraft.roleName} onChange={(event) => setBatchDraft({ ...batchDraft, roleName: event.target.value })} /></label><div className="batch-portrait-list"><header><span>默认</span><span>图片</span><span>表情名</span></header><RadioGroup className="batch-portrait-group" value={batchDraft.defaultId} onChange={(value) => setBatchDraft({ ...batchDraft, defaultId: value })}>{batchDraft.portraits.map((item, index) => <article key={item.asset.id}><Radio aria-label={`设为默认立绘 ${item.asset.name}`} value={item.asset.id} /><span className="batch-portrait-thumb">{item.asset.uri ? <img src={item.asset.uri} alt={item.asset.name} /> : <FileImage />}</span><div><strong>{item.asset.name}</strong><small>{item.asset.path}</small></div><label><Pencil /><input aria-label={`${item.asset.name} 表情名`} value={item.expression} onChange={(event) => setBatchDraft({ ...batchDraft, portraits: batchDraft.portraits.map((portrait, portraitIndex) => portraitIndex === index ? { ...portrait, expression: event.target.value } : portrait) })} /></label></article>)}</RadioGroup></div><p className="batch-import-note">支持命名格式：角色名_表情名.png。默认立绘会排在角色表情列表首位。</p></div><footer className="modal-footer"><button className="button ghost" onClick={() => setBatchDraft(null)}>取消</button><button className="button primary" disabled={!batchDraft.roleName.trim() || batchDraft.portraits.some((item) => !item.expression.trim())} onClick={createBatch}>创建角色</button></footer></section></div>}
  </div>;
}
