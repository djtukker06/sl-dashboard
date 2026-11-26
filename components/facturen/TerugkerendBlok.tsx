import Link from 'next/link';
import { bedrijf } from '@/lib/config';
import { formatEuro } from '@/lib/format';
import { akkoordStand, datumKort, periodeLabel, ritme, subtotaal } from '@/lib/invoice/terugkerend-kern';
import type { TerugkerendDto } from '@/lib/invoice/terugkerend-beheer';
import { FactuurInzien } from './FactuurInzien';

// Het blok "Terugkerende facturen" op het facturenoverzicht: per lopende terugkerende factuur
// in één regel wat, voor wie, hoe vaak en wanneer de volgende komt. Beheren (pauzeren, nu
// factureren, bewerken) gebeurt op /facturen/terugkerend.
export function TerugkerendBlok({ sjablonen, vandaag }: { sjablonen: TerugkerendDto[]; vandaag: string }) {
  const lopend = sjablonen.filter((s) => s.actief);
  const gepauzeerd = sjablonen.length - lopend.length;
  const fouten = sjablonen.filter((s) => s.laatsteFout).length;
  const perMaand = lopend.reduce((som, s) => {
    const excl = subtotaal(s.regels);
    return som + excl / (s.interval === 'maand' ? 1 : s.interval === 'kwartaal' ? 3 : 12);
  }, 0);

  return (
    <>
      <div className="section-head">
        <h2>Terugkerende facturen</h2>
        <span className="section-hint">
          {lopend.length ? `€ ${formatEuro(perMaand)} per maand excl. btw` : 'Elke maand, kwartaal of jaar automatisch'}
          {' · '}
          <Link href="/facturen/terugkerend">{sjablonen.length ? 'Beheren' : 'Uitleg'}</Link>
          {' · '}
          <Link href="/facturen/nieuwe-factuur?soort=terugkerend">+ Nieuwe</Link>
        </span>
      </div>
      {fouten > 0 && (
        <p className="foutmelding tk-fout">
          Bij {fouten === 1 ? 'één terugkerende factuur' : `${fouten} terugkerende facturen`} ging iets mis. <Link href="/facturen/terugkerend">Bekijken</Link>
        </p>
      )}
      {lopend.length > 0 ? (
        <div className="scroll-wrap facturen-tabel-wrap">
          <table className="facturen-tabel tk-blok">
            <thead>
              <tr>
                <th>Naam</th>
                <th>Klant</th>
                <th>Ritme</th>
                <th>Volgende</th>
                <th>Bedrag</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lopend.map((s) => {
                const excl = subtotaal(s.regels);
                const incl = s.btwVerlegd ? excl : excl + Math.round(excl * bedrijf.btwPercentage) / 100;
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/facturen/terugkerend/${s.id}`}>{s.naam}</Link>
                      {akkoordStand(
                        { actief: s.actief, versturen: s.versturen, akkoord_vereist: s.akkoordVereist, akkoord_periode: s.akkoordPeriode, volgende_datum: s.volgendeDatum },
                        vandaag
                      ) === 'gevraagd' ? (
                        <Link href="/facturen/terugkerend#akkoord" className="soort-label tk-label tk-wacht">
                          Wacht op akkoord
                        </Link>
                      ) : (
                        s.versturen && <span className="soort-label">{s.akkoordVereist ? 'Verstuurd na akkoord' : 'Automatisch verstuurd'}</span>
                      )}
                    </td>
                    <td>{s.klantNaam}</td>
                    <td>{ritme(s.interval, s.dag)}</td>
                    <td>
                      {datumKort(s.volgendeDatum)} <span className="tk-sub">· {periodeLabel(s.volgendeDatum, s.interval)}</span>
                    </td>
                    <td className="bedrag">&euro; {formatEuro(incl)}</td>
                    <td className="acties-col">
                      <FactuurInzien id={s.id} naam={s.naam} klein />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="leeg-melding">
          {gepauzeerd ? `${gepauzeerd} gepauzeerd. ` : 'Nog geen terugkerende facturen. '}
          <Link href="/facturen/nieuwe-factuur?soort=terugkerend">Maak er een</Link> voor bijvoorbeeld een onderhoudspakket.
        </div>
      )}
      {lopend.length > 0 && gepauzeerd > 0 && <p className="tk-sub tk-gepauzeerd">En {gepauzeerd} gepauzeerd.</p>}
    </>
  );
}
