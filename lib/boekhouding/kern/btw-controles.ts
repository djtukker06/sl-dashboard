// Controles bij de btw-aangifte van een kwartaal: wat de boekhouder zou vragen vóór je
// indient. Pure module; signaleert alleen (blokkeert niet).

import { bonOntbreekt, verweesdeKoppelingen } from './afletteren';
import { factuurBtwCode, uitgaveTeltNiet, type BronExtra, type FactuurBron, type Koppeling, type UitgaveBron } from './bronnen';
import { korteDatum, kwartaalGrenzen, kwartaalLabel, type Datum, type Kwartaal } from './periode';
import { berekenBoeking, type Boeking } from '../model';
import type { Centen } from './geld';
import type { KwartaalRij } from './aangifte';

export interface BtwControle {
  id: string;
  soort: 'let_op' | 'info' | 'ok';
  titel: string;
  tekst: string;
  aantal?: number;
  href?: string;
  /** Regels om te tonen (bv. de EU-klanten voor de ICP-opgaaf). */
  regels?: { titel: string; sub?: string; bedrag?: Centen; href?: string; actie?: { bron: 'factuur'; id: string; btwCode: 'eu_dienst'; label: string } }[];
}

export function btwControles(o: {
  jaar: number;
  kwartaal: Kwartaal;
  vandaag: Datum;
  boekingen: readonly Boeking[];
  facturen: readonly FactuurBron[];
  uitgaven: readonly UitgaveBron[];
  koppelingen: readonly Koppeling[];
  bronExtra: readonly BronExtra[];
  kwartalen: readonly KwartaalRij[];
}): BtwControle[] {
  const { van, tot } = kwartaalGrenzen(o.jaar, o.kwartaal);
  const inKw = (d: Datum | null) => !!d && d >= van && d <= tot;
  const uit: BtwControle[] = [];
  const bankHref = `/boekhouding/bank?jaar=${o.jaar}&kw=${o.kwartaal}`;

  if (o.vandaag <= tot) {
    uit.push({ id: 'lopend', soort: 'info', titel: 'Kwartaal loopt nog', tekst: `Je kunt de aangifte over ${kwartaalLabel(o.jaar, o.kwartaal)} pas na ${korteDatum(tot)} indienen. Tot dan kunnen er nog boekingen bij komen.` });
  }

  const eerder = o.kwartalen.filter((k) => (k.status === 'te_doen' || k.status === 'te_laat') && (k.jaar < o.jaar || (k.jaar === o.jaar && k.kwartaal < o.kwartaal)));
  if (eerder.length) {
    uit.push({
      id: 'eerder',
      soort: 'let_op',
      titel: 'Eerdere kwartalen nog niet ingediend',
      tekst: `${eerder.map((k) => kwartaalLabel(k.jaar, k.kwartaal)).join(', ')}. Dien die eerst in.`,
      aantal: eerder.length,
      regels: eerder.map((k) => ({ titel: kwartaalLabel(k.jaar, k.kwartaal), href: `/boekhouding/btw/${k.jaar}/${k.kwartaal}` }))
    });
  }

  const teVerwerken = o.boekingen.filter((b) => b.status === 'te_verwerken' && inKw(b.datum));
  uit.push(
    teVerwerken.length
      ? { id: 'te_verwerken', soort: 'let_op', titel: 'Bankregels nog te verwerken', tekst: 'Geïmporteerde regels die je nog niet hebt gecontroleerd of gekoppeld. Ze tellen wel mee met de voorgestelde btw.', aantal: teVerwerken.length, href: `${bankHref}&status=te_verwerken` }
      : { id: 'te_verwerken', soort: 'ok', titel: 'Alle bankregels verwerkt', tekst: 'Er staan geen regels meer op "te verwerken" in dit kwartaal.' }
  );

  const gekoppeld = new Set(o.koppelingen.map((k) => k.boekingId));
  const zonderBon = bonOntbreekt(o.boekingen.filter((b) => inKw(b.datum)), gekoppeld);
  if (zonderBon.length) {
    uit.push({
      id: 'bon',
      soort: 'let_op',
      titel: 'Bon ontbreekt',
      tekst: 'Uitgaven met voorbelasting zonder gekoppeld bonnetje. Voor de aftrek moet je een factuur kunnen laten zien.',
      aantal: zonderBon.length,
      href: '/boekhouding/openstaand',
      regels: zonderBon.slice(0, 5).map((b) => ({ titel: b.omschrijving, sub: korteDatum(b.datum, false), bedrag: -berekenBoeking(b).bankMutatie, href: `/boekhouding/bank?jaar=alle&open=${b.id}` }))
    });
  }

  const nietMee = o.uitgaven.filter((u) => inKw(u.datum) && uitgaveTeltNiet(u));
  if (nietMee.length) {
    uit.push({
      id: 'concept',
      soort: 'let_op',
      titel: 'Bonnetjes die nog niet meetellen',
      tekst: 'In concept of in een andere valuta; hun btw zit niet in deze aangifte. Verwerk ze eerst bij Bonnetjes.',
      aantal: nietMee.length,
      href: '/boekhouding/bonnetjes',
      regels: nietMee.slice(0, 5).map((u) => ({ titel: u.leverancier || u.omschrijving || 'Bonnetje', sub: uitgaveTeltNiet(u) ?? '', bedrag: u.totaal ?? 0 }))
    });
  }

  const handmatig = o.boekingen.filter((b) => inKw(b.datum) && b.btwHandmatig && berekenBoeking(b).btw.afwijking);
  if (handmatig.length) {
    uit.push({ id: 'handmatig', soort: 'info', titel: 'Handmatig aangepaste btw', tekst: 'Bij deze regels wijkt de btw meer dan € 0,02 af van de berekening. Controleer ze met de bon.', aantal: handmatig.length, regels: handmatig.map((b) => ({ titel: b.omschrijving, sub: korteDatum(b.datum, false), href: `/boekhouding/bank?jaar=alle&open=${b.id}` })) });
  }

  const extra = new Map(o.bronExtra.filter((e) => e.bron === 'factuur').map((e) => [e.bronId, e]));
  const fKw = o.facturen.filter((f) => inKw(f.datum));
  const verlegdNl = fKw.filter((f) => f.verlegd && !extra.get(f.id)?.btwCode && factuurBtwCode(f) === 'verlegd_nl');
  if (verlegdNl.length) {
    uit.push({
      id: 'verlegd',
      soort: 'info',
      titel: 'Verlegde facturen in rubriek 1e',
      tekst: 'De reden van verlegging wijst niet op een EU-klant, dus staan ze in 1e. Is de klant een ondernemer in een ander EU-land, zet de factuur dan op 3b (de factuur zelf verandert niet).',
      aantal: verlegdNl.length,
      regels: verlegdNl.map((f) => ({ titel: `Factuur ${f.nummer}`, sub: f.klant, bedrag: f.totaal, href: `/facturen/${f.id}/bewerken`, actie: { bron: 'factuur' as const, id: f.id, btwCode: 'eu_dienst' as const, label: 'Zet op 3b (EU)' } }))
    });
  }

  const eu = fKw.filter((f) => factuurBtwCode(f, extra.get(f.id)) === 'eu_dienst');
  if (eu.length) {
    const perKlant = new Map<string, Centen>();
    for (const f of eu) perKlant.set(f.klant, (perKlant.get(f.klant) ?? 0) + f.totaal);
    uit.push({
      id: 'icp',
      soort: 'info',
      titel: 'ICP-opgaaf niet vergeten',
      tekst: 'Je hebt diensten aan EU-ondernemers verricht (rubriek 3b). Geef die ook op in de opgaaf intracommunautaire prestaties, met het btw-nummer van de klant.',
      aantal: perKlant.size,
      regels: [...perKlant.entries()].map(([klant, bedrag]) => ({ titel: klant, sub: 'diensten (btw verlegd)', bedrag }))
    });
  }

  const wees = verweesdeKoppelingen(o.koppelingen, o.facturen, o.uitgaven).filter((k) => inKw(o.boekingen.find((b) => b.id === k.boekingId)?.datum ?? null));
  if (wees.length) {
    uit.push({ id: 'wees', soort: 'let_op', titel: 'Koppeling naar verwijderd document', tekst: 'Een betaling verwijst naar een factuur of bonnetje dat niet meer bestaat.', aantal: wees.length, href: '/boekhouding/openstaand' });
  }
  return uit;
}
