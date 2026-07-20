import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

/**
 * GET /api/db-check
 * Temporary diagnostic endpoint — DELETE after debugging.
 */
export async function GET() {
  try {
    const result = await db.execute(sql`SELECT 1 AS ok`);
    return NextResponse.json({ connected: true, result });
  } catch (err) {
    const detail: Record<string, unknown> = {};
    if (err && typeof err === 'object') {
      for (const key of Object.getOwnPropertyNames(err)) {
        detail[key] = (err as Record<string, unknown>)[key];
      }
    }
    return NextResponse.json({ connected: false, error: detail }, { status: 500 });
  }
}
