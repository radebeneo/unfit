import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Steps Challenge',
  description: 'Terms of Service for the Steps Challenge app.',
};

export default function TermsOfService() {
  return (
    <main className="leaderboard-page">
      <div className="mb-8">
        <Link href="/" className="secondary-btn">← Back Home</Link>
      </div>
      <div className="leaderboard-card">
        <h1 className="section-title text-3xl mb-6">Terms of Service</h1>
        <div className="space-y-4 text-[var(--text-secondary)] leading-relaxed">
          <p>Last updated: {new Date().toLocaleDateString()}</p>
          
          <h2 className="text-xl font-bold text-[var(--text-primary)] mt-6 mb-2">1. Acceptance of Terms</h2>
          <p>By accessing and using the Steps Challenge app, you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, please do not use the service.</p>

          <h2 className="text-xl font-bold text-[var(--text-primary)] mt-6 mb-2">2. Service Description</h2>
          <p>Steps Challenge provides a platform to view and compare daily step counts with your friends. The service integrates with Google Health to automatically sync your step data.</p>

          <h2 className="text-xl font-bold text-[var(--text-primary)] mt-6 mb-2">3. User Responsibilities</h2>
          <p>You are responsible for maintaining the confidentiality of your account credentials. You agree to use the service only for lawful purposes and in accordance with these terms.</p>

          <h2 className="text-xl font-bold text-[var(--text-primary)] mt-6 mb-2">4. Disclaimer of Warranties</h2>
          <p>The service is provided &quot;as is&quot; without any warranties, express or implied. We do not guarantee the accuracy, completeness, or reliability of the step data presented.</p>

          <h2 className="text-xl font-bold text-[var(--text-primary)] mt-6 mb-2">5. Limitation of Liability</h2>
          <p>In no event shall Steps Challenge or its operators be liable for any indirect, incidental, special, or consequential damages arising out of or in connection with your use of the service.</p>
        </div>
      </div>
    </main>
  );
}
