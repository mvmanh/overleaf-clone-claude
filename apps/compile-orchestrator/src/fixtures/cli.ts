/* Fixture runner: compiles tests/compile-fixtures/* through the configured executor.
 * Usage: pnpm fixtures:compile [-- <name-filter>]
 * Writes PDFs/logs to tests/compile-fixtures/<name>/_out/ for manual inspection. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadOrchestratorEnv } from '../config';
import { createExecutor } from '../executors/factory';
import { FIXTURES_DIR, loadFixtures, runFixture } from './load';

async function main() {
  const filter = process.argv.slice(2).find((a) => a !== '--');
  const executor = createExecutor(loadOrchestratorEnv());
  const fixtures = loadFixtures(filter);
  console.log(
    `executor: ${executor.descriptor.kind} (isolation: ${executor.descriptor.isolation})`,
  );
  console.log(`image:    ${executor.descriptor.texImage}\n`);

  const rows: string[][] = [
    ['fixture', 'engine', 'outcome', 'setup', 'compile', 'total', 'pdf', 'result'],
  ];
  let failed = 0;
  for (const fixture of fixtures) {
    const o = await runFixture(executor, fixture);
    const outDir = join(FIXTURES_DIR, fixture.name, '_out');
    await mkdir(outDir, { recursive: true });
    for (const a of o.writer.artifacts.values()) await writeFile(join(outDir, a.fileName), a.data);
    await writeFile(join(outDir, 'result.json'), JSON.stringify(o.result, null, 2));
    const pdf = o.writer.artifacts.get('pdf');
    const t = o.result.timings;
    rows.push([
      fixture.name,
      fixture.spec.engine,
      o.result.outcome,
      `${t.setupMs}ms`,
      `${t.compileMs}ms`,
      `${t.totalMs}ms`,
      pdf ? `${Math.round(pdf.data.byteLength / 1024)}KiB` : '-',
      o.failures.length ? 'FAIL' : 'ok',
    ]);
    if (o.failures.length) {
      failed++;
      for (const f of o.failures) console.error(`  ✗ ${fixture.name}: ${f}`);
    }
  }
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i]!)).join('  '));
  console.log(`\n${fixtures.length - failed}/${fixtures.length} fixtures passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
