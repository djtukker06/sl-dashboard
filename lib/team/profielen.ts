import 'server-only';
import { maakProfiel, type Teamlid, type TeamRijen } from '@/lib/auth/team';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { fotoUrl } from './foto';
import type { TeamProfiel } from './types';

// De profielen van het team, voor avatars en "aangemaakt door". Via de gebruikerscliënt
// (RLS: alleen teamleden zien profielen). Ook oud-teamleden (actief = false) komen mee, zodat
// "aangemaakt door" bij oude items een naam blijft tonen; kiezers tonen alleen actieve leden.
export async function teamProfielen(lid: Teamlid): Promise<TeamProfiel[]> {
  const eigen: TeamProfiel = { id: lid.userId, ...lid.profiel, actief: true, foto: eigenFoto(lid) };
  if (lid.overgang) return [eigen];

  // Normaal al opgehaald bij de teamcheck (lib/auth/team.ts): geen extra rondgang.
  let team = lid.team ?? null;
  if (!team) {
    const [profielen, leden] = await Promise.all([
      // select('*'): zonder kolom foto_pad (0039 nog niet uitgevoerd) geen fout.
      lid.sb.from('profiles').select('*'),
      lid.sb.from('team_members').select('user_id, actief')
    ]);
    if (profielen.error || leden.error) {
      const fout = profielen.error ?? leden.error;
      if (!tabelOntbreekt(fout)) console.error('[team] profielen ophalen mislukt', fout?.code ?? '', fout?.message);
      return [eigen];
    }
    team = {
      profielen: (profielen.data ?? []) as TeamRijen['profielen'],
      leden: (leden.data ?? []) as TeamRijen['leden']
    };
  }

  const actief = new Map(team.leden.map((r) => [r.user_id, r.actief === true]));
  const lijst = team.profielen.map((r) => {
    const p = maakProfiel(r, '');
    return { id: r.id, ...p, actief: actief.get(r.id) ?? false, foto: fotoUrl(r.id, fotoPadUit(r)) };
  });
  if (!lijst.some((p) => p.id === lid.userId)) lijst.push(eigen);
  return lijst.sort((a, b) => Number(b.actief) - Number(a.actief) || a.naam.localeCompare(b.naam, 'nl'));
}

// foto_pad komt mee met select('*') (lib/auth/team.ts) zodra migratie 0039 is uitgevoerd;
// daarvóór ontbreekt de kolom en is er gewoon geen foto.
function fotoPadUit(rij: object | null | undefined): unknown {
  return rij && 'foto_pad' in rij ? (rij as { foto_pad?: unknown }).foto_pad : null;
}

/** De foto-URL van de ingelogde gebruiker (rail, account), zonder extra rondgang. */
export function eigenFoto(lid: Teamlid): string | null {
  const rij = lid.team?.profielen.find((p) => p.id === lid.userId);
  return fotoUrl(lid.userId, fotoPadUit(rij));
}
