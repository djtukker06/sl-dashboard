'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { moduleVoorPad } from '@/lib/modules';
import type { RailItem } from '@/lib/shell/rail';

/** Sluit het accountmenu ("Meer" op de telefoon). */
function sluitMenu() {
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details.sl-account[open]')) d.open = false;
}

// De modules die op de telefoon niet in de tabbalk staan, bovenin het accountmenu ("Meer").
// Standaard [hidden]: alleen de mobiele stijl (public/shell/shell.css, ≤720px) toont ze; op grotere schermen
// staan ze gewoon in de rail. Gelijk aan het neven-blok in railHtml() (lib/shell/rail.ts).
export function RailMeer({ items }: { items: RailItem[] }) {
  const pad = usePathname() || '/';
  const actief = moduleVoorPad(pad);
  // Na een navigatie (ook vanuit het accountmenu zelf) het menu dichtdoen.
  useEffect(() => {
    sluitMenu();
  }, [pad]);
  if (!items.length) return null;
  return (
    <ul className="sl-account-modules" hidden>
      {items.map((it) => {
        const inhoud = (
          <>
            <span dangerouslySetInnerHTML={{ __html: it.icoon }} style={{ display: 'contents' }} />
            <span>{it.label}</span>
          </>
        );
        const huidig = it.id === actief ? 'page' : undefined;
        return (
          <li key={it.id}>
            {it.document ? (
              <a className="sl-account-module" href={it.href} aria-current={huidig}>
                {inhoud}
              </a>
            ) : (
              <Link className="sl-account-module" href={it.href} aria-current={huidig} onClick={sluitMenu}>
                {inhoud}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
