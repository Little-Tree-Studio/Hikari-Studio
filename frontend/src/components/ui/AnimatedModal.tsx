import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { useEditorAppearance } from '../../core/editorAppearance';

interface AnimatedModalProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  close: () => void;
}

export function AnimatedModal({ open, children, className = '', labelledBy, close }: AnimatedModalProps) {
  const { reducedMotion } = useEditorAppearance();
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, open]);
  return <AnimatePresence>
    {open && <motion.div
      className="modal-backdrop ds-modal-backdrop"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? .08 : .18 }}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <motion.section
        className={`modal ds-modal ${className}`}
        role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 34, scale: .975 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: .985 }}
        transition={reducedMotion ? { duration: .08 } : { type: 'spring', stiffness: 410, damping: 34, mass: .76 }}
      >{children}</motion.section>
    </motion.div>}
  </AnimatePresence>;
}
