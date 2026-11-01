import { describe, expect, it } from 'vitest';
import { escapeSnippetText, withExit } from './snippet-text';

function render(template: string): string {
  return template
    .replace(/[#$]\{(?:(\d+)(?::([^{}]*))?|((?:\\[{}]|[^{}])*))\}/g, (_, _n, a, b) => a ?? b ?? '')
    .replace(/\\([{}])/g, '$1');
}

describe('escapeSnippetText', () => {
  it.each([
    'plain text',
    '\\left\\{ x \\right\\}',
    'cost is ${x}',
    'a #{b} c',
    '\\frac{a}{b}',
    '{nested {braces}}',
  ])('round-trips %j through a snippet template', (text) => {
    expect(render(`\\textbf{${escapeSnippetText(text)}}`)).toBe(`\\textbf{${text}}`);
  });
});

describe('withExit', () => {
  it('adds a final stop only to templates with fields', () => {
    expect(withExit('\\frac{${}}{${}}')).toBe('\\frac{${}}{${}}${}');
    expect(withExit('\\alpha')).toBe('\\alpha');
    expect(withExit('a ${x} b ${}')).toBe('a ${x} b ${}');
  });
});
