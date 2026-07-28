'use client';

import type { VideoProtocol } from '@/lib/flyreq-models';
import defaultVideoProtocolConfig from '../../../backend/video-protocol-capabilities.json';

export interface VideoDurationCapability {
  mode: 'enum' | 'range';
  values?: number[];
  min?: number;
  max?: number;
  presets: number[];
}

export interface VideoProtocolProfile {
  label: string;
  hidden: boolean;
  constraintSource: 'official' | 'workspace-default' | 'legacy';
  settings: { baseUrl: string; presetModelId: string };
  parameters: {
    duration: VideoDurationCapability;
    size: { visible: boolean; mode: 'enum' | 'dimensions'; values: string[]; allowCustom: boolean };
    aspectRatio: { visible: boolean; values: string[] };
    resolution: { visible: boolean; values: number[]; allowCustom: boolean };
  };
  references: { images: number; videos: number; audios: number; imageMimeTypes: string[]; imageSizeMustMatchOutput: boolean };
  modelProfiles: Array<{ modelPrefix: string; requiresImage: boolean; patch: Partial<VideoProtocolProfile> }>;
}

export interface VideoProtocolConfig {
  version: number;
  protocols: Record<VideoProtocol, VideoProtocolProfile>;
}

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
let runtimeProtocolConfig = structuredClone(defaultVideoProtocolConfig) as unknown as VideoProtocolConfig;

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
 * 应用后端下发的视频协议能力配置。
 * @param config 已由后端合并环境变量并校验的完整配置。
 * @returns 无返回值，缺失配置时恢复仓库内置官方能力。
 */
export function applyVideoProtocolConfig(config?: VideoProtocolConfig): void {
  runtimeProtocolConfig = structuredClone(config || defaultVideoProtocolConfig) as unknown as VideoProtocolConfig;
}

/**
 * 返回当前完整视频协议能力配置副本。
 * @returns 可供设置页和工作台读取的协议配置。
 */
export function getVideoProtocolConfig(): VideoProtocolConfig {
  return structuredClone(runtimeProtocolConfig);
}

/**
 * 在前端应用协议配置中的模型条件规则。
 * @param protocol 当前视频协议。
 * @param modelId 实际模型 ID。
 * @param hasImage 当前是否已选择参考图。
 * @returns 当前模型和输入状态实际生效的协议能力。
 */
export function resolveVideoProtocolProfile(protocol: VideoProtocol, modelId: string, hasImage: boolean): VideoProtocolProfile {
  const base = structuredClone(runtimeProtocolConfig.protocols[protocol]);
  for (const rule of base.modelProfiles || []) {
    if (!modelId.startsWith(rule.modelPrefix) || (rule.requiresImage && !hasImage)) continue;
    if (rule.patch.parameters?.size) base.parameters.size = { ...base.parameters.size, ...rule.patch.parameters.size };
    if (rule.patch.parameters?.resolution) base.parameters.resolution = { ...base.parameters.resolution, ...rule.patch.parameters.resolution };
    if (rule.patch.parameters?.aspectRatio) base.parameters.aspectRatio = { ...base.parameters.aspectRatio, ...rule.patch.parameters.aspectRatio };
    if (rule.patch.parameters?.duration) base.parameters.duration = { ...base.parameters.duration, ...rule.patch.parameters.duration };
    if (rule.patch.references) base.references = { ...base.references, ...rule.patch.references };
  }
  return base;
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

/**
 * 判断参考图 MIME 类型是否命中协议允许列表，支持 image/* 通配规则。
 * @param mimeType 浏览器或素材库提供的图片 MIME 类型。
 * @param allowedTypes 当前视频协议允许的 MIME 类型列表。
 * @returns 精确匹配或命中类型通配符时返回 true。
 */
export function isAllowedVideoReferenceMimeType(mimeType: string, allowedTypes: string[]): boolean {
  return allowedTypes.some(allowed => allowed === mimeType || (allowed.endsWith('/*') && mimeType.startsWith(allowed.slice(0, -1))));
}

/**
 * 返回当前视频协议可展示的时长预设。
 * @param protocol 当前视频模型协议。
 * @param configuredDurations 部署环境变量下发的通用时长预设。
 * @returns 已按协议限制过滤的时长数组。
 */
export function getVideoProtocolDurations(profile: VideoProtocolProfile): number[] {
  return [...profile.parameters.duration.presets];
}

/**
 * 校验视频时长是否满足当前模型协议限制。
 * @param protocol 当前视频模型协议。
 * @param value 用户选择或输入的秒数。
 * @returns 时长可以发送给当前协议时返回 true。
 */
export function isValidVideoProtocolDuration(profile: VideoProtocolProfile, value: number): boolean {
  if (!isValidVideoDuration(value)) return false;
  const duration = profile.parameters.duration;
  return duration.mode === 'enum'
    ? Boolean(duration.values?.includes(value))
    : value >= Number(duration.min) && value <= Number(duration.max);
}
