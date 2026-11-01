'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MeResponse, type SessionUser } from '@latex-cloud/shared';
import { ApiError, apiFetch } from '../lib/api';

/** Loads the current user; redirects to /login when the session is missing or expired. */
export function useSession() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/v1/auth/me', MeResponse)
      .then((r) => !cancelled && setUser(r.user))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401)
          router.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const signOut = useCallback(async () => {
    await apiFetch('/api/v1/auth/logout', null, { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login'); // drop all client-side cached state
  }, []);

  return { user, signOut };
}
