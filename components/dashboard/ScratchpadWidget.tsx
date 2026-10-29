import Link from 'next/link';
import type { Teamlid } from '@/lib/auth/team';
import { relatief } from '@/lib/dashboard/tijd';
import { weergaveTitel, type NotitieSamenvatting } from '@/lib/notities/kern';
import { isScratchpadNietIngericht, notitiesLijst } from '@/lib/notities/repo';
import { DocIcoon } from '@/components/notities/DocIcoon';
import { Kaart, KaartMelding } from './Kaart';
import { OpnieuwKnop } from './OpnieuwKnop';

const AANTAL = 5;

// "Scratchpad": de vastgepinde en laatst bewerkte notities (gedeeld + je eigen privé, via
// RLS) met een knop voor een nieuwe notitie. Gebruikerscliënt ná de teamcheck van het dashboard.
export async function ScratchpadWidget({ lid }: { lid: Teamlid }) {
  let lijst: NotitieSamenvatting[];
  try {
    lijst = await notitiesLijst(lid.sb, { mijnId: lid.userId, limiet: AANTAL });
  } catch (e) {
    const nietIngericht = isScratchpadNietIngericht(e);
    return (
      <Kaart label="Scratchpad" href="/scratchpad" className="db-scratchpad">
        <KaartMelding toon={nietIngericht ? 'setup' : 'fout'} titel={nietIngericht ? 'Scratchpad nog niet ingericht' : 'Scratchpad nu niet bereikbaar'} actie={<OpnieuwKnop />}>
          {nietIngericht ? 'Voer in Supabase supabase/UITVOEREN_0031.sql uit.' : 'De notities konden niet worden opgehaald. Probeer het zo opnieuw.'}
        </KaartMelding>
      </Kaart>
    );
  }

  const nieuw = (
    <Link className="db-knop db-knop-primair" href="/scratchpad?nieuw=1" prefetch={false}>
      + Nieuwe notitie
    </Link>
  );

  if (!lijst.length) {
    return (
      <Kaart label="Scratchpad" href="/scratchpad" className="db-scratchpad">
        <KaartMelding titel="Nog geen notities" actie={nieuw}>
          Brainstorm, schrijf ideeën uit en koppel ze aan een klant of project.
        </KaartMelding>
      </Kaart>
    );
  }

  return (
    <Kaart label="Scratchpad" href="/scratchpad" className="db-scratchpad">
      <ul className="sp-kort-lijst">
        {lijst.map((n) => (
          <li key={n.id}>
            <Link className="sp-kort" href={`/scratchpad?n=${n.id}`}>
              <span className="sp-item-icoon" aria-hidden="true">
                {n.emoji ?? <DocIcoon />}
              </span>
              <span className="sp-kort-hoofd">
                <span className="sp-kort-titel">
                  {n.vastgepind && <span className="sr-only">Vastgepind: </span>}
                  {weergaveTitel(n)}
                </span>
                {(n.fragment || n.klant || n.project) && (
                  <span className="sp-kort-fragment">{[n.project?.naam ?? n.klant?.naam, n.fragment].filter(Boolean).join(' · ')}</span>
                )}
              </span>
              <span className="sp-kort-meta">
                {n.vastgepind ? '📌 ' : ''}
                {n.prive ? 'privé · ' : ''}
                {relatief(n.bewerktOp)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="sp-kort-acties">{nieuw}</div>
    </Kaart>
  );
}
