import type { DriveStatus } from '@/lib/drive/types';
import { NietGekoppeld } from './NietGekoppeld';
import { Verkenner } from './Verkenner';

/**
 * Blok "Bestanden" op de klant- en projectpagina: de inhoud van hun eigen map in Drive
 * (Klanten/<klant>[/<project>]), uploaden (map wordt bij de eerste upload aangemaakt) en
 * "Map openen" naar Bestanden.
 */
export function BestandenBlok({ status, start }: { status: DriveStatus | null; start: { klant: string } | { project: string } }) {
  return (
    <section className="db-kaart bs-blok" aria-labelledby="kp-bestanden">
      <header className="db-kaart-kop">
        <h2 id="kp-bestanden" className="db-label">
          Bestanden
        </h2>
      </header>
      <div className="db-kaart-inhoud">
        {!status ? (
          <p className="kp-leeg">Bestanden zijn even niet beschikbaar.</p>
        ) : !status.tabellen || !status.ingericht || !status.gekoppeld ? (
          <NietGekoppeld status={status} compact />
        ) : (
          <Verkenner start={start} status={status} compact />
        )}
      </div>
    </section>
  );
}
