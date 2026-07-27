'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  hasConfiguredTextModel,
  isPromptOptimizeEnabled,
  PROMPT_OPTIMIZE_SETTING_EVENT,
  setPromptOptimizeEnabled,
} from '@/lib/settings-storage';

/**
 * 管理提示词优化开关及文本模型可用状态，并响应设置页的即时变更。
 * @returns 当前开关、可用状态、更新方法和手动刷新方法。
 */
export function usePromptOptimizeSetting() {
  const [enabled, setEnabledState] = useState(false);
  const [available, setAvailable] = useState(false);

  /**
   * 同步提示词优化开关和文本模型可用状态。
   * @returns 无返回值，状态会从当前浏览器配置中刷新。
   */
  const refresh = useCallback(() => {
    setEnabledState(isPromptOptimizeEnabled());
    setAvailable(hasConfiguredTextModel());
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) refresh();
    });
    window.addEventListener(PROMPT_OPTIMIZE_SETTING_EVENT, refresh);
    window.addEventListener('flyreq-model-registry-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(PROMPT_OPTIMIZE_SETTING_EVENT, refresh);
      window.removeEventListener('flyreq-model-registry-updated', refresh);
    };
  }, [refresh]);

  /**
   * 更新提示词优化开关并同步最新状态。
   * @param nextEnabled 用户期望启用的状态。
   * @returns 设置是否成功应用。
   */
  const setEnabled = useCallback((nextEnabled: boolean) => {
    const applied = setPromptOptimizeEnabled(nextEnabled);
    refresh();
    return applied;
  }, [refresh]);

  return { enabled, available, setEnabled, refresh };
}
