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

export const NIET_GEKOPPELD =
  'Mail is nog niet gekoppeld. Zet MAIL_USER en MAIL_PASSWORD in de omgevingsvariabelen (zie README).';

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
      'Inloggen bij de mailserver mislukt. Controleer MAIL_USER en MAIL_PASSWORD.'
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
