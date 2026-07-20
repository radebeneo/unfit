import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Returns a lazily-initialized Drizzle client.
 * Throws a clear error at call-time (not module-load-time) if DATABASE_URL is missing,
 * so the build can succeed without the env var present.
 */
export function getDb() {
  if (_db) return _db;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL environment variable is not set. ' +
        'Copy .env.example to .env.local and add your Supabase connection string.'
    );
  }

  // Disable prefetch — not supported in Supabase Transaction pool mode
  // SSL is required by Supabase in production (pooler rejects unencrypted connections)
  const client = postgres(process.env.DATABASE_URL, {
    prepare: false,
    ssl: process.env.NODE_ENV === 'production' ? 'require' : undefined,
    connect_timeout: 15,
    idle_timeout: 20,
    max_lifetime: 1800,
  });
  _db = drizzle(client, { schema });
  return _db;
}

/** Convenience alias — call getDb() anywhere a drizzle instance is needed. */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
