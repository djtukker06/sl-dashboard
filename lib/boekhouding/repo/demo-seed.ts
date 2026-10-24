// Voorbeeldgegevens voor de demo-modus: ~14 maanden bankregels op RegioBank en Revolut, zoals
// een kleine ontwerpstudio (VOF, twee vennoten) die echt heeft. Deterministisch (vaste
// bedragen en vaste id's) en relatief ten opzichte van vandaag, zodat de demo altijd actueel
// oogt. Pure module: geen netwerk, geen klok (vandaag wordt meegegeven), geen '@/'-imports.
//
// Wat erin zit (bewust alle soorten regels):
//   - software uit de EU met verlegde btw (Adobe en Google, Ierland → rubriek 4b) en van
//     buiten de EU (Figma, VS → 4a), KPN 21%, NS 9%, bankkosten zonder btw, een verzekering;
//   - voorbeeldfacturen (21%, één EU-klant met verlegde btw → 3b, aanbetaling + restfactuur,
//     doorberekende kosten, een creditnota) met de betalingen gekoppeld (afgeletterd); een
//     paar staan nog open (waarvan één ruim over de termijn en één deels betaald);
//   - voorbeeldbonnetjes (monitor, laptop als investering, drukwerk, fotograaf), gekoppeld aan
//     de bankregel; een lunch die privé is voorgeschoten; een inkoopfactuur die nog open staat
//     en een bonnetje in concept;
//   - activa: een laptop (bonnetje, € 2.499 excl., 5 jaar), een camera (bankregel, 3 jaar),
//     ingebrachte bureaus (inventaris) en een ingebrachte oude camera die is verkocht
//     (desinvestering met boekwinst); een monitor onder € 450 gaat direct naar de kosten;
//   - maandelijkse privé-opnamen van Daniel en Bram, overboekingen tussen de eigen rekeningen;
//   - per afgelopen kwartaal een ingediende aangifte (berekend zoals het formulier, hele
//     euro's) met de btw-betaling gekoppeld; die kwartalen zijn vergrendeld. Het kwartaal
//     waarvan de deadline nog niet voorbij is, staat open (klaar om in te dienen);
//   - een paar regels die nog verwerkt moeten worden.

import { STANDAARD_GROOTBOEK } from '../kern/constanten';
import type { BtwCode } from '../kern/btw';
import { journaal } from '../kern/journaal';
import { aangifteRubrieken, naarSnapshot, teBetalenCenten, type Aangifte, type AangifteBetaling } from '../kern/aangifte';
import type { Activum } from '../kern/afschrijving';
import type { BronExtra, FactuurBron, Koppeling, UitgaveBron } from '../kern/bronnen';
import {
  aangifteDeadline,
  dagenInMaand,
  jaarVan,
  kwartaalVan,
  maakDatum,
  maandVan,
  plusDagen,
  plusMaanden,
  type Datum,
  type Kwartaal
} from '../kern/periode';
import { berekenBoeking, type Boeking, type BoekingSoort, type BoekingStatus, type Grootboekrekening, type Rekening, type Stamdata, type Vennoot } from '../model';

export interface DemoData {
  stamdata: Stamdata;
  boekingen: Boeking[];
  /** Voorbeeldfacturen en -bonnetjes (de echte tabs Facturen en Bonnetjes blijven ongewijzigd). */
  facturen: FactuurBron[];
  uitgaven: UitgaveBron[];
  koppelingen: Koppeling[];
  bronExtra: BronExtra[];
  /** Importsleutels per rekening (dubbele regels herkennen bij een volgende import). */
  importSleutels: Record<string, string[]>;
  /** Ingediende aangiften (met de berekening zoals ingediend). */
  aangiften: Aangifte[];
  /** Btw-betalingen gekoppeld aan een aangifte. */
  aangifteBetalingen: AangifteBetaling[];
  activa: Activum[];
}

export const DEMO_ID = {
  regiobank: 'de000000-0000-4000-8000-000000000001',
  revolut: 'de000000-0000-4000-8000-000000000002',
  daniel: 'de000000-0000-4000-8000-0000000000d1',
  bram: 'de000000-0000-4000-8000-0000000000b1'
} as const;

const KLANTEN = [
  'Bakkerij De Korenaar',
  'Hotel Zeezicht',
  'Fysio Noord',
  'Van Dijk Architecten',
  'Restaurant Bries',
  'Stichting Kunstroute',
  'Wijnhandel Oosterhof'
];
// Bedragen incl. 21% btw (veelvouden van € 1,21: nette omzet).
const BETALINGEN = [363000, 242000, 544500, 181500, 302500, 423500, 605000, 266200, 332750, 484000];

interface Regel {
  r: 'regiobank' | 'revolut';
  datum: Datum;
  omschrijving: string;
  tegenpartij?: string;
  soort: BoekingSoort;
  richting?: 'af' | 'bij';
  bedrag: number;
  btw?: BtwCode;
  gb?: string;
  vennoot?: 'daniel' | 'bram';
  status?: BoekingStatus;
  /** Betaling van deze factuur of dit bonnetje (afgeletterd), met het gekoppelde bedrag. */
  koppel?: { bron: 'factuur' | 'uitgave'; id: string; bedrag: number };
  /** Deze aankoop is geactiveerd (activum met deze bankregel als bron). */
  activum?: Omit<Activum, 'id' | 'boekingId' | 'uitgaveId' | 'aangemaakt' | 'aanschafdatum' | 'ingebruikname'>;
}

export function demoSeed(vandaag: Datum): DemoData {
  const start = maakDatum(jaarVan(plusMaanden(vandaag, -13)), maandVan(plusMaanden(vandaag, -13)), 1);
  const op = (m: number, dag: number): Datum => {
    const eerste = plusMaanden(start, m);
    return maakDatum(jaarVan(eerste), maandVan(eerste), Math.min(dag, dagenInMaand(jaarVan(eerste), maandVan(eerste))));
  };

  const regels: Regel[] = [];
  const facturen: FactuurBron[] = [];
  const uitgaven: UitgaveBron[] = [];
  const bronExtra: BronExtra[] = [];
  let fn = 0;
  let un = 0;
  const nummers = new Map<number, number>();
  const nieuwNummer = (d: Datum) => {
    const j = jaarVan(d);
    const n = (nummers.get(j) ?? (j === jaarVan(start) ? 30 : 0)) + 1;
    nummers.set(j, n);
    return `${j}-${String(n).padStart(3, '0')}`;
  };
  /** Een factuur met 21% (totaal incl. btw, een veelvoud van € 1,21) of met btw verlegd. */
  const factuur = (o: { datum: Datum; klant: string; totaal: number; verlegd?: string; doorberekend?: number; aanbetaling?: boolean; restVan?: string }): FactuurBron => {
    const datum = o.datum < start ? start : o.datum;
    const subtotaal = o.verlegd ? o.totaal : (o.totaal / 121) * 100;
    const f: FactuurBron = {
      id: `de000000-0000-4000-b000-${(++fn).toString(16).padStart(12, '0')}`,
      nummer: nieuwNummer(datum),
      klant: o.klant,
      datum,
      subtotaal,
      omzet: subtotaal - (o.doorberekend ?? 0),
      btw: o.totaal - subtotaal,
      totaal: o.totaal,
      btwPct: o.verlegd ? 0 : 21,
      verlegd: Boolean(o.verlegd),
      verlegdReden: o.verlegd ?? null,
      aanbetaling: Boolean(o.aanbetaling),
      restVan: o.restVan ?? null
    };
    if (datum <= vandaag) facturen.push(f);
    return f;
  };
  const bonnetje = (o: Omit<UitgaveBron, 'id' | 'valuta' | 'status' | 'factuurnummer' | 'aangemaaktDoor' | 'omschrijving'> & { omschrijving?: string; status?: 'concept' | 'verwerkt' }): UitgaveBron => {
    const u: UitgaveBron = {
      id: `de000000-0000-4000-c000-${(++un).toString(16).padStart(12, '0')}`,
      omschrijving: o.omschrijving ?? '',
      valuta: 'EUR',
      status: o.status ?? 'verwerkt',
      factuurnummer: '',
      aangemaaktDoor: null,
      ...o
    };
    if (u.datum && u.datum <= vandaag && u.datum >= start) uitgaven.push(u);
    return u;
  };

  for (let m = 0; m <= 13; m++) {
    regels.push(
      { r: 'regiobank', datum: op(m, 1), omschrijving: 'Kosten Zakelijk Pakket', tegenpartij: 'RegioBank', soort: 'uitgave', bedrag: 950, btw: 'geen', gb: '4900' },
      { r: 'revolut', datum: op(m, 2), omschrijving: 'Revolut Business abonnement', tegenpartij: 'Revolut Bank UAB', soort: 'uitgave', bedrag: 1000, btw: 'geen', gb: '4900' },
      { r: 'revolut', datum: op(m, 3), omschrijving: 'Adobe Creative Cloud', tegenpartij: 'Adobe Systems Software Ireland', soort: 'uitgave', bedrag: 7139, btw: 'eu_dienst', gb: '4000' },
      { r: 'revolut', datum: op(m, 5), omschrijving: 'Google Workspace', tegenpartij: 'Google Cloud EMEA Ltd', soort: 'uitgave', bedrag: 2720, btw: 'eu_dienst', gb: '4000' },
      { r: 'revolut', datum: op(m, 8), omschrijving: 'Figma Professional', tegenpartij: 'Figma Inc. (VS)', soort: 'uitgave', bedrag: 3000, btw: 'buiten_eu', gb: '4000' },
      { r: 'regiobank', datum: op(m, 12), omschrijving: 'KPN Zakelijk mobiel en internet', tegenpartij: 'KPN B.V.', soort: 'uitgave', bedrag: 4840, btw: '21', gb: '4700' },
      { r: 'regiobank', datum: op(m, 25), omschrijving: 'Privé-opname Daniel', soort: 'prive', bedrag: 150000, vennoot: 'daniel' },
      { r: 'regiobank', datum: op(m, 25), omschrijving: 'Privé-opname Bram', soort: 'prive', bedrag: 150000, vennoot: 'bram' }
    );
    // Twee facturen per maand, ongeveer 2 weken later betaald (en afgeletterd). Uitzonderingen:
    // één factuur ruim over de termijn (niet betaald) en één deels betaald.
    for (const [i, dag] of [9, 21].entries()) {
      const k = (m * 2 + i) % KLANTEN.length;
      const totaal = BETALINGEN[(m * 3 + i) % BETALINGEN.length];
      const betaaldOp = op(m, dag);
      const f = factuur({ datum: plusDagen(betaaldOp, -16), klant: KLANTEN[k], totaal, doorberekend: m === 4 && i === 1 ? 30000 : 0 });
      if (m === 11 && i === 1) continue; // staat nog open (over de termijn)
      const bedrag = m === 12 && i === 0 ? totaal - 205000 : totaal; // deelbetaling (rest € 2.050)
      regels.push({
        r: 'regiobank',
        datum: betaaldOp,
        omschrijving: `Betaling factuur ${f.nummer}${bedrag !== totaal ? ' (deel)' : ''}`,
        tegenpartij: KLANTEN[k],
        soort: 'inkomst',
        bedrag,
        btw: '21',
        gb: '8000',
        koppel: { bron: 'factuur', id: f.id, bedrag }
      });
    }
    if (m % 3 === 1) {
      regels.push({ r: 'regiobank', datum: op(m, 15), omschrijving: 'NS Zakelijk reizen', tegenpartij: 'NS Reizigers', soort: 'uitgave', bedrag: 3815, btw: '9', gb: '4200' });
    }
    if (m % 3 === 0) {
      regels.push(
        { r: 'regiobank', datum: op(m, 10), omschrijving: 'Overboeking naar Revolut', soort: 'overboeking', richting: 'af', bedrag: 50000 },
        { r: 'revolut', datum: op(m, 10), omschrijving: 'Overboeking van RegioBank', soort: 'overboeking', richting: 'bij', bedrag: 50000 }
      );
    }
  }

  // Aanbetaling (50%) en restfactuur: elk een eigen factuur, elk betaald.
  const aanb = factuur({ datum: op(4, 3), klant: 'Van Dijk Architecten', totaal: 302500, aanbetaling: true });
  const rest = factuur({ datum: op(7, 2), klant: 'Van Dijk Architecten', totaal: 302500, restVan: aanb.id });
  regels.push(
    { r: 'regiobank', datum: op(4, 12), omschrijving: `Aanbetaling ${aanb.nummer} Van Dijk`, tegenpartij: 'Van Dijk Architecten', soort: 'inkomst', bedrag: 302500, btw: '21', gb: '8000', koppel: { bron: 'factuur', id: aanb.id, bedrag: 302500 } },
    { r: 'regiobank', datum: op(7, 14), omschrijving: `Restbetaling ${rest.nummer}`, tegenpartij: 'Van Dijk Architecten', soort: 'inkomst', bedrag: 302500, btw: '21', gb: '8000', koppel: { bron: 'factuur', id: rest.id, bedrag: 302500 } }
  );
  // EU-klant: btw verlegd (rubriek 3b + ICP).
  const eu = factuur({ datum: op(5, 1), klant: 'Agentur Nordlicht GmbH', totaal: 280000, verlegd: 'Btw verlegd — intracommunautaire dienst (art. 196 Btw-richtlijn)' });
  regels.push({ r: 'regiobank', datum: op(5, 15), omschrijving: `Betaling ${eu.nummer} Agentur Nordlicht (DE)`, tegenpartij: 'Agentur Nordlicht GmbH', soort: 'inkomst', bedrag: 280000, btw: 'eu_dienst', gb: '8010', koppel: { bron: 'factuur', id: eu.id, bedrag: 280000 } });
  // Creditnota (deels teruggestort aan de klant).
  const credit = factuur({ datum: op(9, 18), klant: 'Hotel Zeezicht', totaal: -24200 });
  regels.push({ r: 'regiobank', datum: op(9, 24), omschrijving: `Terugbetaling creditnota ${credit.nummer}`, tegenpartij: 'Hotel Zeezicht', soort: 'inkomst', richting: 'af', bedrag: 24200, btw: '21', gb: '8000', koppel: { bron: 'factuur', id: credit.id, bedrag: -24200 } });
  // Nog open: Studio Vlakveld (de betaling staat al op de bank, maar is nog niet gekoppeld).
  factuur({ datum: plusDagen(vandaag, -20), klant: 'Studio Vlakveld', totaal: 121000 });

  // Bonnetjes & inkoopfacturen.
  const monitor = bonnetje({ datum: op(2, 13), leverancier: 'Coolblue B.V.', omschrijving: 'Monitor 27"', categorie: 'hardware', totaal: 34900, btw: 6057, tarief: '21', betaalwijze: 'zakelijk' });
  const laptop = bonnetje({ datum: op(6, 5), leverancier: 'Apple Distribution International', omschrijving: 'MacBook Pro 14"', categorie: 'hardware', totaal: 302379, btw: 52479, tarief: '21', betaalwijze: 'zakelijk' });
  bronExtra.push({ bron: 'uitgave', bronId: laptop.id, btwCode: null, grootboek: '0210', vennootId: null, notitie: 'Investering (≥ € 450): geactiveerd' });
  const activa: Activum[] = [];
  let an = 0;
  const activumId = () => `de000000-0000-4000-f000-${(++an).toString(16).padStart(12, '0')}`;
  if (uitgaven.includes(laptop)) {
    activa.push({
      id: activumId(),
      omschrijving: 'MacBook Pro 14"',
      categorie: '0210',
      aanschafdatum: laptop.datum as Datum,
      ingebruikname: laptop.datum as Datum,
      aanschaf: 249900,
      restwaarde: 0,
      looptijdMaanden: 60,
      uitgaveId: laptop.id,
      boekingId: null,
      desinvesteringDatum: null,
      desinvesteringOpbrengst: null,
      notities: 'Bonnetje Apple; 5 jaar lineair.',
      aangemaakt: `${laptop.datum}T12:00:00.000Z`
    });
  }
  // Ingebracht bij de start (van vóór de administratie): bureaus en een oude camera die is verkocht.
  const ingebracht = plusMaanden(start, -10);
  activa.push({
    id: activumId(),
    omschrijving: 'Bureaus en bureaustoelen',
    categorie: '0200',
    aanschafdatum: ingebracht,
    ingebruikname: ingebracht,
    aanschaf: 140000,
    restwaarde: 0,
    looptijdMaanden: 60,
    uitgaveId: null,
    boekingId: null,
    desinvesteringDatum: null,
    desinvesteringOpbrengst: null,
    notities: 'Ingebracht bij de start van de VOF.',
    aangemaakt: `${start}T12:00:00.000Z`
  });
  const oudeCamera = plusMaanden(start, -20);
  const verkocht = op(10, 7) <= vandaag ? op(10, 7) : null;
  activa.push({
    id: activumId(),
    omschrijving: 'Canon EOS R (oud)',
    categorie: '0210',
    aanschafdatum: oudeCamera,
    ingebruikname: oudeCamera,
    aanschaf: 210000,
    restwaarde: 0,
    looptijdMaanden: 36,
    uitgaveId: null,
    boekingId: null,
    desinvesteringDatum: verkocht,
    desinvesteringOpbrengst: verkocht ? 60000 : null,
    notities: 'Ingebracht; verkocht via Marktplaats na aanschaf van de Sony.',
    aangemaakt: `${start}T12:00:00.000Z`
  });
  const lunch = bonnetje({ datum: op(8, 11), leverancier: 'Brasserie De Haven', omschrijving: 'Lunch met klant', categorie: 'representatie', totaal: 8640, btw: 713, tarief: '9', betaalwijze: 'prive' });
  bronExtra.push({ bron: 'uitgave', bronId: lunch.id, btwCode: null, grootboek: null, vennootId: DEMO_ID.daniel, notitie: 'Voorgeschoten door Daniel' });
  const drukwerk = bonnetje({ datum: op(9, 3), leverancier: 'Drukwerkdeal', omschrijving: 'Visitekaartjes', categorie: 'marketing', totaal: 6050, btw: 1050, tarief: '21', betaalwijze: 'zakelijk' });
  const foto = bonnetje({ datum: op(11, 15), leverancier: 'J. de Wit Fotografie', omschrijving: 'Productshoot', categorie: 'uitbesteed', totaal: 72600, btw: 12600, tarief: '21', betaalwijze: 'zakelijk' });
  bonnetje({ datum: plusDagen(vandaag, -12), leverancier: 'J. de Wit Fotografie', omschrijving: 'Portretten team', categorie: 'uitbesteed', totaal: 48400, btw: 8400, tarief: '21', betaalwijze: 'zakelijk' });
  bonnetje({ datum: plusDagen(vandaag, -3), leverancier: 'bol.com', omschrijving: 'Kantoorartikelen', categorie: 'kantoor', totaal: 4295, btw: 745, tarief: '21', betaalwijze: 'zakelijk' });
  bonnetje({ datum: plusDagen(vandaag, -1), leverancier: 'Albert Heijn', omschrijving: 'Koffie en melk', categorie: 'kantoor', totaal: 1250, btw: 103, tarief: '9', betaalwijze: 'zakelijk', status: 'concept' });

  regels.push(
    { r: 'regiobank', datum: op(2, 14), omschrijving: 'Coolblue — monitor 27"', tegenpartij: 'Coolblue B.V.', soort: 'uitgave', bedrag: 34900, btw: '21', gb: '4010', koppel: { bron: 'uitgave', id: monitor.id, bedrag: 34900 } },
    { r: 'regiobank', datum: op(3, 20), omschrijving: 'Beroepsaansprakelijkheid', tegenpartij: 'Hiscox', soort: 'uitgave', bedrag: 41250, btw: 'geen', gb: '4750' },
    { r: 'regiobank', datum: op(6, 6), omschrijving: 'Apple — MacBook Pro 14"', tegenpartij: 'Apple Distribution International', soort: 'uitgave', bedrag: 302379, btw: '21', gb: '0210', koppel: { bron: 'uitgave', id: laptop.id, bedrag: 302379 } },
    {
      r: 'regiobank',
      datum: op(8, 19),
      omschrijving: 'Sony A7 IV + 24-70 mm',
      tegenpartij: 'Kamera Express',
      soort: 'uitgave',
      bedrag: 223850,
      btw: '21',
      gb: '0210',
      activum: { omschrijving: 'Sony A7 IV + 24-70 mm', categorie: '0210', aanschaf: 185000, restwaarde: 0, looptijdMaanden: 36, desinvesteringDatum: null, desinvesteringOpbrengst: null, notities: 'Camera voor fotografie; 3 jaar.' }
    },
    { r: 'regiobank', datum: op(10, 7), omschrijving: 'Verkoop Canon EOS R (Marktplaats)', tegenpartij: 'M. Jansen', soort: 'inkomst', bedrag: 72600, btw: '21', gb: '8900' },
    { r: 'regiobank', datum: op(9, 4), omschrijving: 'Drukwerk visitekaartjes', tegenpartij: 'Drukwerkdeal', soort: 'uitgave', bedrag: 6050, btw: '21', gb: '4300', koppel: { bron: 'uitgave', id: drukwerk.id, bedrag: 6050 } },
    { r: 'regiobank', datum: op(11, 18), omschrijving: 'Fotografie productshoot', tegenpartij: 'J. de Wit Fotografie', soort: 'uitgave', bedrag: 72600, btw: '21', gb: '4600', koppel: { bron: 'uitgave', id: foto.id, bedrag: 72600 } }
  );
  // Nog te verwerken (recent, uit de bankimport); bol.com en Studio Vlakveld hebben een
  // koppelsuggestie.
  regels.push(
    { r: 'regiobank', datum: plusDagen(vandaag, -2), omschrijving: 'BOL.COM B.V. 4021886533', tegenpartij: 'bol.com', soort: 'uitgave', bedrag: 4295, btw: '21', gb: '4990', status: 'te_verwerken' },
    { r: 'revolut', datum: plusDagen(vandaag, -4), omschrijving: 'Apple.com/bill iCloud+', tegenpartij: 'Apple', soort: 'uitgave', bedrag: 299, btw: '21', gb: '4000', status: 'te_verwerken' },
    { r: 'regiobank', datum: plusDagen(vandaag, -6), omschrijving: 'Ontvangen — Studio Vlakveld', tegenpartij: 'Studio Vlakveld', soort: 'inkomst', bedrag: 121000, btw: '21', gb: '8000', status: 'te_verwerken' },
    { r: 'revolut', datum: plusDagen(vandaag, -9), omschrijving: 'Udemy cursus typografie', tegenpartij: 'Udemy Ireland Ltd', soort: 'uitgave', bedrag: 1499, btw: 'eu_dienst', gb: '4500', status: 'te_verwerken' }
  );

  const stamdata = demoStamdata(start);
  let n = 0;
  const maakId = () => `de000000-0000-4000-9000-${(++n).toString(16).padStart(12, '0')}`;
  const naarBoeking = (g: Regel): Boeking => {
    const soort = g.soort;
    const btwCode: BtwCode = soort === 'uitgave' || soort === 'inkomst' ? g.btw ?? '21' : 'geen';
    const richting = g.richting ?? (soort === 'inkomst' ? 'bij' : 'af');
    const id = maakId();
    const ber = berekenBoeking({ soort, richting, bedrag: g.bedrag, isExcl: false, btwCode, datum: g.datum });
    const tijd = `${g.datum}T09:${String(n % 60).padStart(2, '0')}:00.000Z`;
    return {
      id,
      rekeningId: DEMO_ID[g.r],
      datum: g.datum,
      omschrijving: g.omschrijving,
      tegenpartij: g.tegenpartij ?? null,
      tegenrekening: null,
      soort,
      richting,
      bedrag: g.bedrag,
      isExcl: false,
      btwCode,
      btw: ber.btw.btw,
      btwHandmatig: false,
      grootboek: soort === 'uitgave' || soort === 'inkomst' ? g.gb ?? null : null,
      vennootId: g.vennoot ? DEMO_ID[g.vennoot] : null,
      status: g.status ?? 'geboekt',
      kenmerk: null,
      notities: null,
      importId: null,
      aangemaakt: tijd,
      aangemaaktDoor: null,
      gewijzigd: tijd
    };
  };
  const koppelingen: Koppeling[] = [];
  const boekingen: Boeking[] = [];
  for (const g of regels) {
    if (g.datum > vandaag || g.datum < start) continue;
    const b = naarBoeking(g);
    boekingen.push(b);
    if (g.activum) activa.push({ ...g.activum, id: activumId(), aanschafdatum: g.datum, ingebruikname: g.datum, boekingId: b.id, uitgaveId: null, aangemaakt: b.aangemaakt });
    if (g.koppel && (g.koppel.bron === 'factuur' ? facturen : uitgaven).some((d) => d.id === g.koppel!.id)) {
      koppelingen.push({
        id: `de000000-0000-4000-a000-${(koppelingen.length + 1).toString(16).padStart(12, '0')}`,
        boekingId: b.id,
        bron: g.koppel.bron,
        bronId: g.koppel.id,
        bedrag: g.koppel.bedrag,
        aangemaakt: b.aangemaakt
      });
    }
  }
  // De aangifte per kwartaal uit het hele journaal (facturen, bonnetjes en losse bankregels),
  // zoals het formulier: hele euro's, afgerond in het voordeel van de studio.
  const posten = journaal(demoStamdata(start), { boekingen, facturen, uitgaven, koppelingen, bronExtra, activa });

  // Afgelopen kwartalen waarvan de deadline voorbij is: ingediend en betaald (gekoppeld).
  const aangiften: Aangifte[] = [];
  const aangifteBetalingen: AangifteBetaling[] = [];
  let j = jaarVan(start);
  let q = kwartaalVan(start);
  for (;;) {
    const deadline = aangifteDeadline(j, q);
    if (deadline >= vandaag) break;
    const ber = aangifteRubrieken(posten, j, q);
    const saldo = teBetalenCenten(ber);
    const betaaldOp = plusDagen(deadline, -4);
    const ag: Aangifte = {
      id: `de000000-0000-4000-e000-${(aangiften.length + 1).toString(16).padStart(12, '0')}`,
      jaar: j,
      kwartaal: q,
      ingediendOp: `${plusDagen(deadline, -9)}T10:00:00.000Z`,
      ingediendDoor: null,
      kenmerk: null,
      opmerking: null,
      snapshot: naarSnapshot(ber),
      teBetalen: saldo
    };
    aangiften.push(ag);
    if (saldo !== 0) {
      const b = naarBoeking({
        r: 'regiobank',
        datum: betaaldOp,
        omschrijving: `Belastingdienst btw Q${q} ${j}`,
        tegenpartij: 'Belastingdienst',
        soort: 'btw',
        richting: saldo > 0 ? 'af' : 'bij',
        bedrag: Math.abs(saldo)
      });
      boekingen.push(b);
      aangifteBetalingen.push({ id: `de000000-0000-4000-a100-${aangiften.length.toString(16).padStart(12, '0')}`, boekingId: b.id, aangifteId: ag.id, bedrag: saldo });
    }
    if (q === 4) {
      j++;
      q = 1;
    } else q = (q + 1) as Kwartaal;
  }
  stamdata.vergrendeling = { aangiften: aangiften.map((a) => ({ jaar: a.jaar, kwartaal: a.kwartaal })), boekjaren: [] };
  boekingen.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.aangemaakt < b.aangemaakt ? -1 : 1));
  facturen.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.nummer < b.nummer ? -1 : 1));
  return { stamdata, boekingen, facturen, uitgaven, koppelingen, bronExtra, importSleutels: {}, aangiften, aangifteBetalingen, activa };
}

export function demoStamdata(start: Datum): Stamdata {
  const grootboek: Grootboekrekening[] = STANDAARD_GROOTBOEK.map((g) => ({
    code: g.code,
    naam: g.naam,
    soort: g.soort,
    rubriek: g.rubriek,
    rgs: g.rgs,
    btw: g.btw,
    systeem: true,
    actief: true,
    hint: g.hint ?? null,
    volgorde: Number(g.code)
  }));
  const rekeningen: Rekening[] = [
    { id: DEMO_ID.regiobank, naam: 'RegioBank', iban: 'NL52RBRB0123456789', grootboek: '1100', standaard: true, importFormaat: 'regiobank', beginsaldo: 845000, begindatum: start, actief: true, volgorde: 1 },
    { id: DEMO_ID.revolut, naam: 'Revolut', iban: 'LT123250012345678901', grootboek: '1110', standaard: false, importFormaat: 'revolut', beginsaldo: 32000, begindatum: start, actief: true, volgorde: 2 }
  ];
  const vennoten: Vennoot[] = [
    { id: DEMO_ID.daniel, naam: 'Daniel', userId: null, aandeel: 50, grootboekKapitaal: '0500', grootboekPrive: '0600', actief: true },
    { id: DEMO_ID.bram, naam: 'Bram', userId: null, aandeel: 50, grootboekKapitaal: '0510', grootboekPrive: '0610', actief: true }
  ];
  return {
    instellingen: { bedrijfsnaam: 'Studio Levant', rechtsvorm: 'vof', kvk: null, btwNummer: null, startdatum: start, kor: false },
    rekeningen,
    grootboek,
    vennoten,
    vergrendeling: { aangiften: [], boekjaren: [] }
  };
}
