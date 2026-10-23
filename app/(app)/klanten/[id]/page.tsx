import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { dagTekst, vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isUuid } from '@/lib/agenda/invoer';
import { BORD_STATUSSEN, deadlineStand, opDeadline } from '@/lib/crm/projectstatus';
import { isNietIngericht, klantPagina } from '@/lib/crm/repo';
import { korteDatum } from '@/lib/dashboard/tijd';
import { formatEuro } from '@/lib/format';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { CrmNietIngericht } from '@/components/crm/CrmKop';
import { CrmProviders } from '@/components/crm/CrmProviders';
import { KlantContact } from '@/components/crm/KlantContact';
import { KlantNotities } from '@/components/crm/KlantNotities';
import { NieuwProject } from '@/components/crm/NieuwProject';
import { StatusKiezer } from '@/components/crm/StatusKiezer';
import { StatusPil, Voortgang } from '@/components/crm/StatusPil';
import { TakenBlok } from '@/components/crm/TakenBlok';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Klant · Studio Levant' };

// Klantpagina: contact, status, notities, projecten, open taken, en de laatste facturen
// en prijsopgaven (links naar de bestaande pagina's in Boekhouding, die ongewijzigd zijn).
export default async function KlantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lid = await vereisTeamlidPagina(`/klanten/${id}`);
  if (lid.overgang) return <CrmNietIngericht actief="klanten" />;
  if (!isUuid(id)) notFound();

  let data;
  try {
    data = await klantPagina(bronVan(lid), id);
  } catch (e) {
    if (isNietIngericht(e)) return <CrmNietIngericht actief="klanten" />;
    throw e;
  }
  if (!data) notFound();
  const { klant, notities, projecten, taken, facturen, aantalFacturen, prijsopgaven } = data;
  const vandaag = vandaagNL();
  const lopend = projecten.filter((p) => p.status !== 'afgerond').sort((a, b) => BORD_STATUSSEN.indexOf(a.status) - BORD_STATUSSEN.indexOf(b.status) || opDeadline(a, b));
  const afgerond = projecten.filter((p) => p.status === 'afgerond').sort(opDeadline);

  return (
    <CrmProviders>
      <ModuleKop label={<Link href="/klanten">← Klanten</Link>} titel={klant.naam}>
        <StatusKiezer
          key={klant.status}
          url={`/api/klanten/${klant.id}`}
          waarde={klant.status}
          label="Status van de klant"
          opties={[
            ['lead', 'Lead'],
            ['actief', 'Actief'],
            ['afgerond', 'Afgerond']
          ]}
          meldingen={{
            afgerond: 'Klant afgerond. Hij blijft vindbaar onder Klanten (filter Afgerond).',
            actief: 'Klant staat op Actief.',
            lead: 'Klant staat op Lead.'
          }}
        />
      </ModuleKop>

      <div className="kp kp-detail">
        {klant.status === 'afgerond' && (
          <div className="kp-afgerond-melding" role="note">
            <p>
              <strong>Deze klant is afgerond.</strong> Hij blijft gewoon vindbaar onder Klanten (onderaan, of met het filter Afgerond).
              Komt er nieuw werk? Een nieuw project zet de klant weer op Actief.
            </p>
            <NieuwProject klant={{ id: klant.id, naam: klant.naam }} klantAfgerond label="+ Nieuw project" />
          </div>
        )}
        <div className="kp-hoofd">
          <section className="db-kaart" aria-labelledby="kp-taken">
            <header className="db-kaart-kop">
              <h2 id="kp-taken" className="db-label">
                Open taken
              </h2>
            </header>
            <div className="db-kaart-inhoud">
              <TakenBlok taken={taken} vandaag={vandaag} standaard={{ klant: { id: klant.id, naam: klant.naam } }} />
            </div>
          </section>

          <section className="db-kaart" aria-labelledby="kp-projecten">
            <header className="db-kaart-kop">
              <h2 id="kp-projecten" className="db-label">
                Projecten
              </h2>
              <NieuwProject klant={{ id: klant.id, naam: klant.naam }} klasse="db-knop" klantAfgerond={klant.status === 'afgerond'} />
            </header>
            <div className="db-kaart-inhoud">
              {projecten.length === 0 ? (
                <p className="kp-leeg">Nog geen projecten voor deze klant.</p>
              ) : (
                <ul className="kp-lijst kp-lijst-compact">
                  {[...lopend, ...afgerond].map((p) => (
                    <li key={p.id}>
                      <Link className={`kp-rij${p.status === 'afgerond' ? ' is-af' : ''}`} href={`/projecten/${p.id}`}>
                        <span className="kp-rij-hoofd">
                          <span className="kp-rij-titel">{p.naam}</span>
                          {p.deadline && (
                            <span className={`kp-rij-sub pb-deadline is-${deadlineStand(p.deadline, vandaag, p.status)}`}>
                              deadline {dagTekst(p.deadline, vandaag)}
                            </span>
                          )}
                        </span>
                        <span className="kp-rij-meta">
                          <Voortgang open={p.openTaken} totaal={p.totaalTaken} />
                          <StatusPil status={p.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="db-kaart" aria-labelledby="kp-geld">
            <header className="db-kaart-kop">
              <h2 id="kp-geld" className="db-label">
                Facturen &amp; prijsopgaven
              </h2>
              <span className="kp-kop-acties">
                <Link className="db-knop" href="/facturen/nieuwe-factuur">
                  + Factuur
                </Link>
                <Link className="db-knop" href="/facturen/prijsopgaven/nieuw">
                  + Prijsopgave
                </Link>
              </span>
            </header>
            <div className="db-kaart-inhoud kp-geld">
              <div>
                <p className="kp-subkop">Facturen</p>
                {facturen.length === 0 ? (
                  <p className="kp-leeg">Nog geen facturen.</p>
                ) : (
                  <ul className="kp-lijst kp-lijst-compact">
                    {facturen.map((f) => (
                      <li key={f.id}>
                        <Link className="kp-rij" href={`/facturen/${f.id}/bewerken`}>
                          <span className="kp-rij-titel">Factuur {f.nummer}</span>
                          <span className="kp-rij-meta">
                            <span>{korteDatum(f.datum)}</span>
                            <span>€ {formatEuro(f.totaal)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Link className="db-kaart-link kp-meer" href={`/facturen/klanten/${klant.id}`}>
                  {aantalFacturen > facturen.length ? `Alle ${aantalFacturen} facturen →` : 'Facturen van deze klant (boekhouding) →'}
                </Link>
              </div>
              <div>
                <p className="kp-subkop">Prijsopgaven</p>
                {prijsopgaven.length === 0 ? (
                  <p className="kp-leeg">Nog geen prijsopgaven.</p>
                ) : (
                  <ul className="kp-lijst kp-lijst-compact">
                    {prijsopgaven.map((q) => (
                      <li key={q.id}>
                        <Link className="kp-rij" href={`/facturen/prijsopgaven/${q.id}/bewerken`}>
                          <span className="kp-rij-titel">{q.naam || (q.nummer ? `Prijsopgave ${q.nummer}` : 'Prijsopgave')}</span>
                          <span className="kp-rij-meta">
                            <span>{korteDatum(q.datum)}</span>
                            <span>€ {formatEuro(q.totaal)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Link className="db-kaart-link kp-meer" href="/facturen/prijsopgaven">
                  Alle prijsopgaven →
                </Link>
              </div>
            </div>
          </section>
        </div>

        <aside className="kp-zij">
          <section className="db-kaart" aria-labelledby="kp-contact">
            <header className="db-kaart-kop">
              <h2 id="kp-contact" className="db-label">
                Contact
              </h2>
            </header>
            <div className="db-kaart-inhoud">
              <KlantContact klant={klant} />
            </div>
          </section>
          <section className="db-kaart" aria-labelledby="kp-notities">
            <header className="db-kaart-kop">
              <h2 id="kp-notities" className="db-label">
                Notities
              </h2>
            </header>
            <div className="db-kaart-inhoud">
              <KlantNotities klantId={klant.id} notities={notities} />
            </div>
          </section>
        </aside>
      </div>
    </CrmProviders>
  );
}
