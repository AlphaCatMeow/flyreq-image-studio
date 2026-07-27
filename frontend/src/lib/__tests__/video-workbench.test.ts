import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDeploymentDefaultVideoModel,
  getCompleteVideoModels,
  getResolvedVideoModelId,
  loadRegistry,
  saveRegistry,
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
    expect(registry.videoModels[0]).toEqual(expect.objectContaining({ modelId: '', usesPresetModelId: true, presetModelId: 'grok-imagine-video', protocol: 'openai' }));
    expect(getResolvedVideoModelId(registry.videoModels[0])).toBe('grok-imagine-video');
    expect(registry.defaults).toHaveProperty('videoGeneration');
  });

  it('应用部署视频模型且仅在 API Key 完整后对工作台可用', () => {
    applyDeploymentDefaultVideoModel({ id: 'video-one', name: 'Video One', modelId: 'video-model', baseUrl: 'https://video.example.com', protocol: 'openai' });
    const registry = loadRegistry();
    expect(registry.videoModels[0].apiKey).toBe('');
    expect(registry.videoModels[0].modelId).toBe('');
    expect(registry.videoModels[0].presetModelId).toBe('video-model');
    expect(getResolvedVideoModelId(registry.videoModels[0])).toBe('video-model');
    expect(getCompleteVideoModels(registry)).toHaveLength(0);
  });

  it('保留用户填写的视频模型 ID 并覆盖预设值', () => {
    localStorage.setItem('flyreq-model-registry', JSON.stringify({
      imageModels: [],
      textModels: [],
      videoModels: [{
        id: 'video-custom',
        protocol: 'openai',
        name: 'Custom',
        modelId: 'custom-video-model',
        apiKey: 'key',
        baseUrl: 'https://video.example.com',
      }],
      defaults: { videoGeneration: 'video-custom' },
    }));
    const registry = loadRegistry();
    expect(registry.videoModels[0].modelId).toBe('custom-video-model');
    expect(registry.videoModels[0].usesPresetModelId).toBeUndefined();
    expect(getResolvedVideoModelId(registry.videoModels[0])).toBe('custom-video-model');
    expect(getCompleteVideoModels(registry)).toHaveLength(1);
  });

  it('保存空模型数组后不会重新插入部署默认模型', () => {
    const registry = loadRegistry();
    saveRegistry({
      ...registry,
      imageModels: [],
      videoModels: [],
      defaults: { ...registry.defaults, textToImage: '', imageToImage: '', videoGeneration: '' },
    });

    const reloaded = loadRegistry();
    expect(reloaded.imageModels).toEqual([]);
    expect(reloaded.videoModels).toEqual([]);
    expect(reloaded.defaults.textToImage).toBe('');
    expect(reloaded.defaults.videoGeneration).toBe('');
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
    expect(serverSource).toContain('cancelVideoTask(taskId)');
    expect(serverSource).toContain('(ack|cancel)');
    expect(serverSource).toContain('videoTaskAbortControllers');
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

  it('按附件类型限制流式缓存，且全局文件限制包含参考图片', () => {
    expect(serverSource).toContain('Math.max(config.maxReferenceVideoBytes, config.maxReferenceAudioBytes, config.maxReferenceImageBytes)');
    expect(serverSource).toContain('if (size <= maxBytes)');
    expect(serverSource).toContain('if (!exceededLimit && size <= maxBytes)');
    expect(serverSource).toContain('chunks.length = 0');
  });

  it('把已取消视频任务作为 WebSocket 订阅终态清理', () => {
    expect(serverSource).toContain('function isTerminalTaskStatus(status)');
    expect(serverSource).toContain('status === TASK_STATUS.CANCELLED');
    expect(serverSource).toContain('if (isTerminalTaskStatus(cachedPayload.task.status))');
  });

  it('视频 Range 下载正确支持文件末尾后缀范围', () => {
    expect(serverSource).toContain('const suffixLength = Number(match[2])');
    expect(serverSource).toContain('start = Math.max(0, stat.size - suffixLength)');
    expect(serverSource).toContain('start === undefined || end === undefined');
  });

  it('记录视频上游原始错误响应并提取结构化错误消息', () => {
    expect(serverSource).toContain('function logVideoUpstreamFailure(stage, url, response, responseText, context = {})');
    expect(serverSource).toContain("console.error('[video-upstream] 上游响应异常");
    expect(serverSource).toContain("logVideoUpstreamFailure('create'");
    expect(serverSource).toContain("logVideoUpstreamFailure('poll'");
    expect(serverSource).toContain("logVideoUpstreamFailure('download'");
    expect(serverSource).toContain('const extracted = getMessageFromPayload(payload)');
    expect(serverSource).not.toContain("${data?.error || responseText || '未返回任务 ID'}");
  });
});
