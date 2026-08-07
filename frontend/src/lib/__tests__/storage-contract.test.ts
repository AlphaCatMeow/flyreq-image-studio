import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import {
  closeIndexedDbOnVersionChange,
  getBackedUpIndexedDbContracts,
  getBackedUpLocalForageContracts,
  getBackedUpLocalStorageKeys,
  INDEXED_DB_CONTRACTS,
  LOCAL_FORAGE_CONTRACTS,
  LOCAL_STORAGE_CONTRACT,
  LOCAL_STORAGE_KEYS,
  STORAGE_CONTRACT_VERSION,
} from '@/lib/storage-contract';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const agentStoreSource = fs.readFileSync(path.resolve(testDirectory, '../agent-context-store.ts'), 'utf8');
const reverseStoreSource = fs.readFileSync(path.resolve(testDirectory, '../reverse-prompt-store.ts'), 'utf8');
const jobStoreSource = fs.readFileSync(path.resolve(testDirectory, '../job-store.ts'), 'utf8');
const imageDownloaderSource = fs.readFileSync(path.resolve(testDirectory, '../image-downloader.ts'), 'utf8');

describe('浏览器存储契约', () => {
  it('使用正整数版本标识后续结构迁移边界', () => {
    expect(STORAGE_CONTRACT_VERSION).toBe(1);
  });

  it('每个 localStorage key 只声明一次并全部进入完整备份', () => {
    const declaredKeys = LOCAL_STORAGE_CONTRACT.map(entry => entry.key);
    expect(new Set(declaredKeys).size).toBe(declaredKeys.length);
    expect(new Set(declaredKeys)).toEqual(new Set(Object.values(LOCAL_STORAGE_KEYS)));
    expect(getBackedUpLocalStorageKeys()).toEqual(declaredKeys);
  });

  it('每个 IndexedDB 名称唯一且同一数据库内的 store 名称唯一', () => {
    const databaseNames = INDEXED_DB_CONTRACTS.map(contract => contract.name);
    expect(new Set(databaseNames).size).toBe(databaseNames.length);

    for (const contract of INDEXED_DB_CONTRACTS) {
      const storeNames = contract.stores.map(store => store.name);
      expect(contract.version).toBeGreaterThan(0);
      expect(new Set(storeNames).size).toBe(storeNames.length);
    }
    expect(getBackedUpIndexedDbContracts()).toEqual(INDEXED_DB_CONTRACTS);
  });

  it('每个 localForage 实例唯一并全部进入完整备份', () => {
    const identities = LOCAL_FORAGE_CONTRACTS.map(contract => `${contract.name}/${contract.storeName}`);
    expect(new Set(identities).size).toBe(identities.length);
    expect(getBackedUpLocalForageContracts()).toEqual(LOCAL_FORAGE_CONTRACTS);
  });

  it('数据库版本变化时释放连接并失效调用方缓存', () => {
    const close = vi.fn();
    const onClosed = vi.fn();
    const database = { close, onversionchange: null } as unknown as IDBDatabase;

    closeIndexedDbOnVersionChange(database, onClosed);
    database.onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent);

    expect(close).toHaveBeenCalledOnce();
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('不可重建的业务状态不会把 IndexedDB 事务失败伪装成成功', () => {
    expect(agentStoreSource).not.toMatch(/tx\.onerror\s*=\s*\(\)\s*=>\s*resolve\(\)/);
    expect(reverseStoreSource).not.toMatch(/tx\.onerror\s*=\s*\(\)\s*=>\s*resolve\(\)/);
    expect(agentStoreSource).toContain("reject(new Error('打开 Agent IndexedDB 失败'");
    expect(reverseStoreSource).toContain("reject(new Error('打开反推 IndexedDB 失败'");
    expect(agentStoreSource).toContain("reject(new Error('保存 Agent 待生成任务失败'");
    expect(reverseStoreSource).toContain("reject(new Error('保存反推结果失败'");
    expect(jobStoreSource).not.toMatch(/tx\.onerror\s*=\s*\(\)\s*=>\s*resolve\(\)/);
    expect(jobStoreSource).toContain("reject(new Error('保存图片任务索引失败'");
    expect(imageDownloaderSource).toContain("reject(new Error('删除本地图片 Blob 失败'");
  });
});
