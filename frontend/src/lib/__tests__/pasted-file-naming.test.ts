import { describe, expect, it } from 'vitest';
import { isPlaceholderPastedFileName, normalizePastedFileName } from '@/lib/pasted-file-naming';

describe('剪贴板文件命名', () => {
  it('识别浏览器生成的默认图片占位名称', () => {
    expect(isPlaceholderPastedFileName('image.png')).toBe(true);
    expect(isPlaceholderPastedFileName('blob-1.jpeg')).toBe(true);
    expect(isPlaceholderPastedFileName('car-reference.png')).toBe(false);
  });

  it('保留原始素材名，缺少可用名称时按粘贴序号命名', () => {
    const named = new File(['a'], '赛车参考图.png', { type: 'image/png' });
    const unnamed = new File(['b'], 'image.png', { type: 'image/png' });
    expect(normalizePastedFileName(named, 0).name).toBe('赛车参考图.png');
    expect(normalizePastedFileName(unnamed, 0).name).toBe('1.png');
    expect(normalizePastedFileName(unnamed, 2).name).toBe('3.png');
  });
});
