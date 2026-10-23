import type { MailFoutCode } from './types';

/** Fout met HTTP-status en code; de melding is Nederlands en bevat nooit inloggegevens. */
export class MailFout extends Error {
  status: number;
  code: MailFoutCode;
  constructor(status: number, code: MailFoutCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const NIET_GEKOPPELD = 'Je mailbox is nog niet gekoppeld. Koppel hem via Account & mail (/account).';

/**
 * Zet een fout van imapflow/nodemailer/het netwerk om naar een MailFout. Alleen de code en
 * een eigen Nederlandse tekst gaan naar de browser; de details naar de serverlog (zonder
 * wachtwoord: imapflow en nodemailer zetten dat niet in hun foutmeldingen).
 */
export function naarMailFout(e: unknown, context: 'imap' | 'smtp' = 'imap'): MailFout {
  if (e instanceof MailFout) return e;
  const err = (e && typeof e === 'object' ? e : {}) as {
    code?: unknown;
    authenticationFailed?: unknown;
    responseCode?: unknown;
    responseText?: unknown;
    message?: unknown;
  };
  const code = typeof err.code === 'string' ? err.code : '';
  const tekst = `${String(err.responseText ?? '')} ${String(err.message ?? '')}`.toLowerCase();

  const inlogFout =
    err.authenticationFailed === true ||
    code === 'EAUTH' ||
    err.responseCode === 535 ||
    /authenticationfailed|authentication failed|invalid credentials|login failed/.test(tekst);
  if (inlogFout) {
    return new MailFout(
      502,
      'inloggen_mislukt',
      'Inloggen bij de mailserver mislukt. Controleer het e-mailadres en wachtwoord (Account & mail).'
    );
  }

  const netwerk = [
    'ENOTFOUND',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    'CONNECT_TIMEOUT',
    'GREETING_TIMEOUT',
    'ETIMEOUT',
    'NoConnection',
    'EConnectionClosed',
    'ESOCKET',
    'ECONNECTION'
  ];
  if (netwerk.includes(code) || /timeout|timed out|socket/.test(tekst)) {
    return new MailFout(
      504,
      'onbereikbaar',
      context === 'smtp'
        ? 'De mailserver voor verzenden is nu niet bereikbaar. Probeer het zo opnieuw.'
        : 'De mailserver is nu niet bereikbaar. Probeer het zo opnieuw.'
    );
  }

  if (context === 'smtp') {
    // Bv. 550 (ontvanger geweigerd) of 552 (te groot).
    const rc = typeof err.responseCode === 'number' ? err.responseCode : 0;
    if (rc === 552) return new MailFout(413, 'te_groot', 'De mailserver weigert dit bericht: het is te groot.');
    if (rc >= 500 && rc < 600) {
      return new MailFout(
        502,
        'verzenden_mislukt',
        'De mailserver weigerde het bericht. Controleer de adressen en probeer het opnieuw.'
      );
    }
    return new MailFout(502, 'verzenden_mislukt', 'Verzenden is niet gelukt. Probeer het opnieuw.');
  }

  return new MailFout(502, 'onbereikbaar', 'De mailserver gaf een onverwachte fout. Probeer het opnieuw.');
}

// ---------------------------------------------------------------------------------
// Mailbox koppelen (welkomstflow, /mail, dashboard en /account): meldingen in gewone taal.
// Nooit een stacktrace, servernaam-dump of technische code in de tekst.
// ---------------------------------------------------------------------------------
export const KOPPEL_MELDING = {
  inloggen:
    'Het e-mailadres of wachtwoord klopt niet. Let op: dit is het wachtwoord van je mailbox, niet van het dashboard.',
  appWachtwoord: {
    gmail: 'Gmail vraagt hiervoor een app-wachtwoord (Google-account → Beveiliging → App-wachtwoorden).',
    icloud: 'iCloud vraagt hiervoor een app-specifiek wachtwoord (Apple ID → Inloggen en beveiliging → App-specifieke wachtwoorden).'
  },
  onbekend:
    'We herkennen je mailprovider niet. Vul hieronder de servergegevens in; die staan in de hulppagina van je provider.',
  microsoft: 'Outlook en Hotmail laten koppelen met alleen een wachtwoord niet meer toe. Gebruik je @studio-levant.nl-adres.',
  onbereikbaar: 'De mailserver reageert nu niet. Probeer het over een minuut opnieuw.',
  verzenden: 'Ontvangen lukt, versturen niet. Controleer of verzenden (SMTP) aan staat bij je provider.',
  teVaak: 'Te veel pogingen achter elkaar. Probeer het over 10 minuten opnieuw.'
} as const;

export type AppWachtwoordHint = keyof typeof KOPPEL_MELDING.appWachtwoord;

/**
 * Een fout tijdens het testen van een nieuwe koppeling als MailFout met een melding uit
 * KOPPEL_MELDING. fase 'smtp' = IMAP (ontvangen) lukte al, alleen verzenden niet.
 */
export function koppelFout(e: unknown, fase: 'imap' | 'smtp', hint: AppWachtwoordHint | null = null): MailFout {
  if (e instanceof MailFout && e.code !== 'inloggen_mislukt' && e.code !== 'onbereikbaar') return e;
  if (fase === 'smtp') return new MailFout(400, 'verzenden_mislukt', KOPPEL_MELDING.verzenden);
  const f = naarMailFout(e, 'imap');
  if (f.code === 'inloggen_mislukt') {
    const extra = hint ? ` ${KOPPEL_MELDING.appWachtwoord[hint]}` : '';
    return new MailFout(400, 'inloggen_mislukt', KOPPEL_MELDING.inloggen + extra);
  }
  return new MailFout(504, 'onbereikbaar', KOPPEL_MELDING.onbereikbaar);
}
