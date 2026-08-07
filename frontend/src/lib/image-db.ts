import { closeIndexedDbOnVersionChange, ensureIndexedDbSchema, INDEXED_DB } from '@/lib/storage-contract';

// flyreq-image-db 的单例连接层。
// 此前 job-store 与 image-downloader 各自在每次读写时都 indexedDB.open()+close()
// （一个任务 N 张图就开关 N 次），且部分打开点缺少 onupgradeneeded，在全新库上
// 先执行会建出「没有对象存储」的库，导致后续 transaction 抛 "object store not found"。
// 这里统一为单例缓存连接 + 统一升级逻辑，消除两个问题。

const IMAGE_DB_CONTRACT = INDEXED_DB.images;
export const DB_NAME = IMAGE_DB_CONTRACT.name;
export const DB_VERSION = IMAGE_DB_CONTRACT.version;
export const IMG_STORE = IMAGE_DB_CONTRACT.stores[0].name;
export const BLOBS_STORE = IMAGE_DB_CONTRACT.stores[1].name;

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * 关闭当前图片数据库单例连接并清空连接缓存，供完整恢复删除数据库前调用。
 * @returns 连接关闭完成后的 Promise。
 */
export async function closeImageDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  const db = await pending;
  db?.close();
}

export function openImageDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => { dbPromise = null; resolve(null); };
    req.onupgradeneeded = (e) => {
      const request = e.target as IDBOpenDBRequest;
      ensureIndexedDbSchema(request.result, request.transaction, IMAGE_DB_CONTRACT);
    };
    req.onsuccess = () => {
      const db = req.result;
      // 另一个 tab 触发升级时主动关闭并失效缓存，下次调用会重新打开。
      closeIndexedDbOnVersionChange(db, () => { dbPromise = null; });
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
  });
  return dbPromise;
}
