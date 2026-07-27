'use client';

import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { dispatchImageActionToast } from '@/lib/image-actions';
import { getPromptSubmissionShortcutLabels, type PromptSubmissionShortcut } from '@/hooks/usePromptSubmissionShortcut';
import { useI18n } from '@/components/LanguageProvider';

interface PromptSubmissionShortcutMenuProps {
  value: PromptSubmissionShortcut;
  isSmallViewport: boolean;
  onValueChange: (shortcut: PromptSubmissionShortcut) => void;
}

/**
 * 渲染提示词发送快捷键的选择菜单。
 * @param props 当前快捷键及其变更回调。
 * @returns 快捷键选择按钮与菜单。
 */
export function PromptSubmissionShortcutMenu({ value, isSmallViewport, onValueChange }: PromptSubmissionShortcutMenuProps) {
  const { t } = useI18n();
  /**
   * 校验菜单返回值后通知父组件更新偏好，避免写入未知值。
   * @param shortcut 菜单返回的快捷键值。
   * @returns 无返回值。
   */
  const handleValueChange = (shortcut: string) => {
    if (shortcut === 'enter' || shortcut === 'shift-enter') {
      if (shortcut === value) return;
      onValueChange(shortcut);
      const labels = getPromptSubmissionShortcutLabels(shortcut);
      const mobileNotice = isSmallViewport ? t('shortcut.mobileNotice') : '';
      dispatchImageActionToast(t('shortcut.updated', { submission: labels.submission, newline: labels.newline, mobileNotice }), 'success');
    }
  };

  const currentShortcutLabels = getPromptSubmissionShortcutLabels(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={t('shortcut.ariaLabel')}
        title={isSmallViewport ? t('shortcut.mobileTitle') : t('shortcut.title', { submission: currentShortcutLabels.submission, newline: currentShortcutLabels.newline })}
      >
        <Keyboard className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
          <DropdownMenuLabel>{isSmallViewport ? t('shortcut.mobileTitle') : t('shortcut.menuLabel')}</DropdownMenuLabel>
          <DropdownMenuRadioItem value="enter">
            <span>{t('shortcut.enterSubmit')}</span>
            <span className="ml-auto text-xs text-muted-foreground">{t('shortcut.shiftEnterNewline')}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="shift-enter">
            <span>{t('shortcut.shiftEnterSubmit')}</span>
            <span className="ml-auto text-xs text-muted-foreground">{t('shortcut.enterNewline')}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
