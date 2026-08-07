import type { VideoProtocol } from '@/lib/flyreq-models';
import { closeIndexedDbOnVersionChange, ensureIndexedDbSchema, INDEXED_DB, LOCAL_STORAGE_KEYS } from '@/lib/storage-contract';

export interface VideoReferenceMetadata {
  name: string;
  type: string;
  size: number;
}

export interface StoredVideoJob {
  id: string;
  serverTaskId?: string;
  /** 同一次批量提交的本地分组标识。 */
  batchId?: string;
  /** 当前视频在批量提交中的从零开始序号。 */
  batchIndex?: number;
  status: '排队中' | 'processing' | 'completed' | 'failed' | 'cancelled';
  prompt: string;
  /** 当前视频在批量提交中使用的附加提示词。 */
  promptVariant?: string;
  /** 当前视频实际发送给上游的完整提示词。 */
  effectivePrompt?: string;
  modelId: string;
  modelName?: string;
  apiModelId?: string;
  protocol?: VideoProtocol;
  resolution: number;
  videoSize: string;
  aspectRatio?: string;
  seconds: number;
  referenceVideos: VideoReferenceMetadata[];
  referenceAudios: VideoReferenceMetadata[];
  referenceImages: VideoReferenceMetadata[];
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  durationUpdatedAt?: string;
  videoUrl?: string;
  cached?: boolean;
  error?: string;
}

const VIDEO_DB_CONTRACT = INDEXED_DB.videoResults;
const VIDEO_JOBS_KEY = LOCAL_STORAGE_KEYS.videoJobs;
const VIDEO_DB_NAME = VIDEO_DB_CONTRACT.name;
const VIDEO_STORE_NAME = VIDEO_DB_CONTRACT.stores[0].name;

/**
 * 读取浏览器本地视频任务历史。
 * @returns 按保存顺序存储的视频任务数组。
 */
export function loadVideoJobs(): StoredVideoJob[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(VIDEO_JOBS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 保存轻量视频任务历史。
 * @param jobs 当前视频任务数组。
 * @returns 无返回值。
 */
export function saveVideoJobs(jobs: StoredVideoJob[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(VIDEO_JOBS_KEY, JSON.stringify(jobs.map(job => ({ ...job, videoUrl: job.cached ? undefined : job.videoUrl }))));
  } catch (error) {
    // 持久化失败时保留当前内存任务，避免 React effect 中的异常导致工作台崩溃。
    console.error('保存视频任务历史到 localStorage 失败', error);
  }
}

/**
 * 打开独立的视频结果 IndexedDB。
 * @returns 可读写视频 Blob 的数据库连接。
 */
function openVideoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIDEO_DB_NAME, VIDEO_DB_CONTRACT.version);
    request.onupgradeneeded = () => {
      ensureIndexedDbSchema(request.result, request.transaction, VIDEO_DB_CONTRACT);
    };
    request.onsuccess = () => {
      closeIndexedDbOnVersionChange(request.result);
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 下载并持久化完成视频。
 * @param jobId 本地任务标识。
 * @param url 服务端视频地址。
 * @returns 可立即播放的对象 URL。
 */
export async function cacheVideoBlob(jobId: string, url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('视频缓存下载失败');
  const blob = await response.blob();
  const db = await openVideoDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
      tx.objectStore(VIDEO_STORE_NAME).put(blob, jobId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    // 无论事务成功或失败都关闭连接，避免后续完整备份恢复被当前页面阻塞。
    db.close();
  }
  return URL.createObjectURL(blob);
}

/**
 * 从 IndexedDB 恢复视频对象 URL。
 * @param jobId 本地任务标识。
 * @returns 视频存在时返回对象 URL，否则返回 undefined。
 */
export async function restoreVideoBlobUrl(jobId: string): Promise<string | undefined> {
  const db = await openVideoDb();
  let blob: Blob | undefined;
  try {
    blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction(VIDEO_STORE_NAME, 'readonly').objectStore(VIDEO_STORE_NAME).get(jobId);
      request.onsuccess = () => resolve(request.result as Blob | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    // 读取异常时同样关闭连接，确保数据库可以被升级、删除或完整恢复。
    db.close();
  }
  return blob ? URL.createObjectURL(blob) : undefined;
}

/**
 * 删除浏览器缓存的视频结果。
 * @param jobId 本地任务标识。
 * @returns 无返回值。
 */
export async function deleteVideoBlob(jobId: string): Promise<void> {
  const db = await openVideoDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
      tx.objectStore(VIDEO_STORE_NAME).delete(jobId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    // 删除失败也必须释放连接，否则用户下一次恢复备份仍会被阻塞。
    db.close();
  }
}
