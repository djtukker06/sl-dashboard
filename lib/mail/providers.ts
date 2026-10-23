// Mailbox koppelen met één knop: uit het e-mailadres de IMAP- en SMTP-servers afleiden,
// zodat een teamlid alleen zijn adres en wachtwoord hoeft in te vullen.
//   1. vaste lijst (Studio Levant = Namecheap Private Email, Gmail, iCloud, Microsoft);
//   2. onbekend domein: MX-record opzoeken; eindigt die op privateemail.com, dan Private Email;
//   3. anders onbekend: de gebruiker vult zelf de servers in.
// De MX-uitkomst kiest alleen tussen VASTE hostnamen hieronder; hij wordt nooit zelf als
// server gebruikt (geen SSRF-route). Zonder imports: de browser (hint bij Gmail/Outlook),
// de server (met de MX-zoeker uit lib/mail/mx.ts) en scripts/test-account.mjs gebruiken dit.

export interface ServerInstellingen {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export type ProviderUitkomst =
  | ({ soort: 'bekend'; provider: 'privateemail' | 'gmail' | 'icloud'; appWachtwoord: boolean } & ServerInstellingen)
  /** Outlook/Hotmail/Live: inloggen met alleen een wachtwoord kan daar niet meer. */
  | { soort: 'microsoft' }
  | { soort: 'onbekend' };

const PRIVATE_EMAIL: ServerInstellingen = {
  imapHost: 'mail.privateemail.com',
  imapPort: 993,
  smtpHost: 'mail.privateemail.com',
  smtpPort: 465
};
const GMAIL: ServerInstellingen = { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 };
const ICLOUD: ServerInstellingen = { imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587 };

const VAST: Record<string, ProviderUitkomst> = {
  'studio-levant.nl': { soort: 'bekend', provider: 'privateemail', appWachtwoord: false, ...PRIVATE_EMAIL },
  'gmail.com': { soort: 'bekend', provider: 'gmail', appWachtwoord: true, ...GMAIL },
  'googlemail.com': { soort: 'bekend', provider: 'gmail', appWachtwoord: true, ...GMAIL },
  'icloud.com': { soort: 'bekend', provider: 'icloud', appWachtwoord: true, ...ICLOUD },
  'me.com': { soort: 'bekend', provider: 'icloud', appWachtwoord: true, ...ICLOUD },
  'mac.com': { soort: 'bekend', provider: 'icloud', appWachtwoord: true, ...ICLOUD }
};

const MICROSOFT = /^(outlook|hotmail|live|msn)\.[a-z.]{2,10}$/;

/** Het domein van een e-mailadres (kleine letters), of '' bij een ongeldig adres. */
export function domeinVan(email: string): string {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1).trim().toLowerCase() : '';
}

/** Alleen de vaste lijst (zonder netwerk). */
export function vasteInstellingen(email: string): ProviderUitkomst {
  const domein = domeinVan(email);
  if (!domein) return { soort: 'onbekend' };
  if (VAST[domein]) return VAST[domein];
  if (MICROSOFT.test(domein)) return { soort: 'microsoft' };
  return { soort: 'onbekend' };
}

/** Uit MX-hostnamen: Private Email als één ervan op privateemail.com eindigt. */
export function uitMx(mxHosts: string[]): ProviderUitkomst {
  const privateEmail = mxHosts.some((h) => /(^|\.)privateemail\.com\.?$/i.test(h.trim()));
  return privateEmail ? { soort: 'bekend', provider: 'privateemail', appWachtwoord: false, ...PRIVATE_EMAIL } : { soort: 'onbekend' };
}

export type MxZoeker = (domein: string) => Promise<string[]>;

/** De serverinstellingen voor een e-mailadres: vaste lijst, anders via het MX-record. */
export async function instellingenVoor(email: string, mx: MxZoeker): Promise<ProviderUitkomst> {
  const vast = vasteInstellingen(email);
  if (vast.soort !== 'onbekend') return vast;
  const domein = domeinVan(email);
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domein)) return { soort: 'onbekend' };
  return uitMx(await mx(domein));
}
