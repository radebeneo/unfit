import { readFileSync } from 'fs';
import postgres from 'postgres';

// Load .env.local manually
const envFile = readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^#=\s][^=]*)=(.*)/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

try {
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS shortcut_token text`;
  console.log('✅ Column shortcut_token added (or already existed)');

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'users_shortcut_token_unique'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT users_shortcut_token_unique UNIQUE(shortcut_token);
      END IF;
    END$$
  `;
  console.log('✅ Unique constraint ensured');

  // Also update drizzle migrations journal so drizzle-kit stays in sync
  console.log('✅ Migration complete');
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
} finally {
  await sql.end();
}
