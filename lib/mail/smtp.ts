import { createTransport } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import addressparser from 'nodemailer/lib/addressparser';
import { mailConfig } from './config';
import { MailFout, naarMailFout, NIET_GEKOPPELD } from './fout';
import type { Adres } from './types';

// Verzenden via SMTP (465, SSL). Het bericht wordt eerst als ruwe MIME opgebouwd, zodat
// precies hetzelfde bericht daarna met IMAP APPEND in "Verzonden" kan (SMTP bewaart
// verzonden mail niet vanzelf).

const ADRES_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;
const MAX_ONTVANGERS = 50;

/** "Naam <a@b.nl>, c@d.nl; …" → nette lijst; ongeldig adres = MailFout met dat adres. */
export function parseAdressen(invoer: unknown, veld: string): Adres[] {
  if (invoer == null || invoer === '') return [];
  const tekst = Array.isArray(invoer) ? invoer.map(String).join(', ') : String(invoer);
  if (tekst.length > 5000) throw new MailFout(400, 'ongeldig', `Te veel adressen bij ${veld}.`);
  const uit: Adres[] = [];
  for (const a of addressparser(tekst.replace(/;/g, ','), { flatten: true })) {
    if (!('address' in a) || !a.address) {
      if (a.name?.trim()) throw new MailFout(400, 'ongeldig', `Ongeldig adres bij ${veld}: ${a.name.trim().slice(0, 80)}`);
      continue;
    }
    const adres = a.address.trim();
    if (!ADRES_RE.test(adres)) throw new MailFout(400, 'ongeldig', `Ongeldig adres bij ${veld}: ${adres.slice(0, 80)}`);
    uit.push({ naam: (a.name || '').trim().slice(0, 200), adres });
  }
  return uit;
}

export interface UitgaandeBijlage {
  naam: string;
  type: string;
  inhoud: Buffer;
}

export interface UitgaandBericht {
  aan: Adres[];
  cc: Adres[];
  bcc: Adres[];
  onderwerp: string;
  tekst: string;
  inReplyTo?: string | null;
  references?: string[];
  bijlagen: UitgaandeBijlage[];
}

const naarAdres = (a: Adres) => (a.naam ? { name: a.naam, address: a.adres } : a.adres);

/** Bouwt de ruwe MIME van het bericht. */
export async function bouwBericht(b: UitgaandBericht): Promise<{ raw: Buffer; envelope: { from: string; to: string[] }; messageId: string }> {
  const cfg = mailConfig();
  if (!cfg) throw new MailFout(503, 'niet_gekoppeld', NIET_GEKOPPELD);
  if (!b.aan.length && !b.cc.length && !b.bcc.length) throw new MailFout(400, 'ongeldig', 'Vul minstens één ontvanger in.');
  if (b.aan.length + b.cc.length + b.bcc.length > MAX_ONTVANGERS) {
    throw new MailFout(400, 'ongeldig', `Maximaal ${MAX_ONTVANGERS} ontvangers per bericht.`);
  }

  const composer = new MailComposer({
    from: { name: cfg.fromName, address: cfg.user },
    to: b.aan.map(naarAdres),
    cc: b.cc.length ? b.cc.map(naarAdres) : undefined,
    // Bcc staat wel in de envelop, maar niet in de kopregels van het bericht.
    bcc: b.bcc.length ? b.bcc.map(naarAdres) : undefined,
    subject: b.onderwerp,
    text: b.tekst,
    inReplyTo: b.inReplyTo || undefined,
    references: b.references?.length ? b.references : undefined,
    date: new Date(),
    attachments: b.bijlagen.map((x) => ({ filename: x.naam, content: x.inhoud, contentType: x.type || undefined }))
  });
  const node = composer.compile();
  // keepBcc staat uit: de Bcc-kop komt niet in de ruwe MIME (ook niet in Verzonden).
  const raw = await node.build();
  const env = node.getEnvelope();
  return {
    raw,
    envelope: { from: cfg.user, to: (env.to as string[]) ?? [] },
    messageId: node.messageId()
  };
}

/** Verstuurt een opgebouwd bericht via SMTP. */
export async function verstuur(raw: Buffer, envelope: { from: string; to: string[] }): Promise<void> {
  const cfg = mailConfig();
  if (!cfg) throw new MailFout(503, 'niet_gekoppeld', NIET_GEKOPPELD);
  const transport = createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    requireTLS: cfg.smtpPort !== 465,
    auth: { user: cfg.user, pass: cfg.password },
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 20_000
  });
  try {
    await transport.sendMail({ envelope, raw });
  } catch (e) {
    console.error('[mail] smtp', (e as { code?: string })?.code ?? '', (e as { responseCode?: number })?.responseCode ?? '');
    throw naarMailFout(e, 'smtp');
  } finally {
    transport.close();
  }
}
