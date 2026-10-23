import 'server-only';
import { maakProfiel, type Teamlid, type TeamRijen } from '@/lib/auth/team';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import type { TeamProfiel } from './types';

// De profielen van het team, voor avatars en "aangemaakt door". Via de gebruikerscliënt
// (RLS: alleen teamleden zien profielen). Ook oud-teamleden (actief = false) komen mee, zodat
// "aangemaakt door" bij oude items een naam blijft tonen; kiezers tonen alleen actieve leden.
export async function teamProfielen(lid: Teamlid): Promise<TeamProfiel[]> {
  const eigen: TeamProfiel = { id: lid.userId, ...lid.profiel, actief: true };
  if (lid.overgang) return [eigen];

  // Normaal al opgehaald bij de teamcheck (lib/auth/team.ts): geen extra rondgang.
  let team = lid.team ?? null;
  if (!team) {
    const [profielen, leden] = await Promise.all([
      lid.sb.from('profiles').select('id, naam, initialen, kleur'),
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
    return { id: r.id, ...p, actief: actief.get(r.id) ?? false };
  });
  if (!lijst.some((p) => p.id === lid.userId)) lijst.push(eigen);
  return lijst.sort((a, b) => Number(b.actief) - Number(a.actief) || a.naam.localeCompare(b.naam, 'nl'));
}
