import { NextResponse } from 'next/server';

const GOOGLE_HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'openid',
  'email',
  'profile',
];

/**
 * Phase 3 — OAuth authorize route.
 * GET /api/auth/google-health/authorize
 *
 * Redirects the user to Google's OAuth consent screen.
 * NOTE: Do NOT add include_granted_scopes=true — mixing legacy Google Fit
 *       fitness.* scopes with new googlehealth.* scopes causes 403 errors.
 */
export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_HEALTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_HEALTH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error:
          'Missing GOOGLE_HEALTH_CLIENT_ID or GOOGLE_HEALTH_REDIRECT_URI env vars',
      },
      { status: 500 }
    );
  }

  // Generate a CSRF state token
  const state = crypto.randomUUID();

  // Store state in a short-lived cookie so the callback can verify it
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_HEALTH_SCOPES.join(' '),
    access_type: 'offline',
    state,
    // Only include prompt=consent when explicitly re-authorizing to get a
    // fresh refresh token. Omitting it skips re-consent for returning users.
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  const response = NextResponse.redirect(googleAuthUrl);
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  });

  return response;
}
