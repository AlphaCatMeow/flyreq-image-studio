import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDeploymentDefaultVideoModel,
  getCompleteVideoModels,
  loadRegistry,
} from '@/lib/flyreq-models';
import {
  applyVideoWorkspaceConfig,
  getVideoWorkspaceConfig,
  isValidVideoDuration,
  isValidVideoResolution,
  isValidVideoSize,
} from '@/lib/video-config';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.resolve(testDir, '../../../../backend/server.js'), 'utf8');

describe('视频模型注册表与工作台配置', () => {
  afterEach(() => {
    localStorage.clear();
    applyDeploymentDefaultVideoModel();
    applyVideoWorkspaceConfig();
  });

  it('为旧注册表迁移默认视频模型和默认工作流字段', () => {
    localStorage.setItem('flyreq-model-registry', JSON.stringify({ imageModels: [], textModels: [], defaults: {} }));
    const registry = loadRegistry();
    expect(registry.videoModels[0]).toEqual(expect.objectContaining({ modelId: 'grok-imagine-video', protocol: 'openai' }));
    expect(registry.defaults).toHaveProperty('videoGeneration');
  });

  it('应用部署视频模型且仅在 API Key 完整后对工作台可用', () => {
    applyDeploymentDefaultVideoModel({ id: 'video-one', name: 'Video One', modelId: 'video-model', baseUrl: 'https://video.example.com', protocol: 'openai' });
    const registry = loadRegistry();
    expect(registry.videoModels[0].apiKey).toBe('');
    expect(getCompleteVideoModels(registry)).toHaveLength(0);
  });

  it('规范化参数数组并执行精确的自定义值边界校验', () => {
    applyVideoWorkspaceConfig({ maxRefImages: 7, resolutions: [1080, 720], sizes: ['1920x1080', 'bad'], durations: [5, 8] });
    expect(getVideoWorkspaceConfig()).toEqual(expect.objectContaining({ maxRefImages: 7, resolutions: [1080, 720], sizes: ['1920x1080'], durations: [5, 8] }));
    expect(isValidVideoResolution(144)).toBe(true);
    expect(isValidVideoResolution(4321)).toBe(false);
    expect(isValidVideoSize('1280x720')).toBe(true);
    expect(isValidVideoSize('1279x720')).toBe(false);
    expect(isValidVideoDuration(60)).toBe(true);
    expect(isValidVideoDuration(61)).toBe(false);
  });
});

describe('后端视频任务契约', () => {
  it('包含独立队列、multipart 上传、上游创建轮询和 Range 播放', () => {
    expect(serverSource).toContain("Busboy({");
    expect(serverSource).toContain("'/v1/videos/generations'");
    expect(serverSource).toContain('function drainVideoQueue()');
    expect(serverSource).toContain("apiPathname === '/api/flyreq/video-tasks'");
    expect(serverSource).toContain("'Accept-Ranges': 'bytes'");
  });

  it('通过环境变量下发附件限制和视频参数数组', () => {
    expect(serverSource).toContain('FLYREQ_VIDEO_MAX_REF_VIDEOS');
    expect(serverSource).toContain('FLYREQ_VIDEO_MAX_REF_AUDIOS');
    expect(serverSource).toContain('FLYREQ_VIDEO_MAX_REF_IMAGES');
    expect(serverSource).toContain('FLYREQ_VIDEO_RESOLUTIONS');
    expect(serverSource).toContain('defaultVideoModel: resolveDefaultVideoModelConfig(env)');
    expect(serverSource).toContain('videoWorkspace: resolveVideoWorkspaceConfig(env)');
    expect(serverSource).toContain("body.append('reference_images'");
  });
});
