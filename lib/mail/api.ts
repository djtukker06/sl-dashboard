import { NextResponse } from 'next/server';
import { controleerRoute, metTeamlid, type Teamlid } from '@/lib/auth/team';
import type { MailConfig } from './config';
import { MailFout } from './fout';
import { eersteMailbox, zichtbareMailboxen, type Mailbox } from './mailboxen';

// Gedeelde stukken voor de mail-API-routes (/api/mail/**). Elke route:
//   1. controleert sessie + teamlidmaatschap (lib/auth/team.ts; 401/403);
//   2. bij ELK wijzigend verzoek (niet-GET): Origin moet de eigen site zijn (CSRF);
//   3. krijgt de gekozen inbox (?mb=<id>; zonder mb de eerste) uit de inboxen die DIT
//      teamlid mag zien (lib/mail/mailboxen.ts): eigen inboxen en inboxen die een actief
//      teamlid met het team deelt — nooit een privé-inbox van een ander (404);
//   4. geeft altijd Cache-Control: private, no-store (mail komt nooit in een gedeelde cache).

export const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, error: string, code?: string) {
  return json(code ? { error, code } : { error }, status);
}

/** Wat elke mail-handler meekrijgt: het teamlid, de gekozen inbox en alle zichtbare inboxen. */
export interface MailContext {
  lid: Teamlid;
  /** Verbinding van de gekozen inbox (null = niet gekoppeld of niet te ontsleutelen). */
  cfg: MailConfig | null;
  mailbox: Mailbox | null;
  mailboxen: Mailbox[];
}

export const MAILBOX_ONBEKEND = 'Deze inbox bestaat niet (meer) of je hebt er geen toegang toe.';

type Handler<C> = (request: Request, ctx: C, mail: MailContext) => Promise<Response>;

/** Wikkelt een mail-route: teamlidcontrole, herkomstcheck (elk niet-GET) en nette foutafhandeling. */
export function mailRoute<C>(fn: Handler<C>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const c = await controleerRoute(request);
    if ('antwoord' in c) return c.antwoord;
    try {
      const mb = new URL(request.url).searchParams.get('mb');
      const { lijst } = await zichtbareMailboxen(c.lid);
      const mailbox = mb ? (lijst.find((m) => m.id === mb) ?? null) : eersteMailbox(lijst);
      if (mb && !mailbox) return fout(404, MAILBOX_ONBEKEND, 'mailbox_onbekend');
      return await metTeamlid(c.lid, () => fn(request, ctx, { lid: c.lid, cfg: mailbox?.cfg ?? null, mailbox, mailboxen: lijst }));
    } catch (e) {
      if (e instanceof MailFout) return fout(e.status, e.message, e.code);
      console.error('[mail]', (e as Error)?.message ?? e);
      return fout(500, 'Er ging iets mis met de mail. Probeer het opnieuw.');
    }
  };
}

/** Wacht hooguit `ms` op een belofte (bv. één trage mailserver bij "alle inboxen"). */
export function metTijdslimiet<T>(belofte: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limiet = new Promise<never>((_, weiger) => {
    timer = setTimeout(() => weiger(new MailFout(504, 'onbereikbaar', 'De mailserver reageert nu niet.')), ms);
  });
  return Promise.race([belofte, limiet]).finally(() => clearTimeout(timer));
}

/** Nederlandse melding bij een fout van één inbox (nooit details of inloggegevens). */
export function inboxFoutTekst(e: unknown): string {
  if (e instanceof MailFout) return e.message;
  return 'Deze inbox is nu niet bereikbaar.';
}

/** Leest de JSON-body; ongeldige JSON geeft {}. */
export async function leesJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
