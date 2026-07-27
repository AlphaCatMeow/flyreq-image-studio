import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { exportAllData } from '@/lib/backup-utils';

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

describe('视频工作台备份', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('将视频任务历史写入完整备份', async () => {
    const jobs = [{ id: 'video-job-one', status: 'completed', cached: true }];
    localStorage.setItem('flyreq-video-jobs', JSON.stringify(jobs));

    const backup = await exportAllData(undefined, 'test-version');
    const unzipped = unzipSync(new Uint8Array(await readBlobBuffer(backup)));
    const localStorageData = JSON.parse(strFromU8(unzipped['localStorage.json'])) as Record<string, string>;

    expect(JSON.parse(localStorageData['flyreq-video-jobs'])).toEqual(jobs);
  });

  it('为视频 Blob 缓存保留 keyless store 的任务键', () => {
    expect(backupSource).toContain("{ name: 'flyreq-video-results', version: 1, stores: ['videos'] }");
    expect(backupSource).toContain('_idbKey: keysRequest.result[index]');
    expect(backupSource).toContain('store.put(processedRecord._idbValue, processedRecord._idbKey as IDBValidKey)');
  });

  it('数据库删除受阻时停止导入以避免新旧记录混合', () => {
    expect(backupSource).toContain('request.onblocked = () =>');
    expect(backupSource).toContain('reject(new Error(`IndexedDB 数据库 ${name} 正被其他页面占用，请关闭其他标签页后重试`))');
  });

  it('视频缓存事务失败时仍关闭 IndexedDB 连接', () => {
    expect(videoJobStoreSource.match(/finally \{/g)).toHaveLength(3);
    expect(videoJobStoreSource.match(/db\.close\(\);/g)).toHaveLength(3);
  });
});
