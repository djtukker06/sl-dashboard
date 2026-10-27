import Link from 'next/link';

// Subnavigatie binnen Bank & boekingen: de lijst, een afschrift importeren en de openstaande
// posten (afletteren). Gewone links, zodat elk scherm een eigen URL heeft.
const ITEMS = [
  { id: 'boekingen', href: '/boekhouding/bank', label: 'Boekingen' },
  { id: 'importeren', href: '/boekhouding/bank/importeren', label: 'Afschrift importeren' },
  { id: 'openstaand', href: '/boekhouding/openstaand', label: 'Openstaand & afletteren' }
] as const;

export function BankSubnav({ actief, teller }: { actief: (typeof ITEMS)[number]['id']; teller?: Partial<Record<(typeof ITEMS)[number]['id'], number>> }) {
  return (
    <nav className="bh-subnav" aria-label="Bank & boekingen">
      {ITEMS.map((i) => (
        <Link key={i.id} href={i.href} className={`bh-subnav-item${actief === i.id ? ' is-aan' : ''}`} aria-current={actief === i.id ? 'page' : undefined}>
          {i.label}
          {teller?.[i.id] ? <span className="bh-subnav-teller">{teller[i.id]}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
