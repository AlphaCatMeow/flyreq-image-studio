import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const logger = require(path.resolve(testDir, '../../../../backend/daily-file-logger.js'));
const serverSource = fs.readFileSync(path.resolve(testDir, '../../../../backend/server.js'), 'utf8');
const temporaryDirectories: string[] = [];

describe('后端按日期文件日志', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory => (
      fs.promises.rm(directory, { recursive: true, force: true })
    )));
  });

  it('按进程本地日期生成确定的应用日志文件名', () => {
    const date = new Date(2026, 7, 7, 23, 59, 59);
    const filePath = logger.getDailyFileLogPath('C:/logs/application', date);

    expect(logger.getDailyFileLogDate(date)).toBe('2026-08-07');
    expect(filePath.replace(/\\/g, '/')).toBe('C:/logs/application/application-2026-08-07.log');
  });

  it('将不同级别的标准日志按调用顺序追加到当天 JSONL 文件', async () => {
    const logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flyreq-application-log-'));
    temporaryDirectories.push(logDir);
    const date = new Date(2026, 7, 7, 12, 30, 0);

    await Promise.all([
      logger.appendDailyFileLog('info', ['任务已创建', { taskId: 'task-1' }], { logDir, date }),
      logger.appendDailyFileLog('error', ['任务失败', new Error('上游超时')], { logDir, date }),
    ]);
    await logger.flushDailyFileLogs();

    const files = await fs.promises.readdir(logDir);
    expect(files).toEqual(['application-2026-08-07.log']);
    const records = (await fs.promises.readFile(path.join(logDir, files[0]), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ level: 'info', message: expect.stringContaining('task-1') });
    expect(records[1]).toMatchObject({ level: 'error', message: expect.stringContaining('上游超时') });
    expect(records[0].timestamp).toBe(date.toISOString());
  });

  it('落盘前脱敏认证信息和媒体正文', async () => {
    const logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flyreq-sanitized-log-'));
    temporaryDirectories.push(logDir);
    const secret = 'sk-application-log-secret-abcd';
    const media = 'aGVsbG8tdmlkZW8=';

    await logger.appendDailyFileLog('error', [
      `Authorization: Bearer ${secret}`,
      { api_key: secret, image: `data:image/png;base64,${media}` },
    ], { logDir });

    const [fileName] = await fs.promises.readdir(logDir);
    const content = await fs.promises.readFile(path.join(logDir, fileName), 'utf8');
    expect(content).not.toContain(secret);
    expect(content).not.toContain(media);
    expect(content).toContain('****');
    expect(content).toContain('data:image/png;base64');
  });

  it('脱敏常见的带前缀认证头字段', async () => {
    const logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flyreq-prefixed-secret-log-'));
    temporaryDirectories.push(logDir);
    const apiKey = 'sk-prefixed-api-key-secret';
    const token = 'token-prefixed-secret';
    const cookie = 'session-prefixed-secret';

    await logger.appendDailyFileLog('warn', [{ 'x-api-key': apiKey, 'x-access-token': token, 'set-cookie': cookie }], { logDir });
    await logger.flushDailyFileLogs();

    const [fileName] = await fs.promises.readdir(logDir);
    const content = await fs.promises.readFile(path.join(logDir, fileName), 'utf8');
    expect(content).not.toContain(apiKey);
    expect(content).not.toContain(token);
    expect(content).not.toContain(cookie);
    expect(content).toContain('****');
  });

  it('文件落盘时不会泄漏多字段 Cookie 的后续值', async () => {
    const logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flyreq-cookie-log-'));
    temporaryDirectories.push(logDir);
    const firstSecret = 'first-cookie-file-secret';
    const secondSecret = 'second-cookie-file-secret';

    await logger.appendDailyFileLog('warn', [
      `Cookie: session=${firstSecret}; refresh=${secondSecret}; theme=dark`,
      `Set-Cookie: auth=${firstSecret}; Path=/; HttpOnly; csrf=${secondSecret}`,
    ], { logDir });
    await logger.flushDailyFileLogs();

    const [fileName] = await fs.promises.readdir(logDir);
    const content = await fs.promises.readFile(path.join(logDir, fileName), 'utf8');
    expect(content).not.toContain(firstSecret);
    expect(content).not.toContain(secondSecret);
    expect(content).toContain('Path=/');
  });

  it('脱敏带前缀认证查询参数', async () => {
    const logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flyreq-prefixed-query-log-'));
    temporaryDirectories.push(logDir);
    const secret = 'query-prefixed-secret';
    await logger.appendDailyFileLog('info', [`https://example.com/video?x-api-key=${secret}&x-access-token=${secret}`], { logDir });
    await logger.flushDailyFileLogs();
    const [fileName] = await fs.promises.readdir(logDir);
    const content = await fs.promises.readFile(path.join(logDir, fileName), 'utf8');

    expect(content).not.toContain(secret);
    expect(content).toContain('x-api-key=que****cret');
    expect(content).toContain('x-access-token=que****cret');
  });

  it('目录初始化故障恢复后重新尝试落盘', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flyreq-recover-log-'));
    temporaryDirectories.push(temporaryRoot);
    const blockerPath = path.join(temporaryRoot, 'blocked');
    const logDir = path.join(blockerPath, 'application');
    await fs.promises.writeFile(blockerPath, 'temporary blocker', 'utf8');

    await logger.appendDailyFileLog('error', ['首次写入失败'], { logDir });
    await fs.promises.unlink(blockerPath);
    await logger.appendDailyFileLog('info', ['恢复后的日志'], { logDir });
    await logger.flushDailyFileLogs();

    const [fileName] = await fs.promises.readdir(logDir);
    const content = await fs.promises.readFile(path.join(logDir, fileName), 'utf8');
    expect(content).toContain('恢复后的日志');
    expect(content).not.toContain('首次写入失败');
  });

  it('支持通过环境变量语义关闭文件日志', () => {
    expect(logger.isDailyFileLogEnabled(undefined)).toBe(true);
    expect(logger.isDailyFileLogEnabled('true')).toBe(true);
    expect(logger.isDailyFileLogEnabled('false')).toBe(false);
    expect(logger.isDailyFileLogEnabled('0')).toBe(false);
    expect(logger.isDailyFileLogEnabled('off')).toBe(false);
  });

  it('在时间戳控制台安装后启用应用日志镜像', () => {
    expect(serverSource).toContain("require('./daily-file-logger')");
    expect(serverSource.indexOf('installTimestampedConsole();')).toBeLessThan(serverSource.indexOf('installDailyFileLogger({'));
    expect(serverSource).toContain('FLYREQ_FILE_LOG_ENABLED');
    expect(serverSource).toContain('FLYREQ_LOG_DIR');
    expect(serverSource).toContain('flushDailyFileLogs().finally(() => process.exit(1))');
  });
});
