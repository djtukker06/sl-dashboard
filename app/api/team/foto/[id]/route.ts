import { NextResponse } from 'next/server';
import { isUuid, teamlidRoute } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import { FOTO_BUCKET, fotoPadVan, fotoSoort, fotoVersie } from '@/lib/team/foto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/team/foto/[id]?v=<versie>  → de profielfoto van teamlid [id], voor elk teamlid.
// Of het profiel zichtbaar is, bepaalt RLS (gebruikerscliënt: alleen teamleden zien
// profielen); het bestand zelf komt met de service-role uit de privé-bucket. Met de juiste
// ?v= (het tijdstempel uit het pad, lib/team/foto.ts) mag de browser hem een jaar bewaren:
// een nieuwe foto krijgt een nieuwe URL.

type Ctx = { params: Promise<{ id: string }> };

const niets = () =>
  new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });

export const GET = teamlidRoute(
  async (request, ctx: Ctx, lid) => {
    const { id: ruw } = await ctx.params;
    if (!isUuid(ruw)) return niets();
    const id = ruw.toLowerCase();

    const { data, error } = await lid.sb.from('profiles').select('foto_pad').eq('id', id).maybeSingle();
    if (error) {
      // Vóór migratie 0039: nog geen foto's.
      if (!kolomOntbreekt(error)) console.error('[team/foto] profiel lezen mislukt', error.code ?? '', error.message);
      return niets();
    }
    const pad = (data as { foto_pad?: unknown } | null)?.foto_pad;
    if (!fotoPadVan(pad, id)) return niets();

    const service = createServiceRoleClient(lid.bewijs);
    const { data: blob, error: fout } = await service.storage.from(FOTO_BUCKET).download(pad);
    if (fout || !blob) return niets();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Het type uit de bytes zelf (zelfde controle als bij het uploaden).
    const soort = fotoSoort(bytes);
    if (!soort) return niets();

    const versie = new URL(request.url).searchParams.get('v');
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': soort,
        'Content-Length': String(bytes.length),
        'Cache-Control': versie && versie === fotoVersie(pad) ? 'private, max-age=31536000, immutable' : 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline'
      }
    });
  },
  { label: 'team/foto' }
);
