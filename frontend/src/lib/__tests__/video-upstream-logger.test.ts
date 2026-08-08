import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const logger = require(path.resolve(testDir, '../../../../backend/video-upstream-logger.js'));

describe('视频上游日志脱敏', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('脱敏认证头、API Key 和签名 URL 查询参数', () => {
    const apiKey = 'sk-test-secret-abcd';
    const signature = 'signed-query-secret-1234';

    expect(logger.summarizeVideoRequestHeaders({
      Authorization: `Bearer ${apiKey}`,
      'X-Api-Key': apiKey,
    })).toEqual({
      Authorization: 'Bearer sk-****abcd',
      'X-Api-Key': 'sk-****abcd',
    });

    const sanitizedUrl = logger.sanitizeVideoLogUrl(`https://upstream.example/video.mp4?signature=${signature}&quality=1080p`);
    expect(sanitizedUrl).toContain('quality=1080p');
    expect(sanitizedUrl).not.toContain(signature);
    expect(sanitizedUrl).toContain('sig****1234');
  });

  it('脱敏 Cookie 和 Set-Cookie 中所有分号分隔的敏感值', () => {
    const firstSecret = 'first-cookie-secret';
    const secondSecret = 'second-cookie-secret';
    const commaSecret = 'comma-cookie-secret';
    const cookieText = logger.sanitizeVideoLogText(
      `Cookie: session=${firstSecret}; refresh=${secondSecret}; theme=dark`,
    );
    const setCookieText = logger.sanitizeVideoLogText(
      `Set-Cookie: session=${firstSecret}; Path=/; HttpOnly; refresh=${secondSecret}`,
    );
    const combinedSetCookieText = logger.sanitizeVideoLogText(
      `Set-Cookie: session=${firstSecret}; Expires=Wed, 21 Oct 2015 07:28:00 GMT, csrf=${commaSecret}; Secure`,
    );

    expect(cookieText).not.toContain(firstSecret);
    expect(cookieText).not.toContain(secondSecret);
    expect(cookieText).toContain('session=fir****cret');
    expect(cookieText).toContain('refresh=sec****cret');
    expect(setCookieText).not.toContain(firstSecret);
    expect(setCookieText).not.toContain(secondSecret);
    expect(setCookieText).toContain('Path=/');
    expect(setCookieText).toContain('HttpOnly');
    expect(combinedSetCookieText).not.toContain(commaSecret);
    expect(combinedSetCookieText).toContain('Expires=Wed, 21 Oct 2015 07:28:00 GMT');
    expect(combinedSetCookieText).toContain('csrf=com****cret');
  });

  it('递归脱敏 JSON 请求与响应中的敏感字段', () => {
    const requestSecret = 'request-secret-abcd';
    const responseSecret = 'response-secret-wxyz';
    const requestBody = logger.summarizeVideoRequestBody(JSON.stringify({
      model: 'video-model',
      api_key: requestSecret,
      nested: { access_token: requestSecret },
    }));
    const responseBody = logger.summarizeVideoResponseBody(JSON.stringify({
      id: 'task-1',
      secret: responseSecret,
      nested: { authorization: `Bearer ${responseSecret}` },
    }), 65536);
    const serialized = JSON.stringify({ requestBody, responseBody });

    expect(serialized).toContain('video-model');
    expect(serialized).toContain('task-1');
    expect(serialized).not.toContain(requestSecret);
    expect(serialized).not.toContain(responseSecret);
  });

  it('将 data URL 替换为媒体类型和字节数摘要', () => {
    const base64 = 'aGVsbG8gdmlkZW8=';
    const summarized = logger.summarizeVideoRequestBody(JSON.stringify({
      image: `data:image/png;base64,${base64}`,
    }));
    const serialized = JSON.stringify(summarized);

    expect(serialized).toContain('data:image/png;base64');
    expect(serialized).toContain('11 bytes');
    expect(serialized).not.toContain(base64);
  });

  it('multipart 文件只记录名称、MIME 类型和字节数', () => {
    const formData = new FormData();
    formData.append('prompt', '生成海边短片');
    formData.append('input_reference', new File(['binary-video-data'], 'reference.mp4', { type: 'video/mp4' }));

    const summarized = logger.summarizeVideoRequestBody(formData);
    expect(summarized).toEqual({
      type: 'multipart/form-data',
      fields: {
        prompt: '生成海边短片',
        input_reference: { name: 'reference.mp4', mimeType: 'video/mp4', size: 17 },
      },
    });
    expect(JSON.stringify(summarized)).not.toContain('binary-video-data');
  });

  it('畸形百分号编码不会让 URL 脱敏抛错', () => {
    expect(() => logger.sanitizeVideoLogUrl('not-a-url?token=%E0%A4%A')).not.toThrow();
    expect(logger.sanitizeVideoLogUrl('not-a-url?token=%E0%A4%A')).not.toContain('%E0%A4%A');
  });

  it('视频响应只记录类型和字节数占位符，不输出媒体正文', () => {
    const binaryBody = 'large-binary-video-response';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        'content-type': 'video/mp4',
        'content-length': '10485760',
      }),
    };

    logger.logVideoUpstreamResponse(
      'download',
      'https://upstream.example/result.mp4',
      response,
      binaryBody,
      { taskId: 'task-video-response' },
      { enabled: true },
    );

    const logText = info.mock.calls.flat().join('\n');
    expect(logText).toContain('<视频响应正文已省略；类型=video/mp4；字节数=10485760>');
    expect(logText).not.toContain(binaryBody);
  });

  it('按本地日期生成确定的日志文件名', () => {
    const date = new Date(2026, 6, 29, 23, 59, 59);
    const filePath = logger.getVideoUpstreamLogFilePath('C:/logs/video-upstream', date);

    expect(logger.getVideoUpstreamLogDate(date)).toBe('2026-07-29');
    expect(filePath.replace(/\\/g, '/')).toBe('C:/logs/video-upstream/video-upstream-2026-07-29.log');
  });

  it('将脱敏诊断信息追加为按日期分割的 JSONL 文件', async () => {
    const logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flyreq-video-log-'));
    try {
      const secret = 'sk-file-secret-abcd';
      const diagnostics = logger.sanitizeVideoLogValue({
        stage: 'create',
        headers: { Authorization: `Bearer ${secret}` },
        body: { model: 'video-model' },
      });

      await logger.appendVideoUpstreamLog('request', 'info', diagnostics, { logDir });
      const files = await fs.promises.readdir(logDir);
      expect(files).toEqual([`video-upstream-${logger.getVideoUpstreamLogDate()}.log`]);

      const lines = (await fs.promises.readFile(path.join(logDir, files[0]), 'utf8')).trim().split('\\n');
      const record = JSON.parse(lines[0]);
      expect(record).toMatchObject({ level: 'info', event: 'request', stage: 'create' });
      expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(JSON.stringify(record)).toContain('video-model');
      expect(JSON.stringify(record)).not.toContain(secret);
    } finally {
      await fs.promises.rm(logDir, { recursive: true, force: true });
    }
  });

  it('最终请求与错误响应日志不包含完整密钥或媒体正文', () => {
    const apiKey = 'sk-final-log-secret-abcd';
    const signature = 'download-signature-wxyz';
    const media = 'aGVsbG8gdmlkZW8=';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'x-request-id': 'request-1', 'set-cookie': `session=${apiKey}` }),
    };

    logger.logVideoUpstreamRequest(
      'create',
      `https://upstream.example/v1/videos?signature=${signature}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ apiKey, image: `data:image/png;base64,${media}` }),
      },
      { protocol: 'openai' },
    );
    logger.logVideoUpstreamResponse(
      'create',
      `https://upstream.example/v1/videos?signature=${signature}`,
      response,
      JSON.stringify({ error: { message: '认证失败', access_token: apiKey } }),
      { protocol: 'openai' },
      { isError: true },
    );

    const logText = [...info.mock.calls, ...error.mock.calls].flat().join('\n');
    expect(info).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    expect(logText).toContain('[video-upstream]');
    expect(logText).toContain('request-1');
    expect(logText).not.toContain(apiKey);
    expect(logText).not.toContain(signature);
    expect(logText).not.toContain(media);
  });
});
