import { dagenTussen, inAmsterdam, plusDagen, type Dag } from './datum';
import type { Afspraak, Taak } from './types';

// Rekenwerk voor de weergave (week, maand, tijdlijn op het dashboard). Puur, zonder React.

export const STANDAARD_TAAKDUUR = 30;

/** Dagen die een afspraak raakt (Amsterdamse tijd). */
export function dagenVanAfspraak(a: Afspraak): { eerste: Dag; laatste: Dag } {
  const s = inAmsterdam(a.start);
  const e = inAmsterdam(a.eind);
  // Eindigt om precies 00:00 → de vorige dag is de laatste (geldt ook voor hele dagen).
  const laatste = e.minuten === 0 ? plusDagen(e.dag, -1) : e.dag;
  return { eerste: s.dag, laatste: dagenTussen(s.dag, laatste) < 0 ? s.dag : laatste };
}

export function afspraakRaakt(a: Afspraak, dag: Dag): boolean {
  const { eerste, laatste } = dagenVanAfspraak(a);
  return dagenTussen(eerste, dag) >= 0 && dagenTussen(dag, laatste) >= 0;
}

/** Afspraak die als balk bovenaan hoort (hele dag, of 24 uur of langer). */
export function isBalk(a: Afspraak): boolean {
  return a.heleDag || Date.parse(a.eind) - Date.parse(a.start) >= 86_400_000;
}

/** Deel van een getimede afspraak op één dag, in minuten sinds 00:00 (eind max 1440). */
export function segmentOpDag(a: Afspraak, dag: Dag): { start: number; eind: number } | null {
  if (!afspraakRaakt(a, dag)) return null;
  const s = inAmsterdam(a.start);
  const e = inAmsterdam(a.eind);
  const start = s.dag === dag ? s.minuten : 0;
  const eind = e.dag === dag ? e.minuten : 1440;
  if (eind <= start) return { start, eind: Math.min(1440, start + 15) };
  return { start, eind };
}

export function taakSegment(t: Taak): { start: number; eind: number } | null {
  if (!t.tijd) return null;
  const [u, m] = t.tijd.split(':').map(Number);
  const start = u * 60 + m;
  return { start, eind: Math.min(1440, start + (t.duur ?? STANDAARD_TAAKDUUR)) };
}

export type Blok =
  | { soort: 'afspraak'; id: string; start: number; eind: number; item: Afspraak }
  | { soort: 'taak'; id: string; start: number; eind: number; item: Taak };

/** Getimede blokken van één dag. */
export function blokkenOpDag(dag: Dag, taken: Taak[], afspraken: Afspraak[]): Blok[] {
  const uit: Blok[] = [];
  for (const a of afspraken) {
    if (isBalk(a)) continue;
    const seg = segmentOpDag(a, dag);
    if (seg) uit.push({ soort: 'afspraak', id: a.id, ...seg, item: a });
  }
  for (const t of taken) {
    if (t.datum !== dag) continue;
    const seg = taakSegment(t);
    if (seg) uit.push({ soort: 'taak', id: t.id, ...seg, item: t });
  }
  return uit.sort((a, b) => a.start - b.start || b.eind - a.eind);
}

/** Naast elkaar zetten van overlappende blokken: per blok kolom en aantal kolommen. */
export function indelen(blokken: Blok[]): Map<string, { kolom: number; kolommen: number }> {
  const uit = new Map<string, { kolom: number; kolommen: number }>();
  let groep: { b: Blok; kolom: number }[] = [];
  let groepEind = -1;
  const sluit = () => {
    const n = Math.max(1, ...groep.map((g) => g.kolom + 1));
    for (const g of groep) uit.set(`${g.b.soort}:${g.b.id}`, { kolom: g.kolom, kolommen: n });
    groep = [];
  };
  for (const b of blokken) {
    const eind = Math.max(b.eind, b.start + 20); // korte blokken krijgen visueel ruimte
    if (groep.length && b.start >= groepEind) sluit();
    const bezet = new Set(groep.filter((g) => Math.max(g.b.eind, g.b.start + 20) > b.start).map((g) => g.kolom));
    let k = 0;
    while (bezet.has(k)) k++;
    groep.push({ b, kolom: k });
    groepEind = Math.max(groepEind, eind);
  }
  if (groep.length) sluit();
  return uit;
}

/** Tekst voor een tijdvak: "10:00–11:30". */
export function tijdvak(a: Afspraak): string {
  if (a.heleDag) return 'Hele dag';
  const s = inAmsterdam(a.start);
  const e = inAmsterdam(a.eind);
  return `${s.tijd}–${e.tijd}${s.dag !== e.dag && !(e.minuten === 0 && dagenTussen(s.dag, e.dag) === 1) ? ' (+1)' : ''}`;
}

/** Items per dag voor de maand (afspraken eerst, op begintijd; dan open/afgeronde taken). */
export function itemsOpDag(
  dag: Dag,
  taken: Taak[],
  afspraken: Afspraak[]
): ({ soort: 'afspraak'; item: Afspraak } | { soort: 'taak'; item: Taak })[] {
  const a = afspraken
    .filter((x) => afspraakRaakt(x, dag))
    .sort((x, y) => Number(isBalk(y)) - Number(isBalk(x)) || x.start.localeCompare(y.start))
    .map((item) => ({ soort: 'afspraak' as const, item }));
  const t = taken
    .filter((x) => x.datum === dag)
    .sort((x, y) => Number(x.afgerond) - Number(y.afgerond) || (x.tijd ?? '').localeCompare(y.tijd ?? ''))
    .map((item) => ({ soort: 'taak' as const, item }));
  return [...a, ...t];
}
