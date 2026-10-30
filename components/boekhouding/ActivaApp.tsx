'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCenten, type Centen } from '@/lib/boekhouding/kern/geld';
import { korteDatum, type Datum } from '@/lib/boekhouding/kern/periode';
import { ACTIVA_CATEGORIEEN, looptijdLabel, type Activum, type ActivastaatRegel } from '@/lib/boekhouding/kern/afschrijving';
import { ActivumFormulier, type ActiveerBron } from './ActivumFormulier';

export interface ActivaRij extends ActivastaatRegel {
  status: 'in_gebruik' | 'afgeschreven' | 'gedesinvesteerd' | 'nog_niet';
  herkomst: string;
  /** Deel dat is afgeschreven op 31-12 (0–1). */
  voortgang: number;
  controle: string | null;
}

export interface Voorstel extends ActiveerBron {
  reden: string;
  geactiveerd: Centen;
  opActiva: boolean;
}

const STATUS: Record<ActivaRij['status'], { label: string; klasse: string }> = {
  in_gebruik: { label: 'in gebruik', klasse: 'is-koppel' },
  afgeschreven: { label: 'afgeschreven', klasse: 'is-zacht' },
  gedesinvesteerd: { label: 'verkocht/weg', klasse: 'is-zacht' },
  nog_niet: { label: 'nog niet in gebruik', klasse: 'is-let-op' }
};

// Activa & afschrijvingen: de activastaat van een jaar (begin + investeringen − afschrijving −
// desinvesteringen = eind), voorstellen om aankopen te activeren en een paneel voor een nieuw
// activum (termijn vrij te kiezen, snelkeuze 3 of 5 jaar).
export function ActivaApp({
  jaar,
  jaren,
  rijen,
  totaal,
  voorstellen,
  vandaag,
  activeer
}: {
  jaar: number;
  jaren: number[];
  rijen: ActivaRij[];
  totaal: Omit<ActivastaatRegel, 'activum'>;
  voorstellen: Voorstel[];
  vandaag: Datum;
  activeer: ActiveerBron | null;
}) {
  const router = useRouter();
  const [paneel, setPaneel] = useState<{ bron: ActiveerBron | null } | null>(activeer ? { bron: activeer } : null);
  const [melding, setMelding] = useState<string | null>(null);

  function opgeslagen(a: Activum) {
    setPaneel(null);
    setMelding(`${a.omschrijving} is geactiveerd: ${looptijdLabel(a.looptijdMaanden)} afschrijven vanaf ${korteDatum(a.ingebruikname)}.`);
    router.replace(`/boekhouding/activa?jaar=${jaar}`);
    router.refresh();
  }

  return (
    <div className="bh-inhoud bh-activa">
      <section className="bh-saldi" aria-label="Kerncijfers">
        <div className="bh-saldo">
          <span className="bh-saldo-naam">Boekwaarde 31-12-{jaar}</span>
          <span className="bh-saldo-bedrag">{formatCenten(totaal.eind)}</span>
          <span className="bh-saldo-sub">begin {formatCenten(totaal.begin)}</span>
        </div>
        <div className="bh-saldo">
          <span className="bh-saldo-naam">Afschrijving {jaar}</span>
          <span className="bh-saldo-bedrag">{formatCenten(totaal.afschrijving)}</span>
          <span className="bh-saldo-sub">kosten in de winst-en-verliesrekening</span>
        </div>
        <div className="bh-saldo">
          <span className="bh-saldo-naam">Investeringen {jaar}</span>
          <span className="bh-saldo-bedrag">{formatCenten(totaal.investering)}</span>
          <span className="bh-saldo-sub">excl. btw · activa vanaf € 450</span>
        </div>
        <div className="bh-saldo">
          <span className="bh-saldo-naam">Activa</span>
          <span className="bh-saldo-bedrag">{rijen.filter((r) => r.status === 'in_gebruik' || r.status === 'nog_niet').length}</span>
          <span className="bh-saldo-sub">in gebruik</span>
        </div>
      </section>

      {melding && (
        <p className="bh-melding is-ok" role="status">
          {melding}
        </p>
      )}

      {voorstellen.length > 0 && (
        <section className="bh-kaart bh-activeer" aria-labelledby="bh-activeer-titel">
          <header className="bh-kaart-kop">
            <h2 id="bh-activeer-titel" className="bh-kaart-titel">
              Nog te activeren
            </h2>
            <p className="bh-kaart-sub">Aankopen vanaf € 450 excl. btw (of als investering geboekt) zonder activum. Activeren = op de balans zetten en per maand afschrijven.</p>
          </header>
          <ul className="bh-koppel-lijst">
            {voorstellen.map((v) => (
              <li key={`${v.soort}:${v.id}`} className={`bh-koppel-item${v.opActiva ? ' is-wees' : ''}`}>
                <span className="bh-koppel-tekst">
                  <span className="bh-koppel-titel">{v.titel}</span>
                  <span className="bh-koppel-sub">
                    {v.soort === 'boeking' ? 'Bankregel' : 'Bonnetje'} · {korteDatum(v.datum)}
                  </span>
                  <span className="bh-koppel-reden">{v.reden}</span>
                </span>
                <span className="bh-koppel-bedrag">{formatCenten(v.excl)}</span>
                <button type="button" className="db-knop bh-koppel-knop" onClick={() => setPaneel({ bron: v })}>
                  Activeren
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bh-kaart" aria-labelledby="bh-staat-titel">
        <header className="bh-lijst-kop">
          <div className="bh-kaart-kop">
            <h2 id="bh-staat-titel" className="bh-kaart-titel">
              Activastaat {jaar}
            </h2>
            <p className="bh-kaart-sub">Lineair per maand vanaf de ingebruikname; bedragen excl. btw.</p>
          </div>
          <div className="bh-filters">
            <div className="bh-rek-tabs" role="group" aria-label="Jaar">
              {jaren.map((j) => (
                <Link key={j} href={`/boekhouding/activa?jaar=${j}`} className={`bh-rek-tab${j === jaar ? ' is-aan' : ''}`} aria-current={j === jaar ? 'page' : undefined}>
                  {j}
                </Link>
              ))}
            </div>
            <button type="button" className="db-knop db-knop-primair" onClick={() => setPaneel({ bron: null })}>
              Nieuw activum
            </button>
          </div>
        </header>

        {rijen.length === 0 ? (
          <p className="bh-leeg bh-lijst-leeg">Geen activa in {jaar}. Een investering vanaf € 450 excl. btw (laptop, camera, meubilair) zet je hier op de balans.</p>
        ) : (
          <div className="bh-tabel bh-staat" role="table" aria-label={`Activastaat ${jaar}`}>
            <div className="bh-tr bh-th" role="row">
              <span role="columnheader">Activum</span>
              <span role="columnheader">Termijn</span>
              <span role="columnheader" className="bh-r">
                Aanschaf
              </span>
              <span role="columnheader" className="bh-r">
                Begin {jaar}
              </span>
              <span role="columnheader" className="bh-r">
                Afschrijving
              </span>
              <span role="columnheader" className="bh-r">
                Eind {jaar}
              </span>
            </div>
            {rijen.map((r) => (
              <Link key={r.activum.id} href={`/boekhouding/activa/${r.activum.id}`} className="bh-tr bh-rij" role="row">
                <span className="bh-rij-hoofd" role="cell">
                  <span className="bh-rij-titel">
                    {r.activum.omschrijving}
                    <span className={`bh-pil ${STATUS[r.status].klasse}`}>{STATUS[r.status].label}</span>
                    {r.controle && <span className="bh-pil is-let-op">controleren</span>}
                  </span>
                  <span className="bh-rij-meta">
                    {ACTIVA_CATEGORIEEN[r.activum.categorie].naam} · {r.herkomst}
                  </span>
                  <span className="bh-voortgang" aria-hidden="true">
                    <span style={{ width: `${Math.round(r.voortgang * 100)}%` }} />
                  </span>
                </span>
                <span className="bh-rij-bank" role="cell" data-label="Termijn">
                  {looptijdLabel(r.activum.looptijdMaanden)}
                  <span className="bh-rij-meta"> vanaf {korteDatum(r.activum.ingebruikname)}</span>
                </span>
                <span className="bh-rij-bedrag bh-r" role="cell" data-label="Aanschaf">
                  {formatCenten(r.activum.aanschaf)}
                </span>
                <span className="bh-rij-saldo bh-r" role="cell" data-label={`Begin ${jaar}`}>
                  {r.investering ? <span className="bh-zacht">nieuw</span> : formatCenten(r.begin)}
                </span>
                <span className="bh-rij-bedrag bh-r" role="cell" data-label="Afschrijving">
                  {r.afschrijving ? `−${formatCenten(r.afschrijving)}` : '—'}
                  {r.desinvestering ? <span className="bh-rij-meta">weg {formatCenten(r.desinvestering)}</span> : null}
                </span>
                <span className="bh-rij-bedrag bh-r bh-sterk" role="cell" data-label={`Eind ${jaar}`}>
                  {formatCenten(r.eind)}
                </span>
              </Link>
            ))}
            <div className="bh-tr bh-staat-totaal" role="row">
              <span role="cell">Totaal</span>
              <span role="cell" />
              <span role="cell" />
              <span className="bh-r" role="cell" data-label={`Begin ${jaar}`}>
                {formatCenten(totaal.begin)}
              </span>
              <span className="bh-r" role="cell" data-label="Afschrijving">
                −{formatCenten(totaal.afschrijving)}
              </span>
              <span className="bh-r" role="cell" data-label={`Eind ${jaar}`}>
                {formatCenten(totaal.eind)}
              </span>
            </div>
          </div>
        )}
        <p className="bh-kaart-sub">
          Begin {formatCenten(totaal.begin)} + investeringen {formatCenten(totaal.investering)} − afschrijving {formatCenten(totaal.afschrijving)}
          {totaal.desinvestering ? ` − desinvesteringen ${formatCenten(totaal.desinvestering)}` : ''} = eind {formatCenten(totaal.eind)}.
        </p>
      </section>

      {paneel && <ActivumFormulier bron={paneel.bron} vandaag={vandaag} onSluit={() => setPaneel(null)} onOpgeslagen={opgeslagen} />}
    </div>
  );
}
