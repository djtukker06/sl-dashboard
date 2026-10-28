import { after } from 'next/server';
import { ImapFlow } from 'imapflow';
import type { MailConfig } from './config';
import { MailFout, naarMailFout, NIET_GEKOPPELD } from './fout';
import { openbaarAdres } from './dns';
import { logFout } from '@/lib/log';

// Eén IMAP-sessie per request: openen, werk doen, altijd netjes uitloggen. Geen IDLE en
// geen verbindingen die blijven openstaan — dat past bij serverless (Vercel). Het uitloggen
// gebeurt ná het antwoord (next/server `after`): de mailserver staat ver weg (VS) en op zijn
// bevestiging hoeft de gebruiker niet te wachten. Buiten een verzoek (scripts) gewoon meteen.

export async function metImap<T>(cfg: MailConfig | null, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (!cfg) throw new MailFout(503, 'niet_gekoppeld', NIET_GEKOPPELD);
  // Via het gecontroleerde openbare IP (geen DNS-rebinding naar interne adressen), met de
  // hostnaam voor TLS/SNI en de certificaatcontrole.
  const ip = await openbaarAdres(cfg.imapHost);

  const client = new ImapFlow({
    host: ip,
    servername: cfg.imapHost,
    port: cfg.imapPort,
    secure: cfg.imapPort === 993,
    // Poort 143: STARTTLS verplicht, zodat het wachtwoord nooit onversleuteld over de lijn gaat.
    ...(cfg.imapPort === 993 ? {} : { doSTARTTLS: true }),
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 20_000,
    clientInfo: { name: 'Studio Levant backoffice' }
  });
  // Zonder listener zou een socketfout na afloop als "unhandled error" het proces raken.
  client.on('error', (err: unknown) => {
    logFout('[mail] imap', err);
  });

  try {
    await client.connect();
  } catch (e) {
    logFout('[mail] verbinden mislukt', e);
    throw naarMailFout(e);
  }

  try {
    return await fn(client);
  } catch (e) {
    if (!(e instanceof MailFout)) {
      logFout('[mail] imap-opdracht mislukt', e);
    }
    throw naarMailFout(e);
  } finally {
    const afmelden = async () => {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    };
    try {
      after(afmelden);
    } catch {
      await afmelden();
    }
  }
}
