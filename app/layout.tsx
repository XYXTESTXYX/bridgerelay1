import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Public_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
});

const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'BridgeRelay — RSS-Bridge to Mastodon & Threads Pipeline',
  description:
    'End-to-end syndication pipeline for ingesting RSS-Bridge feeds, deduplicating state, applying regex and template formatting rules, and publishing to Mastodon and Meta Threads.',
  openGraph: {
    title: 'BridgeRelay — RSS-Bridge to Mastodon & Threads Pipeline',
    description:
      'End-to-end syndication pipeline for ingesting RSS-Bridge feeds, deduplicating state, applying regex and template formatting rules, and publishing to Mastodon and Meta Threads.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BridgeRelay — RSS-Bridge to Mastodon & Threads Pipeline',
    description:
      'End-to-end syndication pipeline for ingesting RSS-Bridge feeds, deduplicating state, applying regex and template formatting rules, and publishing to Mastodon and Meta Threads.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${publicSans.variable} ${jetbrainsMono.variable}`}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen bg-[#F8FAFC] text-[#0F172A] antialiased selection:bg-[#0F172A] selection:text-white"
        style={{ fontFamily: 'var(--font-sans), sans-serif' }}
      >
        {children}
      </body>
    </html>
  );
}
