import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/components/LanguageProvider';
import { SettingsModal } from '@/components/SettingsModal';
import { getCompleteTextModels, loadRegistry, saveRegistry } from '@/lib/flyreq-models';

/**
 * 使用英文环境渲染设置弹窗，便于验证新增多语言交互文案。
 * @param onClose 弹窗请求关闭时调用的监听函数。
 * @returns 测试渲染结果。
 */
function renderSettings(onClose = vi.fn()) {
  return render(
    <LanguageProvider initialLocale="en">
      <SettingsModal isOpen onClose={onClose} />
    </LanguageProvider>,
  );
}

describe('SettingsModal unsaved configuration', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('flyreq-locale', 'en');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));
  });

  it('does not show the follow-along save bar before an actual edit', async () => {
    renderSettings();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled());
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('renders the complete settings navigation and model sections in English', async () => {
    renderSettings();

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Backup' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByText('Image models')).toBeInTheDocument();
    expect(screen.getByText('Text models')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Show or hide API Key' }).length).toBeGreaterThan(0);
  });

  it('shows the save bar after editing and commits the configuration', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled());

    const apiKeyInput = document.querySelector<HTMLInputElement>('input[type="password"]');
    expect(apiKeyInput).not.toBeNull();
    fireEvent.change(apiKeyInput!, { target: { value: 'saved-image-key' } });

    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
    expect(loadRegistry().imageModels[0].apiKey).toBe('saved-image-key');
  });

  it('offers all three choices when closing with unsaved changes', async () => {
    const onClose = vi.fn();
    renderSettings(onClose);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled());

    const apiKeyInput = document.querySelector<HTMLInputElement>('input[type="password"]');
    fireEvent.change(apiKeyInput!, { target: { value: 'pending-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue editing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('discards the draft without changing persistent configuration', async () => {
    const onClose = vi.fn();
    renderSettings(onClose);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled());

    const apiKeyInput = document.querySelector<HTMLInputElement>('input[type="password"]');
    fireEvent.change(apiKeyInput!, { target: { value: 'discarded-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(loadRegistry().imageModels[0].apiKey).toBe('');
  });

  it('saves the draft before closing when requested', async () => {
    const onClose = vi.fn();
    renderSettings(onClose);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled());

    const apiKeyInput = document.querySelector<HTMLInputElement>('input[type="password"]');
    fireEvent.change(apiKeyInput!, { target: { value: 'save-and-close-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and close' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(loadRegistry().imageModels[0].apiKey).toBe('save-and-close-key');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled());
  });

  it('marks configuration imported from an external link as unsaved', async () => {
    const onConsumed = vi.fn();
    render(
      <LanguageProvider initialLocale="en">
        <SettingsModal
          isOpen
          onClose={vi.fn()}
          externalModelConfig={{
            type: 'image',
            modelKey: 'external-image-model',
            preset: 'gpt-image-2',
            name: 'External image model',
            apiKey: 'external-key',
          }}
          onExternalModelConfigConsumed={onConsumed}
        />
      </LanguageProvider>,
    );

    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('Image model configuration was imported from the external link and set as the image defaults. Save the configuration to apply it.')).toBeInTheDocument();
    expect(onConsumed).toHaveBeenCalledOnce();
  });

  it('keeps an incomplete external model selected as the pending default', async () => {
    const registry = loadRegistry();
    registry.imageModels[0].apiKey = 'existing-key';
    registry.defaults.textToImage = registry.imageModels[0].id;
    registry.defaults.imageToImage = registry.imageModels[0].id;
    saveRegistry(registry);

    render(
      <LanguageProvider initialLocale="en">
        <SettingsModal
          isOpen
          onClose={vi.fn()}
          externalModelConfig={{
            type: 'image',
            modelKey: 'pending-external-model',
            preset: 'gpt-image-2',
            name: 'Pending external model',
          }}
          onExternalModelConfigConsumed={vi.fn()}
        />
      </LanguageProvider>,
    );

    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    const imageApiKeyInput = document.querySelectorAll<HTMLInputElement>('input[type="password"]')[0];
    fireEvent.change(imageApiKeyInput, { target: { value: 'external-completed-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    await waitFor(() => {
      const saved = loadRegistry();
      expect(saved.defaults.textToImage).toBe('pending-external-model');
      expect(saved.defaults.imageToImage).toBe('pending-external-model');
    });
  });

  it('imports a complete external text model and assigns all text defaults', async () => {
    render(
      <LanguageProvider initialLocale="en">
        <SettingsModal
          isOpen
          onClose={vi.fn()}
          externalModelConfig={{
            type: 'text',
            protocol: 'openai',
            modelKey: 'external-text-model',
            name: 'External text model',
            modelId: 'gpt-5.4-mini',
            baseUrl: 'https://text.example.com',
            apiKey: 'text-key',
          }}
          onExternalModelConfigConsumed={vi.fn()}
        />
      </LanguageProvider>,
    );

    expect(await screen.findByText('Text model configuration was imported from the external link and set as the text defaults. Save the configuration to apply it.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => {
      const saved = loadRegistry();
      expect(saved.textModels.some(model => model.id === 'external-text-model')).toBe(true);
      expect(saved.defaults).toMatchObject({
        reversePrompt: 'external-text-model',
        agent: 'external-text-model',
        promptOptimize: 'external-text-model',
        imageDescribe: 'external-text-model',
      });
    });
  });

  it('imports a complete external video model and assigns the video default', async () => {
    render(
      <LanguageProvider initialLocale="en">
        <SettingsModal
          isOpen
          onClose={vi.fn()}
          externalModelConfig={{
            type: 'video',
            protocol: 'openai',
            modelKey: 'external-video-model',
            name: 'External video model',
            modelId: 'sora-2',
            baseUrl: 'https://video.example.com',
            apiKey: 'video-key',
          }}
          onExternalModelConfigConsumed={vi.fn()}
        />
      </LanguageProvider>,
    );

    expect(await screen.findByText('Video model configuration was imported from the external link and set as the video default. Save the configuration to apply it.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => {
      const saved = loadRegistry();
      expect(saved.videoModels.some(model => model.id === 'external-video-model')).toBe(true);
      expect(saved.defaults.videoGeneration).toBe('external-video-model');
    });
  });

  it('persists incomplete text models as inactive drafts', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Add text model' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save configuration' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled());

    const registry = loadRegistry();
    expect(registry.textModels).toHaveLength(1);
    expect(getCompleteTextModels(registry)).toHaveLength(0);
    expect(registry.defaults.promptOptimize).toBe('');
  });

  it('creates OpenAI video drafts with the Sora protocol template', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Add video model' }));

    expect(await screen.findByPlaceholderText('sora-2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(loadRegistry().videoModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ protocol: 'openai', presetModelId: 'sora-2', baseUrl: 'https://api.openai.com' }),
    ])));
  });

  it('warns before changing a video model migrated from registry schema v1', async () => {
    localStorage.setItem('flyreq-model-registry', JSON.stringify({
      imageModels: [],
      textModels: [],
      videoModels: [{
        id: 'legacy-video',
        protocol: 'openai',
        name: 'Legacy Video',
        modelId: 'old-model',
        apiKey: 'key',
        baseUrl: 'https://video.example.com',
      }],
      defaults: { videoGeneration: 'legacy-video' },
    }));

    renderSettings();
    expect(await screen.findByText('This model was migrated from registry schema v1. Select one of the three supported protocols before changing its endpoint behavior.')).toBeInTheDocument();
  });
});
