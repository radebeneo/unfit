/**
 * Lightweight JWT session helpers using `jose` (already a project dependency).
 *
 * The session cookie (`unfit_session`) is an HS256-signed JWT containing:
 *   { userId, email, name }
 *
 * SESSION_SECRET must be set in .env.local:
 *   SESSION_SECRET=<openssl rand -hex 32>
 *
 * Falls back to TOKEN_ENCRYPTION_KEY if SESSION_SECRET is not set (convenient
 * for local dev, but set a separate secret in production).
 */

import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'unfit_session';
const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days in seconds

export interface SessionPayload {
  userId: string;
  email: string;
  name: string | null;
}

function getSecret(): Uint8Array {
  const raw =
    process.env.SESSION_SECRET ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'SESSION_SECRET (or TOKEN_ENCRYPTION_KEY) env var is required for session signing.'
    );
  }
  return new TextEncoder().encode(raw);
}

/** Signs a new session JWT. */
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(getSecret());
}

/** Verifies and decodes a session JWT. Returns null if invalid/expired. */
export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
