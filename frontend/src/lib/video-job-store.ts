import type { VideoProtocol } from '@/lib/flyreq-models';
import { closeIndexedDbOnVersionChange, ensureIndexedDbSchema, INDEXED_DB, LOCAL_STORAGE_KEYS } from '@/lib/storage-contract';

export interface VideoReferenceMetadata {
  name: string;
  type: string;
  size: number;
  lastModified?: number;
}

export interface VideoReferenceFiles {
  images: File[];
  videos: File[];
  audios: File[];
}

export interface VideoReferenceMetadataGroup {
  images: VideoReferenceMetadata[];
  videos: VideoReferenceMetadata[];
  audios: VideoReferenceMetadata[];
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
  /** 当前任务关联的参考素材二进制存储标识；同一批量任务共享一份素材。 */
  referenceStorageId?: string;
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
 * 构造视频参考素材在 IndexedDB 中的稳定键。
 * @param storageId 一次提交共享的素材存储标识。
 * @param kind 素材类型。
 * @param index 素材在同类型列表中的从零开始序号。
 * @returns 不会与视频结果任务键冲突的 IndexedDB 键。
 */
function getVideoReferenceKey(storageId: string, kind: keyof VideoReferenceFiles, index: number): string {
  return `reference:${storageId}:${kind}:${index}`;
}

/**
 * 将一次视频提交使用的全部参考素材持久化到 IndexedDB。
 * @param storageId 一次提交共享的素材存储标识。
 * @param files 按图片、视频和音频分类的原始文件。
 * @returns 全部素材写入完成后兑现的 Promise。
 */
export async function cacheVideoReferenceFiles(storageId: string, files: VideoReferenceFiles): Promise<void> {
  const db = await openVideoDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VIDEO_STORE_NAME);
      (Object.keys(files) as Array<keyof VideoReferenceFiles>).forEach(kind => {
        files[kind].forEach((file, index) => {
          store.put(file, getVideoReferenceKey(storageId, kind, index));
        });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    // 大文件写入完成后立即关闭连接，避免阻塞完整备份和数据库恢复。
    db.close();
  }
}

/**
 * 从当前事务中读取一类参考素材并重建为可上传的 File。
 * @param store 视频缓存 object store。
 * @param storageId 一次提交共享的素材存储标识。
 * @param kind 素材类型。
 * @param metadata 用于恢复文件名、MIME 类型和顺序的任务元数据。
 * @returns 完整的参考素材文件；任一记录缺失时拒绝恢复。
 */
function restoreVideoReferenceKind(
  store: IDBObjectStore,
  storageId: string,
  kind: keyof VideoReferenceFiles,
  metadata: VideoReferenceMetadata[],
): Promise<File[]> {
  return Promise.all(metadata.map((item, index) => new Promise<File>((resolve, reject) => {
    const request = store.get(getVideoReferenceKey(storageId, kind, index));
    request.onsuccess = () => {
      const blob = request.result as Blob | undefined;
      if (!blob) {
        reject(new Error(`视频参考素材缓存缺失: ${kind}[${index}]`));
        return;
      }
      resolve(new File([blob], item.name, {
        type: item.type || blob.type,
        lastModified: item.lastModified ?? Date.now() + index,
      }));
    };
    request.onerror = () => reject(request.error);
  })));
}

/**
 * 从 IndexedDB 恢复一次视频提交使用的全部参考素材。
 * @param storageId 一次提交共享的素材存储标识。
 * @param metadata 按图片、视频和音频分类的文件元数据。
 * @returns 可直接重新提交的三类 File 数组。
 */
export async function restoreVideoReferenceFiles(
  storageId: string,
  metadata: VideoReferenceMetadataGroup,
): Promise<VideoReferenceFiles> {
  const db = await openVideoDb();
  try {
    const store = db.transaction(VIDEO_STORE_NAME, 'readonly').objectStore(VIDEO_STORE_NAME);
    const [images, videos, audios] = await Promise.all([
      restoreVideoReferenceKind(store, storageId, 'images', metadata.images),
      restoreVideoReferenceKind(store, storageId, 'videos', metadata.videos),
      restoreVideoReferenceKind(store, storageId, 'audios', metadata.audios),
    ]);
    return { images, videos, audios };
  } finally {
    // 恢复结束后释放数据库连接，避免长期占用大文件缓存数据库。
    db.close();
  }
}

/**
 * 删除一次视频提交缓存的全部参考素材。
 * @param storageId 一次提交共享的素材存储标识。
 * @param metadata 按类型记录的素材元数据，用于确定需要删除的键。
 * @returns 全部对应记录删除完成后兑现的 Promise。
 */
export async function deleteVideoReferenceFiles(
  storageId: string,
  metadata: VideoReferenceMetadataGroup,
): Promise<void> {
  const db = await openVideoDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VIDEO_STORE_NAME);
      (Object.keys(metadata) as Array<keyof VideoReferenceMetadataGroup>).forEach(kind => {
        metadata[kind].forEach((_, index) => {
          store.delete(getVideoReferenceKey(storageId, kind, index));
        });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    // 删除结束后关闭连接，确保后续备份恢复可以独占升级数据库。
    db.close();
  }
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
