// Activeren: een aankoop (bankregel of bonnetje) als activum opnemen, met voorstellen en
// controles. Pure module.
//
// Een activum met een bron vervangt in het journaal de kostenkant van die bron door de
// activarekening (zie journaal.ts kostenRegels). Daarom gelden bij het activeren:
//   - een bankregel moet een losse uitgave zijn (niet gekoppeld aan een bonnetje: activeer dan
//     het bonnetje, want daar komen de kosten vandaan);
//   - een bonnetje moet meetellen (verwerkt, in euro's);
//   - de aanschafprijs (samen met andere activa uit dezelfde aankoop) is niet hoger dan het
//     bedrag exclusief btw van de aankoop, en alle activa uit één aankoop hebben dezelfde soort.

import type { Centen } from './geld';
import { ACTIVA_KIESBAAR, DREMPEL_ACTIVEREN } from './constanten';
import { isVerlegd } from './btw';
import { uitgaveBtw, uitgaveBtwCode, uitgaveGrootboek, uitgaveTeltNiet, type BronExtra, type Koppeling, type UitgaveBron } from './bronnen';
import type { Activum, ActivumWaarde } from './afschrijving';
import type { Datum } from './periode';
import { berekenBoeking, type Boeking } from '../model';

/** Het bedrag exclusief btw van een bonnetje (bij verlegd: het betaalde bedrag). */
export function uitgaveExcl(u: UitgaveBron, extra?: BronExtra | null): Centen {
  const code = uitgaveBtwCode(u, extra);
  const totaal = u.totaal ?? 0;
  return isVerlegd(code) ? totaal : totaal - uitgaveBtw(u, code);
}

/** Het bedrag exclusief btw van een losse uitgave op de bank. */
export function boekingExcl(b: Boeking): Centen {
  return berekenBoeking(b).btw.excl;
}

export interface Herkomst {
  soort: 'boeking' | 'uitgave';
  id: string;
  datum: Datum;
  titel: string;
  excl: Centen;
  grootboek: string | null;
}

export interface ActiveerContext {
  boekingen: readonly Boeking[];
  uitgaven: readonly UitgaveBron[];
  koppelingen: readonly Koppeling[];
  bronExtra: readonly BronExtra[];
  activa: readonly Activum[];
}

function extraVan(ctx: ActiveerContext, id: string): BronExtra | null {
  return ctx.bronExtra.find((e) => e.bron === 'uitgave' && e.bronId === id) ?? null;
}

/** De bron van een (nieuw) activum, of een melding waarom die niet kan. */
export function herkomstVan(w: Pick<ActivumWaarde, 'boekingId' | 'uitgaveId'>, ctx: ActiveerContext): { ok: true; herkomst: Herkomst | null } | { ok: false; fout: string } {
  if (w.boekingId) {
    const b = ctx.boekingen.find((x) => x.id === w.boekingId);
    if (!b) return { ok: false, fout: 'Deze bankregel bestaat niet (meer).' };
    if (b.soort !== 'uitgave' || b.richting !== 'af') return { ok: false, fout: 'Alleen een uitgave (geld af) kun je activeren.' };
    if (ctx.koppelingen.some((k) => k.boekingId === b.id)) {
      return { ok: false, fout: 'Deze bankregel is de betaling van een bonnetje; activeer het bonnetje (daar komen de kosten vandaan).' };
    }
    return { ok: true, herkomst: { soort: 'boeking', id: b.id, datum: b.datum, titel: b.omschrijving, excl: boekingExcl(b), grootboek: b.grootboek } };
  }
  if (w.uitgaveId) {
    const u = ctx.uitgaven.find((x) => x.id === w.uitgaveId);
    if (!u) return { ok: false, fout: 'Dit bonnetje bestaat niet (meer).' };
    const niet = uitgaveTeltNiet(u);
    if (niet || !u.datum) return { ok: false, fout: `Dit bonnetje telt nog niet mee (${niet ?? 'geen datum'}); verwerk het eerst bij Bonnetjes.` };
    const extra = extraVan(ctx, u.id);
    return { ok: true, herkomst: { soort: 'uitgave', id: u.id, datum: u.datum, titel: u.leverancier || u.omschrijving || 'Bonnetje', excl: uitgaveExcl(u, extra), grootboek: uitgaveGrootboek(u, extra) } };
  }
  return { ok: true, herkomst: null };
}

/** Controleert een activum tegen zijn bron (bedrag en soort, samen met andere activa uit dezelfde aankoop). */
export function activumBronFout(w: ActivumWaarde, ctx: ActiveerContext, eigenId: string | null = null): string | null {
  const h = herkomstVan(w, ctx);
  if (!h.ok) return h.fout;
  if (!h.herkomst) return null;
  const anderen = ctx.activa.filter((a) => a.id !== eigenId && ((w.boekingId && a.boekingId === w.boekingId) || (w.uitgaveId && a.uitgaveId === w.uitgaveId)));
  if (anderen.some((a) => a.categorie !== w.categorie)) return 'Andere activa uit deze aankoop hebben een andere soort; kies dezelfde soort.';
  const samen = anderen.reduce((t, a) => t + a.aanschaf, 0) + w.aanschaf;
  if (samen > h.herkomst.excl) {
    return anderen.length
      ? 'De aanschafprijzen van de activa uit deze aankoop zijn samen hoger dan het bedrag exclusief btw.'
      : 'De aanschafprijs is hoger dan het bedrag exclusief btw van de aankoop.';
  }
  if (w.aanschafdatum !== h.herkomst.datum) return 'De aanschafdatum moet gelijk zijn aan de datum van de aankoop.';
  return null;
}

export interface ActiveerVoorstel extends Herkomst {
  /** Waarom we dit voorstellen. */
  reden: string;
  /** Al deels geactiveerd (bedrag). */
  geactiveerd: Centen;
}

/**
 * Aankopen die (waarschijnlijk) geactiveerd moeten worden en nog geen (volledig) activum hebben:
 *   - op een activarekening (0200/0210) geboekt: moet een activum krijgen, anders wordt er
 *     niet afgeschreven;
 *   - hardware/kleine hardware vanaf € 450 excl. btw: voorstel (mag ook direct als kosten).
 */
export function teActiveren(ctx: ActiveerContext): ActiveerVoorstel[] {
  const gekoppeld = new Set(ctx.koppelingen.map((k) => k.boekingId));
  const geactiveerd = (soort: 'boeking' | 'uitgave', id: string) =>
    ctx.activa.filter((a) => (soort === 'boeking' ? a.boekingId === id : a.uitgaveId === id)).reduce((t, a) => t + a.aanschaf, 0);
  const uit: ActiveerVoorstel[] = [];
  for (const b of ctx.boekingen) {
    if (b.soort !== 'uitgave' || b.richting !== 'af' || gekoppeld.has(b.id)) continue;
    const excl = boekingExcl(b);
    const opActiva = b.grootboek !== null && ACTIVA_KIESBAAR.has(b.grootboek);
    const hardware = b.grootboek === '4010' && excl >= DREMPEL_ACTIVEREN;
    if (!opActiva && !hardware) continue;
    const al = geactiveerd('boeking', b.id);
    if (al >= excl || (al > 0 && !opActiva)) continue;
    uit.push({ soort: 'boeking', id: b.id, datum: b.datum, titel: b.omschrijving, excl, grootboek: b.grootboek, geactiveerd: al, reden: opActiva ? 'Geboekt als investering, maar nog zonder activum (er wordt niet afgeschreven).' : 'Hardware vanaf € 450 excl. btw: activeren en afschrijven, of laten staan als kosten.' });
  }
  for (const u of ctx.uitgaven) {
    if (uitgaveTeltNiet(u) || !u.datum) continue;
    const extra = extraVan(ctx, u.id);
    const gb = uitgaveGrootboek(u, extra);
    const excl = uitgaveExcl(u, extra);
    const opActiva = ACTIVA_KIESBAAR.has(gb);
    const hardware = gb === '4010' && excl >= DREMPEL_ACTIVEREN;
    if (!opActiva && !hardware) continue;
    const al = geactiveerd('uitgave', u.id);
    if (al >= excl || (al > 0 && !opActiva)) continue;
    uit.push({ soort: 'uitgave', id: u.id, datum: u.datum, titel: u.leverancier || u.omschrijving || 'Bonnetje', excl, grootboek: gb, geactiveerd: al, reden: opActiva ? 'Bonnetje als investering gemarkeerd, maar nog zonder activum.' : 'Hardware vanaf € 450 excl. btw: activeren en afschrijven, of laten staan als kosten.' });
  }
  return uit.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
}

export interface ActivumControle {
  activumId: string;
  tekst: string;
}

/** Activa waarvan de bron niet (meer) klopt: verwijderd, telt niet mee, gekoppeld of te laag. */
export function activaControles(ctx: ActiveerContext): ActivumControle[] {
  const uit: ActivumControle[] = [];
  for (const a of ctx.activa) {
    if (!a.boekingId && !a.uitgaveId) continue;
    const f = activumBronFout({ ...a }, ctx, a.id);
    if (f) uit.push({ activumId: a.id, tekst: f });
  }
  return uit;
}
