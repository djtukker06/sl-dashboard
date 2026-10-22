import type { IcoonNaam } from '@/lib/shell/iconen';

// Module-register van de Studio Levant-backoffice. De navigatierail (React: components/
// shell/Rail.tsx, social: lib/shell/rail.ts → railHtml) en het dashboard lezen hun
// modules uitsluitend uit deze lijst, zodat alles één geheel blijft.
//
// Een nieuwe module toevoegen:
//   1. Voeg hieronder één entry toe aan MODULES (en zo nodig een icoon in lib/shell/iconen.ts).
//   2. Maak de pagina's in app/(app)/<module>/ — dan staan ze automatisch in de shell.
//   3. Eventueel API-routes in app/api/<module>/ (elke route controleert zelf de sessie).
//   4. Eventueel een migratie supabase/migrations/00NN_<module>.sql.
// Zet `actief: false` om een module tijdelijk uit de navigatie te halen.

export type Module = {
  id: string;
  /** Volledige naam, bv. in paginatitels. */
  naam: string;
  /** Kort label onder het icoon in de rail (max. ±9 tekens). */
  kort: string;
  beschrijving: string;
  href: string;
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
    beschrijving: 'Inbox van info@studio-levant.nl',
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
    id: 'facturen',
    naam: 'Facturen',
    kort: 'Facturen',
    beschrijving: 'Facturen, prijsopgaven en klanten',
    href: '/facturen',
    icoon: 'factuur',
    actief: true,
    snelactie: { label: 'Nieuwe factuur', href: '/facturen/nieuwe-factuur' }
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
  const hit = actieveModules().find((m) => m.href !== '/' && (pad === m.href || pad.startsWith(m.href + '/')));
  return hit ? hit.id : '';
}
