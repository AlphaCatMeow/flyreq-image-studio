'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUp, AudioLines, Clock3, CloudUpload, Download, FileImage, FileVideo, Images, Info, Loader2, Maximize, RefreshCw, Sparkles, Trash2, Video, X } from 'lucide-react';
import { useI18n } from '@/components/LanguageProvider';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { AgentAssetPickerDialog } from '@/components/agent/AgentAssetPickerDialog';
import { getCompleteVideoModels, getDefaultVideoModel, loadRegistry, type VideoModelConfig } from '@/lib/flyreq-models';
import { acknowledgeVideoTask, createVideoTask, getVideoTask } from '@/lib/video-task-client';
import {
  cacheVideoBlob,
  deleteVideoBlob,
  loadVideoJobs,
  restoreVideoBlobUrl,
  saveVideoJobs,
  type StoredVideoJob,
} from '@/lib/video-job-store';
import { getVideoWorkspaceConfig, isValidVideoDuration, isValidVideoResolution, isValidVideoSize } from '@/lib/video-config';
import { generateModelId } from '@/lib/flyreq-models';
import { getAssetBlob, type ImageAsset } from '@/lib/asset-store';
import { cn } from '@/lib/utils';

interface VideoGenerationWorkspaceProps {
  wideMode?: boolean;
  onConfigureApiKey: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface MediaAttachmentTileProps {
  file: File;
  kind: 'image' | 'video' | 'audio';
  onRemove: () => void;
}

/**
 * 渲染与生图工作台附件缩略块一致的媒体附件。
 * @param props 文件、媒体类型和删除回调。
 * @returns 带预览、类型标记和删除按钮的固定尺寸附件块。
 */
function MediaAttachmentTile({ file, kind, onRemove }: MediaAttachmentTileProps) {
  const [previewUrl] = useState(() => kind === 'audio' ? '' : URL.createObjectURL(file));

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  return (
    <div className="group relative h-16 w-16 shrink-0 overflow-visible">
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {kind === 'image' && previewUrl ? <img src={previewUrl} alt={file.name} className="h-full w-full object-cover" /> : null}
        {kind === 'video' && previewUrl ? <video src={previewUrl} className="h-full w-full object-cover" muted preload="metadata" /> : null}
        {kind === 'audio' ? <AudioLines className="size-6 text-muted-foreground" /> : null}
      </div>
      <div className="absolute bottom-0.5 left-0.5 max-w-[60px] truncate rounded bg-black/70 px-1 py-0.5 text-[9px] leading-none text-white">{kind === 'image' ? 'IMG' : kind === 'video' ? 'VIDEO' : 'AUDIO'}</div>
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
  const [referenceVideos, setReferenceVideos] = useState<File[]>([]);
  const [referenceAudios, setReferenceAudios] = useState<File[]>([]);
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [resolution, setResolution] = useState(config.resolutions[0] || 720);
  const [customResolution, setCustomResolution] = useState('');
  const [resolutionMode, setResolutionMode] = useState<'preset' | 'custom'>('preset');
  const [videoSize, setVideoSize] = useState(config.sizes[0] || '1280x720');
  const [customWidth, setCustomWidth] = useState('');
  const [customHeight, setCustomHeight] = useState('');
  const [sizeMode, setSizeMode] = useState<'preset' | 'custom'>('preset');
  const [seconds, setSeconds] = useState(config.durations[0] || 6);
  const [customSeconds, setCustomSeconds] = useState('');
  const [durationMode, setDurationMode] = useState<'preset' | 'custom'>('preset');
  const [jobs, setJobs] = useState<StoredVideoJob[]>(() => loadVideoJobs());
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);

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
    Promise.all(pendingRestore.map(async job => ({ id: job.id, url: await restoreVideoBlobUrl(job.id) })))
      .then(restored => {
        if (cancelled) return;
        setJobs(current => current.map(job => ({ ...job, videoUrl: restored.find(item => item.id === job.id)?.url || job.videoUrl })));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [jobs]);

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
   * 校验并添加用户选择或拖入的参考附件。
   * @param files 待分类处理的文件列表。
   * @returns 无返回值，合法文件会追加到对应状态。
   */
  const addReferenceFiles = useCallback((files: File[]) => {
    const videos = files.filter(file => file.type.startsWith('video/'));
    const audios = files.filter(file => file.type.startsWith('audio/'));
    const images = files.filter(file => file.type.startsWith('image/'));
    const validVideos = videos.filter(file => {
      if (file.size <= config.maxReferenceVideoBytes) return true;
      showToast(t('video.videoTooLarge', { size: Math.round(config.maxReferenceVideoBytes / 1024 / 1024) }), 'error');
      return false;
    });
    const validAudios = audios.filter(file => {
      if (file.size <= config.maxReferenceAudioBytes) return true;
      showToast(t('video.audioTooLarge', { size: Math.round(config.maxReferenceAudioBytes / 1024 / 1024) }), 'error');
      return false;
    });
    const validImages = images.filter(file => {
      if (file.size <= config.maxReferenceImageBytes) return true;
      showToast(t('video.imageTooLarge', { size: Math.round(config.maxReferenceImageBytes / 1024 / 1024) }), 'error');
      return false;
    });
    setReferenceVideos(current => {
      if (current.length + validVideos.length > config.maxRefVideos) showToast(t('video.videoLimit', { max: config.maxRefVideos }), 'error');
      return [...current, ...validVideos].slice(0, config.maxRefVideos);
    });
    setReferenceAudios(current => {
      if (current.length + validAudios.length > config.maxRefAudios) showToast(t('video.audioLimit', { max: config.maxRefAudios }), 'error');
      return [...current, ...validAudios].slice(0, config.maxRefAudios);
    });
    setReferenceImages(current => {
      if (current.length + validImages.length > config.maxRefImages) showToast(t('video.imageLimit', { max: config.maxRefImages }), 'error');
      return [...current, ...validImages].slice(0, config.maxRefImages);
    });
  }, [config, showToast, t]);

  /**
   * 将素材库图片转换为参考图文件并追加到上传列表。
   * @param selectedAssets 用户在素材库中确认的图片素材。
   * @returns 无返回值，素材读取完成后更新参考图状态。
   */
  const handleImportImageAssets = useCallback(async (selectedAssets: ImageAsset[]): Promise<void> => {
    const remaining = Math.max(0, config.maxRefImages - referenceImages.length);
    if (remaining === 0) {
      showToast(t('video.imageLimit', { max: config.maxRefImages }), 'error');
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
        imported.push(file);
      }
      setReferenceImages(current => [...current, ...imported].slice(0, config.maxRefImages));
      if (selectedAssets.length > remaining) showToast(t('video.imageLimit', { max: config.maxRefImages }), 'error');
    } catch {
      showToast(t('video.assetImportFailed'), 'error');
    }
  }, [config, referenceImages.length, showToast, t]);

  /**
   * 校验表单并创建视频任务。
   * @returns 无返回值，成功后追加本地历史任务。
   */
  const handleSubmit = useCallback(async () => {
    const selectedModel = models.find(model => model.id === modelId);
    if (!selectedModel) { onConfigureApiKey(); return; }
    if (!prompt.trim()) { showToast(t('video.promptRequired'), 'error'); return; }
    if (!isValidVideoResolution(resolution)) { showToast(t('video.invalidResolution'), 'error'); return; }
    if (!isValidVideoSize(videoSize) && videoSize !== 'auto') { showToast(t('video.invalidSize'), 'error'); return; }
    if (!isValidVideoDuration(seconds)) { showToast(t('video.invalidDuration'), 'error'); return; }
    const job: StoredVideoJob = {
      id: generateModelId('video_job'),
      status: '排队中',
      prompt: prompt.trim(),
      modelId: selectedModel.id,
      resolution,
      videoSize,
      seconds,
      referenceVideos: referenceVideos.map(file => ({ name: file.name, type: file.type, size: file.size })),
      referenceAudios: referenceAudios.map(file => ({ name: file.name, type: file.type, size: file.size })),
      referenceImages: referenceImages.map(file => ({ name: file.name, type: file.type, size: file.size })),
      createdAt: new Date().toISOString(),
    };
    setJobs(current => [job, ...current]);
    setSubmitting(true);
    try {
      const serverTaskId = await createVideoTask({ model: selectedModel, prompt: job.prompt, resolution, size: videoSize, seconds, referenceVideos, referenceAudios, referenceImages });
      setJobs(current => current.map(item => item.id === job.id ? { ...item, serverTaskId } : item));
      setReferenceVideos([]);
      setReferenceAudios([]);
      setReferenceImages([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('video.failed');
      setJobs(current => current.map(item => item.id === job.id ? { ...item, status: 'failed', error: message } : item));
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }, [modelId, models, onConfigureApiKey, prompt, referenceAudios, referenceImages, referenceVideos, resolution, seconds, showToast, t, videoSize]);

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
   * 将历史任务参数恢复到表单，参考附件需要用户重新选择。
   * @param job 待重试的视频任务。
   * @returns 无返回值。
   */
  const restoreJob = useCallback((job: StoredVideoJob) => {
    setPrompt(job.prompt);
    setModelId(job.modelId);
    setResolution(job.resolution);
    setVideoSize(job.videoSize);
    setSeconds(job.seconds);
    setResolutionMode(config.resolutions.includes(job.resolution) ? 'preset' : 'custom');
    if (!config.resolutions.includes(job.resolution)) setCustomResolution(String(job.resolution));
    setSizeMode(config.sizes.includes(job.videoSize) ? 'preset' : 'custom');
    if (!config.sizes.includes(job.videoSize) && job.videoSize !== 'auto') {
      const [width, height] = job.videoSize.split('x');
      setCustomWidth(width); setCustomHeight(height);
    }
    setDurationMode(config.durations.includes(job.seconds) ? 'preset' : 'custom');
    if (!config.durations.includes(job.seconds)) setCustomSeconds(String(job.seconds));
  }, [config]);

  /**
   * 清空当前提示词和全部参考附件，保留用户选择的视频参数。
   * @returns 无返回值。
   */
  const handleClearDraft = useCallback(() => {
    setPrompt('');
    setReferenceImages([]);
    setReferenceVideos([]);
    setReferenceAudios([]);
  }, []);

  const parameterButton = 'h-7 shrink-0 rounded-md border border-input bg-background px-2.5 text-xs transition-colors hover:bg-muted';
  const canClear = Boolean(prompt.trim() || referenceImages.length || referenceVideos.length || referenceAudios.length);
  const canSubmit = Boolean(prompt.trim() && modelId && !submitting);

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
          {models.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-4 px-4 py-8 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Info className="size-5" /></div>
              <p className="max-w-md text-sm text-muted-foreground">{t('video.configureModel')}</p>
              <Button onClick={onConfigureApiKey}>{t('common.configure')}</Button>
            </div>
          ) : (
            <>
              <div className="p-4 pb-2">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex flex-[3] flex-col justify-center rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-3 py-4 transition-colors hover:border-primary/50 hover:bg-primary/[0.07]">
                    <div className="mb-3 flex items-center justify-center gap-2 text-center">
                      <CloudUpload className="size-5 text-muted-foreground" />
                      <span className="text-sm font-medium">{t('video.referenceMediaOptional')}</span>
                    </div>
                    <div className="grid grid-cols-3 divide-x divide-border/70">
                      {[
                        { kind: 'image', title: t('video.addImage'), count: referenceImages.length, max: config.maxRefImages, icon: FileImage, inputId: 'image-reference-input' },
                        { kind: 'video', title: t('video.addVideo'), count: referenceVideos.length, max: config.maxRefVideos, icon: FileVideo, inputId: 'video-reference-input' },
                        { kind: 'audio', title: t('video.addAudio'), count: referenceAudios.length, max: config.maxRefAudios, icon: AudioLines, inputId: 'audio-reference-input' },
                      ].map(item => (
                        <label key={item.kind} htmlFor={item.inputId} className="group flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1 px-2 py-1.5 text-center">
                          <item.icon className="size-5 text-muted-foreground transition-colors group-hover:text-primary" />
                          <span className="max-w-full truncate text-xs font-medium sm:text-sm">{item.title}</span>
                          <span className="text-[10px] text-muted-foreground">{t('video.attachmentCount', { count: item.count, max: item.max })}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <button type="button" onClick={() => setAssetPickerOpen(true)} disabled={referenceImages.length >= config.maxRefImages} className="flex min-h-28 flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-3 py-4 text-center transition-all hover:border-primary/50 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-32">
                    <Images className="size-6 text-muted-foreground" />
                    <span className="text-sm font-medium">{t('video.imageAssets')}</span>
                    <span className="text-xs text-muted-foreground">{t('assetPicker.importImageTitle')}</span>
                  </button>
                </div>
              </div>
              {(referenceImages.length > 0 || referenceVideos.length > 0 || referenceAudios.length > 0) && (
                <div className="flex flex-wrap gap-2 px-4 pb-2">
                  {referenceImages.map((file, index) => <MediaAttachmentTile key={`image-${file.name}-${file.lastModified}`} file={file} kind="image" onRemove={() => setReferenceImages(current => current.filter((_, itemIndex) => itemIndex !== index))} />)}
                  {referenceVideos.map((file, index) => <MediaAttachmentTile key={`video-${file.name}-${file.lastModified}`} file={file} kind="video" onRemove={() => setReferenceVideos(current => current.filter((_, itemIndex) => itemIndex !== index))} />)}
                  {referenceAudios.map((file, index) => <MediaAttachmentTile key={`audio-${file.name}-${file.lastModified}`} file={file} kind="audio" onRemove={() => setReferenceAudios(current => current.filter((_, itemIndex) => itemIndex !== index))} />)}
                </div>
              )}
              <Textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={t('video.promptPlaceholder')} rows={3} className="min-h-24 resize-none rounded-none border-0 bg-transparent px-3 pt-3 placeholder:text-placeholder focus-visible:border-0 focus-visible:ring-0 sm:px-4 sm:pt-4" />
              <div className="space-y-2 px-3 pb-2 pt-2 sm:px-4">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                  <Select className="w-full sm:w-44" size="sm" value={modelId} onValueChange={setModelId} options={models.map(model => ({ value: model.id, label: model.name }))} placeholder={t('video.configureModel')} />
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 text-xs font-medium text-muted-foreground">{t('video.resolution')}</span>
                    {config.resolutions.map(value => <button type="button" key={value} className={cn(parameterButton, resolutionMode === 'preset' && resolution === value && 'border-primary bg-primary/10 text-primary')} onClick={() => { setResolution(value); setResolutionMode('preset'); }}>{value}p</button>)}
                    <Input className="h-7 w-24 shrink-0 rounded-md px-2 text-xs" inputMode="numeric" value={customResolution} placeholder={t('video.customResolution')} onChange={event => { setCustomResolution(event.target.value); const value = Number(event.target.value); if (isValidVideoResolution(value)) { setResolution(value); setResolutionMode('custom'); } }} />
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Clock3 className="size-3" />{t('video.seconds')}</span>
                    {config.durations.map(value => <button type="button" key={value} className={cn(parameterButton, durationMode === 'preset' && seconds === value && 'border-primary bg-primary/10 text-primary')} onClick={() => { setSeconds(value); setDurationMode('preset'); }}>{value}s</button>)}
                    <Input className="h-7 w-24 shrink-0 rounded-md px-2 text-xs" inputMode="numeric" value={customSeconds} placeholder={t('video.customSeconds')} onChange={event => { setCustomSeconds(event.target.value); const value = Number(event.target.value); if (isValidVideoDuration(value)) { setSeconds(value); setDurationMode('custom'); } }} />
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Maximize className="size-3" />{t('video.size')}</span>
                  {config.sizes.map(value => <button type="button" key={value} className={cn(parameterButton, sizeMode === 'preset' && videoSize === value && 'border-primary bg-primary/10 text-primary')} onClick={() => { setVideoSize(value); setSizeMode('preset'); }}>{value}</button>)}
                  <div className="flex items-center gap-1">
                    <Input className="h-7 w-20 shrink-0 rounded-md px-2 text-xs sm:w-24" inputMode="numeric" value={customWidth} placeholder={t('video.customWidth')} onChange={event => { const width = event.target.value; setCustomWidth(width); const value = `${width}x${customHeight}`; if (isValidVideoSize(value)) { setVideoSize(value); setSizeMode('custom'); } }} />
                    <span className="text-xs text-muted-foreground">×</span>
                    <Input className="h-7 w-20 shrink-0 rounded-md px-2 text-xs sm:w-24" inputMode="numeric" value={customHeight} placeholder={t('video.customHeight')} onChange={event => { const height = event.target.value; setCustomHeight(height); const value = `${customWidth}x${height}`; if (isValidVideoSize(value)) { setVideoSize(value); setSizeMode('custom'); } }} />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 px-3 pb-3 sm:px-4">
                <Button type="button" variant="outline" size="icon" onClick={handleClearDraft} disabled={!canClear} title={t('workbench.clearDraft')}><X className="size-5" /></Button>
                <Button type="button" size="icon" onClick={() => void handleSubmit()} disabled={!canSubmit} title={t('video.generate')}>{submitting ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}</Button>
              </div>
              <input id="video-reference-input" hidden type="file" accept="video/*" multiple onChange={event => { addReferenceFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
              <input id="audio-reference-input" hidden type="file" accept="audio/*" multiple onChange={event => { addReferenceFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
              <input id="image-reference-input" hidden type="file" accept="image/*" multiple onChange={event => { addReferenceFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
            </>
          )}
        </div>
      </section>

      <section className={cn('min-h-80 rounded-lg border bg-muted/20 p-3 sm:p-4', wideMode && 'xl:h-full xl:overflow-y-auto')}>
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">{t('video.history')}</h2><span className="text-xs text-muted-foreground">{jobs.length}</span></div>
        {jobs.length === 0 ? <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">{t('video.emptyHistory')}</div> : <div className="space-y-3">{jobs.map(job => (
          <article key={job.id} className="overflow-hidden rounded-lg border bg-card">
            {job.status === 'completed' && job.videoUrl ? <video className="aspect-video w-full bg-black object-contain" src={job.videoUrl} controls preload="metadata" /> : <div className="flex aspect-video items-center justify-center bg-muted"><div className="flex items-center gap-2 text-sm text-muted-foreground">{job.status === 'failed' ? <X className="size-5 text-destructive" /> : <Loader2 className="size-5 animate-spin" />}{job.status === 'failed' ? t('video.failed') : job.status === '排队中' ? t('video.queued') : t('video.processing')}</div></div>}
            <div className="space-y-3 p-3">
              <p className="line-clamp-3 text-sm">{job.prompt}</p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{job.resolution}p</span><span>{job.videoSize}</span><span className="flex items-center gap-1"><Clock3 className="size-3" />{job.seconds}s</span><span>{t('video.createdAt', { time: formatJobTime(job.createdAt, locale) })}</span></div>
              {job.error && <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{job.error}</p>}
              <div className="flex flex-wrap gap-2">
                {job.status === 'completed' && job.videoUrl && <a className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2')} href={job.videoUrl} download={`video-${job.id}.mp4`}><Download className="size-4" />{t('video.download')}</a>}
                {(job.status === '排队中' || job.status === 'processing') && <Button variant="outline" size="sm" className="gap-2" onClick={() => void refreshPendingJobs()}><RefreshCw className="size-4" />{t('video.checkStatus')}</Button>}
                <Button variant="outline" size="sm" className="gap-2" onClick={() => restoreJob(job)}><RefreshCw className="size-4" />{t('video.retry')}</Button>
                <Button variant="ghost" size="sm" className="ml-auto gap-2 text-destructive" onClick={() => removeJob(job)}><Trash2 className="size-4" />{t('video.remove')}</Button>
              </div>
            </div>
          </article>
        ))}</div>}
      </section>
      <AgentAssetPickerDialog
        open={assetPickerOpen}
        maxSelected={Math.max(1, config.maxRefImages - referenceImages.length)}
        onOpenChange={setAssetPickerOpen}
        onConfirm={assets => void handleImportImageAssets(assets)}
      />
    </div>
  );
}
