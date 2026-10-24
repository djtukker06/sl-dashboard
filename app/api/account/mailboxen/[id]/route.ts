import { NextResponse } from 'next/server';
import { isUuid, teamlidRoute } from '@/lib/auth/team';
import { mailboxenOverzicht, ontkoppelMailbox, wijzigMailbox } from '@/lib/mail/beheer';
import { OUDE_MAILBOX_ID } from '@/lib/mail/zichtbaarheid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Eén EIGEN inbox (eigenaar_id = jij; die van een ander geeft 404).
//   PATCH   { label?, kleur?, zichtbaarheid?: 'prive' | 'team', fromName?, handtekening? }
//           → overzicht. Wachtwoord of servers wijzigen = opnieuw koppelen (POST /api/account/mailboxen).
//   DELETE  → ontkoppelen (record en versleuteld wachtwoord weg) → overzicht

type Ctx = { params: Promise<{ id: string }> };

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: GEEN_CACHE });
const fout = (status: number, error: string, code?: string) => json(code ? { error, code } : { error }, status);

export const PATCH = teamlidRoute(
  async (request, ctx: Ctx, lid) => {
    const { id } = await ctx.params;
    if (!isUuid(id)) return fout(404, 'Deze inbox bestaat niet (meer).', 'niet_gevonden');
    let body: Record<string, unknown> = {};
    try {
      const b = await request.json();
      if (b && typeof b === 'object' && !Array.isArray(b)) body = b as Record<string, unknown>;
    } catch {
      /* leeg */
    }
    const r = await wijzigMailbox(lid, id, body, request);
    if (!r.ok) return fout(r.status, r.error, r.code);
    return json(await mailboxenOverzicht(lid));
  },
  { label: 'account/mailboxen' }
);

export const DELETE = teamlidRoute(
  async (request, ctx: Ctx, lid) => {
    const { id } = await ctx.params;
    if (!isUuid(id) && id !== OUDE_MAILBOX_ID) return fout(404, 'Deze inbox bestaat niet (meer).', 'niet_gevonden');
    const r = await ontkoppelMailbox(lid, id, request);
    if (!r.ok) return fout(r.status, r.error, r.code);
    return json(await mailboxenOverzicht(lid));
  },
  { label: 'account/mailboxen' }
);
