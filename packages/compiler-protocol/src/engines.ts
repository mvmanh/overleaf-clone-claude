import { z } from 'zod';
import { validateProjectPath } from './paths';

export const TexEngine = z.enum(['pdflatex', 'xelatex', 'lualatex']);
export type TexEngine = z.infer<typeof TexEngine>;

export interface EngineConfig {
  engine: TexEngine;
  /** latexmk switch selecting the engine. */
  latexmkFlag: '-pdf' | '-xelatex' | '-lualatex';
  label: string;
}

export const ENGINE_CONFIGS: Readonly<Record<TexEngine, EngineConfig>> = Object.freeze({
  pdflatex: { engine: 'pdflatex', latexmkFlag: '-pdf', label: 'pdfLaTeX' },
  xelatex: { engine: 'xelatex', latexmkFlag: '-xelatex', label: 'XeLaTeX' },
  lualatex: { engine: 'lualatex', latexmkFlag: '-lualatex', label: 'LuaLaTeX' },
});

/**
 * Arguments passed to latexmk. These are fixed by the platform; nothing in a
 * project (including a `latexmkrc`, which is Perl code) may change them.
 *
 * `-norc` stops latexmk from reading any rc file — critically the project's own
 * `./latexmkrc`, which would otherwise be arbitrary code execution. The trusted,
 * image-owned rc file is passed explicitly with `-r`.
 */
export function buildLatexmkArgs(opts: {
  engine: TexEngine;
  rootFile: string;
  outDir: string;
  rcFile: string;
}): string[] {
  const root = validateProjectPath(opts.rootFile);
  if (!root.ok) throw new Error(`invalid root file: ${root.reason}`);
  return [
    '-norc',
    '-r',
    opts.rcFile,
    ENGINE_CONFIGS[opts.engine].latexmkFlag,
    '-interaction=nonstopmode',
    '-file-line-error',
    '-halt-on-error',
    '-synctex=1',
    '-no-shell-escape',
    `-outdir=${opts.outDir}`,
    // latexmk has no `--` end-of-options marker. Option injection via the root
    // file is prevented by validateProjectPath (no segment may start with "-").
    opts.rootFile,
  ];
}

/**
 * Environment for every TeX process. kpathsea reads these as texmf.cnf
 * overrides: refuse shell escape and restrict file writes/reads to the job
 * workspace ("p" = paranoid: no absolute paths, no `..`, no dotfiles).
 */
export const TEX_SAFE_ENV: Readonly<Record<string, string>> = Object.freeze({
  shell_escape: 'f',
  openout_any: 'p',
  openin_any: 'p',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  // Unwrapped log lines make diagnostics reliable to parse.
  max_print_line: '10000',
  error_line: '254',
  half_error_line: '238',
});
