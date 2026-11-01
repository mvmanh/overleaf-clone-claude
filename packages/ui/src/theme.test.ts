import { describe, expect, it } from 'vitest';
import { nextTheme, themeInitScript } from './theme';

describe('theme', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it('init script guards storage access', () => {
    expect(themeInitScript).toContain('try{');
    expect(() => new Function(themeInitScript)).not.toThrow();
  });
});
