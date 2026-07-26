'use client';

import { useState } from 'react';
import { Check, Copy, Maximize, RectangleHorizontal, Sparkles, Thermometer } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CustomSizeDialog } from '@/components/CustomSizeDialog';
import { GptImageAdvancedParamsControl } from '@/components/GptImageAdvancedParamsControl';
import { useI18n } from '@/components/LanguageProvider';
import { cn } from '@/lib/utils';
import { MODEL_OPTIONS, type ModelId } from '@/lib/gemini-config';
import {
  getAspectRatioOptions,
  getCustomSizeMaxSide,
  getGptImageAdvancedParamsForModel,
  getOutputSizeLabel,
  getSupportsTemperature,
  getSizeOptions,
  normalizeCustomImageSize,
  PARALLEL_COUNT_OPTIONS,
  supportsAutoLayout,
  supportsCustomSize,
  supportsGptImageAdvancedParams,
  type GptImageAdvancedParams,
  type ParallelCount,
} from '@/lib/model-capabilities';
import type { OutputSize, AspectRatio } from '@/lib/job-store';

export type GenerationParamsValue = {
  model: ModelId;
  outputSize: OutputSize;
  customSize?: string;
  aspectRatio: AspectRatio;
  temperature: number;
  parallelCount: ParallelCount;
  gptImageAdvancedParams: GptImageAdvancedParams;
};

type ButtonSize = 'xs' | 'sm';

interface GenerationParamsBarProps {
  value: GenerationParamsValue;
  onChange: (patch: Partial<GenerationParamsValue>) => void;
  modelUnavailable?: boolean;
  size?: ButtonSize;
  className?: string;
}

interface AspectRatioPreviewProps {
  ratio: AspectRatio;
  selected: boolean;
}

/**
 * 将比例换算为固定预览区域内的像素尺寸。
 * @param ratio 图片宽高比。
 * @returns 不超过 48×36 像素的预览框宽高。
 */
function getAspectPreviewDimensions(ratio: AspectRatio): { width: number; height: number } {
  if (ratio === 'auto') return { width: 38, height: 28 };
  const [widthRatio, heightRatio] = ratio.split(':').map(Number);
  if (!widthRatio || !heightRatio) return { width: 32, height: 32 };
  const scale = Math.min(48 / widthRatio, 36 / heightRatio);
  return {
    width: Math.max(6, widthRatio * scale),
    height: Math.max(6, heightRatio * scale),
  };
}

/**
 * 根据比例方向生成当前语言下的直观画幅名称。
 * @param ratio 图片宽高比。
 * @param t 多语言翻译方法。
 * @returns 方形、横屏、竖屏等画幅名称。
 */
function getAspectRatioDisplayName(ratio: AspectRatio, t: ReturnType<typeof useI18n>['t']): string {
  if (ratio === 'auto') return t('aspectRatio.auto');
  const [width, height] = ratio.split(':').map(Number);
  if (width === height) return t('aspectRatio.square');
  if (width / height >= 2) return t('aspectRatio.panorama');
  if (height / width >= 2) return t('aspectRatio.tallPortrait');
  return width > height ? t('aspectRatio.landscape') : t('aspectRatio.portrait');
}

/**
 * 渲染能够直观看出输出画幅方向的比例预览框。
 * @param props 当前比例和选中状态。
 * @returns 固定尺寸区域内按真实比例缩放的轮廓框。
 */
function AspectRatioPreview({ ratio, selected }: AspectRatioPreviewProps) {
  const dimensions = getAspectPreviewDimensions(ratio);
  return (
    <div className="flex h-10 w-full items-center justify-center" aria-hidden="true">
      <span
        data-testid={`aspect-ratio-preview-${ratio.replace(/[^0-9a-z]+/gi, '-')}`}
        className={cn(
          'flex items-center justify-center rounded-[3px] border-2 transition-colors',
          selected ? 'border-primary bg-primary/10' : 'border-muted-foreground/70 bg-background',
          ratio === 'auto' && 'border-dashed',
        )}
        style={{ width: dimensions.width, height: dimensions.height }}
      >
        {ratio === 'auto' && <Sparkles className="size-3 text-muted-foreground" />}
      </span>
    </div>
  );
}

/**
 * 共享的「模型 + 生成参数」控件条（自宿主 TextToImageForm 抽取）。受控：对外只发最终 patch，
 * 模型/分辨率联动级联在内部完成。文生图与无限画布编排节点共用，保证展示一致并支持自定义分辨率。
 * @param props 当前生成参数、变更回调和按钮尺寸。
 * @returns 模型、尺寸、比例、并行数和高级参数工具条。
 */
export function GenerationParamsBar({ value, onChange, modelUnavailable = false, size = 'xs', className }: GenerationParamsBarProps) {
  const { t } = useI18n();
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [sizePopoverOpen, setSizePopoverOpen] = useState(false);
  const [aspectPopoverOpen, setAspectPopoverOpen] = useState(false);
  const [parallelPopoverOpen, setParallelPopoverOpen] = useState(false);
  const [temperaturePopoverOpen, setTemperaturePopoverOpen] = useState(false);
  const [customSizeDialogOpen, setCustomSizeDialogOpen] = useState(false);

  const model = value.model;
  const sizeOptions = getSizeOptions(model);
  const aspectRatioOptions = getAspectRatioOptions(model, value.outputSize);
  const supportsTemperature = getSupportsTemperature(model);
  const supportsAdvancedParams = supportsGptImageAdvancedParams(model);
  const autoLayoutAvailable = supportsAutoLayout(model);
  const autoLayoutLocked = autoLayoutAvailable && value.outputSize === 'auto';
  const showSizeControl = sizeOptions.length > 1 || autoLayoutAvailable;
  const customSizeAvailable = supportsCustomSize(model) && !autoLayoutLocked;
  const customSizeMaxSide = getCustomSizeMaxSide(model) || 2048;
  const currentResolution = value.customSize
    || aspectRatioOptions.find(option => option.value === value.aspectRatio)?.resolution
    || (autoLayoutLocked ? '自动' : '');
  const displaySizeLabel = value.customSize || getOutputSizeLabel(value.outputSize);
  const getResolutionForSize = (outputSize: OutputSize) => {
    if (outputSize === 'auto') return '自动';
    return getAspectRatioOptions(model, outputSize).find(option => option.value === value.aspectRatio)?.resolution || '';
  };
  const handleModelChange = (newModel: ModelId) => {
    const nextGpt = getGptImageAdvancedParamsForModel(newModel, value.gptImageAdvancedParams);
    const nextSizeOptions = getSizeOptions(newModel).filter(option => !option.disabled);
    const nextOutputSize: OutputSize = value.outputSize === 'auto' && supportsAutoLayout(newModel) ? 'auto' : (nextSizeOptions.find(s => s.value === value.outputSize)?.value || nextSizeOptions[0].value);
    const nextCustomSize = supportsCustomSize(newModel) ? normalizeCustomImageSize(value.customSize, getCustomSizeMaxSide(newModel)) : undefined;
    const aspectOptions = getAspectRatioOptions(newModel, nextOutputSize);
    const nextAspectRatio: AspectRatio = aspectOptions.find(a => a.value === value.aspectRatio) ? value.aspectRatio : (aspectOptions[0]?.value || '1:1');
    onChange({ model: newModel, outputSize: nextOutputSize, customSize: nextCustomSize, aspectRatio: nextAspectRatio, gptImageAdvancedParams: nextGpt });
  };

  const handleSizeChange = (newSize: OutputSize) => {
    if (sizeOptions.find(option => option.value === newSize)?.disabled) return;
    const aspectOptions = getAspectRatioOptions(model, newSize);
    const nextAspectRatio: AspectRatio = aspectOptions.find(a => a.value === value.aspectRatio) ? value.aspectRatio : (aspectOptions[0]?.value || '1:1');
    onChange({ outputSize: newSize, customSize: undefined, aspectRatio: nextAspectRatio });
    setTimeout(() => setSizePopoverOpen(false), 0);
  };

  const handleAutoLayoutChange = (enabled: boolean) => {
    if (enabled) {
      onChange({ outputSize: 'auto', aspectRatio: 'auto', customSize: undefined });
      setSizePopoverOpen(false);
      setAspectPopoverOpen(false);
      return;
    }
    onChange({ outputSize: '1K', aspectRatio: '1:1' });
  };

  const handleAspectRatioChange = (newRatio: AspectRatio) => {
    onChange({ aspectRatio: newRatio, customSize: undefined });
    setTimeout(() => setAspectPopoverOpen(false), 0);
  };

  const handleParallelCountChange = (count: ParallelCount) => {
    onChange({ parallelCount: count });
    setTimeout(() => setParallelPopoverOpen(false), 0);
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {/* 模型选择 */}
      <Popover open={modelPopoverOpen && !modelUnavailable} onOpenChange={(open) => setModelPopoverOpen(modelUnavailable ? false : open)}>
        <PopoverTrigger disabled={modelUnavailable} className={cn(buttonVariants({ variant: 'outline', size }), 'gap-1')} title={modelUnavailable ? t('common.notConfigured') : t('workbench.selectImageModel')}>
          <Sparkles className="h-3 w-3" />
          <span className="shrink-0 truncate text-[11px]">{modelUnavailable ? t('common.notConfigured') : MODEL_OPTIONS.find(o => o.value === model)?.label}</span>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start">
          {MODEL_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                handleModelChange(option.value);
                setModelPopoverOpen(false);
              }}
              className={cn('w-full text-left px-2.5 py-1.5 rounded-md text-sm hover:bg-muted', model === option.value && 'bg-muted font-medium')}
            >
              {option.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {autoLayoutAvailable && (
        <button
          type="button"
          onClick={() => handleAutoLayoutChange(!autoLayoutLocked)}
          className={cn(buttonVariants({ variant: 'outline', size }), 'gap-1', autoLayoutLocked && 'border-primary text-primary')}
          title="自动分辨率和比例"
        >
          <span className={cn('flex h-3 w-3 items-center justify-center rounded-[3px] border', autoLayoutLocked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50')}>
            {autoLayoutLocked && <Check className="h-2.5 w-2.5" />}
          </span>
          <span className="text-[11px]">自动</span>
        </button>
      )}

      {showSizeControl && (
        <Popover open={sizePopoverOpen && !autoLayoutLocked} onOpenChange={(open) => setSizePopoverOpen(autoLayoutLocked ? false : open)}>
          <PopoverTrigger className={cn(buttonVariants({ variant: 'outline', size }), 'gap-1')} title={autoLayoutLocked ? '自动模式已锁定分辨率' : `输出尺寸${currentResolution ? `：${currentResolution}` : ''}`} disabled={autoLayoutLocked}>
            <Maximize className="h-3 w-3" />
            <span className="text-[11px]">{displaySizeLabel}</span>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="start">
            {sizeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => handleSizeChange(option.value)}
                disabled={option.disabled}
                title={option.disabledReason}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent',
                  value.outputSize === option.value && !value.customSize && 'bg-muted font-medium'
                )}
              >
                <span>{option.label}</span>
                {getResolutionForSize(option.value) && <span className="text-xs text-muted-foreground">{getResolutionForSize(option.value)}</span>}
              </button>
            ))}
            {customSizeAvailable && (
              <button
                type="button"
                onClick={() => { setAspectPopoverOpen(false); setCustomSizeDialogOpen(true); }}
                className={cn('mt-1 flex w-full items-center gap-1.5 rounded-md border-t px-2.5 py-1.5 text-sm hover:bg-muted', value.customSize && 'bg-muted font-medium')}
              >
                <Maximize className="h-3.5 w-3.5" />
                自定义{value.customSize ? `（${value.customSize}）` : ''}
              </button>
            )}
          </PopoverContent>
        </Popover>
      )}

      <Popover open={aspectPopoverOpen && !autoLayoutLocked} onOpenChange={(open) => setAspectPopoverOpen(autoLayoutLocked ? false : open)}>
        <PopoverTrigger className={cn(buttonVariants({ variant: 'outline', size }), 'gap-1')} title={autoLayoutLocked ? '自动模式已锁定比例' : '图像比例'} disabled={autoLayoutLocked}>
          <RectangleHorizontal className="h-3 w-3" />
          <span className="text-[11px]">{value.aspectRatio}</span>
        </PopoverTrigger>
        <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-2" align="start">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {aspectRatioOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => handleAspectRatioChange(option.value)}
                className={cn(
                  'relative flex min-h-24 min-w-0 flex-col items-center justify-center rounded-lg border border-border bg-card px-2 py-2 text-center text-xs transition-colors hover:border-primary/50 hover:bg-muted/60',
                  value.aspectRatio === option.value && 'border-primary bg-primary/5 font-medium text-primary',
                )}
              >
                {value.aspectRatio === option.value && <Check className="absolute right-1.5 top-1.5 size-3.5" />}
                <AspectRatioPreview ratio={option.value} selected={value.aspectRatio === option.value} />
                <span className="mt-1 font-medium">{getAspectRatioDisplayName(option.value, t)}</span>
                <span className="text-[10px] text-muted-foreground">{option.value}</span>
                {option.resolution && <span className="max-w-full truncate text-[10px] text-muted-foreground">{option.resolution}</span>}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={parallelPopoverOpen} onOpenChange={setParallelPopoverOpen}>
        <PopoverTrigger className={cn(buttonVariants({ variant: 'outline', size }), 'gap-1')} title="并行数量">
          <Copy className="h-3 w-3" />
          <span className="text-[11px]">x{value.parallelCount}</span>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="grid grid-cols-5 gap-1">
          {PARALLEL_COUNT_OPTIONS.map((count) => (
            <button
              key={count}
              onClick={() => handleParallelCountChange(count)}
              className={cn('flex h-8 items-center justify-center rounded-md text-sm hover:bg-muted', value.parallelCount === count && 'bg-muted font-medium text-primary')}
            >
              {count}
            </button>
          ))}
          </div>
        </PopoverContent>
      </Popover>

      {supportsAdvancedParams && (
        <GptImageAdvancedParamsControl value={value.gptImageAdvancedParams} onChange={(next) => onChange({ gptImageAdvancedParams: next })} variant="outline" size={size} />
      )}

      {supportsTemperature && (
        <Popover open={temperaturePopoverOpen} onOpenChange={setTemperaturePopoverOpen}>
          <PopoverTrigger className={cn(buttonVariants({ variant: 'outline', size }), 'gap-1')} title="温度（0=精确，1=均衡，2=创意）">
            <Thermometer className="h-3 w-3" />
            <span className="text-[11px]">{value.temperature.toFixed(2)}</span>
          </PopoverTrigger>
          <PopoverContent className="w-56" align="start">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">温度</label>
                <span className="text-sm text-muted-foreground">{value.temperature.toFixed(2)}</span>
              </div>
              <Slider value={[value.temperature]} onValueChange={(v) => onChange({ temperature: v[0] })} min={0} max={2} step={0.01} className="w-full" />
              <div className="flex justify-between gap-2">
                <Button variant="outline" size="xs" onClick={() => onChange({ temperature: 0 })} className="flex-1">精确 (0)</Button>
                <Button variant="outline" size="xs" onClick={() => onChange({ temperature: 1 })} className="flex-1">均衡 (1)</Button>
                <Button variant="outline" size="xs" onClick={() => onChange({ temperature: 2 })} className="flex-1">创意 (2)</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}

      <CustomSizeDialog open={customSizeDialogOpen} value={value.customSize} maxSide={customSizeMaxSide} onOpenChange={setCustomSizeDialogOpen} onApply={(cs) => onChange({ customSize: cs })} />
    </div>
  );
}
