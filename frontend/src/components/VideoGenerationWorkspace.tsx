'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Check, CircleStop, Clock3, CloudUpload, Download, FileImage, Images, Info, Loader2, Maximize, RefreshCw, ScanLine, Sparkles, Trash2, Video, X } from 'lucide-react';
import { useI18n } from '@/components/LanguageProvider';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { AgentAssetPickerDialog } from '@/components/agent/AgentAssetPickerDialog';
import { PromptOptimizeDialog } from '@/components/PromptOptimizeDialog';
import { PromptSubmissionShortcutMenu } from '@/components/PromptSubmissionShortcutMenu';
import { usePromptOptimizeSetting } from '@/hooks/usePromptOptimizeSetting';
import { usePromptSubmissionShortcut } from '@/hooks/usePromptSubmissionShortcut';
import { getCompleteVideoModels, getDefaultVideoModel, getResolvedVideoModelId, loadRegistry, type VideoModelConfig } from '@/lib/flyreq-models';
import { acknowledgeVideoTask, cancelVideoTask, createVideoTask, getVideoTask } from '@/lib/video-task-client';
import {
  cacheVideoBlob,
  deleteVideoBlob,
  loadVideoJobs,
  restoreVideoBlobUrl,
  saveVideoJobs,
  type StoredVideoJob,
} from '@/lib/video-job-store';
import { getVideoProtocolDurations, getVideoWorkspaceConfig, isAllowedVideoReferenceMimeType, isValidVideoDuration, isValidVideoProtocolDuration, isValidVideoResolution, isValidVideoSize, resolveVideoProtocolProfile } from '@/lib/video-config';
import { generateModelId } from '@/lib/flyreq-models';
import { requireDefaultConfiguredTextModel } from '@/lib/model-endpoints';
import { streamPromptOptimize, type StreamPromptOptimizeHandle } from '@/lib/prompt-optimize-client';
import { getAssetBlob, type ImageAsset } from '@/lib/asset-store';
import { cn } from '@/lib/utils';

interface VideoGenerationWorkspaceProps {
  wideMode?: boolean;
  onConfigureApiKey: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface MediaAttachmentTileProps {
  file: File;
  onRemove: () => void;
}

interface VideoSizePreviewProps {
  size: string;
  selected: boolean;
}

/**
 * 将视频尺寸换算为固定预览区域内的像素尺寸。
 * @param size 视频尺寸，格式为“宽x高”或“auto”。
 * @returns 不超过 48×36 像素的画幅预览框宽高。
 */
function getVideoSizePreviewDimensions(size: string): { width: number; height: number } {
  if (size === 'auto') return { width: 38, height: 28 };
  const match = size.match(/^(\d+)x(\d+)$/i);
  if (!match) return { width: 32, height: 32 };
  const widthRatio = Number(match[1]);
  const heightRatio = Number(match[2]);
  const scale = Math.min(48 / widthRatio, 36 / heightRatio);
  return {
    width: Math.max(6, widthRatio * scale),
    height: Math.max(6, heightRatio * scale),
  };
}

/**
 * 根据视频尺寸方向生成当前语言下的直观画幅名称。
 * @param size 视频尺寸，格式为“宽x高”或“auto”。
 * @param t 多语言翻译方法。
 * @returns 方形、横屏、竖屏等画幅名称。
 */
function getVideoSizeDisplayName(size: string, t: ReturnType<typeof useI18n>['t']): string {
  if (size === 'auto') return t('aspectRatio.auto');
  const match = size.match(/^(\d+)x(\d+)$/i);
  if (!match) return size;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width === height) return t('aspectRatio.square');
  if (width / height >= 2) return t('aspectRatio.panorama');
  if (height / width >= 2) return t('aspectRatio.tallPortrait');
  return width > height ? t('aspectRatio.landscape') : t('aspectRatio.portrait');
}

/**
 * 渲染能够直观看出视频输出方向的画幅预览框。
 * @param props 当前视频尺寸和选中状态。
 * @returns 固定区域内按真实宽高比缩放的轮廓框。
 */
function VideoSizePreview({ size, selected }: VideoSizePreviewProps) {
  const dimensions = getVideoSizePreviewDimensions(size);
  return (
    <div className="flex h-10 w-full items-center justify-center" aria-hidden="true">
      <span
        data-testid={`video-size-preview-${size.replace(/[^0-9a-z]+/gi, '-')}`}
        className={cn(
          'flex items-center justify-center rounded-[3px] border-2 transition-colors',
          selected ? 'border-primary bg-primary/10' : 'border-muted-foreground/70 bg-background',
          size === 'auto' && 'border-dashed',
        )}
        style={{ width: dimensions.width, height: dimensions.height }}
      >
        {size === 'auto' && <Sparkles className="size-3 text-muted-foreground" />}
      </span>
    </div>
  );
}

/**
 * 渲染与生图工作台附件缩略块一致的参考图片。
 * @param props 图片文件和删除回调。
 * @returns 带预览、类型标记和删除按钮的固定尺寸图片块。
 */
function MediaAttachmentTile({ file, onRemove }: MediaAttachmentTileProps) {
  const [previewUrl] = useState(() => URL.createObjectURL(file));

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  return (
    <div className="group relative h-16 w-16 shrink-0 overflow-visible">
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-muted">
        <img src={previewUrl} alt={file.name} className="h-full w-full object-cover" />
      </div>
      <div className="absolute bottom-0.5 left-0.5 max-w-[60px] truncate rounded bg-black/70 px-1 py-0.5 text-[9px] leading-none text-white">IMG</div>
      <Button type="button" variant="secondary" size="icon-xs" onClick={onRemove} className="absolute -right-1 -top-1 z-10 rounded-full" title={file.name}>
        <X className="size-3" />
      </Button>
    </div>
  );
}

/**
 * 将任务时间转换为当前语言环境的短日期时间。
 * @param value ISO 时间文本。
 * @param locale 当前界面语言。
 * @returns 本地化日期时间文本。
 */
function formatJobTime(value: string, locale: 'en' | 'zh'): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

/**
 * 渲染完整的视频生成工作台和任务历史。
 * @param props 宽屏状态、设置入口和全局提示回调。
 * @returns 响应式视频工作台。
 */
export function VideoGenerationWorkspace({ wideMode = false, onConfigureApiKey, showToast }: VideoGenerationWorkspaceProps) {
  const { locale, t } = useI18n();
  const config = useMemo(() => getVideoWorkspaceConfig(), []);
  const [models, setModels] = useState<VideoModelConfig[]>([]);
  const [modelId, setModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [resolution, setResolution] = useState(config.resolutions[0] || 720);
  const [customResolution, setCustomResolution] = useState('');
  const [resolutionMode, setResolutionMode] = useState<'preset' | 'custom'>('preset');
  const [videoSize, setVideoSize] = useState(config.sizes[0] || '1280x720');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [customWidth, setCustomWidth] = useState('');
  const [customHeight, setCustomHeight] = useState('');
  const [sizeMode, setSizeMode] = useState<'preset' | 'custom'>('preset');
  const [seconds, setSeconds] = useState(config.durations[0] || 6);
  const [customSeconds, setCustomSeconds] = useState('');
  const [durationMode, setDurationMode] = useState<'preset' | 'custom'>('preset');
  const [jobs, setJobs] = useState<StoredVideoJob[]>(() => loadVideoJobs());
  const [submitting, setSubmitting] = useState(false);
  const [cancellingTaskIds, setCancellingTaskIds] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizedText, setOptimizedText] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const optimizeHandleRef = useRef<StreamPromptOptimizeHandle | null>(null);
  const jobsRef = useRef(jobs);
  const { enabled: promptOptimizeEnabled, available: promptOptimizeAvailable } = usePromptOptimizeSetting();
  const promptOptimizeUsable = promptOptimizeEnabled && promptOptimizeAvailable;
  const { submissionShortcut, isSmallViewport, updateSubmissionShortcut } = usePromptSubmissionShortcut();
  const selectedModel = useMemo(() => models.find(model => model.id === modelId), [modelId, models]);
  const protocolProfile = useMemo(
    () => resolveVideoProtocolProfile(selectedModel?.protocol || 'new-api', selectedModel ? getResolvedVideoModelId(selectedModel) : '', referenceImages.length > 0),
    [referenceImages.length, selectedModel],
  );
  const maxReferenceImages = Math.min(config.maxRefImages, protocolProfile.references.images);
  const durationOptions = useMemo(() => getVideoProtocolDurations(protocolProfile), [protocolProfile]);
  const durationPlaceholder = protocolProfile.parameters.duration.mode === 'enum'
    ? durationOptions.join('/')
    : `${protocolProfile.parameters.duration.min}-${protocolProfile.parameters.duration.max} ${t('video.secondsUnit')}`;

  /** 当模型或协议改变附件约束时，立即移除格式不兼容或超过数量上限的参考图。 */
  useEffect(() => {
    const supportedImages = referenceImages.filter(file => isAllowedVideoReferenceMimeType(file.type, protocolProfile.references.imageMimeTypes));
    const nextImages = supportedImages.slice(0, maxReferenceImages);
    const removedUnsupportedImages = supportedImages.length !== referenceImages.length;
    const removedExcessImages = supportedImages.length > maxReferenceImages;
    if (!removedUnsupportedImages && !removedExcessImages) return;
    setReferenceImages(nextImages);
    if (removedUnsupportedImages) showToast(t('video.unsupportedReferenceImageFormat'), 'error');
    if (removedExcessImages) showToast(t('video.imageLimit', { max: maxReferenceImages }), 'error');
  }, [maxReferenceImages, protocolProfile.references.imageMimeTypes, referenceImages, showToast, t]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => () => {
    // 第一步终止仍在读取的提示词优化流，避免卸载后继续执行状态回调。
    optimizeHandleRef.current?.abort();
    optimizeHandleRef.current = null;
    // 第二步释放历史任务创建的对象 URL；IndexedDB 中的原始 Blob 保持不变，可在下次进入时重新恢复。
    for (const job of jobsRef.current) {
      if (job.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(job.videoUrl);
    }
  }, []);

  useEffect(() => {
    /** 从本地注册表同步视频模型列表和默认模型。 */
    const refreshModels = () => {
      const registry = loadRegistry();
      const complete = getCompleteVideoModels(registry);
      setModels(complete);
      setModelId(current => complete.some(model => model.id === current) ? current : getDefaultVideoModel(registry)?.id || complete[0]?.id || '');
    };
    refreshModels();
    window.addEventListener('flyreq-model-registry-updated', refreshModels);
    return () => window.removeEventListener('flyreq-model-registry-updated', refreshModels);
  }, []);

  useEffect(() => { saveVideoJobs(jobs); }, [jobs]);

  useEffect(() => {
    let cancelled = false;
    const pendingRestore = jobs.filter(job => job.cached && !job.videoUrl);
    if (pendingRestore.length === 0) return;
    Promise.all(pendingRestore.map(async job => {
      try {
        return { id: job.id, url: await restoreVideoBlobUrl(job.id) };
      } catch {
        return { id: job.id, url: undefined };
      }
    }))
      .then(restored => {
        if (cancelled) {
          // 恢复完成前组件已卸载时，立即释放刚创建且不会进入界面的对象 URL。
          for (const item of restored) {
            if (item.url?.startsWith('blob:')) URL.revokeObjectURL(item.url);
          }
          return;
        }
        setJobs(current => current.map(job => {
          const restoredItem = restored.find(item => item.id === job.id);
          if (!restoredItem) return job;
          if (restoredItem.url) return { ...job, videoUrl: restoredItem.url };
          // 元数据声明已缓存但 Blob 已缺失时只写入一次终态，避免 effect 持续恢复和更新。
          return {
            ...job,
            status: 'failed',
            cached: false,
            error: t('video.cachedResultMissing'),
          };
        }));
      });
    return () => { cancelled = true; };
  }, [jobs, t]);

  /**
   * 查询所有未结束任务，并在完成后缓存视频结果。
   * @returns 无返回值，任务状态通过 React 状态更新。
   */
  const refreshPendingJobs = useCallback(async (): Promise<void> => {
    const pending = jobs.filter(job => job.serverTaskId && (job.status === '排队中' || job.status === 'processing'));
    await Promise.all(pending.map(async job => {
      try {
        const task = await getVideoTask(job.serverTaskId!);
        if (task.status === 'completed' && task.result?.videoUrl) {
          let videoUrl = task.result.videoUrl;
          let cached = false;
          try {
            videoUrl = await cacheVideoBlob(job.id, task.result.videoUrl);
            cached = true;
            await acknowledgeVideoTask(job.serverTaskId!);
          } catch {
            cached = false;
          }
          setJobs(current => current.map(item => item.id === job.id ? { ...item, status: 'completed', completedAt: task.completedAt, videoUrl, cached } : item));
        } else if (task.status === 'cancelled') {
          setJobs(current => current.map(item => item.id === job.id ? { ...item, status: 'cancelled', error: task.error || t('video.cancelled') } : item));
        } else if (task.status === 'failed' || task.status === 'expired') {
          setJobs(current => current.map(item => item.id === job.id ? { ...item, status: 'failed', error: task.error || t('video.failed') } : item));
        } else {
          setJobs(current => current.map(item => item.id === job.id ? { ...item, status: task.status === 'queued' ? '排队中' : task.status as '排队中' | 'processing' } : item));
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : t('video.failed'), 'error');
      }
    }));
  }, [jobs, showToast, t]);

  useEffect(() => {
    if (!jobs.some(job => job.status === '排队中' || job.status === 'processing')) return;
    const timer = window.setInterval(() => void refreshPendingJobs(), 5000);
    return () => window.clearInterval(timer);
  }, [jobs, refreshPendingJobs]);

  /**
   * 校验并添加用户选择或拖入的参考图片。
   * @param files 待分类处理的文件列表。
   * @returns 无返回值，合法文件会追加到对应状态。
   */
  const addReferenceFiles = useCallback((files: File[]) => {
    const images = files.filter(file => file.type.startsWith('image/'));
    if (images.length !== files.length) showToast(t('video.unsupportedReferenceMedia'), 'error');
    const supportedImages = images.filter(file => isAllowedVideoReferenceMimeType(file.type, protocolProfile.references.imageMimeTypes));
    if (supportedImages.length !== images.length) showToast(t('video.unsupportedReferenceImageFormat'), 'error');
    const validImages = supportedImages.filter(file => {
      if (file.size <= config.maxReferenceImageBytes) return true;
      showToast(t('video.imageTooLarge', { size: Math.round(config.maxReferenceImageBytes / 1024 / 1024) }), 'error');
      return false;
    });
    setReferenceImages(current => {
      if (current.length + validImages.length > maxReferenceImages) showToast(t('video.imageLimit', { max: maxReferenceImages }), 'error');
      return [...current, ...validImages].slice(0, maxReferenceImages);
    });
  }, [config.maxReferenceImageBytes, maxReferenceImages, protocolProfile.references.imageMimeTypes, showToast, t]);

  /**
   * 将素材库图片转换为参考图文件并追加到上传列表。
   * @param selectedAssets 用户在素材库中确认的图片素材。
   * @returns 无返回值，素材读取完成后更新参考图状态。
   */
  const handleImportImageAssets = useCallback(async (selectedAssets: ImageAsset[]): Promise<void> => {
    const remaining = Math.max(0, maxReferenceImages - referenceImages.length);
    if (remaining === 0) {
      showToast(t('video.imageLimit', { max: maxReferenceImages }), 'error');
      return;
    }
    try {
      const imported: File[] = [];
      for (const asset of selectedAssets.slice(0, remaining)) {
        const blob = await getAssetBlob(asset.id);
        if (!blob) continue;
        const file = new File([blob], asset.name, { type: asset.mimeType || blob.type || 'image/png' });
        if (file.size > config.maxReferenceImageBytes) {
          showToast(t('video.imageTooLarge', { size: Math.round(config.maxReferenceImageBytes / 1024 / 1024) }), 'error');
          continue;
        }
        if (!isAllowedVideoReferenceMimeType(file.type, protocolProfile.references.imageMimeTypes)) {
          showToast(t('video.unsupportedReferenceImageFormat'), 'error');
          continue;
        }
        imported.push(file);
      }
      setReferenceImages(current => [...current, ...imported].slice(0, maxReferenceImages));
      if (selectedAssets.length > remaining) showToast(t('video.imageLimit', { max: maxReferenceImages }), 'error');
    } catch {
      showToast(t('video.assetImportFailed'), 'error');
    }
  }, [config.maxReferenceImageBytes, maxReferenceImages, protocolProfile.references.imageMimeTypes, referenceImages.length, showToast, t]);

  const activeResolution = resolutionMode === 'custom' ? Number(customResolution) : resolution;
  const resolutionCapability = protocolProfile.parameters.resolution;
  const activeProtocolResolution = resolutionCapability.visible && resolutionCapability.values.includes(activeResolution)
    ? activeResolution
    : (resolutionCapability.values[0] || activeResolution);
  const sizeCapability = protocolProfile.parameters.size;
  const activeVideoSize = sizeMode === 'custom'
    ? `${customWidth}x${customHeight}`
    : (sizeCapability.values.includes(videoSize) ? videoSize : (sizeCapability.values[0] || 'auto'));
  const activeAspectRatio = protocolProfile.parameters.aspectRatio.values.includes(aspectRatio)
    ? aspectRatio
    : (protocolProfile.parameters.aspectRatio.values[0] || '');
  const activeSeconds = durationMode === 'custom'
    ? Number(customSeconds)
    : (durationOptions.includes(seconds) ? seconds : durationOptions[0]);
  const activeResolutionValid = !resolutionCapability.visible
    || resolutionCapability.values.includes(activeProtocolResolution)
    || (resolutionCapability.allowCustom && isValidVideoResolution(activeProtocolResolution));
  const activeVideoSizeValid = !sizeCapability.visible
    || sizeCapability.values.includes(activeVideoSize)
    || (sizeCapability.allowCustom && isValidVideoSize(activeVideoSize));
  const activeAspectRatioValid = !protocolProfile.parameters.aspectRatio.visible || protocolProfile.parameters.aspectRatio.values.includes(activeAspectRatio);
  const activeDurationValid = Boolean(selectedModel && isValidVideoProtocolDuration(protocolProfile, activeSeconds));
  const activeReferenceImageCountValid = referenceImages.length <= maxReferenceImages;
  const activeReferenceImageMimeTypesValid = referenceImages.every(file => isAllowedVideoReferenceMimeType(file.type, protocolProfile.references.imageMimeTypes));
  const activeReferenceImagesValid = activeReferenceImageCountValid && activeReferenceImageMimeTypesValid;

  /**
   * 校验表单并创建视频任务。
   * @returns 无返回值，成功后追加本地历史任务。
   */
  const handleSubmit = useCallback(async () => {
    if (!selectedModel) { onConfigureApiKey(); return; }
    if (!prompt.trim()) { showToast(t('video.promptRequired'), 'error'); return; }
    if (!activeResolutionValid) { showToast(t('video.invalidResolution'), 'error'); return; }
    if (!activeVideoSizeValid || !activeAspectRatioValid) { showToast(t('video.invalidSize'), 'error'); return; }
    if (!activeDurationValid) { showToast(t('video.invalidDuration'), 'error'); return; }
    if (!activeReferenceImageCountValid) { showToast(t('video.imageLimit', { max: maxReferenceImages }), 'error'); return; }
    if (!activeReferenceImageMimeTypesValid) { showToast(t('video.unsupportedReferenceImageFormat'), 'error'); return; }
    const job: StoredVideoJob = {
      id: generateModelId('video_job'),
      status: '排队中',
      prompt: prompt.trim(),
      modelId: selectedModel.id,
      protocol: selectedModel.protocol,
      resolution: activeProtocolResolution,
      videoSize: activeVideoSize,
      aspectRatio: activeAspectRatio,
      seconds: activeSeconds,
      referenceVideos: [],
      referenceAudios: [],
      referenceImages: referenceImages.map(file => ({ name: file.name, type: file.type, size: file.size })),
      createdAt: new Date().toISOString(),
    };
    setJobs(current => [job, ...current]);
    setSubmitting(true);
    try {
      const serverTaskId = await createVideoTask({ model: selectedModel, prompt: job.prompt, resolution: activeProtocolResolution, size: activeVideoSize, aspectRatio: activeAspectRatio, seconds: activeSeconds, referenceImages });
      setJobs(current => current.map(item => item.id === job.id ? { ...item, serverTaskId } : item));
      setReferenceImages([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('video.failed');
      setJobs(current => current.map(item => item.id === job.id ? { ...item, status: 'failed', error: message } : item));
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }, [activeAspectRatio, activeAspectRatioValid, activeDurationValid, activeProtocolResolution, activeReferenceImageCountValid, activeReferenceImageMimeTypesValid, activeResolutionValid, activeSeconds, activeVideoSize, activeVideoSizeValid, maxReferenceImages, onConfigureApiKey, prompt, referenceImages, selectedModel, showToast, t]);

  /**
   * 使用默认文本模型流式优化当前视频提示词。
   * @returns 无返回值，优化过程和结果通过弹窗状态展示。
   */
  const handleOptimize = useCallback(() => {
    if (!prompt.trim() || !promptOptimizeUsable) return;
    let textModel;
    try {
      textModel = requireDefaultConfiguredTextModel('promptOptimize');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('workbench.configureDefaultTextModel'), 'error');
      return;
    }

    optimizeHandleRef.current?.abort();
    setOptimizedText('');
    setOptimizeError(null);
    setOptimizing(true);
    setOptimizeOpen(true);
    optimizeHandleRef.current = streamPromptOptimize(
      { apiKey: textModel.apiKey, protocol: textModel.protocol, model: textModel.modelId, mode: 'video', prompt: prompt.trim() },
      {
        onDelta(token) { setOptimizedText(current => current + token); },
        onDone() { setOptimizing(false); },
        onError(error) { setOptimizeError(error.message); setOptimizing(false); },
      },
      textModel.baseUrl,
    );
  }, [prompt, promptOptimizeUsable, showToast, t]);

  /**
   * 取消当前视频提示词优化并清理临时结果。
   * @returns 无返回值。
   */
  const handleOptimizeCancel = useCallback(() => {
    optimizeHandleRef.current?.abort();
    optimizeHandleRef.current = null;
    setOptimizing(false);
    setOptimizedText('');
    setOptimizeError(null);
  }, []);

  /**
   * 接受优化后的视频提示词并写回输入框。
   * @returns 无返回值。
   */
  const handleOptimizeAccept = useCallback(() => {
    if (optimizedText) setPrompt(optimizedText);
    optimizeHandleRef.current = null;
    setOptimizedText('');
    setOptimizeError(null);
  }, [optimizedText]);

  /**
   * 根据共享快捷键设置处理视频提示词的发送与换行。
   * @param event 视频提示词输入框的键盘事件。
   * @returns 无返回值。
   */
  const handlePromptKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSmallViewport) return;
    const shouldSubmit = submissionShortcut === 'enter' ? !event.shiftKey : event.shiftKey;
    if (event.key === 'Enter' && shouldSubmit && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!prompt.trim() || !modelId || submitting) return;
      void handleSubmit();
    }
  }, [handleSubmit, isSmallViewport, modelId, prompt, submissionShortcut, submitting]);

  /**
   * 删除任务记录和对应浏览器视频缓存。
   * @param job 待删除的视频任务。
   * @returns 无返回值。
   */
  const removeJob = useCallback((job: StoredVideoJob) => {
    if (job.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(job.videoUrl);
    void deleteVideoBlob(job.id).catch(() => undefined);
    setJobs(current => current.filter(item => item.id !== job.id));
  }, []);

  /**
   * 请求后端取消排队中或处理中的视频任务，并同步本地历史终态。
   * @param job 待取消的视频任务记录。
   * @returns 无返回值；取消结果通过任务状态和全局提示展示。
   */
  const handleCancelJob = useCallback(async (job: StoredVideoJob): Promise<void> => {
    if (!job.serverTaskId || cancellingTaskIds.has(job.id)) return;
    setCancellingTaskIds(current => new Set(current).add(job.id));
    try {
      const task = await cancelVideoTask(job.serverTaskId);
      setJobs(current => current.map(item => item.id === job.id ? {
        ...item,
        status: 'cancelled',
        completedAt: task.completedAt || new Date().toISOString(),
        error: task.error || t('video.cancelled'),
      } : item));
      showToast(t('video.cancelled'), 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('video.cancelFailed'), 'error');
    } finally {
      setCancellingTaskIds(current => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  }, [cancellingTaskIds, showToast, t]);

  /**
   * 将历史任务参数恢复到表单，参考附件需要用户重新选择。
   * @param job 待重试的视频任务。
   * @returns 无返回值。
   */
  const restoreJob = useCallback((job: StoredVideoJob) => {
    setPrompt(job.prompt);
    setModelId(job.modelId);
    setResolution(job.resolution);
    setVideoSize(job.videoSize);
    setAspectRatio(job.aspectRatio || '16:9');
    setSeconds(job.seconds);
    setResolutionMode(config.resolutions.includes(job.resolution) ? 'preset' : 'custom');
    if (!config.resolutions.includes(job.resolution)) setCustomResolution(String(job.resolution));
    setSizeMode(config.sizes.includes(job.videoSize) ? 'preset' : 'custom');
    if (!config.sizes.includes(job.videoSize) && job.videoSize !== 'auto') {
      const [width, height] = job.videoSize.split('x');
      setCustomWidth(width); setCustomHeight(height);
    }
    const restoredModel = models.find(model => model.id === job.modelId);
    const restoredProfile = resolveVideoProtocolProfile(restoredModel?.protocol || 'new-api', restoredModel ? getResolvedVideoModelId(restoredModel) : '', false);
    const restoredDurations = getVideoProtocolDurations(restoredProfile);
    setDurationMode(restoredDurations.includes(job.seconds) ? 'preset' : 'custom');
    if (!restoredDurations.includes(job.seconds)) setCustomSeconds(String(job.seconds));
  }, [config, models]);

  /**
   * 清空当前提示词和全部参考附件，保留用户选择的视频参数。
   * @returns 无返回值。
   */
  const handleClearDraft = useCallback(() => {
    setPrompt('');
    setReferenceImages([]);
  }, []);

  const parameterButton = 'h-7 shrink-0 rounded-md border border-input bg-background px-2.5 text-xs transition-colors hover:bg-muted';
  const canClear = Boolean(prompt.trim() || referenceImages.length);
  const canSubmit = Boolean(
    prompt.trim()
    && modelId
    && !submitting
    && activeResolutionValid
    && activeVideoSizeValid
    && activeAspectRatioValid
    && activeDurationValid
    && activeReferenceImagesValid
  );

  return (
    <div className={cn('grid min-h-0 gap-5', wideMode && 'xl:h-full xl:grid-cols-[minmax(460px,0.95fr)_minmax(0,1.35fr)]')}>
      <section className={cn('space-y-4', wideMode && 'xl:overflow-y-auto xl:pr-1')}>
        <div className="space-y-1">
          <div className="flex items-center gap-2"><Video className="size-5 text-primary" /><h2 className="text-lg font-semibold">{t('video.title')}</h2></div>
          <p className="text-sm text-muted-foreground">{t('video.subtitle')}</p>
        </div>
        <div
          className={cn('overflow-hidden rounded-xl border border-border bg-muted/50 shadow-md transition-colors', dragging && 'ring-2 ring-primary/40')}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); addReferenceFiles(Array.from(event.dataTransfer.files)); }}
        >
          <>
              <div className="p-4 pb-2">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex flex-[3] flex-col justify-center rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-3 py-4 transition-colors hover:border-primary/50 hover:bg-primary/[0.07]">
                    <div className="mb-3 flex items-center justify-center gap-2 text-center">
                      <CloudUpload className="size-5 text-muted-foreground" />
                      <span className="text-sm font-medium">{t('video.referenceMediaOptional')}</span>
                    </div>
                    <label htmlFor="image-reference-input" className="group flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1 px-2 py-1.5 text-center">
                      <FileImage className="size-5 text-muted-foreground transition-colors group-hover:text-primary" />
                      <span className="max-w-full truncate text-xs font-medium sm:text-sm">{t('video.addImage')}</span>
                      <span className="text-[10px] text-muted-foreground">{t('video.attachmentCount', { count: referenceImages.length, max: maxReferenceImages })}</span>
                    </label>
                  </div>
                  <button type="button" onClick={() => setAssetPickerOpen(true)} disabled={referenceImages.length >= maxReferenceImages} className="flex min-h-28 flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-3 py-4 text-center transition-all hover:border-primary/50 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-32">
                    <Images className="size-6 text-muted-foreground" />
                    <span className="text-sm font-medium">{t('video.imageAssets')}</span>
                    <span className="text-xs text-muted-foreground">{t('assetPicker.importImageTitle')}</span>
                  </button>
                </div>
              </div>
              {referenceImages.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pb-2">
                  {referenceImages.map((file, index) => <MediaAttachmentTile key={`image-${file.name}-${file.lastModified}`} file={file} onRemove={() => setReferenceImages(current => current.filter((_, itemIndex) => itemIndex !== index))} />)}
                </div>
              )}
              <Textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={handlePromptKeyDown} placeholder={t('video.promptPlaceholder')} rows={3} className="min-h-24 resize-none rounded-none border-0 bg-transparent px-3 pt-3 placeholder:text-placeholder focus-visible:border-0 focus-visible:ring-0 sm:px-4 sm:pt-4" />
              <div className="space-y-2 px-3 pb-2 pt-2 sm:px-4">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                  <Select className="w-full sm:w-44" size="sm" value={modelId} onValueChange={setModelId} options={models.map(model => ({ value: model.id, label: model.name }))} placeholder={t('common.notConfigured')} />
                </div>
                <div data-testid="video-parameter-grid" className="grid gap-x-4 gap-y-3 md:grid-cols-3">
                  {resolutionCapability.visible && <div className="min-w-0 space-y-1.5">
                    <span className="flex h-5 items-center gap-1 text-xs font-medium text-muted-foreground"><ScanLine data-testid="video-resolution-icon" className="size-3" />{t('video.resolution')}</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {resolutionCapability.values.map(value => <button type="button" key={value} className={cn(parameterButton, resolutionMode === 'preset' && activeProtocolResolution === value && 'border-primary bg-primary/10 text-primary')} onClick={() => { setResolution(value); setResolutionMode('preset'); }}>{value}p</button>)}
                      {resolutionCapability.allowCustom && <Input className="h-7 w-24 shrink-0 rounded-md px-2 text-xs" inputMode="numeric" value={customResolution} placeholder={t('video.customResolution')} onChange={event => { setCustomResolution(event.target.value); const value = Number(event.target.value); if (isValidVideoResolution(value)) { setResolution(value); setResolutionMode('custom'); } }} />}
                    </div>
                  </div>}
                  <div className="min-w-0 space-y-1.5">
                    <span className="flex h-5 items-center gap-1 text-xs font-medium text-muted-foreground"><Clock3 className="size-3" />{t('video.seconds')}</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {durationOptions.map(value => <button type="button" key={value} className={cn(parameterButton, durationMode === 'preset' && activeSeconds === value && 'border-primary bg-primary/10 text-primary')} onClick={() => { setSeconds(value); setDurationMode('preset'); }}>{value}s</button>)}
                      {protocolProfile.parameters.duration.mode === 'range' && <Input className="h-7 w-28 shrink-0 rounded-md px-2 text-xs" inputMode="numeric" value={customSeconds} placeholder={durationPlaceholder} onChange={event => { setCustomSeconds(event.target.value); const value = Number(event.target.value); if (isValidVideoDuration(value)) { setSeconds(value); setDurationMode('custom'); } }} />}
                    </div>
                  </div>
                  {sizeCapability.visible && <div className="min-w-0 space-y-1.5">
                    <span className="flex h-5 items-center gap-1 text-xs font-medium text-muted-foreground"><Maximize className="size-3" />{t('video.size')}</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Popover>
                        <PopoverTrigger className={cn(parameterButton, sizeMode === 'preset' && 'border-primary bg-primary/10 text-primary')}>
                          {videoSize}
                        </PopoverTrigger>
                        <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-2" align="start">
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {sizeCapability.values.map(value => {
                              const selected = sizeMode === 'preset' && videoSize === value;
                              return (
                                <button
                                  type="button"
                                  key={value}
                                  onClick={() => { setVideoSize(value); setSizeMode('preset'); }}
                                  className={cn(
                                    'relative flex min-h-24 min-w-0 flex-col items-center justify-center rounded-lg border border-border bg-card px-2 py-2 text-center text-xs transition-colors hover:border-primary/50 hover:bg-muted/60',
                                    selected && 'border-primary bg-primary/5 font-medium text-primary',
                                  )}
                                >
                                  {selected && <Check className="absolute right-1.5 top-1.5 size-3.5" />}
                                  <VideoSizePreview size={value} selected={selected} />
                                  <span className="mt-1 font-medium">{getVideoSizeDisplayName(value, t)}</span>
                                  <span className="text-[10px] text-muted-foreground">{value}</span>
                                </button>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                      {sizeCapability.allowCustom && <div className="flex items-center gap-1">
                        <Input className="h-7 w-20 shrink-0 rounded-md px-2 text-xs sm:w-24" inputMode="numeric" value={customWidth} placeholder={t('video.customWidth')} onChange={event => { const width = event.target.value; setCustomWidth(width); const value = `${width}x${customHeight}`; if (isValidVideoSize(value)) { setVideoSize(value); setSizeMode('custom'); } }} />
                        <span className="text-xs text-muted-foreground">×</span>
                        <Input className="h-7 w-20 shrink-0 rounded-md px-2 text-xs sm:w-24" inputMode="numeric" value={customHeight} placeholder={t('video.customHeight')} onChange={event => { const height = event.target.value; setCustomHeight(height); const value = `${customWidth}x${height}`; if (isValidVideoSize(value)) { setVideoSize(value); setSizeMode('custom'); } }} />
                      </div>}
                    </div>
                  </div>}
                  {protocolProfile.parameters.aspectRatio.visible && <div className="min-w-0 space-y-1.5">
                    <span className="flex h-5 items-center gap-1 text-xs font-medium text-muted-foreground"><Maximize className="size-3" />{t('video.aspectRatio')}</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {protocolProfile.parameters.aspectRatio.values.map(value => <button type="button" key={value} className={cn(parameterButton, activeAspectRatio === value && 'border-primary bg-primary/10 text-primary')} onClick={() => setAspectRatio(value)}>{value}</button>)}
                    </div>
                  </div>}
                </div>
              </div>
              {models.length === 0 && (
                <div className="mx-3 mb-2 flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 sm:mx-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Info className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{t('video.modelRequiredTitle')}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t('video.modelRequiredDescription')}</p>
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onConfigureApiKey}>
                    {t('video.configureVideoModel')}
                  </Button>
                </div>
              )}
              <div className="flex justify-end gap-2 px-3 pb-3 sm:px-4">
                <PromptSubmissionShortcutMenu value={submissionShortcut} isSmallViewport={isSmallViewport} onValueChange={updateSubmissionShortcut} />
                <Button type="button" variant="ghost" size="icon" onClick={handleOptimize} disabled={!prompt.trim() || !promptOptimizeUsable} title={promptOptimizeUsable ? t('workbench.optimizePrompt') : promptOptimizeAvailable ? t('workbench.enablePromptOptimizeSetting') : t('workbench.configureDefaultTextModel')}><Sparkles className="size-4" /></Button>
                <Button type="button" variant="outline" size="icon" onClick={handleClearDraft} disabled={!canClear} title={t('workbench.clearDraft')}><X className="size-5" /></Button>
                <Button type="button" size="icon" onClick={() => void handleSubmit()} disabled={!canSubmit} title={models.length === 0 ? t('video.configureVideoModel') : t('video.generate')}>{submitting ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}</Button>
              </div>
              <input id="image-reference-input" hidden type="file" accept={protocolProfile.references.imageMimeTypes.join(',')} multiple onChange={event => { addReferenceFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
          </>
        </div>
      </section>

      <section className={cn('min-h-80 rounded-lg border bg-muted/20 p-3 sm:p-4', wideMode && 'xl:h-full xl:overflow-y-auto')}>
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">{t('video.history')}</h2><span className="text-xs text-muted-foreground">{jobs.length}</span></div>
        {jobs.length === 0 ? <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">{t('video.emptyHistory')}</div> : <div className="space-y-3">{jobs.map(job => (
          <article key={job.id} className="overflow-hidden rounded-lg border bg-card">
            {job.status === 'completed' && job.videoUrl ? <video className="aspect-video w-full bg-black object-contain" src={job.videoUrl} controls preload="metadata" /> : <div className="flex aspect-video items-center justify-center bg-muted"><div className="flex items-center gap-2 text-sm text-muted-foreground">{job.status === 'failed' || job.status === 'cancelled' ? <X className="size-5 text-destructive" /> : <Loader2 className="size-5 animate-spin" />}{job.status === 'cancelled' ? t('video.cancelled') : job.status === 'failed' ? t('video.failed') : job.status === '排队中' ? t('video.queued') : t('video.processing')}</div></div>}
            <div className="space-y-3 p-3">
              <p className="line-clamp-3 text-sm">{job.prompt}</p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">{job.protocol === 'xai' ? <><span>{job.resolution}p</span><span>{job.aspectRatio}</span></> : <span>{job.videoSize}</span>}<span className="flex items-center gap-1"><Clock3 className="size-3" />{job.seconds}s</span><span>{t('video.createdAt', { time: formatJobTime(job.createdAt, locale) })}</span></div>
              {job.error && <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{job.error}</p>}
              <div className="flex flex-wrap gap-2">
                {job.status === 'completed' && job.videoUrl && <a className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2')} href={job.videoUrl} download={`video-${job.id}.mp4`}><Download className="size-4" />{t('video.download')}</a>}
                {(job.status === '排队中' || job.status === 'processing') && <Button variant="outline" size="sm" className="gap-2" onClick={() => void refreshPendingJobs()}><RefreshCw className="size-4" />{t('video.checkStatus')}</Button>}
                {(job.status === '排队中' || job.status === 'processing') && job.serverTaskId && <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive" disabled={cancellingTaskIds.has(job.id)} onClick={() => void handleCancelJob(job)}>{cancellingTaskIds.has(job.id) ? <Loader2 className="size-4 animate-spin" /> : <CircleStop className="size-4" />}{t('video.cancel')}</Button>}
                <Button variant="outline" size="sm" className="gap-2" onClick={() => restoreJob(job)}><RefreshCw className="size-4" />{t('video.retry')}</Button>
                {job.status !== '排队中' && job.status !== 'processing' && <Button variant="ghost" size="sm" className="ml-auto gap-2 text-destructive" onClick={() => removeJob(job)}><Trash2 className="size-4" />{t('video.remove')}</Button>}
              </div>
            </div>
          </article>
        ))}</div>}
      </section>
      <AgentAssetPickerDialog
        open={assetPickerOpen}
        maxSelected={Math.max(1, maxReferenceImages - referenceImages.length)}
        onOpenChange={setAssetPickerOpen}
        onConfirm={assets => void handleImportImageAssets(assets)}
      />
      <PromptOptimizeDialog
        open={optimizeOpen}
        onOpenChange={setOptimizeOpen}
        originalPrompt={prompt}
        optimizedPrompt={optimizedText}
        loading={optimizing}
        error={optimizeError}
        onAccept={handleOptimizeAccept}
        onCancel={handleOptimizeCancel}
      />
    </div>
  );
}
