'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CompileJob, LatestCompilesResponse, TERMINAL_COMPILE_STATUSES } from '@latex-cloud/shared';
import { ApiError, apiFetch } from '../../../lib/api';

export interface CompileState {
  /** Most recent job (may be running or failed). */
  latest: CompileJob | null;
  /** Most recent job with a PDF; shown while newer builds run or fail. */
  lastSuccessful: CompileJob | null;
  requesting: boolean;
  error: string | null;
}

const isTerminal = (j: CompileJob) => TERMINAL_COMPILE_STATUSES.includes(j.status);

/** Requests compiles and follows them to completion (polling with backoff). */
export function useCompile(projectId: string, beforeCompile: () => Promise<void>) {
  const [state, setState] = useState<CompileState>({
    latest: null,
    lastSuccessful: null,
    requesting: false,
    error: null,
  });
  const polling = useRef<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const follow = useCallback(async (job: CompileJob) => {
    polling.current = job.id;
    let current = job;
    let delay = 400;
    while (alive.current && polling.current === job.id && !isTerminal(current)) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(1500, delay * 1.3);
      try {
        current = await apiFetch(`/api/v1/compiles/${job.id}`, CompileJob);
      } catch {
        continue; // transient; keep following
      }
      if (alive.current && polling.current === job.id) setState((s) => ({ ...s, latest: current }));
    }
    if (
      alive.current &&
      current.status === 'succeeded' &&
      current.artifacts.some((a) => a.kind === 'pdf')
    ) {
      setState((s) => ({ ...s, lastSuccessful: current }));
    }
  }, []);

  // Initial state: show the last good PDF and the latest diagnostics.
  useEffect(() => {
    void apiFetch(`/api/v1/projects/${projectId}/compiles/latest`, LatestCompilesResponse)
      .then((r) => {
        if (!alive.current) return;
        setState((s) => ({ ...s, latest: r.latest, lastSuccessful: r.lastSuccessful }));
        if (r.latest && !isTerminal(r.latest)) void follow(r.latest);
      })
      .catch(() => undefined);
  }, [projectId, follow]);

  const compile = useCallback(async () => {
    setState((s) => ({ ...s, requesting: true, error: null }));
    try {
      await beforeCompile(); // the server must have what is on screen
      const job = await apiFetch(`/api/v1/projects/${projectId}/compiles`, CompileJob, {
        method: 'POST',
      });
      setState((s) => ({ ...s, latest: job, requesting: false }));
      if (isTerminal(job)) {
        if (job.status === 'succeeded') setState((s) => ({ ...s, lastSuccessful: job }));
      } else {
        await follow(job);
      }
    } catch (e) {
      setState((s) => ({
        ...s,
        requesting: false,
        error: e instanceof ApiError ? e.message : 'Could not start the compile.',
      }));
    }
  }, [projectId, beforeCompile, follow]);

  const busy = state.requesting || (state.latest !== null && !isTerminal(state.latest));
  return { ...state, busy, compile };
}
