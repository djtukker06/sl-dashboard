import type { IcoonNaam } from '@/lib/shell/iconen';

// Module-register van de Studio Levant-backoffice. De navigatierail (React: components/
// shell/Rail.tsx, social: lib/shell/rail.ts → railHtml) en het dashboard lezen hun
// modules uitsluitend uit deze lijst, zodat alles één geheel blijft.
//
// Een nieuwe module toevoegen:
//   1. Voeg hieronder één entry toe aan MODULES (en zo nodig een icoon in lib/shell/iconen.ts).
//   2. Maak de pagina's in app/(app)/<module>/ — dan staan ze automatisch in de shell.
//   3. Eventueel API-routes in app/api/<module>/ (elke route controleert zelf de sessie).
//   4. Eventueel een migratie supabase/migrations/00NN_<module>.sql (idempotent, met RLS),
//      opgenomen in scripts/genereer-sql-editor.mjs, en het API-pad in de 401-lijst van proxy.ts.
// Voorbeelden van complete modules: agenda (tabellen + API + paneel), mail (externe koppeling)
// en boekhouding (facturen + bonnetjes: Storage-uploads + Claude + export; zie README).
// Zet `actief: false` om een module tijdelijk uit de navigatie te halen.

export type Module = {
  id: string;
  /** Volledige naam, bv. in paginatitels. */
  naam: string;
  /** Kort label onder het icoon in de rail (max. ±9 tekens). */
  kort: string;
  beschrijving: string;
  href: string;
  /** Extra paden die bij deze module horen (actieve staat in de rail); standaard alleen href. */
  paden?: string[];
  icoon: IcoonNaam;
  actief: boolean;
  /**
   * true = geen React-route maar een los HTML-document (social): links ernaartoe zijn
   * gewone <a>'s met een volledige paginalading in plaats van client-side navigatie.
   */
  document?: boolean;
  /** Belangrijkste actie van de module, voor de snelle acties op het dashboard. */
  snelactie?: { label: string; href: string };
};

export const MODULES: Module[] = [
  {
    id: 'dashboard',
    naam: 'Dashboard',
    kort: 'Dashboard',
    beschrijving: 'Overzicht van vandaag',
    href: '/',
    icoon: 'dashboard',
    actief: true
  },
  {
    id: 'mail',
    naam: 'Mail',
    kort: 'Mail',
    beschrijving: 'Je eigen mailbox (te koppelen via Account & mail)',
    href: '/mail',
    icoon: 'mail',
    actief: true
  },
  {
    id: 'agenda',
    naam: 'Agenda & taken',
    kort: 'Agenda',
    beschrijving: 'Afspraken en taken in één agenda',
    href: '/agenda',
    icoon: 'agenda',
    actief: true
  },
  {
    // Eén tab voor klanten en projecten (simpel CRM/PM): /klanten en /projecten, met
    // bovenin een schakelaar Klanten | Projecten. Een project hangt aan een klant, dus
    // één tab houdt de rail rustig (6 items).
    id: 'klanten',
    naam: 'Klanten & projecten',
    kort: 'Klanten',
    beschrijving: 'Klanten (lead, actief, afgerond) met notities, en projecten met taken en voortgang',
    href: '/klanten',
    paden: ['/klanten', '/projecten'],
    icoon: 'klanten',
    actief: true
  },
  {
    // Eén tab voor de administratie: facturen (/facturen/**, ongewijzigd) en bonnetjes &
    // inkoopfacturen (/boekhouding/bonnetjes; /uitgaven stuurt daarheen door).
    id: 'boekhouding',
    naam: 'Boekhouding',
    kort: 'Boekhouding',
    beschrijving: 'Facturen, prijsopgaven en klanten · bonnetjes en inkoopfacturen',
    href: '/boekhouding',
    paden: ['/boekhouding', '/facturen', '/uitgaven'],
    icoon: 'factuur',
    actief: true,
    // Op het dashboard is dit een knop die direct de bestandskiezer opent
    // (components/uitgaven/BonnetjeKnop.tsx); deze link is de terugval.
    snelactie: { label: 'Bonnetje uploaden', href: '/boekhouding/bonnetjes?toevoegen=1' }
  },
  {
    id: 'social',
    naam: 'Social media',
    kort: 'Social',
    beschrijving: 'Posts en carrousels genereren in de huisstijl',
    href: '/social',
    icoon: 'social',
    actief: true,
    document: true,
    // #nieuw opent direct de dialoog "Nieuwe post" (public/shell/shell.js).
    snelactie: { label: 'Nieuwe post', href: '/social#nieuw' }
  }
];

export function actieveModules(): Module[] {
  return MODULES.filter((m) => m.actief);
}

/** Welke module hoort bij dit pad (voor de actieve staat in de rail). */
export function moduleVoorPad(pad: string): string {
  if (pad === '/' || pad === '') return 'dashboard';
  const hoort = (basis: string) => basis !== '/' && (pad === basis || pad.startsWith(basis + '/'));
  const hit = actieveModules().find((m) => (m.paden ?? [m.href]).some(hoort) || hoort(m.href));
  return hit ? hit.id : '';
}
