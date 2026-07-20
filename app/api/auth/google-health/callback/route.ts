import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { db } from '@/db';
import { users, oauthTokens } from '@/db/schema';
import { encrypt } from '@/lib/crypto';
import { signSession, SESSION_COOKIE } from '@/lib/session';
import { eq, sql } from 'drizzle-orm';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name?: string;
}

/**
 * Phase 3 — OAuth callback route.
 * GET /api/auth/google-health/callback
 *
 * Exchanges the authorization code for tokens, encrypts the refresh token,
 * and upserts user + token rows via Drizzle.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // ── Error from Google ──────────────────────────────────────────────────────
  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.json({ error: 'Missing code parameter' }, { status: 400 });
  }

  // ── CSRF state check ───────────────────────────────────────────────────────
  const cookieHeader = request.headers.get('cookie') ?? '';
  const storedState = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('oauth_state='))
    ?.split('=')[1];

  if (!storedState || storedState !== state) {
    return NextResponse.json({ error: 'Invalid state parameter' }, { status: 400 });
  }

  const clientId = process.env.GOOGLE_HEALTH_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET!;
  const redirectUri = process.env.GOOGLE_HEALTH_REDIRECT_URI!;

  // ── Exchange code → tokens ─────────────────────────────────────────────────
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData: TokenResponse = await tokenRes.json();

  if (!tokenRes.ok || tokenData.error) {
    console.error('Token exchange error:', tokenData);
    return NextResponse.json(
      { error: tokenData.error_description ?? 'Token exchange failed' },
      { status: 400 }
    );
  }

  // ── Fetch user info ────────────────────────────────────────────────────────
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userInfoRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch user info' }, { status: 500 });
  }

  const userInfo: GoogleUserInfo = await userInfoRes.json();

  // ── Upsert user (generate shortcut_token on first login) ─────────────────
  // On conflict (re-auth): keep existing shortcut_token via COALESCE so iOS
  // users don't lose their Shortcut binding when they re-authorize.
  const newToken = randomBytes(24).toString('hex');
  const [user] = await db
    .insert(users)
    .values({
      email: userInfo.email,
      name: userInfo.name ?? null,
      shortcutToken: newToken,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: userInfo.name ?? null,
        // COALESCE keeps the old token if one already exists
        shortcutToken: sql`COALESCE(${users.shortcutToken}, ${newToken})`,
      },
    })
    .returning();

  // Safety: if token is still null (pre-existing user row with no token), set one now
  if (!user.shortcutToken) {
    const fallbackToken = randomBytes(24).toString('hex');
    await db
      .update(users)
      .set({ shortcutToken: fallbackToken })
      .where(eq(users.id, user.id));
    user.shortcutToken = fallbackToken;
  }

  // ── Encrypt refresh token and upsert tokens ────────────────────────────────
  const refreshTokenEncrypted = tokenData.refresh_token
    ? await encrypt(tokenData.refresh_token)
    : // If no refresh token returned, try to keep the existing one
      (
        await db
          .select({ refreshTokenEncrypted: oauthTokens.refreshTokenEncrypted })
          .from(oauthTokens)
          .where(eq(oauthTokens.userId, user.id))
          .limit(1)
      )[0]?.refreshTokenEncrypted ?? '';

  const accessTokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await db
    .insert(oauthTokens)
    .values({
      userId: user.id,
      refreshTokenEncrypted,
      accessToken: tokenData.access_token,
      accessTokenExpiresAt,
      scope: tokenData.scope,
      active: true,
    })
    .onConflictDoUpdate({
      target: oauthTokens.userId,
      set: {
        refreshTokenEncrypted,
        accessToken: tokenData.access_token,
        accessTokenExpiresAt,
        scope: tokenData.scope,
        active: true,
        updatedAt: new Date(),
      },
    });

  // ── Sign session JWT ───────────────────────────────────────────────────────
  const sessionToken = await signSession({
    userId: user.id,
    email: user.email,
    name: user.name ?? null,
  });

  // ── Clear state cookie, set session, redirect to /welcome ─────────────────
  const response = NextResponse.redirect(new URL('/welcome', request.url));

  response.cookies.set('oauth_state', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });

  response.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  return response;
}
