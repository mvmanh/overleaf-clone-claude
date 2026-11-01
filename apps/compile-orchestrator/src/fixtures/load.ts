import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_SANDBOX_LIMITS,
  type SandboxExecutor,
  SandboxLimits,
  type SandboxRunResult,
  TexEngine,
} from '@latex-cloud/compiler-protocol';
import { MemoryArtifactWriter } from '../executors/memory-writer';
import { createSnapshot } from '../snapshot';

export const FIXTURES_DIR = resolve(__dirname, '../../../../tests/compile-fixtures');

export const FixtureSpec = z.object({
  description: z.string(),
  engine: TexEngine,
  rootFile: z.string().default('main.tex'),
  limits: SandboxLimits.partial().optional(),
  expect: z.object({
    outcome: z.enum([
      'succeeded',
      'compile-error',
      'timeout',
      'output-limit-exceeded',
      'input-rejected',
    ]),
    diagnostics: z
      .array(
        z.object({
          file: z.string().optional(),
          line: z.number().optional(),
          code: z.string().optional(),
        }),
      )
      .optional(),
    logIncludes: z.array(z.string()).optional(),
    pdfIncludes: z.array(z.string()).optional(),
    minPages: z.number().int().positive().optional(),
  }),
});
export type FixtureSpec = z.infer<typeof FixtureSpec>;

export interface Fixture {
  name: string;
  spec: FixtureSpec;
  files: { path: string; content: Buffer }[];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_out' || entry.name === 'fixture.json') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

export function loadFixtures(filter?: string): Fixture[] {
  const names = readdirSync(FIXTURES_DIR)
    .filter((n) => !filter || n.includes(filter))
    .sort();
  const fixtures: Fixture[] = [];
  for (const name of names) {
    const dir = join(FIXTURES_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const spec = FixtureSpec.parse(JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8')));
    const files = walk(dir).map((p) => ({
      path: relative(dir, p).split(sep).join('/'),
      content: readFileSync(p),
    }));
    fixtures.push({ name, spec, files });
  }
  return fixtures;
}

/**
 * Page count as reported by TeX ("Output written on main.pdf (3 pages, ...)").
 * Avoids a PDF parser dependency; PDFs use compressed object streams.
 */
export function pagesFromLog(log: string): number {
  const m = /Output written on .*?\((\d+) pages?,/.exec(log);
  return m ? Number(m[1]) : 0;
}

export interface FixtureOutcome {
  fixture: Fixture;
  result: SandboxRunResult;
  writer: MemoryArtifactWriter;
  failures: string[];
}

export async function runFixture(
  executor: SandboxExecutor,
  fixture: Fixture,
): Promise<FixtureOutcome> {
  const { spec } = fixture;
  const snapshot = createSnapshot({
    files: fixture.files,
    rootFile: spec.rootFile,
    engine: spec.engine,
    texImage: executor.descriptor.texImage,
  });
  const writer = new MemoryArtifactWriter();
  const limits = { ...DEFAULT_SANDBOX_LIMITS, ...spec.limits };
  const result = await executor.run(
    snapshot,
    { engine: spec.engine, rootFile: spec.rootFile },
    limits,
    writer,
  );

  const failures: string[] = [];
  const e = spec.expect;
  if (result.outcome !== e.outcome) {
    const firstError = result.diagnostics.find((d) => d.severity === 'error');
    failures.push(
      `outcome ${result.outcome} (expected ${e.outcome})${result.message ? `: ${result.message}` : ''}` +
        (firstError
          ? ` — ${firstError.file ?? '?'}:${firstError.line ?? '?'} ${firstError.message}`
          : ''),
    );
  }
  for (const want of e.diagnostics ?? []) {
    const hit = result.diagnostics.some(
      (d) =>
        (want.file === undefined || d.file === want.file) &&
        (want.line === undefined || d.line === want.line) &&
        (want.code === undefined || d.code === want.code),
    );
    if (!hit) {
      failures.push(
        `missing diagnostic ${JSON.stringify(want)}; got ${JSON.stringify(result.diagnostics.map((d) => ({ file: d.file, line: d.line, code: d.code })))}`,
      );
    }
  }
  const log = writer.artifacts.get('log');
  const logText = log ? Buffer.from(log.data).toString('utf8') : '';
  for (const s of e.logIncludes ?? [])
    if (!logText.includes(s)) failures.push(`log does not contain ${JSON.stringify(s)}`);

  const pdf = writer.artifacts.get('pdf');
  if (e.outcome === 'succeeded') {
    if (!pdf) failures.push('no PDF artifact');
    else {
      if (Buffer.from(pdf.data).subarray(0, 5).toString('latin1') !== '%PDF-')
        failures.push('PDF has no %PDF- header');
      const pages = pagesFromLog(logText);
      if (e.minPages && pages < e.minPages)
        failures.push(`PDF has ${pages} pages, expected >= ${e.minPages}`);
      if (!writer.artifacts.get('synctex')) failures.push('no SyncTeX artifact');
    }
  }
  return { fixture, result, writer, failures };
}
