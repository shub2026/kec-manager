import { describe, it, expect } from 'vitest';
import { truncateText } from './string';

describe('truncateText', () => {
  it('未超出长度时原样返回', () => {
    expect(truncateText('高中语文', 8)).toBe('高中语文');
    expect(truncateText('刚好八个字符啊哦', 8)).toBe('刚好八个字符啊哦');
  });

  it('超出长度时截断并追加省略号', () => {
    expect(truncateText('这是一段超过八个中文字符的备注', 8)).toBe('这是一段超过八个…');
    expect(truncateText('五个字符啊', 4)).toBe('五个字符…');
  });

  it('空输入返回空字符串', () => {
    expect(truncateText('', 8)).toBe('');
    expect(truncateText(null, 8)).toBe('');
    expect(truncateText(undefined, 8)).toBe('');
  });

  it('正确处理代理对字符（emoji）', () => {
    expect(truncateText('😀😁😂', 2)).toBe('😀😁…');
  });
});
