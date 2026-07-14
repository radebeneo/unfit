import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  date,
  primaryKey,
  boolean,
} from 'drizzle-orm/pg-core';

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── OAuth Tokens ─────────────────────────────────────────────────────────────

export const oauthTokens = pgTable('oauth_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  accessToken: text('access_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  scope: text('scope').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Daily Steps ──────────────────────────────────────────────────────────────

export const stepsDaily = pgTable(
  'steps_daily',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    steps: integer('steps').notNull(),
    source: text('source').notNull().default('google_health_api'),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.date] }),
  })
);

// ─── Type exports ─────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type NewOAuthToken = typeof oauthTokens.$inferInsert;
export type StepsDaily = typeof stepsDaily.$inferSelect;
export type NewStepsDaily = typeof stepsDaily.$inferInsert;
