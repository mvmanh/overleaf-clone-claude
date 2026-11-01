import { describe, expect, it } from 'vitest';
import { parseTexLog } from './index';

const roots = ['/work/src'];

describe('parseTexLog', () => {
  it('extracts file and line from -file-line-error output', () => {
    const log = [
      '(./main.tex',
      './main.tex:12: Undefined control sequence.',
      'l.12 \\foo',
      '         {bar}',
    ].join('\n');
    const [d] = parseTexLog(log, { workspaceRoots: roots });
    expect(d).toMatchObject({
      severity: 'error',
      file: 'main.tex',
      line: 12,
      code: 'undefined-control-sequence',
    });
    expect(d?.hint).toBeTruthy();
  });

  it('rewrites absolute workspace paths and hides TeX Live internals', () => {
    const log = [
      "/work/src/chapters/intro.tex:3: LaTeX Error: File `missing.png' not found.",
      '/usr/share/texlive/texmf-dist/tex/latex/base/size10.clo:7: Something odd.',
    ].join('\n');
    const ds = parseTexLog(log, { workspaceRoots: roots });
    expect(ds[0]).toMatchObject({ file: 'chapters/intro.tex', line: 3, code: 'missing-file' });
    expect(ds[1]?.file).toBeUndefined();
    expect(ds[1]?.line).toBe(7);
  });

  it('falls back to "! message" + l.N when file-line-error is unavailable', () => {
    const log = [
      '! Missing $ inserted.',
      '<inserted text>',
      '                $',
      'l.8 x^',
      '      2',
    ].join('\n');
    expect(parseTexLog(log)[0]).toMatchObject({ line: 8, code: 'missing-math-delimiter' });
  });

  it('collects warnings with continuation lines and input line numbers', () => {
    const log = [
      "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 22.",
      'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
      "(hyperref)                removing `math shift' on input line 9.",
    ].join('\n');
    const ds = parseTexLog(log);
    expect(ds[0]).toMatchObject({ severity: 'warning', line: 22, code: 'undefined-reference' });
    expect(ds[1]).toMatchObject({ severity: 'warning', line: 9 });
    expect(ds[1]?.message).toMatch(/^hyperref: Token not allowed .* removing/);
  });

  it('reports bad boxes as info', () => {
    const ds = parseTexLog('Overfull \\hbox (12.3pt too wide) in paragraph at lines 40--42');
    expect(ds[0]).toMatchObject({ severity: 'info', line: 40, code: 'bad-box' });
  });

  it('deduplicates and bounds output', () => {
    const log = Array.from({ length: 1000 }, (_, i) => `./a.tex:${i + 1}: Boom.`).join('\n');
    expect(parseTexLog(log, { maxDiagnostics: 50 })).toHaveLength(50);
    expect(parseTexLog('./a.tex:1: Boom.\n./a.tex:1: Boom.')).toHaveLength(1);
  });

  it('suppresses the trailing emergency stop when a real error exists', () => {
    const log = './main.tex:3: Undefined control sequence.\n! Emergency stop.\n';
    expect(parseTexLog(log)).toHaveLength(1);
    const fle = [
      "./main.tex:4: I can't write on file `../x.txt'.",
      './main.tex:4: Emergency stop.',
      './main.tex:4:  ==> Fatal error occurred, no output PDF file produced!',
    ].join('\n');
    expect(parseTexLog(fle).map((d) => d.code)).toEqual(['write-denied']);
  });

  it('never throws on garbage', () => {
    expect(() => parseTexLog('\u0000\u0001((((( ! \nl.\n:::')).not.toThrow();
  });
});
