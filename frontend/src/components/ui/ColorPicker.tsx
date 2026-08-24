import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { EDITOR_THEMES } from '../../core/editorAppearance';

interface ColorPickerProps {
  value?: string;
  fallback: string;
  onChange: (hex: string | undefined) => void;
}

interface Hsv { h: number; s: number; v: number }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function hexToHsv(hex: string): Hsv {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max > 0 ? delta / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const EXTRA_PRESETS = ['#d97706', '#dc2626', '#7c3aed', '#2563eb', '#0891b2', '#65a30d'];

export function ColorPicker({ value, fallback, onChange }: ColorPickerProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value ?? fallback));
  const [hexInput, setHexInput] = useState((value ?? fallback).toUpperCase());
  const [expanded, setExpanded] = useState(false);
  const dragging = useRef(false);
  const frame = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const currentHex = hsvToHex(hsv);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setExpanded(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setExpanded(false); } };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [expanded]);

  useEffect(() => {
    if (dragging.current) return;
    const next = value ?? fallback;
    setHsv(hexToHsv(next));
    setHexInput(next.toUpperCase());
  }, [value, fallback]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const emit = (next: Hsv, immediate: boolean) => {
    setHsv(next);
    setHexInput(hsvToHex(next).toUpperCase());
    cancelAnimationFrame(frame.current);
    if (immediate) { onChange(hsvToHex(next)); return; }
    frame.current = requestAnimationFrame(() => onChange(hsvToHex(next)));
  };

  const svFromPointer = (event: ReactPointerEvent<HTMLDivElement>): Hsv => {
    const rect = svRef.current!.getBoundingClientRect();
    return { h: hsv.h, s: clamp01((event.clientX - rect.left) / rect.width), v: 1 - clamp01((event.clientY - rect.top) / rect.height) };
  };
  const hueFromPointer = (event: ReactPointerEvent<HTMLDivElement>): Hsv => {
    const rect = hueRef.current!.getBoundingClientRect();
    return { ...hsv, h: clamp01((event.clientX - rect.left) / rect.width) * 360 };
  };

  const areaHandlers = (ref: typeof svRef, compute: (event: ReactPointerEvent<HTMLDivElement>) => Hsv) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = true;
      emit(compute(event), true);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) emit(compute(event), false);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragging.current = false;
      emit(compute(event), true);
    },
  });

  const onSvKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, Hsv> = {
      ArrowLeft: { ...hsv, s: clamp01(hsv.s - step) },
      ArrowRight: { ...hsv, s: clamp01(hsv.s + step) },
      ArrowUp: { ...hsv, v: clamp01(hsv.v + step) },
      ArrowDown: { ...hsv, v: clamp01(hsv.v - step) },
    };
    const next = moves[event.key];
    if (next) { event.preventDefault(); emit(next, true); }
  };
  const onHueKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 15 : 3;
    const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? { ...hsv, h: Math.max(0, hsv.h - step) }
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? { ...hsv, h: Math.min(360, hsv.h + step) }
        : null;
    if (next) { event.preventDefault(); emit(next, true); }
  };

  const commitHexInput = () => {
    const text = hexInput.trim().replace(/^#/, '');
    if (/^[0-9a-f]{6}$/i.test(text)) onChange(`#${text.toLowerCase()}`);
    else setHexInput(currentHex.toUpperCase());
  };

  const presets = useMemo(() => [...new Set([...EDITOR_THEMES.map((theme) => theme.preview[2]), ...EXTRA_PRESETS])], []);

  return <div className="ds-color-picker" ref={rootRef}>
    <div className="ds-color-picker-row">
      <button
        type="button"
        className={`ds-color-picker-swatch ${expanded ? 'active' : ''}`}
        style={{ background: currentHex }}
        aria-expanded={expanded}
        aria-label="展开颜色选择面板"
        title={currentHex.toUpperCase()}
        onClick={() => setExpanded((current) => !current)}
      />
      <span className="ds-color-picker-value">{value?.toUpperCase() ?? '使用主题默认色'}</span>
      {value !== undefined && <button type="button" className="ds-color-picker-reset" onClick={() => onChange(undefined)}>恢复默认</button>}
    </div>
    {expanded && <div className="ds-color-picker-panel">
      <div
        ref={svRef}
        className="ds-color-picker-sv"
        role="slider"
        tabIndex={0}
        aria-label="饱和度与明度"
        aria-valuetext={`饱和度 ${Math.round(hsv.s * 100)}%，明度 ${Math.round(hsv.v * 100)}%`}
        style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
        onKeyDown={onSvKeyDown}
        {...areaHandlers(svRef, svFromPointer)}
      >
        <span className="ds-color-picker-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div
        ref={hueRef}
        className="ds-color-picker-hue"
        role="slider"
        tabIndex={0}
        aria-label="色相"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onKeyDown={onHueKeyDown}
        {...areaHandlers(hueRef, hueFromPointer)}
      >
        <span className="ds-color-picker-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
      <input
        className="ds-color-picker-hex"
        aria-label="强调色 HEX"
        spellCheck={false}
        maxLength={7}
        value={hexInput}
        onChange={(event) => setHexInput(event.target.value)}
        onBlur={commitHexInput}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitHexInput(); } }}
      />
      <div className="ds-color-picker-presets">
        {presets.map((preset) => <button
          type="button"
          key={preset}
          className={value === preset ? 'selected' : ''}
          style={{ background: preset }}
          title={preset.toUpperCase()}
          aria-label={`预设颜色 ${preset.toUpperCase()}`}
          onClick={() => onChange(preset)}
        />)}
      </div>
    </div>}
  </div>;
}
