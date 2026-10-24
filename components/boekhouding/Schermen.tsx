import 'server-only';
import { BoekhoudingKop } from './BoekhoudingKop';
import { BankApp, type BankFilter } from './BankApp';
import { DemoBanner } from './DemoBanner';
import { RekeningenBeheer } from './RekeningenBeheer';
import { BankSubnav } from './BankSubnav';
import { formatCenten } from '@/lib/boekhouding/kern/geld';
import { isKwartaal, jaarVan, vandaagNL } from '@/lib/boekhouding/kern/periode';
import { btwPerKwartaal, journaal } from '@/lib/boekhouding/kern/journaal';
import {
  betalingSuggesties,
  bonOntbreekt,
  factuurPosten,
  inkomstenZonderFactuur,
  koppelSuggesties,
  ouderdomTotalen,
  overboekingen,
  uitgavePosten,
  verweesdeKoppelingen,
  type OpenPost
} from '@/lib/boekhouding/kern/afletteren';
import { uitgaveTeltNiet, type FactuurBron, type UitgaveBron } from '@/lib/boekhouding/kern/bronnen';
import { berekenBoeking, type Boeking } from '@/lib/boekhouding/model';
import { OpenstaandApp, type Controle, type OpenRij } from './Openstaand';
import { ImportWizard } from './ImportWizard';
import { DemoRepo } from '@/lib/boekhouding/repo/demo';
import { isSoort } from '@/lib/boekhouding/model';
import { laadAlles, type BoekhoudRepo } from '@/lib/boekhouding/repo/types';

// De inhoud van de boekhoudschermen, los van de toegangscontrole: de pagina's in
// app/(app)/boekhouding controleren eerst het teamlid en kiezen de opslag (live of demo) en
// geven die hier door.

export type Zoekparams = Record<string, string | string[] | undefined>;
const een = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export function Demo({ repo, reden }: { repo: BoekhoudRepo; reden: 'env' | 'migratie' }) {
  return repo.modus === 'demo' ? <DemoBanner reden={reden} /> : null;
}

export async function BankScherm({ repo, sp, demoReden }: { repo: BoekhoudRepo; sp: Zoekparams; demoReden: 'env' | 'migratie' }) {
  const { stam, boekingen, koppelingen, facturen, uitgaven, bronExtra } = await laadAlles(repo);
  const vandaag = vandaagNL();
  // Btw uit facturen en bonnetjes per kwartaal (de losse bankregels telt de pagina zelf mee).
  const bronBtw = Object.fromEntries(btwPerKwartaal(journaal({ ...stam, rekeningen: [] }, { boekingen: [], facturen, uitgaven, bronExtra })));
  const openId = een(sp.open);
  const jaarTekst = een(sp.jaar);
  const kw = Number(een(sp.kw));
  const soort = een(sp.soort);
  const rekening = een(sp.rekening);
  const filter: BankFilter = {
    rekening: stam.rekeningen.some((r) => r.id === rekening) ? rekening : 'alle',
    jaar: jaarTekst === 'alle' ? 'alle' : /^\d{4}$/.test(jaarTekst) ? Number(jaarTekst) : jaarVan(vandaag),
    kw: isKwartaal(kw) ? kw : 0,
    soort: isSoort(soort) ? soort : '',
    status: een(sp.status) === 'te_verwerken' ? 'te_verwerken' : '',
    q: een(sp.q).slice(0, 100)
  };
  return (
    <div className="bh">
      <BoekhoudingKop titel="Bank & boekingen" />
      <Demo repo={repo} reden={demoReden} />
      <BankSubnav actief="boekingen" />
      <BankApp
        stam={stam}
        boekingen={boekingen}
        vandaag={vandaag}
        filter={filter}
        koppelingen={koppelingen}
        facturen={facturen}
        uitgaven={uitgaven}
        bronBtw={bronBtw}
        openId={boekingen.some((b) => b.id === openId) ? openId : null}
      />
    </div>
  );
}

export async function InstellingenScherm({ repo, demoReden }: { repo: BoekhoudRepo; demoReden: 'env' | 'migratie' }) {
  const stam = await repo.stamdata();
  const kiesbaar = stam.grootboek.filter((g) => g.soort === 'kosten' || g.soort === 'opbrengst');
  return (
    <div className="bh">
      <BoekhoudingKop titel="Instellingen" />
      <Demo repo={repo} reden={demoReden} />
      <div className="bh-inhoud bh-instellingen">
        <section className="bh-sectie" aria-labelledby="bh-rek-titel">
          <header className="bh-sectie-kop">
            <h2 id="bh-rek-titel" className="bh-kaart-titel">
              Bankrekeningen
            </h2>
            <p className="bh-kaart-sub">De standaardrekening staat voorgeselecteerd bij een nieuwe boeking. Elke rekening heeft een eigen grootboekrekening.</p>
          </header>
          <RekeningenBeheer rekeningen={stam.rekeningen} />
        </section>

        <section className="bh-sectie" aria-labelledby="bh-ven-titel">
          <header className="bh-sectie-kop">
            <h2 id="bh-ven-titel" className="bh-kaart-titel">
              Vennoten
            </h2>
            <p className="bh-kaart-sub">
              {stam.instellingen.bedrijfsnaam} · {stam.instellingen.rechtsvorm === 'vof' ? 'VOF' : stam.instellingen.rechtsvorm} · factuurstelsel
              {stam.instellingen.kor ? ' · KOR' : ''}. Privé-opnamen en -stortingen boek je per vennoot; de winstverdeling volgt in de jaarrekening.
            </p>
          </header>
          <ul className="bh-vennoten">
            {stam.vennoten.map((v) => (
              <li key={v.id} className="bh-vennoot">
                <span className="bh-vennoot-naam">{v.naam}</span>
                <span className="bh-vennoot-aandeel">{v.aandeel}% winstaandeel</span>
                <span className="bh-rek-meta">
                  kapitaal {v.grootboekKapitaal} · privé {v.grootboekPrive}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="bh-sectie" aria-labelledby="bh-gb-titel">
          <header className="bh-sectie-kop">
            <h2 id="bh-gb-titel" className="bh-kaart-titel">
              Categorieën
            </h2>
            <p className="bh-kaart-sub">Bij een boeking kies je een categorie; daarachter zit het grootboek (met RGS-code voor de boekhouder).</p>
          </header>
          <div className="bh-gb">
            {kiesbaar.map((g) => (
              <div key={g.code} className="bh-gb-rij">
                <span className="bh-gb-code">{g.code}</span>
                <span className="bh-gb-naam">
                  {g.naam}
                  {g.hint && <span className="bh-rek-meta"> · {g.hint}</span>}
                </span>
                <span className="bh-gb-soort">{g.soort === 'kosten' ? 'kosten' : 'opbrengst'}</span>
                <span className="bh-gb-btw">{g.btw ? (g.btw === 'geen' ? 'geen btw' : g.btw === 'eu_dienst' ? 'EU' : `${g.btw}%`) : '—'}</span>
              </div>
            ))}
          </div>
          <p className="bh-kaart-sub">Bedragen worden in hele centen bewaard ({formatCenten(1)} nauwkeurig); de btw wordt per regel afgerond.</p>
        </section>
      </div>
    </div>
  );
}

export async function OpenstaandScherm({ repo, demoReden }: { repo: BoekhoudRepo; demoReden: 'env' | 'migratie' }) {
  const { stam, boekingen, koppelingen, facturen, uitgaven } = await laadAlles(repo);
  const vandaag = vandaagNL();
  const bankNaam = new Map(stam.rekeningen.map((r) => [r.id, r.naam]));
  const gekoppeld = new Set(koppelingen.map((k) => k.boekingId));
  const fOpen = factuurPosten(facturen, koppelingen, vandaag).filter((p) => p.open !== 0);
  const uOpen = uitgavePosten(uitgaven, koppelingen, vandaag).filter((p) => p.open !== 0);
  const besteVoor = new Map<string, string>();
  for (const b of boekingen) {
    const s = koppelSuggesties(b, fOpen, uOpen, koppelingen, 1)[0];
    if (s) besteVoor.set(b.id, s.bronId);
  }
  const naarRij = (bron: 'factuur' | 'uitgave', p: OpenPost<FactuurBron> | OpenPost<UitgaveBron>, titel: string, sub: string): OpenRij => ({
    bron,
    id: p.doc.id,
    titel,
    sub,
    datum: p.doc.datum as string,
    dagen: p.dagen,
    ouderdom: p.ouderdom,
    vervallen: p.vervallen,
    totaal: p.totaal,
    open: p.open,
    deels: p.status === 'deels',
    // Alleen bankregels waarvoor dit document de beste match is (geen dubbele voorstellen).
    suggesties: betalingSuggesties(bron, p, boekingen, koppelingen, 3)
      .filter((s) => (besteVoor.get(s.boeking.id) ?? p.doc.id) === p.doc.id)
      .slice(0, 2)
      .map((s) => ({
      boekingId: s.boeking.id,
      datum: s.boeking.datum,
      bank: bankNaam.get(s.boeking.rekeningId ?? '') ?? 'Kas',
      omschrijving: s.boeking.omschrijving,
      bedrag: s.bedrag,
      redenen: s.redenen
    }))
  });
  const opDagen = <T extends { dagen: number }>(a: T, b: T) => b.dagen - a.dagen;
  const debiteuren = fOpen.sort(opDagen).map((p) => naarRij('factuur', p, `Factuur ${p.doc.nummer}`, p.doc.klant));
  const crediteuren = uOpen.sort(opDagen).map((p) => naarRij('uitgave', p, p.doc.leverancier || 'Bonnetje', p.doc.omschrijving || p.doc.factuurnummer || 'Inkoopfactuur'));

  const bankRij = (b: Boeking, sub?: string) => ({
    id: b.id,
    datum: b.datum,
    titel: b.omschrijving,
    sub: sub ?? `${bankNaam.get(b.rekeningId ?? '') ?? 'Kas'}${b.tegenpartij && b.tegenpartij !== b.omschrijving ? ` · ${b.tegenpartij}` : ''}`,
    bedrag: berekenBoeking(b).bankMutatie,
    href: `/boekhouding/bank?jaar=alle&open=${b.id}`
  });
  const nieuwsteEerst = (a: { datum: string }, b: { datum: string }) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0);
  const zonderBon = bonOntbreekt(boekingen, gekoppeld).sort(nieuwsteEerst);
  const zonderFactuur = inkomstenZonderFactuur(boekingen, gekoppeld).sort(nieuwsteEerst);
  const losseOverboekingen = overboekingen(boekingen).los;
  const boekingVan = new Map(boekingen.map((b) => [b.id, b]));
  const wezen = verweesdeKoppelingen(koppelingen, facturen, uitgaven);
  const nietMee = uitgaven.filter((u) => uitgaveTeltNiet(u)).sort((a, b) => ((a.datum ?? '') < (b.datum ?? '') ? 1 : -1));
  const som = (l: { bedrag: number }[]) => l.reduce((t, r) => t + r.bedrag, 0);

  const controles: Controle[] = [
    {
      id: 'bon',
      titel: 'Bon ontbreekt',
      uitleg: 'Uitgaven met 21% of 9% voorbelasting zonder gekoppeld bonnetje. Voor de btw-aftrek is een factuur nodig.',
      rijen: zonderBon.map((b) => bankRij(b))
    },
    {
      id: 'factuur',
      titel: 'Ontvangsten zonder factuur',
      uitleg: 'Tellen als losse omzet. Hoort er een factuur bij? Koppel hem, dan komen omzet en btw uit de factuur.',
      rijen: zonderFactuur.map((b) => bankRij(b))
    },
    {
      id: 'kruis',
      titel: 'Overboekingen zonder tegenhanger',
      uitleg: 'Een overboeking tussen eigen rekeningen hoort op beide rekeningen te staan; anders blijft er een bedrag op kruisposten.',
      rijen: losseOverboekingen.map((b) => bankRij(b))
    },
    {
      id: 'wees',
      titel: 'Koppeling naar verwijderd document',
      uitleg: 'De factuur of het bonnetje is verwijderd; de betaling staat nog op debiteuren of crediteuren. Ontkoppel of koppel opnieuw.',
      rijen: wezen.flatMap((k) => {
        const b = boekingVan.get(k.boekingId);
        return b ? [{ ...bankRij(b, k.bron === 'factuur' ? 'Factuur bestaat niet meer' : 'Bonnetje bestaat niet meer'), id: k.id }] : [];
      })
    },
    {
      id: 'niet',
      titel: 'Bonnetjes die nog niet meetellen',
      uitleg: 'In concept of in een andere valuta. Controleer ze bij Bonnetjes; pas daarna tellen ze mee voor kosten en btw.',
      rijen: nietMee.map((u) => ({
        id: u.id,
        datum: u.datum ?? vandaag,
        titel: u.leverancier || u.omschrijving || 'Bonnetje',
        sub: uitgaveTeltNiet(u) ?? '',
        bedrag: u.totaal ?? 0,
        href: '/boekhouding/bonnetjes'
      }))
    }
  ];
  controles[0].totaal = som(controles[0].rijen);
  controles[1].totaal = som(controles[1].rijen);

  return (
    <div className="bh">
      <BoekhoudingKop titel="Openstaand & afletteren" />
      <Demo repo={repo} reden={demoReden} />
      <BankSubnav actief="openstaand" teller={{ openstaand: debiteuren.length + crediteuren.length }} />
      <OpenstaandApp
        debiteuren={debiteuren}
        crediteuren={crediteuren}
        totDeb={ouderdomTotalen(fOpen)}
        totCred={ouderdomTotalen(uOpen)}
        controles={controles}
        teVerwerken={boekingen.filter((b) => b.status === 'te_verwerken').length}
      />
    </div>
  );
}

export async function ImportScherm({ repo, demoReden }: { repo: BoekhoudRepo; demoReden: 'env' | 'migratie' }) {
  const stam = await repo.stamdata();
  // Alleen in de demo: voorbeeldbestanden (in de echte boekhouding nooit nepregels aanbieden).
  const voorbeelden = repo instanceof DemoRepo ? repo.voorbeeldAfschriften() : null;
  return (
    <div className="bh">
      <BoekhoudingKop titel="Afschrift importeren" />
      <Demo repo={repo} reden={demoReden} />
      <BankSubnav actief="importeren" />
      <ImportWizard stam={stam} voorbeelden={voorbeelden} />
    </div>
  );
}
