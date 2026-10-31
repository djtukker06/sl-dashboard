import Link from 'next/link';
import { BORD_STATUSSEN, opDeadline } from '@/lib/crm/projectstatus';
import type { KlantPagina } from '@/lib/crm/repo';
import { KLANT_STATUSSEN, KLANT_STATUS_LABEL, isProspect } from '@/lib/crm/types';
import { korteDatum } from '@/lib/dashboard/tijd';
import { formatEuro } from '@/lib/format';
import type { DriveStatus } from '@/lib/drive/types';
import { BestandenBlok } from '@/components/bestanden/BestandenBlok';
import { NotitiesBlok } from '@/components/notities/NotitiesBlok';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { ContactActies, LeadActies, OpvolgVelden } from './KlantActies';
import { KlantContact, KlantTitel } from './KlantContact';
import { KlantTijdlijn } from './KlantNotities';
import { NieuwProject } from './NieuwProject';
import { ProjectRegels } from './ProjectRegels';
import { StatusKiezer } from './StatusKiezer';
import { TakenBlok } from './TakenBlok';

/** De klantpagina zelf (zonder data ophalen), zodat hij ook los te tonen is. */
export function KlantInhoud({ data, vandaag, drive }: { data: KlantPagina; vandaag: string; drive: DriveStatus | null }) {
  const { klant, notities, projecten, taken, facturen, cijfers, prijsopgaven, opvolging, aangemaakt } = data;
  const lopend = projecten.filter((p) => p.status !== 'afgerond').sort((a, b) => BORD_STATUSSEN.indexOf(b.status) - BORD_STATUSSEN.indexOf(a.status) || opDeadline(a, b));
  const afgerond = projecten.filter((p) => p.status === 'afgerond').sort(opDeadline);
  const klantRef = { id: klant.id, naam: klant.naam };
  const opvolgVelden = (snel: boolean) => (
    <OpvolgVelden klantId={klant.id} klantNaam={klant.naam} volgendeStap={klant.volgendeStap} opvolgenOp={klant.opvolgenOp} vandaag={vandaag} snel={snel} />
  );

  return (
    <>
      <ModuleKop label={<Link href="/klanten">← Klanten</Link>} titel={<KlantTitel id={klant.id} naam={klant.naam} />}>
        <ContactActies email={klant.email} telefoon={klant.telefoon} />
        <StatusKiezer
          key={klant.status}
          url={`/api/klanten/${klant.id}`}
          waarde={klant.status}
          label="Status van de klant"
          opties={KLANT_STATUSSEN.map((s): [string, string] => [s, KLANT_STATUS_LABEL[s]])}
          meldingen={{
            afgerond: 'Klant afgerond. Hij blijft vindbaar onder Klanten → Afgerond.',
            actief: 'Klant staat op Actief.',
            lead: 'Klant staat op Lead.',
            koud: 'Staat op de radar: niet vergeten, telt niet mee bij Opvolgen.'
          }}
        />
      </ModuleKop>

      <div className="kp kp-detail">
        {klant.status === 'lead' && (
          <section className="kp-leadbanner" aria-labelledby="kp-opvolgen">
            <div className="kp-leadbanner-kop">
              <h2 id="kp-opvolgen" className="kp-leadbanner-titel">
                Lead opvolgen
              </h2>
              <LeadActies klant={klant} opvolging={opvolging} />
            </div>
            {opvolging ? (
              opvolgVelden(true)
            ) : (
              <p className="kp-uitleg">Volgende stap en opvolgdatum werken zodra migratie 0025 is uitgevoerd (supabase/UITVOEREN_0025.sql).</p>
            )}
          </section>
        )}
        {klant.status === 'koud' && (
          <section className="kp-leadbanner kp-radarbanner" aria-labelledby="kp-radar">
            <div className="kp-leadbanner-kop">
              <h2 id="kp-radar" className="kp-leadbanner-titel">
                Op de radar
              </h2>
              <LeadActies klant={klant} opvolging={opvolging} />
            </div>
            <p className="kp-uitleg">Niet vergeten, nu nog geen actie: staat niet bij Opvolgen. Gaan we ze benaderen, zet ze dan bij de leads.</p>
          </section>
        )}
        {klant.status === 'afgerond' && (
          <div className="kp-afgerond-melding" role="note">
            <p>
              <strong>Deze klant is afgerond.</strong> Hij blijft vindbaar onder Klanten → Afgerond. Komt er nieuw werk? Een nieuw project zet de klant
              weer op Actief.
            </p>
            <NieuwProject klant={klantRef} klantAfgerond label="+ Nieuw project" />
          </div>
        )}

        {(!isProspect(klant.status) || cijfers.aantalFacturen > 0 || projecten.length > 0) && (
        <ul className="kp-kern" aria-label="Kerncijfers">
          <li className="kp-kern-vak">
            <span className="kp-kern-label">Omzet excl. btw</span>
            <span className="kp-kern-n">€ {formatEuro(cijfers.omzet)}</span>
            <span className="kp-kern-sub">€ {formatEuro(cijfers.omzetDitJaar)} dit jaar</span>
          </li>
          <li className="kp-kern-vak">
            <span className="kp-kern-label">Facturen</span>
            <span className="kp-kern-n">{cijfers.aantalFacturen}</span>
            <span className="kp-kern-sub">{facturen[0]?.datum ? `laatste ${korteDatum(facturen[0].datum)}` : 'nog geen'}</span>
          </li>
          <li className={`kp-kern-vak${cijfers.openAanbetalingen ? ' is-let-op' : ''}`}>
            <span className="kp-kern-label">Open</span>
            <span className="kp-kern-n">{cijfers.openAanbetalingen ? `€ ${formatEuro(cijfers.openBedrag)}` : '—'}</span>
            <span className="kp-kern-sub">
              {cijfers.openAanbetalingen
                ? `${cijfers.openAanbetalingen} ${cijfers.openAanbetalingen === 1 ? 'aanbetaling' : 'aanbetalingen'} zonder restfactuur`
                : 'geen aanbetaling open'}
            </span>
          </li>
          <li className="kp-kern-vak">
            <span className="kp-kern-label">Projecten</span>
            <span className="kp-kern-n">{lopend.length}</span>
            <span className="kp-kern-sub">{afgerond.length ? `lopend · ${afgerond.length} afgerond` : 'lopend'}</span>
          </li>
        </ul>
        )}

        <div className="kp-hoofd">
          <section className="db-kaart" aria-labelledby="kp-projecten">
            <header className="db-kaart-kop">
              <h2 id="kp-projecten" className="db-label">
                Projecten
              </h2>
              <NieuwProject klant={klantRef} klasse="db-knop db-knop-klein" klantAfgerond={klant.status === 'afgerond'} />
            </header>
            <div className="db-kaart-inhoud">
              {projecten.length === 0 ? (
                <p className="kp-leeg">Nog geen projecten. Begint er werk? Maak een project met “+ Project”.</p>
              ) : (
                <ProjectRegels projecten={[...lopend, ...afgerond]} vandaag={vandaag} />
              )}
            </div>
          </section>

          <section className="db-kaart" aria-labelledby="kp-taken">
            <header className="db-kaart-kop">
              <h2 id="kp-taken" className="db-label">
                Open taken
              </h2>
            </header>
            <div className="db-kaart-inhoud">
              <TakenBlok taken={taken} vandaag={vandaag} standaard={{ klant: klantRef }} />
            </div>
          </section>

          <section className="db-kaart" aria-labelledby="kp-tijdlijn">
            <header className="db-kaart-kop">
              <h2 id="kp-tijdlijn" className="db-label">
                Tijdlijn
              </h2>
            </header>
            <div className="db-kaart-inhoud">
              <KlantTijdlijn klantId={klant.id} notities={notities} facturen={facturen} aangemaakt={aangemaakt} />
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

          {klant.status === 'actief' && opvolging && (
            <section className="db-kaart" aria-labelledby="kp-opvolgen-actief">
              <header className="db-kaart-kop">
                <h2 id="kp-opvolgen-actief" className="db-label">
                  Opvolgen
                </h2>
              </header>
              <div className="db-kaart-inhoud">{opvolgVelden(true)}</div>
            </section>
          )}

          <section className="db-kaart" aria-labelledby="kp-geld">
            <header className="db-kaart-kop">
              <h2 id="kp-geld" className="db-label">
                Facturen &amp; prijsopgaven
              </h2>
              <span className="kp-kop-acties">
                <Link className="db-knop db-knop-klein" href="/facturen/nieuwe-factuur">
                  + Factuur
                </Link>
                <Link className="db-knop db-knop-klein" href="/facturen/prijsopgaven/nieuw">
                  + Offerte
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
                    {facturen.slice(0, 5).map((f) => (
                      <li key={f.id}>
                        <Link className="kp-rij" href={`/facturen/${f.id}/bewerken`}>
                          <span className="kp-rij-hoofd">
                            <span className="kp-rij-titel">{f.nummer}</span>
                            <span className="kp-rij-sub">
                              {korteDatum(f.datum)}
                              {f.open ? ' · aanbetaling open' : ''}
                            </span>
                          </span>
                          <span className="kp-rij-bedrag">€ {formatEuro(f.totaal)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Link className="db-kaart-link kp-meer" href={`/facturen/klanten/${klant.id}`}>
                  {cijfers.aantalFacturen > 5 ? `Alle ${cijfers.aantalFacturen} facturen →` : 'Facturen in boekhouding →'}
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
                          <span className="kp-rij-hoofd">
                            <span className="kp-rij-titel">{q.naam || (q.nummer ? `Prijsopgave ${q.nummer}` : 'Prijsopgave')}</span>
                            <span className="kp-rij-sub">{korteDatum(q.datum)}</span>
                          </span>
                          <span className="kp-rij-bedrag">€ {formatEuro(q.totaal)}</span>
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

          <NotitiesBlok koppeling={{ klant: klant.id }} />

          <BestandenBlok status={drive} start={{ klant: klant.id }} />
        </aside>
      </div>
    </>
  );
}
