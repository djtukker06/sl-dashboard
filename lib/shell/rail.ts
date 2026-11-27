import { actieveModules } from '@/lib/modules';
import { icoonSvg } from './iconen';

// De navigatierail van de backoffice als data: components/shell/Rail.tsx rendert
// railItems() + het account van de ingelogde gebruiker. Alle modules (ook Social) zijn
// gewone pagina's in de shell.
// Stijl: public/shell/shell.css (prefix sl-), gedrag: public/shell/shell.js.

export const LOGO_SRC = '/brand/beeldmerk-licht.png';

/**
 * Telefoon (≤720px): de rail wordt een tabbalk onderaan met deze modules; de rest (en het
 * accountmenu) staat onder "Meer" (het accountmenu, dat dan als blad van onderen opent).
 * Vijf plus "Meer" = zes vakken: op 375px nog ruim 60px breed per vak.
 */
export const MOBIEL_HOOFD = ['dashboard', 'mail', 'agenda', 'klanten', 'boekhouding'];

export type RailItem = {
  id: string;
  label: string;
  href: string;
  icoon: string;
  /** Ook als tab in de mobiele tabbalk (anders onder "Meer"). */
  mobiel: boolean;
};

export function railItems(): RailItem[] {
  return actieveModules().map((m) => ({
    id: m.id,
    label: m.kort,
    href: m.href,
    icoon: icoonSvg(m.icoon),
    mobiel: MOBIEL_HOOFD.includes(m.id)
  }));
}

/** Wat de rail van de ingelogde gebruiker toont (uit het profiel, lib/auth/team.ts). */
export interface RailAccount {
  /** Auth user-id: alleen als sleutel voor de cache per gebruiker (data-gebruiker). */
  id: string;
  email: string;
  naam: string;
  initialen: string;
  kleur: string;
  /** Profielfoto-URL (lib/team/foto.ts), of null/leeg: de initialen. */
  foto?: string | null;
  /** Eigenaar: ziet ook "Beveiliging & audit" in het accountmenu. */
  eigenaar?: boolean;
}

/** Kleur van de avatar als CSS-variabelen (alleen een geldige #rrggbb-kleur). */
export function avatarStijl(kleur: string): string {
  return /^#[0-9a-f]{6}$/i.test(kleur) ? `--sl-avatar-kleur:${kleur.toLowerCase()};--sl-avatar-tekst:#232323` : '';
}
