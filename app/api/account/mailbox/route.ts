import { NextResponse } from 'next/server';
import { teamlidRoute } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { mailboxStatus } from '@/lib/account/mailbox';
import { valideerMailbox } from '@/lib/account/types';
import { eigenMailboxRij } from '@/lib/mail/config';
import { KOPPEL_MELDING, MailFout, type AppWachtwoordHint } from '@/lib/mail/fout';
import { instellingenVoor, vasteInstellingen } from '@/lib/mail/providers';
import { zoekMx } from '@/lib/mail/mx';
import { kluisBeschikbaar, ontsleutel, SLEUTEL_VERSIE, versleutel } from '@/lib/mail/kluis';
import { magProberen, testMailbox } from '@/lib/mail/koppelen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Je EIGEN mailbox (Account & mail). Elke handeling gaat alleen over het record van de
// ingelogde gebruiker (user_id = eigen sessie-id); het wachtwoord gaat er alleen in, nooit uit.
//   GET     → MailboxStatus (zonder wachtwoord)
//   POST    { email, wachtwoord }  (koppelen met één knop: servers en poorten bepaalt de
//           server uit het adres, lib/mail/providers.ts; Outlook/onbekend → 400 met code)
//           of { email, wachtwoord?, imapHost, imapPort, smtpHost, smtpPort } (zelf ingevuld)
//           plus optioneel fromName en handtekening (weggelaten = bewaarde waarde, anders
//           afzendernaam = je profielnaam en geen handtekening)
//           → eerst echt inloggen (IMAP + SMTP), dan versleuteld opslaan → MailboxStatus
//           Leeg wachtwoord = het opgeslagen wachtwoord houden, ALLEEN als adres, servers en
//           poorten ongewijzigd zijn (anders 400 'wachtwoord_nodig').
//   DELETE  → ontkoppelen → MailboxStatus

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: GEEN_CACHE });
const fout = (status: number, error: string, code?: string) => json(code ? { error, code } : { error }, status);

const NIET_INGERICHT =
  'Een eigen mailbox koppelen kan pas als de teambeveiliging actief is: voer in Supabase supabase/UITVOEREN_0021_TEAM.sql uit.';
const GEEN_SLEUTEL =
  'Koppelen staat uit: de server heeft nog geen MAIL_ENCRYPTION_KEY (zie README, "Mail per gebruiker").';

/** Zelfde adres, servers en poorten als het opgeslagen record? (hosts zonder hoofdletters) */
function zelfdeVerbinding(
  rij: { email: string; imap_host: string; imap_port: number; smtp_host: string; smtp_port: number },
  invoer: { email: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }
): boolean {
  const gelijk = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();
  return (
    gelijk(rij.email, invoer.email) &&
    gelijk(rij.imap_host, invoer.imapHost) &&
    Number(rij.imap_port) === invoer.imapPort &&
    gelijk(rij.smtp_host, invoer.smtpHost) &&
    Number(rij.smtp_port) === invoer.smtpPort
  );
}

export const GET = teamlidRoute(async (_request, _ctx, lid) => json(await mailboxStatus(lid)), { label: 'account/mailbox' });

export const POST = teamlidRoute(
  async (request, _ctx, lid) => {
    if (lid.overgang) return fout(409, NIET_INGERICHT, 'niet_ingericht');
    if (!kluisBeschikbaar()) return fout(503, GEEN_SLEUTEL, 'geen_sleutel');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const v = valideerMailbox(o);
    if (!v.ok) return fout(400, v.fout);
    const invoer = v.waarde;

    // Servers zelf ingevuld, of (één knop) afleiden uit het adres.
    const gevuld = (x: unknown) => typeof x === 'string' && x.trim() !== '';
    const handmatig = gevuld(o.imapHost) || gevuld(o.smtpHost);
    const vast = vasteInstellingen(invoer.email);
    let hint: AppWachtwoordHint | null =
      vast.soort === 'bekend' && vast.appWachtwoord && vast.provider !== 'privateemail' ? vast.provider : null;
    if (!handmatig) {
      const p = await instellingenVoor(invoer.email, zoekMx);
      if (p.soort === 'microsoft') return fout(400, KOPPEL_MELDING.microsoft, 'provider_microsoft');
      if (p.soort === 'onbekend') return fout(400, KOPPEL_MELDING.onbekend, 'provider_onbekend');
      invoer.imapHost = p.imapHost;
      invoer.imapPort = p.imapPort;
      invoer.smtpHost = p.smtpHost;
      invoer.smtpPort = p.smtpPort;
      hint = p.appWachtwoord && p.provider !== 'privateemail' ? p.provider : null;
    }

    const { rij, ingericht } = await eigenMailboxRij(lid);
    if (!ingericht) return fout(409, NIET_INGERICHT, 'niet_ingericht');
    // Afzendernaam en handtekening: niet meegestuurd (welkomstflow, snelle koppeling) =
    // de bewaarde waarde houden; bij een nieuwe koppeling je profielnaam en geen handtekening.
    if (!('fromName' in o)) invoer.fromName = rij?.from_name || lid.profiel.naam;
    if (!('handtekening' in o)) invoer.handtekening = rij?.handtekening ?? '';
    if (!invoer.wachtwoord) {
      // Wachtwoord leeg gelaten: het opgeslagen wachtwoord alleen hergebruiken als de HELE
      // verbinding (adres, servers en poorten) gelijk blijft. Anders zou een gestolen sessie
      // het bewaarde wachtwoord naar een eigen server kunnen laten sturen.
      const zelfdeServer = rij !== null && zelfdeVerbinding(rij, invoer);
      const bewaard = rij && zelfdeServer ? ontsleutel(rij.wachtwoord_enc, lid.userId) : null;
      if (!bewaard) {
        return fout(
          400,
          rij && !zelfdeServer ? 'Je wijzigt de server of het adres: vul je wachtwoord opnieuw in.' : 'Vul je wachtwoord in.',
          'wachtwoord_nodig'
        );
      }
      invoer.wachtwoord = bewaard;
    }

    if (!magProberen(lid.userId)) {
      return fout(429, KOPPEL_MELDING.teVaak, 'te_vaak');
    }
    try {
      await testMailbox(invoer, hint);
    } catch (e) {
      if (e instanceof MailFout) return fout(e.status >= 500 ? 502 : e.status, e.message, e.code);
      throw e;
    }

    const { error } = await createServiceRoleClient(lid.bewijs)
      .from('user_mailboxes')
      .upsert(
        {
          user_id: lid.userId,
          email: invoer.email,
          imap_host: invoer.imapHost,
          imap_port: invoer.imapPort,
          smtp_host: invoer.smtpHost,
          smtp_port: invoer.smtpPort,
          from_name: invoer.fromName,
          handtekening: invoer.handtekening,
          wachtwoord_enc: versleutel(invoer.wachtwoord, lid.userId),
          sleutel_versie: SLEUTEL_VERSIE,
          geverifieerd_op: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      );
    if (error) {
      console.error('[account] mailbox opslaan mislukt', error.code ?? '', error.message);
      return fout(500, 'Opslaan is niet gelukt. Probeer het opnieuw.');
    }
    return json(await mailboxStatus(lid));
  },
  { label: 'account/mailbox' }
);

export const DELETE = teamlidRoute(
  async (_request, _ctx, lid) => {
    if (lid.overgang) return fout(409, NIET_INGERICHT, 'niet_ingericht');
    const { error } = await createServiceRoleClient(lid.bewijs).from('user_mailboxes').delete().eq('user_id', lid.userId);
    if (error) {
      console.error('[account] mailbox ontkoppelen mislukt', error.code ?? '', error.message);
      return fout(500, 'Ontkoppelen is niet gelukt. Probeer het opnieuw.');
    }
    return json(await mailboxStatus(lid));
  },
  { label: 'account/mailbox' }
);
