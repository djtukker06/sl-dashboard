import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { categorieLabel, korteDatumNL, periodeRond, totalen } from '@/lib/uitgaven/model';
import { KOLOMMEN, naarUitgave, type UitgaveRij } from '@/lib/uitgaven/repo';
import { formatEuro } from '@/lib/format';
import { BonnetjeKnop } from '@/components/uitgaven/BonnetjeKnop';
import { Kaart, KaartMelding } from './Kaart';
import { OpnieuwKnop } from './OpnieuwKnop';

// Uitgaven-snapshot: totaal deze maand, aantal concepten om te controleren en de laatste 3.
// Leest met de gebruikerscliënt (RLS), ná de sessiecheck van de dashboardpagina.
export async function UitgavenWidget() {
  const sb = await createClient();
  const maand = periodeRond('maand', vandaagNL());
  const [deze, concept, laatste] = await Promise.all([
    sb.from('expenses').select('total_amount,vat_amount,currency').gte('expense_date', maand.van).lte('expense_date', maand.tot).limit(3000),
    sb.from('expenses').select('id', { count: 'exact', head: true }).eq('status', 'concept'),
    sb.from('expenses').select(KOLOMMEN).order('created_at', { ascending: false }).limit(3)
  ]);
  const fout = deze.error || concept.error || laatste.error;

  if (fout) {
    const nietIngericht = tabelOntbreekt(fout);
    if (!nietIngericht) console.error('[uitgaven] widget', fout.message);
    return (
      <Kaart label="Uitgaven" href="/uitgaven" className="db-smal db-uitgaven">
        <KaartMelding
          toon={nietIngericht ? 'setup' : 'fout'}
          titel={nietIngericht ? 'Uitgaven nog niet ingericht' : 'Uitgaven nu niet bereikbaar'}
          actie={<OpnieuwKnop />}
        >
          {nietIngericht
            ? 'Voer in Supabase supabase/UITVOEREN_0020_UITGAVEN.sql uit.'
            : 'De gegevens konden niet worden opgehaald. Probeer het zo opnieuw.'}
        </KaartMelding>
      </Kaart>
    );
  }

  const t = totalen(
    ((deze.data ?? []) as { total_amount: number | string | null; vat_amount: number | string | null; currency: string }[]).map((r) => ({
      totaal: r.total_amount === null ? null : Number(r.total_amount),
      btwBedrag: r.vat_amount === null ? null : Number(r.vat_amount),
      valuta: r.currency
    }))
  );
  const aantalConcept = concept.count ?? 0;
  const recent = ((laatste.data ?? []) as unknown as UitgaveRij[]).map(naarUitgave);
  const maandNaam = new Intl.DateTimeFormat('nl-NL', { month: 'long', timeZone: 'UTC' }).format(new Date(`${maand.van}T12:00:00Z`));

  return (
    <Kaart label="Uitgaven" href="/uitgaven" className="db-smal db-uitgaven">
      <div className="db-omzet">
        <p className="db-omzet-bedrag">
          <span className="db-euro">€</span>
          {formatEuro(t.incl)}
        </p>
        <p className="db-sub">Uitgaven {maandNaam} · incl. btw</p>
      </div>
      <dl className="db-cijfers">
        <div>
          <dt>Btw deze maand</dt>
          <dd>{formatEuro(t.btw)}</dd>
        </div>
        <div>
          <dt>Te controleren</dt>
          <dd>
            {aantalConcept ? (
              <Link className="ug-widget-concept" href="/uitgaven">
                {aantalConcept}
              </Link>
            ) : (
              0
            )}
          </dd>
        </div>
      </dl>
      {recent.length === 0 ? (
        <KaartMelding titel="Nog geen uitgaven" actie={<BonnetjeKnop className="db-knop" />}>
          Maak een foto van een bonnetje of sleep een factuur in Uitgaven.
        </KaartMelding>
      ) : (
        <ul className="db-lijst">
          {recent.map((u) => (
            <li key={u.id}>
              <Link className="db-rij" href={`/uitgaven?uitgave=${u.id}`}>
                <span className="db-rij-hoofd">
                  <span className="db-rij-titel">{u.leverancier || 'Leverancier onbekend'}</span>
                  <span className="db-rij-meta">
                    {[u.datum ? korteDatumNL(u.datum) : 'zonder datum', categorieLabel(u.categorie), u.status === 'concept' ? 'controleren' : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="db-rij-bedrag">{u.totaal === null ? '—' : `€ ${formatEuro(u.totaal)}`}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Kaart>
  );
}
