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
};

export async function recentePosts(
  lid: Teamlid,
  max = 4
): Promise<{ ok: true; posts: RecentePost[]; totaal: number } | { ok: false; reden: 'niet-ingericht' | 'fout' }> {
  try {
    const lijst = await metTeamlid(lid, () => listProjects());
    return {
      ok: true,
      totaal: lijst.length,
      posts: lijst.slice(0, max).map((p) => {
        const f = getFormat(p.format);
        return {
          id: p.id,
          naam: p.name,
          formaat: f.label,
          breedte: f.w,
          hoogte: f.h,
          aantalSlides: p.slides.length,
          eersteSlide: p.slides[0] ?? null,
          gewijzigd: p.updatedAt
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
