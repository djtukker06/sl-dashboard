import 'server-only';
import { lookup } from 'node:dns/promises';
import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import type { MailboxInvoer } from '@/lib/account/types';
import { MailFout, naarMailFout } from './fout';
import { isHostnaam, isPubliekAdres } from './netwerk';

// Een eigen mailbox koppelen (/account): eerst controleren dat de servers openbare
// internetadressen zijn (geen SSRF naar interne adressen), dan echt inloggen met IMAP en
// SMTP. Pas als beide lukken wordt het wachtwoord versleuteld opgeslagen (route).

/** Max. 5 pogingen per 10 minuten per gebruiker (in het geheugen van deze serverinstantie). */
const POGINGEN = new Map<string, number[]>();
const VENSTER_MS = 10 * 60 * 1000;
const MAX_POGINGEN = 5;

export function magProberen(userId: string): boolean {
  const nu = Date.now();
  const recent = (POGINGEN.get(userId) ?? []).filter((t) => nu - t < VENSTER_MS);
  if (recent.length >= MAX_POGINGEN) {
    POGINGEN.set(userId, recent);
    return false;
  }
  recent.push(nu);
  POGINGEN.set(userId, recent);
  // Opruimen zodat de map niet groeit.
  if (POGINGEN.size > 200) for (const [k, v] of POGINGEN) if (!v.some((t) => nu - t < VENSTER_MS)) POGINGEN.delete(k);
  return true;
}

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
export async function testMailbox(m: MailboxInvoer): Promise<void> {
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
    const f = naarMailFout(e);
    if (f.code === 'inloggen_mislukt') {
      throw new MailFout(400, 'inloggen_mislukt', 'Inloggen (IMAP) mislukt: controleer je e-mailadres en wachtwoord.');
    }
    throw new MailFout(400, f.code, `De IMAP-server ${m.imapHost}:${m.imapPort} reageert niet. Controleer server en poort.`);
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
    const f = naarMailFout(e, 'smtp');
    if (f.code === 'inloggen_mislukt') {
      throw new MailFout(400, 'inloggen_mislukt', 'Inloggen (SMTP, verzenden) mislukt: controleer je e-mailadres en wachtwoord.');
    }
    throw new MailFout(400, 'onbereikbaar', `De SMTP-server ${m.smtpHost}:${m.smtpPort} reageert niet. Controleer server en poort.`);
  } finally {
    smtp.close();
  }
}
