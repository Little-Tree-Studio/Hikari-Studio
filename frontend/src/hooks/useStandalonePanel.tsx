import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { InspectorDock } from '../types';

/**
 * 面板独立窗口机制：把停靠面板弹出成系统独立小窗（桌面版走 pywebview 弹窗 RPC），
 * 关闭/停靠变化时自动回到原停靠位。属性检查器与变量面板共用。
 */
export function useStandalonePanel({ windowName, title, rootId, dock, setDock, notify, openMessage }: {
  windowName: string;
  title: string;
  rootId: string;
  dock: InspectorDock;
  setDock: (dock: InspectorDock) => void;
  notify: (message: string, tone?: 'error' | 'success') => void;
  openMessage: string;
}) {
  const [panelWindow, setPanelWindow] = useState<Window | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const closeDockRef = useRef<InspectorDock | null>(null);
  const restorePendingRef = useRef(false);
  const windowRef = useRef<Window | null>(null);
  const dockRef = useRef(dock);
  dockRef.current = dock;

  const syncDocument = useCallback((popup: Window) => {
    popup.document.documentElement.dataset.editorTheme = document.documentElement.dataset.editorTheme ?? '';
    popup.document.documentElement.dataset.cornerStyle = document.documentElement.dataset.cornerStyle ?? '';
    popup.document.documentElement.dataset.motion = document.documentElement.dataset.motion ?? '';
    popup.document.documentElement.style.cssText = document.documentElement.style.cssText;
  }, []);

  const restore = useCallback(() => {
    if (!restorePendingRef.current) return;
    restorePendingRef.current = false;
    const nextDock = closeDockRef.current ?? 'floating';
    closeDockRef.current = null;
    windowRef.current = null;
    setPanelWindow(null);
    setAlwaysOnTop(false);
    setDock(nextDock);
  }, [setDock]);

  const close = useCallback((nextDock: InspectorDock = 'floating') => {
    closeDockRef.current = nextDock;
    restorePendingRef.current = true;
    const popup = windowRef.current;
    setPanelWindow(null);
    setAlwaysOnTop(false);
    setDock(nextDock);
    if (popup && !popup.closed) popup.close();
  }, [setDock]);

  const open = useCallback(() => {
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.focus();
      return;
    }
    const width = Math.min(380, Math.max(280, window.innerWidth - 80));
    const height = Math.min(420, Math.max(220, window.innerHeight - 220));
    closeDockRef.current = dockRef.current;
    restorePendingRef.current = true;
    const popup = window.open('', windowName, `popup,width=${width},height=${height},resizable=yes`);
    if (!popup) { restorePendingRef.current = false; notify('独立窗口被系统拦截', 'error'); return; }
    windowRef.current = popup;
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover"><title>${title}</title></head><body><div id="${rootId}"></div></body></html>`);
    popup.document.close();
    popup.resizeTo(width, height);
    for (const node of document.head.querySelectorAll('style,link[rel="stylesheet"]')) popup.document.head.appendChild(node.cloneNode(true));
    popup.document.body.className = 'desktop-app standalone-inspector-host';
    syncDocument(popup);
    popup.addEventListener('beforeunload', restore, { once: true });
    setPanelWindow(popup);
    const resizeWhenReady = window.setInterval(() => {
      const windowId = popup.__SLIDE_WINDOW_ID__;
      const api = window.pywebview?.api;
      if (!windowId || !api || typeof api.resize_popup_window !== 'function') return;
      window.clearInterval(resizeWhenReady);
      void api.resize_popup_window(width, height, windowId);
    }, 25);
    window.setTimeout(() => window.clearInterval(resizeWhenReady), 2000);
    notify(openMessage);
  }, [windowName, title, rootId, syncDocument, restore, notify, openMessage]);

  const toggleAlwaysOnTop = useCallback(() => void (async () => {
    const next = !alwaysOnTop;
    const api = window.pywebview?.api;
    const windowId = windowRef.current?.__SLIDE_WINDOW_ID__;
    if (!api || !windowId || typeof api.set_window_always_on_top !== 'function') { notify('当前环境不支持独立窗口置顶', 'error'); return; }
    const applied = await api.set_window_always_on_top(next, windowId);
    if (!applied) { notify('当前环境不支持独立窗口置顶', 'error'); return; }
    setAlwaysOnTop(next);
  })(), [alwaysOnTop, notify]);

  useEffect(() => {
    if (panelWindow && !panelWindow.closed) syncDocument(panelWindow);
  });

  useEffect(() => {
    if (!panelWindow) return;
    const timer = window.setInterval(() => {
      if (panelWindow.closed) restore();
    }, 150);
    return () => window.clearInterval(timer);
  }, [panelWindow, restore]);

  useEffect(() => {
    if (!panelWindow || dock === closeDockRef.current) return;
    close(dock);
  }, [dock, panelWindow, close]);

  useEffect(() => () => {
    const popup = windowRef.current;
    if (popup && !popup.closed) popup.close();
  }, []);

  const renderPortal = useCallback((children: ReactNode) => {
    const root = panelWindow?.document.getElementById(rootId);
    return root ? createPortal(<div className="floating-inspector standalone-inspector-window">{children}</div>, root) : null;
  }, [panelWindow, rootId]);

  return { window: panelWindow, alwaysOnTop, open, close, toggleAlwaysOnTop, renderPortal };
}
