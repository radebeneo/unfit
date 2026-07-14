# Steps leaderboard — MVP build plan

Agent-executable setup plan for a cross-platform (iOS + Android) friend steps leaderboard that persists history across weeks, unlike Google Health's built-in leaderboard which resets weekly.

## 1. Context

Friends currently see each other's steps inside the Google Health app (rebranded Fitbit, cross-platform since May 2026), but that leaderboard resets every week and shows no history. This project pulls the same underlying data via the **Google Health API** (OAuth, server-to-server) into our own database, so we can show weekly *and* all-time leaderboards.

## 2. Goals / non-goals

**In scope for MVP:**
- OAuth consent flow so a friend can grant read access to their steps
- Daily backend sync job pulling steps via the Google Health API
- Append-only step history in our own database
- Two leaderboard views: current week, all-time
- Minimal web UI to view the leaderboard and share the consent link
- Production-published OAuth app (not limited to a Google Cloud test-user allowlist)

**Explicitly out of scope for MVP:**
- Replicating Google Health's friend-request system — every participant just completes the same OAuth link directly with this app
- Any data type other than steps (heart rate, sleep, etc.)
- Native mobile apps — this is a pure backend + web frontend

## 3. Stack

Next.js 14 (App Router), Supabase (Postgres), Drizzle ORM, Tailwind. Matches the existing project conventions.

## 4. Task legend

- 🧑 **Human checkpoint** — requires a person in a browser (Google Cloud Console, verification submission, DNS, etc.). The agent cannot complete these; it should stop, clearly state what's needed, and wait for the human to confirm before continuing.
- 🤖 **Agent task** — code, schema, or config the agent writes directly.

---

## Phase 0 — Prerequisites 🧑

Before any agent work starts, confirm the human has:
- [ ] A Google Cloud account with billing-free project creation available
- [ ] Access to the Supabase project (connection string ready)
- [ ] A production HTTPS domain for OAuth callbacks (required for Production publishing — `localhost` and non-HTTPS URIs aren't accepted)
- [ ] A published privacy policy and terms of service page (required for OAuth verification)

## Phase 1 — Google Cloud + OAuth setup, production 🧑 (agent verifies, doesn't perform)

The agent cannot click through Google Cloud Console. Its job here is to produce the exact checklist below for the human to execute, then verify the resulting env vars are present before moving to Phase 2.

1. Create/select a Google Cloud project.
2. Enable the **Google Health API**.
3. Configure the OAuth consent screen:
   - App name, support email, app logo, real privacy policy URL, real terms of service URL
   - User type: External
   - Publishing status: **Production**
4. Create an OAuth 2.0 Client ID:
   - Application type: **Web application**
   - Authorized redirect URI: `https://<your-production-domain>/api/auth/google-health/callback`
5. Under **Data Access**, add the scope: `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
6. Submit the app for **Google OAuth verification**. This scope is classified Restricted, so moving to Production requires Google's review before it's usable by anyone outside your own test account:
   - Expect Google to ask for a demo video walking through the consent screen and how the scope is used
   - Restricted scopes typically also require a third-party security assessment (e.g. a CASA Tier 2 assessment) before verification completes
   - Budget realistic time for this — it is commonly days to several weeks, not hours
   - **Decision point for the human:** for a small closed friend group, staying in Testing mode (100 allowlisted users, no review) may be entirely sufficient and avoids this process altogether. Confirm this trade-off is intentional before starting the verification submission.
7. Download the client secret; store it in a secrets manager or platform env store — never commit it, and don't rely on a local `.env` file alone once this is live in production.

**Agent verification step:** confirm `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET`, and `GOOGLE_HEALTH_REDIRECT_URI` are set in the production environment before proceeding to Phase 2.

## Phase 2 — Database schema 🤖

Using Drizzle ORM (`drizzle-orm/pg-core`):

```typescript
// db/schema.ts
import { pgTable, uuid, text, timestamp, integer, date, primaryKey } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const oauthTokens = pgTable('oauth_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  accessToken: text('access_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  scope: text('scope').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const stepsDaily = pgTable('steps_daily', {
  userId: uuid('user_id').notNull().references(() => users.id),
  date: date('date').notNull(),
  steps: integer('steps').notNull(),
  source: text('source').notNull().default('google_health_api'),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.date] }),
}));
```

Migration commands: `npx drizzle-kit generate` to produce SQL migration files, then `npx drizzle-kit migrate` to apply them against the Supabase connection (set via `DATABASE_URL` and `drizzle.config.ts`).

**Acceptance criteria:** `npx drizzle-kit generate && npx drizzle-kit migrate` runs clean; tables visible in Supabase.

## Phase 3 — OAuth consent flow 🤖

Two routes:

- `GET /api/auth/google-health/authorize`
  Builds the Google OAuth URL with `client_id`, `redirect_uri`, `response_type=code`, `access_type=offline`, and the steps scope, then redirects. Do **not** add `include_granted_scopes=true` — if a user previously consented to legacy Google Fit `fitness.*` scopes under the same client, mixing them with the new `googlehealth.*` scopes has been reported to cause 403 errors on data reads (identity/profile calls still succeed, which makes this confusing to debug). Only include `prompt=consent` when you specifically need a fresh refresh token.

- `GET /api/auth/google-health/callback`
  Exchanges the returned `code` for tokens at `https://oauth2.googleapis.com/token`, encrypts the refresh token (Phase 4), and upserts a row in `users` and `oauthTokens` via Drizzle.

**Acceptance criteria:** visiting `/api/auth/google-health/authorize` as a consenting user completes the flow and lands back on the app with rows created in `users` and `oauthTokens`.

## Phase 4 — Token encryption 🤖

Store refresh tokens encrypted, never in plaintext. Use `TOKEN_ENCRYPTION_KEY` (32-byte key, generated once via `openssl rand -hex 32`, stored in the secrets manager) with AES-256-GCM for encrypt/decrypt helpers used by the callback route and the sync job.

**Acceptance criteria:** `refreshTokenEncrypted` in the database is ciphertext, not a raw token string.

## Phase 5 — Sync job 🤖

- `POST /api/sync/steps`, protected by a `CRON_SECRET` header check (called by a Supabase scheduled function or Vercel Cron, once daily).
- For each user with a token:
  1. Refresh the access token via the stored refresh token.
  2. Call the Google Health API steps `dailyRollUp` method for the last 2 days (covers late-syncing data, not just yesterday).
  3. Upsert each `(userId, date)` result into `stepsDaily` via Drizzle's `onConflictDoUpdate`.
  4. Log failures per-user without aborting the whole batch — one bad or revoked token shouldn't block everyone else's sync. Treat `invalid_grant` on refresh as a signal the user revoked access; mark their token inactive rather than retrying indefinitely.

**Acceptance criteria:** running the route manually against a connected user produces a new row in `stepsDaily` with a plausible step count.

## Phase 6 — Leaderboard API + UI 🤖

- `GET /api/leaderboard?range=week` — current week, `SUM(steps)` grouped by user, ordered descending.
- `GET /api/leaderboard?range=all` — all-time equivalent.
- Simple page rendering both as ranked lists, plus a "copy invite link" button that shares the `/api/auth/google-health/authorize` URL.

**Acceptance criteria:** both endpoints return correct sums verified against manually-summed `stepsDaily` rows for a test user.

## Phase 7 — Testing checklist 🧑🤖

- [ ] 🧑 Have one Android friend (Health Connect) and one iOS friend (Apple Health) complete the OAuth flow.
- [ ] 🤖 Sync job pulls steps for both within 24 hours.
- [ ] 🧑 **Critical unresolved question:** confirm the iOS friend's Apple-Health-sourced steps actually appear via the API. The Google Health API is documented primarily as the Fitbit Web API's successor (Fitbit/Pixel Watch/paired-device data via a "Reconciled Stream"). Whether pure Apple Health data with no Fitbit hardware involved flows through that same stream isn't explicitly confirmed in the docs. If the iOS test user's steps come back empty or zero, the fallback is a lightweight native reader (HealthKit) syncing directly to `/api/sync/steps` instead of relying on the Google Health API for iOS.
- [ ] 🤖 Weekly and all-time leaderboard numbers match manual spot-checks.
- [ ] 🧑 Confirm production OAuth verification has been submitted (or explicitly deferred in favor of Testing mode, per Phase 1's decision point) before inviting anyone outside the founding test group.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `GOOGLE_HEALTH_CLIENT_ID` | OAuth client ID from Google Cloud |
| `GOOGLE_HEALTH_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_HEALTH_REDIRECT_URI` | Must match Google Cloud console exactly, HTTPS in production |
| `TOKEN_ENCRYPTION_KEY` | 32-byte key for refresh token encryption |
| `CRON_SECRET` | Shared secret protecting the sync route |
| `DATABASE_URL` | Supabase Postgres connection string (used by Drizzle) |

## Known risks

1. **iOS data coverage unconfirmed** — see Phase 7. Budget time for the HealthKit fallback if needed.
2. **OAuth verification timeline** — Restricted-scope Production verification (plus a possible CASA security assessment) can take days to several weeks and isn't fully in your control. If launch timing matters, plan around this or deliberately stay in Testing mode for a closed friend group.
3. **Revoked or expired tokens** — in Production, refresh tokens generally don't expire unless revoked or unused for ~6 months, but the sync job still needs to handle `invalid_grant` gracefully (mark the user's connection inactive and prompt them to reconnect) rather than failing the whole batch.
4. **Restricted scope handling** — all Google Health API scopes are Restricted, meaning Google can request re-review if your usage or privacy policy materially changes after verification. Keep the privacy policy accurate to what the app actually does.

## Definition of done

- A single shareable link takes a friend through Google OAuth consent and creates their account.
- Their steps appear in `steps_daily` within 24 hours of connecting.
- `/api/leaderboard?range=week` and `?range=all` both return accurate, verified totals.
- At least one Android and one iOS friend verified end-to-end.
- OAuth app is either verified for Production, or the decision to stay in Testing mode is explicit and documented.
