import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { oauthTokens, stepsDaily, users } from '@/db/schema';
import { decrypt, encrypt } from '@/lib/crypto';
import { eq, and } from 'drizzle-orm';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_HEALTH_BASE = 'https://healthcare.googleapis.com'; // placeholder — update to real endpoint once confirmed

interface TokenRefreshResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

interface DailyRollUpEntry {
  date: string; // YYYY-MM-DD
  steps: number;
}

/**
 * Refreshes an access token using a stored (decrypted) refresh token.
 * Returns null on invalid_grant (token revoked) so the caller can deactivate.
 */
async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_HEALTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data: TokenRefreshResponse = await res.json();

  if (!res.ok || data.error) {
    if (data.error === 'invalid_grant') return null;
    throw new Error(data.error_description ?? `Token refresh failed: ${data.error}`);
  }

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Fetches step data from the Google Health API dailyRollUp endpoint.
 * Returns an array of { date, steps } for the last `days` days.
 *
 * NOTE: The Google Health API (Fitbit Web API successor) endpoint for steps
 * is documented at:
 * https://developers.google.com/health/api/reference/rest
 * Adjust the URL below once you confirm the exact endpoint for your project.
 */
async function fetchSteps(
  accessToken: string,
  days = 2
): Promise<DailyRollUpEntry[]> {
  const results: DailyRollUpEntry[] = [];

  for (let i = 1; i <= days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD

    // Google Health API steps endpoint (confirm exact path with the API reference)
    const url = `https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate`;

    const body = {
      aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
      bucketByTime: { durationMillis: 86400000 },
      startTimeMillis: new Date(`${dateStr}T00:00:00Z`).getTime(),
      endTimeMillis: new Date(`${dateStr}T23:59:59Z`).getTime(),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`Failed to fetch steps for ${dateStr}:`, await res.text());
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const bucket = data?.bucket?.[0];
    const stepValue =
      bucket?.dataset?.[0]?.point?.[0]?.value?.[0]?.intVal ?? 0;

    results.push({ date: dateStr, steps: stepValue });
  }

  return results;
}

/**
 * Phase 5 — Daily sync route.
 * POST /api/sync/steps
 *
 * Protected by Authorization: Bearer <CRON_SECRET>
 * Called once daily by Vercel Cron / Supabase scheduled function.
 *
 * For each active user:
 * 1. Decrypt and refresh the access token
 * 2. Fetch last 2 days of steps from Google Health API
 * 3. Upsert into steps_daily
 * 4. Handle invalid_grant by deactivating the token (no retry loop)
 */
export async function POST(request: NextRequest) {
  // ── Auth check ─────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Load all active tokens ─────────────────────────────────────────────────
  const activeTokens = await db
    .select({
      userId: oauthTokens.userId,
      refreshTokenEncrypted: oauthTokens.refreshTokenEncrypted,
      userName: users.name,
      userEmail: users.email,
    })
    .from(oauthTokens)
    .innerJoin(users, eq(oauthTokens.userId, users.id))
    .where(eq(oauthTokens.active, true));

  const results: Array<{
    userId: string;
    email: string;
    status: 'ok' | 'revoked' | 'error';
    stepsUpserted?: number;
    error?: string;
  }> = [];

  // ── Process each user independently ───────────────────────────────────────
  for (const token of activeTokens) {
    try {
      // 1. Decrypt refresh token
      const refreshToken = await decrypt(token.refreshTokenEncrypted);

      // 2. Refresh access token
      const refreshed = await refreshAccessToken(refreshToken);

      if (refreshed === null) {
        // invalid_grant — user revoked access; deactivate
        await db
          .update(oauthTokens)
          .set({ active: false, updatedAt: new Date() })
          .where(eq(oauthTokens.userId, token.userId));

        results.push({
          userId: token.userId,
          email: token.userEmail,
          status: 'revoked',
        });
        continue;
      }

      // 3. Save refreshed access token
      await db
        .update(oauthTokens)
        .set({
          accessToken: refreshed.accessToken,
          accessTokenExpiresAt: refreshed.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(oauthTokens.userId, token.userId));

      // 4. Fetch steps for last 2 days
      const stepEntries = await fetchSteps(refreshed.accessToken, 2);

      // 5. Upsert into steps_daily
      let upsertCount = 0;
      for (const entry of stepEntries) {
        if (entry.steps > 0) {
          await db
            .insert(stepsDaily)
            .values({
              userId: token.userId,
              date: entry.date,
              steps: entry.steps,
              source: 'google_health_api',
              syncedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [stepsDaily.userId, stepsDaily.date],
              set: {
                steps: entry.steps,
                syncedAt: new Date(),
              },
            });
          upsertCount++;
        }
      }

      results.push({
        userId: token.userId,
        email: token.userEmail,
        status: 'ok',
        stepsUpserted: upsertCount,
      });
    } catch (err) {
      // Per-user isolation: log and continue without aborting the batch
      console.error(`Sync failed for user ${token.userEmail}:`, err);
      results.push({
        userId: token.userId,
        email: token.userEmail,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    revoked: results.filter((r) => r.status === 'revoked').length,
    errors: results.filter((r) => r.status === 'error').length,
  };

  console.log('Sync complete:', summary);

  return NextResponse.json({ summary, results });
}
