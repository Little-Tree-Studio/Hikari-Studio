const DATABASE_NAME = 'slide-studio';
const STORE_NAME = 'large-values';
const DATABASE_VERSION = 1;

const memoryFallback = new Map<string, string>();

function currentDesktopApi() {
  try {
    return window.pywebview?.api ?? window.opener?.pywebview?.api;
  } catch {
    return window.pywebview?.api;
  }
}

async function waitForDesktopStorageApi() {
  const current = currentDesktopApi();
  if (typeof current?.read_runtime_value === 'function') return current;
  if (window.__SLIDE_DESKTOP__ !== true) return undefined;
  return new Promise<ReturnType<typeof currentDesktopApi>>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      const api = currentDesktopApi();
      if (typeof api?.read_runtime_value !== 'function') return;
      settled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      resolve(api);
    };
    const interval = window.setInterval(finish, 50);
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.clearInterval(interval);
      resolve(undefined);
    }, 2000);
    window.addEventListener('pywebviewready', finish, { once: true });
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB 不可用'));
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function useStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('本地数据库操作失败'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('本地数据库事务失败')); };
  });
}

export async function readLargeValue(key: string): Promise<string | null> {
  const desktopApi = await waitForDesktopStorageApi();
  if (desktopApi) {
    const persisted = await desktopApi.read_runtime_value(key);
    if (typeof persisted === 'string') return persisted;
  }

  let legacy: string | null = null;
  try {
    const value = await useStore<string | undefined>('readonly', (store) => store.get(key));
    if (typeof value === 'string') legacy = value;
  } catch {
    // Legacy and memory fallbacks remain available below.
  }
  if (legacy === null) {
    try { legacy = localStorage.getItem(key); } catch { /* storage may be disabled */ }
  }
  if (legacy !== null) {
    if (desktopApi) {
      try {
        await desktopApi.write_runtime_value(key, legacy);
        await deleteBrowserValue(key);
      } catch {
        // Keep the browser copy readable until migration succeeds.
      }
    }
    return legacy;
  }
  return memoryFallback.get(key) ?? null;
}

export async function writeLargeValue(key: string, value: string): Promise<void> {
  const desktopApi = await waitForDesktopStorageApi();
  if (window.__SLIDE_DESKTOP__ === true) {
    if (!desktopApi) throw new Error('桌面存储服务尚未就绪，请稍后重试');
    const persisted = await desktopApi.write_runtime_value(key, value);
    if (!persisted) throw new Error('桌面存储服务未能写入数据');
    // Keep a best-effort browser mirror so a popup preview can start before its bridge is ready.
    try { await useStore('readwrite', (store) => store.put(value, key)); } catch { /* Python is authoritative. */ }
    memoryFallback.delete(key);
    return;
  }
  try {
    await useStore('readwrite', (store) => store.put(value, key));
    try { localStorage.removeItem(key); } catch { /* storage may be disabled */ }
    memoryFallback.delete(key);
    return;
  } catch (databaseError) {
    try {
      localStorage.setItem(key, value);
      return;
    } catch {
      memoryFallback.set(key, value);
      throw new Error(`本地缓存空间不足，且 IndexedDB 写入失败：${String(databaseError)}`);
    }
  }
}

export async function deleteLargeValue(key: string): Promise<void> {
  const desktopApi = await waitForDesktopStorageApi();
  if (desktopApi) await desktopApi.delete_runtime_value(key);
  await deleteBrowserValue(key);
}

async function deleteBrowserValue(key: string): Promise<void> {
  memoryFallback.delete(key);
  try { localStorage.removeItem(key); } catch { /* storage may be disabled */ }
  try { await useStore('readwrite', (store) => store.delete(key)); } catch { /* fallbacks were already cleared */ }
}

export function readSmallValue(key: string): string | null {
  try { return localStorage.getItem(key) ?? memoryFallback.get(key) ?? null; } catch { return memoryFallback.get(key) ?? null; }
}

export function writeSmallValue(key: string, value: string): boolean {
  memoryFallback.set(key, value);
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function removeSmallValue(key: string) {
  memoryFallback.delete(key);
  try { localStorage.removeItem(key); } catch { /* storage may be disabled */ }
}
