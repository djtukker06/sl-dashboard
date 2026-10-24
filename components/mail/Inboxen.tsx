'use client';

import type { CSSProperties } from 'react';
import type { MailApiFout } from '@/lib/mail/client';
import type { InboxDto, InboxTeller, MailMap } from '@/lib/mail/types';
import { ALLE_INBOXEN } from '@/lib/mail/zichtbaarheid';
import { Icoon } from './Iconen';
import { Mappen } from './Mappen';

// Linkerkolom van Mail: bovenaan "Alle inboxen" (bij meer dan één inbox), daaronder elke
// inbox met kleurstip, naam, adres en het aantal ongelezen. Openklappen toont de eigen
// mappen van die inbox (pas dan opgehaald).
export function Inboxen({
  inboxen,
  tellers,
  totaal,
  mappenPer,
  mappenFout,
  open,
  actiefMb,
  actiefMap,
  onKiesAlle,
  onKies,
  onToggle,
  onOpnieuw
}: {
  inboxen: InboxDto[];
  tellers: Record<string, InboxTeller>;
  totaal: number;
  mappenPer: Record<string, MailMap[]>;
  mappenFout: Record<string, MailApiFout>;
  open: Record<string, boolean>;
  actiefMb: string;
  actiefMap: string;
  onKiesAlle: () => void;
  onKies: (mb: string, pad: string) => void;
  onToggle: (mb: string) => void;
  onOpnieuw: (mb: string) => void;
}) {
  const meerdere = inboxen.length > 1;
  const aantal = (n: number) => (n > 999 ? '999+' : n);

  return (
    <div className="ml-inboxen">
      {meerdere && (
        <button
          type="button"
          className="ml-map ml-alle"
          aria-current={actiefMb === ALLE_INBOXEN ? 'true' : undefined}
          onClick={onKiesAlle}
        >
          <Icoon naam="inbox" grootte={17} />
          <span className="ml-map-naam">Alle inboxen</span>
          {totaal > 0 && (
            <span className="ml-map-aantal ml-map-aantal-sterk">
              {aantal(totaal)}
              <span className="sr-only"> ongelezen</span>
            </span>
          )}
        </button>
      )}

      {inboxen.map((i) => {
        const teller = tellers[i.id];
        const isOpen = !meerdere || Boolean(open[i.id]);
        const actief = actiefMb === i.id;
        const fout = !i.leesbaar
          ? 'Het wachtwoord van deze inbox kan niet meer worden gelezen. Koppel hem opnieuw via Account & mail.'
          : teller?.fout;
        const deel = !i.vanMij ? `gedeeld door ${i.eigenaarNaam}` : i.zichtbaarheid === 'team' ? 'gedeeld met het team' : '';
        return (
          <section
            key={i.id}
            className={`ml-inbox${actief ? ' ml-inbox-actief' : ''}`}
            style={{ '--ml-inbox-kleur': i.kleur } as CSSProperties}
            aria-label={`Inbox ${i.label}`}
          >
            <div className="ml-inbox-kop">
              <button
                type="button"
                className="ml-inbox-knop"
                aria-current={actief && actiefMap.toUpperCase() === 'INBOX' ? 'true' : undefined}
                title={`${i.label} — ${i.email}${deel ? ` (${deel})` : ''}`}
                onClick={() => onKies(i.id, 'INBOX')}
              >
                <span className="ml-inbox-stip" aria-hidden="true" />
                <span className="ml-inbox-tekst">
                  <span className="ml-inbox-label">
                    {i.label}
                    {(i.zichtbaarheid === 'team' || !i.vanMij) && (
                      <Icoon naam="gedeeld" grootte={13} className="ml-icoon ml-inbox-gedeeld" />
                    )}
                  </span>
                  <span className="ml-inbox-adres">
                    {i.email}
                    {deel && <span className="sr-only">, {deel}</span>}
                  </span>
                </span>
                {fout ? (
                  <span className="ml-inbox-fout" title={fout} role="img" aria-label="Niet bereikbaar">
                    !
                  </span>
                ) : (
                  (teller?.ongelezen ?? 0) > 0 && (
                    <span className="ml-map-aantal ml-map-aantal-sterk">
                      {aantal(teller!.ongelezen)}
                      <span className="sr-only"> ongelezen</span>
                    </span>
                  )
                )}
              </button>
              {meerdere && (
                <button
                  type="button"
                  className="ml-inbox-klap"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? `Mappen van ${i.label} verbergen` : `Mappen van ${i.label} tonen`}
                  onClick={() => onToggle(i.id)}
                >
                  <Icoon naam="pijlOmlaag" grootte={14} className={`ml-icoon ml-draai${isOpen ? ' ml-open' : ''}`} />
                </button>
              )}
            </div>
            {isOpen && (
              <div className="ml-inbox-mappen">
                <Mappen
                  label={`Mappen van ${i.label}`}
                  mappen={mappenPer[i.id] ?? null}
                  fout={mappenFout[i.id] ?? null}
                  actief={actief ? actiefMap : null}
                  onKies={(pad) => onKies(i.id, pad)}
                  onOpnieuw={() => onOpnieuw(i.id)}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
