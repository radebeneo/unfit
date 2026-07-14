import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Leaderboard | Steps Challenge',
  description: 'Weekly and all-time steps leaderboard for your friend group.',
};

interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  email: string;
  totalSteps: number;
}

interface LeaderboardResponse {
  range: string;
  leaderboard: LeaderboardEntry[];
}

async function getLeaderboard(range: 'week' | 'all'): Promise<LeaderboardEntry[]> {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000');

    const res = await fetch(`${baseUrl}/api/leaderboard?range=${range}`, {
      next: { revalidate: 300 }, // Revalidate every 5 minutes
    });

    if (!res.ok) return [];
    const data: LeaderboardResponse = await res.json();
    return data.leaderboard;
  } catch {
    return [];
  }
}

function formatSteps(steps: number): string {
  if (steps >= 1_000_000) return `${(steps / 1_000_000).toFixed(1)}M`;
  if (steps >= 1_000) return `${(steps / 1_000).toFixed(1)}K`;
  return steps.toLocaleString();
}

function getRankStyle(rank: number) {
  if (rank === 1) return { emoji: '🥇', color: '#FFD700' };
  if (rank === 2) return { emoji: '🥈', color: '#C0C0C0' };
  if (rank === 3) return { emoji: '🥉', color: '#CD7F32' };
  return { emoji: `#${rank}`, color: '#6B7280' };
}

function LeaderboardTable({ entries, title }: { entries: LeaderboardEntry[]; title: string }) {
  return (
    <div className="leaderboard-card">
      <h2 className="section-title">{title}</h2>
      {entries.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🚶</span>
          <p>No data yet. Be the first to connect!</p>
        </div>
      ) : (
        <ol className="entry-list">
          {entries.map((entry) => {
            const { emoji, color } = getRankStyle(entry.rank);
            return (
              <li key={entry.userId} className="entry-row">
                <span className="rank" style={{ color }}>
                  {emoji}
                </span>
                <span className="name">
                  {entry.name}
                </span>
                <span className="steps">
                  {formatSteps(entry.totalSteps)}
                  <small className="steps-label"> steps</small>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default async function LeaderboardPage() {
  const [weekData, allTimeData] = await Promise.all([
    getLeaderboard('week'),
    getLeaderboard('all'),
  ]);

  const authorizeUrl = '/api/auth/google-health/authorize';

  return (
    <main className="leaderboard-page">
      {/* Header */}
      <header className="page-header">
        <div className="header-inner">
          <div className="header-icon">👟</div>
          <h1 className="page-title">Steps Leaderboard</h1>
          <p className="page-subtitle">
            Who&apos;s walking the most? Track weekly &amp; all-time totals across the crew.
          </p>
        </div>
      </header>

      {/* Boards */}
      <section className="boards-grid">
        <LeaderboardTable title="🗓️ This Week" entries={weekData} />
        <LeaderboardTable title="🏆 All Time" entries={allTimeData} />
      </section>

      {/* CTA */}
      <section className="cta-section">
        <p className="cta-text">Want to join the leaderboard?</p>
        <a
          id="connect-google-health-btn"
          href={authorizeUrl}
          className="cta-btn"
        >
          Connect Google Health
        </a>
        <button
          id="copy-invite-link-btn"
          className="copy-btn"
          onClick={undefined}
          data-href={authorizeUrl}
        >
          📋 Copy invite link
        </button>
      </section>

      {/* Client-side copy script */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.getElementById('copy-invite-link-btn').addEventListener('click', function() {
              var href = this.getAttribute('data-href');
              var url = window.location.origin + href;
              navigator.clipboard.writeText(url).then(function() {
                var btn = document.getElementById('copy-invite-link-btn');
                btn.textContent = '✅ Link copied!';
                setTimeout(function() { btn.textContent = '📋 Copy invite link'; }, 2000);
              });
            });
          `,
        }}
      />
    </main>
  );
}
