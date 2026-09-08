import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Automate305 SEP',
  description: 'Sales engagement platform — sequences, sending, and reply detection.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink">{children}</body>
    </html>
  );
}
