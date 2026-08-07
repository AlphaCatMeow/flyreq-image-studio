import { closeIndexedDbOnVersionChange, ensureIndexedDbSchema, INDEXED_DB } from '@/lib/storage-contract';

// 反推结果的 IndexedDB 持久化层
// 数据库: flyreq-reverse-db (v1)
// store: reverse-results (keyPath: 'slot')
// 保存文字结果和当前输入图草稿。

export interface StoredReverseResult {
  slot: 'current' | 'previous';
  text: string;
  model: string;
  mode: string;
  aborted?: boolean;
  timestamp: number;
}

export interface StoredReverseDraft {
  slot: 'draft';
  file: {
    id: string;
    name: string;
    preview: string;
    dataUrl: string;
    mimeType: string;
    badge?: string;
  } | null;
  timestamp: number;
}

const REVERSE_DB_CONTRACT = INDEXED_DB.reversePrompt;
const DB_NAME = REVERSE_DB_CONTRACT.name;
const DB_VERSION = REVERSE_DB_CONTRACT.version;
const STORE_NAME = REVERSE_DB_CONTRACT.stores[0].name;

function openReverseDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(new Error('打开反推 IndexedDB 失败', { cause: req.error }));
    req.onsuccess = () => {
      closeIndexedDbOnVersionChange(req.result);
      resolve(req.result);
    };
    req.onupgradeneeded = (e) => {
      const request = e.target as IDBOpenDBRequest;
      ensureIndexedDbSchema(request.result, request.transaction, REVERSE_DB_CONTRACT);
    };
  });
}

/**
 * 在反推数据库连接生命周期内执行一次事务操作，并确保成功或失败后都释放连接。
 * @param fallback IndexedDB 不可用时返回的降级值。
 * @param operation 使用已打开数据库执行的异步操作。
 * @returns 操作结果或 IndexedDB 不可用时的降级值。
 */
async function withReverseDB<T>(fallback: T, operation: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openReverseDB();
  if (!db) return fallback;
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

/** 从 IndexedDB 加载 current / previous 两条记录 */
export async function loadReverseResults(): Promise<{
  current: StoredReverseResult | null;
  previous: StoredReverseResult | null;
  draft: StoredReverseDraft | null;
}> {
  type ReverseSnapshot = {
    current: StoredReverseResult | null;
    previous: StoredReverseResult | null;
    draft: StoredReverseDraft | null;
  };
  return withReverseDB<ReverseSnapshot>({ current: null, previous: null, draft: null }, (db) => new Promise<ReverseSnapshot>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    let current: StoredReverseResult | null = null;
    let previous: StoredReverseResult | null = null;
    let draft: StoredReverseDraft | null = null;

    const getReq = store.get('current');
    getReq.onsuccess = () => {
      current = (getReq.result as StoredReverseResult) ?? null;
    };

    const getReq2 = store.get('previous');
    getReq2.onsuccess = () => {
      previous = (getReq2.result as StoredReverseResult) ?? null;
    };

    const getReq3 = store.get('draft');
    getReq3.onsuccess = () => {
      draft = (getReq3.result as StoredReverseDraft) ?? null;
    };

    tx.oncomplete = () => resolve({ current, previous, draft });
    tx.onerror = () => reject(new Error('读取反推结果失败', { cause: tx.error }));
  }));
}

/** 保存单条记录到指定槽位 */
export async function saveReverseResult(result: StoredReverseResult): Promise<void> {
  return withReverseDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(result);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('保存反推结果失败', { cause: tx.error }));
  }));
}

/** 清除指定槽位 */
export async function clearReverseResult(slot: 'current' | 'previous'): Promise<void> {
  return withReverseDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('清除反推结果失败', { cause: tx.error }));
  }));
}

/** 保存当前输入图草稿 */
export async function saveReverseDraft(file: StoredReverseDraft['file']): Promise<void> {
  return withReverseDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ slot: 'draft', file, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('保存反推草稿失败', { cause: tx.error }));
  }));
}

/** 清除当前输入图草稿 */
export async function clearReverseDraft(): Promise<void> {
  return withReverseDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete('draft');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('清除反推草稿失败', { cause: tx.error }));
  }));
}
