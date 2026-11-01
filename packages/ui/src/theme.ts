export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'lc-theme';

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

export function nextTheme(current: ThemePreference): ThemePreference {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
}

/**
 * Inline <head> script that applies a stored explicit theme before first paint
 * (avoids a flash of the wrong theme). Storage access may throw in private
 * modes, so every access is guarded.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;
