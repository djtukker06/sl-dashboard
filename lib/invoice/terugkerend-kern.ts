import { parseBedrag } from '../format';

// Terugkerende facturen (migratie 0036), het rekenwerk zonder database: planning (welke
// datum is de volgende), de periode van een factuur ("november 2026"), de placeholders in
// teksten en het controleren van wat het formulier verstuurt. Zonder @/-imports, zodat
// scripts/test-terugkerend.mjs dit direct kan testen. De database en het versturen staan in
// lib/invoice/terugkerend.ts.

export type Interval = 'maand' | 'kwartaal' | 'jaar';
export const INTERVALLEN: Interval[] = ['maand', 'kwartaal', 'jaar'];
export const INTERVAL_LABEL: Record<Interval, string> = {
  maand: 'Elke maand',
  kwartaal: 'Elk kwartaal',
  jaar: 'Elk jaar'
};
const STAP: Record<Interval, number> = { maand: 1, kwartaal: 3, jaar: 12 };

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

function delen(datum: string): [number, number, number] {
  const m = DATUM.exec(datum);
  if (!m) throw new Error(`Ongeldige datum: ${datum}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const tweeCijfers = (n: number) => String(n).padStart(2, '0');
const maakDatum = (j: number, m: number, d: number) => `${j}-${tweeCijfers(m)}-${tweeCijfers(d)}`;

export function isEchteDatum(s: unknown): s is string {
  if (typeof s !== 'string' || !DATUM.test(s)) return false;
  const [j, m, d] = delen(s);
  const t = new Date(Date.UTC(j, m - 1, d));
  return t.getUTCFullYear() === j && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && j >= 2000 && j <= 2100;
}

/** De datum `stappen` intervallen later, op dag `dag` (1–28, dus elke maand geldig). */
export function schuifOp(datum: string, interval: Interval, dag: number, stappen = 1): string {
  const [j, m] = delen(datum);
  const index = j * 12 + (m - 1) + STAP[interval] * stappen;
  return maakDatum(Math.floor(index / 12), (index % 12) + 1, dag);
}

/**
 * De eerste geplande datum vanaf `vanaf` (meestal vandaag): dag `dag` van deze maand als die
 * nog niet voorbij is, anders van de volgende maand. Kwartaal en jaar tellen vanaf die
 * eerste datum (een kwartaal dat in november begint: nov, feb, mei, aug).
 */
export function eersteDatum(vanaf: string, dag: number): string {
  const [j, m, d] = delen(vanaf);
  return d <= dag ? maakDatum(j, m, dag) : schuifOp(maakDatum(j, m, dag), 'maand', dag);
}

const MAANDEN_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** "2026-12-01" → "1 dec 2026" (voor de lijsten). */
export function datumKort(d: string): string {
  return `${Number(d.slice(8, 10))} ${MAANDEN_KORT[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

/** "Elke maand op de 1e", "Elk kwartaal op de 15e". */
export function ritme(interval: Interval, dag: number): string {
  return `${INTERVAL_LABEL[interval]} op de ${dag}e`;
}

/** De naam van de periode, voor {periodenaam} en de lijst: "november 2026", "Q4 2026", "2026". */
export function periodeLabel(datum: string, interval: Interval): string {
  const [j, m] = delen(datum);
  if (interval === 'jaar') return String(j);
  if (interval === 'kwartaal') return `Q${Math.floor((m - 1) / 3) + 1} ${j}`;
  return `${MAANDEN[m - 1]} ${j}`;
}

/** De laatste dag van de periode die op `datum` begint (de dag vóór de volgende factuur). */
export function eindVanPeriode(datum: string, interval: Interval, dag: number): string {
  const [j, m, d] = delen(schuifOp(datum, interval, dag));
  const t = new Date(Date.UTC(j, m - 1, d - 1));
  return maakDatum(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** "2026-12-01" → "1/12/2026". */
export function datumKortNL(datum: string): string {
  const [j, m, d] = delen(datum);
  return `${d}/${m}/${j}`;
}

/** De periode als bereik, voor {periode} (standaard in de middelste kolom): "1/12/2026 t/m 31/12/2026". */
export function periodeBereik(datum: string, interval: Interval, dag: number): string {
  return `${datumKortNL(datum)} t/m ${datumKortNL(eindVanPeriode(datum, interval, dag))}`;
}

export interface Placeholders {
  datum: string;
  interval: Interval;
  /** Dag van de maand (voor het einde van {periode}); standaard de dag van `datum`. */
  dag?: number;
  factuurnummer?: string;
  bedrag?: string;
  klant?: string;
}

/** Tekst waarin deze placeholders vervangen worden (naam, regels, onderwerp, bericht). */
export const PLACEHOLDERS = ['{periode}', '{periodenaam}', '{maand}', '{kwartaal}', '{jaar}', '{factuurnummer}', '{bedrag}', '{klant}'];

export function vulIn(tekst: string, p: Placeholders): string {
  const [j, m] = delen(p.datum);
  const waarden: Record<string, string> = {
    periode: periodeBereik(p.datum, p.interval, p.dag ?? delen(p.datum)[2]),
    periodenaam: periodeLabel(p.datum, p.interval),
    maand: MAANDEN[m - 1],
    kwartaal: `Q${Math.floor((m - 1) / 3) + 1}`,
    jaar: String(j),
    factuurnummer: p.factuurnummer ?? '{factuurnummer}',
    bedrag: p.bedrag ?? '{bedrag}',
    klant: p.klant ?? '{klant}'
  };
  // Hoofdletters maken niet uit: {Factuurnummer} werkt net zo goed als {factuurnummer}.
  return tekst.replace(/\{(periodenaam|periode|maand|kwartaal|jaar|factuurnummer|bedrag|klant)\}/gi, (_, k: string) => waarden[k.toLowerCase()]);
}

/** Staat {factuurnummer} in deze tekst (ongeacht hoofdletters)? */
export const metFactuurnummer = (tekst: string): boolean => /\{factuurnummer\}/i.test(tekst);

/**
 * De naam van een gemaakte factuur (bestandsnaam van de PDF en de naam in de lijst). Met
 * {factuurnummer} in de naam bepaal je hem helemaal zelf ("Factuur {factuurnummer}"); zonder
 * komt het nummer ervoor, zoals altijd ("Factuur 26-031 · Onderhoudspakket").
 */
export function factuurNaam(naam: string, p: Placeholders & { factuurnummer: string }): string {
  const ingevuld = vulIn(naam, p).trim();
  return (metFactuurnummer(naam) ? ingevuld : `Factuur ${p.factuurnummer} · ${ingevuld}`).slice(0, 200);
}

export const STANDAARD_ONDERWERP = 'Factuur {factuurnummer} – {periodenaam}';
export const STANDAARD_BERICHT =
  'Beste {klant},\n\nIn de bijlage vind je factuur {factuurnummer} voor {periodenaam}, met een totaalbedrag van {bedrag}.\n\nWe verzoeken je het bedrag binnen 14 dagen over te maken onder vermelding van het factuurnummer.';

export interface TerugkerendRegel {
  beschrijving: string;
  midden: string;
  totaal: number;
  teltMeeInOmzet: boolean;
}

/** Wat er in terugkerende_facturen komt (zonder id, klant en de bijgehouden velden). */
export interface TerugkerendWaarde {
  naam: string;
  regels: TerugkerendRegel[];
  midden_kolom_label: string;
  btw_verlegd: boolean;
  btw_verlegd_als: 'verlegd' | 'nvt';
  btw_verlegd_reden: string;
  interval: Interval;
  dag: number;
  volgende_datum: string;
  eind_datum: string | null;
  actief: boolean;
  versturen: boolean;
  email_aan: string;
  email_cc: string;
  mailbox_id: string;
  onderwerp: string;
  bericht: string;
  akkoord_vereist: boolean;
}

/** De klantgegevens zoals in het factuurformulier; de server legt ze vast bij de klant (upsert op naam). */
export interface TerugkerendKlant {
  bedrijfsnaam: string;
  tav: string;
  adres: string;
  postcode: string;
}

export interface TerugkerendInvoer {
  klant?: unknown;
  naam?: unknown;
  regels?: unknown;
  middenKolomLabel?: unknown;
  btwVerlegd?: unknown;
  btwVerlegdAls?: unknown;
  btwVerlegdReden?: unknown;
  interval?: unknown;
  dag?: unknown;
  volgendeDatum?: unknown;
  eindDatum?: unknown;
  actief?: unknown;
  versturen?: unknown;
  emailAan?: unknown;
  emailCc?: unknown;
  mailboxId?: unknown;
  onderwerp?: unknown;
  bericht?: unknown;
  akkoordVereist?: unknown;
}

export type Resultaat<T> = { ok: true; waarde: T } | { ok: false; fout: string; veld?: string };

const ADRES = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;

function tekst(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const t = v.replace(/\r\n?/g, '\n').trim();
  return t.length > max ? null : t;
}

/** "a@b.nl, c@d.nl; e@f.nl" → "a@b.nl, c@d.nl, e@f.nl", of null bij een ongeldig adres. */
export function parseAdreslijst(v: string): string | null {
  const adressen = v
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  if (adressen.length > 10 || adressen.some((a) => !ADRES.test(a))) return null;
  return adressen.join(', ');
}

/**
 * Controleert het formulier. `vandaag` (YYYY-MM-DD, Nederlandse tijd) is de ondergrens voor
 * de eerstvolgende datum bij een nieuw of hervat sjabloon; een bestaande datum in het
 * verleden die niet verandert (`huidigeDatum`) blijft toegestaan.
 */
export function parseTerugkerend(
  body: TerugkerendInvoer,
  opties: { vandaag: string; huidigeDatum?: string | null }
): Resultaat<{ sjabloon: TerugkerendWaarde; klant: TerugkerendKlant }> {
  if (!body || typeof body !== 'object') return { ok: false, fout: 'Ongeldige invoer.' };

  const k = (body.klant && typeof body.klant === 'object' ? body.klant : {}) as Record<string, unknown>;
  const klant = {
    bedrijfsnaam: tekst(k.bedrijfsnaam, 200),
    tav: tekst(k.tav, 200),
    adres: tekst(k.adres, 300),
    postcode: tekst(k.postcode, 20)
  };
  if (klant.bedrijfsnaam === null || klant.tav === null || klant.adres === null || klant.postcode === null) {
    return {
      ok: false,
      fout: 'Een van de klantgegevens is te lang.',
      veld: 'klant'
    };
  }
  if (!klant.bedrijfsnaam) return { ok: false, fout: 'Vul de klant in.', veld: 'klant' };

  const naam = tekst(body.naam, 200);
  if (!naam)
    return {
      ok: false,
      fout: 'Geef de terugkerende factuur een naam, bijvoorbeeld "Onderhoudspakket".',
      veld: 'naam'
    };

  if (!Array.isArray(body.regels) || body.regels.length > 50) return { ok: false, fout: 'Ongeldige factuurregels.', veld: 'regels' };
  const regels: TerugkerendRegel[] = [];
  for (const r of body.regels as Record<string, unknown>[]) {
    const beschrijving = tekst(r?.beschrijving, 500);
    const midden = tekst(r?.midden, 100);
    if (beschrijving === null || midden === null)
      return {
        ok: false,
        fout: 'Een factuurregel is te lang.',
        veld: 'regels'
      };
    if (!beschrijving) continue;
    const totaal = typeof r.totaal === 'number' ? r.totaal : parseBedrag(String(r.totaal ?? ''));
    if (!Number.isFinite(totaal) || Math.abs(totaal) > 10_000_000)
      return {
        ok: false,
        fout: `Ongeldig bedrag bij "${beschrijving}".`,
        veld: 'regels'
      };
    regels.push({
      beschrijving,
      midden,
      totaal: Math.round(totaal * 100) / 100,
      teltMeeInOmzet: r.teltMeeInOmzet !== false
    });
  }
  if (!regels.length)
    return {
      ok: false,
      fout: 'Voeg minimaal één factuurregel toe.',
      veld: 'regels'
    };

  const middenKolomLabel = tekst(body.middenKolomLabel, 100);
  if (middenKolomLabel === null) return { ok: false, fout: 'De naam van de middelste kolom is te lang.' };

  const btwVerlegd = body.btwVerlegd === true;
  const btwVerlegdReden = btwVerlegd ? tekst(body.btwVerlegdReden, 500) : '';
  if (btwVerlegdReden === null) return { ok: false, fout: 'De reden voor verlegde btw is te lang.' };

  const interval = INTERVALLEN.includes(body.interval as Interval) ? (body.interval as Interval) : null;
  if (!interval)
    return {
      ok: false,
      fout: 'Kies hoe vaak de factuur terugkomt.',
      veld: 'interval'
    };

  const dag = Number(body.dag);
  if (!Number.isInteger(dag) || dag < 1 || dag > 28) return { ok: false, fout: 'Kies een dag tussen 1 en 28.', veld: 'dag' };

  if (!isEchteDatum(body.volgendeDatum))
    return {
      ok: false,
      fout: 'Kies de datum van de eerstvolgende factuur.',
      veld: 'volgendeDatum'
    };
  const volgende = body.volgendeDatum;
  const ongewijzigd = opties.huidigeDatum != null && volgende === opties.huidigeDatum;
  if (volgende < opties.vandaag && !ongewijzigd)
    return {
      ok: false,
      fout: 'De eerstvolgende factuur kan niet in het verleden liggen.',
      veld: 'volgendeDatum'
    };
  if (Number(volgende.slice(8, 10)) !== dag)
    return {
      ok: false,
      fout: `De eerstvolgende datum moet op dag ${dag} van de maand vallen.`,
      veld: 'volgendeDatum'
    };

  let eind: string | null = null;
  if (body.eindDatum !== undefined && body.eindDatum !== null && body.eindDatum !== '') {
    if (!isEchteDatum(body.eindDatum)) return { ok: false, fout: 'Ongeldige einddatum.', veld: 'eindDatum' };
    if (body.eindDatum < volgende)
      return {
        ok: false,
        fout: 'De einddatum ligt vóór de eerstvolgende factuur.',
        veld: 'eindDatum'
      };
    eind = body.eindDatum;
  }

  const versturen = body.versturen === true;
  const aanRuw = tekst(body.emailAan, 1000);
  const ccRuw = tekst(body.emailCc, 1000);
  const onderwerp = tekst(body.onderwerp, 300);
  const bericht = tekst(body.bericht, 5000);
  const mailboxId = tekst(body.mailboxId, 100);
  if (aanRuw === null || ccRuw === null || onderwerp === null || bericht === null || mailboxId === null) {
    return { ok: false, fout: 'Een van de e-mailvelden is te lang.' };
  }
  const aan = parseAdreslijst(aanRuw);
  const cc = parseAdreslijst(ccRuw);
  if (aan === null)
    return {
      ok: false,
      fout: 'Een e-mailadres bij "Aan" klopt niet.',
      veld: 'emailAan'
    };
  if (cc === null)
    return {
      ok: false,
      fout: 'Een e-mailadres bij "Cc" klopt niet.',
      veld: 'emailCc'
    };
  if (versturen) {
    if (!aan)
      return {
        ok: false,
        fout: 'Vul het e-mailadres in waar de factuur naartoe moet.',
        veld: 'emailAan'
      };
    if (!mailboxId)
      return {
        ok: false,
        fout: 'Kies vanaf welke inbox de factuur verstuurd wordt.',
        veld: 'mailboxId'
      };
  }

  return {
    ok: true,
    waarde: {
      klant: klant as TerugkerendKlant,
      sjabloon: {
        naam,
        regels,
        midden_kolom_label: middenKolomLabel,
        btw_verlegd: btwVerlegd,
        btw_verlegd_als: body.btwVerlegdAls === 'nvt' ? 'nvt' : 'verlegd',
        btw_verlegd_reden: btwVerlegdReden,
        interval,
        dag,
        volgende_datum: volgende,
        eind_datum: eind,
        actief: body.actief !== false,
        versturen,
        email_aan: aan,
        email_cc: cc,
        mailbox_id: mailboxId,
        onderwerp: onderwerp || STANDAARD_ONDERWERP,
        bericht: bericht || STANDAARD_BERICHT,
        akkoord_vereist: body.akkoordVereist !== false
      }
    }
  };
}

/** Is dit sjabloon vandaag aan de beurt (en niet voorbij de einddatum)? */
export function isAanDeBeurt(t: { actief: boolean; volgende_datum: string; eind_datum: string | null }, vandaag: string): boolean {
  return t.actief && t.volgende_datum <= vandaag && (t.eind_datum === null || t.volgende_datum <= t.eind_datum);
}

/** Na het aanmaken: de volgende datum, en of het sjabloon daarna stopt (voorbij de einddatum). */
export function naUitvoeren(t: { interval: Interval; dag: number; volgende_datum: string; eind_datum: string | null }): {
  volgende: string;
  klaar: boolean;
} {
  const volgende = schuifOp(t.volgende_datum, t.interval, t.dag);
  return { volgende, klaar: t.eind_datum !== null && volgende > t.eind_datum };
}

/** Bedrag excl. btw van de regels (voor de lijst). */
export function subtotaal(regels: TerugkerendRegel[]): number {
  return Math.round(regels.reduce((s, r) => s + r.totaal, 0) * 100) / 100;
}

/** Bij hervatten: de eerste geplande datum vanaf vandaag in hetzelfde ritme (gemiste periodes vervallen). */
export function inhalen(datum: string, interval: Interval, dag: number, vandaag: string): string {
  let d = datum;
  for (let i = 0; d < vandaag && i < 1200; i++) d = schuifOp(d, interval, dag);
  return d;
}

/** Vanaf hoeveel dagen van tevoren de app om akkoord vraagt (migratie 0038). */
export const AKKOORD_VOORAF_DAGEN = 7;

/** Aantal dagen van `van` tot `tot` (YYYY-MM-DD), negatief als `tot` eerder is. */
export function dagenTussen(van: string, tot: string): number {
  const [j1, m1, d1] = delen(van);
  const [j2, m2, d2] = delen(tot);
  return Math.round((Date.UTC(j2, m2 - 1, d2) - Date.UTC(j1, m1 - 1, d1)) / 86_400_000);
}

export type AkkoordStand = 'niet_nodig' | 'akkoord' | 'gevraagd' | 'later';

/**
 * Akkoord vooraf voor de eerstvolgende factuur:
 *   niet_nodig  vinkje uit, gepauzeerd, of hij wordt niet verstuurd;
 *   akkoord     goedgekeurd voor precies deze geplande datum;
 *   gevraagd    binnen een week (of al voorbij) en nog niet goedgekeurd: in de melding;
 *   later       meer dan een week weg; goedkeuren mag al wel.
 */
export function akkoordStand(
  t: { actief: boolean; versturen: boolean; akkoord_vereist?: boolean | null; akkoord_periode?: string | null; volgende_datum: string },
  vandaag: string
): AkkoordStand {
  if (!t.actief || !t.versturen || t.akkoord_vereist !== true) return 'niet_nodig';
  if (t.akkoord_periode === t.volgende_datum) return 'akkoord';
  return dagenTussen(vandaag, t.volgende_datum) <= AKKOORD_VOORAF_DAGEN ? 'gevraagd' : 'later';
}
