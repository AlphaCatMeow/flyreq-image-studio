import type { VideoModelConfig } from '@/lib/flyreq-models';

export type VideoTaskStatus = 'queued' | '排队中' | 'processing' | 'completed' | 'failed' | 'expired';

export interface VideoTaskResponse {
  id: string;
  status: VideoTaskStatus;
  result?: { videoUrl?: string; upstreamTaskId?: string };
  error?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface CreateVideoTaskInput {
  model: VideoModelConfig;
  prompt: string;
  resolution: number;
  size: string;
  seconds: number;
  referenceVideos: File[];
  referenceAudios: File[];
  referenceImages: File[];
}

/**
 * 从失败响应中提取可展示错误。
 * @param response 后端 HTTP 响应。
 * @returns 始终抛出包含后端错误文本的异常。
 */
async function throwVideoTaskError(response: Response): Promise<never> {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  throw new Error(data?.error || `视频任务请求失败: ${response.status}`);
}

/**
 * 创建一个视频生成任务并上传参考附件。
 * @param input 模型、提示词、参数和参考附件。
 * @returns 后端视频任务标识。
 */
export async function createVideoTask(input: CreateVideoTaskInput): Promise<string> {
  const formData = new FormData();
  formData.set('apiKey', input.model.apiKey);
  formData.set('baseUrl', input.model.baseUrl);
  formData.set('model', input.model.modelId);
  formData.set('prompt', input.prompt);
  formData.set('resolution', String(input.resolution));
  formData.set('size', input.size);
  formData.set('seconds', String(input.seconds));
  input.referenceVideos.forEach(file => formData.append('reference_videos', file, file.name));
  input.referenceAudios.forEach(file => formData.append('reference_audios', file, file.name));
  input.referenceImages.forEach(file => formData.append('reference_images', file, file.name));
  const response = await fetch('/api/flyreq/video-tasks', { method: 'POST', body: formData });
  if (!response.ok) return throwVideoTaskError(response);
  const data = await response.json() as { taskId?: string };
  if (!data.taskId) throw new Error('后端未返回视频任务 ID');
  return data.taskId;
}

/**
 * 查询视频任务当前状态。
 * @param taskId 后端视频任务标识。
 * @returns 视频任务快照。
 */
export async function getVideoTask(taskId: string): Promise<VideoTaskResponse> {
  const response = await fetch(`/api/flyreq/video-tasks/${encodeURIComponent(taskId)}`, { cache: 'no-store' });
  if (!response.ok && response.status !== 404) return throwVideoTaskError(response);
  return response.json() as Promise<VideoTaskResponse>;
}

/**
 * 确认视频结果已在浏览器完成缓存。
 * @param taskId 后端视频任务标识。
 * @returns 无返回值。
 */
export async function acknowledgeVideoTask(taskId: string): Promise<void> {
  await fetch(`/api/flyreq/video-tasks/${encodeURIComponent(taskId)}/ack`, { method: 'POST' });
}
