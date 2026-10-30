// De btw-aangifte per kwartaal, opgebouwd zoals het formulier van de Belastingdienst, uit het
// journaal (facturen, bonnetjes en losse bankregels; gekoppelde betalingen tellen niet
// dubbel). Pure module.
//
// Bedragen: exact in centen (per regel afgerond), en voor het formulier in hele euro's,
// afgerond in het voordeel van de ondernemer (zoals de Belastingdienst toestaat):
//   omzet (grondslag) en verschuldigde btw naar beneden, voorbelasting naar boven.
// 5a = de som van de (afgeronde) btw in 1a t/m 4b; 5b = de afgeronde voorbelasting;
// 5c = 5a − 5b = het totaal te betalen (positief) of terug te vragen (negatief).
// De KOR (5d) is niet van toepassing (deze VOF valt er niet onder); schattingen (5e/5f) niet.

import type { Centen } from './geld';
import type { Rubriek } from './btw';
import { aangifteDeadline, kwartaalGrenzen, type Datum, type Kwartaal } from './periode';
import type { JournaalPost } from './journaal';

export const FORMULIER_RUBRIEKEN = ['1a', '1b', '1c', '1d', '1e', '2a', '3a', '3b', '3c', '4a', '4b'] as const;
export type FormulierRubriek = (typeof FORMULIER_RUBRIEKEN)[number];

/** Rubrieken met een btw-kolom (de rest heeft alleen omzet). */
export const MET_BTW = new Set<FormulierRubriek>(['1a', '1b', '1c', '1d', '2a', '4a', '4b']);

export const RUBRIEK_INFO: Record<FormulierRubriek | '5a' | '5b' | '5c', { titel: string; uitleg?: string }> = {
  '1a': { titel: 'Leveringen/diensten belast met hoog tarief', uitleg: '21%: facturen en losse ontvangsten' },
  '1b': { titel: 'Leveringen/diensten belast met laag tarief', uitleg: '9%' },
  '1c': { titel: 'Leveringen/diensten belast met overige tarieven, behalve 0%' },
  '1d': { titel: 'Privégebruik' },
  '1e': { titel: 'Leveringen/diensten belast met 0% of niet bij u belast', uitleg: '0% en btw verlegd binnenland (diensten aan ondernemers buiten de EU horen niet in de aangifte)' },
  '2a': { titel: 'Leveringen/diensten waarbij de omzetbelasting naar u is verlegd', uitleg: 'bv. onderaanneming binnenland' },
  '3a': { titel: 'Leveringen naar landen buiten de EU (uitvoer)' },
  '3b': { titel: 'Leveringen naar of diensten in landen binnen de EU', uitleg: 'EU-klanten met btw verlegd (ook in de ICP-opgaaf)' },
  '3c': { titel: 'Installatie/afstandsverkopen binnen de EU' },
  '4a': { titel: 'Leveringen/diensten uit landen buiten de EU', uitleg: 'bv. software uit de VS' },
  '4b': { titel: 'Leveringen/diensten uit landen binnen de EU', uitleg: 'bv. Adobe en Google (Ierland)' },
  '5a': { titel: 'Verschuldigde omzetbelasting', uitleg: 'som van de btw in 1a t/m 4b' },
  '5b': { titel: 'Voorbelasting', uitleg: 'btw op kosten en investeringen, plus de verlegde btw' },
  '5c': { titel: 'Subtotaal (5a min 5b)', uitleg: 'te betalen, of terug te vragen als het negatief is' }
};

export const RUBRIEK_GROEPEN: { titel: string; rubrieken: FormulierRubriek[] }[] = [
  { titel: '1. Prestaties binnenland', rubrieken: ['1a', '1b', '1c', '1d', '1e'] },
  { titel: '2. Verleggingsregelingen binnenland', rubrieken: ['2a'] },
  { titel: '3. Prestaties naar of in het buitenland', rubrieken: ['3a', '3b', '3c'] },
  { titel: '4. Prestaties vanuit het buitenland aan u verricht', rubrieken: ['4a', '4b'] }
];

/** Bedrag in centen en zoals op het formulier (hele euro's). */
export interface Bedrag {
  centen: Centen;
  euro: number;
}

export interface RubriekBedragen {
  grondslag: Bedrag;
  btw: Bedrag;
}

export interface AangifteBerekening {
  jaar: number;
  kwartaal: Kwartaal;
  van: Datum;
  tot: Datum;
  rubrieken: Record<FormulierRubriek, RubriekBedragen>;
  verschuldigd: Bedrag; // 5a
  voorbelasting: Bedrag; // 5b
  saldo: Bedrag; // 5c: + te betalen, − terug
  /** Ids van de journaalposten per rubriek (en '5b' voor alle posten met voorbelasting). */
  posten: Record<FormulierRubriek | '5b', string[]>;
}

/** Wat bij indienen wordt bewaard (bk_aangiften.rubrieken): de berekening zonder de posten. */
export type AangifteSnapshot = Omit<AangifteBerekening, 'posten'> & {
  versie: 1;
  /** Correcties van eerdere kwartalen die in deze aangifte zijn meegenomen (zitten al in de bedragen). */
  correcties?: Correctie[];
};

/**
 * Een correctie van een eerder ingediend kwartaal, meegenomen in een latere aangifte (fouten tot
 * € 1.000 btw verwerk je volgens de Belastingdienst in de eerstvolgende aangifte, bij de rubriek
 * waar ze horen). Bedragen exact in centen: wat het had moeten zijn min wat is aangegeven.
 */
export interface Correctie {
  jaar: number;
  kwartaal: Kwartaal;
  /** Alleen rubrieken met een verschil. */
  rubrieken: Partial<Record<FormulierRubriek, { grondslag: Centen; btw: Centen }>>;
  voorbelasting: Centen;
}

/** Naar beneden afronden op hele euro's (ook bij negatieve bedragen: −1,50 → −2). */
export function euroOmlaag(c: Centen): number {
  return (c - (((c % 100) + 100) % 100)) / 100;
}

/** Naar boven afronden op hele euro's. */
export function euroOmhoog(c: Centen): number {
  return -euroOmlaag(-c);
}

const nul = (): RubriekBedragen => ({ grondslag: { centen: 0, euro: 0 }, btw: { centen: 0, euro: 0 } });

/**
 * De aangifte over een kwartaal uit het journaal. Alleen posten met btw-gegevens tellen
 * (facturen, verwerkte bonnetjes, losse uitgaven/inkomsten); gekoppelde betalingen, privé,
 * overboekingen en btw-betalingen hebben geen btw.
 */
export function aangifteRubrieken(posten: readonly JournaalPost[], jaar: number, kwartaal: Kwartaal): AangifteBerekening {
  const { van, tot } = kwartaalGrenzen(jaar, kwartaal);
  const rub = Object.fromEntries(FORMULIER_RUBRIEKEN.map((r) => [r, nul()])) as Record<FormulierRubriek, RubriekBedragen>;
  const ids = Object.fromEntries([...FORMULIER_RUBRIEKEN, '5b'].map((r) => [r, [] as string[]])) as Record<FormulierRubriek | '5b', string[]>;
  let voorbelasting = 0;
  for (const p of posten) {
    if (!p.btw || p.datum < van || p.datum > tot) continue;
    const r = p.btw.rubriek as Rubriek | null;
    if (r && r !== '5b') {
      rub[r].grondslag.centen += p.btw.grondslag;
      rub[r].btw.centen += p.btw.verschuldigd;
      ids[r].push(p.id);
    }
    if (p.btw.voorbelasting !== 0) {
      voorbelasting += p.btw.voorbelasting;
      ids['5b'].push(p.id);
    }
  }
  return { jaar, kwartaal, van, tot, ...formulierBedragen(rub, voorbelasting), posten: ids };
}

/** Formulierbedragen (hele euro's, 5a/5b/5c) bij exacte rubrieken en voorbelasting; rub wordt aangevuld. */
function formulierBedragen(rub: Record<FormulierRubriek, RubriekBedragen>, voorbelasting: Centen) {
  let verschuldigdCenten = 0;
  let verschuldigdEuro = 0;
  for (const r of FORMULIER_RUBRIEKEN) {
    const b = rub[r];
    b.grondslag.euro = euroOmlaag(b.grondslag.centen);
    b.btw.euro = MET_BTW.has(r) ? euroOmlaag(b.btw.centen) : 0;
    verschuldigdCenten += b.btw.centen;
    verschuldigdEuro += b.btw.euro;
  }
  const vbEuro = euroOmhoog(voorbelasting);
  return {
    rubrieken: rub,
    verschuldigd: { centen: verschuldigdCenten, euro: verschuldigdEuro },
    voorbelasting: { centen: voorbelasting, euro: vbEuro },
    saldo: { centen: verschuldigdCenten - voorbelasting, euro: verschuldigdEuro - vbEuro }
  };
}

// ---------------------------------------------------------------------------------
// Correcties van eerdere kwartalen
// ---------------------------------------------------------------------------------

/** a + teken × de correcties, met opnieuw afgeronde formulierbedragen. Zonder correcties: a zelf. */
function metBijtelling<T extends Omit<AangifteBerekening, 'posten'>>(a: T, correcties: readonly Correctie[], teken: 1 | -1): T {
  if (!correcties.length) return a;
  const rub = Object.fromEntries(
    FORMULIER_RUBRIEKEN.map((r) => [r, { grondslag: { centen: a.rubrieken[r].grondslag.centen, euro: 0 }, btw: { centen: a.rubrieken[r].btw.centen, euro: 0 } }])
  ) as Record<FormulierRubriek, RubriekBedragen>;
  let vb = a.voorbelasting.centen;
  for (const c of correcties) {
    for (const [r, d] of Object.entries(c.rubrieken) as [FormulierRubriek, { grondslag: Centen; btw: Centen }][]) {
      rub[r].grondslag.centen += teken * d.grondslag;
      rub[r].btw.centen += teken * d.btw;
    }
    vb += teken * c.voorbelasting;
  }
  return { ...a, ...formulierBedragen(rub, vb) };
}

/** De berekening van een kwartaal met de correcties van eerdere kwartalen erin (zoals je het formulier invult). */
export function metCorrecties(a: AangifteBerekening, correcties: readonly Correctie[]): AangifteBerekening {
  return metBijtelling(a, correcties, 1);
}

const volgorde = (j: number, q: Kwartaal) => j * 4 + q;

/**
 * Wat er over een ingediend kwartaal nu geldt bij de Belastingdienst: het eigen deel van de
 * snapshot (zonder de correcties van eerdere kwartalen die erin zijn meegenomen) plus de
 * correcties van dit kwartaal die in latere aangiften zijn meegenomen.
 */
export function effectiefIngediend(a: Aangifte, alle: readonly Aangifte[]): AangifteSnapshot | null {
  if (!a.snapshot) return null;
  const eigen = metBijtelling(a.snapshot, a.snapshot.correcties ?? [], -1);
  const later = alle.flatMap((x) => (x.id === a.id ? [] : (x.snapshot?.correcties ?? []).filter((c) => c.jaar === a.jaar && c.kwartaal === a.kwartaal)));
  if (!later.length) return eigen;
  // Correcties zijn berekend t.o.v. wat er is aangegeven (zie aangegeven()); daar ook bij optellen.
  const basis: AangifteSnapshot = {
    ...eigen,
    rubrieken: Object.fromEntries(
      FORMULIER_RUBRIEKEN.map((r) => [
        r,
        {
          grondslag: { centen: aangegeven(eigen.rubrieken[r].grondslag), euro: eigen.rubrieken[r].grondslag.euro },
          btw: { centen: MET_BTW.has(r) ? aangegeven(eigen.rubrieken[r].btw) : eigen.rubrieken[r].btw.centen, euro: eigen.rubrieken[r].btw.euro }
        }
      ])
    ) as Record<FormulierRubriek, RubriekBedragen>,
    voorbelasting: { centen: aangegeven(eigen.voorbelasting, true), euro: eigen.voorbelasting.euro }
  };
  return metBijtelling(basis, later, 1);
}

/** Het (eerste) latere kwartaal waarin de correctie van dit kwartaal is meegenomen. */
export function gecorrigeerdIn(a: Aangifte, alle: readonly Aangifte[]): { jaar: number; kwartaal: Kwartaal } | null {
  const x = alle
    .filter((y) => (y.snapshot?.correcties ?? []).some((c) => c.jaar === a.jaar && c.kwartaal === a.kwartaal))
    .sort((p, q) => volgorde(p.jaar, p.kwartaal) - volgorde(q.jaar, q.kwartaal))[0];
  return x ? { jaar: x.jaar, kwartaal: x.kwartaal } : null;
}

/**
 * Wat er is aangegeven, in centen. Normaal de exacte centen van de snapshot; past het bedrag in
 * hele euro's daar niet bij (een overgenomen of gereconstrueerd formulier), dan telt dat bedrag.
 */
function aangegeven(b: Bedrag, omhoog = false): Centen {
  return (omhoog ? euroOmhoog(b.centen) : euroOmlaag(b.centen)) === b.euro ? b.centen : b.euro * 100;
}

/** Het verschil tussen de huidige berekening en wat er nu geldt, als correctie (null = geen verschil). */
function verschilAlsCorrectie(a: Aangifte, effectief: AangifteSnapshot, nu: AangifteBerekening): Correctie | null {
  const rubrieken: Correctie['rubrieken'] = {};
  for (const r of FORMULIER_RUBRIEKEN) {
    const g = nu.rubrieken[r].grondslag.centen - aangegeven(effectief.rubrieken[r].grondslag);
    const b = MET_BTW.has(r) ? nu.rubrieken[r].btw.centen - aangegeven(effectief.rubrieken[r].btw) : 0;
    if (g || b) rubrieken[r] = { grondslag: g, btw: b };
  }
  const voorbelasting = nu.voorbelasting.centen - aangegeven(effectief.voorbelasting, true);
  return Object.keys(rubrieken).length || voorbelasting ? { jaar: a.jaar, kwartaal: a.kwartaal, rubrieken, voorbelasting } : null;
}

/**
 * De correcties die in de aangifte van (jaar, kwartaal) horen: per eerder ingediend kwartaal
 * dat volgens de boekingen afwijkt van wat er geldt, met een verschil tot € 1.000 (anders
 * suppletie). Een correctie komt in het EERSTE niet-ingediende kwartaal erna: zit er tussen het
 * afwijkende kwartaal en (jaar, kwartaal) nog een kwartaal zonder aangifte, dan hoort hij daar.
 */
export function openCorrecties(posten: readonly JournaalPost[], aangiften: readonly Aangifte[], jaar: number, kwartaal: Kwartaal): Correctie[] {
  const doel = volgorde(jaar, kwartaal);
  const ingediend = new Set(aangiften.map((a) => volgorde(a.jaar, a.kwartaal)));
  const uit: Correctie[] = [];
  for (const a of [...aangiften].sort((p, q) => volgorde(p.jaar, p.kwartaal) - volgorde(q.jaar, q.kwartaal))) {
    const v = volgorde(a.jaar, a.kwartaal);
    if (v >= doel) continue;
    let tussenOpen = false;
    for (let x = v + 1; x < doel; x++) if (!ingediend.has(x)) tussenOpen = true;
    if (tussenOpen) continue;
    const eff = effectiefIngediend(a, aangiften);
    if (!eff) continue;
    const nu = aangifteRubrieken(posten, a.jaar, a.kwartaal);
    if (vergelijkMetIngediend(eff, nu).advies !== 'volgende_aangifte') continue;
    const c = verschilAlsCorrectie(a, eff, nu);
    if (c) uit.push(c);
  }
  return uit;
}

/**
 * De aangifte van een kwartaal zoals je hem invult: niet ingediend = de eigen boekingen plus de
 * open correcties; ingediend = de snapshot met de correcties die erin zijn meegenomen.
 */
export function aangifteVoorKwartaal(
  posten: readonly JournaalPost[],
  aangiften: readonly Aangifte[],
  jaar: number,
  kwartaal: Kwartaal
): { eigen: AangifteBerekening; formulier: AangifteBerekening; correcties: Correctie[] } {
  const eigen = aangifteRubrieken(posten, jaar, kwartaal);
  const aangifte = aangiften.find((a) => a.jaar === jaar && a.kwartaal === kwartaal);
  if (aangifte?.snapshot) return { eigen, formulier: { ...aangifte.snapshot, posten: eigen.posten }, correcties: aangifte.snapshot.correcties ?? [] };
  const correcties = openCorrecties(posten, aangiften, jaar, kwartaal);
  return { eigen, formulier: metCorrecties(eigen, correcties), correcties };
}

export function naarSnapshot(a: AangifteBerekening): AangifteSnapshot {
  const { posten: _posten, ...rest } = a;
  void _posten;
  return { versie: 1, ...structuredClone(rest) };
}

/** Een opgeslagen snapshot terug inlezen (jsonb); null als het geen geldige snapshot is. */
export function leesSnapshot(v: unknown): AangifteSnapshot | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Partial<AangifteSnapshot>;
  if (s.versie !== 1 || !s.rubrieken || !s.saldo || !s.verschuldigd || !s.voorbelasting) return null;
  const ok = (b: unknown) => !!b && typeof b === 'object' && Number.isSafeInteger((b as Bedrag).centen) && Number.isSafeInteger((b as Bedrag).euro);
  for (const r of FORMULIER_RUBRIEKEN) {
    const x = (s.rubrieken as Record<string, RubriekBedragen>)[r];
    if (!x || !ok(x.grondslag) || !ok(x.btw)) return null;
  }
  if (!ok(s.saldo) || !ok(s.verschuldigd) || !ok(s.voorbelasting)) return null;
  if (s.correcties !== undefined) {
    const geheel = (n: unknown) => Number.isSafeInteger(n);
    const goed =
      Array.isArray(s.correcties) &&
      s.correcties.every(
        (c) =>
          c &&
          geheel(c.jaar) &&
          [1, 2, 3, 4].includes(c.kwartaal) &&
          geheel(c.voorbelasting) &&
          c.rubrieken &&
          typeof c.rubrieken === 'object' &&
          Object.entries(c.rubrieken).every(([r, d]) => (FORMULIER_RUBRIEKEN as readonly string[]).includes(r) && d && geheel(d.grondslag) && geheel(d.btw))
      );
    if (!goed) return null;
  }
  return s as AangifteSnapshot;
}

/** Het te betalen (+) of terug te ontvangen (−) bedrag volgens het formulier, in centen. */
export function teBetalenCenten(a: Pick<AangifteBerekening, 'saldo'>): Centen {
  return a.saldo.euro * 100;
}

/** Afrondingsverschil (in je voordeel) tussen de exacte btw en het formulier, in centen. */
export function afrondingsverschil(a: Pick<AangifteBerekening, 'saldo'>): Centen {
  return a.saldo.centen - a.saldo.euro * 100;
}

/** Grens waarboven een correctie via een suppletie moet (in plaats van in de volgende aangifte). */
export const SUPPLETIE_GRENS = 100_000;

export interface Afwijking {
  /** Verschil in het te betalen bedrag (formulier, centen): + = meer te betalen dan aangegeven. */
  verschil: Centen;
  /** Rubrieken waarin iets is veranderd (formulierwaarden). */
  rubrieken: { rubriek: FormulierRubriek | '5b'; was: number; nu: number; soort: 'grondslag' | 'btw' }[];
  advies: 'geen' | 'volgende_aangifte' | 'suppletie';
}

/** Vergelijkt de huidige berekening met wat is ingediend (bv. een factuur is later gewijzigd). */
export function vergelijkMetIngediend(ingediend: AangifteSnapshot, nu: AangifteBerekening): Afwijking {
  const rubrieken: Afwijking['rubrieken'] = [];
  for (const r of FORMULIER_RUBRIEKEN) {
    const a = ingediend.rubrieken[r];
    const b = nu.rubrieken[r];
    if (a.grondslag.euro !== b.grondslag.euro) rubrieken.push({ rubriek: r, was: a.grondslag.euro, nu: b.grondslag.euro, soort: 'grondslag' });
    if (a.btw.euro !== b.btw.euro) rubrieken.push({ rubriek: r, was: a.btw.euro, nu: b.btw.euro, soort: 'btw' });
  }
  if (ingediend.voorbelasting.euro !== nu.voorbelasting.euro) rubrieken.push({ rubriek: '5b', was: ingediend.voorbelasting.euro, nu: nu.voorbelasting.euro, soort: 'btw' });
  const verschil = (nu.saldo.euro - ingediend.saldo.euro) * 100;
  const advies = verschil === 0 && rubrieken.length === 0 ? 'geen' : Math.abs(verschil) > SUPPLETIE_GRENS ? 'suppletie' : 'volgende_aangifte';
  return { verschil, rubrieken, advies };
}

// ---------------------------------------------------------------------------------
// Kwartalen en status
// ---------------------------------------------------------------------------------
export interface Aangifte {
  id: string;
  jaar: number;
  kwartaal: Kwartaal;
  /** Tijdstip van indienen (ISO). */
  ingediendOp: string;
  ingediendDoor: string | null;
  kenmerk: string | null;
  opmerking: string | null;
  snapshot: AangifteSnapshot | null;
  /** Te betalen (+) of terug (−) volgens het ingediende formulier, in centen (hele euro's). */
  teBetalen: Centen;
}

/** Een bankregel (soort btw) die (een deel van) een aangifte betaalt of de teruggaaf ontvangt. */
export interface AangifteBetaling {
  id: string;
  boekingId: string;
  aangifteId: string;
  /** Met teken zoals de aangifte: + betaald, − ontvangen (teruggaaf). */
  bedrag: Centen;
}

export type KwartaalStatus = 'lopend' | 'te_doen' | 'te_laat' | 'ingediend' | 'betaald';

export interface KwartaalRij {
  jaar: number;
  kwartaal: Kwartaal;
  van: Datum;
  tot: Datum;
  deadline: Datum;
  status: KwartaalStatus;
  aangifte: Aangifte | null;
  /** Bij een ingediende aangifte: het ingediende saldo; anders de huidige berekening (formulier, centen). */
  teBetalen: Centen;
  betaald: Centen;
  /** Afwijking na indiening (alleen bij ingediend), t.o.v. wat er geldt (incl. latere correcties). */
  afwijking: Afwijking | null;
  /** Niet ingediend: de correcties van eerdere kwartalen die in deze aangifte horen; ingediend: die erin zijn meegenomen. */
  correcties: Correctie[];
  /** Ingediend en later gecorrigeerd: in welke aangifte (ingediend) of nog te doen (open). */
  correctieIn: { jaar: number; kwartaal: Kwartaal; ingediend: boolean } | null;
}

/** Alle kwartalen van `vanaf` t/m het lopende kwartaal, nieuwste eerst. */
export function kwartalenTot(vanaf: Datum, vandaag: Datum): { jaar: number; kwartaal: Kwartaal }[] {
  const uit: { jaar: number; kwartaal: Kwartaal }[] = [];
  let j = Number(vanaf.slice(0, 4));
  let q = (Math.floor((Number(vanaf.slice(5, 7)) - 1) / 3) + 1) as Kwartaal;
  for (let i = 0; i < 400; i++) {
    const { van } = kwartaalGrenzen(j, q);
    if (van > vandaag) break;
    uit.push({ jaar: j, kwartaal: q });
    if (q === 4) {
      j++;
      q = 1;
    } else q = (q + 1) as Kwartaal;
  }
  return uit.reverse();
}

export function kwartaalStatus(o: { tot: Datum; deadline: Datum; aangifte: Aangifte | null; betaald: Centen; vandaag: Datum }): KwartaalStatus {
  if (o.aangifte) {
    const t = o.aangifte.teBetalen;
    return t === 0 || (t > 0 ? o.betaald >= t : o.betaald <= t) ? 'betaald' : 'ingediend';
  }
  if (o.vandaag <= o.tot) return 'lopend';
  return o.vandaag > o.deadline ? 'te_laat' : 'te_doen';
}

/** Het overzicht van de kwartalen (status, bedragen, afwijkingen). */
export function kwartaalOverzicht(o: {
  posten: readonly JournaalPost[];
  aangiften: readonly Aangifte[];
  betalingen: readonly AangifteBetaling[];
  vanaf: Datum;
  vandaag: Datum;
}): KwartaalRij[] {
  const rijen: KwartaalRij[] = kwartalenTot(o.vanaf, o.vandaag).map(({ jaar, kwartaal }) => {
    const { van, tot } = kwartaalGrenzen(jaar, kwartaal);
    const deadline = aangifteDeadline(jaar, kwartaal);
    const aangifte = o.aangiften.find((a) => a.jaar === jaar && a.kwartaal === kwartaal) ?? null;
    const { eigen, formulier, correcties } = aangifteVoorKwartaal(o.posten, o.aangiften, jaar, kwartaal);
    const betaald = aangifte ? o.betalingen.filter((b) => b.aangifteId === aangifte.id).reduce((t, b) => t + b.bedrag, 0) : 0;
    const eff = aangifte ? effectiefIngediend(aangifte, o.aangiften) : null;
    const ingediendIn = aangifte ? gecorrigeerdIn(aangifte, o.aangiften) : null;
    return {
      jaar,
      kwartaal,
      van,
      tot,
      deadline,
      status: kwartaalStatus({ tot, deadline, aangifte, betaald, vandaag: o.vandaag }),
      aangifte,
      teBetalen: aangifte ? aangifte.teBetalen : teBetalenCenten(formulier),
      betaald,
      afwijking: eff ? vergelijkMetIngediend(eff, eigen) : null,
      correcties,
      correctieIn: ingediendIn ? { ...ingediendIn, ingediend: true } : null
    };
  });
  // Een afwijking die in een open aangifte wordt meegenomen: daar staat hij (nog niet ingediend).
  for (const r of rijen) {
    if (r.aangifte) continue;
    for (const c of r.correcties) {
      const doel = rijen.find((x) => x.jaar === c.jaar && x.kwartaal === c.kwartaal);
      if (doel && !doel.correctieIn) doel.correctieIn = { jaar: r.jaar, kwartaal: r.kwartaal, ingediend: false };
    }
  }
  return rijen;
}

/** Het eerstvolgende kwartaal waarvoor aangifte moet worden gedaan (oudste niet-ingediende afgelopen kwartaal, anders het lopende). */
export function volgendeAangifte(rijen: readonly KwartaalRij[]): KwartaalRij | null {
  const open = rijen.filter((r) => r.status === 'te_doen' || r.status === 'te_laat');
  return open.length ? open[open.length - 1] : rijen.find((r) => r.status === 'lopend') ?? null;
}

/**
 * Controle bij het koppelen van een btw-betaling aan een aangifte. null = goed, anders de melding.
 *   richting: een te betalen aangifte hoort bij een afschrijving, een teruggaaf bij een bijschrijving.
 */
export function betalingFout(o: { soort: string; richting: 'af' | 'bij'; bankBedrag: Centen; alGekoppeld: Centen; aangifte: Aangifte; bedrag: Centen }): string | null {
  if (o.soort !== 'btw') return 'Alleen een bankregel van de soort "Btw-aangifte" kan aan een aangifte worden gekoppeld.';
  if (o.aangifte.teBetalen === 0) return 'Bij deze aangifte hoeft niets te worden betaald of ontvangen.';
  const verwacht = o.aangifte.teBetalen > 0 ? 'af' : 'bij';
  if (o.richting !== verwacht) return o.aangifte.teBetalen > 0 ? 'Deze aangifte is te betalen: kies een betaling (geld af).' : 'Deze aangifte is een teruggaaf: kies een ontvangst (geld bij).';
  if (!Number.isSafeInteger(o.bedrag) || o.bedrag === 0 || Math.sign(o.bedrag) !== Math.sign(o.aangifte.teBetalen)) return 'Ongeldig bedrag.';
  if (Math.abs(o.bedrag) + o.alGekoppeld > o.bankBedrag) return 'Het bedrag is hoger dan wat er nog van deze bankregel over is.';
  return null;
}
