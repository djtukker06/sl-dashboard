import { NextResponse } from 'next/server';
import { teamlidRoute } from '@/lib/auth/team';
import { koppelMailbox, mailboxenOverzicht, zetVolgorde } from '@/lib/mail/beheer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Je inboxen (Account & mail). Alleen je EIGEN inboxen zijn te wijzigen; inboxen die een
// ander met het team deelt staan er alleen-lezen bij. Nooit wachtwoorden in een antwoord.
//   GET    → MailboxenOverzicht { opslag, sleutel, max, eigen, gedeeld, standaard }
//   POST   { email, wachtwoord, label?, kleur?, zichtbaarheid?: 'prive' | 'team' } (+ evt.
//          servers, fromName, handtekening): koppelen met één knop — servers uit het adres,
//          eerst echt inloggen, dan versleuteld opslaan → { id, overzicht }
//   PATCH  { volgorde: [id, …] } → nieuwe volgorde van je eigen inboxen → overzicht

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: GEEN_CACHE });
const fout = (status: number, error: string, code?: string) => json(code ? { error, code } : { error }, status);

async function leesBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const GET = teamlidRoute(async (_request, _ctx, lid) => json(await mailboxenOverzicht(lid)), { label: 'account/mailboxen' });

export const POST = teamlidRoute(
  async (request, _ctx, lid) => {
    const r = await koppelMailbox(lid, await leesBody(request), request);
    if (!r.ok) return fout(r.status, r.error, r.code);
    return json({ id: r.waarde.id, email: r.waarde.email, overzicht: await mailboxenOverzicht(lid) });
  },
  { label: 'account/mailboxen' }
);

export const PATCH = teamlidRoute(
  async (request, _ctx, lid) => {
    const body = await leesBody(request);
    const r = await zetVolgorde(lid, body.volgorde);
    if (!r.ok) return fout(r.status, r.error, r.code);
    return json(await mailboxenOverzicht(lid));
  },
  { label: 'account/mailboxen' }
);
