import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/components/LanguageProvider';
import { ImageGenerationWorkbench } from '@/components/ImageGenerationWorkbench';

describe('ImageGenerationWorkbench', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('flyreq-locale', 'en');
  });

  it('keeps the complete editor visible and guides configuration when the image model is unavailable', async () => {
    const onConfigureApiKey = vi.fn();
    render(
      <LanguageProvider initialLocale="en">
        <ImageGenerationWorkbench
          disabled
          onSubmitText={vi.fn()}
          onSubmitImage={vi.fn()}
          onConfigureApiKey={onConfigureApiKey}
        />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByPlaceholderText('Describe the image you want to generate...')).toBeInTheDocument());
    expect(screen.getByText('Reference images (optional)')).toBeInTheDocument();
    expect(screen.getByText('Configure an image model to generate')).toBeInTheDocument();

    const configureButtons = screen.getAllByRole('button', { name: 'Configure image model' });
    const enabledConfigureButton = configureButtons.find(button => !button.hasAttribute('disabled'));
    const disabledSubmitButton = configureButtons.find(button => button.hasAttribute('disabled'));
    expect(enabledConfigureButton).toBeDefined();
    expect(disabledSubmitButton).toBeDisabled();

    fireEvent.click(enabledConfigureButton!);
    expect(onConfigureApiKey).toHaveBeenCalledOnce();
  });
});
