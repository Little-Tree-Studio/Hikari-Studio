import { ChevronDown } from 'lucide-react';
import { Profiler, memo, useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { recordComponentRender } from '../../performance/renderProfiler';
import type { Asset, Character, DialogueBlock, StoryBlockPatch } from '../../types';

interface DialogueStoryCardProps {
  index: number;
  block: DialogueBlock;
  characters: Character[];
  selected: boolean;
  voiceAsset?: Asset;
  onChange: (index: number, patch: StoryBlockPatch) => void;
}

interface DialoguePickerOption {
  value: string;
  label: string;
}

type DialoguePickerKind = 'speaker' | 'display-name' | 'expression';
type DialoguePickerDispatch = Dispatch<SetStateAction<DialoguePickerKind | null>>;

interface DialogueOptionPickerProps {
  pickerId: DialoguePickerKind;
  label: string;
  value: string;
  options: readonly DialoguePickerOption[];
  open: boolean;
  setOpenPicker: DialoguePickerDispatch;
  onSelect: (value: string) => void;
}

function DialogueOptionPicker({ pickerId, label, value, options, open, setOpenPicker, onSelect }: DialogueOptionPickerProps) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? '未设置';
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpenPicker(null);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setOpenPicker(pickerId);
    }
  };
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      const picker = event.currentTarget.parentElement;
      setOpenPicker(null);
      window.requestAnimationFrame(() => picker?.querySelector<HTMLButtonElement>('.dialogue-picker-trigger')?.focus());
    }
  };

  return <div className={`dialogue-picker ${open ? 'open' : ''}`} data-dialogue-picker={pickerId}>
    <button
      type="button"
      className="dialogue-picker-trigger"
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      title={`${label}：${selectedLabel}`}
      onClick={(event) => { event.stopPropagation(); setOpenPicker(open ? null : pickerId); }}
      onKeyDown={handleTriggerKeyDown}
    >
      <span>{selectedLabel}</span><ChevronDown />
    </button>
    {open && <div className="dialogue-picker-menu" role="listbox" aria-label={`${label}选项`} onClick={(event) => event.stopPropagation()} onKeyDown={handleMenuKeyDown}>
      {options.length
        ? options.map((option) => <button
          type="button"
          role="option"
          aria-selected={option.value === value}
          className={option.value === value ? 'selected' : ''}
          key={option.value}
          onClick={() => { setOpenPicker(null); onSelect(option.value); }}
        >{option.label}</button>)
        : <span className="dialogue-picker-empty">无可用选项</span>}
    </div>}
  </div>;
}

interface DialogueSpeakerControlsProps {
  index: number;
  speaker: string;
  displayNameSchemeId: string;
  characters: Character[];
  openPicker: DialoguePickerKind | null;
  setOpenPicker: DialoguePickerDispatch;
  onChange: DialogueStoryCardProps['onChange'];
}

const DialogueSpeakerControls = memo(function DialogueSpeakerControls({ index, speaker, displayNameSchemeId, characters, openPicker, setOpenPicker, onChange }: DialogueSpeakerControlsProps) {
  const character = characters.find((item) => item.name === speaker);
  const speakerOptions = characters.map((item) => ({ value: item.name, label: item.name }));
  const displayNameOptions = [
    { value: '', label: '主名称' },
    ...(character?.displayNameSchemes ?? []).map((scheme) => ({ value: scheme.id, label: scheme.name })),
  ];

  return <Profiler id="dialogue-region:speaker" onRender={recordComponentRender}>
    <>
      <DialogueOptionPicker
        pickerId="speaker"
        label="对白角色"
        value={speaker}
        options={speakerOptions}
        open={openPicker === 'speaker'}
        setOpenPicker={setOpenPicker}
        onSelect={(nextSpeaker) => {
          const nextCharacter = characters.find((item) => item.name === nextSpeaker);
          onChange(index, { speaker: nextSpeaker, expression: nextCharacter?.expressions[0] ?? '默认', displayNameSchemeId: undefined });
        }}
      />
      <DialogueOptionPicker
        pickerId="display-name"
        label="玩家显示名"
        value={displayNameSchemeId}
        options={displayNameOptions}
        open={openPicker === 'display-name'}
        setOpenPicker={setOpenPicker}
        onSelect={(nextSchemeId) => onChange(index, { displayNameSchemeId: nextSchemeId || undefined })}
      />
    </>
  </Profiler>;
});

interface DialogueExpressionControlProps {
  index: number;
  expression: string;
  character?: Character;
  openPicker: DialoguePickerKind | null;
  setOpenPicker: DialoguePickerDispatch;
  onChange: DialogueStoryCardProps['onChange'];
}

const DialogueExpressionControl = memo(function DialogueExpressionControl({ index, expression, character, openPicker, setOpenPicker, onChange }: DialogueExpressionControlProps) {
  const options = (character?.expressions ?? []).map((item) => ({ value: item, label: item }));
  return <Profiler id="dialogue-region:expression" onRender={recordComponentRender}>
    <DialogueOptionPicker pickerId="expression" label="对白表情" value={expression || character?.expressions[0] || ''} options={options} open={openPicker === 'expression'} setOpenPicker={setOpenPicker} onSelect={(nextExpression) => onChange(index, { expression: nextExpression })} />
  </Profiler>;
});

interface DialogueBodyProps {
  index: number;
  text: string;
  voiceId: string;
  voiceAsset?: Asset;
  onChange: DialogueStoryCardProps['onChange'];
}

const DialogueBody = memo(function DialogueBody({ index, text, voiceId, voiceAsset, onChange }: DialogueBodyProps) {
  return <Profiler id="dialogue-region:body" onRender={recordComponentRender}>
    <div>
      <div className="block-text" contentEditable suppressContentEditableWarning onBlur={(event) => { const nextText = event.currentTarget.textContent ?? ''; if (nextText !== text) onChange(index, { text: nextText }); }}>{text}</div>
      <div className="block-tags">{voiceId && <span className="tag">语音 · {voiceAsset?.name ?? voiceId}</span>}</div>
    </div>
  </Profiler>;
});

interface DialogueEditorProps {
  index: number;
  speaker: string;
  displayNameSchemeId: string;
  expression: string;
  text: string;
  voiceId: string;
  characters: Character[];
  voiceAsset?: Asset;
  onChange: DialogueStoryCardProps['onChange'];
}

const DialogueEditor = memo(function DialogueEditor({ index, speaker, displayNameSchemeId, expression, text, voiceId, characters, voiceAsset, onChange }: DialogueEditorProps) {
  const [openPicker, setOpenPicker] = useState<DialoguePickerKind | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const character = speaker ? characters.find((item) => item.name === speaker) : undefined;

  useEffect(() => {
    if (!openPicker) return;
    const frame = window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('.dialogue-picker.open [role="option"]')?.focus());
    const close = (event: PointerEvent) => {
      const picker = rootRef.current?.querySelector('.dialogue-picker.open');
      if (!picker?.contains(event.target as Node)) setOpenPicker(null);
    };
    window.addEventListener('pointerdown', close);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', close);
    };
  }, [openPicker]);

  return <div className="dialogue-line" ref={rootRef}>
    <div className="dialogue-identity">
      <DialogueSpeakerControls index={index} speaker={speaker} displayNameSchemeId={displayNameSchemeId} characters={characters} openPicker={openPicker} setOpenPicker={setOpenPicker} onChange={onChange} />
      <DialogueExpressionControl index={index} expression={expression} character={character} openPicker={openPicker} setOpenPicker={setOpenPicker} onChange={onChange} />
    </div>
    <DialogueBody index={index} text={text} voiceId={voiceId} voiceAsset={voiceAsset} onChange={onChange} />
  </div>;
});

export const DialogueStoryCard = memo(function DialogueStoryCard({ index, block, characters, selected, voiceAsset, onChange }: DialogueStoryCardProps) {
  const speaker = block.speaker ?? '';
  const expression = block.expression ?? '';
  const text = block.text ?? '';
  const voiceId = block.voice ?? '';

  if (!selected) return <div className="dialogue-line dialogue-summary">
    <div className="dialogue-identity"><strong>{speaker || '未选择角色'}</strong><small>{expression || '默认'}</small></div>
    <div><div className="block-text">{text}</div><div className="block-tags">{voiceId && <span className="tag">语音 · {voiceAsset?.name ?? voiceId}</span>}</div></div>
  </div>;

  return <DialogueEditor index={index} speaker={speaker} displayNameSchemeId={block.displayNameSchemeId ?? ''} expression={expression} text={text} voiceId={voiceId} characters={characters} voiceAsset={voiceAsset} onChange={onChange} />;
});
