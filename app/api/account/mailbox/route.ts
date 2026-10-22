import { NextResponse } from 'next/server';
import { teamlidRoute } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { mailboxStatus } from '@/lib/account/mailbox';
import { valideerMailbox } from '@/lib/account/types';
import { eigenMailboxRij } from '@/lib/mail/config';
import { MailFout } from '@/lib/mail/fout';
import { kluisBeschikbaar, ontsleutel, SLEUTEL_VERSIE, versleutel } from '@/lib/mail/kluis';
import { magProberen, testMailbox } from '@/lib/mail/koppelen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Je EIGEN mailbox (Account & mail). Elke handeling gaat alleen over het record van de
// ingelogde gebruiker (user_id = eigen sessie-id); het wachtwoord gaat er alleen in, nooit uit.
//   GET     → MailboxStatus (zonder wachtwoord)
//   POST    { email, wachtwoord?, imapHost, imapPort, smtpHost, smtpPort, fromName, handtekening }
//           → eerst echt inloggen (IMAP + SMTP), dan versleuteld opslaan → MailboxStatus
//           Leeg wachtwoord = het opgeslagen wachtwoord houden.
//   DELETE  → ontkoppelen → MailboxStatus

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: GEEN_CACHE });
const fout = (status: number, error: string, code?: string) => json(code ? { error, code } : { error }, status);

const NIET_INGERICHT =
  'Een eigen mailbox koppelen kan pas als de teambeveiliging actief is: voer in Supabase supabase/UITVOEREN_0021_TEAM.sql uit.';
const GEEN_SLEUTEL =
  'Koppelen staat uit: de server heeft nog geen MAIL_ENCRYPTION_KEY (zie README, "Mail per gebruiker").';

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
    const v = valideerMailbox(body);
    if (!v.ok) return fout(400, v.fout);
    const invoer = v.waarde;

    const { rij, ingericht } = await eigenMailboxRij(lid);
    if (!ingericht) return fout(409, NIET_INGERICHT, 'niet_ingericht');
    if (!invoer.wachtwoord) {
      // Wachtwoord leeg gelaten: het opgeslagen wachtwoord gebruiken (alleen voor hetzelfde adres).
      const bewaard = rij && rij.email === invoer.email ? ontsleutel(rij.wachtwoord_enc, lid.userId) : null;
      if (!bewaard) return fout(400, 'Vul je wachtwoord in.');
      invoer.wachtwoord = bewaard;
    }

    if (!magProberen(lid.userId)) {
      return fout(429, 'Te veel pogingen. Probeer het over tien minuten opnieuw.', 'te_vaak');
    }
    try {
      await testMailbox(invoer);
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
