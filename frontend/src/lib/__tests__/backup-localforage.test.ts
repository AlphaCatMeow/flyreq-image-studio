import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const localForageMock = vi.hoisted(() => ({
  stores: new Map<string, Map<string, unknown>>(),
  iterateError: null as Error | null,
  clearError: null as Error | null,
}));

vi.mock('localforage', () => ({
  default: {
    createInstance: (options: { name: string; storeName: string }) => {
      const identity = `${options.name}/${options.storeName}`;
      if (!localForageMock.stores.has(identity)) localForageMock.stores.set(identity, new Map());
      const store = localForageMock.stores.get(identity)!;
      return {
        iterate: async (callback: (value: unknown, key: string) => void) => {
          if (localForageMock.iterateError) throw localForageMock.iterateError;
          for (const [key, value] of store) callback(value, key);
        },
        clear: async () => {
          if (localForageMock.clearError) throw localForageMock.clearError;
          store.clear();
        },
        setItem: async (key: string, value: unknown) => { store.set(key, value); },
      };
    },
  },
}));

import { exportAllData, importAllData } from '@/lib/backup-utils';
import { LOCAL_FORAGE, STORAGE_CONTRACT_VERSION } from '@/lib/storage-contract';

/**
 * 使用 FileReader 读取 jsdom Blob 的完整二进制内容。
 * @param blob 待读取的备份 Blob。
 * @returns Blob 对应的二进制缓冲区。
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
 * 创建可被恢复流程读取的最小完整备份。
 * @returns 不包含 localForage 清单的旧版兼容备份文件。
 */
function createLegacyBackupFile(): File {
  const zipped = zipSync({
    'metadata.json': strToU8(JSON.stringify({ storageContractVersion: 0 })),
    'localStorage.json': strToU8('{}'),
  });
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  return { arrayBuffer: async () => buffer } as File;
}

describe('localForage 完整备份恢复', () => {
  beforeEach(() => {
    localForageMock.stores.clear();
    localForageMock.iterateError = null;
    localForageMock.clearError = null;
    vi.stubGlobal('indexedDB', undefined);
  });

  it('等待画布 Blob 写入 ZIP 后才完成导出', async () => {
    const identity = `${LOCAL_FORAGE.canvasImages.name}/${LOCAL_FORAGE.canvasImages.storeName}`;
    const bytes = new Uint8Array([11, 22, 33, 44]);
    const imageBlob = new Blob([bytes], { type: 'image/png' });
    Object.defineProperty(imageBlob, 'arrayBuffer', {
      value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    localForageMock.stores.set(identity, new Map([['image:test', imageBlob]]));

    const backup = await exportAllData(undefined, 'test-version');
    const unzipped = unzipSync(new Uint8Array(await readBlobBuffer(backup)));
    const manifest = JSON.parse(strFromU8(unzipped['localforage/flyreq-image.json'])) as Record<string, Array<Record<string, string>>>;
    const blobRef = manifest[LOCAL_FORAGE.canvasImages.storeName][0]._blobRef;

    expect(blobRef).toBeTruthy();
    expect(Array.from(unzipped[`blobs/${blobRef}`])).toEqual(Array.from(bytes));
  });

  it('递归备份并恢复数组与对象内部的 Blob', async () => {
    const identity = `${LOCAL_FORAGE.canvasState.name}/${LOCAL_FORAGE.canvasState.storeName}`;
    const bytes = new Uint8Array([5, 10, 15]);
    const nestedBlob = new Blob([bytes], { type: 'image/webp' });
    Object.defineProperty(nestedBlob, 'arrayBuffer', {
      value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    localForageMock.stores.set(identity, new Map([
      ['canvas', { layers: [{ preview: nestedBlob }] }],
    ]));

    const backup = await exportAllData(undefined, 'test-version');
    localForageMock.stores.get(identity)?.clear();
    const backupBuffer = await readBlobBuffer(backup);
    await importAllData({ arrayBuffer: async () => backupBuffer } as File);

    const restored = localForageMock.stores.get(identity)?.get('canvas') as { layers: Array<{ preview: Blob }> };
    expect(restored.layers[0].preview).toBeInstanceOf(Blob);
    expect(restored.layers[0].preview.type).toBe('image/webp');
    expect(Array.from(new Uint8Array(await readBlobBuffer(restored.layers[0].preview)))).toEqual(Array.from(bytes));
  });

  it('旧备份缺少画布清单时仍清空全部受管 store', async () => {
    for (const contract of Object.values(LOCAL_FORAGE)) {
      const identity = `${contract.name}/${contract.storeName}`;
      localForageMock.stores.set(identity, new Map([['stale', { version: STORAGE_CONTRACT_VERSION }]]));
    }

    await importAllData(createLegacyBackupFile());

    for (const store of localForageMock.stores.values()) expect(store.size).toBe(0);
  });

  it('localForage 真实读取错误会终止导出而不是生成不完整备份', async () => {
    localForageMock.iterateError = new Error('transaction failed');

    await expect(exportAllData(undefined, 'test-version')).rejects.toThrow('导出 localForage 失败');
  });

  it('备份含画布数据但浏览器没有可用驱动时拒绝静默丢弃', async () => {
    localForageMock.clearError = new Error('No available storage method found.');
    const zipped = zipSync({
      'metadata.json': strToU8(JSON.stringify({ storageContractVersion: STORAGE_CONTRACT_VERSION })),
      'localStorage.json': strToU8('{}'),
      'localforage/flyreq-image.json': strToU8(JSON.stringify({
        [LOCAL_FORAGE.canvasState.storeName]: [{ key: 'canvas', value: { projects: ['one'] } }],
      })),
    });
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
    const backup = { arrayBuffer: async () => buffer } as File;

    await expect(importAllData(backup)).rejects.toThrow('恢复 localForage 失败');
  });
});
