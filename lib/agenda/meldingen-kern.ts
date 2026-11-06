// Welke afspraakmeldingen moeten nu af? Puur rekenwerk zonder imports, zodat
// scripts/test-google-agenda.mjs het los kan testen. Elke afspraak krijgt er twee:
//   10 minuten vooraf: geldig tot 1 minuut vooraf (daarna is de 1-minuutmelding aan de beurt);
//    1 minuut vooraf: geldig tot 2 minuten na het begin (een tabblad op de achtergrond loopt
//                     soms een minuut achter; later melden heeft geen zin meer).
// Een melding die al eens af ging (ook in een ander tabblad) staat in `gehad`.

export interface KomendeAfspraak {
  id: string;
  titel: string;
  /** ISO-momenten. */
  start: string;
  eind: string;
  locatie: string;
  notitie: string;
  google?: { meetLink: string | null; vergaderDienst: string | null; agendaNaam: string };
}

export interface Melding {
  sleutel: string;
  minuten: 10 | 1;
  afspraak: KomendeAfspraak;
}

const MIN = 60_000;

/** Sleutel van één melding: verandert als de afspraak verschuift (dan opnieuw melden). */
export function meldingSleutel(a: Pick<KomendeAfspraak, 'id' | 'start'>, minuten: 10 | 1): string {
  return `${a.id}|${a.start}|${minuten}`;
}

export function teMelden(afspraken: KomendeAfspraak[], nu: number, gehad: Set<string>): Melding[] {
  const uit: Melding[] = [];
  for (const a of afspraken) {
    const start = Date.parse(a.start);
    if (Number.isNaN(start)) continue;
    const tien = meldingSleutel(a, 10);
    const een = meldingSleutel(a, 1);
    if (nu >= start - MIN && nu < start + 2 * MIN) {
      // In de laatste minuut: alleen nog de dringende (de 10-minutenmelding vervalt).
      if (!gehad.has(een)) uit.push({ sleutel: een, minuten: 1, afspraak: a });
    } else if (nu >= start - 10 * MIN && nu < start - MIN) {
      if (!gehad.has(tien)) uit.push({ sleutel: tien, minuten: 10, afspraak: a });
    }
  }
  return uit;
}

/** Wanneer moet er weer gekeken worden (ms vanaf nu)? Het eerstvolgende meldmoment, max. 30 s. */
export function volgendeControle(afspraken: KomendeAfspraak[], nu: number): number {
  let eerst = 30_000;
  for (const a of afspraken) {
    const start = Date.parse(a.start);
    for (const m of [start - 10 * MIN, start - MIN]) {
      if (m > nu) eerst = Math.min(eerst, m - nu + 50);
    }
  }
  return Math.max(500, eerst);
}
