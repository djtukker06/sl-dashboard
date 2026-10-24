import 'server-only';
import { BoekhoudingKop } from './BoekhoudingKop';
import { BankApp, type BankFilter } from './BankApp';
import { DemoBanner } from './DemoBanner';
import { RekeningenBeheer } from './RekeningenBeheer';
import { formatCenten } from '@/lib/boekhouding/kern/geld';
import { isKwartaal, jaarVan, vandaagNL } from '@/lib/boekhouding/kern/periode';
import { isSoort } from '@/lib/boekhouding/model';
import type { BoekhoudRepo } from '@/lib/boekhouding/repo/types';

// De inhoud van de boekhoudschermen, los van de toegangscontrole: de pagina's in
// app/(app)/boekhouding controleren eerst het teamlid en kiezen de opslag (live of demo) en
// geven die hier door.

export type Zoekparams = Record<string, string | string[] | undefined>;
const een = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export function Demo({ repo, reden }: { repo: BoekhoudRepo; reden: 'env' | 'migratie' }) {
  return repo.modus === 'demo' ? <DemoBanner reden={reden} /> : null;
}

export async function BankScherm({ repo, sp, demoReden }: { repo: BoekhoudRepo; sp: Zoekparams; demoReden: 'env' | 'migratie' }) {
  const [stam, boekingen] = await Promise.all([repo.stamdata(), repo.boekingen()]);
  const vandaag = vandaagNL();
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
      <BankApp stam={stam} boekingen={boekingen} vandaag={vandaag} filter={filter} />
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
