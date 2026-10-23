import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { klantInfo, projectInfo } from './bestanden';
import { verbind } from './koppeling';
import { naAntwoord } from './kopieen';
import { hernoemKlantMap, werkProjectMapBij } from './mappen';

// Na het hernoemen van een klant of project (of een project bij een andere klant): de map in
// Drive meenemen. Ná het antwoord en best effort; alleen als de map al bestaat. Mislukt het
// (Drive weg), dan gebeurt het alsnog bij het volgende gebruik van de map (lib/drive/mappen.ts
// vergelijkt de naam en plek bij elk gebruik).

export function naKlantWijziging(lid: Teamlid, klantId: string): void {
  if (lid.overgang) return;
  const bewijs = lid.bewijs;
  naAntwoord('klantmap bijwerken', async () => {
    const v = await verbind(bewijs);
    const k = await klantInfo(v, klantId);
    if (k) await hernoemKlantMap(v, k);
  });
}

export function naProjectWijziging(lid: Teamlid, projectId: string): void {
  if (lid.overgang) return;
  const bewijs = lid.bewijs;
  naAntwoord('projectmap bijwerken', async () => {
    const v = await verbind(bewijs);
    const p = await projectInfo(v, projectId);
    if (p) await werkProjectMapBij(v, p);
  });
}
