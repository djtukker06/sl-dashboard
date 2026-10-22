import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { factuurSnapshot } from '@/lib/dashboard/facturen';
import { korteDatum } from '@/lib/dashboard/tijd';
import { formatEuro } from '@/lib/format';
import { Persoon } from '@/components/team/Persoon';
import { Kaart, KaartMelding } from './Kaart';
import { OpnieuwKnop } from './OpnieuwKnop';

// Facturen-snapshot (alleen lezen). Leest met de gebruikerscliënt, dus via RLS.
export async function FacturenWidget() {
  const supabase = await createClient();
  const res = await factuurSnapshot(supabase);

  if (!res.ok) {
    return (
      <Kaart label="Facturen" href="/facturen" className="db-smal db-facturen">
        <KaartMelding
          toon={res.reden === 'fout' ? 'fout' : 'setup'}
          titel={res.reden === 'fout' ? 'Facturen nu niet bereikbaar' : 'Facturen nog niet ingericht'}
          actie={<OpnieuwKnop />}
        >
          {res.reden === 'fout'
            ? 'De gegevens konden niet worden opgehaald. Probeer het zo opnieuw.'
            : 'De tabellen voor facturen bestaan nog niet in de database.'}
        </KaartMelding>
      </Kaart>
    );
  }

  const f = res.data;
  return (
    <Kaart label="Facturen" href="/facturen" className="db-smal db-facturen">
      <div className="db-omzet">
        <p className="db-omzet-bedrag">
          <span className="db-euro">€</span>
          {formatEuro(f.omzet)}
        </p>
        <p className="db-sub">Omzet {f.jaar} · excl. btw</p>
      </div>
      <dl className="db-cijfers">
        <div>
          <dt>Facturen {f.jaar}</dt>
          <dd>{f.aantal}</dd>
        </div>
        <div>
          <dt>Open aanbetalingen</dt>
          <dd className={f.openAanbetalingen ? 'db-let-op' : ''}>{f.openAanbetalingen}</dd>
        </div>
      </dl>
      {f.laatste.length === 0 ? (
        <KaartMelding
          titel="Nog geen facturen"
          actie={
            <Link className="db-knop" href="/facturen/nieuwe-factuur">
              + Nieuwe factuur
            </Link>
          }
        />
      ) : (
        <ul className="db-lijst">
          {f.laatste.map((r) => (
            <li key={r.id}>
              <Link className="db-rij" href={`/facturen/${r.id}/bewerken`}>
                <span className="db-rij-hoofd">
                  <span className="db-rij-titel">{r.klant}</span>
                  <span className="db-rij-meta">
                    {r.nummer}
                    {r.datum ? ` · ${korteDatum(r.datum)}` : ''}
                  </span>
                </span>
                <span className="ug-recent-rechts">
                  <span className="db-rij-bedrag">€ {formatEuro(r.totaal)}</span>
                  <Persoon id={r.door} compact voorvoegsel="gemaakt door" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Kaart>
  );
}
