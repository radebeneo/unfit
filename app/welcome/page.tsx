import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession, SESSION_COOKIE } from '@/lib/session';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const metadata: Metadata = {
  title: 'Welcome | Steps Challenge',
  description: 'You\'re connected! Set up Apple Health sync for iOS.',
};

export default async function WelcomePage() {
  // ── Read session ───────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE);

  if (!sessionCookie?.value) {
    redirect('/');
  }

  const session = await verifySession(sessionCookie.value);
  if (!session) {
    redirect('/');
  }

  // ── Fetch shortcut token from DB ───────────────────────────────────────────
  const [user] = await db
    .select({ name: users.name, email: users.email, shortcutToken: users.shortcutToken })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) {
    redirect('/');
  }

  const displayName = user.name ?? user.email.split('@')[0];
  const token = user.shortcutToken ?? '';

  // Derive the base URL from the incoming request so this always points
  // to the correct host in both local dev and production.
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host') ?? 'localhost:3000';
  const proto = headersList.get('x-forwarded-proto') ?? 'http';
  const appUrl = `${proto}://${host}`;

  const syncEndpoint = `${appUrl}/api/sync/shortcut`;

  return (
    <main className="welcome-page">
      {/* ── Header ── */}
      <header className="welcome-header">
        <div className="welcome-header-inner">
          <div className="welcome-check">✅</div>
          <h1 className="welcome-title">You&apos;re in, {displayName}!</h1>
          <p className="welcome-subtitle">
            Your account is set up. Android users are synced automatically — if you&apos;re
            on <strong>iOS</strong>, follow the steps below to connect Apple Health.
          </p>
        </div>
      </header>

      <div className="welcome-body">
        {/* ── Quick nav ── */}
        <div className="welcome-nav">
          <Link href="/leaderboard" className="cta-btn" id="welcome-leaderboard-btn">
            View Leaderboard →
          </Link>
          <p className="welcome-nav-note">
            iOS user? Keep reading ↓
          </p>
        </div>

        {/* ── Divider ── */}
        <div className="welcome-divider">
          <span>iOS Apple Health Setup</span>
        </div>

        {/* ── Step 1 — Personal token ── */}
        <section className="setup-section" id="setup-token">
          <div className="setup-step-badge">1</div>
          <h2 className="setup-step-title">Copy your personal token</h2>
          <p className="setup-step-desc">
            This token identifies you when the Shortcut sends your steps. Keep it private —
            anyone with this token can post steps to your account.
          </p>

          <div className="token-card">
            <code className="token-value" id="shortcut-token-value">{token}</code>
            <button
              id="copy-token-btn"
              className="copy-token-btn"
              data-token={token}
            >
              📋 Copy token
            </button>
          </div>
        </section>

        {/* ── Step 2 — Create the Shortcut ── */}
        <section className="setup-section" id="setup-shortcut">
          <div className="setup-step-badge">2</div>
          <h2 className="setup-step-title">Create the iOS Shortcut</h2>
          <p className="setup-step-desc">
            On your iPhone, open the <strong>Shortcuts</strong> app and create a new
            Shortcut with these actions in order:
          </p>

          <ol className="shortcut-steps">
            <li>
              <span className="shortcut-step-num">①</span>
              <div>
                <strong>Find Health Samples</strong>
                <span className="tag">Health</span>
                <p>Type: <code>Steps</code> · Period: <code>Yesterday</code> · Aggregate: <code>Sum</code></p>
              </div>
            </li>
            <li>
              <span className="shortcut-step-num">②</span>
              <div>
                <strong>Format Date</strong>
                <span className="tag">Date</span>
                <p>Date: <code>Current Date</code> · Format: <code>Custom</code> → <code>yyyy-MM-dd</code> · Offset: <strong>-1 day</strong></p>
              </div>
            </li>
            <li>
              <span className="shortcut-step-num">③</span>
              <div>
                <strong>Get Contents of URL</strong>
                <span className="tag">Web</span>
                <p>
                  URL: <code className="url-code">{syncEndpoint}</code><br />
                  Method: <code>POST</code><br />
                  Headers: <code>Authorization</code> → <code>Bearer {token}</code>, <code>Content-Type</code> → <code>application/json</code><br />
                  Body (JSON): <code>{`{"date":"[formatted date]","steps":[health sample]}`}</code>
                </p>
              </div>
            </li>
            <li>
              <span className="shortcut-step-num">④</span>
              <div>
                <strong>Automate it</strong>
                <span className="tag">Automation</span>
                <p>Shortcuts → Automations → + → Time of Day → choose a daily time (e.g. 8 AM) → Run Immediately → select this Shortcut</p>
              </div>
            </li>
          </ol>
        </section>

        {/* ── Step 3 — Test ── */}
        <section className="setup-section" id="setup-test">
          <div className="setup-step-badge">3</div>
          <h2 className="setup-step-title">Test your connection</h2>
          <p className="setup-step-desc">
            Run the Shortcut once manually, then click below to confirm your steps arrived.
          </p>

          <div className="test-row">
            <button
              id="test-connection-btn"
              className="test-btn"
              data-token={token}
              data-url={`${appUrl}/api/sync/shortcut/test`}
            >
              🔍 Test connection
            </button>
            <span id="test-result" className="test-result" aria-live="polite"></span>
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <div className="welcome-footer-cta">
          <Link href="/leaderboard" className="cta-btn" id="welcome-leaderboard-btn-bottom">
            Go to Leaderboard →
          </Link>
        </div>
      </div>

      {/* ── Client scripts ── */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            // Copy token
            document.getElementById('copy-token-btn').addEventListener('click', function() {
              var t = this.getAttribute('data-token');
              navigator.clipboard.writeText(t).then(function() {
                var btn = document.getElementById('copy-token-btn');
                btn.textContent = '✅ Copied!';
                setTimeout(function() { btn.textContent = '📋 Copy token'; }, 2000);
              });
            });

            // Test connection
            document.getElementById('test-connection-btn').addEventListener('click', function() {
              var btn = this;
              var result = document.getElementById('test-result');
              var token = btn.getAttribute('data-token');
              var url = btn.getAttribute('data-url') + '?token=' + encodeURIComponent(token);
              btn.disabled = true;
              btn.textContent = '⏳ Testing…';
              result.textContent = '';
              result.className = 'test-result';
              fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(d) {
                  if (d.ok) {
                    result.textContent = '✅ Connected as ' + (d.name || d.email);
                    result.className = 'test-result test-ok';
                  } else {
                    result.textContent = '❌ ' + (d.error || 'Token not recognised');
                    result.className = 'test-result test-err';
                  }
                })
                .catch(function() {
                  result.textContent = '❌ Network error — check your connection';
                  result.className = 'test-result test-err';
                })
                .finally(function() {
                  btn.disabled = false;
                  btn.textContent = '🔍 Test connection';
                });
            });
          `,
        }}
      />
    </main>
  );
}
