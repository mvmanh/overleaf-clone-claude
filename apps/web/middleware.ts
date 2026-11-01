import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'lc_session';

/**
 * UX-only routing hint: send visitors without a session cookie to /login.
 * Authorization is enforced by the API on every request, never here.
 */
export function middleware(req: NextRequest) {
  if (!req.cookies.has(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/projects/:path*'] };
