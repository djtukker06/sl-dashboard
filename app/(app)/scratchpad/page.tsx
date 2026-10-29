import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { isUuid } from '@/lib/notities/kern';
import { isScratchpadNietIngericht, notitieOphalen, notitiesLijst } from '@/lib/notities/repo';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { ScratchpadApp, type ScratchpadStart } from '@/components/notities/ScratchpadApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Scratchpad · Studio Levant' };

// Scratchpad: het kladblok van het team om te brainstormen en ideeën uit te schrijven
// (Notion-achtig). De pagina controleert zelf het lidmaatschap en laadt de eerste lijst (en
// de gevraagde notitie) op de server; daarna werkt de client via /api/notities (die elk ook
// zelf controleren). RLS: gedeelde notities + je eigen privé-notities.
//   ?n=<id>          opent die notitie
//   ?nieuw=1         maakt direct een nieuwe notitie (knop op het dashboard)
//   ?klant=<id>      alleen de notities van die klant; nieuwe notities hangen eraan
//   ?project=<id>    idem voor een project (en de klant ervan)
export default async function ScratchpadPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lid = await vereisTeamlidPagina('/scratchpad');
  const ruw = await searchParams;
  const sp: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(ruw)) sp[k] = Array.isArray(v) ? v[0] : v;

  const klantId = isUuid(sp.klant) ? sp.klant : null;
  const projectId = isUuid(sp.project) ? sp.project : null;
  const gevraagd = isUuid(sp.n) ? sp.n : null;

  let start: ScratchpadStart;
  try {
    const [lijst, notitie, context] = await Promise.all([
      notitiesLijst(lid.sb, { mijnId: lid.userId, klantId, projectId }),
      gevraagd ? notitieOphalen(lid.sb, gevraagd) : Promise.resolve(null),
      contextVan(lid.sb, klantId, projectId)
    ]);
    start = { lijst, notitie, nietGevonden: Boolean(gevraagd && !notitie), nieuw: sp.nieuw === '1', context };
  } catch (e) {
    if (!isScratchpadNietIngericht(e)) throw e;
    return (
      <>
        <ModuleKop label="Brainstormen · ideeën · losse gedachten" titel="Scratchpad" />
        <div className="sp-setup">
          <div className="db-melding db-melding-setup">
            <p className="db-melding-titel">Scratchpad nog niet ingericht</p>
            <p className="db-melding-tekst">
              Deze pagina werkt zodra migratie 0031 is uitgevoerd. Voer in Supabase (SQL Editor) <code>supabase/UITVOEREN_0031.sql</code> uit en ververs
              daarna deze pagina.
            </p>
          </div>
        </div>
      </>
    );
  }

  return <ScratchpadApp start={start} mijnId={lid.userId} />;
}

/** Naam van de klant of het project waarop de lijst is gefilterd (RLS: alleen wat het team ziet). */
async function contextVan(
  sb: Awaited<ReturnType<typeof vereisTeamlidPagina>>['sb'],
  klantId: string | null,
  projectId: string | null
): Promise<ScratchpadStart['context']> {
  const [k, p] = await Promise.all([
    klantId ? sb.from('clients').select('id, company_name').eq('id', klantId).maybeSingle() : Promise.resolve({ data: null }),
    projectId ? sb.from('projects').select('id, naam, client_id').eq('id', projectId).maybeSingle() : Promise.resolve({ data: null })
  ]);
  const klant = k.data as { id: string; company_name: string } | null;
  const project = p.data as { id: string; naam: string; client_id: string | null } | null;
  return {
    klant: klant ? { id: klant.id, naam: klant.company_name } : null,
    project: project ? { id: project.id, naam: project.naam, klantId: project.client_id } : null
  };
}
