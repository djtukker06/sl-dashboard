import 'server-only';
import { lookup } from 'node:dns/promises';
import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import type { MailboxInvoer } from '@/lib/account/types';
import { koppelFout, MailFout, type AppWachtwoordHint } from './fout';
export { magProberen } from './pogingen';
import { isHostnaam, isPubliekAdres } from './netwerk';

// Een eigen mailbox koppelen (/account): eerst controleren dat de servers openbare
// internetadressen zijn (geen SSRF naar interne adressen), dan echt inloggen met IMAP en
// SMTP. Pas als beide lukken wordt het wachtwoord versleuteld opgeslagen (route).

/** Het (eerste) openbare IP-adres van een mailserver; gooit bij een intern of onbekend adres. */
async function openbaarAdres(host: string): Promise<string> {
  if (!isHostnaam(host)) throw new MailFout(400, 'ongeldig', `Ongeldige servernaam: ${host.slice(0, 80)}`);
  let adressen: { address: string }[];
  try {
    adressen = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new MailFout(400, 'onbereikbaar', `De server ${host} is niet gevonden. Controleer de naam.`);
  }
  if (!adressen.length || adressen.some((a) => !isPubliekAdres(a.address))) {
    throw new MailFout(400, 'ongeldig', `De server ${host} wijst naar een intern adres en is niet toegestaan.`);
  }
  return adressen[0].address;
}

/**
 * Logt echt in bij IMAP en SMTP, via het gecontroleerde IP-adres (met de hostnaam voor
 * TLS/SNI en de certificaatcontrole, zodat een tweede DNS-antwoord niets kan omleiden).
 * Gooit een MailFout met een Nederlandse melding.
 */
export async function testMailbox(m: MailboxInvoer, hint: AppWachtwoordHint | null = null): Promise<void> {
  const [imapIp, smtpIp] = await Promise.all([openbaarAdres(m.imapHost), openbaarAdres(m.smtpHost)]);

  const imap = new ImapFlow({
    host: imapIp,
    servername: m.imapHost,
    port: m.imapPort,
    secure: m.imapPort === 993,
    ...(m.imapPort === 993 ? {} : { doSTARTTLS: true }),
    auth: { user: m.email, pass: m.wachtwoord },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
    clientInfo: { name: 'Studio Levant backoffice' }
  });
  imap.on('error', () => {
    /* afgehandeld via connect() */
  });
  try {
    await imap.connect();
  } catch (e) {
    throw koppelFout(e, 'imap', hint);
  } finally {
    try {
      await imap.logout();
    } catch {
      imap.close();
    }
  }

  const smtp = createTransport({
    host: smtpIp,
    port: m.smtpPort,
    secure: m.smtpPort === 465,
    requireTLS: m.smtpPort !== 465,
    tls: { servername: m.smtpHost },
    auth: { user: m.email, pass: m.wachtwoord },
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000
  });
  try {
    await smtp.verify();
  } catch (e) {
    throw koppelFout(e, 'smtp', hint);
  } finally {
    smtp.close();
  }
}
