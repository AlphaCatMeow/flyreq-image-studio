/** 单个视频附加提示词在上游请求中的固定分隔文本。 */
const VIDEO_PROMPT_VARIANT_SEPARATOR = '\n\n本个视频要求：\n';

/**
 * 组合单个视频实际发送给上游的完整提示词。
 * @param prompt 批量任务共享的主提示词。
 * @param promptVariant 当前视频的可选附加提示词。
 * @returns 包含附加提示词的完整提示词；没有附加提示词时返回主提示词。
 */
export function composeEffectiveVideoPrompt(prompt: string, promptVariant?: string): string {
  const normalizedPrompt = String(prompt || '').trim();
  const normalizedVariant = String(promptVariant || '').trim();
  if (!normalizedVariant) return normalizedPrompt;
  return normalizedPrompt ? `${normalizedPrompt}${VIDEO_PROMPT_VARIANT_SEPARATOR}${normalizedVariant}` : normalizedVariant;
}
