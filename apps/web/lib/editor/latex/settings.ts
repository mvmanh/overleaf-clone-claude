export interface EditorSettings {
  /** Open suggestions while typing, or only on Ctrl+Space. */
  autocomplete: 'typing' | 'manual';
  /** Auto-expanding math snippets (// → \frac, @a → \alpha, x1 → x_1 …). */
  autoMath: boolean;
  /** Text-mode shortcuts: mk → $…$, dm → \[…\], beg → \begin…\end. */
  textShortcuts: boolean;
  /** Live rendering of the formula under the cursor. */
  mathPreview: boolean;
  /** Checks while typing: \begin/\end, unknown \ref and \cite keys, duplicate labels. */
  lint: boolean;
  /** Auto-close $, \[ \], \( \) and \end{…} on Enter. */
  autoClose: boolean;
  lineWrapping: boolean;
  fontSize: number;
}

export const DEFAULT_SETTINGS: EditorSettings = {
  autocomplete: 'typing',
  autoMath: true,
  textShortcuts: true,
  mathPreview: true,
  lint: true,
  autoClose: true,
  lineWrapping: true,
  fontSize: 14,
};

const KEY = 'lc-editor-settings';
const listeners = new Set<(s: EditorSettings) => void>();
let current: EditorSettings | null = null;

export function loadSettings(): EditorSettings {
  if (current) return current;
  let stored: Partial<EditorSettings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<EditorSettings>;
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  current = { ...DEFAULT_SETTINGS, ...stored };
  current.fontSize = Math.min(
    24,
    Math.max(11, Number(current.fontSize) || DEFAULT_SETTINGS.fontSize),
  );
  return current;
}

export function saveSettings(patch: Partial<EditorSettings>): EditorSettings {
  current = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn(current);
  return current;
}

export function onSettingsChange(fn: (s: EditorSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Per-browser usage counts, used to rank frequently picked completions first. */
const USAGE_KEY = 'lc-completion-usage';
let usage: Record<string, number> | null = null;

export function usageBoost(label: string): number {
  if (!usage) {
    try {
      usage = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}') as Record<string, number>;
    } catch {
      usage = {};
    }
  }
  return Math.min(5, Math.log2(1 + (usage[label] ?? 0)));
}

export function recordUsage(label: string): void {
  usageBoost(label);
  usage![label] = (usage![label] ?? 0) + 1;
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    /* ignore */
  }
}
