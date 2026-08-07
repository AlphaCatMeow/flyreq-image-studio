// Agent 模式自建上下文系统的 IndexedDB 持久化层
// 数据库: flyreq-agent-db (v1)
//   store: messages (keyPath 'id')        —— 对话消息，靠 createdAt 排序
//   store: images   (keyPath 'imgId')     —— 图片登记表（仅描述 + 缩略图 + 字节引用）
//   store: meta      (keyPath 'key')       —— 会话元信息（模型选择等）
// 图片真实字节不在这里，存于 flyreq-image-db 的 blobs store（复用 image-downloader）。

import { storeImageBlob, getStoredBlob, deleteStoredBlobs } from '@/lib/image-downloader';
import type { AgentMessage, AgentImageRecord, AgentProposal } from '@/lib/agent-chat-config';
import type { GptImageBackground, GptImageOutputFormat, GptImageQuality, GptImageStyle } from '@/lib/model-capabilities';
import { closeIndexedDbOnVersionChange, ensureIndexedDbSchema, INDEXED_DB } from '@/lib/storage-contract';

const AGENT_DB_CONTRACT = INDEXED_DB.agent;
const DB_NAME = AGENT_DB_CONTRACT.name;
const DB_VERSION = AGENT_DB_CONTRACT.version;
const MESSAGES_STORE = AGENT_DB_CONTRACT.stores[0].name;
const IMAGES_STORE = AGENT_DB_CONTRACT.stores[1].name;
const META_STORE = AGENT_DB_CONTRACT.stores[2].name;

function openAgentDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(new Error('打开 Agent IndexedDB 失败', { cause: req.error }));
    req.onsuccess = () => {
      closeIndexedDbOnVersionChange(req.result);
      resolve(req.result);
    };
    req.onupgradeneeded = (e) => {
      const request = e.target as IDBOpenDBRequest;
      ensureIndexedDbSchema(request.result, request.transaction, AGENT_DB_CONTRACT);
    };
  });
}

function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(new Error(`读取 Agent store 失败：${storeName}`, { cause: req.error }));
  });
}

// ===== 加载完整会话 =====

export interface AgentSessionSnapshot {
  messages: AgentMessage[];
  images: AgentImageRecord[];
  imageModel: string | null;
}

export async function loadAgentSession(): Promise<AgentSessionSnapshot> {
  return withAgentDB({ messages: [], images: [], imageModel: null }, async (db) => {
    const [messages, images, meta] = await Promise.all([
      getAll<AgentMessage>(db, MESSAGES_STORE),
      getAll<AgentImageRecord>(db, IMAGES_STORE),
      getAll<{ key: string; value: string }>(db, META_STORE),
    ]);

    messages.sort((a, b) => a.createdAt - b.createdAt);
    images.sort((a, b) => a.createdAt - b.createdAt);
    const imageModel = meta.find(item => item.key === 'imageModel')?.value ?? null;

    return { messages, images, imageModel };
  });
}

// ===== 消息读写 =====

export async function putMessage(message: AgentMessage): Promise<void> {
  return withAgentDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, 'readwrite');
    tx.objectStore(MESSAGES_STORE).put(message);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('保存 Agent 消息失败', { cause: tx.error }));
  }));
}

// ===== 图片登记表读写 =====

export async function putImageRecord(record: AgentImageRecord): Promise<void> {
  return withAgentDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    tx.objectStore(IMAGES_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('保存 Agent 图片记录失败', { cause: tx.error }));
  }));
}

// ===== 元信息 =====

export async function saveImageModel(model: string): Promise<void> {
  return withAgentDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key: 'imageModel', value: model });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('保存 Agent 图片模型失败', { cause: tx.error }));
  }));
}

// ===== 撤回消息 =====

export async function deleteMessages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  return withAgentDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, 'readwrite');
    const store = tx.objectStore(MESSAGES_STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('删除 Agent 消息失败', { cause: tx.error }));
  }));
}

/** 从 flyreq-agent-db 中删除图片登记记录 */
export async function deleteImageRecords(imgIds: string[]): Promise<void> {
  if (imgIds.length === 0) return;
  return withAgentDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    const store = tx.objectStore(IMAGES_STORE);
    for (const id of imgIds) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('删除 Agent 图片记录失败', { cause: tx.error }));
  }));
}

/** 从 flyreq-image-db 中删除 agent 图片的 blob 字节 */
export async function deleteAgentImageBytes(imgId: string): Promise<void> {
  await deleteStoredBlobs(imgId, 1);
}

// ===== 清空会话（清空重开） =====

export async function clearAgentSession(): Promise<void> {
  return withAgentDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction([MESSAGES_STORE, IMAGES_STORE, META_STORE], 'readwrite');
    tx.objectStore(MESSAGES_STORE).clear();
    tx.objectStore(IMAGES_STORE).clear();
    tx.objectStore(META_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('清空 Agent 会话失败', { cause: tx.error }));
  }));
}

// ===== Pending Proposal 持久化（刷新恢复「等待你确认」状态）=====
// 将待确认的提案、分析文本、推理文本和 reedit 标志存入 meta store，
// 页面刷新后自动恢复 proposal 阶段，避免丢失。

export interface PendingProposalData {
  proposal: AgentProposal;
  pendingAnalysis: string;
  pendingReasoning: string;
  isReedit: boolean;
}

const PENDING_PROPOSAL_KEY = 'pendingProposal';

export async function savePendingProposal(data: PendingProposalData): Promise<void> {
  return withAgentDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key: PENDING_PROPOSAL_KEY, value: JSON.stringify(data) });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('保存 Agent 待确认提案失败', { cause: tx.error }));
  }));
}

/**
 * 在 Agent 数据库连接生命周期内执行一次操作，并确保连接最终关闭。
 * @param fallback IndexedDB 不可用时返回的降级值。
 * @param operation 使用已打开数据库执行的异步操作。
 * @returns 操作结果或 IndexedDB 不可用时的降级值。
 */
async function withAgentDB<T>(fallback: T, operation: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openAgentDB();
  if (!db) return fallback;
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

export async function loadPendingProposal(): Promise<PendingProposalData | null> {
  return withAgentDB<PendingProposalData | null>(null, (db) => new Promise<PendingProposalData | null>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(PENDING_PROPOSAL_KEY);
    req.onsuccess = () => {
      const entry = req.result as { key: string; value: string } | undefined;
      if (!entry?.value) { resolve(null); return; }
      try {
        resolve(JSON.parse(entry.value) as PendingProposalData);
      } catch {
        resolve(null);
      }
    };
    req.onerror = () => reject(new Error('读取 Agent 待确认提案失败', { cause: req.error }));
  }));
}

export async function clearPendingProposal(): Promise<void> {
  return withAgentDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).delete(PENDING_PROPOSAL_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('清除 Agent 待确认提案失败', { cause: tx.error }));
  }));
}

// ===== Pending Generation 持久化（刷新恢复「正在生图」状态）=====
// 将 taskId、proposal、分析文本等存入 meta store，
// 页面刷新后自动恢复轮询，避免生成中的图片丢失。

export interface PendingGenerationData {
  taskId: string;
  proposal: AgentProposal;
  pendingAnalysis: string;
  pendingReasoning: string;
  selectedImageIds: string[];
  model: string;
  outputSize: string;
  customSize?: string;
  aspectRatio: string;
  temperature: number;
  gptImageQuality?: GptImageQuality;
  gptImageStyle?: GptImageStyle;
  gptImageBackground?: GptImageBackground;
  gptImageOutputFormat?: GptImageOutputFormat;
  parallelCount: number;
  startedAt: number;
}

const PENDING_GENERATION_KEY = 'pendingGeneration';

export async function savePendingGeneration(data: PendingGenerationData): Promise<void> {
  return withAgentDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key: PENDING_GENERATION_KEY, value: JSON.stringify(data) });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('保存 Agent 待生成任务失败', { cause: tx.error }));
  }));
}

export async function loadPendingGeneration(): Promise<PendingGenerationData | null> {
  return withAgentDB<PendingGenerationData | null>(null, (db) => new Promise<PendingGenerationData | null>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(PENDING_GENERATION_KEY);
    req.onsuccess = () => {
      const entry = req.result as { key: string; value: string } | undefined;
      if (!entry?.value) { resolve(null); return; }
      try {
        resolve(JSON.parse(entry.value) as PendingGenerationData);
      } catch {
        resolve(null);
      }
    };
    req.onerror = () => reject(new Error('读取 Agent 待生成任务失败', { cause: req.error }));
  }));
}

export async function clearPendingGeneration(): Promise<void> {
  return withAgentDB(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).delete(PENDING_GENERATION_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('清除 Agent 待生成任务失败', { cause: tx.error }));
  }));
}

// ===== 图片字节存取（复用 flyreq-image-db 的 blobs store）=====
// 约定：每张 agent 图片用 imgId 作为 jobId 命名空间，imageIndex 固定 0。

export async function storeAgentImageBytes(imgId: string, blob: Blob): Promise<void> {
  await storeImageBlob(imgId, 0, blob);
}

/** 查询 flyreq-upload-cache 中缓存的图片记录 */
interface UploadCacheRecord {
  key: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  originalSize: number;
  processedSize: number;
  width: number;
  height: number;
  createdAt: number;
}

function openUploadCacheDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(INDEXED_DB.uploadCache.name, INDEXED_DB.uploadCache.version);
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => ensureIndexedDbSchema(req.result, req.transaction, INDEXED_DB.uploadCache);
    req.onsuccess = () => {
      closeIndexedDbOnVersionChange(req.result);
      resolve(req.result);
    };
  });
}

function getFromUploadCache(db: IDBDatabase, key: string): Promise<UploadCacheRecord | null> {
  return new Promise((resolve) => {
    const storeName = INDEXED_DB.uploadCache.stores[0].name;
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve((req.result as UploadCacheRecord) || null);
    req.onerror = () => resolve(null);
  });
}

/** 从 flyreq-agent-db 的 images store 中查询单条图片登记记录 */
export async function getAgentImageRecord(imgId: string): Promise<AgentImageRecord | null> {
  return withAgentDB<AgentImageRecord | null>(null, (db) => new Promise<AgentImageRecord | null>((resolve) => {
    const tx = db.transaction(IMAGES_STORE, 'readonly');
    const req = tx.objectStore(IMAGES_STORE).get(imgId);
    req.onsuccess = () => resolve((req.result as AgentImageRecord) || null);
    req.onerror = () => resolve(null);
  }));
}

export async function getAgentImageBytes(imgId: string): Promise<Blob | null> {
  // 1) 先查 flyreq-upload-cache（上传图片已压缩缓存于此，与其余模式共享）
  const record = await getAgentImageRecord(imgId);
  if (record?.contentHash) {
    try {
      const cacheDb = await openUploadCacheDB();
      if (cacheDb) {
        const cached = await getFromUploadCache(cacheDb, record.contentHash);
        cacheDb.close();
        if (cached?.dataUrl) {
          const base64 = cached.dataUrl.includes(',') ? cached.dataUrl.split(',')[1] : cached.dataUrl;
          if (base64) {
            const mime = cached.mimeType || 'image/png';
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new Blob([bytes], { type: mime });
          }
        }
      }
    } catch {
      // 读取上传缓存失败时静默降级到 flyreq-image-db
    }
  }
  // 2) 降级到 flyreq-image-db（生成图片走此路径）
  return getStoredBlob(imgId, 0);
}

/** 把图片字节转成可直接喂给生图后端的 base64（不含 data: 前缀） */
export async function getAgentImageBase64(imgId: string): Promise<{ data: string; mimeType: string } | null> {
  const blob = await getAgentImageBytes(imgId);
  if (!blob) return null;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return { data: base64, mimeType: blob.type || 'image/png' };
}
