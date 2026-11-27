import type { InzichtCijfers, PostDto, PostInvoer, PostSoort, PostStatus } from './types';
import { amsterdamDatum, amsterdamNaarUtc, utcNaarAmsterdam } from './kern';

// Pure hulpjes voor de social-schermen (overzicht, kalender, editor, analytics). Zonder
// @/-imports en zonder DOM, zodat scripts/test-social-ui.mjs ze direct kan testen en zowel
// de server als de browser ze kan gebruiken. Alle datums als 'YYYY-MM-DD' in Europe/Amsterdam.

// ---------------------------------------------------------------------------------
// Filters en volgorde
// ---------------------------------------------------------------------------------

/** De statusfilters in het overzicht (bezig valt onder ingepland, deels onder beide eindstanden). */
export const FILTER_STATUSSEN: { waarde: 'concept' | 'ingepland' | 'geplaatst' | 'mislukt'; label: string }[] = [
  { waarde: 'concept', label: 'Concept' },
  { waarde: 'ingepland', label: 'Ingepland' },
  { waarde: 'geplaatst', label: 'Geplaatst' },
  { waarde: 'mislukt', label: 'Mislukt' }
];

/** Welke statussen in de database horen bij een filter. */
export function statussenVoorFilter(s: PostStatus): PostStatus[] {
  if (s === 'ingepland') return ['ingepland', 'bezig'];
  if (s === 'geplaatst') return ['geplaatst', 'deels'];
  if (s === 'mislukt') return ['mislukt', 'deels'];
  return [s];
}

/** Het moment dat bij een post hoort: geplaatst, anders gepland (null = concept zonder datum). */
export function postMoment(p: Pick<PostDto, 'geplaatst_op' | 'gepland_op'>): string | null {
  return p.geplaatst_op ?? p.gepland_op ?? null;
}

export interface LijstGroep {
  sleutel: 'gepland' | 'zonder' | 'eerder';
  titel: string;
  posts: PostDto[];
}

/**
 * De lijst in drie groepen: eerst wat nog komt (ingepland/bezig, en concepten met een datum
 * in de toekomst; oplopend), dan concepten zonder datum (nieuwste eerst), dan wat geplaatst,
 * mislukt of verlopen is (nieuwste eerst). Lege groepen vallen weg.
 */
export function groepeerVoorLijst(posts: PostDto[], nu: Date): LijstGroep[] {
  const t = (p: PostDto) => new Date(postMoment(p) ?? p.gewijzigd_op).getTime();
  const gepland: PostDto[] = [];
  const zonder: PostDto[] = [];
  const eerder: PostDto[] = [];
  for (const p of posts) {
    const m = postMoment(p);
    if (!m) zonder.push(p);
    else if (p.status === 'ingepland' || p.status === 'bezig' || (p.status === 'concept' && new Date(m).getTime() >= nu.getTime())) gepland.push(p);
    else eerder.push(p);
  }
  gepland.sort((a, b) => t(a) - t(b));
  zonder.sort((a, b) => new Date(b.gewijzigd_op).getTime() - new Date(a.gewijzigd_op).getTime());
  eerder.sort((a, b) => t(b) - t(a));
  const groepen: LijstGroep[] = [
    { sleutel: 'gepland', titel: 'Komt eraan', posts: gepland },
    { sleutel: 'zonder', titel: 'Concepten zonder datum', posts: zonder },
    { sleutel: 'eerder', titel: 'Geplaatst en eerder', posts: eerder }
  ];
  return groepen.filter((g) => g.posts.length);
}

/** Een korte versie van de caption voor een kaart (op een woordgrens, met …). */
export function kortCaption(tekst: string, max = 140): string {
  const s = String(tekst ?? '').replace(/\s+/g, ' ').trim();
  const tekens = [...s];
  if (tekens.length <= max) return s;
  const kort = tekens.slice(0, max).join('');
  const grens = kort.lastIndexOf(' ');
  return `${(grens > max * 0.6 ? kort.slice(0, grens) : kort).replace(/[\s.,;:!?-]+$/, '')}…`;
}

// ---------------------------------------------------------------------------------
// Datums: maanden, kalender, standaardmoment
// ---------------------------------------------------------------------------------

const twee = (n: number) => String(n).padStart(2, '0');
const isoDag = (d: Date) => `${d.getUTCFullYear()}-${twee(d.getUTCMonth() + 1)}-${twee(d.getUTCDate())}`;
const alsUtc = (datum: string) => {
  const [j, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d));
};

export function isMaand(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}
export function isDatum(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return isoDag(alsUtc(s)) === s;
}

/** De maand van een tijdstip in Amsterdam: 'YYYY-MM'. */
export function maandVan(t: Date | string): string {
  return amsterdamDatum(t).slice(0, 7);
}

/** Een maand verschuiven: verschuifMaand('2026-12', 1) → '2027-01'. */
export function verschuifMaand(maand: string, n: number): string {
  const [j, m] = maand.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${twee(d.getUTCMonth() + 1)}`;
}

/** Eerste en laatste dag van een maand (inclusief). */
export function maandBereik(maand: string): { van: string; tot: string } {
  const [j, m] = maand.split('-').map(Number);
  return { van: `${maand}-01`, tot: isoDag(new Date(Date.UTC(j, m, 0))) };
}

const MAAND_NAMEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
export const WEEKDAG_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
export const WEEKDAG_LANG = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

/** "november 2026" */
export function maandLabel(maand: string): string {
  const [j, m] = maand.split('-').map(Number);
  return `${MAAND_NAMEN[m - 1]} ${j}`;
}

/** Een datum n dagen verder (of terug). */
export function volgendeDag(datum: string, n = 1): string {
  const d = alsUtc(datum);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDag(d);
}

/** Dag van de week, maandag = 0 … zondag = 6. */
export function weekdagIndex(datum: string): number {
  return (alsUtc(datum).getUTCDay() + 6) % 7;
}

/**
 * De weken van de maandkalender (maandag eerst): elke week 7 datums, met de dagen van de
 * vorige/volgende maand aangevuld. 4 t/m 6 weken.
 */
export function maandRaster(maand: string): string[][] {
  const { van, tot } = maandBereik(maand);
  let dag = volgendeDag(van, -weekdagIndex(van));
  const weken: string[][] = [];
  while (weken.length < 6) {
    const week = Array.from({ length: 7 }, (_, i) => volgendeDag(dag, i));
    weken.push(week);
    dag = volgendeDag(dag, 7);
    if (dag > tot) break;
  }
  return weken;
}

/** Posts per kalenderdag (Amsterdam), op tijd gesorteerd. Posts zonder datum vallen weg. */
export function postsPerDag(posts: PostDto[]): Map<string, PostDto[]> {
  const uit = new Map<string, PostDto[]>();
  for (const p of posts) {
    const m = postMoment(p);
    if (!m) continue;
    const dag = amsterdamDatum(m);
    const lijst = uit.get(dag) ?? [];
    lijst.push(p);
    uit.set(dag, lijst);
  }
  for (const lijst of uit.values()) lijst.sort((a, b) => new Date(postMoment(a)!).getTime() - new Date(postMoment(b)!).getTime());
  return uit;
}

export const STANDAARD_TIJD = '19:30';

/**
 * Het moment dat de editor voorstelt: de gekozen dag (uit de kalender) of morgen, om 19:30.
 * Ligt een gekozen dag om 19:30 al in het verleden (vandaag, 's avonds laat), dan morgen.
 */
export function standaardMoment(nu: Date, dag?: string | null): { datum: string; tijd: string } {
  const vandaag = amsterdamDatum(nu);
  let datum = dag && isDatum(dag) && dag >= vandaag ? dag : volgendeDag(vandaag);
  const t = amsterdamNaarUtc(datum, STANDAARD_TIJD);
  if (t && t.getTime() <= nu.getTime()) datum = volgendeDag(datum);
  return { datum, tijd: STANDAARD_TIJD };
}

export interface Snelkeuze {
  label: string;
  datum: string;
  tijd: string;
}

/**
 * Snelkeuzes voor het tijdstip: vandaag 19:30 (als dat nog ruim kan), morgen 12:00 en
 * 19:30, en de eerstvolgende vrijdag 19:30 en zondag 10:00 (na morgen).
 */
export function snelkeuzes(nu: Date): Snelkeuze[] {
  const vandaag = amsterdamDatum(nu);
  const morgen = volgendeDag(vandaag);
  const uit: Snelkeuze[] = [];
  const vanavond = amsterdamNaarUtc(vandaag, '19:30');
  if (vanavond && vanavond.getTime() - nu.getTime() > 15 * 60_000) uit.push({ label: 'Vanavond 19:30', datum: vandaag, tijd: '19:30' });
  uit.push({ label: 'Morgen 12:00', datum: morgen, tijd: '12:00' });
  uit.push({ label: 'Morgen 19:30', datum: morgen, tijd: '19:30' });
  const eerstvolgende = (wd: number) => {
    let d = volgendeDag(morgen);
    while (weekdagIndex(d) !== wd) d = volgendeDag(d);
    return d;
  };
  uit.push({ label: `Vrijdag ${dagMaand(eerstvolgende(4))} 19:30`, datum: eerstvolgende(4), tijd: '19:30' });
  uit.push({ label: `Zondag ${dagMaand(eerstvolgende(6))} 10:00`, datum: eerstvolgende(6), tijd: '10:00' });
  return uit;
}

/** "26 nov" */
export function dagMaand(datum: string): string {
  const [, m, d] = datum.split('-').map(Number);
  return `${d} ${MAAND_NAMEN[m - 1].slice(0, 3)}`;
}

/** Tijd in Amsterdam ('HH:MM') van een tijdstip. */
export function tijdVan(t: string | Date): string {
  return utcNaarAmsterdam(t).tijd;
}

// ---------------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------------

/** Een element in een lijst verplaatsen (slepen of pijltjes). Buiten de lijst: ongewijzigd. */
export function verplaats<T>(lijst: T[], van: number, naar: number): T[] {
  if (van === naar || van < 0 || naar < 0 || van >= lijst.length || naar >= lijst.length) return lijst;
  const kopie = lijst.slice();
  const [x] = kopie.splice(van, 1);
  kopie.splice(naar, 0, x);
  return kopie;
}

const ggd = (a: number, b: number): number => (b ? ggd(b, a % b) : a);
const BEKENDE: [number, string][] = [
  [1, '1:1'],
  [4 / 5, '4:5'],
  [9 / 16, '9:16'],
  [16 / 9, '16:9'],
  [1.91, '1,91:1'],
  [3 / 4, '3:4'],
  [4 / 3, '4:3'],
  [2 / 3, '2:3'],
  [3 / 2, '3:2']
];

/** Beeldverhouding als tekst: 1080×1350 → "4:5"; onbekend → "". */
export function verhoudingLabel(breedte: number | null | undefined, hoogte: number | null | undefined): string {
  if (!breedte || !hoogte) return '';
  const v = breedte / hoogte;
  const bekend = BEKENDE.find(([x]) => Math.abs(x - v) < 0.015);
  if (bekend) return bekend[1];
  const g = ggd(breedte, hoogte);
  const [a, b] = [breedte / g, hoogte / g];
  return a <= 50 && b <= 50 ? `${a}:${b}` : `${(Math.round(v * 100) / 100).toString().replace('.', ',')}:1`;
}

/**
 * De beeldverhouding (breedte/hoogte) van het voorbeeld zoals Instagram hem toont: een reel
 * 9:16, een feedpost tussen 4:5 en 1,91:1 (eerste bestand bepaalt de carrousel), zonder
 * beeld vierkant.
 */
export function voorbeeldVerhouding(soort: PostSoort, eerste?: { breedte: number | null; hoogte: number | null } | null): number {
  if (soort === 'reel') return 9 / 16;
  if (!eerste?.breedte || !eerste?.hoogte) return 1;
  return Math.min(1.91, Math.max(0.8, eerste.breedte / eerste.hoogte));
}

/**
 * Voor PATCH: de bestaande post en de wijzigingen samen als één {@link PostInvoer}, zodat
 * `parsePost` het geheel controleert (bv. een nieuwe datum met de bestaande kanalen).
 */
export function samenvoegen(bestaand: PostDto, w: Partial<PostInvoer>): PostInvoer {
  const huidigeStatus: 'concept' | 'ingepland' = bestaand.status === 'ingepland' ? 'ingepland' : 'concept';
  const heeft = (k: keyof PostInvoer) => Object.prototype.hasOwnProperty.call(w, k) && w[k] !== undefined;
  return {
    status: heeft('status') ? w.status : huidigeStatus,
    soort: heeft('soort') ? (w.soort as PostSoort) : bestaand.soort,
    caption: heeft('caption') ? w.caption : bestaand.caption,
    eerste_reactie: heeft('eerste_reactie') ? w.eerste_reactie : bestaand.eerste_reactie,
    hashtags: heeft('hashtags') ? w.hashtags : bestaand.hashtags,
    hashtags_plek: heeft('hashtags_plek') ? w.hashtags_plek : bestaand.hashtags_plek,
    locatie_id: heeft('locatie_id') ? w.locatie_id : bestaand.locatie_id,
    locatie_naam: heeft('locatie_naam') ? w.locatie_naam : bestaand.locatie_naam,
    gebruikers_tags: heeft('gebruikers_tags') ? w.gebruikers_tags : bestaand.gebruikers_tags,
    collaborators: heeft('collaborators') ? w.collaborators : bestaand.collaborators,
    gepland_op: heeft('gepland_op') ? (w.gepland_op ?? null) : bestaand.gepland_op,
    notities: heeft('notities') ? w.notities : bestaand.notities,
    kanalen: heeft('kanalen') ? w.kanalen : bestaand.kanalen.map((k) => ({ account_id: k.account_id, caption_eigen: k.caption_eigen }))
  };
}

/** Wijzigt een PATCH alleen de notities? (Het enige wat bij een geplaatste post nog mag.) */
export function alleenNotities(w: Record<string, unknown>): boolean {
  return typeof w.notities === 'string' && Object.keys(w).every((k) => k === 'notities' || w[k] === undefined);
}

// ---------------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------------

export const PERIODES = [7, 30, 90] as const;
export type Periode = (typeof PERIODES)[number];

/** De laatste `dagen` dagen tot en met vandaag (Amsterdam). */
export function periodeBereik(dagen: number, nu: Date): { van: string; tot: string } {
  const tot = amsterdamDatum(nu);
  return { van: volgendeDag(tot, -(dagen - 1)), tot };
}

/** Interacties: likes + reacties + opslagen + gedeeld (of het veld `interacties` als dat er is). */
export function interacties(c: InzichtCijfers | null | undefined): number {
  if (!c) return 0;
  if (typeof c.interacties === 'number') return c.interacties;
  return (c.likes ?? 0) + (c.reacties ?? 0) + (c.opslagen ?? 0) + (c.gedeeld ?? 0);
}

/** Cijfers optellen (alleen getallen). */
export function optellen(lijst: (InzichtCijfers | null | undefined)[]): InzichtCijfers {
  const uit: InzichtCijfers = {};
  for (const c of lijst) {
    if (!c) continue;
    for (const [k, v] of Object.entries(c)) if (typeof v === 'number' && Number.isFinite(v)) uit[k] = (uit[k] ?? 0) + v;
  }
  return uit;
}

/** De beste posts: hoogste bereik (anders weergaven), bij gelijkspel meeste interacties. */
export function bestePosts<T extends { cijfers: InzichtCijfers }>(lijst: T[], n = 5): T[] {
  const score = (c: InzichtCijfers) => c.bereik ?? c.weergaven ?? 0;
  return lijst
    .slice()
    .sort((a, b) => score(b.cijfers) - score(a.cijfers) || interacties(b.cijfers) - interacties(a.cijfers))
    .slice(0, n);
}

export interface GroepCijfer {
  groep: string;
  aantal: number;
  /** Gemiddeld bereik per post. */
  bereik: number;
  /** Gemiddeld aantal interacties per post. */
  interacties: number;
}

/** Gemiddelden per groep (bv. per soort of per weekdag), in de volgorde van `groepen`. */
export function perGroep<T extends { cijfers: InzichtCijfers }>(lijst: T[], groepVan: (x: T) => string | null, groepen: string[]): GroepCijfer[] {
  const som = new Map<string, { aantal: number; bereik: number; interacties: number }>();
  for (const x of lijst) {
    const g = groepVan(x);
    if (g == null) continue;
    const s = som.get(g) ?? { aantal: 0, bereik: 0, interacties: 0 };
    s.aantal += 1;
    s.bereik += x.cijfers.bereik ?? x.cijfers.weergaven ?? 0;
    s.interacties += interacties(x.cijfers);
    som.set(g, s);
  }
  return groepen.map((groep) => {
    const s = som.get(groep);
    return s ? { groep, aantal: s.aantal, bereik: Math.round(s.bereik / s.aantal), interacties: Math.round(s.interacties / s.aantal) } : { groep, aantal: 0, bereik: 0, interacties: 0 };
  });
}

export const DAGDELEN = ['Ochtend', 'Middag', 'Avond', 'Nacht'] as const;

/** Dagdeel van een tijdstip in Amsterdam: ochtend 6–12, middag 12–17, avond 17–23, nacht. */
export function dagdeel(t: string | Date): (typeof DAGDELEN)[number] {
  const uur = Number(tijdVan(t).slice(0, 2));
  if (uur >= 6 && uur < 12) return 'Ochtend';
  if (uur >= 12 && uur < 17) return 'Middag';
  if (uur >= 17 && uur < 23) return 'Avond';
  return 'Nacht';
}

/** Weekdag (lang, maandag eerst) van een tijdstip in Amsterdam. */
export function weekdagVan(t: string | Date): string {
  return WEEKDAG_LANG[weekdagIndex(amsterdamDatum(t))];
}

/**
 * Het totaal aantal volgers per dag over alle accounts. Een account zonder cijfer op een dag
 * telt met zijn laatst bekende stand mee (geen dip in de lijn als één sync een dag mist).
 * Dagen vóór de eerste stand van een account tellen dat account niet mee.
 */
export function volgersReeks(accounts: { reeks: { datum: string; volgers: number | null }[] }[]): { datum: string; volgers: number }[] {
  const datums = [...new Set(accounts.flatMap((a) => a.reeks.filter((r) => r.volgers != null).map((r) => r.datum)))].sort();
  const per = accounts.map((a) => new Map(a.reeks.filter((r) => r.volgers != null).map((r) => [r.datum, r.volgers as number])));
  const laatste: (number | null)[] = accounts.map(() => null);
  return datums.map((datum) => {
    let totaal = 0;
    per.forEach((m, i) => {
      if (m.has(datum)) laatste[i] = m.get(datum)!;
      if (laatste[i] != null) totaal += laatste[i]!;
    });
    return { datum, volgers: totaal };
  });
}

/** Een getal leesbaar: 1234 → "1.234", 12345 → "12,3k", 1234567 → "1,2 mln". */
export function formatGetal(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(Math.round(n / 100_000) / 10).toString().replace('.', ',')} mln`;
  if (a >= 10_000) return `${(Math.round(n / 100) / 10).toString().replace('.', ',')}k`;
  return Math.round(n).toLocaleString('nl-NL');
}

/**
 * Een SVG-lijn door de punten, binnen een vak van `breedte`×`hoogte` (met `marge` boven en
 * onder). Eén punt → een korte horizontale lijn. Geeft ook de schaal terug (voor labels).
 */
export function lijnPad(waarden: number[], breedte: number, hoogte: number, marge = 6): { d: string; min: number; max: number; punten: [number, number][] } {
  if (!waarden.length) return { d: '', min: 0, max: 0, punten: [] };
  const min = Math.min(...waarden);
  const max = Math.max(...waarden);
  const bereik = max - min || 1;
  const stap = waarden.length > 1 ? breedte / (waarden.length - 1) : 0;
  const punten: [number, number][] = waarden.map((v, i) => {
    const x = waarden.length > 1 ? i * stap : breedte / 2;
    const y = max === min ? hoogte / 2 : marge + (1 - (v - min) / bereik) * (hoogte - 2 * marge);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });
  const d =
    punten.length === 1
      ? `M0 ${punten[0][1]} L${breedte} ${punten[0][1]}`
      : punten.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  return { d, min, max, punten };
}

export type EditorVeld = 'kanalen' | 'soort' | 'media' | 'caption' | 'hashtags' | 'reactie' | 'tags' | 'collaborators' | 'locatie' | 'tijd' | 'notities' | 'algemeen';

/**
 * Bij welk veld in de editor een melding van parsePost/controleerMedia hoort (zodat hij
 * onder dat veld komt te staan). Onbekend → 'algemeen'.
 */
export function foutVeld(melding: string): EditorVeld {
  const m = melding.toLowerCase();
  if (/^(bestand|dit bestand)\b/.test(m) || /voeg een (afbeelding|video) toe|carrousel heeft|reel heeft|foto-post heeft|tekstpost heeft geen/.test(m)) return 'media';
  if (/kanaal|account staat uit|kan geen .* plaatsen/.test(m)) return 'kanalen';
  if (/soort post/.test(m)) return 'soort';
  if (/hashtag/.test(m) && !/te lang/.test(m)) return 'hashtags';
  if (/eerste reactie/.test(m)) return 'reactie';
  if (/caption|tekstpost heeft een tekst|vermelding/.test(m)) return 'caption';
  if (/collaborator/.test(m)) return 'collaborators';
  if (/tag|getagde|personen taggen/.test(m)) return 'tags';
  if (/locatie/.test(m)) return 'locatie';
  if (/datum|tijd|verleden|vooruit/.test(m)) return 'tijd';
  if (/notities/.test(m)) return 'notities';
  return 'algemeen';
}

/** Meldingen per veld (volgorde behouden, dubbelen eruit). */
export function foutenPerVeld(meldingen: string[]): Partial<Record<EditorVeld, string[]>> {
  const uit: Partial<Record<EditorVeld, string[]>> = {};
  for (const melding of [...new Set(meldingen)]) (uit[foutVeld(melding)] ??= []).push(melding);
  return uit;
}

/** "@a, b ,@c" → ['a', 'b', 'c'] (zonder @, zonder lege, zonder dubbelen). */
export function splitsNamen(invoer: string): string[] {
  const uit: string[] = [];
  for (const ruw of String(invoer ?? '').split(/[\s,;]+/)) {
    const naam = ruw.trim().replace(/^@+/, '');
    if (naam && !uit.some((x) => x.toLowerCase() === naam.toLowerCase())) uit.push(naam);
  }
  return uit;
}

/**
 * Welke soort past bij nieuwe bestanden: één video zonder andere media → reel; meer dan één
 * bestand bij een foto-post → carrousel; een tekstpost met beeld → foto of carrousel.
 * Anders blijft de soort zoals hij is.
 */
export function soortNaToevoegen(soort: PostSoort, bestaand: { type: 'afbeelding' | 'video' }[], nieuw: { type: 'afbeelding' | 'video' }[]): PostSoort {
  const totaal = bestaand.length + nieuw.length;
  if (!nieuw.length) return soort;
  if (!bestaand.length && nieuw.length === 1 && nieuw[0].type === 'video') return 'reel';
  if (soort === 'reel' && totaal > 1) return 'carrousel';
  if ((soort === 'foto' || soort === 'tekst') && totaal > 1) return 'carrousel';
  if (soort === 'tekst') return nieuw[0].type === 'video' ? 'reel' : 'foto';
  return soort;
}
