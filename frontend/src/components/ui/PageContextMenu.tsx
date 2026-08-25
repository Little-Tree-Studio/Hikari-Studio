import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

type MenuFactory = (event: React.MouseEvent | MouseEvent) => ContextMenuItem[] | null;

interface PageContextMenuProps {
  build: MenuFactory;
  className?: string;
  label?: string;
  children: ReactNode;
}

export function PageContextMenu({ build, className, label, children }: PageContextMenuProps) {
  const [state, setState] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [state]);

  return (
    <div
      ref={containerRef}
      className={`page-context-root ${className ?? ''}`}
      onContextMenu={(event) => {
        const items = build(event);
        if (!items || !items.length) return;
        event.preventDefault();
        event.stopPropagation();
        setState({ x: event.clientX, y: event.clientY, items });
      }}
    >
      {children}
      <ContextMenu
        open={Boolean(state)}
        x={state?.x ?? 0}
        y={state?.y ?? 0}
        items={state?.items ?? []}
        onClose={() => setState(null)}
        label={label}
      />
    </div>
  );
}