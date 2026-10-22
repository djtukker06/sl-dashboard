import type { IcoonNaam } from '@/components/dashboard/ModuleIcoon';

// Module-register van het Studio Levant-dashboard. Het dashboard (app/page.tsx)
// rendert zijn tegels uitsluitend uit deze lijst.
//
// Een nieuwe module toevoegen:
//   1. Voeg hieronder één entry toe aan MODULES (en zo nodig een icoon in
//      components/dashboard/ModuleIcoon.tsx).
//   2. Maak de pagina's in een eigen map app/<module>/.
//   3. Eventueel API-routes in app/api/<module>/ (elke route controleert zelf de sessie).
//   4. Eventueel een migratie supabase/migrations/00NN_<module>.sql.
// Zet `actief: false` om een module tijdelijk van het dashboard te halen.

export type Module = {
  id: string;
  naam: string;
  beschrijving: string;
  href: string;
  icoon: IcoonNaam;
  actief: boolean;
};

export const MODULES: Module[] = [
  {
    id: 'facturen',
    naam: 'Facturen',
    beschrijving: 'Facturen, prijsopgaven en klanten',
    href: '/facturen',
    icoon: 'factuur',
    actief: true
  },
  {
    id: 'social',
    naam: 'Social media',
    beschrijving: 'Posts en carrousels genereren in de huisstijl',
    href: '/social',
    icoon: 'social',
    actief: true
  }
];

export function actieveModules(): Module[] {
  return MODULES.filter((m) => m.actief);
}
