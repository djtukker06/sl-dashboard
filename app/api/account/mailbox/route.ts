import { NextResponse } from 'next/server';
import { teamlidRoute } from '@/lib/auth/team';
import { mailboxStatus } from '@/lib/account/mailbox';
import { koppelMailbox, ontkoppelMailbox } from '@/lib/mail/beheer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Je EERSTE eigen inbox, voor de welkomstflow en de "koppel je inbox"-schermen (Mail,
// dashboard). Meerdere inboxen beheer je via /api/account/mailboxen. Elke handeling gaat
// alleen over de eigen records van de ingelogde gebruiker; het wachtwoord gaat er alleen in.
//   GET     → MailboxStatus (zonder wachtwoord)
//   POST    { email, wachtwoord } (koppelen met één knop: servers en poorten bepaalt de
//           server uit het adres, lib/mail/providers.ts; Outlook/onbekend → 400 met code)
//           of { email, wachtwoord?, imapHost, imapPort, smtpHost, smtpPort } (zelf ingevuld),
//           plus optioneel fromName en handtekening → eerst echt inloggen (IMAP + SMTP), dan
//           versleuteld opslaan (lib/mail/beheer.ts) → MailboxStatus. Een nieuw adres wordt
//           (na 0026) een extra inbox; hetzelfde adres werkt de bestaande bij. Leeg
//           wachtwoord = het opgeslagen houden, ALLEEN bij dezelfde verbinding.
//   DELETE  → je eerste eigen inbox ontkoppelen → MailboxStatus

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: GEEN_CACHE });
const fout = (status: number, error: string, code?: string) => json(code ? { error, code } : { error }, status);

export const GET = teamlidRoute(async (_request, _ctx, lid) => json(await mailboxStatus(lid)), { label: 'account/mailbox' });

export const POST = teamlidRoute(
  async (request, _ctx, lid) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const o = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    const r = await koppelMailbox(lid, o, request);
    if (!r.ok) return fout(r.status, r.error, r.code);
    return json(await mailboxStatus(lid));
  },
  { label: 'account/mailbox' }
);

export const DELETE = teamlidRoute(
  async (request, _ctx, lid) => {
    const s = await mailboxStatus(lid);
    if (!s.eigen) return json(s);
    const r = await ontkoppelMailbox(lid, s.eigen.id, request);
    if (!r.ok) return fout(r.status, r.error, r.code);
    return json(await mailboxStatus(lid));
  },
  { label: 'account/mailbox' }
);
