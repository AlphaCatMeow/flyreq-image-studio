export interface VideoReferenceMetadata {
  name: string;
  type: string;
  size: number;
}

export interface StoredVideoJob {
  id: string;
  serverTaskId?: string;
  status: '排队中' | 'processing' | 'completed' | 'failed';
  prompt: string;
  modelId: string;
  resolution: number;
  videoSize: string;
  seconds: number;
  referenceVideos: VideoReferenceMetadata[];
  referenceAudios: VideoReferenceMetadata[];
  referenceImages: VideoReferenceMetadata[];
  createdAt: string;
  completedAt?: string;
  videoUrl?: string;
  cached?: boolean;
  error?: string;
}

const VIDEO_JOBS_KEY = 'flyreq-video-jobs';
const VIDEO_DB_NAME = 'flyreq-video-results';
const VIDEO_STORE_NAME = 'videos';

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
  localStorage.setItem(VIDEO_JOBS_KEY, JSON.stringify(jobs.map(job => ({ ...job, videoUrl: job.cached ? undefined : job.videoUrl }))));
}

/**
 * 打开独立的视频结果 IndexedDB。
 * @returns 可读写视频 Blob 的数据库连接。
 */
function openVideoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIDEO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(VIDEO_STORE_NAME)) request.result.createObjectStore(VIDEO_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
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
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
    tx.objectStore(VIDEO_STORE_NAME).put(blob, jobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return URL.createObjectURL(blob);
}

/**
 * 从 IndexedDB 恢复视频对象 URL。
 * @param jobId 本地任务标识。
 * @returns 视频存在时返回对象 URL，否则返回 undefined。
 */
export async function restoreVideoBlobUrl(jobId: string): Promise<string | undefined> {
  const db = await openVideoDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction(VIDEO_STORE_NAME, 'readonly').objectStore(VIDEO_STORE_NAME).get(jobId);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob ? URL.createObjectURL(blob) : undefined;
}

/**
 * 删除浏览器缓存的视频结果。
 * @param jobId 本地任务标识。
 * @returns 无返回值。
 */
export async function deleteVideoBlob(jobId: string): Promise<void> {
  const db = await openVideoDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
    tx.objectStore(VIDEO_STORE_NAME).delete(jobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
