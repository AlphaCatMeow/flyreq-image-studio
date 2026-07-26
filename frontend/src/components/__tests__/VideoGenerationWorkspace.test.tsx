import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/components/LanguageProvider';
import { VideoGenerationWorkspace } from '@/components/VideoGenerationWorkspace';
import { loadRegistry, saveRegistry } from '@/lib/flyreq-models';

describe('VideoGenerationWorkspace', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('flyreq-locale', 'en');
    const registry = loadRegistry();
    registry.videoModels = [{
      id: 'video-test',
      protocol: 'openai',
      name: 'Video Test',
      modelId: 'grok-imagine-video',
      apiKey: 'test-key',
      baseUrl: 'https://video.example.com',
    }];
    registry.defaults.videoGeneration = 'video-test';
    saveRegistry(registry);
  });

  it('renders image, video, audio, and asset-library entries in one composer', () => {
    render(
      <LanguageProvider initialLocale="en">
        <VideoGenerationWorkspace onConfigureApiKey={vi.fn()} showToast={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByText('Add image')).toBeInTheDocument();
    expect(screen.getByText('Add video')).toBeInTheDocument();
    expect(screen.getByText('Add audio')).toBeInTheDocument();
    expect(screen.getByText('Image assets')).toBeInTheDocument();
    expect(screen.getByTitle('Generate video')).toBeDisabled();
  });
});
