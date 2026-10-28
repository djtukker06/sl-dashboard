import type { Metadata } from 'next';
import Link from 'next/link';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { factuurSnapshot } from '@/lib/dashboard/facturen';
import { korteDatum } from '@/lib/dashboard/tijd';
import { formatEuro } from '@/lib/format';
import { UitgavenFout } from '@/lib/uitgaven/api';
import { laatsteUitgaven } from '@/lib/uitgaven/repo';
import type { Uitgave } from '@/lib/uitgaven/model';
import { BoekhoudingKop } from '@/components/boekhouding/BoekhoudingKop';
import { Persoon } from '@/components/team/Persoon';
import { BonnetjeKnop } from '@/components/uitgaven/BonnetjeKnop';
import { RecenteBonnetjes } from '@/components/uitgaven/RecenteBonnetjes';
import { UgIcoon } from '@/components/uitgaven/Iconen';
import { logFout } from '@/lib/log';
import type { Teamlid } from '@/lib/auth/team';
import { repoVoorPagina } from '@/lib/boekhouding/modus';
import { NietIngerichtMelding } from '@/components/boekhouding/NietIngericht';
import { DemoBanner } from '@/components/boekhouding/DemoBanner';
import { OverzichtCijfers, overzichtData, type OverzichtData } from '@/components/boekhouding/JaarSchermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Boekhouding · Studio Levant' };

// Boekhouding: bovenaan de kerncijfers (bank, resultaat, btw, openstaand) en daaronder de keuze
// tussen Facturen (het bestaande facturen-deel, ongewijzigd) en Bonnetjes & inkoopfacturen.
// Alles wat hier staat is gedeeld met het hele team. Zonder vinkje Boekhouding geen kerncijfers
// (die komen uit de boekhouding zelf), wel de tegels Facturen en Bonnetjes.
export default async function BoekhoudingPage() {
  const lid = await vereisTeamlidPagina('/boekhouding');

  const [facturen, bonnetjes] = await Promise.all([
    factuurSnapshot(lid.sb),
    laatsteUitgaven(lid.sb, 4).then(
      (lijst): { ok: true; lijst: Uitgave[] } => ({ ok: true, lijst }),
      (e): { ok: false; nietIngericht: boolean } => ({ ok: false, nietIngericht: e instanceof UitgavenFout && e.code === 'tabel_ontbreekt' })
    )
  ]);

  return (
    <div className="bh">
      <BoekhoudingKop titel="Boekhouding" />
      {lid.boekhouding && <BoekhoudCijfers lid={lid} />}
      <div className="bh-tegels">
        {/* ---------- Facturen ---------- */}
        <section className="bh-tegel" aria-labelledby="bh-facturen">
          <header className="bh-tegel-kop">
            <span className="bh-tegel-icoon" aria-hidden="true">
              <UgIcoon naam="pdf" grootte={22} />
            </span>
            <div>
              <h2 id="bh-facturen" className="bh-tegel-titel">
                <Link href="/facturen">Facturen</Link>
              </h2>
              <p className="bh-tegel-sub">Facturen, prijsopgaven en klanten</p>
            </div>
          </header>

          {facturen.ok ? (
            <>
              <div className="bh-cijfers">
                <div>
                  <p className="db-omzet-bedrag">
                    <span className="db-euro">€</span>
                    {formatEuro(facturen.data.omzet)}
                  </p>
                  <p className="db-sub">Omzet {facturen.data.jaar} · excl. btw</p>
                </div>
                <dl className="db-cijfers">
                  <div>
                    <dt>Facturen {facturen.data.jaar}</dt>
                    <dd>{facturen.data.aantal}</dd>
                  </div>
                  <div>
                    <dt>Open aanbetalingen</dt>
                    <dd className={facturen.data.openAanbetalingen ? 'db-let-op' : ''}>{facturen.data.openAanbetalingen}</dd>
                  </div>
                </dl>
              </div>
              {facturen.data.laatste.length === 0 ? (
                <p className="bh-leeg">Nog geen facturen.</p>
              ) : (
                <ul className="db-lijst">
                  {facturen.data.laatste.map((r) => (
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
            </>
          ) : (
            <p className="bh-leeg" role={facturen.reden === 'fout' ? 'alert' : undefined}>
              {facturen.reden === 'fout'
                ? 'De facturen konden nu niet worden opgehaald. Ververs de pagina om het opnieuw te proberen.'
                : 'De tabellen voor facturen bestaan nog niet in de database.'}
            </p>
          )}

          <footer className="bh-tegel-voet">
            <Link className="db-knop db-knop-primair" href="/facturen/nieuwe-factuur">
              Nieuwe factuur
            </Link>
            <Link className="db-knop" href="/facturen/prijsopgaven/nieuw">
              Nieuwe prijsopgave
            </Link>
            <Link className="db-kaart-link bh-alles" href="/facturen">
              Alle facturen <span aria-hidden="true">→</span>
            </Link>
          </footer>
        </section>

        {/* ---------- Bonnetjes & inkoopfacturen ---------- */}
        <section className="bh-tegel" aria-labelledby="bh-bonnetjes">
          <header className="bh-tegel-kop">
            <span className="bh-tegel-icoon" aria-hidden="true">
              <UgIcoon naam="bon" grootte={22} />
            </span>
            <div>
              <h2 id="bh-bonnetjes" className="bh-tegel-titel">
                <Link href="/boekhouding/bonnetjes">Bonnetjes &amp; inkoopfacturen</Link>
              </h2>
              <p className="bh-tegel-sub">Foto’s en PDF’s uploaden en snel terugvinden</p>
            </div>
          </header>

          {bonnetjes.ok ? (
            bonnetjes.lijst.length === 0 ? (
              <p className="bh-leeg">
                Nog niets geüpload. Maak een foto van een bonnetje of kies een PDF; leverancier, datum en bedrag worden
                automatisch uitgelezen zodat je het later makkelijk terugvindt.
              </p>
            ) : (
              <RecenteBonnetjes uitgaven={bonnetjes.lijst} />
            )
          ) : (
            <p className="bh-leeg" role={bonnetjes.nietIngericht ? undefined : 'alert'}>
              {bonnetjes.nietIngericht
                ? 'Bonnetjes is nog niet ingericht: voer in Supabase supabase/UITVOEREN_0020_UITGAVEN.sql uit.'
                : 'De bonnetjes konden nu niet worden opgehaald. Ververs de pagina om het opnieuw te proberen.'}
            </p>
          )}

          <footer className="bh-tegel-voet">
            <BonnetjeKnop className="db-knop db-knop-primair" label="Bonnetje uploaden" />
            <Link className="db-knop" href="/boekhouding/bonnetjes">
              Zoeken
            </Link>
            <Link className="db-kaart-link bh-alles" href="/boekhouding/bonnetjes">
              Alle bonnetjes <span aria-hidden="true">→</span>
            </Link>
          </footer>
        </section>
      </div>
    </div>
  );
}

/** De kerncijfers van de boekhouding; bij een storing een korte melding (de tegels blijven werken). */
async function BoekhoudCijfers({ lid }: { lid: Teamlid }) {
  let cijfers: OverzichtData | null = null;
  let demo = false;
  let ingericht = true;
  try {
    const repo = await repoVoorPagina(lid);
    if (!repo) ingericht = false;
    else {
      demo = repo.modus === 'demo';
      cijfers = await overzichtData(repo);
    }
  } catch (e) {
    logFout('[boekhouding] overzicht', e);
  }
  if (!ingericht) return <NietIngerichtMelding />;
  if (!cijfers) {
    return (
      <p className="bh-leeg bh-overzicht" role="alert">
        De cijfers van de boekhouding konden nu niet worden opgehaald. Ververs de pagina om het opnieuw te proberen.
      </p>
    );
  }
  return (
    <>
      {demo && <DemoBanner />}
      <OverzichtCijfers d={cijfers} />
    </>
  );
}
