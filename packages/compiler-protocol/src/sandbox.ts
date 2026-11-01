import { z } from 'zod';
import type { Diagnostic } from './diagnostics';
import type { TexEngine } from './engines';
import type { RevisionManifest } from './manifest';

/**
 * How strongly an executor isolates an untrusted TeX run from its host.
 *
 * - `none`            — runs TeX directly on the host. Trusted documents only.
 * - `container`       — ordinary Linux container (runc). Defence in depth, but a
 *                       shared kernel; NOT a security boundary for strangers.
 * - `gvisor`          — user-space kernel (runsc) per job.
 * - `microvm`         — hardware-virtualised per-job VM (Firecracker etc).
 */
export const IsolationLevel = z.enum(['none', 'container', 'gvisor', 'microvm']);
export type IsolationLevel = z.infer<typeof IsolationLevel>;

export const STRONG_ISOLATION: ReadonlySet<IsolationLevel> = new Set(['gvisor', 'microvm']);

export const SandboxLimits = z.object({
  wallTimeMs: z.number().int().positive(),
  cpus: z.number().positive(),
  memoryBytes: z.number().int().positive(),
  pids: z.number().int().positive(),
  /** Total size of the job's writable scratch space. */
  scratchBytes: z.number().int().positive(),
  /** Maximum bytes accepted back from the sandbox (artifacts + log). */
  maxOutputBytes: z.number().int().positive(),
  /** Maximum size of a single input file. */
  maxInputFileBytes: z.number().int().positive(),
  /** Maximum total input snapshot size. */
  maxInputBytes: z.number().int().positive(),
});
export type SandboxLimits = z.infer<typeof SandboxLimits>;

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = Object.freeze({
  wallTimeMs: 60_000,
  cpus: 1,
  memoryBytes: 1024 * 1024 * 1024,
  pids: 128,
  scratchBytes: 512 * 1024 * 1024,
  maxOutputBytes: 64 * 1024 * 1024,
  maxInputFileBytes: 50 * 1024 * 1024,
  maxInputBytes: 200 * 1024 * 1024,
});

/** One materialised source file handed to the executor. */
export interface SnapshotFile {
  path: string;
  content: Uint8Array;
}

/** Immutable input to a sandboxed run; content must match `manifest`. */
export interface SourceSnapshot {
  manifest: RevisionManifest;
  fingerprint: string;
  files: readonly SnapshotFile[];
}

export interface EngineRunConfig {
  engine: TexEngine;
  rootFile: string;
}

export type ArtifactKind = 'pdf' | 'log' | 'synctex';

/**
 * Receives artifacts from the executor. The orchestrator implements this (e.g.
 * streaming to object storage); the sandbox never sees storage credentials.
 */
export interface ArtifactWriter {
  write(kind: ArtifactKind, fileName: string, data: Uint8Array): Promise<void>;
}

export type SandboxOutcome =
  | 'succeeded'
  | 'compile-error'
  | 'timeout'
  | 'output-limit-exceeded'
  | 'input-rejected'
  | 'cancelled'
  | 'sandbox-error';

export interface SandboxTimings {
  /** Time to provision the isolated environment and hand it the snapshot. */
  setupMs: number;
  /** Time spent inside latexmk (as observed from outside). */
  compileMs: number;
  /** Time spent collecting and writing artifacts. */
  collectMs: number;
  totalMs: number;
}

export interface SandboxRunResult {
  outcome: SandboxOutcome;
  exitCode: number | null;
  timings: SandboxTimings;
  artifacts: { kind: ArtifactKind; fileName: string; sizeBytes: number; sha256: string }[];
  diagnostics: Diagnostic[];
  /** Short, human-readable summary for non-`succeeded` outcomes. */
  message?: string;
}

export interface ExecutorDescriptor {
  /** Implementation id, e.g. `local-trusted-dev`, `docker`, `docker+runsc`. */
  kind: string;
  isolation: IsolationLevel;
  /** True when the executor may only ever process documents from trusted authors. */
  trustedInputOnly: boolean;
  /** Content-addressed TeX image the executor runs, when applicable. */
  texImage: string;
}

/**
 * Contract every compile executor implements. See
 * docs/security/compile-sandbox.md for the requirements on implementations.
 */
export interface SandboxExecutor {
  readonly descriptor: ExecutorDescriptor;
  run(
    snapshot: SourceSnapshot,
    engineConfig: EngineRunConfig,
    limits: SandboxLimits,
    artifactWriter: ArtifactWriter,
    signal?: AbortSignal,
  ): Promise<SandboxRunResult>;
}

export type DeploymentMode = 'development' | 'test' | 'production';

export interface SecurityGateInput {
  mode: DeploymentMode;
  descriptor: ExecutorDescriptor;
  /**
   * Reference to an independent review that verified the sandbox (threat model,
   * adversarial suite, isolation tests). Required for production. Setting this
   * is a human release decision, never a default.
   */
  sandboxAttestation?: string | undefined;
}

export type SecurityGateDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * The production security gate (ADR-007). Pure function so it is trivially
 * unit-testable and reusable by every process that can start an executor.
 */
export function evaluateSecurityGate(input: SecurityGateInput): SecurityGateDecision {
  const { mode, descriptor } = input;
  if (mode !== 'production') return { allowed: true };

  if (descriptor.trustedInputOnly) {
    return {
      allowed: false,
      reason: `executor "${descriptor.kind}" is trusted-input-only and can never run in production`,
    };
  }
  if (!STRONG_ISOLATION.has(descriptor.isolation)) {
    return {
      allowed: false,
      reason: `executor "${descriptor.kind}" provides "${descriptor.isolation}" isolation; production requires gvisor or microvm`,
    };
  }
  if (!input.sandboxAttestation || input.sandboxAttestation.trim().length === 0) {
    return {
      allowed: false,
      reason:
        'production requires COMPILE_SANDBOX_ATTESTATION referencing an independent sandbox security review',
    };
  }
  return { allowed: true };
}

export class SecurityGateError extends Error {
  constructor(reason: string) {
    super(`compile sandbox security gate refused to start: ${reason}`);
    this.name = 'SecurityGateError';
  }
}

export function assertSecurityGate(input: SecurityGateInput): void {
  const decision = evaluateSecurityGate(input);
  if (!decision.allowed) throw new SecurityGateError(decision.reason);
}
