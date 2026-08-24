import type { LanguageCode, LocalizedBlockText, Project, StoryBlock } from '../types';

export type { LanguageCode, LocalizedBlockText };

export const LANGUAGE_CATALOG: { code: LanguageCode; label: string }[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en-US', label: 'English' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'es-ES', label: 'Español' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'pt-BR', label: 'Português' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'th-TH', label: 'ไทย' },
  { code: 'vi-VN', label: 'Tiếng Việt' },
  { code: 'id-ID', label: 'Bahasa Indonesia' },
];

export function languageLabel(code: LanguageCode): string {
  return LANGUAGE_CATALOG.find((item) => item.code === code)?.label ?? code;
}

const LANGUAGE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,19}$/;

export function isValidLanguageCode(code: string): boolean {
  return LANGUAGE_CODE_PATTERN.test(code.trim());
}

export function projectLanguages(project: Project): LanguageCode[] {
  return project.locale?.languages?.length ? project.locale.languages : [project.locale?.default ?? 'zh-CN'];
}

export function defaultLanguage(project: Project): LanguageCode {
  return project.locale?.default ?? projectLanguages(project)[0];
}

export function translationKey(fragmentId: string, blockId: string): string {
  return `${fragmentId}::${blockId}`;
}

export type TextSlotKind = 'dialogue' | 'narration' | 'branchTitle' | 'branchOption';

export interface TextSlot {
  key: string;
  fragmentId: string;
  fragmentName: string;
  chapterName: string;
  blockId: string;
  blockIndex: number;
  kind: TextSlotKind;
  optionIndex?: number;
  baseText: string;
  speakerName?: string;
  baseVoice?: string;
}

export const TEXT_SLOT_KIND_LABELS: Record<TextSlotKind, string> = {
  dialogue: '对白',
  narration: '旁白',
  branchTitle: '分支标题',
  branchOption: '选项',
};

export function slotFieldLabel(kind: TextSlotKind): string {
  if (kind === 'dialogue') return 'text';
  if (kind === 'narration') return 'text';
  if (kind === 'branchTitle') return 'title';
  return 'options';
}

interface BlockLike {
  type?: string;
  text?: string;
  title?: string;
  speaker?: string;
  voice?: string;
  options?: { text: string }[];
}

export function collectTextSlots(project: Project): TextSlot[] {
  const slots: TextSlot[] = [];
  for (const chapter of project.chapters) {
    for (const fragment of chapter.fragments) {
      const blocks: BlockLike[] = project.scripts[fragment.id] ?? [];
      blocks.forEach((block: BlockLike, blockIndex: number) => {
        const base = {
          key: translationKey(fragment.id, String((block as StoryBlock).id ?? blockIndex)),
          fragmentId: fragment.id,
          fragmentName: fragment.name,
          chapterName: chapter.name,
          blockId: String((block as StoryBlock).id ?? blockIndex),
          blockIndex,
        };
        if (block.type === 'dialogue') {
          slots.push({ ...base, kind: 'dialogue', baseText: block.text ?? '', speakerName: block.speaker, baseVoice: block.voice });
        } else if (block.type === 'narration') {
          slots.push({ ...base, kind: 'narration', baseText: block.text ?? '' });
        } else if (block.type === 'branch') {
          slots.push({ ...base, kind: 'branchTitle', baseText: block.title ?? '' });
          (block.options ?? []).forEach((option, optionIndex) => {
            slots.push({ ...base, kind: 'branchOption', optionIndex, baseText: option?.text ?? '' });
          });
        }
      });
    }
  }
  return slots;
}

function localizedText(entry: LocalizedBlockText | undefined, slot: TextSlot): string | undefined {
  if (!entry) return undefined;
  if (slot.kind === 'dialogue' || slot.kind === 'narration') return entry.text;
  if (slot.kind === 'branchTitle') return entry.title;
  return entry.options?.[slot.optionIndex ?? 0];
}

export function slotTranslation(project: Project, language: LanguageCode, slot: TextSlot): string | undefined {
  const value = localizedText(project.translations?.[language]?.[slot.key], slot);
  return value === undefined ? undefined : String(value ?? '');
}

export function slotVoice(project: Project, language: LanguageCode, slot: TextSlot): string | undefined {
  return project.translations?.[language]?.[slot.key]?.voice;
}

export interface LanguageProgress {
  language: LanguageCode;
  filled: number;
  total: number;
  percent: number;
}

export function languageProgress(project: Project, language: LanguageCode, slots?: TextSlot[]): LanguageProgress {
  const allSlots = slots ?? collectTextSlots(project);
  const filled = allSlots.filter((slot) => (slotTranslation(project, language, slot) ?? '').trim() !== '').length;
  return { language, filled, total: allSlots.length, percent: allSlots.length ? Math.round((filled / allSlots.length) * 100) : 100 };
}

export function applyLanguage(project: Project, language?: LanguageCode): Project {
  const languages = project.locale?.languages ?? [];
  if (!language || !languages.includes(language) || language === project.locale?.default) return project;
  const table = project.translations?.[language];
  if (!table || !Object.keys(table).length) return project;
  const scripts: Project['scripts'] = {};
  for (const [fragmentId, blocks] of Object.entries(project.scripts)) {
    scripts[fragmentId] = blocks.map((block): StoryBlock => {
      const entry = table[translationKey(fragmentId, block.id)];
      if (!entry) return block;
      const next = { ...block } as StoryBlock & { text?: string; title?: string; speaker?: string; voice?: string };
      if (typeof entry.text === 'string' && entry.text) next.text = entry.text;
      if (typeof entry.title === 'string' && entry.title) next.title = entry.title;
      if (typeof entry.speaker === 'string' && entry.speaker) next.speaker = entry.speaker;
      if (entry.voice !== undefined) next.voice = entry.voice || undefined;
      if (Array.isArray(entry.options) && Array.isArray(next.options)) {
        next.options = next.options.map((option, index) => ({ ...option, text: entry.options?.[index]?.trim() ? entry.options[index] : option.text }));
      }
      return next;
    });
  }
  return { ...project, scripts };
}
