import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, stepsDaily } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/sync/shortcut
 *
 * Called by the iOS Apple Health Shortcut once daily.
 * Authentication: Bearer <shortcutToken>  (the personal token shown on /welcome)
 *
 * Body (JSON):
 *   { "date": "2026-07-15", "steps": 9432 }
 *   - date: optional YYYY-MM-DD, defaults to yesterday (UTC)
 *   - steps: required positive integer ≤ 200,000
 *
 * Returns: { ok: true, date, steps, name }
 */
export async function POST(request: NextRequest) {
  try {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return NextResponse.json(
      { error: 'Missing Authorization header. Expected: Bearer <token>' },
      { status: 401 }
    );
  }

  // Look up user by shortcut token
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.shortcutToken, token))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { error: 'Invalid token. Visit the app to get your personal token.' },
      { status: 401 }
    );
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { date?: string; steps?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Resolve date — default to yesterday UTC
  let date: string;
  if (body.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD.' },
        { status: 400 }
      );
    }
    date = body.date;
  } else {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    date = yesterday.toISOString().split('T')[0];
  }

  // Validate steps
  const steps = typeof body.steps === 'number' ? Math.round(body.steps) : NaN;
  if (isNaN(steps) || steps < 0 || steps > 200_000) {
    return NextResponse.json(
      { error: 'steps must be a number between 0 and 200,000.' },
      { status: 400 }
    );
  }

  // ── Upsert into steps_daily ────────────────────────────────────────────────
  await db
    .insert(stepsDaily)
    .values({
      userId: user.id,
      date,
      steps,
      source: 'apple_health_shortcut',
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [stepsDaily.userId, stepsDaily.date],
      set: {
        steps,
        source: 'apple_health_shortcut',
        syncedAt: new Date(),
      },
    });

  console.log(
    `[shortcut-sync] ${user.email} → ${date}: ${steps} steps (Apple Health)`
  );

  return NextResponse.json({
    ok: true,
    date,
    steps,
    name: user.name ?? user.email.split('@')[0],
  });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Serialize full error including postgres.js-specific fields
    const detail: Record<string, unknown> = { message };
    if (err && typeof err === 'object') {
      for (const key of ['code', 'detail', 'hint', 'severity', 'routine', 'where'] as const) {
        if (key in (err as Record<string, unknown>)) {
          detail[key] = (err as Record<string, unknown>)[key];
        }
      }
    }
    console.error('[shortcut-sync] Unhandled error:', JSON.stringify(detail));
    return NextResponse.json(
      { error: 'Internal server error', detail },
      { status: 500 }
    );
  }
}
