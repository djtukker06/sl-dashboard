import { isUuid, teamlidRoute } from '@/lib/auth/team';
import { bijlageAanmelden, bijlageKlaarzetten } from '@/lib/notities/bestanden';
import { isBijlagePadVan, MAX_BIJLAGE_BYTES, schoonBestandsnaam, schoonType } from '@/lib/notities/kern';
import { fout, foutAntwoord, json } from '@/lib/notities/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Foto's en bestanden in een notitie (migratie 0032), in twee stappen zoals bij bonnetjes:
//   POST { naam, type, grootte }       → { pad, signedUrl }  de browser PUT het bestand
//                                         rechtstreeks naar Storage (buiten Vercel om)
//   POST { pad, naam, type }           → { bijlage }         vastleggen bij de notitie
// Alleen voor een notitie die je mag zien (RLS); bij een privé-notitie dus alleen de maker.

type Ctx = { params: Promise<{ id: string }> };

export const POST = teamlidRoute(
  async (request, ctx: Ctx, lid) => {
    const { id } = await ctx.params;
    if (!isUuid(id)) return fout(404, 'Deze notitie bestaat niet (meer).', 'niet_gevonden');
    let b: Record<string, unknown>;
    try {
      const ruw = await request.json();
      if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) throw new Error();
      b = ruw as Record<string, unknown>;
    } catch {
      return fout(400, 'Ongeldige invoer.');
    }
    const naam = schoonBestandsnaam(b.naam);
    try {
      if (b.pad === undefined) {
        const grootte = Number(b.grootte);
        if (Number.isFinite(grootte) && grootte > MAX_BIJLAGE_BYTES) return fout(400, 'Dit bestand is te groot (max. 25 MB).');
        return json(await bijlageKlaarzetten(lid, id, naam));
      }
      if (!isBijlagePadVan(id, b.pad)) return fout(400, 'Ongeldig bestand.');
      const bijlage = await bijlageAanmelden(lid, id, { pad: b.pad, naam, type: schoonType(b.type) }, MAX_BIJLAGE_BYTES);
      return json({ bijlage }, 201);
    } catch (e) {
      return foutAntwoord(e);
    }
  },
  { label: 'notities' }
);
