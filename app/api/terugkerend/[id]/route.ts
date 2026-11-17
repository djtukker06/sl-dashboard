import { NextResponse } from 'next/server';
import { controleerRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { vandaagNL } from '@/lib/invoice/nummer';
import { inhalen, parseTerugkerend, type Interval, type TerugkerendInvoer } from '@/lib/invoice/terugkerend-kern';
import { controleerMailbox, NA_0036, tabelOntbreekt, zonder0038 } from '@/lib/invoice/terugkerend-beheer';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import { upsertKlant } from '@/lib/invoice/opslag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const nietGevonden = () => NextResponse.json({ error: 'Deze terugkerende factuur bestaat niet (meer).' }, { status: 404 });

// PATCH /api/terugkerend/[id]  { actief }       → pauzeren of hervatten (bij hervatten schuift
//                                                  een datum in het verleden op naar de eerstvolgende)
//                              { …alle velden } → wijzigen (zelfde controle als aanmaken)
// DELETE /api/terugkerend/[id]                  → stopzetten en verwijderen; de facturen die hij
//                                                  maakte blijven gewoon bestaan.
export async function PATCH(request: Request, ctx: Ctx) {
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const lid = toegang.lid;
  const { id } = await ctx.params;
  if (!isUuid(id)) return nietGevonden();

  const service = createServiceRoleClient(lid.bewijs);
  const { data: oud, error } = await service
    .from('terugkerende_facturen')
    .select('volgende_datum, interval, dag, mailbox_id, eind_datum')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (tabelOntbreekt(error)) return NextResponse.json({ error: NA_0036, code: 'tabel_ontbreekt' }, { status: 503 });
    return NextResponse.json({ error: 'Ophalen mislukt.' }, { status: 500 });
  }
  if (!oud) return nietGevonden();
  const o = oud as { volgende_datum: string; interval: Interval; dag: number; mailbox_id: string; eind_datum: string | null };

  const body = ((await request.json().catch(() => null)) ?? {}) as TerugkerendInvoer;
  const vandaag = vandaagNL();
  let wijziging: Record<string, unknown>;

  if (Object.keys(body).length === 1 && typeof body.actief === 'boolean') {
    wijziging = { actief: body.actief };
    if (body.actief) {
      const volgende = inhalen(o.volgende_datum, o.interval, o.dag, vandaag);
      if (o.eind_datum && volgende > o.eind_datum) {
        return NextResponse.json({ error: 'De einddatum is al voorbij. Pas de einddatum aan om hem te hervatten.' }, { status: 400 });
      }
      wijziging.volgende_datum = volgende;
    }
  } else {
    const p = parseTerugkerend(body, { vandaag, huidigeDatum: o.volgende_datum });
    if (!p.ok) return NextResponse.json({ error: p.fout, veld: p.veld }, { status: 400 });
    // Een inbox die een collega koos en die jij niet ziet, mag blijven staan zolang je hem niet wijzigt.
    const s = p.waarde.sjabloon;
    if (s.mailbox_id !== o.mailbox_id || (s.versturen && !o.mailbox_id)) {
      const mailboxFout = await controleerMailbox(lid, s);
      if (mailboxFout) return NextResponse.json({ error: mailboxFout, veld: 'mailboxId' }, { status: 400 });
    }
    const klant = await upsertKlant(service, p.waarde.klant);
    if (!klant.ok) return NextResponse.json({ error: klant.fout }, { status: 500 });
    // Een gegeven akkoord geldt voor wat je toen zag: na een wijziging opnieuw vragen.
    wijziging = { ...s, client_id: klant.id, akkoord_periode: null, akkoord_door: null, akkoord_op: null };
  }

  const bijwerken = (w: Record<string, unknown>) =>
    service.from('terugkerende_facturen').update({ ...w, laatste_fout: null, gewijzigd_op: new Date().toISOString() }).eq('id', id);
  let { error: e2 } = await bijwerken(wijziging);
  if (e2 && kolomOntbreekt(e2)) ({ error: e2 } = await bijwerken(zonder0038(wijziging)));
  if (e2) {
    if (e2.code === '23503') return NextResponse.json({ error: 'Deze klant bestaat niet (meer).', veld: 'klantId' }, { status: 400 });
    console.error('[terugkerend] wijzigen mislukt', e2.code ?? '', e2.message);
    return NextResponse.json({ error: 'Opslaan mislukt.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const { id } = await ctx.params;
  if (!isUuid(id)) return nietGevonden();
  const service = createServiceRoleClient(toegang.lid.bewijs);
  const { data, error } = await service.from('terugkerende_facturen').delete().eq('id', id).select('id');
  if (error) {
    if (tabelOntbreekt(error)) return NextResponse.json({ error: NA_0036, code: 'tabel_ontbreekt' }, { status: 503 });
    return NextResponse.json({ error: 'Verwijderen mislukt.' }, { status: 500 });
  }
  if (!data?.length) return nietGevonden();
  return NextResponse.json({ ok: true });
}
