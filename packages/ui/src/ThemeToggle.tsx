'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from './Button';
import { nextTheme, THEME_STORAGE_KEY, type ThemePreference } from './theme';

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: ThemePreference) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable: theme still applies for this page view */
  }
}

const LABELS: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** Cycles system → light → dark. Also bound to Alt+Shift+T. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>('system');

  useEffect(() => setTheme(readStored()), []);

  const cycle = useCallback(() => {
    setTheme((prev) => {
      const next = nextTheme(prev);
      apply(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyT') {
        e.preventDefault();
        cycle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycle]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycle}
      aria-label={`Theme: ${LABELS[theme]}. Activate to change (Alt+Shift+T)`}
      title="Change theme (Alt+Shift+T)"
    >
      Theme: {LABELS[theme]}
    </Button>
  );
}
