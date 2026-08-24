import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { getEditorAppearance, saveEditorAppearance } from '../api';
import type { EditorAppearance, EditorThemeId } from '../types';

export const DEFAULT_EDITOR_APPEARANCE: EditorAppearance = { version: 1, mode: 'system', themeId: 'slide-light', motion: 'system', cornerStyle: 'soft' };

export interface EditorThemeDefinition {
  id: EditorThemeId;
  name: string;
  description: string;
  dark: boolean;
  preview: [string, string, string];
}

export const EDITOR_THEMES: EditorThemeDefinition[] = [
  { id: 'slide-light', name: 'Slide Light', description: '清晰明亮的默认创作环境', dark: false, preview: ['#f3f6f7', '#ffffff', '#187c6b'] },
  { id: 'graphite', name: 'Graphite', description: '专注预览与长时间工作的深色主题', dark: true, preview: ['#151a1d', '#20272b', '#45bda8'] },
  { id: 'sakura-studio', name: 'Sakura Studio', description: '柔和中性底色与珊瑚强调色', dark: false, preview: ['#f7f4f5', '#ffffff', '#c45f72'] },
  { id: 'high-contrast', name: 'High Contrast', description: '清晰边界与高可读性焦点状态', dark: true, preview: ['#080a0b', '#111416', '#5ee4c8'] },
];

const THEME_IDS = new Set(EDITOR_THEMES.map((theme) => theme.id));

export function normalizeEditorAppearance(value?: Partial<EditorAppearance> | null): EditorAppearance {
  const accentColor = typeof value?.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.accentColor) ? value.accentColor.toLowerCase() : undefined;
  return {
    version: 1,
    mode: value?.mode === 'fixed' ? 'fixed' : 'system',
    themeId: value?.themeId && THEME_IDS.has(value.themeId) ? value.themeId : 'slide-light',
    motion: value?.motion === 'full' || value?.motion === 'reduced' ? value.motion : 'system',
    cornerStyle: value?.cornerStyle === 'sharp' || value?.cornerStyle === 'rounded' ? value.cornerStyle : 'soft',
    ...(accentColor ? { accentColor } : {}),
  };
}

export function resolveEditorTheme(appearance: EditorAppearance, systemDark: boolean): EditorThemeId {
  return appearance.mode === 'system' ? (systemDark ? 'graphite' : 'slide-light') : appearance.themeId;
}

export function resolveReducedMotion(appearance: EditorAppearance, systemReduced: boolean): boolean {
  return appearance.motion === 'reduced' || (appearance.motion === 'system' && systemReduced);
}

function hexToRgb(hex: string) {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

function mix(hex: string, target: string, amount: number) {
  const source = hexToRgb(hex);
  const destination = hexToRgb(target);
  return `#${source.map((channel, index) => Math.round(channel + (destination[index] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

export function accentVariables(accent: string, dark: boolean): CSSProperties {
  return {
    '--accent': accent,
    '--accent-hover': mix(accent, dark ? '#ffffff' : '#000000', dark ? .13 : .16),
    '--accent-strong': mix(accent, dark ? '#ffffff' : '#000000', dark ? .2 : .28),
    '--accent-soft': mix(accent, dark ? '#20272b' : '#ffffff', dark ? .76 : .86),
    '--focus-ring': `${accent}66`,
  } as CSSProperties;
}

interface EditorAppearanceContextValue {
  appearance: EditorAppearance;
  activeTheme: EditorThemeId;
  reducedMotion: boolean;
  updateAppearance: (appearance: EditorAppearance) => Promise<void>;
}

const EditorAppearanceContext = createContext<EditorAppearanceContextValue | null>(null);

export function EditorAppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(DEFAULT_EDITOR_APPEARANCE);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const activeTheme = resolveEditorTheme(appearance, systemDark);
  const reducedMotion = resolveReducedMotion(appearance, systemReduced);

  useEffect(() => {
    const stored = localStorage.getItem('slide-editor-appearance');
    if (stored) {
      try {
        setAppearance(normalizeEditorAppearance(JSON.parse(stored)));
        return;
      } catch {
        localStorage.removeItem('slide-editor-appearance');
      }
    }
    void getEditorAppearance().then((value) => {
      if (!value) return;
      const normalized = normalizeEditorAppearance(value);
      setAppearance(normalized);
      localStorage.setItem('slide-editor-appearance', JSON.stringify(normalized));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onDark = () => setSystemDark(darkQuery.matches);
    const onMotion = () => setSystemReduced(motionQuery.matches);
    darkQuery.addEventListener('change', onDark);
    motionQuery.addEventListener('change', onMotion);
    return () => { darkQuery.removeEventListener('change', onDark); motionQuery.removeEventListener('change', onMotion); };
  }, []);

  const activeDefinition = EDITOR_THEMES.find((theme) => theme.id === activeTheme)!;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.editorTheme = activeTheme;
    root.dataset.cornerStyle = appearance.cornerStyle || 'soft';
    root.dataset.motion = reducedMotion ? 'reduced' : 'full';
    root.style.colorScheme = activeDefinition.dark ? 'dark' : 'light';
    const defaults = EDITOR_THEMES.find((theme) => theme.id === activeTheme)!.preview[2];
    const variables = accentVariables(appearance.accentColor ?? defaults, activeDefinition.dark) as Record<string, string>;
    Object.entries(variables).forEach(([name, value]) => root.style.setProperty(name, value));
  }, [activeDefinition.dark, activeTheme, appearance.accentColor, appearance.cornerStyle, reducedMotion]);

  const updateAppearance = useCallback(async (next: EditorAppearance) => {
    const normalized = normalizeEditorAppearance(next);
    setAppearance(normalized);
    localStorage.setItem('slide-editor-appearance', JSON.stringify(normalized));
    await saveEditorAppearance(normalized);
  }, []);

  const value = useMemo(() => ({ appearance, activeTheme, reducedMotion, updateAppearance }), [appearance, activeTheme, reducedMotion, updateAppearance]);
  return <EditorAppearanceContext.Provider value={value}>{children}</EditorAppearanceContext.Provider>;
}

export function useEditorAppearance() {
  const value = useContext(EditorAppearanceContext);
  if (!value) throw new Error('useEditorAppearance must be used inside EditorAppearanceProvider');
  return value;
}
