import { dbFout, fout, isUuid, json, leesJson, uitgavenRoute } from '@/lib/uitgaven/api';
import { MAX_BESTAND_BYTES, schoon, typeUitNaam } from '@/lib/uitgaven/model';
import { grootte, isPadVan, verwijder } from '@/lib/uitgaven/opslag';
import { heeftSoortKolom, kolomOntbreekt, moetUitgave } from '@/lib/uitgaven/repo';
import { naDrive } from '@/lib/drive/kopieen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// Stap 3 van een upload: het bestand staat al in Storage (via de signed upload-URL); nu
// wordt het aan de uitgave gekoppeld. Bestaat de uitgave nog niet (eerste bestand van een
// nieuwe upload), dan ontstaat hier het concept.
//
// POST /api/uitgaven/[id]/bestanden  { pad, naam } → { uitgave }
export const POST = uitgavenRoute(async (request, ctx: Ctx, sb, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze uitgave bestaat niet (meer).');
  const b = await leesJson(request);
  if (!isPadVan(id, b.pad)) return fout(400, 'Ongeldig bestand.');
  const pad = b.pad;
  const type = typeUitNaam(pad);
  if (!type) return fout(400, 'Ongeldig bestand.');

  const bytes = await grootte(pad);
  if (bytes === null) return fout(400, 'Het bestand is niet (volledig) geüpload. Probeer het opnieuw.');
  if (bytes > MAX_BESTAND_BYTES) {
    await verwijder([pad]);
    return fout(400, 'Dit bestand is te groot (max. 25 MB).');
  }

  // Concept aanmaken als het nog niet bestaat (twee gelijktijdige aanmeldingen: de tweede doet niets).
  // Soort alvast uit het bestand (PDF = inkoopfactuur, foto = bonnetje); aan te passen in het paneel.
  const basis: Record<string, unknown> = { id, source: 'upload', created_by: lid.userId };
  const soort = type === 'application/pdf' ? 'inkoopfactuur' : 'bonnetje';
  let nieuw = await sb
    .from('expenses')
    .upsert(heeftSoortKolom() ? { ...basis, soort } : basis, { onConflict: 'id', ignoreDuplicates: true });
  if (nieuw.error && kolomOntbreekt(nieuw.error)) {
    nieuw = await sb.from('expenses').upsert(basis, { onConflict: 'id', ignoreDuplicates: true });
  }
  if (nieuw.error) throw dbFout(nieuw.error);

  const { data: bestand, error } = await sb
    .from('expense_files')
    .insert({
      expense_id: id,
      storage_path: pad,
      file_name: schoon(b.naam, 200) || pad.split('/').pop(),
      mime_type: type,
      size_bytes: bytes
    })
    .select('id')
    .maybeSingle();
  if (error && error.code !== '23505') throw dbFout(error);
  // Kopie naar Google Drive (Boekhouding/Bonnetjes/<jaar>), ná het antwoord en best effort.
  naDrive(lid, 'bonnetje', (bestand as { id?: string } | null)?.id);

  const { uitgave } = await moetUitgave(sb, id);
  return json({ uitgave }, 201);
});
