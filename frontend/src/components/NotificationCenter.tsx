import { Bell, CheckCheck, CircleAlert, CircleCheck, Info, Trash2, X } from 'lucide-react';
import type { AppNotification } from '../types';

interface NotificationCenterProps {
  open: boolean;
  items: AppNotification[];
  close: () => void;
  markAllRead: () => void;
  clear: () => void;
}

export function NotificationCenter({ open, items, close, markAllRead, clear }: NotificationCenterProps) {
  if (!open) return null;
  const icon = (tone: AppNotification['tone']) => tone === 'error' ? <CircleAlert /> : tone === 'success' ? <CircleCheck /> : <Info />;
  return <aside className="notification-panel">
    <header><Bell /><strong>通知中心</strong><button title="关闭" onClick={close}><X /></button></header>
    <div className="notification-actions"><button onClick={markAllRead}><CheckCheck />全部已读</button><button onClick={clear}><Trash2 />清空</button></div>
    <div className="notification-list">
      {!items.length && <div className="notification-empty"><Bell /><span>暂无通知</span></div>}
      {items.map((item) => <article className={`${item.tone} ${item.read ? 'read' : ''}`} key={item.id}><div>{icon(item.tone)}</div><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></article>)}
    </div>
  </aside>;
}
