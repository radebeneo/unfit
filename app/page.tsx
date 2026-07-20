import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Steps Challenge — Friend Step Leaderboard',
  description:
    'A cross-platform steps leaderboard for your friend group. Connect via Google Health and see weekly and all-time rankings.',
};

export default function Home() {
  return (
    <main className="home-page">
      <div className="home-inner">
        {/* Hero */}
        <div className="hero-icon">👟</div>
        <h1 className="hero-title">Steps Challenge</h1>
        <p className="hero-sub">
          A private leaderboard that persists your step history across weeks —
          unlike Google Health&apos;s built-in view that resets every Monday.
        </p>

        {/* Feature list */}
        <ul className="feature-list">
          <li>
            <span className="feature-icon">📊</span>
            <div>
              <strong>Weekly &amp; All-Time Rankings</strong>
              <p>See who&apos;s dominating this week and who&apos;s the all-time GOAT.</p>
            </div>
          </li>
          <li>
            <span className="feature-icon">🔐</span>
            <div>
              <strong>Private &amp; Secure</strong>
              <p>OAuth — we only read your step count, nothing else.</p>
            </div>
          </li>
          <li>
            <span className="feature-icon">🤖</span>
            <div>
              <strong>Automatic Daily Sync</strong>
              <p>Android: steps pulled automatically from Google Health. iOS: a one-time Shortcut setup.</p>
            </div>
          </li>
        </ul>

        {/* CTAs */}
        <div className="home-ctas">
          <a
            id="home-connect-btn"
            href="/api/auth/google-health/authorize"
            className="cta-btn"
          >
            Connect Google Health →
          </a>
          <Link id="home-leaderboard-link" href="/leaderboard" className="secondary-btn">
            View Leaderboard
          </Link>
        </div>

        <p className="home-note">
          🤖 Android via Google Health &nbsp;•&nbsp; 🍎 iOS via Apple Health Shortcut
        </p>
      </div>
    </main>
  );
}
