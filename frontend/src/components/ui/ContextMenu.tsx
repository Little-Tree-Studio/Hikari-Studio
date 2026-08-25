import { useEffect, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

export type ContextMenuItem =
  | { kind: 'item'; label: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean; shortcut?: string }
  | { kind: 'separator' }
  | { kind: 'header'; label: string };

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  className?: string;
  label?: string;
}

export function ContextMenu({ open, x, y, items, onClose, className, label }: ContextMenuProps) {
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-context-menu="true"]`)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [open, onClose]);

  if (!open) return null;

  const maxLeft = window.innerWidth - 240;
  const maxTop = window.innerHeight - items.length * 36 - 16;
  const left = Math.min(x, Math.max(8, maxLeft));
  const top = Math.min(y, Math.max(8, maxTop));

  return (
    <div
      className={`context-menu ds-context-menu ${className ?? ''}`}
      role="menu"
      aria-label={label}
      data-context-menu="true"
      style={{ left, top }}
    onPointerDown={(event) => event.stopPropagation()}
  >
    {items.map((item, index) => {
      if (item.kind === 'separator') return <div key={`sep-${index}`} className="context-menu-separator" />;
      if (item.kind === 'header') return <strong key={`hdr-${index}`}>{item.label}</strong>;
      return (
        <button
          key={`item-${index}`}
          type="button"
          disabled={item.disabled}
          className={item.danger ? 'danger' : undefined}
          onClick={() => { item.onSelect(); onClose(); }}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.shortcut && <em>{item.shortcut}</em>}
        </button>
      );
    })}
  </div>
  );
}

export function useContextMenu() {
  return (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
}