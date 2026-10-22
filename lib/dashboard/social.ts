import { metTeamlid, type Teamlid } from '@/lib/auth/team';
import { HttpError } from '@/lib/social/http';
import { listProjects } from '@/lib/social/repo';
import { getFormat } from '@/lib/social/formats';

// Recente social-posts voor het dashboard. listProjects() gebruikt de service-role
// client: daarom vraagt deze functie het (gecontroleerde) teamlid van de pagina.

export type RecentePost = {
  id: string;
  naam: string;
  formaat: string;
  breedte: number;
  hoogte: number;
  aantalSlides: number;
  eersteSlide: string | null;
  gewijzigd: string;
  /** User-id van wie de post maakte (null bij oude posts of vóór migratie 0021). */
  door: string | null;
};

/** Wie maakte deze posts? Via de gebruikerscliënt (RLS: teamleden). Best effort. */
async function makers(lid: Teamlid, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length || lid.overgang) return new Map();
  const { data, error } = await lid.sb.from('social_projects').select('id, created_by').in('id', ids);
  if (error) {
    if (error.code !== '42703' && error.code !== 'PGRST204') console.error('[dashboard] makers van posts', error.code ?? '', error.message);
    return new Map();
  }
  return new Map((data ?? []).filter((r) => r.created_by).map((r) => [r.id as string, r.created_by as string]));
}

export async function recentePosts(
  lid: Teamlid,
  max = 4
): Promise<{ ok: true; posts: RecentePost[]; totaal: number } | { ok: false; reden: 'niet-ingericht' | 'fout' }> {
  try {
    const lijst = await metTeamlid(lid, () => listProjects());
    const eerste = lijst.slice(0, max);
    const door = await makers(lid, eerste.map((p) => p.id));
    return {
      ok: true,
      totaal: lijst.length,
      posts: eerste.map((p) => {
        const f = getFormat(p.format);
        return {
          id: p.id,
          naam: p.name,
          formaat: f.label,
          breedte: f.w,
          hoogte: f.h,
          aantalSlides: p.slides.length,
          eersteSlide: p.slides[0] ?? null,
          gewijzigd: p.updatedAt,
          door: door.get(p.id) ?? null
        };
      })
    };
  } catch (err) {
    // repo.dbFail zet ontbrekende tabellen om naar een 503 (zie lib/social/repo.ts).
    if (err instanceof HttpError && err.status === 503) return { ok: false, reden: 'niet-ingericht' };
    console.error(err);
    return { ok: false, reden: 'fout' };
  }
}
