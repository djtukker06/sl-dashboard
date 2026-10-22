// Instellingen van de mailkoppeling (Namecheap Private Email). Alleen env-var-namen staan
// in de code; de waarden komen uit .env.local / Vercel. Zonder MAIL_USER + MAIL_PASSWORD
// is mail "nog niet gekoppeld" en tonen alle schermen een nette uitleg i.p.v. een fout.
//
//   MAIL_USER, MAIL_PASSWORD                verplicht
//   MAIL_IMAP_HOST (mail.privateemail.com), MAIL_IMAP_PORT (993, SSL)
//   MAIL_SMTP_HOST (mail.privateemail.com), MAIL_SMTP_PORT (465, SSL)
//   MAIL_FROM_NAME (Studio Levant), MAIL_HANDTEKENING (optioneel, "\n" = nieuwe regel)

const STANDAARD_HOST = 'mail.privateemail.com';

export interface MailConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  password: string;
  fromName: string;
  handtekening: string;
}

function poort(waarde: string | undefined, standaard: number): number {
  const n = Number(waarde);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : standaard;
}

export function mailConfig(): MailConfig | null {
  const user = process.env.MAIL_USER?.trim();
  const password = process.env.MAIL_PASSWORD;
  if (!user || !password) return null;
  return {
    imapHost: process.env.MAIL_IMAP_HOST?.trim() || STANDAARD_HOST,
    imapPort: poort(process.env.MAIL_IMAP_PORT, 993),
    smtpHost: process.env.MAIL_SMTP_HOST?.trim() || STANDAARD_HOST,
    smtpPort: poort(process.env.MAIL_SMTP_PORT, 465),
    user,
    password,
    fromName: process.env.MAIL_FROM_NAME?.trim() || 'Studio Levant',
    handtekening: (process.env.MAIL_HANDTEKENING || '').replace(/\\n/g, '\n').trim()
  };
}

export function mailGeconfigureerd(): boolean {
  return mailConfig() !== null;
}

/** Het gekoppelde adres (voor kopteksten); leeg als mail niet gekoppeld is. */
export function mailAccount(): string {
  return mailConfig()?.user ?? '';
}
