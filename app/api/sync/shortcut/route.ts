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

  // Parse steps — iOS Shortcuts can send health data in many formats:
  //   • a plain number:          8432
  //   • a numeric string:        "8432"
  //   • a HealthKit sample obj:  { value: 8432 } / { count: 8432 } / { quantity: 8432 }
  //   • an array of samples:     [{ value: 100 }, { value: 200 }, ...]  → summed
  function extractSteps(raw: unknown): number {
    if (typeof raw === 'number') return Math.round(raw);
    if (typeof raw === 'string') {
      // iOS Shortcuts serializes a Health Sample list as newline-separated numbers
      if (raw.includes('\n')) {
        const total = raw
          .split('\n')
          .map((s) => Number(s.trim()))
          .filter((n) => !isNaN(n))
          .reduce((sum, n) => sum + n, 0);
        return Math.round(total);
      }
      const n = Number(raw.trim());
      return isNaN(n) ? NaN : Math.round(n);
    }
    if (Array.isArray(raw)) {
      // Sum numeric values from each sample
      const total = raw.reduce((sum, item) => {
        const v = extractSteps(item);
        return isNaN(v) ? sum : sum + v;
      }, 0);
      return total;
    }
    if (raw && typeof raw === 'object') {
      // Try common HealthKit property names
      const obj = raw as Record<string, unknown>;
      for (const key of ['value', 'count', 'quantity', 'sum', 'steps']) {
        if (typeof obj[key] === 'number') return Math.round(obj[key] as number);
        if (typeof obj[key] === 'string') {
          const n = Number((obj[key] as string).trim());
          if (!isNaN(n)) return Math.round(n);
        }
      }
    }
    return NaN;
  }

  const steps = extractSteps(body.steps);
  if (isNaN(steps) || steps < 0 || steps > 200_000) {
    return NextResponse.json(
      {
        error: 'steps must be a number between 0 and 200,000.',
        received: JSON.stringify(body.steps).slice(0, 200),
      },
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
    console.error('[shortcut-sync] Unhandled error:', message);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
