import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the trust boundary (ARCHITECTURE.md §2, AGENT_BRIEF rule 1): the API
 * must never execute TeX or obtain Docker privileges. Compilation belongs to
 * the compile orchestrator behind the SandboxExecutor interface.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/from ['"](node:)?child_process['"]|require\(['"](node:)?child_process['"]\)/, 'child_process'],
  [/docker\.sock|dockerode|DOCKER_HOST/i, 'Docker access'],
  // Engine *names* are legitimate data (project settings); the build driver is not.
  [/\blatexmk\b|shell-escape|\bkpsewhich\b/, 'TeX tooling'],
  [/\b(execa|shelljs|node-pty)\b/, 'process-spawning libraries'],
  [/@latex-cloud\/compile-orchestrator/, 'compile orchestrator import'],
];

describe('API trust boundary', () => {
  const files = sourceFiles(join(__dirname));

  it('has source files to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN)('no source file references %s (%s)', (pattern) => {
    const offenders = files.filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
