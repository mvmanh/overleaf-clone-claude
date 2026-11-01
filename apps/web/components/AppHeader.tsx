'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button, ThemeToggle } from '@latex-cloud/ui';
import { useSession } from './useSession';

export function Brand() {
  return (
    <Link href="/projects" prefetch={false} className="brand" aria-label="latex-cloud home">
      <span className="brand__mark" aria-hidden>
        λ
      </span>
      latex-cloud
    </Link>
  );
}

export function AppHeader({ children }: { children?: ReactNode }) {
  const { user, signOut } = useSession();
  return (
    <header className="app-header">
      <Brand />
      {children}
      <span className="app-header__spacer" />
      <ThemeToggle />
      {user ? (
        <>
          <span className="app-header__user" data-testid="current-user">
            {user.displayName}
          </span>
          <Button size="sm" onClick={signOut}>
            Sign out
          </Button>
        </>
      ) : null}
    </header>
  );
}
