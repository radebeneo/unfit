import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/sync/shortcut/test?token=<shortcutToken>
 *
 * Lightweight endpoint for the /welcome page "Test my connection" button.
 * Returns the user's name and email if the token is valid.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Missing token query parameter' },
      { status: 400 }
    );
  }

  const [user] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.shortcutToken, token))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Invalid token' },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    name: user.name ?? user.email.split('@')[0],
    email: user.email,
  });
}
