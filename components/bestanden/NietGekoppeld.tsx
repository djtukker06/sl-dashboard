import type { DriveStatus } from '@/lib/drive/types';

// Lege staten van Bestanden (ook in het blok op de klant- en projectpagina):
//   - migratie 0024 nog niet uitgevoerd;
//   - env-vars ontbreken op de server (alleen de namen);
//   - nog niet gekoppeld, of de toestemming is ingetrokken: de eigenaar krijgt de knop,
//     een lid de uitleg dat hij zelf geen Google-account nodig heeft.

export function KoppelKnop({ opnieuw = false, klein = false }: { opnieuw?: boolean; klein?: boolean }) {
  return (
    <form method="post" action="/api/drive/koppelen">
      <button type="submit" className={`db-knop${klein ? '' : ' db-knop-primair'}`}>
        {opnieuw ? 'Drive opnieuw koppelen' : 'Google Drive koppelen'}
      </button>
    </form>
  );
}

export function NietGekoppeld({ status, opnieuw = false, compact = false }: { status: DriveStatus; opnieuw?: boolean; compact?: boolean }) {
  if (!status.tabellen) {
    return (
      <div className="db-melding db-melding-setup">
        <p className="db-melding-titel">Bestanden nog niet ingericht</p>
        <p className="db-melding-tekst">
          Voer in Supabase (SQL Editor) <code>supabase/UITVOEREN_0024.sql</code> uit en ververs daarna deze pagina. Facturen en bonnetjes werken
          gewoon door.
        </p>
      </div>
    );
  }
  if (!status.ingericht) {
    return (
      <div className="db-melding db-melding-setup">
        <p className="db-melding-titel">Google Drive nog niet ingericht</p>
        <p className="db-melding-tekst">
          Op de server ontbreekt: {status.ontbreekt.map((n, i) => (
            <span key={n}>
              {i > 0 && ', '}
              <code>{n}</code>
            </span>
          ))}
          . Zet deze in <code>.env.local</code> en in Vercel (zie README, &ldquo;Google Drive&rdquo;) en start de server opnieuw.
        </p>
      </div>
    );
  }
  const titel = opnieuw ? 'Drive opnieuw koppelen' : 'Drive nog niet gekoppeld';
  if (status.eigenaar) {
    return (
      <div className="db-melding">
        <p className="db-melding-titel">{titel}</p>
        <p className="db-melding-tekst">
          {opnieuw
            ? 'De toegang tot Google Drive is verlopen of ingetrokken. Koppel het Google-account van Studio Levant opnieuw; de bestanden zelf blijven gewoon staan.'
            : compact
              ? 'Koppel eenmalig het Google-account van Studio Levant om hier bestanden te bewaren.'
              : 'Koppel eenmalig het Google-account van Studio Levant. Daarna staan alle bestanden in de map "Studio Levant" in die Drive, en ziet en gebruikt iedereen in het team ze hier, zonder eigen Google-account.'}
        </p>
        <div className="db-melding-actie">
          <KoppelKnop opnieuw={opnieuw} />
        </div>
      </div>
    );
  }
  return (
    <div className="db-melding">
      <p className="db-melding-titel">{titel}</p>
      <p className="db-melding-tekst">
        {opnieuw
          ? 'De koppeling met Google Drive moet opnieuw worden gemaakt. Vraag de eigenaar om dat te doen via Bestanden; de bestanden zelf blijven gewoon staan.'
          : 'De eigenaar koppelt de Google Drive van Studio Levant eenmalig via Bestanden. Daarna zie en gebruik je de bestanden hier; je hebt zelf geen Google-account nodig.'}
      </p>
    </div>
  );
}
