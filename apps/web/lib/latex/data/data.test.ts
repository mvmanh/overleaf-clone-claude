import { describe, expect, it } from 'vitest';
import { AUTO_RULES, findAutoExpansion } from './auto-expand';
import { COMMANDS, paletteCategories } from './commands';
import { ENVIRONMENTS } from './environments';
import { WORD_SNIPPETS } from './snippets';

/** What CodeMirror's snippet() produces as text: fields → their names, \{ \} unescaped. */
function render(template: string): string {
  return template
    .replace(/[#$]\{(?:(\d+)(?::([^{}]*))?|((?:\\[{}]|[^{}])*))\}/g, (_, _n, a, b) => a ?? b ?? '')
    .replace(/\\([{}])/g, '$1');
}

function balanced(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth < 0) return false;
  }
  return depth === 0;
}

const templates: [string, string][] = [
  ...COMMANDS.filter((c) => c.snippet).map((c) => [`\\${c.name}`, c.snippet!] as [string, string]),
  ...ENVIRONMENTS.map(
    (e) =>
      [`env ${e.name}`, `\\begin{${e.name}}${e.args ?? ''}\n${e.body}\n\\end{${e.name}}`] as [
        string,
        string,
      ],
  ),
  ...WORD_SNIPPETS.map((s) => [`snippet ${s.prefix}`, s.body] as [string, string]),
  ...AUTO_RULES.map(
    (r) => [`auto ${String(r.trigger)}`, r.replace.replace(/\$\d/g, 'x')] as [string, string],
  ),
];

describe('every snippet template', () => {
  it.each(templates)('%s renders to balanced LaTeX without stray backslashes', (_, template) => {
    const text = render(template);
    expect(balanced(text), text).toBe(true);
    expect(text, text).not.toMatch(/\\\\\\/); // three backslashes = an escaping mistake
    expect(text).not.toMatch(/\$\{/);
  });
});

describe('catalogue sanity', () => {
  it('has a large, unique-enough command set with a symbol palette', () => {
    expect(COMMANDS.length).toBeGreaterThan(400);
    const cats = paletteCategories();
    expect(cats.map((c) => c.category)).toEqual(
      expect.arrayContaining(['Greek', 'Relations', 'Arrows', 'Binary operators']),
    );
    expect(cats.flatMap((c) => c.items).every((i) => i.glyph)).toBe(true);
  });

  it('renders brace-bearing commands correctly', () => {
    expect(render(COMMANDS.find((c) => c.name === 'left\\{')!.snippet!)).toBe(
      '\\left\\{  \\right\\}',
    );
    expect(render(COMMANDS.find((c) => c.name === 'substack')!.snippet!)).toBe(
      '\\substack{i<n \\\\ j<m}',
    );
  });

  it('word snippets have unique prefixes per mode', () => {
    const keys = WORD_SNIPPETS.map((s) => `${s.mode}:${s.prefix}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('findAutoExpansion', () => {
  const math = (before: string) => findAutoExpansion(before, 'math');

  it.each([
    ['a //', '\\frac{${}}{${}}', 2],
    ['x1', 'x_1', 2],
    ['x_12', 'x_{12}', 4],
    ['= xhat', '\\hat{x}', 4],
    ['= xbar', '\\overline{x}', 4],
    ['a <=', '\\leq ', 2],
    ['a <->', '\\leftrightarrow ', 3],
    ['@a', '\\alpha', 2],
    ['@ve', '\\varepsilon', 3],
    [' RR', '\\mathbb{R}', 2],
    [' sum', '\\sum_{${i=1}}^{${n}} ', 3],
    ['x ...', '\\dots ', 3],
  ])('%j → %j', (before, template, length) => {
    expect(math(before)).toMatchObject({ template, length });
  });

  it.each([
    '\\sum',
    'summary',
    '\\begin{cases',
    '\\log2',
    'ab1',
    '\\partial',
    '\\mathtt',
    'x \\lim',
  ])('does not fire inside commands or words: %j', (before) => {
    expect(math(before)).toBeNull();
  });

  it('separates text and math triggers', () => {
    expect(findAutoExpansion('see mk', 'text')?.template).toBe('$${}$');
    expect(findAutoExpansion('see mk', 'math')).toBeNull();
    expect(findAutoExpansion('x1', 'text')).toBeNull();
    expect(findAutoExpansion('mkdir', 'text')).toBeNull();
    expect(findAutoExpansion('  beg', 'text')?.template).toContain('\\begin{${env}}');
    expect(findAutoExpansion('we beg', 'text')).toBeNull(); // "begin", "began" in prose
    expect(findAutoExpansion('so dm', 'text')).toBeNull();
  });
});
