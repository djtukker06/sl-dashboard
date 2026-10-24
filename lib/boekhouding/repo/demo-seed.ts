// Voorbeeldgegevens voor de demo-modus: ~14 maanden bankregels op RegioBank en Revolut, zoals
// een kleine ontwerpstudio (VOF, twee vennoten) die echt heeft. Deterministisch (vaste
// bedragen en vaste id's) en relatief ten opzichte van vandaag, zodat de demo altijd actueel
// oogt. Pure module: geen netwerk, geen klok (vandaag wordt meegegeven), geen '@/'-imports.
//
// Wat erin zit (bewust alle soorten regels):
//   - software uit de EU met verlegde btw (Adobe en Google, Ierland → rubriek 4b) en van
//     buiten de EU (Figma, VS → 4a), KPN 21%, NS 9%, bankkosten zonder btw, een verzekering;
//   - klantbetalingen 21% en één EU-klant (btw verlegd, 3b);
//   - een laptop (investering, € 2.499 excl.) en een monitor onder € 450 (direct kosten);
//   - maandelijkse privé-opnamen van Daniel en Bram, overboekingen tussen de eigen rekeningen;
//   - per afgelopen kwartaal de btw-betaling aan de Belastingdienst; die kwartalen zijn
//     "ingediend" en dus vergrendeld; het lopende kwartaal is open;
//   - een paar regels die nog verwerkt moeten worden.

import { STANDAARD_GROOTBOEK } from '../kern/constanten';
import type { BtwCode } from '../kern/btw';
import {
  aangifteDeadline,
  dagenInMaand,
  jaarVan,
  kwartaalGrenzen,
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
  /** Ingediende aangiften met het betaalde/ontvangen saldo. */
  aangiften: { jaar: number; kwartaal: Kwartaal; teBetalen: number; ingediendOp: Datum }[];
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
}

export function demoSeed(vandaag: Datum): DemoData {
  const start = maakDatum(jaarVan(plusMaanden(vandaag, -13)), maandVan(plusMaanden(vandaag, -13)), 1);
  const op = (m: number, dag: number): Datum => {
    const eerste = plusMaanden(start, m);
    return maakDatum(jaarVan(eerste), maandVan(eerste), Math.min(dag, dagenInMaand(jaarVan(eerste), maandVan(eerste))));
  };

  const regels: Regel[] = [];
  let factuurNr = 7;
  for (let m = 0; m <= 13; m++) {
    const j = jaarVan(op(m, 1));
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
    for (const [i, dag] of [9, 21].entries()) {
      const k = (m * 2 + i) % KLANTEN.length;
      const nr = `${j}-${String(factuurNr++).padStart(3, '0')}`;
      regels.push({
        r: 'regiobank',
        datum: op(m, dag),
        omschrijving: `Betaling factuur ${nr}`,
        tegenpartij: KLANTEN[k],
        soort: 'inkomst',
        bedrag: BETALINGEN[(m * 3 + i) % BETALINGEN.length],
        btw: '21',
        gb: '8000'
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
  regels.push(
    { r: 'regiobank', datum: op(2, 14), omschrijving: 'Coolblue — monitor 27"', tegenpartij: 'Coolblue B.V.', soort: 'uitgave', bedrag: 34900, btw: '21', gb: '4010' },
    { r: 'regiobank', datum: op(3, 20), omschrijving: 'Beroepsaansprakelijkheid', tegenpartij: 'Hiscox', soort: 'uitgave', bedrag: 41250, btw: 'geen', gb: '4750' },
    { r: 'regiobank', datum: op(5, 15), omschrijving: 'Betaling factuur — Agentur Nordlicht (DE)', tegenpartij: 'Agentur Nordlicht GmbH', soort: 'inkomst', bedrag: 280000, btw: 'eu_dienst', gb: '8010' },
    { r: 'regiobank', datum: op(6, 6), omschrijving: 'Apple — MacBook Pro 14"', tegenpartij: 'Apple Distribution International', soort: 'uitgave', bedrag: 302379, btw: '21', gb: '0210' },
    { r: 'regiobank', datum: op(8, 11), omschrijving: 'Lunch met klant', tegenpartij: 'Brasserie De Haven', soort: 'uitgave', bedrag: 8640, btw: '9', gb: '4400' },
    { r: 'regiobank', datum: op(9, 4), omschrijving: 'Drukwerk visitekaartjes', tegenpartij: 'Drukwerkdeal', soort: 'uitgave', bedrag: 6050, btw: '21', gb: '4300' },
    { r: 'regiobank', datum: op(11, 18), omschrijving: 'Fotografie productshoot', tegenpartij: 'J. de Wit Fotografie', soort: 'uitgave', bedrag: 72600, btw: '21', gb: '4600' }
  );
  // Nog te verwerken (recent, uit de bankimport).
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
  const boekingen = regels.filter((g) => g.datum <= vandaag && g.datum >= start).map(naarBoeking);

  // Afgelopen kwartalen waarvan de deadline voorbij is: ingediend en betaald.
  const aangiften: DemoData['aangiften'] = [];
  let j = jaarVan(start);
  let q = kwartaalVan(start);
  for (;;) {
    const deadline = aangifteDeadline(j, q);
    if (deadline >= vandaag) break;
    const { van, tot } = kwartaalGrenzen(j, q);
    let saldo = 0;
    for (const b of boekingen) {
      if (b.datum < van || b.datum > tot) continue;
      const r = berekenBoeking(b);
      saldo += r.teken * (r.btw.verschuldigd - r.btw.voorbelasting);
    }
    const betaaldOp = plusDagen(deadline, -4);
    aangiften.push({ jaar: j, kwartaal: q, teBetalen: saldo, ingediendOp: plusDagen(deadline, -9) });
    if (saldo !== 0) {
      boekingen.push(
        naarBoeking({
          r: 'regiobank',
          datum: betaaldOp,
          omschrijving: `Belastingdienst btw Q${q} ${j}`,
          tegenpartij: 'Belastingdienst',
          soort: 'btw',
          richting: saldo > 0 ? 'af' : 'bij',
          bedrag: Math.abs(saldo)
        })
      );
    }
    if (q === 4) {
      j++;
      q = 1;
    } else q = (q + 1) as Kwartaal;
  }
  stamdata.vergrendeling = { aangiften: aangiften.map((a) => ({ jaar: a.jaar, kwartaal: a.kwartaal })), boekjaren: [] };
  boekingen.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.aangemaakt < b.aangemaakt ? -1 : 1));
  return { stamdata, boekingen, aangiften };
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
