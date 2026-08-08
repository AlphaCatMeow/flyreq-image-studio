import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/components/LanguageProvider';
import { VideoGenerationWorkspace } from '@/components/VideoGenerationWorkspace';
import { ImageGenerationWorkbench } from '@/components/ImageGenerationWorkbench';
import { loadRegistry, saveRegistry } from '@/lib/flyreq-models';
import { setPromptOptimizeEnabled } from '@/lib/settings-storage';
import { cacheVideoReferenceFiles, restoreVideoBlobUrl, restoreVideoReferenceFiles } from '@/lib/video-job-store';
import { applyVideoProtocolConfig, getVideoProtocolConfig } from '@/lib/video-config';

vi.mock('@/lib/video-job-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/video-job-store')>();
  return {
    ...actual,
    cacheVideoReferenceFiles: vi.fn().mockResolvedValue(undefined),
    restoreVideoBlobUrl: vi.fn(actual.restoreVideoBlobUrl),
    restoreVideoReferenceFiles: vi.fn().mockResolvedValue({ images: [], videos: [], audios: [] }),
  };
});

describe('VideoGenerationWorkspace', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    applyVideoProtocolConfig();
    localStorage.clear();
    localStorage.setItem('flyreq-locale', 'en');
    const registry = loadRegistry();
    registry.videoModels = [{
      id: 'video-test',
      protocol: 'openai',
      name: 'Video Test',
      modelId: 'sora-2',
      apiKey: 'test-key',
      baseUrl: 'https://video.example.com',
    }];
    registry.defaults.videoGeneration = 'video-test';
    registry.textModels = [];
    registry.defaults.promptOptimize = '';
    saveRegistry(registry);
    vi.mocked(cacheVideoReferenceFiles).mockClear();
    vi.mocked(restoreVideoBlobUrl).mockReset();
    vi.mocked(restoreVideoReferenceFiles).mockReset();
    vi.mocked(restoreVideoReferenceFiles).mockResolvedValue({ images: [], videos: [], audios: [] });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:reference-image') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('renders all supported reference-media and asset-library entries', () => {
    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByText('Add image')).toBeInTheDocument();
    expect(screen.getByText('Add video')).toBeInTheDocument();
    expect(screen.getByText('Add audio')).toBeInTheDocument();
    expect(screen.getByText('Asset library')).toBeInTheDocument();
    expect(screen.getByText('0 / 9')).toBeInTheDocument();
    expect(screen.getAllByText('0 / 3')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '4K' })).toBeInTheDocument();
    expect(screen.getByTestId('video-resolution-icon')).toBeInTheDocument();
    expect(screen.getByTestId('video-parameter-grid')).toHaveClass('md:grid-cols-4');
    expect(within(screen.getByTestId('video-parameter-grid')).getByRole('button', { name: 'Video count' })).toBeInTheDocument();
    expect(screen.getByLabelText('Submission shortcut')).toBeInTheDocument();
    expect(screen.getByTitle('Configure the default text model first')).toBeDisabled();
    expect(screen.getByTitle('Generate video')).toBeDisabled();
  });

  it('粘贴媒体文件时将其加入视频参考素材', async () => {
    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    const image = new File(['image'], 'pasted-reference.png', { type: 'image/png' });
    const prompt = screen.getByPlaceholderText('Describe the scene, motion, camera, pacing, and sound you want…');
    fireEvent.paste(prompt, {
      clipboardData: {
        items: [{ kind: 'file', type: image.type, getAsFile: () => image }],
      },
    });

    expect(await screen.findByAltText('pasted-reference.png')).toBeInTheDocument();
    expect(screen.getByTitle('看大图')).toBeInTheDocument();
    expect(screen.getByTitle('添加到素材库')).toBeInTheDocument();
    expect(screen.getByTitle('复制图片')).toBeInTheDocument();
  });

  it('一次请求批量创建指定数量的视频任务并展示独立历史卡片', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        taskIds: ['video-task-1', 'video-task-2', 'video-task-3'],
        tasks: [
          { id: 'video-task-1', status: 'queued', createdAt: '2026-07-30T08:00:00.000Z' },
          { id: 'video-task-2', status: 'queued', createdAt: '2026-07-30T08:00:00.000Z' },
          { id: 'video-task-3', status: 'queued', createdAt: '2026-07-30T08:00:00.000Z' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Video count' }));
    fireEvent.click(await screen.findByRole('button', { name: '3' }));
    fireEvent.change(screen.getByPlaceholderText('Additional instruction for video 1 (optional)'), { target: { value: 'Use a wide establishing shot' } });
    fireEvent.change(screen.getByPlaceholderText('Additional instruction for video 2 (optional)'), { target: { value: 'Use a close-up shot' } });
    fireEvent.change(screen.getByPlaceholderText('Additional instruction for video 3 (optional)'), { target: { value: 'Use an overhead shot' } });
    fireEvent.change(screen.getByPlaceholderText('Describe the scene, motion, camera, pacing, and sound you want…'), { target: { value: 'Three cinematic draws' } });
    fireEvent.click(screen.getByTitle('Generate video'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get('parallelCount')).toBe('3');
    expect(JSON.parse(String((request.body as FormData).get('promptVariants')))).toEqual([
      'Use a wide establishing shot',
      'Use a close-up shot',
      'Use an overhead shot',
    ]);
    expect(await screen.findByText('Video 3')).toBeInTheDocument();
    expect(screen.getByText('Video 2')).toBeInTheDocument();
    expect(screen.getByText('Video 1')).toBeInTheDocument();
    expect(screen.getByText('video-task-3')).toBeInTheDocument();
    expect(screen.getByText('video-task-2')).toBeInTheDocument();
    expect(screen.getByText('video-task-1')).toBeInTheDocument();
    expect(screen.getByText(/Use a wide establishing shot/)).toBeInTheDocument();
    expect(screen.getByText(/Use a close-up shot/)).toBeInTheDocument();
    expect(screen.getByText(/Use an overhead shot/)).toBeInTheDocument();
  });

  it('补齐旧后端缺失的参考视频和音频类型配置', () => {
    const oldConfig = getVideoProtocolConfig();
    const oldReferences = oldConfig.protocols.openai.references as Partial<typeof oldConfig.protocols.openai.references>;
    delete oldReferences.videoMimeTypes;
    delete oldReferences.audioMimeTypes;
    applyVideoProtocolConfig(oldConfig);

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByText('Add video')).toBeInTheDocument();
    expect(screen.getByText('Add audio')).toBeInTheDocument();
  });

  it('uses the OpenAI Videos duration set and excludes unsupported defaults', () => {
    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByRole('button', { name: '4s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '8s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '20s' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '6s' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '10s' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('1-60 sec')).toBeInTheDocument();
  });

  it('读取首张参考图尺寸并加入尺寸菜单', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1536, height: 864, close: vi.fn() }));
    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    const imageInput = document.getElementById('image-reference-input') as HTMLInputElement;
    fireEvent.change(imageInput, { target: { files: [new File(['image'], 'reference.png', { type: 'image/png' })] } });
    await waitFor(() => expect(vi.mocked(createImageBitmap)).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '1280x720' }));

    expect(await screen.findByText('Reference image')).toBeInTheDocument();
    expect(screen.getByText('1536x864')).toBeInTheDocument();
  });

  it('拒绝当前协议不支持的参考图 MIME 类型', () => {
    const showToast = vi.fn();
    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={showToast} />
      </LanguageProvider>,
    );

    const imageInput = document.getElementById('image-reference-input') as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: { files: [new File(['gif'], 'reference.gif', { type: 'image/gif' })] },
    });

    expect(screen.queryByAltText('reference.gif')).not.toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith('The current video protocol does not support this reference image format.', 'error');
  });

  it('协议切换后移除超过新配置上限的参考图', async () => {
    const protocolConfig = getVideoProtocolConfig();
    protocolConfig.protocols.xai.references.images = 0;
    applyVideoProtocolConfig(protocolConfig);
    const showToast = vi.fn();

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={showToast} />
      </LanguageProvider>,
    );

    const imageInput = document.getElementById('image-reference-input') as HTMLInputElement;
    const image = new File(['image'], 'reference.png', { type: 'image/png' });
    fireEvent.change(imageInput, { target: { files: [image] } });
    expect(await screen.findByAltText('reference.png')).toBeInTheDocument();

    const registry = loadRegistry();
    registry.videoModels = [{
      id: 'video-xai-no-image',
      protocol: 'xai',
      name: 'xAI No Image',
      modelId: 'grok-imagine-video',
      apiKey: 'test-key',
      baseUrl: 'https://api.x.ai',
    }];
    registry.defaults.videoGeneration = 'video-xai-no-image';
    saveRegistry(registry);
    act(() => window.dispatchEvent(new Event('flyreq-model-registry-updated')));

    await waitFor(() => expect(screen.queryByAltText('reference.png')).not.toBeInTheDocument());
    expect(showToast).toHaveBeenCalledWith('You can attach up to 0 reference images.', 'error');
  });

  it('协议切换后移除新协议不支持的参考图格式', async () => {
    const registry = loadRegistry();
    registry.videoModels = [{
      id: 'video-new-api',
      protocol: 'new-api',
      name: 'New API Video',
      modelId: 'video-model',
      apiKey: 'test-key',
      baseUrl: 'https://video.example.com',
    }];
    registry.defaults.videoGeneration = 'video-new-api';
    saveRegistry(registry);
    const showToast = vi.fn();

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={showToast} />
      </LanguageProvider>,
    );

    const imageInput = document.getElementById('image-reference-input') as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: { files: [new File(['gif'], 'reference.gif', { type: 'image/gif' })] },
    });
    expect(await screen.findByAltText('reference.gif')).toBeInTheDocument();

    registry.videoModels = [{
      id: 'video-openai',
      protocol: 'openai',
      name: 'OpenAI Video',
      modelId: 'sora-2',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com',
    }];
    registry.defaults.videoGeneration = 'video-openai';
    saveRegistry(registry);
    act(() => window.dispatchEvent(new Event('flyreq-model-registry-updated')));

    await waitFor(() => expect(screen.queryByAltText('reference.gif')).not.toBeInTheDocument());
    expect(showToast).toHaveBeenCalledWith('The current video protocol does not support this reference image format.', 'error');
  });

  it('enables prompt optimization after a text model is configured', async () => {
    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText('Describe the scene, motion, camera, pacing, and sound you want…'), { target: { value: 'A train crosses a bridge' } });
    expect(screen.getByTitle('Configure the default text model first')).toBeDisabled();

    const registry = loadRegistry();
    registry.textModels = [{
      id: 'text-test',
      protocol: 'openai',
      name: 'Text Test',
      modelId: 'gpt-5.4-mini',
      apiKey: 'text-key',
      baseUrl: 'https://text.example.com',
    }];
    registry.defaults.promptOptimize = 'text-test';
    saveRegistry(registry);
    act(() => window.dispatchEvent(new Event('flyreq-model-registry-updated')));

    await waitFor(() => expect(screen.getByTitle('Enable prompt optimization in Settings first')).toBeDisabled());
    act(() => { setPromptOptimizeEnabled(true); });
    await waitFor(() => expect(screen.getByTitle('Optimize prompt')).toBeEnabled());
  });

  it('blocks submission when an active custom parameter becomes invalid', async () => {
    const registry = loadRegistry();
    registry.videoModels[0].protocol = 'new-api';
    registry.videoModels[0].modelId = 'video-model';
    saveRegistry(registry);
    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText('Describe the scene, motion, camera, pacing, and sound you want…'), { target: { value: 'A train crosses a bridge' } });
    const submitButton = screen.getByTitle('Generate video');
    expect(submitButton).toBeEnabled();

    const durationInput = screen.getByPlaceholderText('1-60 sec');
    fireEvent.change(durationInput, { target: { value: '8' } });
    fireEvent.change(durationInput, { target: { value: '80' } });
    expect(submitButton).toBeDisabled();

    fireEvent.change(durationInput, { target: { value: '8' } });
    fireEvent.change(screen.getByPlaceholderText('Width'), { target: { value: '1920' } });
    fireEvent.change(screen.getByPlaceholderText('Height'), { target: { value: '1080' } });
    fireEvent.change(screen.getByPlaceholderText('Width'), { target: { value: '5000' } });
    expect(submitButton).toBeDisabled();
  });

  it('marks a missing cached video as failed without retrying restoration', async () => {
    localStorage.setItem('flyreq-video-jobs', JSON.stringify([{
      id: 'cached-missing',
      serverTaskId: 'server-cached-missing',
      status: 'completed',
      prompt: 'Cached result',
      modelId: 'video-test',
      resolution: 720,
      videoSize: '1280x720',
      seconds: 6,
      referenceVideos: [],
      referenceAudios: [],
      referenceImages: [],
      createdAt: new Date().toISOString(),
      cached: true,
    }]));
    vi.mocked(restoreVideoBlobUrl).mockResolvedValue(undefined);

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    expect(await screen.findByText('The locally cached video is missing. Retry the task to generate it again.')).toBeInTheDocument();
    await waitFor(() => expect(restoreVideoBlobUrl).toHaveBeenCalledOnce());
  });

  it('在视频任务卡片展示服务端任务 ID、模型名称、模型 ID、清晰度和总耗时', () => {
    localStorage.setItem('flyreq-video-jobs', JSON.stringify([{
      id: 'local-video-job',
      serverTaskId: 'server-traceable-task-id',
      status: 'completed',
      prompt: 'Traceable video task',
      modelId: 'video-test',
      modelName: 'Video Test',
      apiModelId: 'sora-2-api-model',
      protocol: 'openai',
      resolution: 1080,
      videoSize: '1920x1080',
      seconds: 12,
      referenceVideos: [],
      referenceAudios: [],
      referenceImages: [],
      createdAt: '2026-07-29T08:00:00.000Z',
      completedAt: '2026-07-29T08:01:05.000Z',
    }]));

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    const taskCard = screen.getByText('server-traceable-task-id').closest('article');
    expect(taskCard).not.toBeNull();
    expect(within(taskCard!).getByText('Video Test')).toBeInTheDocument();
    expect(within(taskCard!).getByText('sora-2-api-model')).toBeInTheDocument();
    expect(within(taskCard!).getByText('1080p')).toBeInTheDocument();
    expect(within(taskCard!).getByText('1m 5s')).toBeInTheDocument();
  });

  it('从视频任务卡片复制实际发送给上游的完整提示词', async () => {
    localStorage.setItem('flyreq-video-jobs', JSON.stringify([{
      id: 'copy-prompt-video-job',
      serverTaskId: 'server-copy-prompt-task',
      status: 'completed',
      prompt: 'Shared main prompt',
      promptVariant: 'Use a close-up shot',
      effectivePrompt: 'Shared main prompt\n\nUse a close-up shot',
      modelId: 'video-test',
      resolution: 1080,
      videoSize: '1920x1080',
      seconds: 8,
      referenceVideos: [],
      referenceAudios: [],
      referenceImages: [],
      createdAt: '2026-07-29T08:00:00.000Z',
    }]));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const showToast = vi.fn();

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={showToast} />
      </LanguageProvider>,
    );

    const taskCard = screen.getByText('server-copy-prompt-task').closest('article');
    expect(taskCard).not.toBeNull();
    fireEvent.click(within(taskCard!).getByRole('button', { name: 'Copy the effective prompt' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Shared main prompt\n\nUse a close-up shot'));
    expect(showToast).toHaveBeenCalledWith('Prompt copied', 'success');
  });

  it('使用当前参数重试时恢复全部参考素材并附加到新请求', async () => {
    const image = new File(['image'], 'retry-image.png', { type: 'image/png' });
    const video = new File(['video'], 'retry-video.mp4', { type: 'video/mp4' });
    const audio = new File(['audio'], 'retry-audio.mp3', { type: 'audio/mpeg' });
    localStorage.setItem('flyreq-video-jobs', JSON.stringify([{
      id: 'video-retry-with-references',
      serverTaskId: 'server-retry-with-references',
      status: 'failed',
      prompt: 'Retry with all references',
      modelId: 'video-test',
      resolution: 720,
      videoSize: '1280x720',
      aspectRatio: '16:9',
      seconds: 4,
      referenceStorageId: 'stored-video-references',
      referenceImages: [{ name: image.name, type: image.type, size: image.size }],
      referenceVideos: [{ name: video.name, type: video.type, size: video.size }],
      referenceAudios: [{ name: audio.name, type: audio.type, size: audio.size }],
      createdAt: '2026-08-07T08:00:00.000Z',
    }]));
    vi.mocked(restoreVideoReferenceFiles).mockResolvedValue({ images: [image], videos: [video], audios: [audio] });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'retried-video-task', status: 'queued' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry with these settings' }));
    expect(await screen.findByAltText(image.name)).toBeInTheDocument();
    expect(screen.getByLabelText(video.name)).toBeInTheDocument();
    expect(screen.getByLabelText(audio.name)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Generate video'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const requestBody = fetchMock.mock.calls[0][1]?.body as FormData;
    expect((requestBody.get('reference_images') as File).name).toBe(image.name);
    expect((requestBody.get('reference_videos') as File).name).toBe(video.name);
    expect((requestBody.get('reference_audios') as File).name).toBe(audio.name);
  });

  it('参考素材恢复完成前禁止提交和重复重试', async () => {
    const image = new File(['image'], 'delayed-retry-image.png', { type: 'image/png' });
    localStorage.setItem('flyreq-video-jobs', JSON.stringify([{
      id: 'video-delayed-retry',
      status: 'failed',
      prompt: 'Delayed retry prompt',
      modelId: 'video-test',
      resolution: 720,
      videoSize: '1280x720',
      seconds: 4,
      referenceStorageId: 'delayed-video-references',
      referenceImages: [{ name: image.name, type: image.type, size: image.size }],
      referenceVideos: [],
      referenceAudios: [],
      createdAt: '2026-08-08T08:00:00.000Z',
    }]));
    let resolveReferences: ((files: { images: File[]; videos: File[]; audios: File[] }) => void) | undefined;
    vi.mocked(restoreVideoReferenceFiles).mockReturnValue(new Promise(resolve => { resolveReferences = resolve; }));

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    const promptInput = screen.getByPlaceholderText('Describe the scene, motion, camera, pacing, and sound you want…');
    fireEvent.change(promptInput, { target: { value: 'Existing draft' } });
    expect(screen.getByTitle('Generate video')).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry with these settings' }));
    expect(screen.getByTitle('Generate video')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry with these settings' })).toBeDisabled();

    await act(async () => { resolveReferences?.({ images: [image], videos: [], audios: [] }); });
    expect(await screen.findByAltText(image.name)).toBeInTheDocument();
    expect(screen.getByTitle('Generate video')).toBeEnabled();
  });

  it('参考素材不完整时保留当前草稿并提示错误', async () => {
    localStorage.setItem('flyreq-video-jobs', JSON.stringify([{
      id: 'video-incomplete-references',
      status: 'failed',
      prompt: 'Historical prompt',
      modelId: 'video-test',
      resolution: 720,
      videoSize: '1280x720',
      seconds: 4,
      referenceStorageId: 'incomplete-video-references',
      referenceImages: [{ name: 'missing.png', type: 'image/png', size: 10 }],
      referenceVideos: [],
      referenceAudios: [],
      createdAt: '2026-08-08T08:00:00.000Z',
    }]));
    vi.mocked(restoreVideoReferenceFiles).mockRejectedValue(new Error('missing reference'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const showToast = vi.fn();

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={showToast} />
      </LanguageProvider>,
    );

    const promptInput = screen.getByPlaceholderText('Describe the scene, motion, camera, pacing, and sound you want…');
    fireEvent.change(promptInput, { target: { value: 'Current draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry with these settings' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not restore all reference media. The current draft was kept unchanged.', 'error'));
    expect(promptInput).toHaveValue('Current draft');
    expect(screen.getByRole('button', { name: 'Retry with these settings' })).toBeEnabled();
    expect(consoleError).toHaveBeenCalledWith('恢复视频参考素材失败', expect.any(Error));
  });

  it('releases a restored video URL when the workspace unmounts before restoration finishes', async () => {
    localStorage.setItem('flyreq-video-jobs', JSON.stringify([{
      id: 'cached-late',
      serverTaskId: 'server-cached-late',
      status: 'completed',
      prompt: 'Late cached result',
      modelId: 'video-test',
      resolution: 720,
      videoSize: '1280x720',
      seconds: 6,
      referenceVideos: [],
      referenceAudios: [],
      referenceImages: [],
      createdAt: new Date().toISOString(),
      cached: true,
    }]));
    let resolveRestore: ((value: string | undefined) => void) | undefined;
    vi.mocked(restoreVideoBlobUrl).mockReturnValue(new Promise(resolve => { resolveRestore = resolve; }));
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });

    const rendered = render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );
    await waitFor(() => expect(restoreVideoBlobUrl).toHaveBeenCalledOnce());
    rendered.unmount();
    await act(async () => { resolveRestore?.('blob:late-video'); });

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:late-video');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('cancels an active server task before allowing local deletion', async () => {
    localStorage.setItem('flyreq-video-jobs', JSON.stringify([{
      id: 'active-video',
      serverTaskId: 'server-active-video',
      status: 'processing',
      prompt: 'Active result',
      modelId: 'video-test',
      resolution: 720,
      videoSize: '1280x720',
      seconds: 6,
      referenceVideos: [],
      referenceAudios: [],
      referenceImages: [],
      createdAt: new Date().toISOString(),
    }]));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'server-active-video', status: 'cancelled', error: 'Task cancelled' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Delete record' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }));

    expect((await screen.findAllByText('Task cancelled')).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/flyreq/video-tasks/server-active-video/cancel', { method: 'POST' });
    expect(screen.getByRole('button', { name: 'Delete record' })).toBeInTheDocument();
  });

  it('keeps the submission shortcut synchronized between image and video workbenches', async () => {
    render(
      <LanguageProvider initialLocale="en">
        <ImageGenerationWorkbench disabled onSubmitText={vi.fn()} onSubmitImage={vi.fn()} onConfigureApiKey={vi.fn()} />
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    const shortcutButtons = screen.getAllByLabelText('Submission shortcut');
    expect(shortcutButtons).toHaveLength(2);
    fireEvent.click(shortcutButtons[1]);
    fireEvent.click(await screen.findByText('Shift + Enter to submit'));

    await waitFor(() => {
      const synchronizedButtons = screen.getAllByLabelText('Submission shortcut');
      expect(synchronizedButtons.every(button => button.getAttribute('title')?.includes('Shift + Enter to submit'))).toBe(true);
    });
  });

  it('shows proportional visual frames when choosing a video size', async () => {
    const registry = loadRegistry();
    registry.videoModels[0].protocol = 'new-api';
    registry.videoModels[0].modelId = 'video-model';
    saveRegistry(registry);
    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '1280x720' }));

    const landscapePreview = await screen.findByTestId('video-size-preview-1280x720');
    const portraitPreview = await screen.findByTestId('video-size-preview-720x1280');
    const squarePreview = await screen.findByTestId('video-size-preview-1024x1024');
    expect(landscapePreview).toHaveStyle({ width: '48px', height: '27px' });
    expect(portraitPreview).toHaveStyle({ width: '20.25px', height: '36px' });
    expect(squarePreview).toHaveStyle({ width: '36px', height: '36px' });
    expect(screen.getAllByText('Landscape').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Portrait').length).toBeGreaterThan(0);
    expect(screen.getByText('Aspect ratio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '16:9' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '9:16' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '9:16' }));
    expect(screen.getByRole('button', { name: '720x1280' })).toBeInTheDocument();
  });

  it('shows xAI resolution and aspect-ratio controls without a size control', () => {
    const registry = loadRegistry();
    registry.videoModels[0].protocol = 'xai';
    registry.videoModels[0].modelId = 'grok-imagine-video';
    saveRegistry(registry);

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('video-resolution-icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '480p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '16:9' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1280x720' })).not.toBeInTheDocument();
  });

  it('keeps the complete editor visible and guides configuration when the video model is unavailable', () => {
    const registry = loadRegistry();
    registry.videoModels = [];
    registry.defaults.videoGeneration = '';
    saveRegistry(registry);
    const onConfigureApiKey = vi.fn();

    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={onConfigureApiKey} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByText('Add image')).toBeInTheDocument();
    expect(screen.getByText('Add video')).toBeInTheDocument();
    expect(screen.getByText('Add audio')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Describe the scene, motion, camera, pacing, and sound you want…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1280x720' })).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByText('Configure a video model to generate')).toBeInTheDocument();
    const configureButton = screen.getAllByRole('button', { name: 'Configure video model' }).find(button => !button.hasAttribute('disabled'));
    expect(configureButton).toBeDefined();
    fireEvent.click(configureButton!);
    expect(onConfigureApiKey).toHaveBeenCalledOnce();
    expect(screen.getByTitle('Configure video model')).toBeDisabled();
  });
});
