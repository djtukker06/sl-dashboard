'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Subnavigatie binnen Boekhouding: Overzicht · Facturen · Bonnetjes & inkoopfacturen ·
// Bank & boekingen · Instellingen.
// "Facturen" is actief op alle /facturen/*-paden (de facturenschermen zelf blijven ongewijzigd).
const TABS = [
  { href: '/boekhouding', label: 'Overzicht', actief: (p: string) => p === '/boekhouding' },
  { href: '/facturen', label: 'Facturen', actief: (p: string) => p === '/facturen' || p.startsWith('/facturen/') },
  {
    href: '/boekhouding/bonnetjes',
    label: 'Bonnetjes & inkoopfacturen',
    kort: 'Bonnetjes',
    actief: (p: string) => p.startsWith('/boekhouding/bonnetjes') || p.startsWith('/uitgaven')
  },
  { href: '/boekhouding/bank', label: 'Bank & boekingen', kort: 'Bank', actief: (p: string) => p.startsWith('/boekhouding/bank') },
  { href: '/boekhouding/instellingen', label: 'Instellingen', actief: (p: string) => p.startsWith('/boekhouding/instellingen') }
] as const;

export function BoekhoudingTabs() {
  const pad = usePathname() || '';
  return (
    <nav className="bh-tabs" aria-label="Boekhouding">
      {TABS.map((t) => {
        const aan = t.actief(pad);
        return (
          <Link key={t.href} href={t.href} className={`bh-tab${aan ? ' is-aan' : ''}`} aria-current={aan ? 'page' : undefined}>
            {'kort' in t ? (
              <>
                <span className="bh-tab-lang">{t.label}</span>
                <span className="bh-tab-kort">{t.kort}</span>
              </>
            ) : (
              t.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}
