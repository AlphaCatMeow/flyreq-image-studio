'use client';

export interface VideoWorkspaceConfig {
  maxRefImages: number;
  maxRefVideos: number;
  maxRefAudios: number;
  resolutions: number[];
  sizes: string[];
  durations: number[];
  maxReferenceVideoBytes: number;
  maxReferenceAudioBytes: number;
  maxReferenceImageBytes: number;
}

export const DEFAULT_VIDEO_WORKSPACE_CONFIG: VideoWorkspaceConfig = {
  maxRefImages: 5,
  maxRefVideos: 5,
  maxRefAudios: 5,
  resolutions: [720, 480],
  sizes: ['1280x720', '720x1280', '1024x1024', '1792x1024', '1024x1792', 'auto'],
  durations: [6, 10, 12, 15, 20],
  maxReferenceVideoBytes: 104857600,
  maxReferenceAudioBytes: 26214400,
  maxReferenceImageBytes: 10485760,
};

let runtimeConfig: VideoWorkspaceConfig = { ...DEFAULT_VIDEO_WORKSPACE_CONFIG };

/**
 * 从未知数组中保留正整数。
 * @param value 待解析的未知值。
 * @param fallback 没有有效数组时采用的默认值。
 * @returns 规范化后的正整数数组。
 */
function normalizePositiveIntegers(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value)
    ? value.filter(item => Number.isInteger(item) && Number(item) > 0).map(Number)
    : fallback;
}

/**
 * 将后端下发的视频工作台配置收敛到安全范围。
 * @param config 后端运行时配置的可选字段。
 * @returns 无返回值，后续读取会获得规范化配置。
 */
export function applyVideoWorkspaceConfig(config?: Partial<VideoWorkspaceConfig>): void {
  const sizes = Array.isArray(config?.sizes)
    ? config.sizes.filter(item => item === 'auto' || /^\d+x\d+$/.test(String(item)))
    : DEFAULT_VIDEO_WORKSPACE_CONFIG.sizes;
  runtimeConfig = {
    maxRefImages: Number.isInteger(config?.maxRefImages) ? Math.max(1, Number(config?.maxRefImages)) : DEFAULT_VIDEO_WORKSPACE_CONFIG.maxRefImages,
    maxRefVideos: Number.isInteger(config?.maxRefVideos) ? Math.max(1, Number(config?.maxRefVideos)) : DEFAULT_VIDEO_WORKSPACE_CONFIG.maxRefVideos,
    maxRefAudios: Number.isInteger(config?.maxRefAudios) ? Math.max(1, Number(config?.maxRefAudios)) : DEFAULT_VIDEO_WORKSPACE_CONFIG.maxRefAudios,
    resolutions: normalizePositiveIntegers(config?.resolutions, DEFAULT_VIDEO_WORKSPACE_CONFIG.resolutions),
    sizes: sizes.length > 0 ? sizes : DEFAULT_VIDEO_WORKSPACE_CONFIG.sizes,
    durations: normalizePositiveIntegers(config?.durations, DEFAULT_VIDEO_WORKSPACE_CONFIG.durations),
    maxReferenceVideoBytes: Number.isInteger(config?.maxReferenceVideoBytes) ? Math.max(1, Number(config?.maxReferenceVideoBytes)) : DEFAULT_VIDEO_WORKSPACE_CONFIG.maxReferenceVideoBytes,
    maxReferenceAudioBytes: Number.isInteger(config?.maxReferenceAudioBytes) ? Math.max(1, Number(config?.maxReferenceAudioBytes)) : DEFAULT_VIDEO_WORKSPACE_CONFIG.maxReferenceAudioBytes,
    maxReferenceImageBytes: Number.isInteger(config?.maxReferenceImageBytes) ? Math.max(1, Number(config?.maxReferenceImageBytes)) : DEFAULT_VIDEO_WORKSPACE_CONFIG.maxReferenceImageBytes,
  };
}

/**
 * 返回当前生效的视频工作台配置副本。
 * @returns 可由组件安全读取的视频配置。
 */
export function getVideoWorkspaceConfig(): VideoWorkspaceConfig {
  return {
    ...runtimeConfig,
    resolutions: [...runtimeConfig.resolutions],
    sizes: [...runtimeConfig.sizes],
    durations: [...runtimeConfig.durations],
  };
}

/**
 * 校验自定义清晰度。
 * @param value 用户输入的清晰度整数。
 * @returns 144 至 4320 范围内的整数是否有效。
 */
export function isValidVideoResolution(value: number): boolean {
  return Number.isInteger(value) && value >= 144 && value <= 4320;
}

/**
 * 校验自定义视频尺寸。
 * @param value 用户输入的宽高字符串。
 * @returns 宽高均处于 64 至 4096 且为 8 的倍数时返回 true。
 */
export function isValidVideoSize(value: string): boolean {
  const match = value.trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return [width, height].every(side => side >= 64 && side <= 4096 && side % 8 === 0);
}

/**
 * 校验自定义视频时长。
 * @param value 用户输入的秒数。
 * @returns 1 至 60 范围内的整数是否有效。
 */
export function isValidVideoDuration(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 60;
}
