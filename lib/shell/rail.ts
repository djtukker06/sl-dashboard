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

const GENERIEK = new Set(['info', 'hallo', 'hello', 'contact', 'admin', 'mail', 'studio', 'office', 'team']);

/** Naam voor de begroeting en initialen: user_metadata.naam/name, anders het deel vóór de @. */
export function accountGegevens(email: string | undefined | null, metadata?: Record<string, unknown> | null) {
  const meta = metadata || {};
  const uitMeta = [meta.naam, meta.name, meta.full_name].find((v) => typeof v === 'string' && v.trim()) as
    | string
    | undefined;
  const lokaal = String(email || '').split('@')[0] || '';
  const voornaam = uitMeta
    ? uitMeta.trim().split(/\s+/)[0]
    : GENERIEK.has(lokaal.toLowerCase()) || !lokaal
      ? ''
      : lokaal.charAt(0).toUpperCase() + lokaal.slice(1).split(/[._-]/)[0];
  const initialen = uitMeta
    ? uitMeta
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : (lokaal.charAt(0) || 'S').toUpperCase();
  return { email: String(email || ''), voornaam, initialen };
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** De rail als HTML. Moet exact dezelfde structuur en classes hebben als Rail.tsx. */
export function railHtml(actief: string, email: string, metadata?: Record<string, unknown> | null): string {
  const acc = accountGegevens(email, metadata);
  const items = railItems()
    .map(
      (it) =>
        `<li><a class="sl-rail-item" href="${esc(it.href)}"${it.id === actief ? ' aria-current="page"' : ''}>` +
        `${it.icoon}<span class="sl-rail-label">${esc(it.label)}</span></a></li>`
    )
    .join('');
  return (
    `<nav class="sl-rail" aria-label="Hoofdmenu">` +
    `<a class="sl-rail-logo" href="/" title="Studio Levant — Dashboard" aria-label="Naar het dashboard">` +
    `<img src="${LOGO_SRC}" alt="" width="36" height="37"></a>` +
    `<ul class="sl-rail-nav">${items}</ul>` +
    `<div class="sl-rail-foot"><details class="sl-account">` +
    `<summary class="sl-account-knop" title="${esc(acc.email)}" aria-label="Account">` +
    `<span class="sl-avatar">${esc(acc.initialen)}</span><span class="sl-account-label">Account</span></summary>` +
    `<div class="sl-account-pop">` +
    `<p class="sl-account-mail">${esc(acc.email)}</p>` +
    `<a class="sl-account-link" href="/nieuw-wachtwoord">Wachtwoord wijzigen</a>` +
    `<form method="post" action="/auth/uitloggen"><button type="submit" class="sl-account-link">Uitloggen</button></form>` +
    `</div></details></div></nav>`
  );
}
