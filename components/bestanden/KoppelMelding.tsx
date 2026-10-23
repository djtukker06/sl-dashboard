// Melding na het koppelen (de callback stuurt terug naar /bestanden?drive=<code>).
const TEKST: Record<string, { titel: string; tekst: string; goed?: boolean }> = {
  gekoppeld: { titel: 'Google Drive is gekoppeld', tekst: 'De map "Studio Levant" met Boekhouding, Klanten en Algemeen staat klaar.', goed: true },
  geweigerd: { titel: 'Koppelen geannuleerd', tekst: 'Er is geen toestemming gegeven bij Google. Probeer het opnieuw als je wilt koppelen.' },
  ongeldig: { titel: 'Koppelen mislukt', tekst: 'De aanvraag was verlopen of ongeldig. Probeer het opnieuw (binnen 10 minuten afronden).' },
  geen_refresh: {
    titel: 'Koppelen mislukt',
    tekst: 'Google gaf geen blijvende toegang. Trek de toegang in via myaccount.google.com → Beveiliging → Apps van derden en koppel opnieuw.'
  },
  scope: { titel: 'Koppelen onvolledig', tekst: 'Geef bij Google toegang tot "alle bestanden in Google Drive" en koppel opnieuw.' },
  geen_eigenaar: { titel: 'Niet gekoppeld', tekst: 'Alleen de eigenaar kan Google Drive koppelen.' },
  niet_ingericht: { titel: 'Niet gekoppeld', tekst: 'Google Drive is nog niet ingericht op de server (zie hieronder).' },
  client: { titel: 'Koppelen mislukt', tekst: 'GOOGLE_CLIENT_ID of GOOGLE_CLIENT_SECRET klopt niet (zie README, "Google Drive").' },
  site_url: { titel: 'Koppelen mislukt', tekst: 'Onbekend adres van de backoffice: zet NEXT_PUBLIC_SITE_URL (zie README).' },
  tabel_ontbreekt: { titel: 'Koppelen mislukt', tekst: 'Voer eerst supabase/UITVOEREN_0024.sql uit in Supabase.' },
  fout: { titel: 'Koppelen mislukt', tekst: 'Er ging iets mis. Probeer het opnieuw.' }
};

export function KoppelMelding({ code }: { code: string | null }) {
  if (!code) return null;
  const m = TEKST[code] ?? TEKST.fout;
  return (
    <div className={`db-melding bs-koppelmelding${m.goed ? ' is-goed' : ' db-melding-fout'}`} role="status">
      <p className="db-melding-titel">{m.titel}</p>
      <p className="db-melding-tekst">{m.tekst}</p>
    </div>
  );
}
