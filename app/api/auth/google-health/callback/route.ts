import { NextResponse } from 'next/server';
import { db } from '@/db';
import { users, oauthTokens } from '@/db/schema';
import { encrypt } from '@/lib/crypto';
import { eq } from 'drizzle-orm';

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

  // ── Upsert user ────────────────────────────────────────────────────────────
  const [user] = await db
    .insert(users)
    .values({
      email: userInfo.email,
      name: userInfo.name ?? null,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: userInfo.name ?? null },
    })
    .returning();

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

  // ── Clear state cookie and redirect to leaderboard ────────────────────────
  const response = NextResponse.redirect(new URL('/leaderboard', request.url));
  response.cookies.set('oauth_state', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });

  return response;
}
