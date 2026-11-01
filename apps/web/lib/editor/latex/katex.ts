type Katex = typeof import('katex');

let loading: Promise<Katex> | null = null;

/** KaTeX is loaded on first use so it does not weigh on the initial page. */
export function loadKatex(): Promise<Katex> {
  loading ??= import('katex').then(
    (m) => (m as unknown as { default?: Katex }).default ?? (m as unknown as Katex),
  );
  return loading;
}

/** Strips commands KaTeX does not know but that are harmless in previews. */
export function prepareForPreview(tex: string): string {
  return tex
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(nonumber|notag)\b/g, '')
    .replace(/\\(qedhere|displaybreak)\b/g, '')
    .trim();
}

export async function renderMathInto(
  el: HTMLElement,
  tex: string,
  opts: { display: boolean; macros?: Record<string, string> },
): Promise<void> {
  const katex = await loadKatex();
  try {
    katex.render(prepareForPreview(tex), el, {
      displayMode: opts.display,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      maxSize: 20,
      maxExpand: 500,
      macros: { ...opts.macros },
    });
    el.classList.remove('lc-katex-error');
  } catch (err) {
    el.textContent =
      err instanceof Error ? err.message.replace(/^KaTeX parse error: /, '') : 'Cannot render';
    el.classList.add('lc-katex-error');
  }
}
