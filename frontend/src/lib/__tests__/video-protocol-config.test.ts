import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const loadCommonJs = createRequire(import.meta.url);
const {
  applyJsonMergePatch,
  resolveVideoProtocolConfig,
  resolveVideoProtocolProfile,
  validateVideoProtocolReferences,
  validateVideoProtocolRequest,
} = loadCommonJs(path.resolve(testDir, '../../../../backend/video-protocol-config.js'));

const emptyFiles = { images: [], videos: [], audios: [] };

describe('视频协议能力配置', () => {
  it('按 JSON Merge Patch 合并对象并整体替换数组', () => {
    expect(applyJsonMergePatch(
      { nested: { keep: true, remove: true }, values: [1, 2] },
      { nested: { remove: null }, values: [8] },
    )).toEqual({ nested: { keep: true }, values: [8] });

    const config = resolveVideoProtocolConfig({
      FLYREQ_VIDEO_PROTOCOL_CONFIG_OVERRIDES: JSON.stringify({
        protocols: { xai: { settings: { baseUrl: 'https://xai-proxy.example' }, parameters: { duration: { presets: [3, 9] } } } },
      }),
    });
    expect(config.protocols.xai.parameters.duration.presets).toEqual([3, 9]);
    expect(config.protocols.xai.settings.baseUrl).toBe('https://xai-proxy.example');
    expect(config.protocols.xai.parameters.aspectRatio.values).toContain('16:9');
  });

  it('拒绝未知协议和配置版本覆盖', () => {
    expect(() => resolveVideoProtocolConfig({
      FLYREQ_VIDEO_PROTOCOL_CONFIG_OVERRIDES: JSON.stringify({ protocols: { unknown: {} } }),
    })).toThrow('环境变量包含未知视频协议');
    expect(() => resolveVideoProtocolConfig({
      FLYREQ_VIDEO_PROTOCOL_CONFIG_OVERRIDES: JSON.stringify({ version: 2 }),
    })).toThrow('环境变量不能覆盖视频协议配置版本');
  });

  it('拒绝模型规则合并后删除必填能力字段', () => {
    expect(() => resolveVideoProtocolConfig({
      FLYREQ_VIDEO_PROTOCOL_CONFIG_OVERRIDES: JSON.stringify({
        protocols: {
          xai: {
            modelProfiles: [{
              modelPrefix: 'grok-imagine-video',
              requiresImage: false,
              patch: { parameters: { duration: null } },
            }],
          },
        },
      }),
    })).toThrow('视频模型能力规则合并结果无效');
  });

  it('拒绝与任务入口约束冲突的协议能力覆盖', () => {
    const invalidOverrides = [
      { protocols: { xai: { parameters: { duration: { presets: [30] } } } } },
      { protocols: { xai: { parameters: { size: { values: ['not-a-size'] } } } } },
      { protocols: { xai: { parameters: { aspectRatio: { values: ['not-a-ratio'] } } } } },
      { protocols: { xai: { parameters: { resolution: { values: [5000] } } } } },
      { protocols: { xai: { references: { images: 2 } } } },
      { protocols: { xai: { references: { videos: 1 } } } },
      { protocols: { xai: { references: { imageMimeTypes: ['text/plain'] } } } },
    ];

    for (const override of invalidOverrides) {
      expect(() => resolveVideoProtocolConfig({
        FLYREQ_VIDEO_PROTOCOL_CONFIG_OVERRIDES: JSON.stringify(override),
      })).toThrow();
    }
  });

  it('按 Sora 模型规则扩展尺寸枚举', () => {
    const config = resolveVideoProtocolConfig({});
    const standard = resolveVideoProtocolProfile(config, 'openai', 'sora-2');
    const pro = resolveVideoProtocolProfile(config, 'openai', 'sora-2-pro');
    expect(standard.parameters.size.values).toEqual(['1280x720', '720x1280']);
    expect(pro.parameters.size.values).toContain('1920x1080');
    expect(pro.parameters.duration.values).toEqual([4, 8, 12, 16, 20]);
  });

  it('仅允许 xAI 1.5 图生视频使用 1080p', () => {
    const config = resolveVideoProtocolConfig({});
    const request = { seconds: 10, size: 'auto', aspectRatio: '16:9', resolution: 1080 };
    expect(() => validateVideoProtocolRequest(config, 'xai', 'grok-imagine-video-1.5', request, emptyFiles)).toThrow('视频清晰度不符合当前协议限制');
    expect(() => validateVideoProtocolRequest(config, 'xai', 'grok-imagine-video-1.5', request, {
      ...emptyFiles,
      images: [{}],
    })).not.toThrow();
  });

  it('使用同一能力配置拒绝非法时长、宽高比和附件', () => {
    const config = resolveVideoProtocolConfig({});
    expect(() => validateVideoProtocolRequest(config, 'openai', 'sora-2', {
      seconds: 6,
      size: '1280x720',
      aspectRatio: '',
      resolution: 720,
    }, emptyFiles)).toThrow('视频时长不符合当前协议限制');
    expect(() => validateVideoProtocolRequest(config, 'xai', 'grok-imagine-video', {
      seconds: 10,
      size: 'auto',
      aspectRatio: '21:9',
      resolution: 720,
    }, emptyFiles)).toThrow('视频宽高比不符合当前协议限制');
    expect(() => validateVideoProtocolRequest(config, 'new-api', 'video-model', {
      seconds: 10,
      size: '1280x720',
      aspectRatio: '',
      resolution: 720,
    }, { images: [{}, {}], videos: [], audios: [] })).toThrow('参考附件不符合当前协议限制');
  });

  it('按 OpenAI 官方要求校验参考图格式与输出尺寸', async () => {
    const config = resolveVideoProtocolConfig({});
    const profile = resolveVideoProtocolProfile(config, 'openai', 'sora-2');
    const imageBuffer = await sharp({
      create: { width: 4, height: 2, channels: 3, background: '#000000' },
    }).png().toBuffer();
    const validFiles = { ...emptyFiles, images: [{ mimeType: 'image/png', buffer: imageBuffer }] };

    await expect(validateVideoProtocolReferences(profile, { size: '4x2' }, validFiles)).resolves.toBeUndefined();
    await expect(validateVideoProtocolReferences(profile, { size: '2x4' }, validFiles)).rejects.toThrow('参考图尺寸必须与视频尺寸一致');
    await expect(validateVideoProtocolReferences(profile, { size: '4x2' }, {
      ...emptyFiles,
      images: [{ mimeType: 'image/gif', buffer: imageBuffer }],
    })).rejects.toThrow('参考图格式不符合当前协议限制');
  });
});
