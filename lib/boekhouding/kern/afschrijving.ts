// Vaste activa en lineaire afschrijving, in hele centen. Pure module (geen netwerk, geen
// klok, geen '@/'-imports).
//
// Regels:
//   - afschrijven per maand, lineair, vanaf de maand van ingebruikname (die maand telt mee);
//   - cumulatief afgerond: na k maanden is er rondAf((aanschaf − restwaarde) · k / looptijd)
//     afgeschreven (half weg van nul); het bedrag van een maand is het verschil met de maand
//     ervoor. Zo wijkt geen enkele maand meer dan een halve cent af van het exacte bedrag, telt
//     een jaar op tot het exacte jaarbedrag (€ 1.784 in 5 jaar: € 356,80 per jaar) en komt de
//     boekwaarde aan het eind precies op de restwaarde uit;
//   - de termijn is vrij te kiezen (12 t/m 240 maanden; snelkeuze 3 of 5 jaar);
//   - desinvestering (verkoop of buiten gebruik): de afschrijving loopt t/m de maand vóór de
//     desinvestering; de resterende boekwaarde gaat dan af (zie journaal.ts);
//   - aanschaf is exclusief btw (de btw gaat via de voorbelasting van de bron).
// Een journaalpost per maand (D 4800 afschrijvingen / C cum. afschrijving) leidt journaal.ts
// hieruit af; er wordt niets opgeslagen.

import { MAX_CENTEN, naarCenten, rondAf, type Centen } from './geld';
import { DREMPEL_ACTIVEREN } from './constanten';
import { dagenInMaand, isDatum, jaarVan, maakDatum, maandVan, plusMaanden, type Datum } from './periode';

/** Rekeningen waarop je kunt activeren, met hun cumulatieve afschrijving. */
export const ACTIVA_CATEGORIEEN = {
  '0210': { naam: 'Computers & apparatuur', cum: '0219' },
  '0200': { naam: 'Inventaris', cum: '0209' }
} as const;
export type ActivumCategorie = keyof typeof ACTIVA_CATEGORIEEN;
export const isActivumCategorie = (v: unknown): v is ActivumCategorie => v === '0200' || v === '0210';

export const LOOPTIJD_MIN = 12;
export const LOOPTIJD_MAX = 240;
/** Fiscaal: overige bedrijfsmiddelen max. 20% per jaar (art. 3.30 Wet IB) = minimaal 60 maanden. */
export const FISCAAL_MIN_MAANDEN = 60;

export interface Activum {
  id: string;
  omschrijving: string;
  categorie: ActivumCategorie;
  aanschafdatum: Datum;
  ingebruikname: Datum;
  /** Aanschafprijs exclusief btw. */
  aanschaf: Centen;
  restwaarde: Centen;
  looptijdMaanden: number;
  /** Herkomst: het bonnetje (expenses) of de bankregel waarmee het is gekocht; beide null = ingebracht/bestaand. */
  uitgaveId: string | null;
  boekingId: string | null;
  desinvesteringDatum: Datum | null;
  /** Opbrengst bij verkoop (excl. btw); 0 = buiten gebruik/gesloopt. */
  desinvesteringOpbrengst: Centen | null;
  notities: string | null;
  aangemaakt: string;
}

export type ActivumWaarde = Omit<Activum, 'id' | 'aangemaakt'>;

export interface SchemaRegel {
  /** 'YYYY-MM' */
  maand: string;
  /** Laatste dag van de maand (datum van de afschrijvingspost). */
  datum: Datum;
  afschrijving: Centen;
  cumulatief: Centen;
  boekwaarde: Centen;
}

const maandSleutel = (d: Datum) => d.slice(0, 7);
const eindeMaand = (d: Datum): Datum => maakDatum(jaarVan(d), maandVan(d), dagenInMaand(jaarVan(d), maandVan(d)));

/** Cumulatieve afschrijving na `k` maanden (exact afgerond op hele centen). */
function cumulatiefNa(basis: Centen, n: number, k: number): Centen {
  return k <= 0 ? 0 : k >= n ? basis : rondAf(basis * k, n);
}

/**
 * Afschrijving per maand en per jaar (ter informatie). Per maand is het bedrag afgerond op
 * hele centen; door het cumulatief afronden is een enkele maand soms een cent hoger of lager.
 * `laatste` = de laatste maand van de looptijd, `perJaar` = een volledig jaar (12 maanden).
 */
export function maandbedrag(a: Pick<Activum, 'aanschaf' | 'restwaarde' | 'looptijdMaanden'>): { gewoon: Centen; laatste: Centen; perJaar: Centen } {
  const basis = a.aanschaf - a.restwaarde;
  if (!Number.isSafeInteger(basis) || basis < 0) throw new Error('restwaarde hoger dan aanschaf');
  const n = a.looptijdMaanden;
  if (!Number.isInteger(n) || n < 1) throw new Error('ongeldige looptijd');
  return {
    gewoon: rondAf(basis, n),
    laatste: basis - cumulatiefNa(basis, n, n - 1),
    perJaar: n >= 12 ? rondAf(basis * 12, n) : basis
  };
}

/**
 * Het volledige schema (alle maanden van de looptijd), afgekapt bij een desinvestering
 * (afschrijving t/m de maand vóór de desinvestering).
 *   € 2.499 in 60 maanden vanaf 15-03 → 60 × € 41,65, eerste post 31-03, laatste 28-02 vijf jaar later.
 */
export function schema(a: Activum): SchemaRegel[] {
  maandbedrag(a); // invoercontrole (restwaarde, looptijd)
  const basis = a.aanschaf - a.restwaarde;
  const eind = a.desinvesteringDatum ? maandSleutel(a.desinvesteringDatum) : null;
  const uit: SchemaRegel[] = [];
  let cum = 0;
  for (let i = 0; i < a.looptijdMaanden; i++) {
    const d = eindeMaand(plusMaanden(maakDatum(jaarVan(a.ingebruikname), maandVan(a.ingebruikname), 1), i));
    if (eind && maandSleutel(d) >= eind) break;
    const bedrag = cumulatiefNa(basis, a.looptijdMaanden, i + 1) - cumulatiefNa(basis, a.looptijdMaanden, i);
    cum += bedrag;
    uit.push({ maand: maandSleutel(d), datum: d, afschrijving: bedrag, cumulatief: cum, boekwaarde: a.aanschaf - cum });
  }
  return uit;
}

/** Cumulatieve afschrijving t/m een datum (posten op de laatste dag van de maand). */
export function cumulatiefOp(a: Activum, datum: Datum): Centen {
  let cum = 0;
  for (const r of schema(a)) {
    if (r.datum > datum) break;
    cum = r.cumulatief;
  }
  return cum;
}

/** Boekwaarde op een datum: 0 vóór de aanschaf en na de desinvestering. */
export function boekwaardeOp(a: Activum, datum: Datum): Centen {
  if (datum < a.aanschafdatum) return 0;
  if (a.desinvesteringDatum && datum >= a.desinvesteringDatum) return 0;
  return a.aanschaf - cumulatiefOp(a, datum);
}

/** Boekwaarde direct vóór de desinvestering (wat er bij verkoop/sloop afgaat). */
export function boekwaardeBijDesinvestering(a: Activum): Centen | null {
  if (!a.desinvesteringDatum) return null;
  const s = schema(a);
  return a.aanschaf - (s.length ? s[s.length - 1].cumulatief : 0);
}

/** Boekwinst (+) of -verlies (−) bij desinvestering: opbrengst − boekwaarde. */
export function boekresultaat(a: Activum): Centen | null {
  const bw = boekwaardeBijDesinvestering(a);
  return bw === null ? null : (a.desinvesteringOpbrengst ?? 0) - bw;
}

/** Laatste afschrijvingsmaand ('YYYY-MM'), of null als er niets wordt afgeschreven. */
export function eindeAfschrijving(a: Activum): string | null {
  const s = schema(a);
  return s.length ? s[s.length - 1].maand : null;
}

export interface ActivastaatRegel {
  activum: Activum;
  /** Boekwaarde 31-12 van het vorige jaar (0 als het dit jaar is aangeschaft). */
  begin: Centen;
  /** Aanschaf in dit jaar. */
  investering: Centen;
  afschrijving: Centen;
  /** Boekwaarde die bij een desinvestering in dit jaar afgaat. */
  desinvestering: Centen;
  eind: Centen;
  cumulatief: Centen;
}

/** De activastaat van een jaar: begin + investering − afschrijving − desinvestering = eind. */
export function activastaat(activa: readonly Activum[], jaar: number): { regels: ActivastaatRegel[]; totaal: Omit<ActivastaatRegel, 'activum'> } {
  const vorigEind = maakDatum(jaar - 1, 12, 31);
  const eind = maakDatum(jaar, 12, 31);
  const regels: ActivastaatRegel[] = [];
  for (const a of activa) {
    if (a.aanschafdatum > eind) continue;
    if (a.desinvesteringDatum && a.desinvesteringDatum <= vorigEind) continue;
    const begin = boekwaardeOp(a, vorigEind);
    const investering = jaarVan(a.aanschafdatum) === jaar ? a.aanschaf : 0;
    const afschrijving = schema(a)
      .filter((r) => jaarVan(r.datum) === jaar)
      .reduce((t, r) => t + r.afschrijving, 0);
    const desinvestering = a.desinvesteringDatum && jaarVan(a.desinvesteringDatum) === jaar ? boekwaardeBijDesinvestering(a) ?? 0 : 0;
    const eindwaarde = boekwaardeOp(a, eind);
    if (begin + investering - afschrijving - desinvestering !== eindwaarde) throw new Error(`activastaat sluit niet voor ${a.id}`);
    regels.push({ activum: a, begin, investering, afschrijving, desinvestering, eind: eindwaarde, cumulatief: a.desinvesteringDatum && a.desinvesteringDatum <= eind ? 0 : cumulatiefOp(a, eind) });
  }
  regels.sort((x, y) => (x.activum.aanschafdatum < y.activum.aanschafdatum ? 1 : x.activum.aanschafdatum > y.activum.aanschafdatum ? -1 : 0));
  const totaal = regels.reduce(
    (t, r) => ({
      begin: t.begin + r.begin,
      investering: t.investering + r.investering,
      afschrijving: t.afschrijving + r.afschrijving,
      desinvestering: t.desinvestering + r.desinvestering,
      eind: t.eind + r.eind,
      cumulatief: t.cumulatief + r.cumulatief
    }),
    { begin: 0, investering: 0, afschrijving: 0, desinvestering: 0, eind: 0, cumulatief: 0 }
  );
  return { regels, totaal };
}

/** Afschrijving per jaar (voor het overzicht op de detailpagina). */
export function perJaar(a: Activum): { jaar: number; afschrijving: Centen; eind: Centen }[] {
  const m = new Map<number, Centen>();
  for (const r of schema(a)) m.set(jaarVan(r.datum), (m.get(jaarVan(r.datum)) ?? 0) + r.afschrijving);
  return [...m.entries()].map(([jaar, afschrijving]) => ({ jaar, afschrijving, eind: boekwaardeOp(a, maakDatum(jaar, 12, 31)) }));
}

/** "5 jaar" / "3 jaar" / "30 maanden" */
export function looptijdLabel(maanden: number): string {
  return maanden % 12 === 0 ? `${maanden / 12} jaar` : `${maanden} maanden`;
}

/** Hints en waarschuwingen bij een activum (blokkeren niet). */
export function activumHints(a: Pick<Activum, 'aanschaf' | 'looptijdMaanden' | 'restwaarde'>): { soort: 'hint' | 'let_op'; tekst: string }[] {
  const uit: { soort: 'hint' | 'let_op'; tekst: string }[] = [];
  if (a.aanschaf < DREMPEL_ACTIVEREN) {
    uit.push({ soort: 'hint', tekst: 'Onder € 450 excl. btw mag je de aanschaf ook direct als kosten boeken (Kleine hardware); activeren hoeft niet.' });
  }
  if (a.looptijdMaanden < FISCAAL_MIN_MAANDEN) {
    uit.push({
      soort: 'let_op',
      tekst: `Fiscaal mag je op overige bedrijfsmiddelen maximaal 20% per jaar afschrijven (minimaal 5 jaar). Met ${looptijdLabel(a.looptijdMaanden)} kan de fiscale winst afwijken; laat dit bevestigen door de boekhouder.`
    });
  }
  return uit;
}

// ---------------------------------------------------------------------------------
// Invoercontrole
// ---------------------------------------------------------------------------------
export type ActivumUitkomst = { ok: true; waarde: ActivumWaarde } | { ok: false; fout: string; veld?: string };

const tekst = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

const bedragUit = (v: unknown): Centen | null => (typeof v === 'number' ? (Number.isSafeInteger(v) ? v : null) : naarCenten(v));

/**
 * Controleert de invoer van een activum. Bedragen: centen (getal) of tekst in euro's.
 * Looptijd in maanden (12–240) of `jaren` (1–20). Herkomst en desinvestering optioneel.
 */
export function parseActivumInvoer(body: Record<string, unknown>, opties: { vandaag: Datum }): ActivumUitkomst {
  const omschrijving = tekst(body.omschrijving, 200);
  if (!omschrijving) return { ok: false, fout: 'Geef het activum een naam (bv. "MacBook Pro 14").', veld: 'omschrijving' };
  const categorie = body.categorie ?? '0210';
  if (!isActivumCategorie(categorie)) return { ok: false, fout: 'Kies een soort: computers & apparatuur of inventaris.', veld: 'categorie' };
  if (!isDatum(body.aanschafdatum) || body.aanschafdatum < '2000-01-01') return { ok: false, fout: 'Vul een geldige aanschafdatum in.', veld: 'aanschafdatum' };
  const aanschafdatum = body.aanschafdatum;
  if (aanschafdatum > opties.vandaag) return { ok: false, fout: 'De aanschafdatum ligt in de toekomst.', veld: 'aanschafdatum' };
  const ingebruikname = body.ingebruikname === undefined || body.ingebruikname === null || body.ingebruikname === '' ? aanschafdatum : body.ingebruikname;
  if (!isDatum(ingebruikname)) return { ok: false, fout: 'Vul een geldige datum van ingebruikname in.', veld: 'ingebruikname' };
  if (ingebruikname < aanschafdatum) return { ok: false, fout: 'Ingebruikname kan niet vóór de aanschaf liggen.', veld: 'ingebruikname' };
  if (ingebruikname > plusMaanden(opties.vandaag, 12)) return { ok: false, fout: 'De ingebruikname ligt te ver in de toekomst.', veld: 'ingebruikname' };

  const aanschaf = bedragUit(body.aanschaf);
  if (aanschaf === null || aanschaf <= 0) return { ok: false, fout: 'Vul de aanschafprijs excl. btw in.', veld: 'aanschaf' };
  if (aanschaf > MAX_CENTEN) return { ok: false, fout: 'Dat bedrag is te groot.', veld: 'aanschaf' };
  const rw = body.restwaarde === undefined || body.restwaarde === null || body.restwaarde === '' ? 0 : bedragUit(body.restwaarde);
  if (rw === null || rw < 0) return { ok: false, fout: 'Ongeldige restwaarde.', veld: 'restwaarde' };
  if (rw >= aanschaf) return { ok: false, fout: 'De restwaarde moet lager zijn dan de aanschafprijs.', veld: 'restwaarde' };

  let looptijd: number | null = null;
  if (body.looptijdMaanden !== undefined && body.looptijdMaanden !== null && body.looptijdMaanden !== '') looptijd = Number(body.looptijdMaanden);
  else if (body.jaren !== undefined && body.jaren !== null && body.jaren !== '') looptijd = Number(body.jaren) * 12;
  if (looptijd === null || !Number.isInteger(looptijd) || looptijd < LOOPTIJD_MIN || looptijd > LOOPTIJD_MAX) {
    return { ok: false, fout: 'Kies een afschrijvingstermijn van 1 tot 20 jaar (12–240 maanden).', veld: 'looptijdMaanden' };
  }

  const id = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const uitgaveId = id(body.uitgaveId);
  const boekingId = id(body.boekingId);
  if (uitgaveId && boekingId) return { ok: false, fout: 'Een activum komt uit één bron: een bonnetje of een bankregel.', veld: 'herkomst' };

  let desinvesteringDatum: Datum | null = null;
  let desinvesteringOpbrengst: Centen | null = null;
  if (body.desinvesteringDatum !== undefined && body.desinvesteringDatum !== null && body.desinvesteringDatum !== '') {
    if (!isDatum(body.desinvesteringDatum)) return { ok: false, fout: 'Vul een geldige datum van verkoop of buitengebruikstelling in.', veld: 'desinvesteringDatum' };
    if (body.desinvesteringDatum < ingebruikname) return { ok: false, fout: 'De desinvestering kan niet vóór de ingebruikname liggen.', veld: 'desinvesteringDatum' };
    if (body.desinvesteringDatum > opties.vandaag) return { ok: false, fout: 'De desinvestering ligt in de toekomst.', veld: 'desinvesteringDatum' };
    desinvesteringDatum = body.desinvesteringDatum;
    const o = body.desinvesteringOpbrengst === undefined || body.desinvesteringOpbrengst === null || body.desinvesteringOpbrengst === '' ? 0 : bedragUit(body.desinvesteringOpbrengst);
    if (o === null || o < 0 || o > MAX_CENTEN) return { ok: false, fout: 'Ongeldige opbrengst.', veld: 'desinvesteringOpbrengst' };
    desinvesteringOpbrengst = o;
  }
  const notities = typeof body.notities === 'string' ? body.notities.trim().slice(0, 2000) || null : null;

  return {
    ok: true,
    waarde: {
      omschrijving,
      categorie,
      aanschafdatum,
      ingebruikname,
      aanschaf,
      restwaarde: rw,
      looptijdMaanden: looptijd,
      uitgaveId,
      boekingId,
      desinvesteringDatum,
      desinvesteringOpbrengst,
      notities
    }
  };
}

/** Een activum als invoer (om een wijziging erop te leggen). */
export function activumAlsInvoer(a: Activum): Record<string, unknown> {
  return {
    omschrijving: a.omschrijving,
    categorie: a.categorie,
    aanschafdatum: a.aanschafdatum,
    ingebruikname: a.ingebruikname,
    aanschaf: a.aanschaf,
    restwaarde: a.restwaarde,
    looptijdMaanden: a.looptijdMaanden,
    uitgaveId: a.uitgaveId,
    boekingId: a.boekingId,
    desinvesteringDatum: a.desinvesteringDatum,
    desinvesteringOpbrengst: a.desinvesteringOpbrengst,
    notities: a.notities
  };
}

/** Velden die de afschrijving (en dus afgesloten jaren) bepalen; zelfde lijst als de trigger in 0027. */
export function afschrijvingGewijzigd(oud: Activum, nieuw: ActivumWaarde): boolean {
  return (
    oud.aanschaf !== nieuw.aanschaf ||
    oud.restwaarde !== nieuw.restwaarde ||
    oud.looptijdMaanden !== nieuw.looptijdMaanden ||
    oud.ingebruikname !== nieuw.ingebruikname ||
    oud.categorie !== nieuw.categorie
  );
}

/**
 * Mag deze wijziging in de huidige vergrendeling? Zelfde regel als de trigger bk_activa_periode:
 *   - aanschaf/restwaarde/looptijd/ingebruikname/soort wijzigen of verwijderen: niet als een
 *     boekjaar vanaf de ingebruikname is afgesloten (de afschrijving van dat jaar ligt vast);
 *   - desinvestering zetten of wijzigen: alleen in een open periode.
 */
export function activumVergrendelFout(
  oud: Activum | null,
  nieuw: ActivumWaarde | null,
  v: { boekjaren: number[]; open: (d: Datum) => boolean }
): string | null {
  const jaarDicht = (vanaf: Datum) => v.boekjaren.some((j) => j >= jaarVan(vanaf));
  if (!oud && nieuw) {
    if (jaarDicht(nieuw.ingebruikname)) return 'Er is een boekjaar afgesloten vanaf de ingebruikname; dit activum kan daar niet meer bij.';
    if (nieuw.desinvesteringDatum && !v.open(nieuw.desinvesteringDatum)) return 'De periode van de desinvestering is vergrendeld.';
    return null;
  }
  if (oud && (!nieuw || afschrijvingGewijzigd(oud, nieuw))) {
    const vanaf = nieuw && nieuw.ingebruikname < oud.ingebruikname ? nieuw.ingebruikname : oud.ingebruikname;
    if (jaarDicht(vanaf)) return 'Een boekjaar met afschrijvingen van dit activum is afgesloten; aanschaf, termijn en ingebruikname liggen vast.';
  }
  if (oud && nieuw && (nieuw.desinvesteringDatum ?? null) !== (oud.desinvesteringDatum ?? null)) {
    const d = nieuw.desinvesteringDatum ?? oud.desinvesteringDatum;
    if (d && !v.open(d)) return 'De periode van de desinvestering is vergrendeld (aangifte ingediend of boekjaar afgesloten).';
  }
  return null;
}
