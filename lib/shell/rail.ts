import { actieveModules } from '@/lib/modules';
import { icoonSvg } from './iconen';

// De navigatierail van de backoffice, als data én als HTML-string.
//   - React (components/shell/Rail.tsx) rendert RAIL_ITEMS + accountGegevens met
//     dezelfde classes en iconen.
//   - De social-module is een statisch HTML-document; app/social/route.ts zet daar
//     railHtml('social', ...) direct na <body> in.
// Stijl: public/shell/shell.css (prefix sl-), gedrag: public/shell/shell.js.

export const LOGO_SRC = '/brand/beeldmerk-licht.png';

export type RailItem = { id: string; label: string; href: string; icoon: string; document: boolean };

export function railItems(): RailItem[] {
  return actieveModules().map((m) => ({
    id: m.id,
    label: m.kort,
    href: m.href,
    icoon: icoonSvg(m.icoon),
    document: Boolean(m.document)
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
  /** Eigenaar: ziet ook "Beveiliging & audit" in het accountmenu. */
  eigenaar?: boolean;
}

/** Kleur van de avatar als CSS-variabelen (alleen een geldige #rrggbb-kleur). */
export function avatarStijl(kleur: string): string {
  return /^#[0-9a-f]{6}$/i.test(kleur) ? `--sl-avatar-kleur:${kleur.toLowerCase()};--sl-avatar-tekst:#232323` : '';
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** De rail als HTML. Moet exact dezelfde structuur en classes hebben als Rail.tsx. */
export function railHtml(actief: string, acc: RailAccount): string {
  const items = railItems()
    .map(
      (it) =>
        `<li><a class="sl-rail-item" href="${esc(it.href)}"${it.id === actief ? ' aria-current="page"' : ''}>` +
        `${it.icoon}<span class="sl-rail-label">${esc(it.label)}</span></a></li>`
    )
    .join('');
  const stijl = avatarStijl(acc.kleur);
  return (
    `<nav class="sl-rail" aria-label="Hoofdmenu" data-gebruiker="${esc(acc.id)}">` +
    `<a class="sl-rail-logo" href="/" title="Studio Levant — Dashboard" aria-label="Naar het dashboard">` +
    `<img src="${LOGO_SRC}" alt="" width="36" height="37"></a>` +
    `<ul class="sl-rail-nav">${items}</ul>` +
    `<div class="sl-rail-foot"><details class="sl-account">` +
    `<summary class="sl-account-knop" title="${esc(acc.naam)} · ${esc(acc.email)}" aria-label="Account">` +
    `<span class="sl-avatar"${stijl ? ` style="${esc(stijl)}"` : ''}>${esc(acc.initialen)}</span>` +
    `<span class="sl-account-label">Account</span></summary>` +
    `<div class="sl-account-pop">` +
    `<p class="sl-account-naam">${esc(acc.naam)}</p>` +
    `<p class="sl-account-mail">${esc(acc.email)}</p>` +
    `<a class="sl-account-link" href="/account">Account &amp; mail</a>` +
    (acc.eigenaar ? `<a class="sl-account-link" href="/gebruikers">Gebruikers</a>` : '') +
    (acc.eigenaar ? `<a class="sl-account-link" href="/beveiliging">Beveiliging &amp; audit</a>` : '') +
    `<a class="sl-account-link" href="/agenda-koppelen">Agenda koppelen</a>` +
    `<a class="sl-account-link" href="/nieuw-wachtwoord">Wachtwoord wijzigen</a>` +
    `<form method="post" action="/auth/uitloggen"><button type="submit" class="sl-account-link">Uitloggen</button></form>` +
    `</div></details></div></nav>`
  );
}
