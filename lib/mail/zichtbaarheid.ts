// Meerdere inboxen: wie ziet welke mailbox, de vorm die naar de browser gaat, en het
// samenvoegen van berichten uit meerdere inboxen. Zonder imports: de server, de browser en
// scripts/test-account.mjs gebruiken dit bestand alle drie.
//
// Regels:
//   - je ziet je EIGEN mailboxen (privé of gedeeld);
//   - een mailbox van een ander alleen als die op 'team' staat ÉN die eigenaar nog een
//     actief teamlid is (een gedeactiveerd lid neemt zijn gedeelde inboxen mee);
//   - naar de browser gaat nooit het (versleutelde) wachtwoord en nooit de servers.

export type Zichtbaarheid = 'prive' | 'team';

/** Max. aantal inboxen per teamlid. */
export const MAX_MAILBOXEN = 10;

/** Id van de virtuele mailbox uit de serverinstellingen (MAIL_USER, alleen voor Daniel). */
export const ENV_MAILBOX_ID = 'env';
/** Id van de enige eigen mailbox zolang migratie 0026 nog niet is uitgevoerd (user_mailboxes). */
export const OUDE_MAILBOX_ID = 'eigen';
/** De keuze "Alle inboxen" in Mail. */
export const ALLE_INBOXEN = 'alle';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Een geldig mailbox-id (uuid, 'env' of 'eigen')? Alles anders wordt geweigerd. */
export function isMailboxId(v: unknown): v is string {
  return typeof v === 'string' && (UUID.test(v) || v === ENV_MAILBOX_ID || v === OUDE_MAILBOX_ID);
}

/** Kleuren voor inboxen: goed te onderscheiden op de donkere achtergrond, in de huisstijl. */
export const MAILBOX_KLEUREN = [
  { kleur: '#c8a97e', naam: 'Zand' },
  { kleur: '#d39a7a', naam: 'Terracotta' },
  { kleur: '#a9b38f', naam: 'Salie' },
  { kleur: '#8fb0c9', naam: 'Blauw' },
  { kleur: '#c4a6b8', naam: 'Oudroze' },
  { kleur: '#e0c36a', naam: 'Oker' },
  { kleur: '#9fc2b4', naam: 'Mint' },
  { kleur: '#e3dedb', naam: 'Kalk' }
] as const;

/** De eerste kleur uit het palet die nog niet gebruikt wordt (anders rouleren). */
export function volgendeKleur(gebruikt: string[]): string {
  const bezet = new Set(gebruikt.map((k) => k.toLowerCase()));
  const vrij = MAILBOX_KLEUREN.find((k) => !bezet.has(k.kleur));
  return (vrij ?? MAILBOX_KLEUREN[gebruikt.length % MAILBOX_KLEUREN.length]).kleur;
}

/** Standaardlabel: het deel vóór de @, met een hoofdletter ("info@…" → "Info"). */
export function standaardLabel(email: string): string {
  const lokaal = (email.split('@')[0] || '').trim();
  if (!lokaal) return 'Inbox';
  return (lokaal.charAt(0).toUpperCase() + lokaal.slice(1)).slice(0, 40);
}

/** Ziet `viewerId` deze mailbox? `actief` = de user-id's van de actieve teamleden. */
export function isZichtbaar(
  rij: { eigenaar_id: string; zichtbaarheid: string },
  viewerId: string,
  actief: ReadonlySet<string>
): boolean {
  if (rij.eigenaar_id === viewerId) return true;
  return rij.zichtbaarheid === 'team' && actief.has(rij.eigenaar_id) && actief.has(viewerId);
}

export interface MailboxMeta {
  label?: string;
  kleur?: string;
  zichtbaarheid?: Zichtbaarheid;
  fromName?: string;
  handtekening?: string;
}

/**
 * Controleert de instellingen van een mailbox (label, kleur, zichtbaarheid, afzendernaam,
 * handtekening). Alleen meegestuurde velden komen in `waarde`; onbekende velden tellen niet.
 */
export function valideerMailboxMeta(b: unknown): { ok: true; waarde: MailboxMeta } | { ok: false; fout: string } {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const waarde: MailboxMeta = {};
  if ('label' in o && o.label !== undefined) {
    const label = typeof o.label === 'string' ? o.label.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!label) return { ok: false, fout: 'Geef de inbox een naam.' };
    if (label.length > 40) return { ok: false, fout: 'De naam van de inbox mag maximaal 40 tekens zijn.' };
    waarde.label = label;
  }
  if ('kleur' in o && o.kleur !== undefined) {
    const kleur = typeof o.kleur === 'string' ? o.kleur.trim().toLowerCase() : '';
    if (!/^#[0-9a-f]{6}$/.test(kleur)) return { ok: false, fout: 'Kies een kleur.' };
    waarde.kleur = kleur;
  }
  if ('zichtbaarheid' in o && o.zichtbaarheid !== undefined) {
    if (o.zichtbaarheid !== 'prive' && o.zichtbaarheid !== 'team') return { ok: false, fout: 'Kies "Alleen ik" of "Hele team".' };
    waarde.zichtbaarheid = o.zichtbaarheid;
  }
  if ('fromName' in o && o.fromName !== undefined) {
    const fromName = typeof o.fromName === 'string' ? o.fromName.replace(/[\r\n]+/g, ' ').trim() : '';
    if (fromName.length > 120) return { ok: false, fout: 'De afzendernaam mag maximaal 120 tekens zijn.' };
    waarde.fromName = fromName;
  }
  if ('handtekening' in o && o.handtekening !== undefined) {
    const handtekening = typeof o.handtekening === 'string' ? o.handtekening.replace(/\r\n/g, '\n').trim() : '';
    if (handtekening.length > 5000) return { ok: false, fout: 'De handtekening mag maximaal 5000 tekens zijn.' };
    waarde.handtekening = handtekening;
  }
  return { ok: true, waarde };
}

/** Wat de browser van een inbox te zien krijgt (Mail, opsteller, dashboard). */
export interface InboxDto {
  id: string;
  label: string;
  email: string;
  kleur: string;
  zichtbaarheid: Zichtbaarheid;
  /** Jouw eigen koppeling (anders: gedeeld door een ander teamlid). */
  vanMij: boolean;
  /** Naam van wie de inbox koppelde (voor "gedeeld door …"). */
  eigenaarNaam: string;
  /** De standaard-mailbox uit de serverinstellingen. */
  standaard: boolean;
  /** Afzendernaam en handtekening voor het opstellen. */
  fromName: string;
  handtekening: string;
  /** false = het wachtwoord kan niet (meer) worden gelezen: opnieuw koppelen. */
  leesbaar: boolean;
}

/** Alleen deze velden gaan naar de browser — nooit wachtwoord, versleuteld wachtwoord of servers. */
export function naarDto(m: InboxDto): InboxDto {
  return {
    id: m.id,
    label: m.label,
    email: m.email,
    kleur: m.kleur,
    zichtbaarheid: m.zichtbaarheid,
    vanMij: m.vanMij,
    eigenaarNaam: m.eigenaarNaam,
    standaard: m.standaard,
    fromName: m.fromName,
    handtekening: m.handtekening,
    leesbaar: m.leesbaar
  };
}

/** Volgorde in Mail: eerst je eigen inboxen (op volgorde), dan de standaard, dan gedeelde. */
export function sorteerInboxen<T extends { vanMij: boolean; standaard: boolean; volgorde: number; label: string; eigenaarNaam: string }>(
  lijst: T[]
): T[] {
  const groep = (m: T) => (m.vanMij && !m.standaard ? 0 : m.standaard ? 1 : 2);
  return [...lijst].sort(
    (a, b) =>
      groep(a) - groep(b) ||
      (groep(a) === 2 ? a.eigenaarNaam.localeCompare(b.eigenaarNaam, 'nl') : 0) ||
      a.volgorde - b.volgorde ||
      a.label.localeCompare(b.label, 'nl')
  );
}

const tijd = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Berichten uit meerdere inboxen samenvoegen: nieuwste eerst, elk bericht met het id van
 * zijn inbox (`mb`). Dubbele (zelfde inbox + uid) vallen weg. Optioneel max. `max` stuks.
 */
export function voegSamenOpDatum<E extends { uid: number; datum: string | null }>(
  delen: { mb: string; berichten: E[] }[],
  max?: number
): (E & { mb: string })[] {
  const gezien = new Set<string>();
  const alles: (E & { mb: string })[] = [];
  for (const { mb, berichten } of delen) {
    for (const e of berichten) {
      const k = `${mb}\n${e.uid}`;
      if (gezien.has(k)) continue;
      gezien.add(k);
      alles.push({ ...e, mb });
    }
  }
  alles.sort((a, b) => tijd(b.datum) - tijd(a.datum) || b.uid - a.uid);
  return max === undefined ? alles : alles.slice(0, max);
}

/** Nieuwe volgorde (lijst met id's) controleren: alleen bestaande eigen id's, elk één keer. */
export function valideerVolgorde(ids: unknown, eigen: string[]): string[] | null {
  if (!Array.isArray(ids) || ids.length !== eigen.length) return null;
  const set = new Set(eigen);
  const uniek = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || !set.has(id) || uniek.has(id)) return null;
    uniek.add(id);
  }
  return ids as string[];
}
