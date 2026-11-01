import { z } from 'zod';

export const CompileJobStatus = z.enum([
  'queued',
  'preparing',
  'running',
  'publishing',
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
]);
export type CompileJobStatus = z.infer<typeof CompileJobStatus>;

export const TERMINAL_STATUSES: ReadonlySet<CompileJobStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
]);

const TRANSITIONS: Readonly<Record<CompileJobStatus, readonly CompileJobStatus[]>> = {
  queued: ['preparing', 'cancelled', 'superseded'],
  preparing: ['running', 'failed', 'cancelled', 'superseded'],
  running: ['publishing', 'failed', 'cancelled', 'superseded'],
  // Once publishing starts the result is attributable to its own revision;
  // it can still be superseded for "is this the current PDF?" purposes.
  publishing: ['succeeded', 'failed', 'superseded'],
  succeeded: [],
  failed: [],
  cancelled: [],
  superseded: [],
};

export function canTransition(from: CompileJobStatus, to: CompileJobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidJobTransitionError extends Error {
  constructor(
    readonly from: CompileJobStatus,
    readonly to: CompileJobStatus,
  ) {
    super(`invalid compile job transition ${from} -> ${to}`);
    this.name = 'InvalidJobTransitionError';
  }
}

export function assertTransition(from: CompileJobStatus, to: CompileJobStatus): void {
  if (!canTransition(from, to)) throw new InvalidJobTransitionError(from, to);
}

export function isTerminal(status: CompileJobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
