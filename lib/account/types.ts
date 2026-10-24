// Vormen en regels voor /account (profiel en eigen mailbox). Geen imports: de browser,
// de server en scripts/test-account.mjs gebruiken dit bestand alle drie.

/** Avatar-kleuren: zand- en aardetinten waarop de donkere initialen goed leesbaar zijn. */
export const KLEUREN = [
  { kleur: '#c8a97e', naam: 'Zand' },
  { kleur: '#e3dedb', naam: 'Kalk' },
  { kleur: '#d39a7a', naam: 'Terracotta' },
  { kleur: '#a9b38f', naam: 'Salie' },
  { kleur: '#a7b4bd', naam: 'Leisteen' },
  { kleur: '#c4a6b8', naam: 'Oudroze' }
] as const;

export interface ProfielInvoer {
  naam: string;
  initialen: string;
  kleur: string;
}

/** Controleert en normaliseert een profiel (zelfde regels als de tabel profiles). */
export function valideerProfiel(b: unknown): { ok: true; waarde: ProfielInvoer } | { ok: false; fout: string } {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const naam = typeof o.naam === 'string' ? o.naam.replace(/\s+/g, ' ').trim() : '';
  if (!naam) return { ok: false, fout: 'Vul je naam in.' };
  if (naam.length > 80) return { ok: false, fout: 'Je naam mag maximaal 80 tekens zijn.' };
  const initialen = typeof o.initialen === 'string' ? o.initialen.replace(/[\s.]/g, '').toUpperCase() : '';
  if (!/^\p{L}{1,3}$/u.test(initialen)) return { ok: false, fout: 'Initialen zijn 1 tot 3 letters.' };
  const kleur = typeof o.kleur === 'string' ? o.kleur.trim().toLowerCase() : '';
  if (!/^#[0-9a-f]{6}$/.test(kleur)) return { ok: false, fout: 'Kies een kleur.' };
  return { ok: true, waarde: { naam, initialen, kleur } };
}

/** Voorgestelde initialen uit een naam: "Daniel Tukker" → "DT". */
export function initialenUit(naam: string): string {
  const delen = naam.trim().split(/\s+/).filter(Boolean);
  return ((delen[0]?.[0] ?? '') + (delen.length > 1 ? delen[delen.length - 1][0] : '')).toUpperCase();
}

/**
 * Is de welkomstflow (/welkom) klaar? Alleen een bestaand profiel MET de kolom
 * welkom_klaar_op (migratie 0022) en waarde null betekent "nog niet". Zonder profiel of
 * zonder kolom nooit doorsturen, zodat niemand in een lus naar /welkom belandt.
 */
export function welkomKlaarVan(rij: { welkom_klaar_op?: string | null } | null | undefined): boolean {
  if (!rij || typeof rij !== 'object' || !('welkom_klaar_op' in rij)) return true;
  return rij.welkom_klaar_op !== null && rij.welkom_klaar_op !== undefined;
}

export const IMAP_POORTEN = [993, 143] as const;
export const SMTP_POORTEN = [465, 587] as const;
export const STANDAARD_MAILSERVER = 'mail.privateemail.com';

/** Wat /api/account/mailbox teruggeeft. Bevat NOOIT het wachtwoord. */
export interface MailboxStatus {
  /** Welke mailbox de app nu voor jou gebruikt. */
  bron: 'eigen' | 'standaard' | 'geen';
  /** Er kan een eigen inbox gekoppeld worden (migratie 0021 uitgevoerd). */
  ingericht: boolean;
  /** MAIL_ENCRYPTION_KEY staat (geldig) op de server. */
  sleutel: boolean;
  /** Het adres van de standaard-mailbox (alleen als die van jou is). */
  standaardAdres: string | null;
  eigen: null | {
    /** Id van de inbox (uuid; 'eigen' vóór migratie 0026). */
    id: string;
    email: string;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    fromName: string;
    handtekening: string;
    heeftWachtwoord: boolean;
    /** false = het wachtwoord kan niet meer ontsleuteld worden (andere sleutel): opnieuw invullen. */
    leesbaar: boolean;
    geverifieerdOp: string | null;
  };
}

export interface MailboxInvoer {
  email: string;
  wachtwoord: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  fromName: string;
  handtekening: string;
}

const ADRES = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Controleert de mailbox-invoer (zonder netwerk). Een leeg wachtwoord = het opgeslagen houden. */
export function valideerMailbox(b: unknown): { ok: true; waarde: MailboxInvoer } | { ok: false; fout: string } {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const tekst = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const email = tekst(o.email).toLowerCase();
  if (!ADRES.test(email) || email.length > 320) return { ok: false, fout: 'Vul een geldig e-mailadres in.' };
  const wachtwoord = typeof o.wachtwoord === 'string' ? o.wachtwoord : '';
  if (wachtwoord.length > 500) return { ok: false, fout: 'Het wachtwoord is te lang.' };
  const imapHost = (tekst(o.imapHost) || STANDAARD_MAILSERVER).toLowerCase();
  const smtpHost = (tekst(o.smtpHost) || STANDAARD_MAILSERVER).toLowerCase();
  if (!HOST.test(imapHost) || !HOST.test(smtpHost)) {
    return { ok: false, fout: 'Vul als server een hostnaam in, bv. mail.privateemail.com.' };
  }
  const imapPort = Number(o.imapPort ?? 993);
  const smtpPort = Number(o.smtpPort ?? 465);
  if (!(IMAP_POORTEN as readonly number[]).includes(imapPort)) return { ok: false, fout: 'IMAP-poort is 993 (SSL) of 143.' };
  if (!(SMTP_POORTEN as readonly number[]).includes(smtpPort)) return { ok: false, fout: 'SMTP-poort is 465 (SSL) of 587.' };
  const fromName = tekst(o.fromName).replace(/[\r\n]+/g, ' ');
  if (fromName.length > 120) return { ok: false, fout: 'De afzendernaam mag maximaal 120 tekens zijn.' };
  const handtekening = typeof o.handtekening === 'string' ? o.handtekening.replace(/\r\n/g, '\n').trim() : '';
  if (handtekening.length > 5000) return { ok: false, fout: 'De handtekening mag maximaal 5000 tekens zijn.' };
  return { ok: true, waarde: { email, wachtwoord, imapHost, imapPort, smtpHost, smtpPort, fromName, handtekening } };
}
