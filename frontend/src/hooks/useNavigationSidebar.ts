'use client';

import { useCallback, useEffect, useState } from 'react';

export const NAVIGATION_COLLAPSED_STORAGE_KEY = 'flyreq-navigation-collapsed';
const TABLET_NAVIGATION_MAX_WIDTH = 1279;

/**
 * 读取用户保存的菜单收缩状态。
 * @returns 已保存时返回布尔值，未保存或存储不可用时返回空值。
 */
function readStoredCollapsed(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(NAVIGATION_COLLAPSED_STORAGE_KEY);
    if (value === 'collapsed') return true;
    if (value === 'expanded') return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * 持久化用户主动选择的菜单收缩状态。
 * @param collapsed 菜单是否收缩。
 * @returns 无返回值。
 */
function writeStoredCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NAVIGATION_COLLAPSED_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // 隐私模式下存储可能不可用，当前会话状态仍然有效。
  }
}

/**
 * 管理桌面菜单收缩状态，并在没有用户偏好时让平板宽度默认收缩。
 * @returns 当前收缩状态和切换方法。
 */
export function useNavigationSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const stored = readStoredCollapsed();
      setCollapsed(stored ?? window.innerWidth <= TABLET_NAVIGATION_MAX_WIDTH);
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * 切换菜单收缩状态并保存用户选择。
   * @returns 无返回值。
   */
  const toggleCollapsed = useCallback(() => {
    setCollapsed(current => {
      const next = !current;
      writeStoredCollapsed(next);
      return next;
    });
  }, []);

  return { collapsed, toggleCollapsed };
}
