import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const loadCommonJs = createRequire(import.meta.url);
const {
  createVideoRequest,
  getCreatedVideoTaskId,
  getVideoDownloadHeaders,
  getVideoPollPath,
  normalizeVideoPollResult,
} = loadCommonJs(path.resolve(testDir, '../../../../backend/video-protocols.js'));

const request = {
  model: 'video-model',
  prompt: 'A camera move',
  resolution: 720,
  size: '1280x720',
  aspectRatio: '16:9',
  seconds: 8,
};
const files = {
  images: [{ filename: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('image') }],
};

describe('视频协议适配器', () => {
  it('构造 New API JSON 请求并识别 task_id', () => {
    const upstream = createVideoRequest('new-api', 'key', request, files);
    expect(upstream.path).toBe('/v1/video/generations');
    expect(upstream.init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(upstream.init.body)).toEqual(expect.objectContaining({
      model: 'video-model',
      prompt: 'A camera move',
      duration: 8,
      width: 1280,
      height: 720,
      image: expect.stringMatching(/^data:image\/png;base64,/),
    }));
    expect(getCreatedVideoTaskId('new-api', { task_id: 'task-new' })).toBe('task-new');
    expect(getVideoPollPath('new-api', 'task/new')).toBe('/v1/video/generations/task%2Fnew');
    expect(normalizeVideoPollResult('new-api', { status: 'completed', url: 'https://cdn.example/video.mp4' }, 'https://api.example', 'task-new')).toEqual({ state: 'completed', remoteUrl: 'https://cdn.example/video.mp4' });
  });

  it('构造 OpenAI Videos multipart 请求并使用 content 端点下载', () => {
    const upstream = createVideoRequest('openai', 'key', request, files);
    expect(upstream.path).toBe('/v1/videos');
    expect(upstream.init.body).toBeInstanceOf(FormData);
    expect(upstream.init.body.get('model')).toBe('video-model');
    expect(upstream.init.body.get('input_reference')).toBeInstanceOf(Blob);
    expect(getCreatedVideoTaskId('openai', { id: 'video-openai' })).toBe('video-openai');
    expect(normalizeVideoPollResult('openai', { status: 'completed' }, 'https://api.openai.com', 'video-openai')).toEqual({
      state: 'completed',
      remoteUrl: 'https://api.openai.com/v1/videos/video-openai/content',
    });
    expect(normalizeVideoPollResult('openai', { status: 'completed' }, 'https://api.openai.com/v1', 'video-openai')).toEqual({
      state: 'completed',
      remoteUrl: 'https://api.openai.com/v1/videos/video-openai/content',
    });
    expect(getVideoDownloadHeaders('http://internal-api:3000/v1/videos/video-openai/content', 'http://internal-api:3000', 'secret')).toEqual({ Authorization: 'Bearer secret' });
    expect(getVideoDownloadHeaders('https://cdn.example/video.mp4', 'http://internal-api:3000', 'secret')).toEqual({});
  });

  it('构造 xAI JSON 请求并识别 request_id 与 video.url', () => {
    const upstream = createVideoRequest('xai', 'key', request, files);
    expect(upstream.path).toBe('/v1/videos/generations');
    expect(JSON.parse(upstream.init.body)).toEqual(expect.objectContaining({
      model: 'video-model',
      duration: 8,
      resolution: '720p',
      aspect_ratio: '16:9',
      image: expect.stringMatching(/^data:image\/png;base64,/),
    }));
    expect(getCreatedVideoTaskId('xai', { request_id: 'request-xai' })).toBe('request-xai');
    expect(getVideoPollPath('xai', 'request-xai')).toBe('/v1/videos/request-xai');
    expect(normalizeVideoPollResult('xai', { video: { url: 'https://cdn.x.ai/video.mp4' } }, 'https://api.x.ai', 'request-xai')).toEqual({ state: 'completed', remoteUrl: 'https://cdn.x.ai/video.mp4' });
  });

  it('保留旧注册表模型使用的 OpenAI 兼容生成端点', () => {
    const upstream = createVideoRequest('legacy-openai-video', 'key', request, { images: [] });
    expect(upstream.path).toBe('/v1/videos/generations');
    expect(JSON.parse(upstream.init.body)).toEqual(expect.objectContaining({
      model: 'video-model',
      resolution: 720,
      size: '1280x720',
      seconds: 8,
    }));
  });
});
