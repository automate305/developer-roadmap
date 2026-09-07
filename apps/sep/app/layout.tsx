import type { Metadata } from 'next';
import './globals.css';
import { AppNav } from '@/components/app-nav';

export const metadata: Metadata = {
  title: 'Automate305 SEP',
  description: 'Sales engagement platform — sequences, sending, and reply detection.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink">
        <AppNav />
        <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
