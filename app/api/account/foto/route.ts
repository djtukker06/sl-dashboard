import { NextResponse } from 'next/server';
import { teamlidRoute, type Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { bucketOntbreekt, kolomOntbreekt } from '@/lib/db/ontbreekt';
import { FOTO_BUCKET, FOTO_MAX_BYTES, fotoPadVan, fotoUrl, nieuwFotoPad, valideerFoto } from '@/lib/team/foto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: GEEN_CACHE });
const NIET_INGERICHT = "Profielfoto's zijn er nog niet: voer migratie 0039 uit (supabase/UITVOEREN_0039.sql).";

// POST   /api/account/foto  multipart { foto }  → { foto: url }
// DELETE /api/account/foto                       → { foto: null }
// Alleen je eigen foto. De browser snijdt hem al bij tot een vierkant van max. 512×512
// (components/account/Profielfoto.tsx); de server controleert grootte en het echte formaat
// (de eerste bytes, niet de mime-kop). De bucket "profielfotos" is privé en heeft geen
// policies: lezen en schrijven gaat alleen via de service-role, ná de teamcheck hierboven.

/** Het huidige pad (via de gebruikerscliënt), of 'geen_kolom' vóór migratie 0039. */
async function huidigPad(lid: Teamlid): Promise<string | null | 'geen_kolom'> {
  const { data, error } = await lid.sb.from('profiles').select('foto_pad').eq('id', lid.userId).maybeSingle();
  if (error) {
    if (kolomOntbreekt(error)) return 'geen_kolom';
    throw error;
  }
  const pad = (data as { foto_pad?: unknown } | null)?.foto_pad;
  return typeof pad === 'string' ? pad : null;
}

export const POST = teamlidRoute(
  async (request, _ctx, lid) => {
    if (lid.overgang) return json({ error: 'Een profielfoto kan pas als de teambeveiliging actief is (migratie 0021).' }, 409);
    // Ruwe grens vóór het inlezen (multipart-overhead meegerekend).
    if (Number(request.headers.get('content-length') ?? 0) > FOTO_MAX_BYTES + 64 * 1024) {
      return json({ error: 'De foto is te groot (maximaal 2 MB).' }, 413);
    }
    const form = await request.formData().catch(() => null);
    const bestand = form?.get('foto');
    if (!bestand || typeof bestand === 'string') return json({ error: 'Kies een foto.' }, 400);
    if (bestand.size > FOTO_MAX_BYTES) return json({ error: 'De foto is te groot (maximaal 2 MB).' }, 413);
    const bytes = new Uint8Array(await bestand.arrayBuffer());
    const v = valideerFoto(bytes);
    if (!v.ok) return json({ error: v.fout }, 400);

    const oud = await huidigPad(lid);
    if (oud === 'geen_kolom') return json({ error: NIET_INGERICHT }, 503);

    const service = createServiceRoleClient(lid.bewijs);
    const pad = nieuwFotoPad(lid.userId, v.soort);
    const up = await service.storage.from(FOTO_BUCKET).upload(pad, bytes, { contentType: v.soort, upsert: false });
    if (up.error) {
      if (bucketOntbreekt(up.error)) return json({ error: NIET_INGERICHT }, 503);
      console.error('[account] foto uploaden mislukt', up.error.message);
      return json({ error: 'Uploaden is niet gelukt. Probeer het opnieuw.' }, 500);
    }

    // Alleen de eigen rij (eq op het id van de ingelogde gebruiker).
    const { data, error } = await service.from('profiles').update({ foto_pad: pad }).eq('id', lid.userId).select('id').maybeSingle();
    if (error || !data) {
      await service.storage.from(FOTO_BUCKET).remove([pad]);
      if (error && kolomOntbreekt(error)) return json({ error: NIET_INGERICHT }, 503);
      if (!data && !error) return json({ error: 'Je profiel is niet gevonden. Vraag de eigenaar je opnieuw toe te voegen.' }, 404);
      console.error('[account] foto opslaan mislukt', error?.code ?? '', error?.message);
      return json({ error: 'Opslaan is niet gelukt. Probeer het opnieuw.' }, 500);
    }

    // De vorige foto opruimen (best effort; alleen een pad in je eigen map).
    if (oud && oud !== pad && fotoPadVan(oud, lid.userId)) {
      const weg = await service.storage.from(FOTO_BUCKET).remove([oud]);
      if (weg.error) console.warn('[account] oude foto opruimen mislukt', weg.error.message);
    }
    return json({ foto: fotoUrl(lid.userId, pad) });
  },
  { label: 'account/foto' }
);

export const DELETE = teamlidRoute(
  async (_request, _ctx, lid) => {
    if (lid.overgang) return json({ foto: null });
    const oud = await huidigPad(lid);
    // Vóór 0039 is er nooit een foto geweest: niets te doen.
    if (oud === 'geen_kolom' || !oud) return json({ foto: null });

    const service = createServiceRoleClient(lid.bewijs);
    const { error } = await service.from('profiles').update({ foto_pad: null }).eq('id', lid.userId);
    if (error) {
      console.error('[account] foto verwijderen mislukt', error.code ?? '', error.message);
      return json({ error: 'Verwijderen is niet gelukt. Probeer het opnieuw.' }, 500);
    }
    if (fotoPadVan(oud, lid.userId)) {
      const weg = await service.storage.from(FOTO_BUCKET).remove([oud]);
      if (weg.error && !bucketOntbreekt(weg.error)) console.warn('[account] foto opruimen mislukt', weg.error.message);
    }
    return json({ foto: null });
  },
  { label: 'account/foto' }
);
