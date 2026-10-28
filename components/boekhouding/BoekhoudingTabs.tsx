'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTeam } from '@/components/team/TeamProvider';

// Subnavigatie binnen Boekhouding: Overzicht · Facturen · Bonnetjes & inkoopfacturen ·
// Bank & boekingen · Btw-aangifte · Activa · Rapporten & jaarrekening · Instellingen.
// "Facturen" is actief op alle /facturen/*-paden (de facturenschermen zelf blijven ongewijzigd).
// Zonder vinkje Boekhouding alleen de eerste drie (beperkt: true).
const TABS = [
  { href: '/boekhouding', label: 'Overzicht', beperkt: true, actief: (p: string) => p === '/boekhouding' },
  { href: '/facturen', label: 'Facturen', beperkt: true, actief: (p: string) => p === '/facturen' || p.startsWith('/facturen/') },
  {
    href: '/boekhouding/bonnetjes',
    label: 'Bonnetjes & inkoopfacturen',
    kort: 'Bonnetjes',
    beperkt: true,
    actief: (p: string) => p.startsWith('/boekhouding/bonnetjes') || p.startsWith('/uitgaven')
  },
  {
    href: '/boekhouding/bank',
    label: 'Bank & boekingen',
    kort: 'Bank',
    actief: (p: string) => p.startsWith('/boekhouding/bank') || p.startsWith('/boekhouding/openstaand')
  },
  { href: '/boekhouding/btw', label: 'Btw-aangifte', kort: 'Btw', actief: (p: string) => p.startsWith('/boekhouding/btw') },
  { href: '/boekhouding/activa', label: 'Activa', actief: (p: string) => p.startsWith('/boekhouding/activa') },
  { href: '/boekhouding/rapporten', label: 'Rapporten & jaarrekening', kort: 'Rapporten', actief: (p: string) => p.startsWith('/boekhouding/rapporten') },
  { href: '/boekhouding/instellingen', label: 'Instellingen', actief: (p: string) => p.startsWith('/boekhouding/instellingen') }
] as const;

export function BoekhoudingTabs() {
  const pad = usePathname() || '';
  const { boekhouding } = useTeam();
  return (
    <nav className="bh-tabs" aria-label="Boekhouding">
      {TABS.filter((t) => boekhouding || ('beperkt' in t && t.beperkt)).map((t) => {
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
