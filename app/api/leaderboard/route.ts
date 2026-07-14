import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { stepsDaily, users } from '@/db/schema';
import { sql, eq, and, gte } from 'drizzle-orm';

/**
 * Returns the ISO Monday date for a given date.
 */
function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

/**
 * Phase 6 — Leaderboard API.
 * GET /api/leaderboard?range=week   →  current ISO week total steps
 * GET /api/leaderboard?range=all    →  all-time total steps
 *
 * Returns an array of { rank, userId, name, email, totalSteps }
 * ordered by totalSteps descending.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') ?? 'week';

  let rows;

  if (range === 'week') {
    const weekStart = getWeekStart(new Date());

    rows = await db
      .select({
        userId: stepsDaily.userId,
        name: users.name,
        email: users.email,
        totalSteps: sql<number>`CAST(SUM(${stepsDaily.steps}) AS INTEGER)`,
      })
      .from(stepsDaily)
      .innerJoin(users, eq(stepsDaily.userId, users.id))
      .where(gte(stepsDaily.date, weekStart))
      .groupBy(stepsDaily.userId, users.name, users.email)
      .orderBy(sql`SUM(${stepsDaily.steps}) DESC`);
  } else if (range === 'all') {
    rows = await db
      .select({
        userId: stepsDaily.userId,
        name: users.name,
        email: users.email,
        totalSteps: sql<number>`CAST(SUM(${stepsDaily.steps}) AS INTEGER)`,
      })
      .from(stepsDaily)
      .innerJoin(users, eq(stepsDaily.userId, users.id))
      .groupBy(stepsDaily.userId, users.name, users.email)
      .orderBy(sql`SUM(${stepsDaily.steps}) DESC`);
  } else {
    return NextResponse.json(
      { error: 'Invalid range. Use "week" or "all".' },
      { status: 400 }
    );
  }

  const leaderboard = rows.map((row, index) => ({
    rank: index + 1,
    userId: row.userId,
    name: row.name ?? row.email.split('@')[0],
    email: row.email,
    totalSteps: row.totalSteps,
  }));

  return NextResponse.json({ range, leaderboard });
}
