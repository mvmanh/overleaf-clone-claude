import type {
  ArtifactKind,
  ArtifactWriter,
  SandboxOutcome,
  SandboxRunResult,
  SandboxTimings,
} from '@latex-cloud/compiler-protocol';
import { sha256Hex } from '@latex-cloud/compiler-protocol';
import { parseTexLog } from '@latex-cloud/tex-log-parser';

export function jobBaseName(rootFile: string): string {
  const base = rootFile.split('/').pop() ?? rootFile;
  return base.replace(/\.(tex|ltx)$/i, '');
}

/**
 * Turns raw sandbox output files into a SandboxRunResult and streams artifacts
 * to the writer. Shared by all executors so outcomes are classified identically.
 */
export async function finalizeRun(opts: {
  files: Map<string, Buffer>;
  rootFile: string;
  exitCode: number | null;
  forcedOutcome?: SandboxOutcome | undefined;
  message?: string | undefined;
  timings: Omit<SandboxTimings, 'collectMs' | 'totalMs'> & { startedAt: number };
  writer: ArtifactWriter;
  workspaceRoots: string[];
}): Promise<SandboxRunResult> {
  const collectStart = performance.now();
  const base = jobBaseName(opts.rootFile);
  const wanted: [ArtifactKind, string][] = [
    ['pdf', `${base}.pdf`],
    ['log', `${base}.log`],
    ['synctex', `${base}.synctex.gz`],
  ];

  const artifacts: SandboxRunResult['artifacts'] = [];
  for (const [kind, name] of wanted) {
    const data = opts.files.get(name);
    if (!data) continue;
    // A PDF must look like a PDF; never publish arbitrary bytes as one.
    if (kind === 'pdf' && data.subarray(0, 5).toString('latin1') !== '%PDF-') continue;
    await opts.writer.write(kind, name, data);
    artifacts.push({ kind, fileName: name, sizeBytes: data.byteLength, sha256: sha256Hex(data) });
  }

  const log = opts.files.get(`${base}.log`)?.toString('utf8') ?? '';
  const diagnostics = parseTexLog(log, { workspaceRoots: opts.workspaceRoots });
  const hasPdf = artifacts.some((a) => a.kind === 'pdf');

  let outcome: SandboxOutcome;
  if (opts.forcedOutcome) outcome = opts.forcedOutcome;
  else if (opts.exitCode === 0 && hasPdf) outcome = 'succeeded';
  else outcome = 'compile-error';

  if (outcome === 'compile-error' && diagnostics.every((d) => d.severity !== 'error')) {
    const tail = opts.files
      .get('latexmk.stdout')
      ?.toString('utf8')
      .split('\n')
      .slice(-6)
      .join('\n');
    diagnostics.unshift({
      severity: 'error',
      message: hasPdf ? 'latexmk reported a failure.' : 'No PDF was produced.',
      code: 'build-failed',
      ...(tail ? { excerpt: tail } : {}),
    });
  }

  const collectMs = Math.round(performance.now() - collectStart);
  return {
    outcome,
    exitCode: opts.exitCode,
    timings: {
      setupMs: opts.timings.setupMs,
      compileMs: opts.timings.compileMs,
      collectMs,
      totalMs: Math.round(performance.now() - opts.timings.startedAt),
    },
    artifacts,
    diagnostics,
    ...(opts.message ? { message: opts.message } : {}),
  };
}

export function rejectedResult(message: string, startedAt: number): SandboxRunResult {
  return {
    outcome: 'input-rejected',
    exitCode: null,
    timings: {
      setupMs: 0,
      compileMs: 0,
      collectMs: 0,
      totalMs: Math.round(performance.now() - startedAt),
    },
    artifacts: [],
    diagnostics: [{ severity: 'error', message, code: 'input-rejected' }],
    message,
  };
}
