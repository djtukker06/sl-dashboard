import { ImapFlow } from 'imapflow';
import type { MailConfig } from './config';
import { MailFout, naarMailFout, NIET_GEKOPPELD } from './fout';

// Eén IMAP-sessie per request: openen, werk doen, altijd netjes uitloggen. Geen IDLE en
// geen verbindingen die blijven openstaan — dat past bij serverless (Vercel).

export async function metImap<T>(cfg: MailConfig | null, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (!cfg) throw new MailFout(503, 'niet_gekoppeld', NIET_GEKOPPELD);

  const client = new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: cfg.imapPort === 993,
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
    console.error('[mail] imap', (err as { code?: string })?.code ?? err);
  });

  try {
    await client.connect();
  } catch (e) {
    console.error('[mail] verbinden mislukt', (e as { code?: string })?.code ?? '', (e as Error)?.message ?? '');
    throw naarMailFout(e);
  }

  try {
    return await fn(client);
  } catch (e) {
    if (!(e instanceof MailFout)) {
      console.error('[mail] imap-opdracht mislukt', (e as { code?: string })?.code ?? '', (e as Error)?.message ?? '');
    }
    throw naarMailFout(e);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}
