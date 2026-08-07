import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportAllData, importAllData } from '@/lib/backup-utils';
import { INDEXED_DB, LOCAL_STORAGE_KEYS, STORAGE_CONTRACT_VERSION } from '@/lib/storage-contract';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backupSource = fs.readFileSync(path.resolve(testDir, '../backup-utils.ts'), 'utf8');
const videoJobStoreSource = fs.readFileSync(path.resolve(testDir, '../video-job-store.ts'), 'utf8');

/**
 * 使用浏览器 FileReader 读取 jsdom Blob。
 * @param blob 待读取的备份文件。
 * @returns 备份二进制缓冲区。
 */
function readBlobBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * 构造仅提供 arrayBuffer 的内存备份文件，避免测试依赖浏览器文件系统。
 * @param files 需要写入 ZIP 的文件映射。
 * @returns 可传给完整恢复函数的 File 兼容对象。
 */
function createBackupFile(files: Record<string, Uint8Array>): File {
  const zipped = zipSync(files);
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  return { arrayBuffer: async () => buffer } as File;
}

describe('视频工作台备份', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('将视频任务历史写入完整备份', async () => {
    const jobs = [{ id: 'video-job-one', status: 'completed', cached: true }];
    localStorage.setItem(LOCAL_STORAGE_KEYS.videoJobs, JSON.stringify(jobs));

    const backup = await exportAllData(undefined, 'test-version');
    const unzipped = unzipSync(new Uint8Array(await readBlobBuffer(backup)));
    const localStorageData = JSON.parse(strFromU8(unzipped['localStorage.json'])) as Record<string, string>;

    expect(JSON.parse(localStorageData[LOCAL_STORAGE_KEYS.videoJobs])).toEqual(jobs);
  });

  it('为视频 Blob 缓存保留 keyless store 的任务键', () => {
    expect(INDEXED_DB.videoResults).toMatchObject({
      name: 'flyreq-video-results',
      version: 1,
      stores: [{ name: 'videos' }],
    });
    expect(backupSource).toContain('_idbKey: keysRequest.result[index]');
    expect(backupSource).toContain('store.put(processedRecord._idbValue, processedRecord._idbKey as IDBValidKey)');
  });

  it('数据库删除受阻时停止导入以避免新旧记录混合', () => {
    expect(backupSource).toContain('request.onblocked = () =>');
    expect(backupSource).toContain('reject(new Error(`IndexedDB 数据库 ${name} 正被其他页面占用，请关闭其他标签页后重试`))');
  });

  it('数据库版本升级时始终按契约补齐 store 和索引', () => {
    expect(backupSource).toContain('ensureIndexedDbSchema(db, requestTarget.transaction, contract)');
    expect(backupSource).not.toContain('if (!createStores && oldVersion > 0) return');
  });

  it('视频缓存事务失败时仍关闭 IndexedDB 连接', () => {
    expect(videoJobStoreSource.match(/finally \{/g)).toHaveLength(6);
    expect(videoJobStoreSource.match(/db\.close\(\);/g)).toHaveLength(6);
  });

  it('在清空现有数据前拒绝未来版本的存储契约', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION + 1 })),
      'localStorage.json': strToU8('{}'),
    });

    await expect(importAllData(backup)).rejects.toThrow('高于当前支持版本');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
  });

  it('在清空现有数据前拒绝损坏的 localForage 清单', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8('{}'),
      'localforage/flyreq-image.json': strToU8('{invalid-json'),
    });

    await expect(importAllData(backup)).rejects.toThrow();
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
  });

  it('在清空现有数据前拒绝结构错误的 localForage 清单', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8('{}'),
      'localforage/flyreq-image.json': strToU8(JSON.stringify({ canvas_app_state: { invalid: true } })),
    });

    await expect(importAllData(backup)).rejects.toThrow('localForage store 清单无效');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
  });

  it('在清空现有数据前拒绝结构错误的 IndexedDB 清单', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8('{}'),
      'indexedDB/flyreq-image-db.json': strToU8(JSON.stringify({ images: { invalid: true } })),
    });

    await expect(importAllData(backup)).rejects.toThrow('IndexedDB store 清单无效');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
  });

  it('在清空现有数据前拒绝缺少契约主键的 IndexedDB 记录', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8('{}'),
      'indexedDB/flyreq-image-db.json': strToU8(JSON.stringify({ images: [{ name: 'missing-id' }] })),
    });

    await expect(importAllData(backup)).rejects.toThrow('IndexedDB 主键缺失');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
  });

  it('在清空现有数据前拒绝非法 IndexedDB 主键', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8('{}'),
      'indexedDB/flyreq-image-db.json': strToU8(JSON.stringify({ images: [{ id: null }] })),
    });

    await expect(importAllData(backup)).rejects.toThrow('IndexedDB 主键无效');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
  });

  it('浏览器不支持 IndexedDB 时拒绝静默丢弃数据库记录', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8('{}'),
      'indexedDB/flyreq-image-db.json': strToU8(JSON.stringify({ images: [{ id: 'image-one' }] })),
    });

    await expect(importAllData(backup)).rejects.toThrow('当前浏览器不支持 IndexedDB');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
  });

  it('在清空现有数据前拒绝无效模型注册表', async () => {
    const existingRegistry = JSON.stringify({ imageModels: [] });
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    localStorage.setItem(LOCAL_STORAGE_KEYS.modelRegistry, existingRegistry);
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8(JSON.stringify({
        [LOCAL_STORAGE_KEYS.theme]: 'light',
        [LOCAL_STORAGE_KEYS.modelRegistry]: '{invalid-json',
      })),
    });

    await expect(importAllData(backup)).rejects.toThrow('备份文件中的模型注册表无效');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.modelRegistry)).toBe(existingRegistry);
  });

  it('在清空现有数据前拒绝数组形式的模型默认值', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8(JSON.stringify({
        [LOCAL_STORAGE_KEYS.modelRegistry]: JSON.stringify({ imageModels: [], textModels: [], defaults: [] }),
      })),
    });

    await expect(importAllData(backup)).rejects.toThrow('备份文件中的模型注册表无效');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
  });

  it('localStorage 写入失败时回滚全部原有值', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    localStorage.setItem(LOCAL_STORAGE_KEYS.locale, 'zh');
    const originalSetItem = localStorage.setItem.bind(localStorage);
    let shouldFail = true;
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === LOCAL_STORAGE_KEYS.theme && value === 'light' && shouldFail) {
        shouldFail = false;
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      originalSetItem(key, value);
    });
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8(JSON.stringify({
        [LOCAL_STORAGE_KEYS.theme]: 'light',
        [LOCAL_STORAGE_KEYS.locale]: 'en',
      })),
    });

    await expect(importAllData(backup)).rejects.toThrow(`恢复 localStorage 失败：${LOCAL_STORAGE_KEYS.theme}`);
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.locale)).toBe('zh');
  });

  it('IndexedDB 恢复失败时回滚已经替换的 localStorage', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    vi.stubGlobal('indexedDB', {
      deleteDatabase: () => {
        const request: { onblocked?: () => void; onsuccess?: () => void; onerror?: () => void } = {};
        queueMicrotask(() => request.onblocked?.());
        return request;
      },
    });
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8(JSON.stringify({ [LOCAL_STORAGE_KEYS.theme]: 'light' })),
    });

    await expect(importAllData(backup)).rejects.toThrow('正被其他页面占用');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('在清空现有数据前拒绝缺少二进制文件的 Blob 引用', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.theme, 'dark');
    const backup = createBackupFile({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8('{}'),
      'localforage/flyreq-image.json': strToU8(JSON.stringify({
        canvas_image_files: [{ key: 'image:missing', _blobRef: 'missing-ref', _blobMimeType: 'image/png' }],
      })),
    });

    await expect(importAllData(backup)).rejects.toThrow('备份文件缺少 Blob 数据');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.theme)).toBe('dark');
  });

  it('将画布 localForage 降级状态写入完整备份', async () => {
    const fallbackState = JSON.stringify({ state: { projects: [{ id: 'canvas-one' }] } });
    localStorage.setItem(LOCAL_STORAGE_KEYS.canvasStoreFallback, fallbackState);

    const backup = await exportAllData(undefined, 'test-version');
    const unzipped = unzipSync(new Uint8Array(await readBlobBuffer(backup)));
    const localStorageData = JSON.parse(strFromU8(unzipped['localStorage.json'])) as Record<string, string>;

    expect(localStorageData[LOCAL_STORAGE_KEYS.canvasStoreFallback]).toBe(fallbackState);
  });
});
