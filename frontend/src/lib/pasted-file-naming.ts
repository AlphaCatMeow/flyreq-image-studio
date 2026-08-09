/**
 * 判断浏览器为无文件名剪贴板图片生成的占位名称。
 * @param name 文件名称。
 * @returns 是否属于 image.png/blob 等占位名称。
 */
export function isPlaceholderPastedFileName(name: string): boolean {
  return !name.trim() || /^(?:image|blob)(?:[-_]?[0-9]+)?\.(?:png|jpe?g|webp|gif|bmp)$/i.test(name.trim());
}

/**
 * 为剪贴板导入的文件保留可用原名，缺少原名时按本次粘贴顺序命名。
 * @param file 剪贴板文件。
 * @param index 本次粘贴中的零基序号。
 * @returns 带稳定显示名称的新文件对象。
 */
export function normalizePastedFileName(file: File, index: number): File {
  if (!isPlaceholderPastedFileName(file.name)) return file;
  const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
  return new File([file], String(Math.max(0, index) + 1) + '.' + extension, { type: file.type, lastModified: file.lastModified });
}
