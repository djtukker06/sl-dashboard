// Snelinvoer voor taken en afspraken: herkent Nederlandse datums, tijden, duur,
// prioriteit en klant in één regel tekst. Pure functie (geen netwerk, geen klok):
// de aanroeper geeft "vandaag" (Amsterdamse kalenderdag) mee.
// Bewust zonder imports, zodat scripts/test-snelinvoer.mjs dit bestand direct laadt.
//
//   "Offerte sturen @Jansen vrijdag 14:00 !"
//     → taak "Offerte sturen", eerstvolgende vrijdag 14:00, prioriteit hoog, klant "Jansen"
//   "afspraak Kennismaking morgen 10:00-11:00"
//     → afspraak "Kennismaking", morgen 10:00–11:00
//
// Wat herkend is, verdwijnt uit de titel en komt als token (chip) terug. Met `negeer`
// kan de gebruiker een herkenning ongedaan maken (de × op een chip): dat soort wordt
// dan niet herkend en blijft gewoon tekst.

export type TokenSoort = 'soort' | 'datum' | 'tijd' | 'duur' | 'prioriteit' | 'klant';

export interface SnelToken {
  soort: TokenSoort;
  /** De oorspronkelijke tekst, bv. "vrijdag" of "@Jansen". */
  tekst: string;
  /** Wat de chip toont, bv. "vr 23 okt" of "14:00–15:30". */
  label: string;
}

export interface SnelResultaat {
  soort: 'taak' | 'afspraak';
  titel: string;
  /** 'YYYY-MM-DD' of null (geen datum genoemd). */
  datum: string | null;
  /** 'HH:MM' of null. */
  tijd: string | null;
  /** Alleen bij een tijdvak, 'HH:MM'. */
  eindTijd: string | null;
  /** Minuten (uit "1u", "90m" of afgeleid van een tijdvak). */
  duur: number | null;
  /** 1 = hoog, 3 = laag; null = niet genoemd (normaal). */
  prioriteit: 1 | 3 | null;
  /** Klantnaam zoals getypt achter @ (zonder @). */
  klant: string | null;
  tokens: SnelToken[];
}

export interface SnelOpties {
  /** Soorten die niet herkend mogen worden (chip weggeklikt). */
  negeer?: TokenSoort[];
}

// ---------- datumhulpjes (los van lib/agenda/datum.ts, zie boven) ----------

const DAG_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const delen = (dag: string) => dag.split('-').map(Number) as [number, number, number];
const maak = (j: number, m: number, d: number) => `${j}-${pad(m)}-${pad(d)}`;
function plus(dag: string, n: number): string {
  const [j, m, d] = delen(dag);
  const t = new Date(Date.UTC(j, m - 1, d + n));
  return maak(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function weekdag(dag: string): number {
  const [j, m, d] = delen(dag);
  return (new Date(Date.UTC(j, m - 1, d)).getUTCDay() + 6) % 7; // 0 = maandag
}
function geldig(j: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(j, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function verschil(a: string, b: string): number {
  const [x, y, z] = delen(a);
  const [p, q, r] = delen(b);
  return Math.round((Date.UTC(p, q - 1, r) - Date.UTC(x, y - 1, z)) / DAG_MS);
}

const DAGEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
const DAGEN_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const MAANDEN_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MAAND_WOORDEN: Record<string, number> = {
  januari: 1, jan: 1,
  februari: 2, feb: 2, febr: 2,
  maart: 3, mrt: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  augustus: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12
};

/** Chiplabel voor een datum: "vandaag", "morgen", anders "vr 23 okt" (+ jaar). */
export function datumLabel(dag: string, ref: string): string {
  const v = verschil(ref, dag);
  if (v === 0) return 'vandaag';
  if (v === 1) return 'morgen';
  const [j, m, d] = delen(dag);
  const jaar = delen(ref)[0] !== j ? ` ${j}` : '';
  return `${DAGEN_KORT[weekdag(dag)]} ${d} ${MAANDEN_KORT[m - 1]}${jaar}`;
}

function duurLabel(min: number): string {
  const u = Math.floor(min / 60);
  const m = min % 60;
  return !u ? `${m} min` : m ? `${u} u ${m} min` : `${u} u`;
}

function tijd(u: number, m: number): string | null {
  if (!Number.isInteger(u) || !Number.isInteger(m) || u < 0 || u > 23 || m < 0 || m > 59) return null;
  return `${pad(u)}:${pad(m)}`;
}
const naarMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// ---------- parser ----------

// Woordgrenzen die ook met letters als é werken.
const V = '(?<![\\p{L}\\p{N}@])';
const A = '(?![\\p{L}\\p{N}])';
// Tijd met minuten: 14:00, 14.30, 9:05; of uren met "u": 14u, 14u30.
const T_MIN = '(\\d{1,2})[:.](\\d{2})';

interface Treffer {
  start: number;
  eind: number;
}

export function parseSnelinvoer(invoer: string, vandaag: string, opties: SnelOpties = {}): SnelResultaat {
  const negeer = new Set(opties.negeer ?? []);
  // We maskeren herkende stukken met spaties, zodat posities kloppen en
  // latere herkenningen niet in eerder herkende tekst zoeken.
  let werk = invoer;
  const weg: Treffer[] = [];
  const tokens: SnelToken[] = [];
  const res: SnelResultaat = {
    soort: 'taak',
    titel: '',
    datum: null,
    tijd: null,
    eindTijd: null,
    duur: null,
    prioriteit: null,
    klant: null,
    tokens
  };

  /** Zoek de eerste geldige treffer van `re`; `ok` mag een treffer afkeuren (return false). */
  function zoek(re: RegExp, ok: (m: RegExpExecArray) => boolean): RegExpExecArray | null {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = r.exec(werk))) {
      if (ok(m)) {
        weg.push({ start: m.index, eind: m.index + m[0].length });
        werk = werk.slice(0, m.index) + ' '.repeat(m[0].length) + werk.slice(m.index + m[0].length);
        return m;
      }
      if (m[0].length === 0) r.lastIndex++;
    }
    return null;
  }

  // 1. "afspraak …" / "taak …" aan het begin.
  if (!negeer.has('soort')) {
    const m = zoek(/^\s*(afspraak|taak)\s*:?(?=\s|$)/iu, () => true);
    if (m) {
      res.soort = m[1].toLowerCase() === 'afspraak' ? 'afspraak' : 'taak';
      tokens.push({ soort: 'soort', tekst: m[0].trim(), label: res.soort === 'afspraak' ? 'Afspraak' : 'Taak' });
    }
  }

  // 2. Tijdvak: 14:00-15:30, 14-15:30, van 14:00 tot 15:00. Maakt er een afspraak van.
  if (!negeer.has('tijd')) {
    const deel = `(\\d{1,2})(?:[:.](\\d{2}))?`;
    const re = new RegExp(`${V}(?:van\\s+)?${deel}\\s*(?:-|–|tot)\\s*${deel}(?:\\s*uur)?${A}`, 'iu');
    const m = zoek(re, (x) => {
      // Minstens één kant met minuten (anders is "10-11" een datum), of expliciet "van … tot".
      if (x[2] === undefined && x[4] === undefined && !/^van\s/i.test(x[0])) return false;
      const a = tijd(Number(x[1]), Number(x[2] ?? 0));
      const b = tijd(Number(x[3]), Number(x[4] ?? 0));
      return !!a && !!b;
    });
    if (m) {
      const a = tijd(Number(m[1]), Number(m[2] ?? 0))!;
      const b = tijd(Number(m[3]), Number(m[4] ?? 0))!;
      res.tijd = a;
      res.eindTijd = b;
      let d = naarMin(b) - naarMin(a);
      if (d <= 0) d += 1440; // over middernacht
      res.duur = d;
      if (!tokens.some((t) => t.soort === 'soort')) res.soort = 'afspraak';
      tokens.push({ soort: 'tijd', tekst: m[0].trim(), label: `${a}–${b}` });
    }
  }

  // 3. Duur: 1u, 1,5 uur, 1u30, 90m, 45 min, 2 uur (≤ 4 uur; "14u" is een tijd).
  if (!negeer.has('duur')) {
    const re = new RegExp(
      `${V}(?:(\\d{1,2})(?:[,.](\\d))?\\s*(?:u|uur)(?:\\s*(\\d{2}))?|(\\d{1,3})\\s*(?:m|min|mins|minuten|minuut))${A}`,
      'iu'
    );
    const m = zoek(re, (x) => {
      // "om 2 uur" is een tijd.
      const voor = werk.slice(Math.max(0, x.index - 4), x.index);
      if (/om\s+$/i.test(voor)) return false;
      if (x[4] !== undefined) {
        const n = Number(x[4]);
        return n >= 5 && n <= 600;
      }
      const u = Number(x[1]);
      if (u < 1 || u > 4) return false;
      return true;
    });
    if (m) {
      const min =
        m[4] !== undefined
          ? Number(m[4])
          : Number(m[1]) * 60 + (m[2] !== undefined ? Number(m[2]) * 6 : 0) + (m[3] !== undefined ? Number(m[3]) : 0);
      if (min >= 5 && min <= 1440) {
        if (res.duur === null) res.duur = min;
        tokens.push({ soort: 'duur', tekst: m[0].trim(), label: duurLabel(min) });
      }
    }
  }

  // 4. Tijd: om 14, om 14:30, 14:00, 14.30, 14u, 14u30, 14 uur, 9 uur 's ochtends niet nodig.
  if (!negeer.has('tijd') && res.tijd === null) {
    const re = new RegExp(
      `${V}(?:om\\s+(\\d{1,2})(?:[:.u](\\d{2}))?(?:\\s*uur)?|${T_MIN}(?:\\s*uur)?|(\\d{1,2})\\s*(?:u|uur)(\\d{2})?)${A}`,
      'iu'
    );
    const m = zoek(re, (x) => {
      if (x[1] !== undefined) return !!tijd(Number(x[1]), Number(x[2] ?? 0));
      if (x[3] !== undefined) return !!tijd(Number(x[3]), Number(x[4]));
      const u = Number(x[5]);
      return u >= 5 && !!tijd(u, Number(x[6] ?? 0));
    });
    if (m) {
      const t =
        m[1] !== undefined
          ? tijd(Number(m[1]), Number(m[2] ?? 0))!
          : m[3] !== undefined
            ? tijd(Number(m[3]), Number(m[4]))!
            : tijd(Number(m[5]), Number(m[6] ?? 0))!;
      res.tijd = t;
      tokens.push({ soort: 'tijd', tekst: m[0].trim(), label: t });
    }
  }

  // 5. Datum.
  if (!negeer.has('datum')) {
    const datum = vindDatum();
    if (datum) {
      res.datum = datum.dag;
      tokens.push({ soort: 'datum', tekst: datum.tekst, label: datumLabel(datum.dag, vandaag) });
    }
  }

  // 6. Prioriteit: losse ! of !!, of !hoog / !laag / !normaal.
  if (!negeer.has('prioriteit')) {
    const m = zoek(/(?<!\S)(!!?|!hoog|!laag|!normaal)(?!\S)/iu, () => true);
    if (m) {
      const w = m[1].toLowerCase();
      res.prioriteit = w === '!laag' ? 3 : w === '!normaal' ? null : 1;
      tokens.push({
        soort: 'prioriteit',
        tekst: m[0],
        label: w === '!laag' ? 'Lage prioriteit' : w === '!normaal' ? 'Normale prioriteit' : 'Hoge prioriteit'
      });
    }
  }

  // 7. Klant: @Jansen, @Bakker-BV, @"De Vries Bouw".
  if (!negeer.has('klant')) {
    const m = zoek(/(?<!\S)@(?:"([^"]+)"|([\p{L}\p{N}][\p{L}\p{N}&._'-]*))/iu, () => true);
    if (m) {
      const naam = (m[1] ?? m[2]).trim().replace(/[.,;:]+$/, '');
      if (naam) {
        res.klant = naam;
        tokens.push({ soort: 'klant', tekst: m[0], label: naam });
      }
    }
  }

  // Afleidingen.
  if (res.tijd && !res.datum) res.datum = vandaag; // "14:00" zonder dag = vandaag
  if (res.tijd && res.duur && !res.eindTijd && res.soort === 'afspraak') {
    res.eindTijd = minNaarTijd(naarMin(res.tijd) + res.duur);
  }

  // Titel: alles wat niet herkend is, opgeschoond.
  let titel = '';
  let pos = 0;
  for (const t of [...weg].sort((a, b) => a.start - b.start)) {
    titel += invoer.slice(pos, t.start) + ' ';
    pos = t.eind;
  }
  titel += invoer.slice(pos);
  titel = titel
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(^|\s)(op|om|voor|aan|tot|van)$/i, '') // losse voorzetsels aan het eind ("… op")
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '')
    .trim();
  if (titel) titel = titel.charAt(0).toLocaleUpperCase('nl-NL') + titel.slice(1);
  res.titel = titel;
  return res;

  // ---------- datumherkenning ----------
  function vindDatum(): { dag: string; tekst: string } | null {
    const op = '(?:op\\s+)?';

    // vandaag / morgen / overmorgen
    let m = zoek(new RegExp(`${V}${op}(vandaag|morgen|overmorgen)${A}`, 'iu'), () => true);
    if (m) {
      const w = m[1].toLowerCase();
      return { dag: plus(vandaag, w === 'vandaag' ? 0 : w === 'morgen' ? 1 : 2), tekst: m[0].trim() };
    }

    // over 3 dagen / over 2 weken / over een week
    m = zoek(new RegExp(`${V}over\\s+(\\d{1,3}|een|één|twee|drie)\\s+(dag|dagen|week|weken)${A}`, 'iu'), () => true);
    if (m) {
      const woord: Record<string, number> = { een: 1, één: 1, twee: 2, drie: 3 };
      const n = woord[m[1].toLowerCase()] ?? Number(m[1]);
      const factor = m[2].toLowerCase().startsWith('w') ? 7 : 1;
      return { dag: plus(vandaag, n * factor), tekst: m[0].trim() };
    }

    const dagRe = `(${DAGEN.join('|')}|${DAGEN_KORT.join('|')})\\.?`;
    const dagIndex = (w: string) => {
      const s = w.toLowerCase().replace('.', '');
      const i = DAGEN.indexOf(s);
      return i >= 0 ? i : DAGEN_KORT.indexOf(s);
    };

    // volgende week (dinsdag)
    m = zoek(new RegExp(`${V}${op}volgende\\s+week(?:\\s+${dagRe})?${A}`, 'iu'), () => true);
    if (m) {
      const maandag = plus(vandaag, 7 - weekdag(vandaag));
      return { dag: plus(maandag, m[1] ? dagIndex(m[1]) : 0), tekst: m[0].trim() };
    }
    // volgende dinsdag = dinsdag van volgende week
    m = zoek(new RegExp(`${V}${op}volgende\\s+${dagRe}${A}`, 'iu'), () => true);
    if (m) {
      const maandag = plus(vandaag, 7 - weekdag(vandaag));
      return { dag: plus(maandag, dagIndex(m[1])), tekst: m[0].trim() };
    }

    // 12 nov, 12 november, 12 nov 2026 (eventueel met dagnaam ervoor: "vr 13 nov")
    const maandRe = Object.keys(MAAND_WOORDEN).sort((a, b) => b.length - a.length).join('|');
    m = zoek(
      new RegExp(`${V}${op}(?:${dagRe}\\s+)?(\\d{1,2})\\s+(${maandRe})\\.?(?:\\s+(\\d{4}))?${A}`, 'iu'),
      (x) => {
        const d = Number(x[2]);
        const mnd = MAAND_WOORDEN[x[3].toLowerCase()];
        const j = x[4] ? Number(x[4]) : Number(vandaag.slice(0, 4));
        return geldig(j, mnd, d);
      }
    );
    if (m) {
      const d = Number(m[2]);
      const mnd = MAAND_WOORDEN[m[3].toLowerCase()];
      return { dag: jaarErbij(d, mnd, m[4]), tekst: m[0].trim() };
    }

    // 22-10, 22/10, 22/10/2026, 22-10-26
    m = zoek(new RegExp(`${V}${op}(\\d{1,2})[-/](\\d{1,2})(?:[-/](\\d{4}|\\d{2}))?${A}`, 'iu'), (x) => {
      const j = x[3] ? volJaar(x[3]) : Number(vandaag.slice(0, 4));
      return geldig(j, Number(x[2]), Number(x[1]));
    });
    if (m) return { dag: jaarErbij(Number(m[1]), Number(m[2]), m[3]), tekst: m[0].trim() };

    // Dagnaam (eerstvolgende, dus 1–7 dagen vooruit). Afkortingen als "ma", "do" en "zo"
    // zijn ook gewone woorden; die tellen alleen met een punt of direct gevolgd door een cijfer.
    m = zoek(new RegExp(`${V}${op}(${DAGEN.join('|')}|${DAGEN_KORT.join('|')})(\\.)?${A}`, 'iu'), (x) => {
      if (DAGEN.includes(x[1].toLowerCase())) return true;
      if (x[2]) return true;
      const na = werk.slice(x.index + x[0].length);
      const naOrigineel = invoer.slice(x.index + x[0].length);
      // "do 14:00": in `werk` is de tijd al gemaskeerd, dus kijk in de originele tekst.
      return /^\s+\d/.test(naOrigineel) || /^\s+\d/.test(na);
    });
    if (m) {
      const doel = dagIndex(m[1]);
      let v = (doel - weekdag(vandaag) + 7) % 7;
      if (v === 0) v = 7;
      return { dag: plus(vandaag, v), tekst: m[0].trim() };
    }
    return null;
  }

  function volJaar(s: string): number {
    const n = Number(s);
    return s.length === 2 ? 2000 + n : n;
  }

  /** Zonder jaar: eerstvolgende keer dat die datum valt (vandaag telt mee). */
  function jaarErbij(d: number, mnd: number, jaarTekst?: string): string {
    if (jaarTekst) return maak(volJaar(jaarTekst), mnd, d);
    const j = Number(vandaag.slice(0, 4));
    const ditJaar = maak(j, mnd, d);
    if (verschil(vandaag, ditJaar) >= 0) return ditJaar;
    return geldig(j + 1, mnd, d) ? maak(j + 1, mnd, d) : ditJaar;
  }
}

function minNaarTijd(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
