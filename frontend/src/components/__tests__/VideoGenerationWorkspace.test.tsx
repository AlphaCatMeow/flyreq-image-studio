import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/components/LanguageProvider';
import { VideoGenerationWorkspace } from '@/components/VideoGenerationWorkspace';
import { ImageGenerationWorkbench } from '@/components/ImageGenerationWorkbench';
import { loadRegistry, saveRegistry } from '@/lib/flyreq-models';
import { setPromptOptimizeEnabled } from '@/lib/settings-storage';
import { restoreVideoBlobUrl } from '@/lib/video-job-store';
import { applyVideoProtocolConfig, getVideoProtocolConfig } from '@/lib/video-config';

vi.mock('@/lib/video-job-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/video-job-store')>();
  return {
    ...actual,
    restoreVideoBlobUrl: vi.fn(actual.restoreVideoBlobUrl),
  };
});

describe('VideoGenerationWorkspace', () => {
  beforeEach(() => {
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
    vi.mocked(restoreVideoBlobUrl).mockReset();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:reference-image') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('renders only supported image-reference and asset-library entries', () => {
    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByText('Add image')).toBeInTheDocument();
    expect(screen.queryByText('Add video')).not.toBeInTheDocument();
    expect(screen.queryByText('Add audio')).not.toBeInTheDocument();
    expect(screen.getByText('Image assets')).toBeInTheDocument();
    expect(screen.queryByTestId('video-resolution-icon')).not.toBeInTheDocument();
    expect(screen.getByTestId('video-parameter-grid')).toHaveClass('md:grid-cols-3');
    expect(screen.getByLabelText('Submission shortcut')).toBeInTheDocument();
    expect(screen.getByTitle('Configure the default text model first')).toBeDisabled();
    expect(screen.getByTitle('Generate video')).toBeDisabled();
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
    expect(screen.queryByText('Add video')).not.toBeInTheDocument();
    expect(screen.queryByText('Add audio')).not.toBeInTheDocument();
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
