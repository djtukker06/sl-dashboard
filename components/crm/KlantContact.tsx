'use client';

import type { Klant, KlantInvoer } from '@/lib/crm/types';
import { InlineTitel, InlineVeld } from './InlineVeld';
import { useKlantWijzigen } from './KlantActies';

/** Contactgegevens, elk veld direct bewerkbaar (potlood of "+ … toevoegen"). */
export function KlantContact({ klant }: { klant: Klant }) {
  const wijzig = useKlantWijzigen();
  const bewaar = (body: KlantInvoer) => wijzig(klant.id, body, 'Opgeslagen');

  return (
    <dl className="kp-dl">
      <div>
        <dt>Contactpersoon</dt>
        <dd>
          <InlineVeld label="Contactpersoon" waarde={klant.contactpersoon} leeg="+ Contactpersoon" onBewaar={(v) => bewaar({ contactpersoon: v })} />
        </dd>
      </div>
      <div>
        <dt>E-mail</dt>
        <dd>
          <InlineVeld
            label="E-mail"
            type="email"
            max={320}
            waarde={klant.email}
            leeg="+ E-mailadres"
            onBewaar={(v) => bewaar({ email: v })}
            weergave={(w) => (
              <a href={`/mail?nieuw=1&aan=${encodeURIComponent(w)}`} title="Mail schrijven">
                {w}
              </a>
            )}
          />
        </dd>
      </div>
      <div>
        <dt>Telefoon</dt>
        <dd>
          <InlineVeld
            label="Telefoon"
            type="tel"
            max={40}
            waarde={klant.telefoon}
            leeg="+ Telefoonnummer"
            onBewaar={(v) => bewaar({ telefoon: v })}
            weergave={(w) => <a href={`tel:${w.replace(/[^0-9+]/g, '')}`}>{w}</a>}
          />
        </dd>
      </div>
      <div>
        <dt>Adres</dt>
        <dd>
          <InlineVeld label="Adres" max={300} waarde={klant.adres} leeg="+ Adres" onBewaar={(v) => bewaar({ adres: v })} />
        </dd>
      </div>
      <div>
        <dt>Postcode en plaats</dt>
        <dd>
          <InlineVeld label="Postcode en plaats" max={20} waarde={klant.postcode} leeg="+ Postcode" onBewaar={(v) => bewaar({ postcode: v })} />
        </dd>
      </div>
    </dl>
  );
}

/** De klantnaam als paginatitel, direct te hernoemen. */
export function KlantTitel({ id, naam }: { id: string; naam: string }) {
  const wijzig = useKlantWijzigen();
  return <InlineTitel key={naam} waarde={naam} label="Bedrijfsnaam" onBewaar={(v) => wijzig(id, { naam: v }, 'Naam opgeslagen')} />;
}
