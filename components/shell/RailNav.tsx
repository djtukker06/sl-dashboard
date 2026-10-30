'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { moduleVoorPad } from '@/lib/modules';
import type { RailItem } from '@/lib/shell/rail';

// Alleen de actieve staat hangt af van de URL; daarom is dit het enige client-deel van de rail.
export function RailNav({ items }: { items: RailItem[] }) {
  const actief = moduleVoorPad(usePathname() || '/');
  return (
    <ul className="sl-rail-nav">
      {items.map((it) => {
        const inhoud = (
          <>
            <span dangerouslySetInnerHTML={{ __html: it.icoon }} style={{ display: 'contents' }} />
            <span className="sl-rail-label">{it.label}</span>
          </>
        );
        const huidig = it.id === actief ? 'page' : undefined;
        return (
          <li key={it.id} className={it.mobiel ? undefined : 'sl-rail-neven'}>
            {it.document ? (
              // Social is een los HTML-document: volledige paginalading.
              <a className="sl-rail-item" href={it.href} aria-current={huidig}>
                {inhoud}
              </a>
            ) : (
              <Link className="sl-rail-item" href={it.href} aria-current={huidig}>
                {inhoud}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
