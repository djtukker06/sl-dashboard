// Geld in de boekhouding: ALTIJD hele centen (integers), nooit floats. Pure module zonder
// netwerk, klok of '@/'-imports, zodat server, browser en scripts/test-boekhouding.mjs hem
// direct kunnen gebruiken.
//
// Afronding volgens de NL-praktijk: per regel op hele centen, "half weg van nul"
// (0,5 cent → 1 cent, −0,5 cent → −1 cent), net als de facturen (lib/invoice/calculations.ts).

/** Een bedrag in hele centen. */
export type Centen = number;

/** Grootste bedrag dat we accepteren (€ 99.999.999,99), ruim binnen Number.MAX_SAFE_INTEGER. */
export const MAX_CENTEN = 9_999_999_999;

export function isCenten(v: unknown): v is Centen {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** Gooit als een waarde geen hele centen zijn (programmeerfout, nooit stil doorrekenen). */
export function moetCenten(v: number, wat = 'bedrag'): Centen {
  if (!Number.isSafeInteger(v)) throw new Error(`${wat} is geen geheel aantal centen: ${v}`);
  return v;
}

/**
 * Deling met afronding "half weg van nul", alleen met gehele getallen:
 * rondAf(1, 2) = 1, rondAf(-1, 2) = -1, rondAf(2100, 121) = 17 (17,355…).
 */
export function rondAf(teller: number, noemer: number): Centen {
  moetCenten(teller, 'teller');
  if (!Number.isSafeInteger(noemer) || noemer <= 0) throw new Error(`ongeldige noemer: ${noemer}`);
  const negatief = teller < 0;
  const a = Math.abs(teller);
  const q = Math.floor(a / noemer);
  const rest = a - q * noemer;
  const uit = rest * 2 >= noemer ? q + 1 : q;
  return negatief && uit !== 0 ? -uit : uit;
}

/**
 * Leest een bedrag als centen. Accepteert:
 *   - getallen (bv. uit de database als JSON-number: 1234.5)
 *   - "1234.50" (Postgres numeric), "1.234,56" en "1234,5" (NL), "1,234.56", "€ 12,50", "-12,30"
 * Geeft null bij iets dat geen bedrag is of meer dan 2 decimalen heeft.
 */
export function naarCenten(v: unknown): Centen | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    const c = Math.round(v * 100);
    // Meer dan 2 decimalen (bv. 1.005) weigeren we niet bij getallen uit de database
    // (numeric(12,2) heeft er nooit meer), maar we controleren de grootte.
    return Math.abs(c) <= MAX_CENTEN * 10 ? c : null;
  }
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/\s+/g, '').replace(/^€|€$/g, '').replace(/^EUR|EUR$/i, '');
  if (!s) return null;
  let negatief = false;
  if (/^\(.*\)$/.test(s)) {
    negatief = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    negatief = !negatief;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.replace(/^€/, '');
  if (!/^[0-9.,]+$/.test(s)) return null;

  const laatstePunt = s.lastIndexOf('.');
  const laatsteKomma = s.lastIndexOf(',');
  let heel: string;
  let deel = '';
  if (laatstePunt >= 0 && laatsteKomma >= 0) {
    // Beide: het laatste teken is het decimaalteken, het andere scheidt duizendtallen.
    const dec = laatstePunt > laatsteKomma ? '.' : ',';
    const duizend = dec === '.' ? ',' : '.';
    const [a, b, ...rest] = s.split(dec);
    if (rest.length) return null;
    if (!/^\d{1,3}([.,]\d{3})*$/.test(a) || a.includes(dec)) return null;
    heel = a.split(duizend).join('');
    deel = b;
  } else if (laatsteKomma >= 0) {
    const delen = s.split(',');
    if (delen.length > 2) {
      // "1,234,567" (Engelse duizendtallen zonder decimalen)
      if (!delen.slice(1).every((d) => d.length === 3)) return null;
      heel = delen.join('');
    } else {
      heel = delen[0];
      deel = delen[1];
    }
  } else if (laatstePunt >= 0) {
    const delen = s.split('.');
    // "1.234" of "1.234.567" = duizendtallen (NL); "1234.5" / "12.50" = decimalen.
    if (delen.length > 2 || (delen.length === 2 && delen[1].length === 3 && delen[0].length <= 3 && delen[0] !== '0')) {
      if (!delen.slice(1).every((d) => d.length === 3)) return null;
      heel = delen.join('');
    } else {
      heel = delen[0];
      deel = delen[1];
    }
  } else {
    heel = s;
  }
  if (heel === '') heel = '0';
  if (!/^\d+$/.test(heel) || !/^\d{0,2}$/.test(deel)) return null;
  const c = Number(heel) * 100 + Number((deel + '00').slice(0, 2));
  if (!Number.isSafeInteger(c) || c > MAX_CENTEN * 10) return null;
  return negatief && c !== 0 ? -c : c;
}

const NL = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123456 → "1.234,56" (zonder euroteken; negatief met een minteken). */
export function formatBedrag(c: Centen): string {
  moetCenten(c);
  const abs = Math.abs(c);
  const tekst = NL.format(Math.floor(abs / 100) + (abs % 100) / 100);
  return c < 0 ? `−${tekst}` : tekst;
}

/** 123456 → "€ 1.234,56"; −500 → "−€ 5,00". */
export function formatCenten(c: Centen): string {
  moetCenten(c);
  const t = formatBedrag(Math.abs(c));
  return c < 0 ? `−€ ${t}` : `€ ${t}`;
}

/** Centen als invoertekst: 123456 → "1234,56" (voor een invoerveld). */
export function centenNaarInvoer(c: Centen): string {
  moetCenten(c);
  const abs = Math.abs(c);
  const t = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
  return c < 0 ? `-${t}` : t;
}

/** Centen naar een decimale string voor Postgres numeric/CSV: 123456 → "1234.56". */
export function centenNaarDecimaal(c: Centen): string {
  moetCenten(c);
  const abs = Math.abs(c);
  const t = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return c < 0 ? `-${t}` : t;
}

/**
 * Verdeelt een totaal exact over delen naar verhouding (grootste-restmethode): de som van de
 * uitkomst is altijd precies het totaal. Voor winstverdeling en afschrijvingen.
 *   verdeel(100, [1, 1, 1]) → [34, 33, 33]
 */
export function verdeel(totaal: Centen, gewichten: number[]): Centen[] {
  moetCenten(totaal, 'totaal');
  if (!gewichten.length) throw new Error('verdeel: geen delen');
  if (gewichten.some((g) => !Number.isFinite(g) || g < 0)) throw new Error('verdeel: ongeldig gewicht');
  const som = gewichten.reduce((a, b) => a + b, 0);
  if (som <= 0) throw new Error('verdeel: gewichten tellen op tot 0');
  const teken = totaal < 0 ? -1 : 1;
  const abs = Math.abs(totaal);
  const ruw = gewichten.map((g) => (abs * g) / som);
  const basis = ruw.map((r) => Math.floor(r));
  let rest = abs - basis.reduce((a, b) => a + b, 0);
  const volgorde = ruw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of volgorde) {
    if (rest <= 0) break;
    basis[i]++;
    rest--;
  }
  return basis.map((b) => (b === 0 ? 0 : b * teken));
}

/** Som van centen (met controle op gehele getallen). */
export function som(lijst: Centen[]): Centen {
  let t = 0;
  for (const c of lijst) t += moetCenten(c);
  return moetCenten(t, 'som');
}

const NL_HEEL = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });

/** Hele euro's zoals op het btw-formulier: 17800 → "€ 17.800"; −12 → "−€ 12". */
export function formatHeleEuro(euro: number): string {
  if (!Number.isSafeInteger(euro)) throw new Error(`geen heel aantal euro's: ${euro}`);
  const t = NL_HEEL.format(Math.abs(euro));
  return euro < 0 ? `−€ ${t}` : `€ ${t}`;
}
