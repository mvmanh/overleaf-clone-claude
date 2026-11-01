import { describe, expect, it } from 'vitest';
import { templateFiles } from './templates';

describe('templateFiles', () => {
  it('always provides main.tex and uses fontspec for Unicode engines', () => {
    for (const t of ['blank', 'article', 'math', 'cs'] as const) {
      const files = templateFiles(t, 'X', 'pdflatex');
      expect(files[0]?.path).toBe('main.tex');
    }
    expect(templateFiles('article', 'X', 'xelatex')[0]?.content).toContain('fontspec');
    expect(templateFiles('article', 'X', 'pdflatex')[0]?.content).toContain('[T1,T5]{fontenc}');
    expect(templateFiles('math', 'X', 'pdflatex')[0]?.content).not.toContain('amsart');
  });

  it('escapes TeX special characters in the title', () => {
    const tex = templateFiles('article', String.raw`50% of $x_1 & \evil{} #1 ~^`, 'pdflatex')[0]!
      .content;
    const title = /\\title\{(.*)\}/.exec(tex)![1]!;
    expect(title).toBe(
      String.raw`50\% of \$x\_1 \& \textbackslash{}evil\{\} \#1 \textasciitilde{}\textasciicircum{}`,
    );
  });

  it('cs template ships a bibliography', () => {
    expect(templateFiles('cs', 'X', 'pdflatex').map((f) => f.path)).toEqual([
      'main.tex',
      'references.bib',
    ]);
  });
});
