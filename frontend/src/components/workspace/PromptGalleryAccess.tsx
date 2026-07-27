import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/workspace/dialogs/ConfirmDialog';
import type { PromptGalleryMode } from '@/hooks/usePromptGalleryConfig';
import { translate, type Locale } from '@/lib/i18n';

/**
 * 管理提示词广场的显示权限与密码验证状态。
 * @param mode 提示词广场部署模式。
 * @param passwordEnabled 是否启用访问密码。
 * @param onError 错误消息回调。
 * @param onUnlocked 解锁成功后的导航回调。
 * @param locale 当前界面语言。
 * @returns 提示词广场可见状态、验证框状态和访问操作方法。
 */
export function usePromptGalleryAccess(
  mode: PromptGalleryMode,
  passwordEnabled: boolean,
  onError: (message: string) => void,
  onUnlocked?: () => void,
  locale: Locale = 'en',
) {
  const [showPromptGallery, setShowPromptGallery] = useState(mode === '1');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  useEffect(() => {
    if (mode === '2') return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setShowPromptGallery(mode === '1');
    });
    return () => { cancelled = true; };
  }, [mode]);

  const handlePromptGalleryEntry = useCallback(() => {
    if (mode === '3') return;
    if (mode === '1' || (mode === '2' && !passwordEnabled)) {
      setShowPromptGallery(true);
      onUnlocked?.();
      return;
    }
    if (showPromptGallery) {
      onUnlocked?.();
      return;
    }
    setPasswordDialogOpen(true);
  }, [mode, onUnlocked, passwordEnabled, showPromptGallery]);

  const handlePasswordSubmit = useCallback(async () => {
    try {
      const response = await fetch('/api/flyreq/prompt-gallery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await response.json().catch(() => ({ ok: false }));
      if (data.ok) {
        setShowPromptGallery(true);
        setPasswordDialogOpen(false);
        setPasswordInput('');
        onUnlocked?.();
      } else {
        onError(translate(locale, 'promptGallery.passwordWrong'));
        setPasswordInput('');
      }
    } catch {
      onError(translate(locale, 'promptGallery.passwordFailed'));
    }
  }, [locale, onError, onUnlocked, passwordInput]);

  return {
    showPromptGallery,
    passwordDialogOpen,
    passwordInput,
    setPasswordDialogOpen,
    setPasswordInput,
    handlePromptGalleryEntry,
    handlePasswordSubmit,
  };
}

/**
 * 渲染提示词广场密码验证对话框。
 * @param props 对话框状态、密码值和提交回调。
 * @returns 打开时返回验证对话框，关闭时返回空内容。
 */
export function PromptGalleryAccessDialog({
  open,
  passwordInput,
  onPasswordChange,
  onClose,
  onSubmit,
  locale = 'en',
}: {
  open: boolean;
  passwordInput: string;
  onPasswordChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  locale?: Locale;
}) {
  if (!open) return null;

  return (
    <ConfirmDialog
      title={translate(locale, 'promptGallery.verifyTitle')}
      message={(
        <div className="space-y-3">
          <p>{translate(locale, 'promptGallery.verifyMessage')}</p>
          <input
            type="password"
            value={passwordInput}
            onChange={(event) => onPasswordChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSubmit();
            }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none"
            autoFocus
          />
        </div>
      )}
      confirmText={translate(locale, 'promptGallery.verifyAction')}
      variant="default"
      onConfirm={onSubmit}
      onCancel={onClose}
    />
  );
}
