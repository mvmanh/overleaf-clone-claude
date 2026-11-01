import { extensionOf } from '@latex-cloud/shared';
import { type BibEntry, parseBib } from './bib';
import {
  scanTex,
  type TexCommandDef,
  type TexEnvironmentDef,
  type TexLabel,
  type TexScan,
} from './tex-scan';

export interface IndexedBibEntry extends BibEntry {
  file: string;
}

export interface IndexedLabel extends TexLabel {
  file: string;
}

export interface IndexedCommand extends TexCommandDef {
  file: string;
}

const TEX_LIKE = new Set(['tex', 'ltx', 'sty', 'cls', 'dtx', 'tikz']);

/**
 * In-browser index of everything the editor can suggest from the project:
 * citation keys, labels, user macros/environments, loaded packages, files.
 * Files are re-parsed individually; the open file is re-indexed from the live
 * editor buffer, so suggestions reflect unsaved typing.
 */
export class ProjectIndex {
  private bib = new Map<string, BibEntry[]>();
  private tex = new Map<string, TexScan>();
  private paths: string[] = [];
  private listeners = new Set<() => void>();
  private cache: {
    bib?: IndexedBibEntry[];
    labels?: IndexedLabel[];
    commands?: IndexedCommand[];
    envs?: TexEnvironmentDef[];
    packages?: Set<string>;
  } = {};
  /** Increments on every change (cheap memo key for consumers). */
  version = 0;

  setFiles(paths: readonly string[]): void {
    this.paths = [...paths].sort();
    const live = new Set(paths);
    for (const p of [...this.bib.keys()]) if (!live.has(p)) this.bib.delete(p);
    for (const p of [...this.tex.keys()]) if (!live.has(p)) this.tex.delete(p);
    this.changed();
  }

  /** (Re)indexes one file's text. */
  update(path: string, content: string): void {
    const ext = extensionOf(path);
    if (ext === 'bib') this.bib.set(path, parseBib(content));
    else if (TEX_LIKE.has(ext)) this.tex.set(path, scanTex(content));
    else return;
    this.changed();
  }

  remove(path: string): void {
    this.bib.delete(path);
    this.tex.delete(path);
    this.changed();
  }

  get files(): readonly string[] {
    return this.paths;
  }

  get bibEntries(): IndexedBibEntry[] {
    if (!this.cache.bib) {
      const out: IndexedBibEntry[] = [];
      for (const [file, entries] of this.bib) for (const e of entries) out.push({ ...e, file });
      // \bibitem keys behave like citations too.
      for (const [file, scan] of this.tex) {
        for (const key of scan.bibitems)
          out.push({ key, type: 'bibitem', fields: {}, line: 0, file });
      }
      const seen = new Set<string>();
      this.cache.bib = out.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
    }
    return this.cache.bib;
  }

  get labels(): IndexedLabel[] {
    if (!this.cache.labels) {
      const out: IndexedLabel[] = [];
      for (const [file, scan] of this.tex) for (const l of scan.labels) out.push({ ...l, file });
      this.cache.labels = out;
    }
    return this.cache.labels;
  }

  get commands(): IndexedCommand[] {
    if (!this.cache.commands) {
      const out: IndexedCommand[] = [];
      for (const [file, scan] of this.tex) for (const c of scan.commands) out.push({ ...c, file });
      this.cache.commands = out;
    }
    return this.cache.commands;
  }

  get environments(): TexEnvironmentDef[] {
    if (!this.cache.envs) {
      const out = new Map<string, TexEnvironmentDef>();
      for (const scan of this.tex.values()) for (const e of scan.environments) out.set(e.name, e);
      this.cache.envs = [...out.values()];
    }
    return this.cache.envs;
  }

  get packages(): Set<string> {
    if (!this.cache.packages) {
      const out = new Set<string>();
      for (const scan of this.tex.values()) {
        for (const p of scan.packages) out.add(p.name);
        if (scan.documentClass) out.add(`class:${scan.documentClass}`);
      }
      this.cache.packages = out;
    }
    return this.cache.packages;
  }

  /** True once at least one .bib file or \bibitem exists (enables missing-key checks). */
  get hasBibliography(): boolean {
    return this.bib.size > 0 || [...this.tex.values()].some((s) => s.bibitems.length > 0);
  }

  /** KaTeX macro table from user definitions (for math previews). */
  katexMacros(): Record<string, string> {
    const macros: Record<string, string> = {};
    for (const c of this.commands) {
      if (c.kind === 'operator') macros[`\\${c.name}`] = c.body;
      else if (!c.body.includes('\\par') && c.body.length < 500) macros[`\\${c.name}`] = c.body;
    }
    return macros;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.cache = {};
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
