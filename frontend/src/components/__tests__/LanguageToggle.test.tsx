import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/components/LanguageProvider';
import { LanguageToggle } from '@/components/LanguageToggle';

describe('LanguageToggle', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/zh');
  });

  it('切换语言时只更新 URL 和文案，不触发整页导航', async () => {
    window.history.replaceState({}, '', '/zh');
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    render(
      <LanguageProvider initialLocale="zh">
        <LanguageToggle />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '切换语言' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));

    expect(replaceStateSpy).toHaveBeenCalledWith(expect.anything(), '', '/en/');
    expect(window.location.pathname).toBe('/en/');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch language' })).toBeInTheDocument());
    replaceStateSpy.mockRestore();
  });

  it('响应浏览器前进后退事件同步语言状态', async () => {
    window.history.replaceState({}, '', '/zh');
    render(
      <LanguageProvider initialLocale="en">
        <LanguageToggle />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: '切换语言' })).toBeInTheDocument());
    act(() => {
      window.history.replaceState({}, '', '/en');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('button', { name: 'Switch language' })).toBeInTheDocument();

    act(() => {
      window.history.replaceState({}, '', '/zh');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '切换语言' })).toBeInTheDocument());
  });
});
