import type { CSSProperties } from 'react';
import type { GameUiTheme, GameUiThemePreset } from '../types';

export const DEFAULT_GAME_UI_THEME: GameUiTheme = {
  preset: 'modern',
  fontFamily: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "Microsoft YaHei", serif',
  dialogueFontSize: 20,
  dialogueTextColor: '#ffffff',
  dialogueGradientColor: '#000000',
  dialogueBottomOpacity: 0.97,
  dialogueTopOpacity: 0,
  dialogueHeight: 16.6667,
  speakerColor: '#e3c98f',
  speakerFontSize: 17,
  speakerWeight: 700,
  speakerStyle: 'accent',
  accentColor: '#c9ad74',
  buttonTextColor: '#ffffff',
  systemPanelColor: '#15171b',
  systemPanelOpacity: 0.96,
  savePanelColor: '#1a1d22',
  saveSlotColor: '#21252b',
  cornerRadius: 2,
};

export const GAME_UI_PRESETS: Record<GameUiThemePreset, { name: string; description: string; theme: GameUiTheme }> = {
  modern: {
    name: '现代沉浸',
    description: '低遮挡渐变对白、香槟金点缀与衬线正文',
    theme: DEFAULT_GAME_UI_THEME,
  },
  classic: {
    name: '经典视觉小说',
    description: '更高的对白区域、暖色姓名牌与紧凑菜单',
    theme: {
      ...DEFAULT_GAME_UI_THEME,
      preset: 'classic',
      fontFamily: 'Georgia, "Microsoft YaHei", serif',
      dialogueFontSize: 20,
      dialogueGradientColor: '#101018',
      dialogueBottomOpacity: 0.96,
      dialogueTopOpacity: 0.15,
      dialogueHeight: 22,
      speakerColor: '#f3c66d',
      speakerFontSize: 18,
      speakerStyle: 'plate',
      accentColor: '#e2b85f',
      systemPanelColor: '#17131b',
      savePanelColor: '#1c1821',
      saveSlotColor: '#28212d',
      cornerRadius: 2,
    },
  },
  minimal: {
    name: '极简字幕',
    description: '轻量字幕式对白与克制的无衬线界面',
    theme: {
      ...DEFAULT_GAME_UI_THEME,
      preset: 'minimal',
      fontFamily: 'Inter, "Microsoft YaHei", sans-serif',
      dialogueFontSize: 17,
      dialogueBottomOpacity: 0.82,
      dialogueHeight: 13,
      speakerColor: '#ffffff',
      speakerFontSize: 14,
      speakerWeight: 600,
      speakerStyle: 'plain',
      accentColor: '#8fd8c9',
      systemPanelColor: '#111719',
      systemPanelOpacity: 0.92,
      savePanelColor: '#141a1c',
      saveSlotColor: '#20282a',
      cornerRadius: 0,
    },
  },
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const validColor = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

export function normalizeGameUiTheme(value?: Partial<GameUiTheme>): GameUiTheme {
  const preset = value?.preset && value.preset in GAME_UI_PRESETS ? value.preset : DEFAULT_GAME_UI_THEME.preset;
  const base = GAME_UI_PRESETS[preset].theme;
  return {
    ...base,
    ...value,
    preset,
    fontFamily: typeof value?.fontFamily === 'string' && value.fontFamily.trim() ? value.fontFamily : base.fontFamily,
    dialogueFontSize: clamp(Number(value?.dialogueFontSize ?? base.dialogueFontSize), 12, 36),
    dialogueTextColor: validColor(value?.dialogueTextColor, base.dialogueTextColor),
    dialogueGradientColor: validColor(value?.dialogueGradientColor, base.dialogueGradientColor),
    dialogueBottomOpacity: clamp(Number(value?.dialogueBottomOpacity ?? base.dialogueBottomOpacity), 0, 1),
    dialogueTopOpacity: clamp(Number(value?.dialogueTopOpacity ?? base.dialogueTopOpacity), 0, 1),
    dialogueHeight: clamp(Number(value?.dialogueHeight ?? base.dialogueHeight), 10, 35),
    speakerColor: validColor(value?.speakerColor, base.speakerColor),
    speakerFontSize: clamp(Number(value?.speakerFontSize ?? base.speakerFontSize), 10, 30),
    speakerWeight: clamp(Number(value?.speakerWeight ?? base.speakerWeight), 400, 900),
    speakerStyle: ['plain', 'accent', 'plate'].includes(value?.speakerStyle ?? '') ? value!.speakerStyle! : base.speakerStyle,
    accentColor: validColor(value?.accentColor, base.accentColor),
    buttonTextColor: validColor(value?.buttonTextColor, base.buttonTextColor),
    systemPanelColor: validColor(value?.systemPanelColor, base.systemPanelColor),
    systemPanelOpacity: clamp(Number(value?.systemPanelOpacity ?? base.systemPanelOpacity), 0.5, 1),
    savePanelColor: validColor(value?.savePanelColor, base.savePanelColor),
    saveSlotColor: validColor(value?.saveSlotColor, base.saveSlotColor),
    cornerRadius: clamp(Number(value?.cornerRadius ?? base.cornerRadius), 0, 12),
  };
}

export function hexToRgba(hex: string, opacity: number) {
  const value = validColor(hex, '#000000').slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(opacity, 0, 1)})`;
}

export function gameUiThemeCssVariables(themeValue?: Partial<GameUiTheme>): CSSProperties {
  const theme = normalizeGameUiTheme(themeValue);
  return {
    '--runtime-font': theme.fontFamily,
    '--dialogue-font-size': `${theme.dialogueFontSize}px`,
    '--dialogue-text-color': theme.dialogueTextColor,
    '--dialogue-gradient-bottom': hexToRgba(theme.dialogueGradientColor, theme.dialogueBottomOpacity),
    '--dialogue-gradient-middle': hexToRgba(theme.dialogueGradientColor, Math.max(theme.dialogueTopOpacity, theme.dialogueBottomOpacity * 0.84)),
    '--dialogue-gradient-top': hexToRgba(theme.dialogueGradientColor, theme.dialogueTopOpacity),
    '--dialogue-height': `${theme.dialogueHeight}%`,
    '--speaker-color': theme.speakerColor,
    '--speaker-font-size': `${theme.speakerFontSize}px`,
    '--speaker-font-weight': theme.speakerWeight,
    '--runtime-accent': theme.accentColor,
    '--runtime-button-text': theme.buttonTextColor,
    '--system-panel': hexToRgba(theme.systemPanelColor, theme.systemPanelOpacity),
    '--save-panel': theme.savePanelColor,
    '--save-slot': theme.saveSlotColor,
    '--runtime-radius': `${theme.cornerRadius}px`,
  } as CSSProperties;
}
