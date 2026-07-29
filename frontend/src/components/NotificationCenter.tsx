import { Bell, CheckCheck, CircleAlert, CircleCheck, Info, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEditorAppearance } from '../core/editorAppearance';
import type { AppNotification } from '../types';

interface NotificationCenterProps {
  open: boolean;
  items: AppNotification[];
  close: () => void;
  markAllRead: () => void;
  clear: () => void;
}

export function NotificationCenter({ open, items, close, markAllRead, clear }: NotificationCenterProps) {
  const { reducedMotion } = useEditorAppearance();
  const icon = (tone: AppNotification['tone']) => tone === 'error' ? <CircleAlert /> : tone === 'success' ? <CircleCheck /> : <Info />;
  return <AnimatePresence>{open && <motion.aside className="notification-panel" initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 14 }} transition={{ duration: reducedMotion ? .08 : .22 }}>
    <header><Bell /><strong>通知中心</strong><button title="关闭" onClick={close}><X /></button></header>
    <div className="notification-actions"><button onClick={markAllRead}><CheckCheck />全部已读</button><button onClick={clear}><Trash2 />清空</button></div>
    <div className="notification-list">
      {!items.length && <div className="notification-empty"><Bell /><span>暂无通知</span></div>}
      {items.map((item, index) => <motion.article initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : Math.min(index, 5) * .035 }} className={`${item.tone} ${item.read ? 'read' : ''}`} key={item.id}><div>{icon(item.tone)}</div><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></motion.article>)}
    </div>
  </motion.aside>}</AnimatePresence>;
}
