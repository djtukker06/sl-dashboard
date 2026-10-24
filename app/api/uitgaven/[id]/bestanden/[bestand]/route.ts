import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dbFout, fout, isUuid, json, uitgavenRoute } from '@/lib/uitgaven/api';
import { bekijkUrl, verwijder } from '@/lib/uitgaven/opslag';
import { moetUitgave } from '@/lib/uitgaven/repo';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; bestand: string }> };

async function zoekBestand(
  sb: SupabaseClient,
  id: string,
  bestand: string
): Promise<{ storage_path: string; file_name: string } | null> {
  if (!isUuid(id) || !isUuid(bestand)) return null;
  const { data, error } = await sb
    .from('expense_files')
    .select('storage_path,file_name')
    .eq('id', bestand)
    .eq('expense_id', id)
    .maybeSingle();
  if (error) throw dbFout(error);
  return data as { storage_path: string; file_name: string } | null;
}

// GET /api/uitgaven/[id]/bestanden/[bestand]            → 302 naar een signed URL van 5 min (bekijken)
// GET /api/uitgaven/[id]/bestanden/[bestand]?download=1 → idem, als download onder de originele naam
// Zo kunnen <img> en <iframe> het bestand tonen zonder dat het ooit publiek is.
export const GET = uitgavenRoute(async (request, ctx: Ctx, sb) => {
  const { id, bestand } = await ctx.params;
  const rij = await zoekBestand(sb, id, bestand);
  if (!rij) return fout(404, 'Dit bestand bestaat niet (meer).');
  const download = new URL(request.url).searchParams.get('download') === '1';
  const url = await bekijkUrl(rij.storage_path, download ? { download: rij.file_name || 'bonnetje' } : {});
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
});

// DELETE /api/uitgaven/[id]/bestanden/[bestand] → { uitgave }
export const DELETE = uitgavenRoute(async (request, ctx: Ctx, sb, lid) => {
  const { id, bestand } = await ctx.params;
  const rij = await zoekBestand(sb, id, bestand);
  if (!rij) return fout(404, 'Dit bestand bestaat niet (meer).');
  const { error } = await sb.from('expense_files').delete().eq('id', bestand).eq('expense_id', id);
  if (error) throw dbFout(error);
  await verwijder([rij.storage_path]);
  await logAudit('verwijderd_bonnetje', { lid, doel: `${id}/${bestand}` }, request);
  const { uitgave } = await moetUitgave(sb, id);
  return json({ uitgave });
});
