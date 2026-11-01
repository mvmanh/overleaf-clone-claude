import { z } from 'zod';

export const SESSION_COOKIE_NAME = 'lc_session';

export const Email = z.string().trim().toLowerCase().min(3).max(254).email();

export const LoginRequest = z.object({
  email: Email,
  // Upper bound prevents hashing-cost abuse with megabyte passwords.
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const SessionUser = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const MeResponse = z.object({ user: SessionUser });
export type MeResponse = z.infer<typeof MeResponse>;
