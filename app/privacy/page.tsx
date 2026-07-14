import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Steps Challenge',
  description: 'Privacy Policy for the Steps Challenge app.',
};

export default function PrivacyPolicy() {
  return (
    <main className="leaderboard-page">
      <div className="mb-8">
        <Link href="/" className="secondary-btn">← Back Home</Link>
      </div>
      <div className="leaderboard-card">
        <h1 className="section-title text-3xl mb-6">Privacy Policy</h1>
        <div className="space-y-4 text-[var(--text-secondary)] leading-relaxed">
          <p>Last updated: {new Date().toLocaleDateString()}</p>
          
          <h2 className="text-xl font-bold text-[var(--text-primary)] mt-6 mb-2">1. Information We Collect</h2>
          <p>We only collect information necessary to provide the core functionality of the Steps Challenge leaderboard. Specifically, we request read-only access to your step count data via Google Health.</p>
          
          <h2 className="text-xl font-bold text-[var(--text-primary)] mt-6 mb-2">2. How We Use Your Information</h2>
          <p>Your step count data is used solely to generate weekly and all-time leaderboards among your connected friend group. We do not sell or share your health data with any third parties.</p>

          <h2 className="text-xl font-bold text-[var(--text-primary)] mt-6 mb-2">3. Data Storage and Security</h2>
          <p>We securely store your OAuth tokens and daily step counts in our database. We employ industry-standard encryption to ensure your data remains safe.</p>

          <h2 className="text-xl font-bold text-[var(--text-primary)] mt-6 mb-2">4. Your Rights</h2>
          <p>You can revoke access to your health data at any time from your Google Account settings. You may also contact us to request the deletion of your account and all associated data.</p>
        </div>
      </div>
    </main>
  );
}
