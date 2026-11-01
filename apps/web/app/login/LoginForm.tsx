'use client';

import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MeResponse } from '@latex-cloud/shared';
import { Alert, Button, TextField } from '@latex-cloud/ui';
import { Brand } from '../../components/AppHeader';
import { ApiError, apiFetch, safeNextPath } from '../../lib/api';

export function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await apiFetch('/api/v1/auth/login', MeResponse, {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      // Full navigation: the client router may hold prefetched (pre-login)
      // redirects, and auth state changes should reset all client caches.
      window.location.assign(safeNextPath(params.get('next')));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
      setPending(false);
    }
  }

  return (
    <div className="login__card">
      <Brand />
      <h1 className="login__title">Sign in</h1>
      <form className="login__form" onSubmit={onSubmit} noValidate={false}>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" variant="primary" block disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
