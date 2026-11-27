import Link from 'next/link';

// Subnavigatie van Social: Overzicht · Analytics · Koppelingen (band onder de modulekop,
// zelfde tabs als bonnetjes: ug-tabs in uitgaven.css).
const TABS = [
  { sleutel: 'overzicht', label: 'Overzicht', href: '/social' },
  { sleutel: 'analytics', label: 'Analytics', href: '/social/analytics' },
  { sleutel: 'koppelingen', label: 'Koppelingen', href: '/social/koppelingen' }
] as const;

export type SocialTab = (typeof TABS)[number]['sleutel'];

export function SocialNav({ actief }: { actief: SocialTab | null }) {
  return (
    <nav className="ug-tabs so-tabs" aria-label="Social">
      {TABS.map((t) => (
        <Link key={t.sleutel} href={t.href} className={`ug-tab${actief === t.sleutel ? ' is-aan' : ''}`} aria-current={actief === t.sleutel ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
