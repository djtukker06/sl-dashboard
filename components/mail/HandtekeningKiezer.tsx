'use client';

import { useEffect, useRef, useState } from 'react';
import { HANDTEKENINGEN, INBOX_TEKST, type HandtekeningKeuze } from '@/lib/mail/handtekening';
import { Icoon } from './Iconen';

// Keuzemenu voor de handtekening in het opstelscherm (zelfde pop-over als de inboxkiezer,
// maar klapt omhoog open: de knop staat onderaan). Pijltjes, Enter en Esc werken; Esc sluit
// alleen het menu, niet het opstelscherm.
export function HandtekeningKiezer({
  waarde,
  inboxTekst,
  disabled,
  onKies
}: {
  waarde: HandtekeningKeuze;
  /** Naam van de inbox als die een eigen teksthandtekening heeft (anders null). */
  inboxTekst: string | null;
  disabled?: boolean;
  onKies: (keuze: HandtekeningKeuze) => void;
}) {
  const [open, setOpen] = useState(false);
  const knopRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const opties: { id: HandtekeningKeuze; naam: string; sub?: string }[] = [
    ...HANDTEKENINGEN.map((h) => ({ id: h.id, naam: h.naam, sub: h.email })),
    ...(inboxTekst ? [{ id: INBOX_TEKST, naam: 'Tekst van de inbox', sub: inboxTekst }] : []),
    { id: '', naam: 'Geen handtekening' }
  ];
  const huidig = opties.find((o) => o.id === waarde) ?? opties[opties.length - 1];

  // Bij openen: focus op de gekozen optie.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  const sluit = (terug = true) => {
    setOpen(false);
    if (terug) knopRef.current?.focus();
  };

  const kies = (id: HandtekeningKeuze) => {
    onKies(id);
    sluit();
  };

  const toetsen = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      sluit();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const stap = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + stap + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      sluit(false);
    }
  };

  return (
    <div className="ml-hand-kiezer">
      <button
        ref={knopRef}
        type="button"
        className="db-knop ml-hand-knop"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Handtekening: ${huidig.naam}`}
        title="Handtekening"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icoon naam="concepten" grootte={15} />
        <span className="ml-hand-knop-naam">{huidig.naam}</span>
        <Icoon naam="pijlOmlaag" grootte={13} className="ml-icoon ml-hand-pijl" />
      </button>
      {open && (
        <>
          <div className="ml-pop-achter" onClick={() => sluit(false)} aria-hidden="true" />
          <div ref={menuRef} className="ml-pop ml-hand-menu" role="menu" aria-label="Handtekening" onKeyDown={toetsen}>
            <p className="ml-hand-menu-kop">Handtekening</p>
            {opties.map((o) => (
              <button
                key={o.id || 'geen'}
                type="button"
                role="menuitemradio"
                aria-checked={o.id === huidig.id}
                className={`ml-hand-optie${o.id === '' ? ' ml-hand-optie-geen' : ''}`}
                onClick={() => kies(o.id)}
              >
                <span className="ml-hand-optie-tekst">
                  <span className="ml-hand-optie-naam">{o.naam}</span>
                  {o.sub && <span className="ml-hand-optie-sub">{o.sub}</span>}
                </span>
                {o.id === huidig.id && <Icoon naam="vink" grootte={15} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
