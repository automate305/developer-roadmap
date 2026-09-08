'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/accounts', label: 'Sending Accounts' },
  { href: '/suppressions', label: 'Blocked' },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-8 px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 -rotate-3 place-items-center rounded-[10px_10px_10px_3px] bg-[linear-gradient(145deg,#ce9cff,#7d31df)] text-[13px] font-black text-[#170822] shadow-[0_0_24px_#9b5cf661]">
            A
          </span>
          <span className="text-sm font-semibold tracking-tight">Automate305 SEP</span>
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-accent-soft text-ink shadow-[inset_3px_0_#a96aff]'
                    : 'text-ink-muted hover:bg-accent-soft hover:text-ink',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
